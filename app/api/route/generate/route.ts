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
        const driverCount = Number(body?.driverCount) || 6;

        if (!Number.isFinite(driverCount) || driverCount <= 0) {
            return NextResponse.json(
                { error: "Invalid driverCount" },
                { status: 400 }
            );
        }

        // Get all stops for this day
        const dayWhere = day === "all" ? "" : `WHERE day = ?`;
        const dayParams = day === "all" ? [] : [day];
        const allStops = await query<any[]>(`
            SELECT id FROM stops ${dayWhere}
            ORDER BY id ASC
        `, dayParams);

        const stopIds = allStops.map(s => s.id);

        // Get existing drivers for this day
        const existingDrivers = await query<any[]>(`
            SELECT id, name FROM drivers
            WHERE day = ?
            ORDER BY id ASC
        `, [day]);

        // Parse driver numbers from names to maintain Driver 0, 1, 2... order
        const parseDriverNum = (name: string) => {
            const m = /driver\s+(\d+)/i.exec(String(name || ""));
            return m ? parseInt(m[1], 10) : null;
        };

        // Sort existing drivers by number (Driver 0 first)
        const sortedExisting = [...existingDrivers].sort((a, b) => {
            const numA = parseDriverNum(a.name) ?? Number.MAX_SAFE_INTEGER;
            const numB = parseDriverNum(b.name) ?? Number.MAX_SAFE_INTEGER;
            return numA - numB;
        });

        // Create or update drivers to match driverCount
        const drivers: Array<{ id: string; name: string; color: string }> = [];

        for (let i = 0; i < driverCount; i++) {
            const driverName = i === 0 ? "Driver 0" : `Driver ${i}`;
            const color = palette[i % palette.length];

            if (i < sortedExisting.length) {
                // Update existing driver
                const existing = sortedExisting[i];
                await query(`
                    UPDATE drivers
                    SET name = ?, color = ?, stop_ids = ?
                    WHERE id = ?
                `, [driverName, color, JSON.stringify([]), existing.id]);
                drivers.push({ id: existing.id, name: driverName, color });
            } else {
                // Create new driver
                const newId = uuidv4();
                await query(`
                    INSERT INTO drivers (id, day, name, color, stop_ids)
                    VALUES (?, ?, ?, ?, ?)
                `, [newId, day, driverName, color, JSON.stringify([])]);
                drivers.push({ id: newId, name: driverName, color });
            }
        }

        // Remove extra drivers if we reduced the count
        if (sortedExisting.length > driverCount) {
            const toRemove = sortedExisting.slice(driverCount);
            for (const driver of toRemove) {
                // Remove stops from this driver first
                await query(`
                    UPDATE drivers SET stop_ids = ? WHERE id = ?
                `, [JSON.stringify([]), driver.id]);
                // Optionally delete the driver, or just leave it with empty stops
                // For now, we'll leave it (in case user wants to add it back)
            }
        }

        // Distribute stops evenly among drivers
        const stopsPerDriver = Math.floor(stopIds.length / driverCount);
        const remainder = stopIds.length % driverCount;

        let stopIndex = 0;
        for (let i = 0; i < driverCount; i++) {
            const driver = drivers[i];
            // Give one extra stop to first 'remainder' drivers
            const count = stopsPerDriver + (i < remainder ? 1 : 0);
            const driverStops = stopIds.slice(stopIndex, stopIndex + count);
            stopIndex += count;

            await query(`
                UPDATE drivers
                SET stop_ids = ?
                WHERE id = ?
            `, [JSON.stringify(driverStops), driver.id]);
        }

        // Re-fetch to get actual stop_ids after distribution
        const updatedDrivers = await query<any[]>(`
            SELECT id, name, color, stop_ids FROM drivers
            WHERE day = ? AND id IN (${drivers.map(() => "?").join(",")})
            ORDER BY 
                CASE 
                    WHEN name LIKE 'Driver 0' THEN 0
                    WHEN name REGEXP 'Driver [0-9]+' THEN CAST(SUBSTRING(name, 8) AS UNSIGNED)
                    ELSE 999999
                END
        `, [day, ...drivers.map(d => d.id)]);

        const finalSnapshot = updatedDrivers.map(d => ({
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
                message: `Generated routes with ${driverCount} drivers for day "${day}"`,
                runId,
                driversCreated: drivers.length,
                stopsAssigned: stopIds.length
            },
            { headers: { "Cache-Control": "no-store" } }
        );
    } catch (e: any) {
        console.error("[/api/route/generate] error:", e);
        return NextResponse.json(
            { error: e?.message || "Server error" },
            { status: 500 }
        );
    }
}

