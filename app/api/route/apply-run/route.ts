export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => ({}));
        // Check if runId exists and is not null/undefined (0 is a valid ID)
        if (body?.runId === undefined || body?.runId === null) {
            return NextResponse.json(
                { error: "runId is required" },
                { status: 400 }
            );
        }
        const runId = String(body.runId);

        // Get the route run
        const { data: run } = await supabase
            .from('route_runs')
            .select('id, day, snapshot')
            .eq('id', runId)
            .single();

        if (!run) {
            return NextResponse.json(
                { error: "Route run not found" },
                { status: 404 }
            );
        }
        const day = run.day || "all";
        const snapshot = typeof run.snapshot === "string" 
            ? JSON.parse(run.snapshot) 
            : (Array.isArray(run.snapshot) ? run.snapshot : []);

        if (!Array.isArray(snapshot)) {
            return NextResponse.json(
                { error: "Invalid snapshot format" },
                { status: 400 }
            );
        }

        // Apply snapshot to drivers
        for (const driverSnapshot of snapshot) {
            const driverId = driverSnapshot.driverId;
            const stopIds = Array.isArray(driverSnapshot.stopIds) ? driverSnapshot.stopIds : [];

            if (!driverId) continue;

            // Update or create driver
            const { data: existingDrivers } = await supabase
                .from('drivers')
                .select('id')
                .eq('id', driverId)
                .eq('day', day);

            if (existingDrivers && existingDrivers.length > 0) {
                // Update existing driver
                await supabase
                    .from('drivers')
                    .update({
                        stop_ids: stopIds,
                        name: driverSnapshot.driverName || `Driver ${driverSnapshot.driverId}`,
                        color: driverSnapshot.color || null
                    })
                    .eq('id', driverId);
            } else {
                // Create new driver (shouldn't happen often, but handle it)
                await supabase
                    .from('drivers')
                    .insert([{
                        id: driverId,
                        day,
                        name: driverSnapshot.driverName || `Driver ${driverSnapshot.driverId}`,
                        color: driverSnapshot.color || null,
                        stop_ids: stopIds
                    }]);
            }

            // Update stops to point to this driver
            if (stopIds.length > 0) {
                // First, clear all stops for this day that were assigned to other drivers
                // Then assign stops to this driver
                await supabase
                    .from('stops')
                    .update({ assigned_driver_id: driverId })
                    .in('id', stopIds);
            }
        }

        // Clear stops from drivers not in snapshot
        const snapshotDriverIds = snapshot.map((s: any) => String(s.driverId)).filter(Boolean);
        if (snapshotDriverIds.length > 0) {
            await supabase
                .from('drivers')
                .update({ stop_ids: [] })
                .eq('day', day)
                .not('id', 'in', `(${snapshotDriverIds.join(',')})`);
        }

        return NextResponse.json(
            { 
                success: true, 
                message: `Route run applied successfully`,
                driversUpdated: snapshot.length
            },
            { headers: { "Cache-Control": "no-store" } }
        );
    } catch (e: any) {
        console.error("[/api/route/apply-run] error:", e);
        return NextResponse.json(
            { error: e?.message || "Server error" },
            { status: 500 }
        );
    }
}

