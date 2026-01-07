// app/api/mobile/stops/route.ts
import { NextResponse } from "next/server";
import { query } from "@/lib/mysql";

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
        const drivers = await query<any[]>(
            `SELECT stop_ids FROM drivers WHERE id = ?`,
            [driverId]
        );
        const driver = drivers[0];

        // Keep stop_ids as strings (UUIDs) - don't convert to numbers
        const orderedIds: string[] = driver?.stop_ids
            ? (Array.isArray(driver.stop_ids) ? driver.stop_ids : JSON.parse(driver.stop_ids))
                .map((id: any) => String(id))
                .filter((id: string) => id && id.trim().length > 0)
            : [];

        if (!orderedIds.length) {
            // No stops for this driver — return empty array (contract expects an array)
            return NextResponse.json([], { headers: { "Cache-Control": "no-store" } });
        }

        // Get those stops (optionally constrained by day)
        const stopWhere = whereClause 
            ? `${whereClause} AND id IN (${orderedIds.map(() => "?").join(",")})`
            : `WHERE id IN (${orderedIds.map(() => "?").join(",")})`;
        const stopParams = [...whereParams, ...orderedIds];

        const stops = await query<any[]>(
            `SELECT id, client_id as userId, name, address, apt, city, state, zip, phone, lat, lng, \`order\`, completed, proof_url as proofUrl
             FROM stops ${stopWhere}`,
            stopParams
        );

        // Reorder to match Driver.stopIds order (keep IDs as strings for comparison)
        const byId = new Map(stops.map((s) => [String(s.id), s]));
        const ordered = orderedIds.map((id) => byId.get(id)).filter(Boolean);

        // Map to expected format (keep id as string if it's a UUID, or convert if it's numeric)
        const mapped = ordered.map((s: any) => ({
            id: String(s.id), // Keep as string for UUID compatibility
            userId: s.userId,
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
            proofUrl: s.proofUrl,
        }));

        console.log("[/api/mobile/stops] return (by driver):", mapped.length); // DEBUG
        return NextResponse.json(mapped, { headers: { "Cache-Control": "no-store" } });
    }

    // No driverId → return ALL stops for the day (flat array), ordered for stable UI
    const orderBy = whereClause ? "ORDER BY assigned_driver_id ASC, `order` ASC, id ASC" : "ORDER BY assigned_driver_id ASC, `order` ASC, id ASC";
    const all = await query<any[]>(
        `SELECT id, client_id as userId, name, address, apt, city, state, zip, phone, lat, lng, \`order\`, completed, proof_url as proofUrl
         FROM stops ${whereClause} ${orderBy}`,
        whereParams
    );

    // Map to expected format (keep id as string for UUID compatibility)
    const mapped = all.map((s: any) => ({
        id: String(s.id), // Keep as string for UUID compatibility
        userId: s.userId,
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
        proofUrl: s.proofUrl,
    }));

    console.log("[/api/mobile/stops] return (all day):", mapped.length); // DEBUG
    return NextResponse.json(mapped, { headers: { "Cache-Control": "no-store" } });
}

