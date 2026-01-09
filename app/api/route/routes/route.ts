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
                SELECT id, first_name as first, last_name as last, address, apt, city, state, zip, phone_number as phone, lat, lng, dislikes, paused, delivery
                FROM clients
                WHERE id IN (${clientIds.map(() => "?").join(",")})
            `, clientIds)
            : [];

        const clientById = new Map(clients.map((c) => [c.id, c]));

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
        // NEW APPROACH: Use orders to determine which clients need stops, not schedules
        const allClients = await query<any[]>(`
            SELECT id, first_name as first, last_name as last, address, apt, city, state, zip, phone_number as phone, lat, lng, paused, delivery
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

        // Get active orders to determine which clients need stops
        // Active order statuses: 'pending', 'scheduled', 'confirmed'
        const activeOrderStatuses = ["pending", "scheduled", "confirmed"];
        const placeholders = activeOrderStatuses.map(() => "?").join(",");
        
        // Get orders with scheduled_delivery_date and extract day of week
        // Also check delivery_day field if present
        const activeOrders = await query<any[]>(`
            SELECT 
                client_id,
                scheduled_delivery_date,
                delivery_day,
                status
            FROM orders
            WHERE status IN (${placeholders})
            AND (scheduled_delivery_date IS NOT NULL OR delivery_day IS NOT NULL)
        `, activeOrderStatuses);

        // Get upcoming_orders with delivery_day
        const upcomingOrders = await query<any[]>(`
            SELECT 
                client_id,
                delivery_day,
                status
            FROM upcoming_orders
            WHERE status = 'scheduled'
            AND delivery_day IS NOT NULL
        `);

        // Build map of client_id -> set of delivery days they have orders for
        const clientDeliveryDays = new Map<string, Set<string>>();
        
        // Helper to convert day name to lowercase
        const normalizeDay = (dayName: string | null): string | null => {
            if (!dayName) return null;
            return dayName.toLowerCase();
        };

        // Helper to get day of week from date
        const getDayOfWeek = (dateStr: string | null): string | null => {
            if (!dateStr) return null;
            try {
                const date = new Date(dateStr);
                const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
                return dayNames[date.getDay()];
            } catch {
                return null;
            }
        };

        // Process active orders
        for (const order of activeOrders) {
            const clientId = String(order.client_id);
            if (!clientDeliveryDays.has(clientId)) {
                clientDeliveryDays.set(clientId, new Set());
            }
            const daysSet = clientDeliveryDays.get(clientId)!;
            
            // Use delivery_day if available, otherwise extract from scheduled_delivery_date
            if (order.delivery_day) {
                const normalizedDay = normalizeDay(order.delivery_day);
                if (normalizedDay) daysSet.add(normalizedDay);
            } else if (order.scheduled_delivery_date) {
                const dayOfWeek = getDayOfWeek(order.scheduled_delivery_date);
                if (dayOfWeek) daysSet.add(dayOfWeek);
            }
        }

        // Process upcoming orders
        for (const order of upcomingOrders) {
            const clientId = String(order.client_id);
            if (!clientDeliveryDays.has(clientId)) {
                clientDeliveryDays.set(clientId, new Set());
            }
            const daysSet = clientDeliveryDays.get(clientId)!;
            
            if (order.delivery_day) {
                const normalizedDay = normalizeDay(order.delivery_day);
                if (normalizedDay) daysSet.add(normalizedDay);
            }
        }

        const isDeliverable = (c: any) => {
            const v = c?.delivery;
            return v === undefined || v === null ? true : Boolean(v);
        };

        const hasOrderForDay = (clientId: string, dayValue: string): boolean => {
            if (dayValue === "all") return true; // For "all" day, check if client has any orders
            const daysSet = clientDeliveryDays.get(String(clientId));
            if (!daysSet || daysSet.size === 0) return false;
            return daysSet.has(dayValue.toLowerCase());
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
            const clientId = String(client.id);
            
            // Skip if client already has a stop for this day
            if (clientsWithStops.has(clientId)) {
                continue;
            }

            const reasons: string[] = [];
            
            if (client.paused) {
                reasons.push("paused");
            }
            if (!isDeliverable(client)) {
                reasons.push("delivery off");
            }
            if (!hasOrderForDay(clientId, day)) {
                reasons.push(`no active order for ${day}`);
            }
            
            const name = `${client.first || ""} ${client.last || ""}`.trim() || "Unnamed";
            
            // If client should have a stop (no valid reasons), create it
            if (reasons.length === 0) {
                stopsToCreate.push({
                    id: uuidv4(),
                    day: day,
                    client_id: clientId,
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
                usersWithoutStops.push({ id: clientId, name, reason });
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

