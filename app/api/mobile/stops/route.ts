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
        const { data: driverData, error: driverError } = await supabase
            .from('drivers')
            .select('stop_ids')
            .eq('id', driverId)
            .single();
        if (driverError) {
            console.error("[/api/mobile/stops] Error fetching driver:", driverError);
            return NextResponse.json({ error: "Driver not found" }, { status: 404 });
        }
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

        // Fetch order information for all stops
        const clientIds = [...new Set(ordered.map((s: any) => s.client_id).filter(Boolean))];
        const orderMap = new Map<string, any>();
        
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
            
            console.log(`[/api/mobile/stops] Found ${orders?.length || 0} orders and ${upcomingOrders?.length || 0} upcoming orders for ${clientIds.length} clients`);
            
            // Combine both order sources, prioritizing regular orders
            const allOrders = [...(orders || []), ...(upcomingOrders || [])];
            
            if (allOrders.length > 0) {
                // Group orders by client_id and pick the most recent one for each client
                for (const order of allOrders) {
                    const cid = String(order.client_id);
                    if (!orderMap.has(cid)) {
                        orderMap.set(cid, order);
                    }
                }
                console.log(`[/api/mobile/stops] Mapped ${orderMap.size} orders to clients`);
            } else {
                console.warn(`[/api/mobile/stops] No orders found for any of the ${clientIds.length} clients`);
            }
        }

        // Map to expected format (keep id as string if it's a UUID, or convert if it's numeric)
        const mapped = ordered.map((s: any) => {
            const order = orderMap.get(String(s.client_id));
            if (!order && s.client_id) {
                console.log(`[/api/mobile/stops] No order found for stop ${s.id} with client_id ${s.client_id}`);
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
                // Temporarily add order tracking fields
                orderId: order?.id || null,
                orderDate: order?.created_at || null,
                deliveryDate: order?.actual_delivery_date || order?.scheduled_delivery_date || null,
            };
        });

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

        const { data: all, error: allError } = await allQuery;
        if (allError) {
            console.error("[/api/mobile/stops] Error fetching all stops:", allError);
            return NextResponse.json({ error: allError.message }, { status: 500 });
        }

        // Fetch order information for all stops
        const clientIds = [...new Set((all || []).map((s: any) => s.client_id).filter(Boolean))];
        const orderMap = new Map<string, any>();
        
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
            
            console.log(`[/api/mobile/stops] Found ${orders?.length || 0} orders and ${upcomingOrders?.length || 0} upcoming orders for ${clientIds.length} clients`);
            
            // Combine both order sources, prioritizing regular orders
            const allOrders = [...(orders || []), ...(upcomingOrders || [])];
            
            if (allOrders.length > 0) {
                // Group orders by client_id and pick the most recent one for each client
                for (const order of allOrders) {
                    const cid = String(order.client_id);
                    if (!orderMap.has(cid)) {
                        orderMap.set(cid, order);
                    }
                }
                console.log(`[/api/mobile/stops] Mapped ${orderMap.size} orders to clients`);
            } else {
                console.warn(`[/api/mobile/stops] No orders found for any of the ${clientIds.length} clients`);
            }
        }

    // Map to expected format (keep id as string for UUID compatibility)
    const mapped = (all || []).map((s: any) => {
        const order = orderMap.get(String(s.client_id));
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
            // Temporarily add order tracking fields
            orderId: order?.id || null,
            orderDate: order?.created_at || null,
            deliveryDate: order?.actual_delivery_date || order?.scheduled_delivery_date || null,
        };
    });

    console.log("[/api/mobile/stops] return (all day):", mapped.length); // DEBUG
    return NextResponse.json(mapped, { headers: { "Cache-Control": "no-store" } });
}

