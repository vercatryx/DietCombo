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

        // Check if Driver 0 already exists (special reserve - must be unique)
        const hasDriver0 = (existingDrivers || []).some(driver => 
            /driver\s+0/i.test(driver.name)
        );

        // Parse driver numbers from names to find the highest number
        const parseDriverNum = (name: string) => {
            const m = /driver\s+(\d+)/i.exec(String(name || ""));
            return m ? parseInt(m[1], 10) : null;
        };

        // Determine next driver number
        let nextNum: number;
        let driverName: string;
        
        if (!hasDriver0) {
            // If Driver 0 doesn't exist, create it (special reserve)
            nextNum = 0;
            driverName = 'Driver 0';
        } else {
            // If Driver 0 exists, find the highest driver number (excluding 0) and increment
            let maxNum = 0; // Start at 0, so if no other drivers exist, we'll create Driver 1
            for (const driver of existingDrivers || []) {
                const num = parseDriverNum(driver.name);
                // Skip Driver 0 when finding max, but track other drivers
                if (num !== null && num !== 0 && num > maxNum) {
                    maxNum = num;
                }
            }
            // Increment from the highest number found (min 1 if only Driver 0 exists)
            nextNum = maxNum + 1;
            driverName = `Driver ${nextNum}`;
        }
        
        const color = palette[nextNum % palette.length];

        // Final safeguard: Double-check that Driver 0 cannot be duplicated
        if (nextNum === 0 && hasDriver0) {
            return NextResponse.json(
                { error: "Driver 0 already exists and cannot be duplicated" },
                { status: 400 }
            );
        }

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

