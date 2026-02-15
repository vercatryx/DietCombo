// app/api/route/reassign/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const toDriverId = String(body?.toDriverId);
        const stopId = String(body?.stopId ?? body?.id);
        const userId = body?.userId ? String(body.userId) : null;

        if (!toDriverId || (!stopId && !userId)) {
            return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
        }

        // Resolve stop by stopId or userId
        // TODO: Temporarily disabled day filter - moving to delivery_date basis
        let stop: any;
        if (stopId) {
            const { data: stops } = await supabase
                .from('stops')
                .select('*')
                .eq('id', stopId)
                .limit(1);
            stop = stops?.[0];
        } else if (userId) {
            const { data: stops } = await supabase
                .from('stops')
                .select('*')
                .eq('client_id', userId)
                .limit(1);
            stop = stops?.[0];
        }

        if (!stop) return NextResponse.json({ error: "Stop not found" }, { status: 404 });

        const clientId = stop.client_id ? String(stop.client_id) : null;
        if (!clientId) {
            return NextResponse.json({ error: "Stop has no client_id; cannot reassign" }, { status: 400 });
        }

        // Verify target driver exists (drivers or routes table)
        const { data: driverRow } = await supabase.from('drivers').select('id').eq('id', toDriverId).maybeSingle();
        const { data: routeRow } = await supabase.from('routes').select('id').eq('id', toDriverId).maybeSingle();
        if (!driverRow && !routeRow) {
            return NextResponse.json({ error: "Target driver not found" }, { status: 404 });
        }

        // 1. Update client so assigned_driver_id matches (source of truth)
        await supabase
            .from('clients')
            .update({ assigned_driver_id: toDriverId })
            .eq('id', clientId);

        // 2. Update this stop
        await supabase
            .from('stops')
            .update({ assigned_driver_id: toDriverId })
            .eq('id', stop.id);

        // 3. driver_route_order: delete from any driver (delete-before-add)
        await supabase
            .from('driver_route_order')
            .delete()
            .eq('client_id', clientId);

        // 4. Add to target driver's list (next position)
        const { data: maxRow } = await supabase
            .from('driver_route_order')
            .select('position')
            .eq('driver_id', toDriverId)
            .order('position', { ascending: false })
            .limit(1)
            .maybeSingle();

        const nextPosition = (maxRow?.position != null ? Number(maxRow.position) + 1 : 1);
        await supabase
            .from('driver_route_order')
            .insert({ driver_id: toDriverId, client_id: clientId, position: nextPosition });

        console.log(`[reassign] Successfully updated client, stop, and driver_route_order`);

        return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    } catch (e: any) {
        console.error("reassign error", e);
        return NextResponse.json({ error: "Server error" }, { status: 500 });
    }
}

