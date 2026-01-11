export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

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

        if (!driverId) {
            return NextResponse.json(
                { error: "driverId is required" },
                { status: 400 }
            );
        }

        // Get the driver to check if it exists
        const { data: driver } = await supabase
            .from('drivers')
            .select('id, name, stop_ids')
            .eq('id', driverId)
            .eq('day', day)
            .single();

        if (!driver) {
            return NextResponse.json(
                { error: "Driver not found" },
                { status: 404 }
            );
        }

        const driverName = driver.name || "Unknown";

        // Check if it's Driver 0 (should not be removed)
        if (/driver\s+0/i.test(driverName)) {
            return NextResponse.json(
                { error: "Cannot remove Driver 0" },
                { status: 400 }
            );
        }

        // Get stop IDs from this driver
        const stopIds = Array.isArray(driver.stop_ids) 
            ? driver.stop_ids 
            : (typeof driver.stop_ids === "string" ? JSON.parse(driver.stop_ids || "[]") : []);

        // Clear assigned_driver_id from stops
        if (Array.isArray(stopIds) && stopIds.length > 0) {
            await supabase
                .from('stops')
                .update({ assigned_driver_id: null })
                .in('id', stopIds);
        }

        // Delete the driver
        await supabase
            .from('drivers')
            .delete()
            .eq('id', driverId);

        return NextResponse.json(
            { 
                success: true, 
                message: `Driver ${driverName} removed successfully`,
                stopsUnassigned: Array.isArray(stopIds) ? stopIds.length : 0
            },
            { headers: { "Cache-Control": "no-store" } }
        );
    } catch (e: any) {
        console.error("[/api/route/remove-driver] error:", e);
        return NextResponse.json(
            { error: e?.message || "Server error" },
            { status: 500 }
        );
    }
}

