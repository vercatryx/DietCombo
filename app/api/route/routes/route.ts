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
        const light = searchParams.get("light") === "1" || searchParams.get("light") === "true";
        const debug = searchParams.get("debug") === "1" || searchParams.get("debug") === "true";
        let debugOrderNumbersByClientCount = 0;
        const serverLog: string[] = [];
        const log = (msg: string) => {
            serverLog.push(msg);
            console.log(msg);
        };

        const normalizedDeliveryDate = deliveryDate ? deliveryDate.split('T')[0].split(' ')[0] : null;
        log(`[route/routes] GET delivery_date=${deliveryDate ?? 'none'} normalized=${normalizedDeliveryDate ?? 'null'} day=${day}`);

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
        const routesAsDrivers = (routesRaw || []).map((r: any) => ({
            ...r,
            day: day === "all" ? "all" : day, // Use current day or "all" if querying all
        }));

        // Combine drivers and routes
        const allDriversRaw = [...(driversRaw || []), ...routesAsDrivers];
        
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
        // Normalize delivery_date to YYYY-MM-DD format for proper comparison (already set above)
        let stopsQuery = supabase
            .from('stops')
            .select('id, client_id, name, address, apt, city, state, zip, phone, lat, lng, dislikes, delivery_date, completed, proof_url, day, assigned_driver_id, order_id')
            .order('id', { ascending: true });
        
        // Filter by delivery_date if provided (date-only comparison so DATE and TIMESTAMP both match)
        if (normalizedDeliveryDate) {
            const nextDay = (() => {
                const [y, m, d] = normalizedDeliveryDate.split('-').map(Number);
                const next = new Date(y, m - 1, d + 1);
                return next.toISOString().slice(0, 10);
            })();
            if (day !== "all") {
                stopsQuery = stopsQuery.or(
                    `and(delivery_date.gte.${normalizedDeliveryDate},delivery_date.lt.${nextDay}),and(delivery_date.is.null,day.eq.${day})`
                );
            } else {
                stopsQuery = stopsQuery.gte('delivery_date', normalizedDeliveryDate).lt('delivery_date', nextDay);
            }
        } else if (day !== "all") {
            // If no delivery_date but day is specified, filter by day
            stopsQuery = stopsQuery.eq('day', day);
        }
        
        const { data: allStops } = await stopsQuery;
        
        // If filtering by delivery_date, also fetch stops with NULL delivery_date that match the day
        // This handles legacy stops or stops where delivery_date wasn't set correctly
        let additionalStops: any[] = [];
        if (normalizedDeliveryDate && day !== "all") {
            const { data: nullDateStops } = await supabase
                .from('stops')
                .select('id, client_id, name, address, apt, city, state, zip, phone, lat, lng, dislikes, delivery_date, completed, proof_url, day, assigned_driver_id, order_id')
                .is('delivery_date', null)
                .eq('day', day);
            
            if (nullDateStops) {
                // Filter out duplicates (stops that were already included in allStops)
                const existingStopIds = new Set((allStops || []).map(s => s.id));
                additionalStops = (nullDateStops || []).filter(s => !existingStopIds.has(s.id));
            }
        }
        
        // Combine stops from both queries
        const allStopsCombined = [...(allStops || []), ...additionalStops];

        // 3) Fetch all Clients for the clientIds we saw in stops
        const clientIdSet = new Set<string>();
        for (const s of allStopsCombined) if (s.client_id) clientIdSet.add(String(s.client_id));
        const clientIds = Array.from(clientIdSet);

        const { data: clients } = clientIds.length > 0
            ? await supabase
                .from('clients')
                .select('id, first_name, last_name, full_name, address, apt, city, state, zip, phone_number, lat, lng, dislikes, paused, delivery, assigned_driver_id')
                .in('id', clientIds)
            : { data: [] };

        const clientById = new Map((clients || []).map((c) => [c.id, {
            ...c,
            first: c.first_name,
            last: c.last_name,
            fullName: c.full_name,
            full_name: c.full_name,
            phone: c.phone_number,
            assigned_driver_id: c.assigned_driver_id
        }]));

        // Exclude stops for clients who are paused or have delivery turned off (profile)
        const isDeliverableClient = (c: any) => {
            const v = c?.delivery;
            return v === undefined || v === null ? true : Boolean(v);
        };
        const shouldShowStop = (stop: any) => {
            const client = stop?.userId != null ? clientById.get(String(stop.userId)) : clientById.get(String((stop as any).client_id));
            if (!client) return true; // no client record → show (legacy)
            if (client.paused) return false;
            return isDeliverableClient(client);
        };

        // 4) Sort drivers so Driver 0,1,2… are in that order
        const drivers = [...allDriversRaw].sort(
            (a, b) => driverRankByName(a.name) - driverRankByName(b.name)
        );
        
        console.log(`[route/routes] After sorting: ${drivers.length} drivers (${driversRaw?.length || 0} from drivers table, ${routesRaw?.length || 0} from routes table)`);

        // 5) Fetch order information for all stops
        // Same source as /orders page: orders table. When we have a delivery_date, also do a direct lookup
        // so order_number always comes from orders for that date.
        const orderMapById = new Map<string, any>(); // key: order_id (direct lookup)
        const orderMapByClientAndDate = new Map<string, any>(); // key: "client_id|delivery_date"
        const orderMapByClient = new Map<string, any>(); // key: "client_id" (fallback to most recent)
        const orderNumberByClientForDate = new Map<string, number>(); // key: client_id -> order_number (orders table, for normalizedDeliveryDate only)
        const ORDERS_BATCH = 80; // avoid URL/request size limits when querying many ids

        if (normalizedDeliveryDate && clientIds.length > 0) {
            const normalizeDateForOrders = (dateStr: string | null | undefined): string | null => {
                if (!dateStr) return null;
                return String(dateStr).split('T')[0].split(' ')[0];
            };
            let ordersForDateError: Error | null = null;
            for (let i = 0; i < clientIds.length; i += ORDERS_BATCH) {
                const batch = clientIds.slice(i, i + ORDERS_BATCH);
                const res = await supabase
                    .from('orders')
                    .select('id, client_id, scheduled_delivery_date, order_number, proof_of_delivery_url')
                    .eq('scheduled_delivery_date', normalizedDeliveryDate)
                    .in('client_id', batch);
                if (res.error) {
                    ordersForDateError = res.error;
                    serverLog.push(`[route/routes] Direct orders-by-date batch failed: ${res.error.message}`);
                    break;
                }
                for (const row of res.data || []) {
                    const cid = String(row.client_id);
                    const num = row.order_number != null && row.order_number !== '' ? Number(row.order_number) : null;
                    if (cid && num != null && Number.isFinite(num)) {
                        orderNumberByClientForDate.set(cid, num);
                    }
                    const dateStr = normalizeDateForOrders(row.scheduled_delivery_date);
                    if (cid && dateStr) {
                        const key = `${cid}|${dateStr}`;
                        if (!orderMapByClientAndDate.has(key)) orderMapByClientAndDate.set(key, row);
                    }
                }
            }
            if (ordersForDateError) {
                serverLog.push(`[route/routes] Direct orders-by-date query failed: ${ordersForDateError.message}`);
            }
            if (orderNumberByClientForDate.size > 0) {
                debugOrderNumbersByClientCount = orderNumberByClientForDate.size;
                log(`[route/routes] Direct orders-by-date (${normalizedDeliveryDate}): ${orderNumberByClientForDate.size} client_ids with order_number, orderMapByClientAndDate has ${orderMapByClientAndDate.size} entries (orders table, batched)`);
            } else {
                log(`[route/routes] Direct orders-by-date (${normalizedDeliveryDate}): 0 rows (error=${ordersForDateError?.message ?? 'none'})`);
            }
        }

        // Collect all unique order_ids from stops
        const orderIds = new Set<string>();
        for (const s of allStopsCombined) {
            if (s.order_id) {
                orderIds.add(String(s.order_id));
            }
        }
        
        // Fetch orders by order_id — batched to avoid URL/request size limits (550+ ids).
        if (orderIds.size > 0) {
            const orderIdsArray = Array.from(orderIds);
            let ordersByIdError: Error | null = null;
            for (let i = 0; i < orderIdsArray.length; i += ORDERS_BATCH) {
                const batch = orderIdsArray.slice(i, i + ORDERS_BATCH);
                const res = await supabase
                    .from('orders')
                    .select('id, client_id, created_at, scheduled_delivery_date, actual_delivery_date, status, case_id, order_number, proof_of_delivery_url')
                    .in('id', batch);
                if (res.error) {
                    ordersByIdError = res.error;
                    serverLog.push(`[route/routes] orders by id batch failed: ${res.error.message}`);
                    break;
                }
                for (const order of res.data || []) {
                    orderMapById.set(String(order.id), order);
                }
            }
            const ordersFromOrdersTable = orderMapById.size;
            const withOrderNumber = Array.from(orderMapById.values()).filter((o: any) => o?.order_number != null && o?.order_number !== '').length;
            if (ordersByIdError) {
                serverLog.push(`[route/routes] orders by id (orders table) error: ${ordersByIdError.message}`);
            }
            let fromUpcoming = 0;
            for (let i = 0; i < orderIdsArray.length; i += ORDERS_BATCH) {
                const batch = orderIdsArray.slice(i, i + ORDERS_BATCH);
                const res = await supabase
                    .from('upcoming_orders')
                    .select('id, client_id, created_at, scheduled_delivery_date, actual_delivery_date, status, case_id, order_number')
                    .in('id', batch);
                for (const order of res.data || []) {
                    const oid = String(order.id);
                    if (!orderMapById.has(oid)) {
                        orderMapById.set(oid, order);
                        fromUpcoming++;
                    }
                }
            }
            log(`[route/routes] order_id lookup: ${orderIdsArray.length} unique order_ids from stops; ${ordersFromOrdersTable} rows from orders table (${withOrderNumber} with order_number), ${fromUpcoming} extra from upcoming_orders; orderMapById.size=${orderMapById.size}`);
            if (orderIdsArray.length > 0) {
                const sample = orderIdsArray.slice(0, 5);
                for (const oid of sample) {
                    const o = orderMapById.get(oid);
                    log(`[route/routes]   sample order_id=${oid.slice(0, 8)}... → order_number=${o?.order_number ?? 'null'} (from ${o ? 'orders/upcoming' : 'NOT FOUND'})`);
                }
            }
        }
        
        // Also fetch orders by client_id for fallback matching (for stops without order_id)
        if (clientIds.length > 0) {
            // Get all orders - expand status filter to include more statuses
            // Also check upcoming_orders table
            const { data: orders } = await supabase
                .from('orders')
                .select('id, client_id, created_at, scheduled_delivery_date, actual_delivery_date, status, case_id, order_number, proof_of_delivery_url')
                .in('client_id', clientIds)
                .not('status', 'eq', 'cancelled')
                .order('created_at', { ascending: false });
            
            // Also check upcoming_orders
            const { data: upcomingOrders } = await supabase
                .from('upcoming_orders')
                .select('id, client_id, created_at, scheduled_delivery_date, actual_delivery_date, status, case_id, order_number')
                .in('client_id', clientIds)
                .not('status', 'eq', 'cancelled')
                .order('created_at', { ascending: false });
            
            console.log(`[route/routes] Found ${orders?.length || 0} orders and ${upcomingOrders?.length || 0} upcoming orders for ${clientIds.length} clients (for fallback matching)`);
            
            // Use same source as /orders page: prefer orders table, then fill gaps from upcoming_orders
            const normalizeDate = (dateStr: string | null | undefined): string | null => {
                if (!dateStr) return null;
                return String(dateStr).split('T')[0].split(' ')[0];
            };
            // 1) Fill from orders table first (same as getOrdersPaginatedBilling on /orders)
            for (const order of orders || []) {
                const cid = String(order.client_id);
                if (!orderMapByClient.has(cid)) orderMapByClient.set(cid, order);
                const deliveryDateStr = normalizeDate(order.scheduled_delivery_date);
                if (deliveryDateStr) {
                    const key = `${cid}|${deliveryDateStr}`;
                    if (!orderMapByClientAndDate.has(key)) orderMapByClientAndDate.set(key, order);
                }
            }
            // 2) Fill gaps from upcoming_orders
            for (const order of upcomingOrders || []) {
                const cid = String(order.client_id);
                if (!orderMapByClient.has(cid)) orderMapByClient.set(cid, order);
                const deliveryDateStr = normalizeDate(order.scheduled_delivery_date);
                if (deliveryDateStr) {
                    const key = `${cid}|${deliveryDateStr}`;
                    if (!orderMapByClientAndDate.has(key)) orderMapByClientAndDate.set(key, order);
                }
            }

            if ((orders?.length || 0) + (upcomingOrders?.length || 0) > 0) {
                console.log(`[route/routes] Mapped ${orderMapByClientAndDate.size} orders by date and ${orderMapByClient.size} orders by client (orders table preferred, same as /orders page)`);
            } else {
                console.warn(`[route/routes] No orders found for any of the ${clientIds.length} clients`);
            }
        }

        // 6) Hydrate each stop, preferring live Client fields when available
        const stopById = new Map<string, any>();

        for (const s of allStopsCombined) {
            const c = s.client_id ? clientById.get(s.client_id) : undefined;
            // Priority: stops.name (from DB), then client full_name/first+last, then address, then "Client {id}"
            const stopNameRaw = s.name ?? (s as any).Name;
            const stopName = (stopNameRaw != null && String(stopNameRaw).trim()) ? String(stopNameRaw).trim() : null;
            const rawName =
                c?.full_name?.trim() ||
                (c ? `${c.first ?? c.first_name ?? ""} ${c.last ?? c.last_name ?? ""}`.trim() : null) ||
                null;
            const addressLine = [c?.address ?? s.address, c?.apt ?? s.apt].filter(Boolean).join(" ")?.trim();
            const name = stopName || rawName || addressLine || (s.client_id ? `Client ${s.client_id}` : "Unnamed");

            // prefer live client value; fall back to stop's denorm
            const dislikes = c?.dislikes ?? s.dislikes ?? "";
            
            // Get order information for this stop
            // Priority: Use stop.order_id to look up order directly from upcoming_orders or orders table
            // Fallback: Try to match by client_id + delivery_date, then fall back to client_id only
            let order = null;
            
            // First priority: Check if stop has order_id and look it up directly
            if (s.order_id) {
                order = orderMapById.get(String(s.order_id)) || null;
            }
            
            // Fallback: Match by client_id + delivery_date if no direct order_id match
            // Also: when order from order_id has no order_number (e.g. upcoming_order), try client+date to get order with order_number (e.g. from orders table)
            const normalizeDateForStop = (dateStr: string | null | undefined): string | null => {
                if (!dateStr) return null;
                return String(dateStr).split('T')[0].split(' ')[0];
            };
            if (s.client_id) {
                const cid = String(s.client_id);
                const orderFromClientAndDate = s.delivery_date
                    ? orderMapByClientAndDate.get(`${cid}|${normalizeDateForStop(s.delivery_date) || ''}`) || null
                    : null;
                const orderFromClient = orderMapByClient.get(cid) || null;
                // If primary order lacks order_number, prefer one that has it (e.g. processed order in orders table)
                if (order && (order.order_number == null || order.order_number === '')) {
                    const better = orderFromClientAndDate ?? orderFromClient;
                    if (better?.order_number != null && better.order_number !== '') {
                        order = better;
                    }
                }
                if (!order) {
                    order = orderFromClientAndDate ?? orderFromClient ?? null;
                }
            }

            stopById.set(sid(s.id), {
                id: s.id,
                userId: s.client_id ?? null,
                client_id: s.client_id ?? null,
                name: (name && String(name).trim()) ? String(name).trim() : "Unnamed",

                // Preserve first and last name fields for proper client name reconstruction
                first: c?.first || null,
                last: c?.last || null,
                first_name: c?.first || null,
                last_name: c?.last || null,
                // Include full_name from client record
                fullName: c?.full_name || null,
                full_name: c?.full_name || null,

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
                
                // Proof of delivery: same resolution as order_number — orders table by client+date (orderMapByClientAndDate), then by order_id, then by client (orderMapByClient), then stops.proof_url
                proofUrl: (() => {
                    const fromStop = (s.proof_url && String(s.proof_url).trim()) || null;
                    const cid = s.client_id ? String(s.client_id) : '';
                    const dateKey = cid && s.delivery_date ? `${cid}|${normalizeDateForStop(s.delivery_date) || ''}` : '';
                    const orderByClientAndDate = dateKey ? orderMapByClientAndDate.get(dateKey) : null;
                    const orderByClient = cid ? orderMapByClient.get(cid) : null;
                    const fromOrderById = (order?.proof_of_delivery_url && String(order.proof_of_delivery_url).trim()) || null;
                    const fromOrderByClientDate = (orderByClientAndDate?.proof_of_delivery_url && String(orderByClientAndDate.proof_of_delivery_url).trim()) || null;
                    const fromOrderByClient = (orderByClient?.proof_of_delivery_url && String(orderByClient.proof_of_delivery_url).trim()) || null;
                    return fromStop || fromOrderById || fromOrderByClientDate || fromOrderByClient || null;
                })(),
                
                // Prefer client.assigned_driver_id; fallback to stop when client null (stops often have it from creation)
                assigned_driver_id: c?.assigned_driver_id ?? s.assigned_driver_id ?? null,
                
                // Add order_id from stops table (source of truth for order relationship)
                order_id: s.order_id || null,
                
                // order_number: same source as /orders page. We already have order from order_id lookup (orders table first).
                orderId: order?.id || s.order_id || null,
                orderNumber: (() => {
                    const fromOrder = order?.order_number != null && order?.order_number !== '' ? Number(order.order_number) : null;
                    if (fromOrder != null) return fromOrder;
                    const cid = s.client_id ? String(s.client_id) : null;
                    if (cid) {
                        const fromDirect = orderNumberByClientForDate.get(cid);
                        if (fromDirect != null) return fromDirect;
                    }
                    return null;
                })(),
                orderDate: order?.created_at || null,
                deliveryDate: order?.actual_delivery_date || order?.scheduled_delivery_date || null,
                orderStatus: order?.status || null,
            });
        }

        const stopsWithOrderNumber = Array.from(stopById.values()).filter((s: any) => (s?.orderNumber ?? s?.order_number) != null && (s?.orderNumber ?? s?.order_number) !== '');
        log(`[route/routes] orderNumber summary: ${stopsWithOrderNumber.length}/${stopById.size} stops have orderNumber set`);
        const stopsWithProof = Array.from(stopById.values()).filter((s: any) => !!((s?.proofUrl ?? s?.proof_url) || '').trim());
        log(`[route/routes] proof summary: ${stopsWithProof.length}/${stopById.size} stops have proofUrl (from orders.proof_of_delivery_url or stops.proof_url)`);
        const firstStops = Array.from(stopById.values()).slice(0, 6);
        for (const st of firstStops) {
            log(`[route/routes]   stop id=${(st?.id ?? '').toString().slice(0, 8)}... client_id=${(st?.userId ?? st?.client_id ?? '').toString().slice(0, 8)}... order_id=${(st?.order_id ?? '').toString().slice(0, 8)}... → orderNumber=${st?.orderNumber ?? st?.order_number ?? 'null'}`);
        }

        // 7) Build driver routes. Route order source: driver_route_order (when delivery_date set); drivers.stop_ids / routes.stop_ids deprecated for order (Phase 6).
        // When delivery_date is set, order from driver_route_order; else fallback to stop_ids + assigned_driver_id.
        const colorPalette = [
            "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd",
            "#8c564b", "#e377c2", "#17becf", "#bcbd22", "#393b79",
            "#ad494a", "#637939", "#ce6dbd", "#8c6d31", "#7f7f7f",
        ];
        const driverIdsForRoutes = drivers.map((d) => String(d.id));
        let routeOrderByDriver: Map<string, { client_id: string }[]> = new Map();
        if (normalizedDeliveryDate && driverIdsForRoutes.length > 0) {
            const { data: routeOrderRows } = await supabase
                .from("driver_route_order")
                .select("driver_id, client_id, position")
                .in("driver_id", driverIdsForRoutes)
                .order("position", { ascending: true })
                .order("client_id", { ascending: true });
            for (const row of routeOrderRows || []) {
                const did = String(row.driver_id);
                if (!routeOrderByDriver.has(did)) routeOrderByDriver.set(did, []);
                routeOrderByDriver.get(did)!.push({ client_id: String(row.client_id) });
            }
        }
        // Prefer client.assigned_driver_id; fallback to stop when client null (stops often populated from creation)
        // Use client_id or userId (hydrated stop may use either)
        const stopByDriverAndClient = new Map<string, any>();
        for (const [stopId, s] of stopById.entries()) {
            const cid = s?.client_id ?? s?.userId ?? null;
            const client = cid ? clientById.get(String(cid)) : undefined;
            const driverId = client?.assigned_driver_id ?? s?.assigned_driver_id;
            if (driverId != null && cid != null) {
                // When multiple stops per (driver, client): keep first by position in driver_route_order.
                // For now we overwrite; route build iterates driver_route_order so we get one per client.
                // If multiple stops per client, we pick last-seen (id order) — improve later with stop[].
                stopByDriverAndClient.set(`${String(driverId)}|${String(cid)}`, s);
            }
        }

        const driverIdToRouteIdx = new Map<string, number>();
        const routes = drivers.map((d, idx) => {
            const driverId = String(d.id);
            driverIdToRouteIdx.set(driverId, idx);
            const stops: any[] = [];
            const stopIdSet = new Set<string>();

            const orderList = routeOrderByDriver.get(driverId);
            if (orderList && orderList.length > 0 && normalizedDeliveryDate) {
                for (const row of orderList) {
                    const stop = stopByDriverAndClient.get(`${driverId}|${row.client_id}`);
                    if (stop && !stopIdSet.has(sid(stop.id)) && shouldShowStop(stop)) {
                        stops.push(stop);
                        stopIdSet.add(sid(stop.id));
                    }
                }
                // Tail: include any other stops for this driver/date not yet in list (prefer client, fallback to stop)
                for (const [_, stop] of stopById.entries()) {
                    const client = stop?.client_id ? clientById.get(String(stop.client_id)) : undefined;
                    const assignedDriverId = (client?.assigned_driver_id ?? stop?.assigned_driver_id) ? String(client?.assigned_driver_id ?? stop.assigned_driver_id) : null;
                    if (assignedDriverId === driverId && !stopIdSet.has(sid(stop.id)) && shouldShowStop(stop)) {
                        stops.push(stop);
                        stopIdSet.add(sid(stop.id));
                    }
                }
            }
            // No stop_ids fallback — driver_route_order + client.assigned_driver_id only (allows DB column removal)

            // Ensure color is always set - use driver color or fallback to palette
            const driverColor = (d.color && d.color !== "#666" && d.color !== "gray" && d.color !== "grey" && d.color !== null && d.color !== undefined)
                ? d.color
                : colorPalette[idx % colorPalette.length];
            return {
                driverId: d.id,
                driverName: d.name,
                color: driverColor, // Always return a valid color
                stops,
            };
        });
        
        console.log(`[route/routes] Built ${routes.length} routes with ${routes.reduce((sum, r) => sum + r.stops.length, 0)} total stops`);
        console.log(`[route/routes] Stops per route:`, routes.map(r => ({ driver: r.driverName, stops: r.stops.length })));

        // 8) Unrouted = all hydrated stops not referenced by any driver's current list
        // Use client.assigned_driver_id for consistency with vendor export
        const claimed = new Set(routes.flatMap((r) => r.stops.map((s) => sid(s.id))));
        const driverIds = new Set(drivers.map(d => String(d.id)));
        const unrouted: any[] = [];
        for (const [k, v] of stopById.entries()) {
            if (!shouldShowStop(v)) continue; // exclude paused / delivery-off clients
            const client = v?.client_id ? clientById.get(String(v.client_id)) : undefined;
            const driverId = client?.assigned_driver_id ?? v?.assigned_driver_id ?? null;
            const hasAssignedDriver = driverId && driverIds.has(String(driverId));
            if (!claimed.has(k) && !hasAssignedDriver) {
                unrouted.push(v);
            }
        }

        const skipStopCreation = light || (normalizedDeliveryDate != null && normalizedDeliveryDate !== "");
        if (skipStopCreation) {
            console.log(`[route/routes] Returning ${routes.length} routes, ${unrouted.length} unrouted (no stop-creation: light=${light}, delivery_date=${deliveryDate ?? "none"})`);
            serverLog.push(`[route/routes] (early return: light=${light}, skipStopCreation=true)`);
            return NextResponse.json(
                { routes, unrouted, usersWithoutStops: [], _serverLog: serverLog },
                { headers: { "Cache-Control": "no-store" } }
            );
        }

        // 9) Check clients without stops, create missing stops, and log reasons
        // NEW APPROACH: Use orders to determine which clients need stops, not schedules
        // Note: allClientsWithDriver is already fetched above, so we don't need to fetch again

        // Check which clients have stops for delivery dates, and which order_ids already have a stop
        // Stops are unique by order_id: one stop per order for the driver to handle
        // When filtering by delivery_date, load ALL stops for that date so we don't create duplicates (avoid limit(10000) which caused duplicate stops when total stops > 10k)
        let existingStopsQuery = supabase
            .from('stops')
            .select('client_id, delivery_date, day, order_id');
        if (normalizedDeliveryDate) {
            existingStopsQuery = existingStopsQuery.eq('delivery_date', normalizedDeliveryDate);
        } else {
            existingStopsQuery = existingStopsQuery.limit(10000);
        }
        const { data: existingStops } = await existingStopsQuery;

        // Normalize delivery_date to YYYY-MM-DD so we match the format used from orders (avoids duplicate stop creation on every page visit)
        const normalizeDeliveryDate = (v: string | null | undefined): string | null => {
            if (v == null || v === undefined) return null;
            const str = String(v);
            return str ? str.split('T')[0].split(' ')[0] : null;
        };
        const clientStopsByDate = new Map<string, Set<string>>();
        const orderIdsWithStops = new Set<string>();
        for (const s of (existingStops || [])) {
            if (s.order_id) {
                orderIdsWithStops.add(String(s.order_id));
            }
            if (s.client_id && s.delivery_date) {
                const normalized = normalizeDeliveryDate(s.delivery_date);
                if (!normalized) continue;
                const clientId = String(s.client_id);
                if (!clientStopsByDate.has(clientId)) {
                    clientStopsByDate.set(clientId, new Set());
                }
                clientStopsByDate.get(clientId)!.add(normalized);
            }
        }

        // Fetch all clients with their assigned_driver_id for stop creation
        const { data: allClientsWithDriver } = await supabase
            .from('clients')
            .select('id, first_name, last_name, full_name, address, apt, city, state, zip, phone_number, lat, lng, paused, delivery, assigned_driver_id, dislikes')
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
            .select('id, client_id, delivery_day, scheduled_delivery_date, status, case_id, service_type')
            .eq('status', 'scheduled')
            .or('delivery_day.not.is.null,scheduled_delivery_date.not.is.null');
        
        const { data: upcomingOrders } = await upcomingOrdersQuery;
        
        // If filtering by delivery_date, also fetch upcoming orders with matching scheduled_delivery_date
        // This ensures we get all upcoming orders for that specific date
        let upcomingOrdersByDate: any[] = [];
        if (deliveryDate) {
            const { data: upcomingOrdersMatchingDate } = await supabase
                .from('upcoming_orders')
                .select('id, client_id, delivery_day, scheduled_delivery_date, status, case_id, service_type')
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

        // Import getNextOccurrence and timezone helper for delivery dates (Eastern)
        const { getNextOccurrence, formatDateToYYYYMMDD } = await import('@/lib/order-dates');
        const { getTodayDateInAppTzAsReference } = await import('@/lib/timezone');
        const { getVendors } = await import('@/lib/actions');
        const currentTime = new Date();
        const refToday = getTodayDateInAppTzAsReference(currentTime);

        // Fetch vendors to get delivery days for boxes
        const vendors = await getVendors();

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
        
        // Helper to capitalize day name (e.g., "monday" -> "Monday")
        const capitalizeDayName = (day: string): string => {
            if (!day) return day;
            return day.charAt(0).toUpperCase() + day.slice(1).toLowerCase();
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
        // For boxes orders, use the vendor's first delivery day and get the nearest date
        for (const order of uniqueUpcomingOrders) {
            const clientId = String(order.client_id);
            let deliveryDateStr: string | null = null;
            let dayOfWeek: string | null = null;
            
            // Check if this is a boxes order and needs vendor-based delivery day calculation
            const isBoxesOrder = order.service_type === 'Boxes';
            
            if (order.scheduled_delivery_date) {
                // Use scheduled_delivery_date if available (prioritize this)
                deliveryDateStr = order.scheduled_delivery_date.split('T')[0];
                dayOfWeek = getDayOfWeek(order.scheduled_delivery_date);
            } else if (isBoxesOrder && !order.delivery_day) {
                // For boxes orders without delivery_day, get vendor from box selections
                // and use the vendor's first delivery day
                const { data: boxSelections } = await supabase
                    .from('upcoming_order_box_selections')
                    .select('vendor_id')
                    .eq('upcoming_order_id', order.id)
                    .limit(1)
                    .maybeSingle();
                
                if (boxSelections?.vendor_id) {
                    const vendor = vendors.find(v => v.id === boxSelections.vendor_id);
                    if (vendor && vendor.deliveryDays && vendor.deliveryDays.length > 0) {
                        // Use the first delivery day from the vendor
                        // Ensure it's properly capitalized for getNextOccurrence
                        const firstDeliveryDay = capitalizeDayName(vendor.deliveryDays[0]);
                        // Calculate the nearest date for this day
                        const nextDate = getNextOccurrence(firstDeliveryDay, currentTime);
                        if (nextDate) {
                            deliveryDateStr = formatDateToYYYYMMDD(nextDate);
                            dayOfWeek = getDayOfWeek(deliveryDateStr);
                            
                            // Update the upcoming_order with the calculated delivery_day for future reference
                            await supabase
                                .from('upcoming_orders')
                                .update({ delivery_day: firstDeliveryDay })
                                .eq('id', order.id);
                        }
                    }
                }
            } else if (order.delivery_day) {
                // Calculate next occurrence of delivery_day
                const nextDate = getNextOccurrence(order.delivery_day, refToday);
                if (nextDate) {
                    deliveryDateStr = formatDateToYYYYMMDD(nextDate);
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
            
            // Store delivery date info with upcoming order ID
            // order_id will reference the upcoming_order.id (FK constraint has been removed to allow this)
            if (!datesMap.has(deliveryDateStr)) {
                datesMap.set(deliveryDateStr, { deliveryDate: deliveryDateStr, dayOfWeek, orderId: order.id, caseId: order.case_id || null });
            }
        }

        // Load existing stops for exactly the order_ids we care about (no limit) so we never create duplicates
        const orderIdsFromDeliveryDates = new Set<string>();
        for (const datesMap of clientDeliveryDates.values()) {
            for (const info of datesMap.values()) {
                if (info.orderId) orderIdsFromDeliveryDates.add(info.orderId);
            }
        }
        if (orderIdsFromDeliveryDates.size > 0) {
            const orderIdList = [...orderIdsFromDeliveryDates];
            // Chunk to avoid URL/query size limits (e.g. PostgREST)
            const chunkSize = 500;
            for (let i = 0; i < orderIdList.length; i += chunkSize) {
                const chunk = orderIdList.slice(i, i + chunkSize);
                const { data: stopsForOrders } = await supabase
                    .from('stops')
                    .select('client_id, delivery_date, order_id')
                    .in('order_id', chunk)
                    .not('order_id', 'is', null);
                for (const s of stopsForOrders || []) {
                    orderIdsWithStops.add(String(s.order_id));
                    if (s.client_id && s.delivery_date) {
                        const normalized = normalizeDeliveryDate(s.delivery_date);
                        if (normalized) {
                            const cid = String(s.client_id);
                            if (!clientStopsByDate.has(cid)) clientStopsByDate.set(cid, new Set());
                            clientStopsByDate.get(cid)!.add(normalized);
                        }
                    }
                }
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
            dislikes: string | null;
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
            
            // Use full_name from client record, fallback to first_name + last_name, then "Unnamed"
            const name = (client.full_name?.trim() || 
                         `${client.first_name || ""} ${client.last_name || ""}`.trim() || 
                         "Unnamed");
            
            // If client should have stops (no valid reasons), create one stop per order (unique by order_id)
            if (reasons.length === 0) {
                for (const [deliveryDateStr, dateInfo] of datesMap.entries()) {
                    // Skip if no order_id (should not create stop without an order to handle)
                    const orderId = dateInfo.orderId;
                    if (!orderId) continue;
                    // Skip if a stop already exists for this order_id (one stop per order for the driver)
                    if (orderIdsWithStops.has(orderId)) continue;
                    // Skip if stop already exists for this client+delivery_date (legacy check)
                    if (existingStopDates.has(deliveryDateStr)) {
                        orderIdsWithStops.add(orderId); // Mark so we don't create duplicate for same order
                        continue;
                    }
                    
                    // If filtering by specific day (and not delivery_date), only create stops for that day
                    if (day !== "all" && dateInfo.dayOfWeek !== day.toLowerCase()) {
                        continue;
                    }
                    
                    // Get client's assigned driver (if any) to automatically assign to stop
                    const assignedDriverId = client.assigned_driver_id || null;

                    orderIdsWithStops.add(orderId); // Ensure we only create one stop per order_id
                    stopsToCreate.push({
                        id: uuidv4(),
                        day: dateInfo.dayOfWeek, // Keep day for backward compatibility
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
            } else {
                // Client has a valid reason for not having a stop, log it
                const reason = reasons.join(", ");
                usersWithoutStops.push({ id: clientId, name, reason });
            }
        }

        // Create missing stops for clients who should have them (one stop per order_id + delivery_date)
        if (stopsToCreate.length > 0) {
            // Deduplicate by (order_id, delivery_date): only one stop per order per delivery date
            const seenOrderIdDeliveryDate = new Set<string>();
            const stopsToCreateDeduped = stopsToCreate.filter((s) => {
                const key = s.order_id && s.delivery_date ? `${s.order_id}|${s.delivery_date}` : null;
                if (!key) return true;
                if (seenOrderIdDeliveryDate.has(key)) return false;
                seenOrderIdDeliveryDate.add(key);
                return true;
            });

            // Batch check: get all order_ids that already have a stop — never create a second stop for the same order_id
            const orderIdsToCheck = [...new Set(stopsToCreateDeduped.map(s => s.order_id).filter(Boolean))] as string[];
            let existingOrderIdsWithStop = new Set<string>();
            if (orderIdsToCheck.length > 0) {
                const chunkSize = 500;
                for (let i = 0; i < orderIdsToCheck.length; i += chunkSize) {
                    const chunk = orderIdsToCheck.slice(i, i + chunkSize);
                    const { data: existingStopsByOrderId } = await supabase
                        .from('stops')
                        .select('order_id')
                        .in('order_id', chunk)
                        .not('order_id', 'is', null);
                    if (existingStopsByOrderId) {
                        for (const r of existingStopsByOrderId) {
                            if (r.order_id) existingOrderIdsWithStop.add(String(r.order_id));
                        }
                    }
                }
            }
            // Do not insert any stop for an order_id that already has a stop
            let stopsToInsert = stopsToCreateDeduped.filter(s => !s.order_id || !existingOrderIdsWithStop.has(s.order_id));

            // Add clients who are actually getting stops created to the response for logging
            for (const stopData of stopsToInsert) {
                usersWithoutStops.push({
                    id: stopData.client_id,
                    name: stopData.name,
                    reason: "creating stop now",
                });
            }

            try {
                // Track order_ids we insert in this request so we never create a second stop for the same order_id
                const insertedOrderIdsThisRequest = new Set<string>();
                for (const stopData of stopsToInsert) {
                    try {
                        // Precheck: skip if we already inserted a stop for this order_id in this request
                        if (stopData.order_id && insertedOrderIdsThisRequest.has(stopData.order_id)) {
                            continue;
                        }
                        // Precheck: skip if a stop for this order_id already exists in DB (handles concurrent requests)
                        if (stopData.order_id && existingOrderIdsWithStop.has(stopData.order_id)) {
                            continue;
                        }
                        const { error: insertError } = await supabase
                            .from('stops')
                            .upsert(
                                {
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
                                },
                                { onConflict: "id" }
                            );
                        if (insertError) throw insertError;
                        if (stopData.order_id) {
                            insertedOrderIdsThisRequest.add(stopData.order_id);
                            existingOrderIdsWithStop.add(stopData.order_id); // so subsequent iteration skips if same id appears
                        }
                    } catch (createError: any) {
                        if (createError?.code !== "23505" && !createError?.message?.includes("duplicate")) {
                            console.error(
                                `[route/routes] Failed to create stop for client ${stopData.client_id}:`,
                                createError?.message
                            );
                        }
                    }
                }
            } catch (e: any) {
                console.warn(`[route/routes] Error creating stops:`, e?.message);
            }
        }

        console.log(`[route/routes] Returning ${routes.length} routes, ${unrouted.length} unrouted stops`);
        
        const payload: Record<string, unknown> = { routes, unrouted, usersWithoutStops };
        if (debug) payload._debug = { orderNumbersByClientCount: debugOrderNumbersByClientCount };
        payload._serverLog = serverLog;
        return NextResponse.json(
            payload,
            { headers: { "Cache-Control": "no-store" } }
        );
    } catch (e: any) {
        console.error("routes GET error", e);
        // Return empty set so UI doesn't crash
        return NextResponse.json({ routes: [], unrouted: [] }, { status: 200 });
    }
}

