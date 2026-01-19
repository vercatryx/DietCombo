export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
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
        const deliveryDate = searchParams.get("delivery_date") || null;

        // 1) Drivers filtered by day (if not "all")
        let driversQuery = supabase
            .from('drivers')
            .select('*')
            .order('id', { ascending: true });
        
        if (day !== "all") {
            driversQuery = driversQuery.eq('day', day);
        }
        
        const { data: driversRaw } = await driversQuery;
        
        // Also check routes table (legacy table without day field)
        // Routes table records are treated as applicable to all days
        const { data: routesRaw } = await supabase
            .from('routes')
            .select('*')
            .order('id', { ascending: true });
        
        // Convert routes to drivers format (add day field, default to "all" or current day)
        const routesAsDrivers = routesRaw.map((r: any) => ({
            ...r,
            day: day === "all" ? "all" : day, // Use current day or "all" if querying all
        }));
        
        // Combine drivers and routes
        const allDriversRaw = [...driversRaw, ...routesAsDrivers];
        
        // Debug logging
        console.log(`[route/routes] Querying drivers for day="${day}"`);
        console.log(`[route/routes] Found ${driversRaw?.length || 0} drivers in database`);
        console.log(`[route/routes] Found ${routesRaw?.length || 0} routes in routes table`);
        if (driversRaw && driversRaw.length > 0) {
            console.log(`[route/routes] Driver names:`, driversRaw.map(d => d.name));
        }
        if (routesRaw && routesRaw.length > 0) {
            console.log(`[route/routes] Route names:`, routesRaw.map(r => r.name));
        }

        // 2) All stops - filter by delivery_date if provided
        let stopsQuery = supabase
            .from('stops')
            .select('id, client_id, address, apt, city, state, zip, phone, lat, lng, dislikes, delivery_date, completed')
            .order('id', { ascending: true });
        
        // Filter by delivery_date if provided
        if (deliveryDate) {
            stopsQuery = stopsQuery.eq('delivery_date', deliveryDate);
        }
        
        const { data: allStops } = await stopsQuery;

        // 3) Fetch all Clients for the clientIds we saw in stops
        const clientIdSet = new Set<string>();
        for (const s of (allStops || [])) if (s.client_id) clientIdSet.add(String(s.client_id));
        const clientIds = Array.from(clientIdSet);

        const { data: clients } = clientIds.length > 0
            ? await supabase
                .from('clients')
                .select('id, first_name, last_name, address, apt, city, state, zip, phone_number, lat, lng, dislikes, paused, delivery, assigned_driver_id')
                .in('id', clientIds)
            : { data: [] };

        const clientById = new Map((clients || []).map((c) => [c.id, {
            ...c,
            first: c.first_name,
            last: c.last_name,
            phone: c.phone_number,
            assigned_driver_id: c.assigned_driver_id
        }]));

        // 4) Sort drivers so Driver 0,1,2… are in that order
        const drivers = [...allDriversRaw].sort(
            (a, b) => driverRankByName(a.name) - driverRankByName(b.name)
        );
        
        console.log(`[route/routes] After sorting: ${drivers.length} drivers (${driversRaw.length} from drivers table, ${routesRaw.length} from routes table)`);

        // 5) Fetch order information for all stops
        // Create a map keyed by "client_id|delivery_date" for exact matches, and "client_id" for fallback
        const orderMapByClientAndDate = new Map<string, any>(); // key: "client_id|delivery_date"
        const orderMapByClient = new Map<string, any>(); // key: "client_id" (fallback to most recent)
        
        if (clientIds.length > 0) {
            // Get all orders - expand status filter to include more statuses
            // Also check upcoming_orders table
            const { data: orders } = await supabase
                .from('orders')
                .select('id, client_id, created_at, scheduled_delivery_date, actual_delivery_date, status, case_id')
                .in('client_id', clientIds)
                .not('status', 'eq', 'cancelled')
                .order('created_at', { ascending: false });
            
            // Also check upcoming_orders
            const { data: upcomingOrders } = await supabase
                .from('upcoming_orders')
                .select('id, client_id, created_at, scheduled_delivery_date, actual_delivery_date, status, case_id')
                .in('client_id', clientIds)
                .not('status', 'eq', 'cancelled')
                .order('created_at', { ascending: false });
            
            console.log(`[route/routes] Found ${orders?.length || 0} orders and ${upcomingOrders?.length || 0} upcoming orders for ${clientIds.length} clients`);
            
            // Combine both order sources, prioritizing regular orders
            const allOrders = [...(orders || []), ...(upcomingOrders || [])];
            
            if (allOrders.length > 0) {
                // Helper to normalize date strings (handle both DATE and TIMESTAMP formats)
                const normalizeDate = (dateStr: string | null | undefined): string | null => {
                    if (!dateStr) return null;
                    // Handle both "YYYY-MM-DD" and "YYYY-MM-DDTHH:MM:SS" and "YYYY-MM-DD HH:MM:SS" formats
                    return dateStr.split('T')[0].split(' ')[0];
                };
                
                // Build maps: one for exact client_id + delivery_date matches, one for client_id fallback
                for (const order of allOrders) {
                    const cid = String(order.client_id);
                    
                    // Store most recent order per client (fallback)
                    if (!orderMapByClient.has(cid)) {
                        orderMapByClient.set(cid, order);
                    }
                    
                    // Store order by client_id + delivery_date for exact matching
                    const deliveryDateStr = normalizeDate(order.scheduled_delivery_date);
                    if (deliveryDateStr) {
                        const key = `${cid}|${deliveryDateStr}`;
                        // Prefer orders table over upcoming_orders if there's a conflict
                        if (!orderMapByClientAndDate.has(key)) {
                            orderMapByClientAndDate.set(key, order);
                        }
                    }
                }
                console.log(`[route/routes] Mapped ${orderMapByClientAndDate.size} orders by date and ${orderMapByClient.size} orders by client`);
            } else {
                console.warn(`[route/routes] No orders found for any of the ${clientIds.length} clients`);
            }
        }

        // 6) Hydrate each stop, preferring live Client fields when available
        const stopById = new Map<string, any>();

        for (const s of (allStops || [])) {
            const c = s.client_id ? clientById.get(s.client_id) : undefined;
            const name =
                c ? `${c.first || ""} ${c.last || ""}`.trim() : "(Unnamed)";

            // prefer live client value; fall back to stop's denorm
            const dislikes = c?.dislikes ?? s.dislikes ?? "";
            
            // Get order information for this stop
            // Try to match by client_id + delivery_date first, then fall back to client_id only
            let order = null;
            if (s.client_id) {
                const cid = String(s.client_id);
                
                // Helper to normalize date strings (handle both DATE and TIMESTAMP formats)
                const normalizeDate = (dateStr: string | null | undefined): string | null => {
                    if (!dateStr) return null;
                    // Handle both "YYYY-MM-DD" and "YYYY-MM-DDTHH:MM:SS" formats
                    return dateStr.split('T')[0].split(' ')[0];
                };
                
                // If stop has delivery_date, try exact match first
                if (s.delivery_date) {
                    const stopDeliveryDate = normalizeDate(s.delivery_date);
                    if (stopDeliveryDate) {
                        const exactKey = `${cid}|${stopDeliveryDate}`;
                        order = orderMapByClientAndDate.get(exactKey) || null;
                    }
                }
                
                // Fallback to most recent order for this client
                if (!order) {
                    order = orderMapByClient.get(cid) || null;
                }
            }

            stopById.set(sid(s.id), {
                id: s.id,
                userId: s.client_id ?? null,
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
                
                // Add completed status from stop
                completed: s.completed ?? false,
                
                // Add delivery_date from stop
                delivery_date: s.delivery_date || null,
                
                // Add order tracking fields including status
                orderId: order?.id || null,
                orderDate: order?.created_at || null,
                deliveryDate: order?.actual_delivery_date || order?.scheduled_delivery_date || null,
                orderStatus: order?.status || null,
            });
        }

        // 7) Build driver routes strictly from their stopIds
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

        // 8) Unrouted = all hydrated stops not referenced by any driver's current list
        const claimed = new Set(routes.flatMap((r) => r.stops.map((s) => sid(s.id))));
        const unrouted: any[] = [];
        for (const [k, v] of stopById.entries()) {
            if (!claimed.has(k)) unrouted.push(v);
        }

        // 9) Check clients without stops, create missing stops, and log reasons
        // NEW APPROACH: Use orders to determine which clients need stops, not schedules
        // Note: allClientsWithDriver is already fetched above, so we don't need to fetch again

        // Check which clients have stops for delivery dates
        // We need to check by delivery_date, not just day
        const { data: existingStops } = await supabase
            .from('stops')
            .select('client_id, delivery_date, day');
        
        // Build map of client_id -> Set of delivery dates they already have stops for
        const clientStopsByDate = new Map<string, Set<string>>();
        for (const s of (existingStops || [])) {
            if (s.client_id && s.delivery_date) {
                const clientId = String(s.client_id);
                if (!clientStopsByDate.has(clientId)) {
                    clientStopsByDate.set(clientId, new Set());
                }
                clientStopsByDate.get(clientId)!.add(s.delivery_date);
            }
        }

        // Fetch all clients with their assigned_driver_id for stop creation
        const { data: allClientsWithDriver } = await supabase
            .from('clients')
            .select('id, first_name, last_name, address, apt, city, state, zip, phone_number, lat, lng, paused, delivery, assigned_driver_id')
            .order('id', { ascending: true });
        
        // Create a map of client_id -> assigned_driver_id for quick lookup
        const clientDriverMap = new Map<string, string | null>();
        for (const c of (allClientsWithDriver || [])) {
            clientDriverMap.set(String(c.id), c.assigned_driver_id || null);
        }

        // Get active orders to determine which clients need stops
        // Active order statuses: 'pending', 'scheduled', 'confirmed'
        const activeOrderStatuses = ["pending", "scheduled", "confirmed"];
        
        // Get orders with scheduled_delivery_date
        const { data: activeOrders } = await supabase
            .from('orders')
            .select('id, client_id, scheduled_delivery_date, delivery_day, status, case_id')
            .in('status', activeOrderStatuses)
            .not('scheduled_delivery_date', 'is', null);

        // Get upcoming_orders with delivery_day or scheduled_delivery_date
        // When filtering by delivery_date, also fetch upcoming orders with matching scheduled_delivery_date
        let upcomingOrdersQuery = supabase
            .from('upcoming_orders')
            .select('id, client_id, delivery_day, scheduled_delivery_date, status, case_id')
            .eq('status', 'scheduled')
            .or('delivery_day.not.is.null,scheduled_delivery_date.not.is.null');
        
        const { data: upcomingOrders } = await upcomingOrdersQuery;
        
        // If filtering by delivery_date, also fetch upcoming orders with matching scheduled_delivery_date
        // This ensures we get all upcoming orders for that specific date
        let upcomingOrdersByDate: any[] = [];
        if (deliveryDate) {
            const { data: upcomingOrdersMatchingDate } = await supabase
                .from('upcoming_orders')
                .select('id, client_id, delivery_day, scheduled_delivery_date, status, case_id')
                .eq('status', 'scheduled')
                .eq('scheduled_delivery_date', deliveryDate);
            
            if (upcomingOrdersMatchingDate) {
                upcomingOrdersByDate = upcomingOrdersMatchingDate;
            }
        }
        
        // Combine both sets, removing duplicates
        const allUpcomingOrders = [...(upcomingOrders || []), ...upcomingOrdersByDate];
        const uniqueUpcomingOrders = Array.from(
            new Map(allUpcomingOrders.map(o => [o.id, o])).values()
        );
        
        console.log(`[route/routes] Found ${uniqueUpcomingOrders.length} upcoming orders (${upcomingOrders?.length || 0} general, ${upcomingOrdersByDate.length} matching delivery_date=${deliveryDate || 'none'})`);

        // Import getNextOccurrence for calculating delivery dates from delivery_day
        const { getNextOccurrence } = await import('@/lib/order-dates');
        const currentTime = new Date();

        // Build map of client_id -> Map of delivery_date -> order info
        // This allows multiple stops per client for different delivery dates
        const clientDeliveryDates = new Map<string, Map<string, { deliveryDate: string; dayOfWeek: string; orderId: string | null; caseId: string | null }>>();
        
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

        // Process active orders - use scheduled_delivery_date directly
        for (const order of activeOrders || []) {
            if (!order.scheduled_delivery_date) continue;
            
            const clientId = String(order.client_id);
            const deliveryDateStr = order.scheduled_delivery_date.split('T')[0]; // Get date part only
            const dayOfWeek = getDayOfWeek(order.scheduled_delivery_date);
            
            if (!dayOfWeek) continue;
            
            if (!clientDeliveryDates.has(clientId)) {
                clientDeliveryDates.set(clientId, new Map());
            }
            const datesMap = clientDeliveryDates.get(clientId)!;
            
            // Store delivery date info with order_id and case_id (allows multiple orders on same date, prefer first one)
            if (!datesMap.has(deliveryDateStr)) {
                datesMap.set(deliveryDateStr, { deliveryDate: deliveryDateStr, dayOfWeek, orderId: order.id, caseId: order.case_id || null });
            }
        }

        // Process upcoming orders - calculate delivery_date from delivery_day or use scheduled_delivery_date
        // Note: upcoming_orders don't have order_id in orders table yet, so we'll set order_id to null
        // The order will be created later and we can update the stop then
        // IMPORTANT: Always include upcoming orders with scheduled_delivery_date, especially when filtering by delivery_date
        for (const order of uniqueUpcomingOrders) {
            const clientId = String(order.client_id);
            let deliveryDateStr: string | null = null;
            let dayOfWeek: string | null = null;
            
            if (order.scheduled_delivery_date) {
                // Use scheduled_delivery_date if available (prioritize this)
                deliveryDateStr = order.scheduled_delivery_date.split('T')[0];
                dayOfWeek = getDayOfWeek(order.scheduled_delivery_date);
            } else if (order.delivery_day) {
                // Calculate next occurrence of delivery_day
                const nextDate = getNextOccurrence(order.delivery_day, currentTime);
                if (nextDate) {
                    deliveryDateStr = nextDate.toISOString().split('T')[0];
                    dayOfWeek = getDayOfWeek(deliveryDateStr);
                }
            }
            
            if (!deliveryDateStr || !dayOfWeek) continue;
            
            // If filtering by delivery_date, only include upcoming orders that match
            // Otherwise, include all upcoming orders
            if (deliveryDate && deliveryDateStr !== deliveryDate) {
                continue;
            }
            
            if (!clientDeliveryDates.has(clientId)) {
                clientDeliveryDates.set(clientId, new Map());
            }
            const datesMap = clientDeliveryDates.get(clientId)!;
            
            // Store delivery date info (upcoming orders don't have order_id in orders table yet, set to null)
            // Note: order_id FK constraint only allows references to orders table, not upcoming_orders
            // Use upcoming order id as a reference (we'll store it in a way that doesn't violate FK)
            if (!datesMap.has(deliveryDateStr)) {
                datesMap.set(deliveryDateStr, { deliveryDate: deliveryDateStr, dayOfWeek, orderId: null, caseId: order.case_id || null });
            }
        }

        const isDeliverable = (c: any) => {
            const v = c?.delivery;
            return v === undefined || v === null ? true : Boolean(v);
        };

        const hasOrderForDay = (clientId: string, dayValue: string): boolean => {
            const datesMap = clientDeliveryDates.get(String(clientId));
            if (!datesMap || datesMap.size === 0) return false;
            
            if (dayValue === "all") {
                // For "all" day, check if client has any orders
                return true;
            }
            
            // Check if any delivery date falls on the requested day
            const targetDay = dayValue.toLowerCase();
            for (const dateInfo of datesMap.values()) {
                if (dateInfo.dayOfWeek === targetDay) {
                    return true;
                }
            }
            return false;
        };

        const s = (v: unknown) => (v == null ? "" : String(v));
        const n = (v: unknown) => (typeof v === "number" ? v : null);

        // Build list of clients without stops and their reasons
        // Also create stops for clients who should have them
        // Each stop is unique per client + delivery_date combination
        const usersWithoutStops: Array<{ id: string; name: string; reason: string }> = [];
        const stopsToCreate: Array<{
            id: string;
            day: string;
            delivery_date: string;
            client_id: string;
            order_id: string | null;
            name: string;
            address: string;
            apt: string | null;
            city: string;
            state: string;
            zip: string;
            phone: string | null;
            lat: number | null;
            lng: number | null;
            assigned_driver_id: string | null;
        }> = [];

        // Use allClientsWithDriver instead of allClients to have access to assigned_driver_id
        const allClients = allClientsWithDriver || [];

        for (const client of allClients) {
            const clientId = String(client.id);
            
            const reasons: string[] = [];
            
            if (client.paused) {
                reasons.push("paused");
            }
            if (!isDeliverable(client)) {
                reasons.push("delivery off");
            }
            
            // Get delivery dates for this client
            const datesMap = clientDeliveryDates.get(clientId);
            if (!datesMap || datesMap.size === 0) {
                reasons.push(`no active order for ${day}`);
                const name = `${client.first_name || ""} ${client.last_name || ""}`.trim() || "Unnamed";
                const reason = reasons.join(", ");
                usersWithoutStops.push({ id: clientId, name, reason });
                continue;
            }
            
            // Get existing stops for this client
            const existingStopDates = clientStopsByDate.get(clientId) || new Set<string>();
            
            // Check if client has orders for the requested day or delivery_date
            let hasOrderForRequestedDay = false;
            if (day === "all") {
                hasOrderForRequestedDay = true;
            } else if (deliveryDate) {
                // When filtering by delivery_date, check if any delivery date matches
                // This ensures upcoming orders with scheduled_delivery_date are included
                for (const dateInfo of datesMap.values()) {
                    if (dateInfo.deliveryDate === deliveryDate) {
                        hasOrderForRequestedDay = true;
                        break;
                    }
                }
            } else {
                // When filtering by day only, check day of week
                for (const dateInfo of datesMap.values()) {
                    if (dateInfo.dayOfWeek === day.toLowerCase()) {
                        hasOrderForRequestedDay = true;
                        break;
                    }
                }
            }
            
            if (!hasOrderForRequestedDay) {
                reasons.push(`no active order for ${day}${deliveryDate ? ` on ${deliveryDate}` : ''}`);
            }
            
            const name = `${client.first_name || ""} ${client.last_name || ""}`.trim() || "Unnamed";
            
            // If client should have stops (no valid reasons), create stops for each delivery date
            if (reasons.length === 0) {
                // Create a stop for each unique delivery date
                for (const [deliveryDateStr, dateInfo] of datesMap.entries()) {
                    // Skip if stop already exists for this delivery date
                    if (existingStopDates.has(deliveryDateStr)) {
                        continue;
                    }
                    
                    // If filtering by delivery_date, only create stops for that specific date
                    if (deliveryDate && deliveryDateStr !== deliveryDate) {
                        continue;
                    }
                    
                    // If filtering by specific day (and not delivery_date), only create stops for that day
                    if (!deliveryDate && day !== "all" && dateInfo.dayOfWeek !== day.toLowerCase()) {
                        continue;
                    }
                    
                    // Get client's assigned driver (if any) to automatically assign to stop
                    const assignedDriverId = client.assigned_driver_id || null;

                    stopsToCreate.push({
                        id: uuidv4(),
                        day: dateInfo.dayOfWeek, // Keep day for backward compatibility
                        delivery_date: deliveryDateStr,
                        client_id: clientId,
                        order_id: dateInfo.orderId,
                        name: name || "(Unnamed)",
                        address: s(client.address),
                        apt: client.apt ? s(client.apt) : null,
                        city: s(client.city),
                        state: s(client.state),
                        zip: s(client.zip),
                        phone: client.phone_number ? s(client.phone_number) : null,
                        lat: n(client.lat),
                        lng: n(client.lng),
                        assigned_driver_id: assignedDriverId, // Automatically set from client
                    });
                }
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
                        const { error: insertError } = await supabase
                            .from('stops')
                            .upsert({
                                id: stopData.id,
                                day: stopData.day,
                                delivery_date: stopData.delivery_date,
                                client_id: stopData.client_id,
                                order_id: stopData.order_id,
                                name: stopData.name,
                                address: stopData.address,
                                apt: stopData.apt,
                                city: stopData.city,
                                state: stopData.state,
                                zip: stopData.zip,
                                phone: stopData.phone,
                                lat: stopData.lat,
                                lng: stopData.lng,
                                assigned_driver_id: stopData.assigned_driver_id, // Set from client
                            }, { onConflict: 'id' });
                        if (insertError) throw insertError;
                    } catch (createError: any) {
                        // Skip if stop already exists or other error
                        if (createError?.code !== "23505" && createError?.message?.includes('duplicate')) {
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

