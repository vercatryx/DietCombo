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
    const deliveryDateParam = url.searchParams.get("delivery_date"); // YYYY-MM-DD format

    console.log("[/api/mobile/stops] GET", { day, driverIdParam, deliveryDateParam }); // DEBUG

    // Build base where clause
    let whereClause = "";
    const whereParams: any[] = [];
    if (day !== "all") {
        whereClause = "WHERE day = ?";
        whereParams.push(day);
    }

    // If driverId provided, return that driver's stops in route order (driver_route_order when delivery_date set, else stop_ids or stops.order)
    if (driverIdParam) {
        const driverId = driverIdParam;
        if (!driverId) {
            return NextResponse.json({ error: "Invalid driverId" }, { status: 400 });
        }

        let stops: any[] = [];
        let ordered: any[] = [];

        if (deliveryDateParam) {
            const { data: routeOrder } = await supabase
                .from('driver_route_order')
                .select('client_id, position')
                .eq('driver_id', driverId)
                .order('position', { ascending: true })
                .order('client_id', { ascending: true });
            let stopsQuery = supabase
                .from('stops')
                .select('id, client_id, name, address, apt, city, state, zip, phone, lat, lng, order, completed, proof_url, delivery_date, order_id, assigned_driver_id')
                .eq('delivery_date', deliveryDateParam);
            if (day !== "all") stopsQuery = stopsQuery.eq('day', day);
            const { data: stopsData } = await stopsQuery;
            stops = stopsData || [];
            const clientIds = [...new Set(stops.map((s: any) => s.client_id).filter(Boolean))];
            const { data: clients } = clientIds.length > 0
                ? await supabase.from('clients').select('id, assigned_driver_id').in('id', clientIds)
                : { data: [] };
            const clientById = new Map((clients || []).map((c: any) => [String(c.id), c]));
            const byClient = new Map<string, any>();
            for (const s of stops) {
                const c = clientById.get(String(s.client_id));
                const assignedDriver = (c?.assigned_driver_id ?? s?.assigned_driver_id) ? String(c?.assigned_driver_id ?? s.assigned_driver_id) : null;
                if (assignedDriver === driverId && s.client_id) byClient.set(String(s.client_id), s);
            }
            ordered = (routeOrder || [])
                .map((r) => byClient.get(String(r.client_id)))
                .filter((s): s is NonNullable<typeof s> => Boolean(s));
        }

        // No stop_ids fallback — driver_route_order + client.assigned_driver_id only

        if (!ordered.length) {
            return NextResponse.json([], { headers: { "Cache-Control": "no-store" } });
        }

        // Fetch order information for all stops (same source as /orders page: orders table)
        const orderMapById = new Map<string, any>();
        const orderMapByClient = new Map<string, any>();
        const clientIdsForStops = [...new Set(ordered.map((s: any) => s.client_id).filter(Boolean))];
        const orderNumberByClientForDate = new Map<string, number>();
        if (deliveryDateParam && clientIdsForStops.length > 0) {
            const dateNorm = deliveryDateParam.split('T')[0].split(' ')[0];
            const { data: ordersForDate } = await supabase
                .from('orders')
                .select('client_id, order_number')
                .eq('scheduled_delivery_date', dateNorm)
                .in('client_id', clientIdsForStops)
                .not('order_number', 'is', null);
            if (ordersForDate?.length) {
                for (const row of ordersForDate) {
                    const cid = String(row.client_id);
                    const num = row.order_number != null ? Number(row.order_number) : null;
                    if (cid && num != null && Number.isFinite(num)) orderNumberByClientForDate.set(cid, num);
                }
            }
        }

        const orderIds = new Set<string>();
        for (const s of ordered) {
            if (s.order_id) orderIds.add(String(s.order_id));
        }
        
        // Fetch orders by order_id - prefer orders table (same source as /orders page), then fill gaps from upcoming_orders
        if (orderIds.size > 0) {
            const orderIdsArray = Array.from(orderIds);
            const { data: ordersById } = await supabase
                .from('orders')
                .select('id, client_id, created_at, scheduled_delivery_date, actual_delivery_date, status, order_number, proof_of_delivery_url')
                .in('id', orderIdsArray);
            if (ordersById?.length) {
                for (const order of ordersById) {
                    orderMapById.set(String(order.id), order);
                }
            }
            const { data: upcomingOrdersById } = await supabase
                .from('upcoming_orders')
                .select('id, client_id, created_at, scheduled_delivery_date, actual_delivery_date, status, order_number')
                .in('id', orderIdsArray);
            if (upcomingOrdersById?.length) {
                for (const order of upcomingOrdersById) {
                    const oid = String(order.id);
                    if (!orderMapById.has(oid)) orderMapById.set(oid, order);
                }
            }
            console.log(`[/api/mobile/stops] Found ${orderMapById.size} orders by order_id (orders preferred, same as /orders page)`);
        }
        
        const orderMapByClientAndDate = new Map<string, any>();
        const clientIds = clientIdsForStops;
        if (clientIds.length > 0) {
            const { data: orders } = await supabase
                .from('orders')
                .select('id, client_id, created_at, scheduled_delivery_date, actual_delivery_date, status, order_number')
                .in('client_id', clientIds)
                .not('status', 'eq', 'cancelled')
                .order('created_at', { ascending: false });
            
            const { data: upcomingOrders } = await supabase
                .from('upcoming_orders')
                .select('id, client_id, created_at, scheduled_delivery_date, actual_delivery_date, status, order_number')
                .in('client_id', clientIds)
                .not('status', 'eq', 'cancelled')
                .order('created_at', { ascending: false });
            
            // Use same source as /orders page: prefer orders table, then fill gaps from upcoming_orders
            const norm = (d: string | null | undefined) => d ? String(d).split('T')[0].split(' ')[0] : null;
            for (const order of orders || []) {
                const cid = String(order.client_id);
                if (!orderMapByClient.has(cid)) orderMapByClient.set(cid, order);
                const ds = norm(order.scheduled_delivery_date);
                if (ds) {
                    const key = `${cid}|${ds}`;
                    if (!orderMapByClientAndDate.has(key)) orderMapByClientAndDate.set(key, order);
                }
            }
            for (const order of upcomingOrders || []) {
                const cid = String(order.client_id);
                if (!orderMapByClient.has(cid)) orderMapByClient.set(cid, order);
                const ds = norm(order.scheduled_delivery_date);
                if (ds) {
                    const key = `${cid}|${ds}`;
                    if (!orderMapByClientAndDate.has(key)) orderMapByClientAndDate.set(key, order);
                }
            }
        }

        const normDate = (d: string | null | undefined) => d ? String(d).split('T')[0].split(' ')[0] : null;
        const dateNormForStops = deliveryDateParam ? deliveryDateParam.split('T')[0].split(' ')[0] : null;
        const mapped = ordered.map((s: any) => {
            let order = s.order_id ? orderMapById.get(String(s.order_id)) || null : null;
            const cid = s.client_id ? String(s.client_id) : '';
            const orderByDate = s.delivery_date ? orderMapByClientAndDate.get(`${cid}|${normDate(s.delivery_date) || ''}`) || null : null;
            const orderByClient = orderMapByClient.get(cid) || null;
            if (order && (order.order_number == null || order.order_number === '')) {
                const better = orderByDate ?? orderByClient;
                if (better?.order_number != null && better.order_number !== '') order = better;
            }
            if (!order) order = orderByDate ?? orderByClient ?? null;
            let orderNumber = order != null && order.order_number != null && order.order_number !== '' ? Number(order.order_number) : null;
            if (orderNumber == null && dateNormForStops && normDate(s.delivery_date) === dateNormForStops && cid) {
                const fromDirect = orderNumberByClientForDate.get(cid);
                if (fromDirect != null) orderNumber = fromDirect;
            }
            return {
                id: String(s.id),
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
                proofUrl: (s.proof_url && String(s.proof_url).trim()) || (order?.proof_of_delivery_url && String(order.proof_of_delivery_url).trim()) || null,
                delivery_date: s.delivery_date || null,
                orderId: order?.id || s.order_id || null,
                orderNumber,
                orderDate: order?.created_at || null,
                deliveryDate: s.delivery_date || order?.actual_delivery_date || order?.scheduled_delivery_date || null,
            };
        });

        console.log("[/api/mobile/stops] return (by driver):", mapped.length);
        return NextResponse.json(mapped, { headers: { "Cache-Control": "no-store" } });
    }

    // No driverId → return ALL stops for the day (flat array), ordered for stable UI
    let allQuery = supabase
        .from('stops')
        .select('id, client_id, name, address, apt, city, state, zip, phone, lat, lng, order, completed, proof_url, delivery_date, order_id')
        .order('assigned_driver_id', { ascending: true })
        .order('order', { ascending: true })
        .order('id', { ascending: true });
    
    if (day !== "all") {
        allQuery = allQuery.eq('day', day);
    }
    
    // Filter by delivery_date if provided
    if (deliveryDateParam) {
        allQuery = allQuery.eq('delivery_date', deliveryDateParam);
    }

        const { data: all, error: allError } = await allQuery;
        if (allError) {
            console.error("[/api/mobile/stops] Error fetching all stops:", allError);
            return NextResponse.json({ error: allError.message }, { status: 500 });
        }

        const orderMapById = new Map<string, any>();
        const orderMapByClient = new Map<string, any>();
        const clientIdsAll = [...new Set((all || []).map((s: any) => s.client_id).filter(Boolean))];
        const orderNumberByClientForDateAll = new Map<string, number>();
        if (deliveryDateParam && clientIdsAll.length > 0) {
            const dateNorm = deliveryDateParam.split('T')[0].split(' ')[0];
            const { data: ordersForDate } = await supabase
                .from('orders')
                .select('client_id, order_number')
                .eq('scheduled_delivery_date', dateNorm)
                .in('client_id', clientIdsAll)
                .not('order_number', 'is', null);
            if (ordersForDate?.length) {
                for (const row of ordersForDate) {
                    const cid = String(row.client_id);
                    const num = row.order_number != null ? Number(row.order_number) : null;
                    if (cid && num != null && Number.isFinite(num)) orderNumberByClientForDateAll.set(cid, num);
                }
            }
        }

        const orderIds = new Set<string>();
        for (const s of (all || [])) {
            if (s.order_id) orderIds.add(String(s.order_id));
        }
        if (orderIds.size > 0) {
            const orderIdsArray = Array.from(orderIds);
            const { data: ordersById } = await supabase
                .from('orders')
                .select('id, client_id, created_at, scheduled_delivery_date, actual_delivery_date, status, order_number, proof_of_delivery_url')
                .in('id', orderIdsArray);
            if (ordersById?.length) {
                for (const order of ordersById) {
                    orderMapById.set(String(order.id), order);
                }
            }
            const { data: upcomingOrdersById } = await supabase
                .from('upcoming_orders')
                .select('id, client_id, created_at, scheduled_delivery_date, actual_delivery_date, status, order_number')
                .in('id', orderIdsArray);
            if (upcomingOrdersById?.length) {
                for (const order of upcomingOrdersById) {
                    const oid = String(order.id);
                    if (!orderMapById.has(oid)) orderMapById.set(oid, order);
                }
            }
        }
        
        const orderMapByClientAndDate = new Map<string, any>();
        const clientIds = clientIdsAll;
        if (clientIds.length > 0) {
            const { data: orders } = await supabase
                .from('orders')
                .select('id, client_id, created_at, scheduled_delivery_date, actual_delivery_date, status, order_number')
                .in('client_id', clientIds)
                .not('status', 'eq', 'cancelled')
                .order('created_at', { ascending: false });
            
            const { data: upcomingOrders } = await supabase
                .from('upcoming_orders')
                .select('id, client_id, created_at, scheduled_delivery_date, actual_delivery_date, status, order_number')
                .in('client_id', clientIds)
                .not('status', 'eq', 'cancelled')
                .order('created_at', { ascending: false });
            
            // Use same source as /orders page: prefer orders table, then fill gaps from upcoming_orders
            const norm = (d: string | null | undefined) => d ? String(d).split('T')[0].split(' ')[0] : null;
            for (const order of orders || []) {
                const cid = String(order.client_id);
                if (!orderMapByClient.has(cid)) orderMapByClient.set(cid, order);
                const ds = norm(order.scheduled_delivery_date);
                if (ds) {
                    const key = `${cid}|${ds}`;
                    if (!orderMapByClientAndDate.has(key)) orderMapByClientAndDate.set(key, order);
                }
            }
            for (const order of upcomingOrders || []) {
                const cid = String(order.client_id);
                if (!orderMapByClient.has(cid)) orderMapByClient.set(cid, order);
                const ds = norm(order.scheduled_delivery_date);
                if (ds) {
                    const key = `${cid}|${ds}`;
                    if (!orderMapByClientAndDate.has(key)) orderMapByClientAndDate.set(key, order);
                }
            }
        }

        const normDate = (d: string | null | undefined) => d ? String(d).split('T')[0].split(' ')[0] : null;
        const dateNormAll = deliveryDateParam ? deliveryDateParam.split('T')[0].split(' ')[0] : null;
        const mapped = (all || []).map((s: any) => {
            let order = s.order_id ? orderMapById.get(String(s.order_id)) || null : null;
            const cid = s.client_id ? String(s.client_id) : '';
            const orderByDate = s.delivery_date ? orderMapByClientAndDate.get(`${cid}|${normDate(s.delivery_date) || ''}`) || null : null;
            const orderByClient = orderMapByClient.get(cid) || null;
            if (order && (order.order_number == null || order.order_number === '')) {
                const better = orderByDate ?? orderByClient;
                if (better?.order_number != null && better.order_number !== '') order = better;
            }
            if (!order) order = orderByDate ?? orderByClient ?? null;
            let orderNumber = order != null && order.order_number != null && order.order_number !== '' ? Number(order.order_number) : null;
            if (orderNumber == null && dateNormAll && normDate(s.delivery_date) === dateNormAll && cid) {
                const fromDirect = orderNumberByClientForDateAll.get(cid);
                if (fromDirect != null) orderNumber = fromDirect;
            }
            return {
                id: String(s.id),
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
                proofUrl: (s.proof_url && String(s.proof_url).trim()) || (order?.proof_of_delivery_url && String(order.proof_of_delivery_url).trim()) || null,
                delivery_date: s.delivery_date || null,
                orderId: order?.id || s.order_id || null,
                orderNumber,
                orderDate: order?.created_at || null,
                deliveryDate: s.delivery_date || order?.actual_delivery_date || order?.scheduled_delivery_date || null,
            };
        });

    console.log("[/api/mobile/stops] return (all day):", mapped.length); // DEBUG
    return NextResponse.json(mapped, { headers: { "Cache-Control": "no-store" } });
}

