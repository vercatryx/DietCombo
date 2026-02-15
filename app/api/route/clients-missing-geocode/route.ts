export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

/**
 * Returns clients from the clients table that are missing lat/lng (for manual geocoding).
 * Excludes dependents (parent_client_id set) – only standalone/parent clients need geocoding.
 * Same filters as assignment: not paused, delivery true or null.
 */
export async function GET() {
    try {
        const { data: rows, error } = await supabase
            .from("clients")
            .select(
                "id, first_name, last_name, full_name, address, apt, city, state, zip, lat, lng"
            )
            .eq("paused", false)
            .or("delivery.is.null,delivery.eq.true")
            .or("lat.is.null,lng.is.null")
            .is("parent_client_id", null)
            .order("id", { ascending: true });

        if (error) {
            console.error("[/api/route/clients-missing-geocode] error:", error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        const rawRows = rows || [];
        const str = (v: unknown): string => (v != null && v !== "" ? String(v).trim() : "");
        // Read any column from row (clients table: address, city, state, zip) – match key case-insensitively
        const get = (r: Record<string, unknown>, col: string): string => {
            const val = r[col];
            if (val != null && val !== "") return String(val).trim();
            const key = Object.keys(r).find((k) => k.toLowerCase() === col.toLowerCase());
            return key != null ? str(r[key]) : "";
        };

        const clients = rawRows.map((c: Record<string, unknown>) => ({
            id: c.id,
            first: get(c, "first_name"),
            last: get(c, "last_name"),
            first_name: get(c, "first_name"),
            last_name: get(c, "last_name"),
            full_name: get(c, "full_name"),
            name: get(c, "full_name"),
            address: get(c, "address"),
            apt: c.apt != null && c.apt !== "" ? String(c.apt) : null,
            city: get(c, "city"),
            state: get(c, "state"),
            zip: get(c, "zip"),
            lat: c.lat != null ? Number(c.lat) : null,
            lng: c.lng != null ? Number(c.lng) : null,
        }));

        return NextResponse.json(
            { clients },
            { headers: { "Cache-Control": "no-store" } }
        );
    } catch (e: unknown) {
        console.error("[/api/route/clients-missing-geocode] error:", e);
        return NextResponse.json(
            { error: e instanceof Error ? e.message : "Unknown error" },
            { status: 500 }
        );
    }
}
