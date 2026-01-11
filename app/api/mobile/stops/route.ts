// app/api/mobile/stops/route.ts
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * GET /api/mobile/stops?driverId=123&day=all
 *
 * - If driverId is provided: returns that driver's stops (ordered), as a flat array.
 * - If driverId is omitted: returns all stops for the day (ordered), as a flat array.
 * - Optional ?day= (default "all") narrows by Stop.day when returning all or driver-filtered stops.
 *
 * Response: Stop[] (no wrapper object) — matches existing lib/api.js callers.
 */
export async function GET(req: Request) {
    const url = new URL(req.url);
    const day = (url.searchParams.get("day") ?? "all").toLowerCase();
    const driverIdParam = url.searchParams.get("driverId");

    console.log("[/api/mobile/stops] GET", { day, driverIdParam }); // DEBUG

    // Build base where clause
    let whereClause = "";
    const whereParams: any[] = [];
    if (day !== "all") {
        whereClause = "WHERE day = ?";
        whereParams.push(day);
    }

    // If driverId provided, prefer using Driver.stopIds to preserve intended order
    if (driverIdParam) {
        const driverId = driverIdParam;
        if (!driverId) {
            return NextResponse.json({ error: "Invalid driverId" }, { status: 400 });
        }

        // Fetch driver's ordered stopIds
        const { data: driverData } = await supabase
            .from('drivers')
            .select('stop_ids')
            .eq('id', driverId)
            .single();
        const driver = driverData;

        // Keep stop_ids as strings (UUIDs) - don't convert to numbers
        const orderedIds: string[] = driver?.stop_ids
            ? (Array.isArray(driver.stop_ids) ? driver.stop_ids : (typeof driver.stop_ids === 'string' ? JSON.parse(driver.stop_ids) : []))
                .map((id: any) => String(id))
                .filter((id: string) => id && id.trim().length > 0)
            : [];

        if (!orderedIds.length) {
            // No stops for this driver — return empty array (contract expects an array)
            return NextResponse.json([], { headers: { "Cache-Control": "no-store" } });
        }

        // Get those stops (optionally constrained by day)
        let stopsQuery = supabase
            .from('stops')
            .select('id, client_id, name, address, apt, city, state, zip, phone, lat, lng, order, completed, proof_url')
            .in('id', orderedIds);
        
        if (day !== "all") {
            stopsQuery = stopsQuery.eq('day', day);
        }

        const { data: stops } = await stopsQuery;

        // Reorder to match Driver.stopIds order (keep IDs as strings for comparison)
        const byId = new Map(stops.map((s) => [String(s.id), s]));
        const ordered = orderedIds.map((id) => byId.get(id)).filter(Boolean);

        // Map to expected format (keep id as string if it's a UUID, or convert if it's numeric)
        const mapped = ordered.map((s: any) => ({
            id: String(s.id), // Keep as string for UUID compatibility
            userId: s.client_id,
            name: s.name,
            address: s.address,
            apt: s.apt,
            city: s.city,
            state: s.state,
            zip: s.zip,
            phone: s.phone,
            lat: s.lat ? Number(s.lat) : null,
            lng: s.lng ? Number(s.lng) : null,
            order: s.order ? Number(s.order) : null,
            completed: Boolean(s.completed),
            proofUrl: s.proof_url,
        }));

        console.log("[/api/mobile/stops] return (by driver):", mapped.length); // DEBUG
        return NextResponse.json(mapped, { headers: { "Cache-Control": "no-store" } });
    }

    // No driverId → return ALL stops for the day (flat array), ordered for stable UI
    let allQuery = supabase
        .from('stops')
        .select('id, client_id, name, address, apt, city, state, zip, phone, lat, lng, order, completed, proof_url')
        .order('assigned_driver_id', { ascending: true })
        .order('order', { ascending: true })
        .order('id', { ascending: true });
    
    if (day !== "all") {
        allQuery = allQuery.eq('day', day);
    }

    const { data: all } = await allQuery;

    // Map to expected format (keep id as string for UUID compatibility)
    const mapped = (all || []).map((s: any) => ({
        id: String(s.id), // Keep as string for UUID compatibility
        userId: s.client_id,
        name: s.name,
        address: s.address,
        apt: s.apt,
        city: s.city,
        state: s.state,
        zip: s.zip,
        phone: s.phone,
        lat: s.lat ? Number(s.lat) : null,
        lng: s.lng ? Number(s.lng) : null,
        order: s.order ? Number(s.order) : null,
        completed: Boolean(s.completed),
        proofUrl: s.proof_url,
    }));

    console.log("[/api/mobile/stops] return (all day):", mapped.length); // DEBUG
    return NextResponse.json(mapped, { headers: { "Cache-Control": "no-store" } });
}

