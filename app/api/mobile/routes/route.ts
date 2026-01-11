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

        // 1) Fetch drivers (include day="all" when a specific day is requested)
        let driversQuery = supabase
            .from('drivers')
            .select('id, name, color, stop_ids')
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
                .select('id, name, color, stop_ids, driver_id')
                .order('id', { ascending: true });
            if (error) throw error;
            routesRaw = data || [];
        } catch (e: any) {
            // If driver_id column doesn't exist, query without it
            if (e?.message?.includes('driver_id') || e?.code === 'PGRST116') {
                const { data, error: retryError } = await supabase
                    .from('routes')
                    .select('id, name, color, stop_ids')
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
        console.log("[mobile/routes] total (drivers + routes):", drivers.length);

        // 2) Collect unique stopIds (keep as strings since they are UUIDs)
        const allStopIds = Array.from(
            new Set(
                drivers.flatMap((d) => {
                    try {
                        const stopIds = Array.isArray(d.stop_ids) ? d.stop_ids : 
                            (typeof d.stop_ids === 'string' ? JSON.parse(d.stop_ids) : []);
                        return stopIds
                            .map((id: any) => String(id))
                            .filter((id: string) => id && id.trim().length > 0);
                    } catch (parseError) {
                        console.warn(`[mobile/routes] Failed to parse stop_ids for driver ${d.id}:`, parseError);
                        return [];
                    }
                })
            )
        );
        console.log("[mobile/routes] unique stopIds from drivers:", allStopIds.length);

        // 3) Load minimal stop info to compute progress
        // First, get stops by stop_ids
        let stops: any[] = [];
        if (allStopIds.length > 0) {
            const { data: stopsByIds, error: stopsByIdsError } = await supabase
                .from('stops')
                .select('id, completed, assigned_driver_id')
                .in('id', allStopIds);
            if (stopsByIdsError) {
                console.error("[mobile/routes] Error fetching stops by IDs:", stopsByIdsError);
            } else {
                stops = stopsByIds || [];
                console.log("[mobile/routes] Found", stops.length, "stops by stop_ids");
            }
        }
        
        // Also get stops by assigned_driver_id for drivers that don't have stop_ids set
        // This handles cases where stops are linked to drivers via assigned_driver_id instead of stop_ids
        const driverIds = drivers.map(d => String(d.id));
        if (driverIds.length > 0) {
            const { data: stopsByDriverId, error: stopsByDriverIdError } = await supabase
                .from('stops')
                .select('id, completed, assigned_driver_id')
                .in('assigned_driver_id', driverIds);
            
            if (stopsByDriverIdError) {
                console.error("[mobile/routes] Error fetching stops by driver_id:", stopsByDriverIdError);
            } else if (stopsByDriverId && stopsByDriverId.length > 0) {
                // Merge with existing stops, avoiding duplicates
                const existingStopIds = new Set(stops.map(s => String(s.id)));
                const newStops = stopsByDriverId.filter(s => !existingStopIds.has(String(s.id)));
                stops = [...stops, ...newStops];
                console.log("[mobile/routes] Found", newStops.length, "additional stops via assigned_driver_id");
            }
        }
        
        // If we still have no stops, try fetching all stops for the day to see if any exist
        if (stops.length === 0 && driverIds.length > 0) {
            console.log("[mobile/routes] No stops found via stop_ids or assigned_driver_id, checking all stops for day:", dayParam);
            let allStopsQuery = supabase
                .from('stops')
                .select('id, completed, assigned_driver_id, day')
                .limit(100);
            
            if (dayParam !== "all") {
                allStopsQuery = allStopsQuery.eq('day', dayParam);
            }
            
            const { data: allStops, error: allStopsError } = await allStopsQuery;
            if (allStopsError) {
                console.error("[mobile/routes] Error fetching all stops:", allStopsError);
            } else {
                console.log("[mobile/routes] Total stops in database for day:", allStops?.length || 0);
                if (allStops && allStops.length > 0) {
                    console.log("[mobile/routes] Sample stop:", {
                        id: allStops[0].id,
                        assigned_driver_id: allStops[0].assigned_driver_id,
                        day: allStops[0].day
                    });
                }
            }
        }

        const stopById = new Map<string, any>();
        for (const s of stops) stopById.set(String(s.id), s);
        console.log("[mobile/routes] Total unique stops loaded:", stopById.size);

        // 4) Shape per driver
        const shaped = drivers.map((d) => {
            try {
                // Get stop IDs from stop_ids field
                const rawIds = Array.isArray(d.stop_ids) ? d.stop_ids : 
                    (typeof d.stop_ids === 'string' ? JSON.parse(d.stop_ids) : []);
                const stopIdsFromField = rawIds
                    .map((id: any) => String(id))
                    .filter((id: string) => id && id.trim().length > 0);
                
                // Also get stops assigned to this driver via assigned_driver_id
                const stopsByDriver = Array.from(stopById.values())
                    .filter((s: any) => String(s.assigned_driver_id) === String(d.id))
                    .map((s: any) => String(s.id));
                
                // Combine both sources, removing duplicates
                const allStopIdsForDriver = Array.from(new Set([...stopIdsFromField, ...stopsByDriver]));
                
                // Filter to only include stops that actually exist
                const filteredIds = allStopIdsForDriver.filter((id: string) => stopById.has(id));

                let completed = 0;
                for (const sid of filteredIds) {
                    const st = stopById.get(sid);
                    if (st && st.completed) completed++;
                }

                return {
                    id: d.id,
                    name: d.name,
                    color: d.color ?? null,
                    routeNumber: d.id, // keeps "Route {id}" labeling if you use it in UI
                    stopIds: filteredIds,
                    totalStops: filteredIds.length,
                    completedStops: completed,
                };
            } catch (parseError) {
                console.warn(`[mobile/routes] Error processing driver ${d.id}:`, parseError);
                // Fallback: try to get stops by assigned_driver_id only
                const stopsByDriver = Array.from(stopById.values())
                    .filter((s: any) => String(s.assigned_driver_id) === String(d.id))
                    .map((s: any) => String(s.id));
                
                const completed = stopsByDriver.filter((id: string) => {
                    const st = stopById.get(id);
                    return st && st.completed;
                }).length;
                
                return {
                    id: d.id,
                    name: d.name,
                    color: d.color ?? null,
                    routeNumber: d.id,
                    stopIds: stopsByDriver,
                    totalStops: stopsByDriver.length,
                    completedStops: completed,
                };
            }
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

