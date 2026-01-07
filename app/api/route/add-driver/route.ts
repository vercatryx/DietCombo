export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { query } from "@/lib/mysql";
import { v4 as uuidv4 } from "uuid";

function normalizeDay(raw?: string | null) {
    const s = String(raw ?? "all").toLowerCase().trim();
    const days = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday","all"];
    return days.includes(s) ? s : "all";
}

// Color palette for drivers
const palette = [
    "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd",
    "#8c564b", "#e377c2", "#17becf", "#bcbd22", "#393b79",
    "#ad494a", "#637939", "#ce6dbd", "#8c6d31", "#7f7f7f",
];

export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => ({}));
        const day = normalizeDay(body?.day);

        // Get existing drivers for this day
        const existingDrivers = await query<any[]>(`
            SELECT id, name FROM drivers
            WHERE day = ?
            ORDER BY id ASC
        `, [day]);

        // Parse driver numbers from names to find the highest number
        const parseDriverNum = (name: string) => {
            const m = /driver\s+(\d+)/i.exec(String(name || ""));
            return m ? parseInt(m[1], 10) : null;
        };

        // Find the highest driver number
        let maxNum = -1;
        for (const driver of existingDrivers) {
            const num = parseDriverNum(driver.name);
            if (num !== null && num > maxNum) {
                maxNum = num;
            }
        }

        // Next driver number
        const nextNum = maxNum + 1;
        const driverName = `Driver ${nextNum}`;
        const color = palette[nextNum % palette.length];

        // Create new driver
        const newId = uuidv4();
        await query(`
            INSERT INTO drivers (id, day, name, color, stop_ids)
            VALUES (?, ?, ?, ?, ?)
        `, [newId, day, driverName, color, JSON.stringify([])]);

        // Create new route run snapshot with the new driver
        const allDrivers = await query<any[]>(`
            SELECT id, name, color, stop_ids FROM drivers
            WHERE day = ?
            ORDER BY 
                CASE 
                    WHEN name LIKE 'Driver 0' THEN 0
                    WHEN name REGEXP 'Driver [0-9]+' THEN CAST(SUBSTRING(name, 8) AS UNSIGNED)
                    ELSE 999999
                END
        `, [day]);

        const finalSnapshot = allDrivers.map(d => ({
            driverId: d.id,
            driverName: d.name,
            color: d.color,
            stopIds: Array.isArray(d.stop_ids) ? d.stop_ids : (typeof d.stop_ids === "string" ? JSON.parse(d.stop_ids || "[]") : []),
        }));

        // Create new route run
        const runId = uuidv4();
        await query(`
            INSERT INTO route_runs (id, day, snapshot)
            VALUES (?, ?, ?)
        `, [runId, day, JSON.stringify(finalSnapshot)]);

        return NextResponse.json(
            { 
                success: true, 
                message: `Driver added successfully`,
                driver: {
                    id: newId,
                    name: driverName,
                    color: color
                },
                runId
            },
            { headers: { "Cache-Control": "no-store" } }
        );
    } catch (e: any) {
        console.error("[/api/route/add-driver] error:", e);
        return NextResponse.json(
            { error: e?.message || "Server error" },
            { status: 500 }
        );
    }
}

