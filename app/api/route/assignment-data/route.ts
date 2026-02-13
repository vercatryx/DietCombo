export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

/**
 * Lightweight endpoint for Routes page: clients (with assigned_driver_id) + driver id → name (+ color).
 * All filtering is done in the DB. Used by Client Assignment tab and Orders View (with orders-for-date).
 */
export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const day = (searchParams.get("day") || "all").toLowerCase();

        // 1) Clients: only columns needed for assignment, filter paused/delivery in DB
        const clientsQuery = supabase
            .from("clients")
            .select(
                "id, first_name, last_name, full_name, address, apt, city, state, zip, phone_number, lat, lng, paused, delivery, assigned_driver_id"
            )
            .eq("paused", false)
            .or("delivery.is.null,delivery.eq.true")
            .order("id", { ascending: true });

        const { data: clientsRows, error: clientsError } = await clientsQuery;

        if (clientsError) {
            console.error("[/api/route/assignment-data] clients error:", clientsError);
            return NextResponse.json(
                { error: clientsError.message },
                { status: 500 }
            );
        }

        const clients = (clientsRows || []).map((c: any) => ({
            id: c.id,
            first: c.first_name ?? "",
            last: c.last_name ?? "",
            name: c.full_name ?? "",
            full_name: c.full_name ?? "",
            address: c.address ?? "",
            apt: c.apt ?? null,
            city: c.city ?? "",
            state: c.state ?? "",
            zip: c.zip ?? "",
            phone: c.phone_number ?? null,
            lat: c.lat != null ? Number(c.lat) : null,
            lng: c.lng != null ? Number(c.lng) : null,
            paused: Boolean(c.paused),
            delivery: c.delivery !== undefined ? Boolean(c.delivery) : true,
            assigned_driver_id: c.assigned_driver_id ?? null,
            assignedDriverId: c.assigned_driver_id ?? null,
        }));

        // 2) Drivers: id + name + color from drivers and routes tables (DB-side)
        let driversQuery = supabase
            .from("drivers")
            .select("id, name, color")
            .order("id", { ascending: true });
        if (day !== "all") {
            driversQuery = driversQuery.eq("day", day);
        }
        const { data: driversRows } = await driversQuery;

        const { data: routesRows } = await supabase
            .from("routes")
            .select("id, name, color")
            .order("id", { ascending: true });

        const driverList: { id: string; name: string; color: string | null }[] = [];
        const seen = new Set<string>();
        const palette = [
            "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd",
            "#8c564b", "#e377c2", "#17becf", "#bcbd22", "#393b79",
        ];
        (driversRows || []).forEach((d: any, i: number) => {
            const id = String(d.id);
            if (seen.has(id)) return;
            seen.add(id);
            driverList.push({
                id,
                name: d.name || `Driver ${i}`,
                color: d.color && d.color !== "#666" ? d.color : palette[driverList.length % palette.length],
            });
        });
        (routesRows || []).forEach((r: any, i: number) => {
            const id = String(r.id);
            if (seen.has(id)) return;
            seen.add(id);
            driverList.push({
                id,
                name: r.name || `Route ${i}`,
                color: r.color && r.color !== "#666" ? r.color : palette[driverList.length % palette.length],
            });
        });

        return NextResponse.json(
            { clients, drivers: driverList },
            { headers: { "Cache-Control": "no-store" } }
        );
    } catch (e: any) {
        console.error("[/api/route/assignment-data] error:", e);
        return NextResponse.json(
            { error: e?.message ?? "Unknown error" },
            { status: 500 }
        );
    }
}
