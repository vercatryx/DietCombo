// app/api/mobile/routes/route.ts
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * Returns lightweight route summaries for mobile:
 * - id, name, color
 * - stopIds (existing only)
 * - totalStops, completedStops
 *
 * Supports ?day=<monday|tuesday|...|all>
 * When a specific day is requested, we also include drivers with day="all"
 * so generation done with day="all" still powers the mobile view.
 */
export async function GET(req: Request) {
    const t0 = Date.now();
    console.log("[mobile/routes] GET start");
    
    // Check if we're using service role key
    const isUsingServiceKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!isUsingServiceKey) {
        console.warn("[mobile/routes] ⚠️  Not using service role key - RLS may block queries");
    }

    try {
        const { searchParams } = new URL(req.url);
        const dayParam = (searchParams.get("day") ?? "all").toLowerCase();
        const deliveryDateParam = searchParams.get("delivery_date"); // YYYY-MM-DD format

        // 1) Fetch drivers (include day="all" when a specific day is requested)
        let driversQuery = supabase
            .from('drivers')
            .select('id, name, color')
            .order('id', { ascending: true });
        
        if (dayParam !== "all") {
            driversQuery = driversQuery.or(`day.eq.${dayParam},day.eq.all`);
        }

        const { data: driversRaw, error: driversError } = await driversQuery;
        if (driversError) {
            console.error("[mobile/routes] Error fetching drivers:", driversError);
        }
        const driversData = driversRaw || [];
        console.log("[mobile/routes] drivers:", driversData.length, "day:", dayParam);

        // Also check routes table (legacy table without day field)
        // Routes table records are treated as applicable to all days
        // Check if routes table has a driver_id field (for assignment) and filter accordingly
        let routesRaw: any[] = [];
        try {
            // Try to query with driver_id if the column exists
            const { data, error } = await supabase
                .from('routes')
                .select('id, name, color, driver_id')
                .order('id', { ascending: true });
            if (error) throw error;
            routesRaw = data || [];
        } catch (e: any) {
            // If driver_id column doesn't exist, query without it
            if (e?.message?.includes('driver_id') || e?.code === 'PGRST116') {
                const { data, error: retryError } = await supabase
                    .from('routes')
                    .select('id, name, color')
                    .order('id', { ascending: true });
                if (retryError) throw retryError;
                routesRaw = data || [];
            } else {
                throw e;
            }
        }
        console.log("[mobile/routes] routes:", routesRaw.length);

        // If routes have driver_id assigned, we only include routes that match drivers
        // Otherwise, include all routes (like the admin endpoint does)
        let routesToInclude: any[] = routesRaw;
        
        // Check if any route has a driver_id field
        const hasDriverIdField = routesRaw.length > 0 && 'driver_id' in routesRaw[0];
        if (hasDriverIdField) {
            // Filter routes to only those assigned to drivers (driver_id is not null)
            // Or routes where driver_id matches a driver's id
            const driverIds = new Set(driversData.map(d => String(d.id)));
            routesToInclude = routesRaw.filter((r: any) => {
                const routeDriverId = r.driver_id ? String(r.driver_id) : null;
                // Include routes assigned to a driver if that driver exists in our list
                return routeDriverId && driverIds.has(routeDriverId);
            });
            console.log("[mobile/routes] routes with assigned drivers:", routesToInclude.length);
        }

        // Convert routes to drivers format (add day field, default to "all" or current day)
        const routesAsDrivers = routesToInclude.map((r: any) => ({
            ...r,
            day: dayParam === "all" ? "all" : dayParam, // Use current day or "all" if querying all
        }));

        // Combine drivers and routes
        const drivers = [...driversData, ...routesAsDrivers];
        const driverIds = drivers.map(d => String(d.id));
        console.log("[mobile/routes] total (drivers + routes):", drivers.length);

        // driver_route_order + client.assigned_driver_id only (no stop_ids — allows DB column removal)
        let stops: any[] = [];
        let routeOrderByDriver: Map<string, { client_id: string }[]> = new Map();

        if (driverIds.length > 0) {
            const { data: routeOrderRows } = await supabase
                .from('driver_route_order')
                .select('driver_id, client_id, position')
                .in('driver_id', driverIds)
                .order('position', { ascending: true })
                .order('client_id', { ascending: true });
            for (const row of routeOrderRows || []) {
                const did = String(row.driver_id);
                if (!routeOrderByDriver.has(did)) routeOrderByDriver.set(did, []);
                routeOrderByDriver.get(did)!.push({ client_id: String(row.client_id) });
            }
            let rawStops: any[] = [];
            if (deliveryDateParam) {
            const { data: stopsForDate } = await supabase
                .from('stops')
                .select('id, completed, delivery_date, client_id, assigned_driver_id')
                .eq('delivery_date', deliveryDateParam);
                rawStops = stopsForDate || [];
            } else {
                // No delivery_date: get stops by day (no stop_ids)
                let stopsQuery = supabase.from('stops').select('id, completed, delivery_date, client_id, assigned_driver_id');
                if (dayParam !== "all") stopsQuery = stopsQuery.eq('day', dayParam);
                const { data: byDay } = await stopsQuery;
                rawStops = byDay || [];
            }
            const cids = [...new Set(rawStops.map((s: any) => s.client_id).filter(Boolean))];
            const { data: clients } = cids.length > 0
                ? await supabase.from('clients').select('id, assigned_driver_id').in('id', cids)
                : { data: [] };
            const clientById = new Map((clients || []).map((c: any) => [String(c.id), c]));
            stops = rawStops.filter((s: any) => {
                const c = clientById.get(String(s.client_id));
                const driverId = (c?.assigned_driver_id ?? s?.assigned_driver_id) ? String(c?.assigned_driver_id ?? s.assigned_driver_id) : null;
                return driverId && driverIds.includes(driverId);
            });
        }

        const stopById = new Map<string, any>();
        const stopByDriverAndClient = new Map<string, any>(); // key: `${driverId}|${clientId}` - uses client.assigned_driver_id
        const clientByIdForStops = new Map<string, any>();
        if (stops.length > 0) {
            const cids = [...new Set(stops.map((s: any) => s.client_id).filter(Boolean))];
            const { data: clientsForStops } = cids.length > 0
                ? await supabase.from('clients').select('id, assigned_driver_id').in('id', cids)
                : { data: [] };
            (clientsForStops || []).forEach((c: any) => clientByIdForStops.set(String(c.id), c));
        }
        for (const s of stops) {
            stopById.set(String(s.id), s);
            const c = clientByIdForStops.get(String(s.client_id));
            const driverId = c?.assigned_driver_id ?? s?.assigned_driver_id ?? null;
            if (driverId != null && s.client_id != null) {
                stopByDriverAndClient.set(`${String(driverId)}|${String(s.client_id)}`, s);
            }
        }
        console.log("[mobile/routes] Total unique stops loaded:", stopById.size);

        // Shape per driver: driver_route_order order when available, else client.assigned_driver_id only
        const shaped = drivers.map((d) => {
            const did = String(d.id);
            let filteredIds: string[];
            const orderList = routeOrderByDriver.get(did);
            if (orderList && orderList.length > 0) {
                filteredIds = orderList
                    .map((row) => stopByDriverAndClient.get(`${did}|${row.client_id}`))
                    .filter(Boolean)
                    .map((s: any) => String(s.id));
            } else {
                // No stop_ids — use client.assigned_driver_id only (allows DB column removal)
                filteredIds = Array.from(stopById.values())
                    .filter((s: any) => {
                        const c = clientByIdForStops.get(String(s.client_id));
                        const driverId = (c?.assigned_driver_id ?? s?.assigned_driver_id) ? String(c?.assigned_driver_id ?? s.assigned_driver_id) : null;
                        return driverId === did;
                    })
                    .map((s: any) => String(s.id));
            }
            let completed = 0;
            for (const sid of filteredIds) {
                const st = stopById.get(sid);
                if (st && st.completed) completed++;
            }
            return {
                id: d.id,
                name: d.name,
                color: d.color ?? null,
                routeNumber: d.id,
                stopIds: filteredIds,
                totalStops: filteredIds.length,
                completedStops: completed,
            };
        });

        // 5) Hide drivers with no stops so mobile only shows live routes
        const activeOnly = shaped.filter((r) => r.totalStops > 0);

        console.log(
            "[mobile/routes] shaped(active):",
            activeOnly.length,
            "in",
            Date.now() - t0,
            "ms"
        );

        return NextResponse.json(activeOnly, {
            headers: { "Cache-Control": "no-store" },
        });
    } catch (e) {
        console.error("[mobile/routes] error:", e);
        // Return empty (200) so the mobile UI can still render gracefully
        return NextResponse.json([], { status: 200 });
    }
}

