export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { query } from "@/lib/mysql";
import { v4 as uuidv4 } from "uuid";

const sid = (v: unknown) => (v === null || v === undefined ? "" : String(v));

/** Extract numeric from "Driver X"; unknowns go to end */
function driverRankByName(name: unknown) {
    const m = /driver\s+(\d+)/i.exec(String(name || ""));
    return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
}

/** Coerce number | string | null -> number | null */
function toNum(v: unknown): number | null {
    if (v == null) return null;
    const n = Number(v as any);
    return Number.isFinite(n) ? n : null;
}

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const day = (searchParams.get("day") || "all").toLowerCase();

        // 1) Drivers filtered by day (if not "all")
        const driverWhere = day === "all" ? "" : `WHERE day = ?`;
        const driverParams = day === "all" ? [] : [day];
        const driversRaw = await query<any[]>(
            `SELECT * FROM drivers ${driverWhere} ORDER BY id ASC`,
            driverParams
        );
        
        // Also check routes table (legacy table without day field)
        // Routes table records are treated as applicable to all days
        const routesRaw = await query<any[]>(
            `SELECT * FROM routes ORDER BY id ASC`
        );
        
        // Convert routes to drivers format (add day field, default to "all" or current day)
        const routesAsDrivers = routesRaw.map((r: any) => ({
            ...r,
            day: day === "all" ? "all" : day, // Use current day or "all" if querying all
        }));
        
        // Combine drivers and routes
        const allDriversRaw = [...driversRaw, ...routesAsDrivers];
        
        // Debug logging
        console.log(`[route/routes] Querying drivers for day="${day}"`);
        console.log(`[route/routes] Query: SELECT * FROM drivers ${driverWhere}`);
        console.log(`[route/routes] Found ${driversRaw?.length || 0} drivers in database`);
        console.log(`[route/routes] Found ${routesRaw?.length || 0} routes in routes table`);
        if (driversRaw && driversRaw.length > 0) {
            console.log(`[route/routes] Driver names:`, driversRaw.map(d => d.name));
        }
        if (routesRaw && routesRaw.length > 0) {
            console.log(`[route/routes] Route names:`, routesRaw.map(r => r.name));
        }

        // 2) All stops (do NOT filter by day; legacy rows may not have it)
        const allStops = await query<any[]>(`
            SELECT id, client_id as userId, address, apt, city, state, zip, phone, lat, lng, dislikes
            FROM stops
            ORDER BY id ASC
        `);

        // 3) Fetch all Clients for the clientIds we saw in stops
        const clientIdSet = new Set<string>();
        for (const s of allStops) if (s.userId) clientIdSet.add(String(s.userId));
        const clientIds = Array.from(clientIdSet);

        const clients = clientIds.length
            ? await query<any[]>(`
                SELECT id, first_name as first, last_name as last, address, apt, city, state, zip, phone, lat, lng, dislikes, paused, delivery
                FROM clients
                WHERE id IN (${clientIds.map(() => "?").join(",")})
            `, clientIds)
            : [];

        const clientById = new Map(clients.map((c) => [c.id, c]));

        // Get schedules for clients
        const schedulesMap = new Map<string, any>();
        if (clientIds.length) {
            const schedules = await query<any[]>(`
                SELECT client_id, monday, tuesday, wednesday, thursday, friday, saturday, sunday
                FROM schedules
                WHERE client_id IN (${clientIds.map(() => "?").join(",")})
            `, clientIds);
            for (const s of schedules) {
                schedulesMap.set(s.client_id, s);
            }
        }

        // 4) Sort drivers so Driver 0,1,2… are in that order
        const drivers = [...allDriversRaw].sort(
            (a, b) => driverRankByName(a.name) - driverRankByName(b.name)
        );
        
        console.log(`[route/routes] After sorting: ${drivers.length} drivers (${driversRaw.length} from drivers table, ${routesRaw.length} from routes table)`);

        // 5) Hydrate each stop, preferring live Client fields when available
        const stopById = new Map<string, any>();

        for (const s of allStops) {
            const c = s.userId ? clientById.get(s.userId) : undefined;
            const name =
                c ? `${c.first || ""} ${c.last || ""}`.trim() : "(Unnamed)";

            // prefer live client value; fall back to stop's denorm
            const dislikes = c?.dislikes ?? s.dislikes ?? "";

            stopById.set(sid(s.id), {
                id: s.id,
                userId: s.userId ?? null,
                name,

                // prefer live client fields; fallback to stop's denorm copies
                address: (c?.address ?? s.address ?? "") as string,
                apt: (c?.apt ?? s.apt ?? "") as string,
                city: (c?.city ?? s.city ?? "") as string,
                state: (c?.state ?? s.state ?? "") as string,
                zip: (c?.zip ?? s.zip ?? "") as string,
                phone: (c?.phone ?? s.phone ?? "") as string,

                lat: toNum(c?.lat ?? s.lat),
                lng: toNum(c?.lng ?? s.lng),

                // ensure labels receive dislikes at the top level
                dislikes: typeof dislikes === "string" ? dislikes.trim() : "",
            });
        }

        // 6) Build driver routes strictly from their stopIds
        const routes = drivers.map((d) => {
            const stopIds = Array.isArray(d.stop_ids) ? d.stop_ids : (typeof d.stop_ids === "string" ? JSON.parse(d.stop_ids) : []);
            const ids: any[] = Array.isArray(stopIds) ? stopIds : [];
            const stops: any[] = [];
            for (const raw of ids) {
                const hyd = stopById.get(sid(raw));
                if (hyd) stops.push(hyd);
            }
            return {
                driverId: d.id,
                driverName: d.name,
                color: d.color,
                stops,
            };
        });
        
        console.log(`[route/routes] Built ${routes.length} routes with ${routes.reduce((sum, r) => sum + r.stops.length, 0)} total stops`);

        // 7) Unrouted = all hydrated stops not referenced by any driver's current list
        const claimed = new Set(routes.flatMap((r) => r.stops.map((s) => sid(s.id))));
        const unrouted: any[] = [];
        for (const [k, v] of stopById.entries()) {
            if (!claimed.has(k)) unrouted.push(v);
        }

        // 8) Check clients without stops, create missing stops, and log reasons
        const allClients = await query<any[]>(`
            SELECT id, first_name as first, last_name as last, address, apt, city, state, zip, phone, lat, lng, paused, delivery
            FROM clients
            ORDER BY id ASC
        `);

        // Check which clients have stops for THIS day
        const dayWhere = day === "all" ? "" : `WHERE day = ?`;
        const dayParams = day === "all" ? [] : [day];
        const stopsForDay = await query<any[]>(
            `SELECT client_id FROM stops ${dayWhere}`,
            dayParams
        );
        const clientsWithStops = new Set<string>();
        for (const s of stopsForDay) {
            if (s.client_id) {
                clientsWithStops.add(String(s.client_id));
            }
        }

        const isDeliverable = (c: any) => {
            const v = c?.delivery;
            return v === undefined || v === null ? true : Boolean(v);
        };

        const isOnDay = (c: any, dayValue: string) => {
            if (dayValue === "all") return true;
            const sc = schedulesMap.get(c.id);
            if (!sc) return true; // back-compat
            const dayMap: Record<string, string> = {
                monday: "monday",
                tuesday: "tuesday",
                wednesday: "wednesday",
                thursday: "thursday",
                friday: "friday",
                saturday: "saturday",
                sunday: "sunday",
            };
            return !!sc[dayMap[dayValue]];
        };

        const s = (v: unknown) => (v == null ? "" : String(v));
        const n = (v: unknown) => (typeof v === "number" ? v : null);

        // Build list of clients without stops and their reasons
        // Also create stops for clients who should have them
        const usersWithoutStops: Array<{ id: string; name: string; reason: string }> = [];
        const stopsToCreate: Array<{
            id: string;
            day: string;
            client_id: string;
            name: string;
            address: string;
            apt: string | null;
            city: string;
            state: string;
            zip: string;
            phone: string | null;
            lat: number | null;
            lng: number | null;
        }> = [];

        for (const client of allClients) {
            if (!clientsWithStops.has(String(client.id))) {
                const reasons: string[] = [];
                
                if (client.paused) {
                    reasons.push("paused");
                }
                if (!isDeliverable(client)) {
                    reasons.push("delivery off");
                }
                if (!isOnDay(client, day)) {
                    reasons.push(`not on schedule (${day})`);
                }
                
                const name = `${client.first || ""} ${client.last || ""}`.trim() || "Unnamed";
                
                // If client should have a stop (no valid reasons), create it
                if (reasons.length === 0) {
                    stopsToCreate.push({
                        id: uuidv4(),
                        day: day,
                        client_id: String(client.id),
                        name: name || "(Unnamed)",
                        address: s(client.address),
                        apt: client.apt ? s(client.apt) : null,
                        city: s(client.city),
                        state: s(client.state),
                        zip: s(client.zip),
                        phone: client.phone ? s(client.phone) : null,
                        lat: n(client.lat),
                        lng: n(client.lng),
                    });
                } else {
                    // Client has a valid reason for not having a stop, log it
                    const reason = reasons.join(", ");
                    usersWithoutStops.push({ id: String(client.id), name, reason });
                }
            }
        }

        // Create missing stops for clients who should have them
        if (stopsToCreate.length > 0) {
            // Add clients who are getting stops created to the response for logging
            for (const stopData of stopsToCreate) {
                usersWithoutStops.push({ 
                    id: stopData.client_id, 
                    name: stopData.name, 
                    reason: "creating stop now" 
                });
            }
            
            try {
                // Insert stops one at a time to handle duplicates gracefully
                for (const stopData of stopsToCreate) {
                    try {
                        await query(`
                            INSERT INTO stops (id, day, client_id, name, address, apt, city, state, zip, phone, lat, lng)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            ON DUPLICATE KEY UPDATE name = VALUES(name)
                        `, [
                            stopData.id,
                            stopData.day,
                            stopData.client_id,
                            stopData.name,
                            stopData.address,
                            stopData.apt,
                            stopData.city,
                            stopData.state,
                            stopData.zip,
                            stopData.phone,
                            stopData.lat,
                            stopData.lng,
                        ]);
                    } catch (createError: any) {
                        // Skip if stop already exists
                        if (createError?.code !== "ER_DUP_ENTRY") {
                            console.error(`[route/routes] Failed to create stop for client ${stopData.client_id}:`, createError?.message);
                        }
                    }
                }
            } catch (e: any) {
                console.warn(`[route/routes] Error creating stops:`, e?.message);
            }
        }

        console.log(`[route/routes] Returning ${routes.length} routes, ${unrouted.length} unrouted stops`);
        
        return NextResponse.json(
            { routes, unrouted, usersWithoutStops },
            { headers: { "Cache-Control": "no-store" } }
        );
    } catch (e: any) {
        console.error("routes GET error", e);
        // Return empty set so UI doesn't crash
        return NextResponse.json({ routes: [], unrouted: [] }, { status: 200 });
    }
}

