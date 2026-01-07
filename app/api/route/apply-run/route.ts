export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { query } from "@/lib/mysql";

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
        const runs = await query<any[]>(`
            SELECT id, day, snapshot FROM route_runs
            WHERE id = ?
        `, [runId]);

        if (runs.length === 0) {
            return NextResponse.json(
                { error: "Route run not found" },
                { status: 404 }
            );
        }

        const run = runs[0];
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
            const existingDrivers = await query<any[]>(`
                SELECT id FROM drivers
                WHERE id = ? AND day = ?
            `, [driverId, day]);

            if (existingDrivers.length > 0) {
                // Update existing driver
                await query(`
                    UPDATE drivers
                    SET stop_ids = ?, name = ?, color = ?
                    WHERE id = ?
                `, [
                    JSON.stringify(stopIds),
                    driverSnapshot.driverName || `Driver ${driverSnapshot.driverId}`,
                    driverSnapshot.color || null,
                    driverId
                ]);
            } else {
                // Create new driver (shouldn't happen often, but handle it)
                const { v4: uuidv4 } = await import("uuid");
                await query(`
                    INSERT INTO drivers (id, day, name, color, stop_ids)
                    VALUES (?, ?, ?, ?, ?)
                `, [
                    driverId,
                    day,
                    driverSnapshot.driverName || `Driver ${driverSnapshot.driverId}`,
                    driverSnapshot.color || null,
                    JSON.stringify(stopIds)
                ]);
            }

            // Update stops to point to this driver
            if (stopIds.length > 0) {
                // First, clear all stops for this day that were assigned to other drivers
                // Then assign stops to this driver
                await query(`
                    UPDATE stops
                    SET assigned_driver_id = ?
                    WHERE id IN (${stopIds.map(() => "?").join(",")})
                `, [driverId, ...stopIds]);
            }
        }

        // Clear stops from drivers not in snapshot
        const snapshotDriverIds = snapshot.map((s: any) => String(s.driverId)).filter(Boolean);
        if (snapshotDriverIds.length > 0) {
            await query(`
                UPDATE drivers
                SET stop_ids = ?
                WHERE day = ? AND id NOT IN (${snapshotDriverIds.map(() => "?").join(",")})
            `, [JSON.stringify([]), day, ...snapshotDriverIds]);
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

