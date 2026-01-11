export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
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
        const { data: existingDrivers } = await supabase
            .from('drivers')
            .select('id, name')
            .eq('day', day)
            .order('id', { ascending: true });

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
        await supabase
            .from('drivers')
            .insert([{ id: newId, day, name: driverName, color, stop_ids: [] }]);

        // Create new route run snapshot with the new driver
        const { data: allDrivers } = await supabase
            .from('drivers')
            .select('id, name, color, stop_ids')
            .eq('day', day);

        // Sort by driver number manually
        const sortedDrivers = (allDrivers || []).sort((a, b) => {
            const parseNum = (name: string) => {
                if (name === 'Driver 0') return 0;
                const m = /driver\s+(\d+)/i.exec(String(name || ""));
                return m ? parseInt(m[1], 10) : 999999;
            };
            return parseNum(a.name) - parseNum(b.name);
        });

        const finalSnapshot = sortedDrivers.map(d => ({
            driverId: d.id,
            driverName: d.name,
            color: d.color,
            stopIds: Array.isArray(d.stop_ids) ? d.stop_ids : (typeof d.stop_ids === "string" ? JSON.parse(d.stop_ids || "[]") : []),
        }));

        // Create new route run
        const runId = uuidv4();
        await supabase
            .from('route_runs')
            .insert([{ id: runId, day, snapshot: finalSnapshot }]);

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

