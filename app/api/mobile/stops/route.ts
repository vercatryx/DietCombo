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
                .select('id, client_id, name, address, apt, city, state, zip, phone, lat, lng, order, completed, proof_url, delivery_date, order_id')
                .eq('assigned_driver_id', driverId)
                .eq('delivery_date', deliveryDateParam);
            if (day !== "all") stopsQuery = stopsQuery.eq('day', day);
            const { data: stopsData } = await stopsQuery;
            stops = stopsData || [];
            const byClient = new Map<string, any>();
            for (const s of stops) if (s.client_id) byClient.set(String(s.client_id), s);
            ordered = (routeOrder || [])
                .map((r) => byClient.get(String(r.client_id)))
                .filter((s): s is NonNullable<typeof s> => Boolean(s));
        }

        if (ordered.length === 0) {
            const { data: driverData, error: driverError } = await supabase
                .from('drivers')
                .select('stop_ids')
                .eq('id', driverId)
                .single();
            if (driverError) {
                const { data: routeRow } = await supabase.from('routes').select('stop_ids').eq('id', driverId).maybeSingle();
                if (!routeRow) return NextResponse.json({ error: "Driver not found" }, { status: 404 });
                const rawIds = Array.isArray(routeRow.stop_ids) ? routeRow.stop_ids : (typeof routeRow.stop_ids === 'string' ? JSON.parse(routeRow.stop_ids || '[]') : []);
                const orderedIds = rawIds.map((id: any) => String(id)).filter((id: string) => id && id.trim().length > 0);
                let q = supabase.from('stops').select('id, client_id, name, address, apt, city, state, zip, phone, lat, lng, order, completed, proof_url, delivery_date, order_id').in('id', orderedIds);
                if (day !== "all") q = q.eq('day', day);
                if (deliveryDateParam) q = q.eq('delivery_date', deliveryDateParam);
                const { data: stopsData } = await q;
                stops = stopsData || [];
                const byId = new Map(stops.map((s) => [String(s.id), s]));
                ordered = orderedIds.map((id: string) => byId.get(id)).filter((s: unknown): s is NonNullable<typeof s> => Boolean(s));
            } else {
                const driver = driverData;
                const orderedIds: string[] = driver?.stop_ids
                    ? (Array.isArray(driver.stop_ids) ? driver.stop_ids : (typeof driver.stop_ids === 'string' ? JSON.parse(driver.stop_ids || '[]') : []))
                        .map((id: any) => String(id))
                        .filter((id: string) => id && id.trim().length > 0)
                    : [];
                if (orderedIds.length === 0) return NextResponse.json([], { headers: { "Cache-Control": "no-store" } });
                let q = supabase.from('stops').select('id, client_id, name, address, apt, city, state, zip, phone, lat, lng, order, completed, proof_url, delivery_date, order_id').in('id', orderedIds);
                if (day !== "all") q = q.eq('day', day);
                if (deliveryDateParam) q = q.eq('delivery_date', deliveryDateParam);
                const { data: stopsData } = await q;
                stops = stopsData || [];
                const byId = new Map(stops.map((s) => [String(s.id), s]));
                ordered = orderedIds.map((id: string) => byId.get(id)).filter((s: unknown): s is NonNullable<typeof s> => Boolean(s));
            }
        }

        if (!ordered.length) {
            return NextResponse.json([], { headers: { "Cache-Control": "no-store" } });
        }

        // Fetch order information for all stops
        // Priority: Use stop.order_id to directly look up orders from upcoming_orders first, then orders table
        // Fallback: Match by client_id for stops without order_id
        const orderMapById = new Map<string, any>(); // key: order_id (direct lookup)
        const orderMapByClient = new Map<string, any>(); // key: client_id (fallback)
        
        // Collect all unique order_ids from stops
        const orderIds = new Set<string>();
        for (const s of ordered) {
            if (s.order_id) {
                orderIds.add(String(s.order_id));
            }
        }
        
        // Fetch orders by order_id - check upcoming_orders first, then orders
        if (orderIds.size > 0) {
            const orderIdsArray = Array.from(orderIds);
            
            // First check upcoming_orders table
            const { data: upcomingOrdersById } = await supabase
                .from('upcoming_orders')
                .select('id, client_id, created_at, scheduled_delivery_date, actual_delivery_date, status')
                .in('id', orderIdsArray);
            
            if (upcomingOrdersById) {
                for (const order of upcomingOrdersById) {
                    orderMapById.set(String(order.id), order);
                }
            }
            
            // Then check orders table for any order_ids not found in upcoming_orders
            const foundOrderIds = new Set(upcomingOrdersById?.map(o => String(o.id)) || []);
            const missingOrderIds = orderIdsArray.filter(id => !foundOrderIds.has(id));
            
            if (missingOrderIds.length > 0) {
                const { data: ordersById } = await supabase
                    .from('orders')
                    .select('id, client_id, created_at, scheduled_delivery_date, actual_delivery_date, status')
                    .in('id', missingOrderIds);
                
                if (ordersById) {
                    for (const order of ordersById) {
                        orderMapById.set(String(order.id), order);
                    }
                }
            }
            
            console.log(`[/api/mobile/stops] Found ${orderMapById.size} orders by order_id (${upcomingOrdersById?.length || 0} from upcoming_orders, ${missingOrderIds.length > 0 ? orderMapById.size - (upcomingOrdersById?.length || 0) : 0} from orders)`);
        }
        
        // Also fetch orders by client_id for fallback matching (for stops without order_id)
        const clientIds = [...new Set(ordered.map((s: any) => s.client_id).filter(Boolean))];
        
        if (clientIds.length > 0) {
            // Get the most recent order for each client - expand status filter to include more statuses
            // Also check upcoming_orders table
            const { data: orders } = await supabase
                .from('orders')
                .select('id, client_id, created_at, scheduled_delivery_date, actual_delivery_date, status')
                .in('client_id', clientIds)
                .not('status', 'eq', 'cancelled')
                .order('created_at', { ascending: false });
            
            // Also check upcoming_orders
            const { data: upcomingOrders } = await supabase
                .from('upcoming_orders')
                .select('id, client_id, created_at, scheduled_delivery_date, actual_delivery_date, status')
                .in('client_id', clientIds)
                .not('status', 'eq', 'cancelled')
                .order('created_at', { ascending: false });
            
            console.log(`[/api/mobile/stops] Found ${orders?.length || 0} orders and ${upcomingOrders?.length || 0} upcoming orders for ${clientIds.length} clients (for fallback matching)`);
            
            // Combine both order sources, prioritizing regular orders
            const allOrders = [...(orders || []), ...(upcomingOrders || [])];
            
            if (allOrders.length > 0) {
                // Group orders by client_id and pick the most recent one for each client
                for (const order of allOrders) {
                    const cid = String(order.client_id);
                    if (!orderMapByClient.has(cid)) {
                        orderMapByClient.set(cid, order);
                    }
                }
                console.log(`[/api/mobile/stops] Mapped ${orderMapByClient.size} orders to clients (for fallback)`);
            } else {
                console.warn(`[/api/mobile/stops] No orders found for any of the ${clientIds.length} clients`);
            }
        }

        // Map to expected format (keep id as string if it's a UUID, or convert if it's numeric)
        const mapped = ordered.map((s: any) => {
            // Priority: Use stop.order_id to look up order directly
            // Fallback: Match by client_id if no order_id or direct lookup fails
            let order = null;
            
            if (s.order_id) {
                order = orderMapById.get(String(s.order_id)) || null;
            }
            
            if (!order && s.client_id) {
                order = orderMapByClient.get(String(s.client_id)) || null;
                if (!order) {
                    console.log(`[/api/mobile/stops] No order found for stop ${s.id} with client_id ${s.client_id}`);
                }
            }
            
            return {
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
                // Include stop's delivery_date field (primary source)
                delivery_date: s.delivery_date || null,
                // Also include order tracking fields as fallback
                orderId: order?.id || s.order_id || null,
                orderDate: order?.created_at || null,
                deliveryDate: s.delivery_date || order?.actual_delivery_date || order?.scheduled_delivery_date || null,
            };
        });

        console.log("[/api/mobile/stops] return (by driver):", mapped.length); // DEBUG
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

        // Fetch order information for all stops
        // Priority: Use stop.order_id to directly look up orders from upcoming_orders first, then orders table
        // Fallback: Match by client_id for stops without order_id
        const orderMapById = new Map<string, any>(); // key: order_id (direct lookup)
        const orderMapByClient = new Map<string, any>(); // key: client_id (fallback)
        
        // Collect all unique order_ids from stops
        const orderIds = new Set<string>();
        for (const s of (all || [])) {
            if (s.order_id) {
                orderIds.add(String(s.order_id));
            }
        }
        
        // Fetch orders by order_id - check upcoming_orders first, then orders
        if (orderIds.size > 0) {
            const orderIdsArray = Array.from(orderIds);
            
            // First check upcoming_orders table
            const { data: upcomingOrdersById } = await supabase
                .from('upcoming_orders')
                .select('id, client_id, created_at, scheduled_delivery_date, actual_delivery_date, status')
                .in('id', orderIdsArray);
            
            if (upcomingOrdersById) {
                for (const order of upcomingOrdersById) {
                    orderMapById.set(String(order.id), order);
                }
            }
            
            // Then check orders table for any order_ids not found in upcoming_orders
            const foundOrderIds = new Set(upcomingOrdersById?.map(o => String(o.id)) || []);
            const missingOrderIds = orderIdsArray.filter(id => !foundOrderIds.has(id));
            
            if (missingOrderIds.length > 0) {
                const { data: ordersById } = await supabase
                    .from('orders')
                    .select('id, client_id, created_at, scheduled_delivery_date, actual_delivery_date, status')
                    .in('id', missingOrderIds);
                
                if (ordersById) {
                    for (const order of ordersById) {
                        orderMapById.set(String(order.id), order);
                    }
                }
            }
            
            console.log(`[/api/mobile/stops] Found ${orderMapById.size} orders by order_id (${upcomingOrdersById?.length || 0} from upcoming_orders, ${missingOrderIds.length > 0 ? orderMapById.size - (upcomingOrdersById?.length || 0) : 0} from orders)`);
        }
        
        // Also fetch orders by client_id for fallback matching (for stops without order_id)
        const clientIds = [...new Set((all || []).map((s: any) => s.client_id).filter(Boolean))];
        
        if (clientIds.length > 0) {
            // Get the most recent order for each client - expand status filter to include more statuses
            // Also check upcoming_orders table
            const { data: orders } = await supabase
                .from('orders')
                .select('id, client_id, created_at, scheduled_delivery_date, actual_delivery_date, status')
                .in('client_id', clientIds)
                .not('status', 'eq', 'cancelled')
                .order('created_at', { ascending: false });
            
            // Also check upcoming_orders
            const { data: upcomingOrders } = await supabase
                .from('upcoming_orders')
                .select('id, client_id, created_at, scheduled_delivery_date, actual_delivery_date, status')
                .in('client_id', clientIds)
                .not('status', 'eq', 'cancelled')
                .order('created_at', { ascending: false });
            
            console.log(`[/api/mobile/stops] Found ${orders?.length || 0} orders and ${upcomingOrders?.length || 0} upcoming orders for ${clientIds.length} clients (for fallback matching)`);
            
            // Combine both order sources, prioritizing regular orders
            const allOrders = [...(orders || []), ...(upcomingOrders || [])];
            
            if (allOrders.length > 0) {
                // Group orders by client_id and pick the most recent one for each client
                for (const order of allOrders) {
                    const cid = String(order.client_id);
                    if (!orderMapByClient.has(cid)) {
                        orderMapByClient.set(cid, order);
                    }
                }
                console.log(`[/api/mobile/stops] Mapped ${orderMapByClient.size} orders to clients (for fallback)`);
            } else {
                console.warn(`[/api/mobile/stops] No orders found for any of the ${clientIds.length} clients`);
            }
        }

    // Map to expected format (keep id as string for UUID compatibility)
    const mapped = (all || []).map((s: any) => {
        // Priority: Use stop.order_id to look up order directly
        // Fallback: Match by client_id if no order_id or direct lookup fails
        let order = null;
        
        if (s.order_id) {
            order = orderMapById.get(String(s.order_id)) || null;
        }
        
        if (!order && s.client_id) {
            order = orderMapByClient.get(String(s.client_id)) || null;
        }
        
        return {
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
            // Include stop's delivery_date field (primary source)
            delivery_date: s.delivery_date || null,
            // Also include order tracking fields as fallback
            orderId: order?.id || s.order_id || null,
            orderDate: order?.created_at || null,
            deliveryDate: s.delivery_date || order?.actual_delivery_date || order?.scheduled_delivery_date || null,
        };
    });

    console.log("[/api/mobile/stops] return (all day):", mapped.length); // DEBUG
    return NextResponse.json(mapped, { headers: { "Cache-Control": "no-store" } });
}

