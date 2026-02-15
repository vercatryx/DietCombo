export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { v4 as uuidv4 } from "uuid";

const s = (v: unknown) => (v == null ? "" : String(v));
const n = (v: unknown) => (typeof v === "number" ? v : null);

export async function POST(req: Request) {
    try {
        // Try to get day from body first, then fall back to query string
        let day = "all";
        let deliveryDate: string | null = null;
        const { searchParams } = new URL(req.url);
        const queryDay = searchParams.get("day");
        const queryDeliveryDate = searchParams.get("delivery_date");
        
        try {
            const body = await req.json().catch(() => null);
            if (body?.day) {
                day = String(body.day).toLowerCase();
            } else if (queryDay) {
                day = queryDay.toLowerCase();
            }
            if (body?.delivery_date) {
                deliveryDate = String(body.delivery_date);
            } else if (queryDeliveryDate) {
                deliveryDate = queryDeliveryDate;
            }
        } catch {
            // If body parsing fails, use query string
            if (queryDay) {
                day = queryDay.toLowerCase();
            }
            if (queryDeliveryDate) {
                deliveryDate = queryDeliveryDate;
            }
        }

        // Get all clients including assigned_driver_id
        const { data: allClients } = await supabase
            .from('clients')
            .select('id, first_name, last_name, full_name, address, apt, city, state, zip, phone_number, lat, lng, paused, delivery, assigned_driver_id, dislikes')
            .order('id', { ascending: true });

        // Check which clients have stops for delivery dates, and which order_ids already have a stop
        // Stops are unique by order_id: one stop per order for the driver to handle
        const { data: existingStops } = await supabase
            .from('stops')
            .select('client_id, delivery_date, day, order_id');
        
        const clientStopsByDate = new Map<string, Set<string>>();
        const orderIdsWithStops = new Set<string>();
        for (const s of (existingStops || [])) {
            if (s.order_id) {
                orderIdsWithStops.add(String(s.order_id));
            }
            if (s.client_id && s.delivery_date) {
                const clientId = String(s.client_id);
                const d = s.delivery_date;
                const dateStr = typeof d === 'string' ? d.split('T')[0] : String(d).split('T')[0];
                if (!clientStopsByDate.has(clientId)) {
                    clientStopsByDate.set(clientId, new Set());
                }
                clientStopsByDate.get(clientId)!.add(dateStr);
            }
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

        // Get upcoming_orders with delivery_day (we'll calculate delivery_date from this)
        const { data: upcomingOrders } = await supabase
            .from('upcoming_orders')
            .select('id, client_id, delivery_day, scheduled_delivery_date, status, case_id')
            .eq('status', 'scheduled')
            .or('delivery_day.not.is.null,scheduled_delivery_date.not.is.null');

        // Import getNextOccurrence and timezone helper (Eastern)
        const { getNextOccurrence, formatDateToYYYYMMDD } = await import('@/lib/order-dates');
        const { getTodayDateInAppTzAsReference } = await import('@/lib/timezone');
        const currentTime = new Date();
        const refToday = getTodayDateInAppTzAsReference(currentTime);

        // Build map of client_id -> Map of delivery_date -> order info
        // This allows multiple stops per client for different delivery dates
        const clientDeliveryDates = new Map<string, Map<string, { deliveryDate: string; dayOfWeek: string; orderId: string | null; caseId: string | null }>>();
        
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
        for (const order of upcomingOrders || []) {
            const clientId = String(order.client_id);
            let deliveryDateStr: string | null = null;
            let dayOfWeek: string | null = null;
            
            if (order.scheduled_delivery_date) {
                // Use scheduled_delivery_date if available
                deliveryDateStr = order.scheduled_delivery_date.split('T')[0];
                dayOfWeek = getDayOfWeek(order.scheduled_delivery_date);
            } else if (order.delivery_day) {
                // Calculate next occurrence of delivery_day
                const nextDate = getNextOccurrence(order.delivery_day, refToday);
                if (nextDate) {
                    deliveryDateStr = formatDateToYYYYMMDD(nextDate);
                    dayOfWeek = getDayOfWeek(deliveryDateStr);
                }
            }
            
            if (!deliveryDateStr || !dayOfWeek) continue;
            
            if (!clientDeliveryDates.has(clientId)) {
                clientDeliveryDates.set(clientId, new Map());
            }
            const datesMap = clientDeliveryDates.get(clientId)!;
            
            // Store delivery date info with upcoming order ID
            // order_id will reference the upcoming_order.id (FK constraint has been removed to allow this)
            if (!datesMap.has(deliveryDateStr)) {
                datesMap.set(deliveryDateStr, { deliveryDate: deliveryDateStr, dayOfWeek, orderId: order.id, caseId: order.case_id || null });
            }
        }

        // Helper functions
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

        // Build list of stops to create: one stop per order (unique by order_id)
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
            dislikes: string | null;
            lat: number | null;
            lng: number | null;
            assigned_driver_id: string | null;
        }> = [];

        for (const client of allClients || []) {
            const clientId = String(client.id);
            
            // Check if client should have stops
            if (client.paused) {
                continue; // Paused clients don't get stops
            }
            if (!isDeliverable(client)) {
                continue; // Delivery disabled clients don't get stops
            }
            
            // Get delivery dates for this client
            const datesMap = clientDeliveryDates.get(clientId);
            if (!datesMap || datesMap.size === 0) {
                continue; // Client has no active orders
            }
            
            // Get existing stops for this client
            const existingStopDates = clientStopsByDate.get(clientId) || new Set<string>();
            
            for (const [deliveryDateStr, dateInfo] of datesMap.entries()) {
                const orderId = dateInfo.orderId;
                if (!orderId) continue;
                // One stop per order_id: skip if a stop already exists for this order
                if (orderIdsWithStops.has(orderId)) continue;
                if (existingStopDates.has(deliveryDateStr)) {
                    orderIdsWithStops.add(orderId);
                    continue;
                }
                
                if (day !== "all" && dateInfo.dayOfWeek !== day.toLowerCase()) {
                    continue;
                }
                
                const name = (client.full_name?.trim() || 
                             `${client.first_name || ""} ${client.last_name || ""}`.trim() || 
                             "Unnamed");
                const assignedDriverId = client.assigned_driver_id || null;
                
                orderIdsWithStops.add(orderId);
                stopsToCreate.push({
                    id: uuidv4(),
                    day: dateInfo.dayOfWeek,
                    delivery_date: deliveryDateStr,
                    client_id: clientId,
                    order_id: orderId, // One stop per order for driver to handle
                    name: name,
                    address: s(client.address),
                    apt: client.apt ? s(client.apt) : null,
                    city: s(client.city),
                    state: s(client.state),
                    zip: s(client.zip),
                    phone: client.phone_number ? s(client.phone_number) : null,
                    dislikes: client.dislikes || null,
                    lat: n(client.lat),
                    lng: n(client.lng),
                    assigned_driver_id: assignedDriverId, // Automatically set from client
                });
            }
        }

        // Step 1: Create missing stops — one stop per (client_id, delivery_date) to respect UNIQUE(client_id, delivery_date)
        let stopsCreated = 0;
        const deliveryDatesTouched = new Set<string>();
        const seenClientDate = new Set<string>();
        const stopsToCreateDeduped: typeof stopsToCreate = [];
        for (const stopData of stopsToCreate) {
            const key = `${stopData.client_id}|${stopData.delivery_date}`;
            if (seenClientDate.has(key)) continue;
            seenClientDate.add(key);
            stopsToCreateDeduped.push(stopData);
        }

        if (stopsToCreateDeduped.length > 0) {
            try {
                for (const stopData of stopsToCreateDeduped) {
                    try {
                        const { data: existing } = await supabase
                            .from('stops')
                            .select('id')
                            .eq('client_id', stopData.client_id)
                            .eq('delivery_date', stopData.delivery_date)
                            .maybeSingle();
                        if (existing) continue;
                        const { error: insertError } = await supabase
                            .from('stops')
                            .insert({
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
                                dislikes: stopData.dislikes,
                                lat: stopData.lat,
                                lng: stopData.lng,
                                assigned_driver_id: stopData.assigned_driver_id,
                            });
                        if (insertError) {
                            if (insertError.code !== "23505" && !insertError.message?.includes("duplicate")) {
                                console.error(`[route/cleanup] Failed to create stop:`, insertError?.message);
                            }
                            continue;
                        }
                        stopsCreated++;
                        deliveryDatesTouched.add(stopData.delivery_date);
                    } catch (createError: any) {
                        if (createError?.code !== "23505" && !createError?.message?.includes("duplicate")) {
                            console.error(`[route/cleanup] Failed to create stop:`, createError?.message);
                        }
                    }
                }
            } catch (e: any) {
                console.warn(`[route/cleanup] Error creating stops:`, e?.message);
            }
        }

        // Step 2: Sync driver_route_order — every client with assigned_driver_id must have a row (INSERT ON CONFLICT DO NOTHING)
        let listSynced = 0;
        const assigned = (allClients || []).filter((c: any) => c.assigned_driver_id != null);
        for (const client of assigned) {
            const driverId = String(client.assigned_driver_id);
            const clientId = String(client.id);
            const { data: existing } = await supabase
                .from('driver_route_order')
                .select('driver_id')
                .eq('driver_id', driverId)
                .eq('client_id', clientId)
                .maybeSingle();
            if (existing) continue;
            const { data: maxRow } = await supabase
                .from('driver_route_order')
                .select('position')
                .eq('driver_id', driverId)
                .order('position', { ascending: false })
                .limit(1)
                .maybeSingle();
            const pos = (maxRow?.position != null ? Number(maxRow.position) + 1 : 1);
            const { error: insErr } = await supabase
                .from('driver_route_order')
                .insert({ driver_id: driverId, client_id: clientId, position: pos });
            if (!insErr) listSynced++;
            if (insErr && insErr.code !== "23505") console.warn('[route/cleanup] driver_route_order insert:', insErr?.message);
        }

        // Step 3: Set stops.order from driver_route_order (idempotent). Run for delivery_date param or dates we touched.
        const datesForOrder = deliveryDate ? [deliveryDate.split('T')[0]] : Array.from(deliveryDatesTouched);
        if (datesForOrder.length === 0 && deliveryDate) datesForOrder.push(deliveryDate.split('T')[0]);
        let ordersSet = 0;
        for (const dateStr of datesForOrder) {
            if (!dateStr) continue;
            const { data: stopsForDate } = await supabase
                .from('stops')
                .select('id, client_id, assigned_driver_id, order')
                .eq('delivery_date', dateStr)
                .not('assigned_driver_id', 'is', null);
            if (!stopsForDate?.length) continue;
            const byDriver = new Map<string, typeof stopsForDate>();
            for (const st of stopsForDate) {
                const d = String(st.assigned_driver_id);
                if (!byDriver.has(d)) byDriver.set(d, []);
                byDriver.get(d)!.push(st);
            }
            for (const [driverId, driverStops] of byDriver.entries()) {
                const { data: routeOrder } = await supabase
                    .from('driver_route_order')
                    .select('client_id, position')
                    .eq('driver_id', driverId)
                    .order('position', { ascending: true })
                    .order('client_id', { ascending: true });
                const clientToSeq = new Map<string, number>();
                let seq = 1;
                for (const row of routeOrder || []) {
                    const cid = String(row.client_id);
                    if (driverStops.some((s: any) => String(s.client_id) === cid)) {
                        clientToSeq.set(cid, seq++);
                    }
                }
                const maxFromList = clientToSeq.size > 0 ? Math.max(...clientToSeq.values()) : 0;
                let tailSeq = maxFromList + 1;
                for (const st of driverStops) {
                    const cid = String(st.client_id);
                    const orderVal = clientToSeq.get(cid) ?? tailSeq++;
                    const { error: upErr } = await supabase.from('stops').update({ order: orderVal }).eq('id', st.id);
                    if (!upErr) ordersSet++;
                }
            }
        }

        return NextResponse.json(
            {
                stopsCreated,
                listSynced,
                ordersSet,
                message: `Created ${stopsCreated} stops; synced ${listSynced} driver_route_order rows; set order for ${ordersSet} stops.`,
            },
            { headers: { "Cache-Control": "no-store" } }
        );
    } catch (e: any) {
        console.error("cleanup POST error", e);
        return NextResponse.json(
            { error: e?.message || "Server error", stopsCreated: 0 },
            { status: 500 }
        );
    }
}

