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
        const driverCount = Number(body?.driverCount) || 6;

        if (!Number.isFinite(driverCount) || driverCount <= 0) {
            return NextResponse.json(
                { error: "Invalid driverCount" },
                { status: 400 }
            );
        }

        // Get all stops for this day
        let stopsQuery = supabase
            .from('stops')
            .select('id')
            .order('id', { ascending: true });
        
        if (day !== "all") {
            stopsQuery = stopsQuery.eq('day', day);
        }
        
        const { data: allStops } = await stopsQuery;
        const stopIds = (allStops || []).map(s => s.id);

        // Get existing drivers for this day
        const { data: existingDrivers } = await supabase
            .from('drivers')
            .select('id, name')
            .eq('day', day)
            .order('id', { ascending: true });

        // Parse driver numbers from names to maintain Driver 0, 1, 2... order
        const parseDriverNum = (name: string) => {
            const m = /driver\s+(\d+)/i.exec(String(name || ""));
            return m ? parseInt(m[1], 10) : null;
        };

        // Ensure Driver 0 is unique (special reserve - must be only 1)
        const driver0Drivers = (existingDrivers || []).filter(d => /driver\s+0/i.test(d.name));
        const nonDriver0Drivers = (existingDrivers || []).filter(d => !/driver\s+0/i.test(d.name));
        
        // Keep only the first Driver 0 if multiple exist
        const uniqueDriver0 = driver0Drivers.length > 0 ? [driver0Drivers[0]] : [];
        
        // Combine: Driver 0 first, then others sorted by number
        const allUniqueDrivers = [...uniqueDriver0, ...nonDriver0Drivers];
        const sortedExisting = allUniqueDrivers.sort((a, b) => {
            const numA = parseDriverNum(a.name) ?? Number.MAX_SAFE_INTEGER;
            const numB = parseDriverNum(b.name) ?? Number.MAX_SAFE_INTEGER;
            return numA - numB;
        });
        
        // Delete duplicate Driver 0 entries if any exist
        if (driver0Drivers.length > 1) {
            const duplicatesToDelete = driver0Drivers.slice(1);
            for (const dup of duplicatesToDelete) {
                await supabase
                    .from('drivers')
                    .delete()
                    .eq('id', dup.id);
            }
        }

        // Create or update drivers to match driverCount
        const drivers: Array<{ id: string; name: string; color: string }> = [];
        
        // Map existing drivers by their number for quick lookup
        const driversByNumber = new Map<number, { id: string; name: string }>();
        for (const driver of sortedExisting) {
            const num = parseDriverNum(driver.name);
            if (num !== null && !driversByNumber.has(num)) {
                driversByNumber.set(num, driver);
            }
        }

        for (let i = 0; i < driverCount; i++) {
            const driverName = i === 0 ? "Driver 0" : `Driver ${i}`;
            const driverNum = i;
            const color = palette[i % palette.length];

            // Find existing driver with this number
            const existing = driversByNumber.get(driverNum);
            
            if (existing) {
                // Update existing driver
                await supabase
                    .from('drivers')
                    .update({ name: driverName, color, stop_ids: [] })
                    .eq('id', existing.id);
                drivers.push({ id: existing.id, name: driverName, color });
            } else {
                // Create new driver (especially Driver 0 if it doesn't exist)
                const newId = uuidv4();
                await supabase
                    .from('drivers')
                    .insert([{ id: newId, day, name: driverName, color, stop_ids: [] }]);
                drivers.push({ id: newId, name: driverName, color });
            }
        }

        // Remove extra drivers if we reduced the count
        if (sortedExisting.length > driverCount) {
            const toRemove = sortedExisting.slice(driverCount);
            for (const driver of toRemove) {
                // Remove stops from this driver first
                await supabase
                    .from('drivers')
                    .update({ stop_ids: [] })
                    .eq('id', driver.id);
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

            await supabase
                .from('drivers')
                .update({ stop_ids: driverStops })
                .eq('id', driver.id);
        }

        // Re-fetch to get actual stop_ids after distribution
        const { data: updatedDrivers } = await supabase
            .from('drivers')
            .select('id, name, color, stop_ids')
            .eq('day', day)
            .in('id', drivers.map(d => d.id));

        // Sort by driver number manually since Supabase doesn't support complex ORDER BY
        const sortedDrivers = (updatedDrivers || []).sort((a, b) => {
            const parseNum = (name: string) => {
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

