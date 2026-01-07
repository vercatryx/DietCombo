export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { query } from "@/lib/mysql";

function normalizeDay(raw?: string | null) {
    const s = String(raw ?? "all").toLowerCase().trim();
    const days = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday","all"];
    return days.includes(s) ? s : "all";
}

export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => ({}));
        const driverId = body?.driverId ? String(body.driverId) : null;
        const day = normalizeDay(body?.day);
        const clearProof = Boolean(body?.clearProof);

        if (!driverId) {
            return NextResponse.json(
                { error: "driverId is required" },
                { status: 400 }
            );
        }

        // Get the driver
        const drivers = await query<any[]>(`
            SELECT id, stop_ids FROM drivers
            WHERE id = ? AND day = ?
        `, [driverId, day]);

        if (drivers.length === 0) {
            return NextResponse.json(
                { error: "Driver not found" },
                { status: 404 }
            );
        }

        const driver = drivers[0];
        const stopIds = Array.isArray(driver.stop_ids) 
            ? driver.stop_ids 
            : (typeof driver.stop_ids === "string" ? JSON.parse(driver.stop_ids || "[]") : []);

        // Clear stops from driver
        await query(`
            UPDATE drivers
            SET stop_ids = ?
            WHERE id = ?
        `, [JSON.stringify([]), driverId]);

        // Clear assigned_driver_id from stops
        if (Array.isArray(stopIds) && stopIds.length > 0) {
            await query(`
                UPDATE stops
                SET assigned_driver_id = NULL
                WHERE id IN (${stopIds.map(() => "?").join(",")})
            `, stopIds);
        }

        // Optionally clear proof URLs
        if (clearProof && Array.isArray(stopIds) && stopIds.length > 0) {
            await query(`
                UPDATE stops
                SET proof_url = NULL, completed = FALSE
                WHERE id IN (${stopIds.map(() => "?").join(",")})
            `, stopIds);
        }

        return NextResponse.json(
            { 
                success: true, 
                message: `Routes reset for driver ${driverId}`,
                stopsCleared: Array.isArray(stopIds) ? stopIds.length : 0
            },
            { headers: { "Cache-Control": "no-store" } }
        );
    } catch (e: any) {
        console.error("[/api/route/reset] error:", e);
        return NextResponse.json(
            { error: e?.message || "Server error" },
            { status: 500 }
        );
    }
}

