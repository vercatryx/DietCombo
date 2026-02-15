// app/api/route/reorder-route/route.ts
// Phase 7.1: Reorder a client within a driver's route (driver_route_order.position).
// Duplicate positions allowed; tie-breaker is ORDER BY position, client_id.

import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { driver_id, client_id, new_position } = body;

        if (!driver_id || !client_id || new_position == null) {
            return NextResponse.json(
                { error: "driver_id, client_id, and new_position are required" },
                { status: 400 }
            );
        }
        const position = Number(new_position);
        if (!Number.isInteger(position) || position < 0) {
            return NextResponse.json(
                { error: "new_position must be a non-negative integer" },
                { status: 400 }
            );
        }

        const { error } = await supabase
            .from("driver_route_order")
            .update({ position })
            .eq("driver_id", driver_id)
            .eq("client_id", client_id);

        if (error) {
            console.error("[reorder-route] Error updating position:", error);
            return NextResponse.json(
                { error: `Failed to reorder: ${error.message}` },
                { status: 500 }
            );
        }

        return NextResponse.json({ ok: true });
    } catch (e) {
        console.error("[reorder-route] Error", e);
        return NextResponse.json(
            { error: e instanceof Error ? e.message : "Reorder failed" },
            { status: 500 }
        );
    }
}
