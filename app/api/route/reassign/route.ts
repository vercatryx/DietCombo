// app/api/route/reassign/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

const sid = (v: any) => (v === null || v === undefined ? "" : String(v));

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const day = body?.day || "all";
        const toDriverId = String(body?.toDriverId);
        const stopId = String(body?.stopId ?? body?.id);
        const userId = body?.userId ? String(body.userId) : null;

        if (!toDriverId || (!stopId && !userId)) {
            return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
        }

        // Resolve stop by stopId or userId
        let stop: any;
        if (stopId) {
            const { data: stops } = await supabase
                .from('stops')
                .select('*')
                .eq('id', stopId)
                .eq('day', day)
                .limit(1);
            stop = stops?.[0];
        } else if (userId) {
            const { data: stops } = await supabase
                .from('stops')
                .select('*')
                .eq('client_id', userId)
                .eq('day', day)
                .limit(1);
            stop = stops?.[0];
        }

        if (!stop) return NextResponse.json({ error: "Stop not found for this day" }, { status: 404 });

        // Fetch drivers for day (also check routes table like routes API does)
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
        
        // Convert routes to drivers format (add day field)
        const routesAsDrivers = routesRaw?.map((r: any) => ({
            ...r,
            day: day === "all" ? "all" : day,
        })) || [];
        
        // Combine drivers and routes
        const drivers = [...(driversRaw || []), ...routesAsDrivers];
        
        // Debug logging
        console.log(`[reassign] Looking for driver with ID: "${toDriverId}" (type: ${typeof toDriverId})`);
        console.log(`[reassign] Found ${driversRaw?.length || 0} drivers and ${routesRaw?.length || 0} routes for day="${day}"`);
        console.log(`[reassign] Total drivers available: ${drivers.length}`);
        if (drivers && drivers.length > 0) {
            console.log(`[reassign] Driver IDs:`, drivers.map(d => ({ id: d.id, name: d.name })));
        }
        
        const toDriver = drivers.find((d) => String(d.id) === String(toDriverId));
        if (!toDriver) {
            console.error(`[reassign] Target driver not found. Looking for: "${toDriverId}", Available IDs:`, drivers.map(d => d.id) || []);
            return NextResponse.json({ error: "Target driver not found" }, { status: 404 });
        }
        
        console.log(`[reassign] Found target driver:`, { id: toDriver.id, name: toDriver.name });

        // Determine which table the driver is in (drivers or routes)
        const isInDriversTable = driversRaw?.some((d: any) => String(d.id) === String(toDriver.id));
        const driverTable = isInDriversTable ? 'drivers' : 'routes';
        
        console.log(`[reassign] Driver is in "${driverTable}" table`);

        // Remove from any current owner (filter stale duplicates too)
        for (const d of drivers) {
            const stopIds = Array.isArray(d.stop_ids) ? d.stop_ids : (typeof d.stop_ids === "string" ? JSON.parse(d.stop_ids) : []);
            const arr = Array.isArray(stopIds) ? stopIds : [];
            const next = arr.filter((v: any) => sid(v) !== sid(stop.id));
            if (next.length !== arr.length) {
                // Determine which table this driver is in
                const dIsInDriversTable = driversRaw?.some((dr: any) => String(dr.id) === String(d.id));
                const dTable = dIsInDriversTable ? 'drivers' : 'routes';
                
                await supabase
                    .from(dTable)
                    .update({ stop_ids: next })
                    .eq('id', d.id);
            }
        }

        // Add once to target
        const stopIds = Array.isArray(toDriver.stop_ids) ? toDriver.stop_ids : (typeof toDriver.stop_ids === "string" ? JSON.parse(toDriver.stop_ids) : []);
        const tgt = Array.isArray(stopIds) ? [...stopIds] : [];
        if (!tgt.map(sid).includes(sid(stop.id))) tgt.push(stop.id);
        
        console.log(`[reassign] Updating ${driverTable} table with stop_ids:`, tgt);
        
        await supabase
            .from(driverTable)
            .update({ stop_ids: tgt })
            .eq('id', toDriver.id);

        // Mirror convenience - update stops table
        await supabase
            .from('stops')
            .update({ assigned_driver_id: toDriver.id })
            .eq('id', stop.id);
        
        console.log(`[reassign] Successfully updated driver and stop assignments`);

        return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    } catch (e: any) {
        console.error("reassign error", e);
        return NextResponse.json({ error: "Server error" }, { status: 500 });
    }
}

