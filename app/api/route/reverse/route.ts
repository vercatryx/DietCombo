// app/api/route/reverse/route.ts
// Reverses route order: prefers driver_route_order (source of truth); fallback drivers.stop_ids.
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const routeId = body?.routeId;

        if (!routeId) {
            return NextResponse.json({ ok: false, error: "Missing routeId" }, { status: 400 });
        }

        const driverId = String(routeId);

        // 1) Reverse driver_route_order (source of truth for route order)
        const { data: orderRows } = await supabase
            .from("driver_route_order")
            .select("driver_id, client_id, position")
            .eq("driver_id", driverId)
            .order("position", { ascending: true })
            .order("client_id", { ascending: true });

        if (orderRows && orderRows.length > 0) {
            const reversed = [...orderRows].reverse();
            for (let i = 0; i < reversed.length; i++) {
                const row = reversed[i];
                await supabase
                    .from("driver_route_order")
                    .update({ position: i })
                    .eq("driver_id", String(row.driver_id))
                    .eq("client_id", String(row.client_id));
            }
            return NextResponse.json({
                ok: true,
                message: `Reversed ${reversed.length} stops (driver_route_order)`,
            });
        }

        // 2) Fallback: legacy drivers.stop_ids
        const { data: driver } = await supabase
            .from("drivers")
            .select("stop_ids, day")
            .eq("id", driverId)
            .single();

        if (!driver) {
            const { data: routeRow } = await supabase.from("routes").select("stop_ids").eq("id", driverId).maybeSingle();
            if (!routeRow) {
                return NextResponse.json({ ok: false, error: "Driver not found" }, { status: 404 });
            }
            const stopIds = Array.isArray(routeRow.stop_ids)
                ? routeRow.stop_ids
                : (typeof routeRow.stop_ids === "string" ? JSON.parse(routeRow.stop_ids || "[]") : []);
            if (stopIds.length === 0) {
                return NextResponse.json({ ok: true, message: "No stops to reverse" });
            }
            const reversed = [...stopIds].reverse();
            await supabase.from("routes").update({ stop_ids: reversed }).eq("id", driverId);
            return NextResponse.json({ ok: true, message: `Reversed ${reversed.length} stops` });
        }

        const stopIds = Array.isArray(driver.stop_ids)
            ? driver.stop_ids
            : (typeof driver.stop_ids === "string" ? JSON.parse(driver.stop_ids || "[]") : []);

        if (stopIds.length === 0) {
            return NextResponse.json({ ok: true, message: "No stops to reverse" });
        }

        const reversed = [...stopIds].reverse();
        await supabase.from("drivers").update({ stop_ids: reversed }).eq("id", driverId);

        return NextResponse.json({ ok: true, message: `Reversed ${reversed.length} stops` });
    } catch (error: any) {
        console.error("[route/reverse] error:", error);
        return NextResponse.json({
            ok: false,
            error: error.message || "Failed to reverse route",
        }, { status: 500 });
    }
}

