// app/api/route/reassign/route.ts
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { query } from "@/lib/mysql";

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
            const stops = await query<any[]>(`SELECT * FROM stops WHERE id = ? AND day = ? LIMIT 1`, [stopId, day]);
            stop = stops[0];
        } else if (userId) {
            const stops = await query<any[]>(`SELECT * FROM stops WHERE client_id = ? AND day = ? LIMIT 1`, [userId, day]);
            stop = stops[0];
        }

        if (!stop) return NextResponse.json({ error: "Stop not found for this day" }, { status: 404 });

        // Fetch drivers for day
        const drivers = await query<any[]>(`SELECT * FROM drivers WHERE day = ?`, [day]);
        const toDriver = drivers.find((d) => String(d.id) === toDriverId);
        if (!toDriver) return NextResponse.json({ error: "Target driver not found" }, { status: 404 });

        // Remove from any current owner (filter stale duplicates too)
        for (const d of drivers) {
            const stopIds = Array.isArray(d.stop_ids) ? d.stop_ids : (typeof d.stop_ids === "string" ? JSON.parse(d.stop_ids) : []);
            const arr = Array.isArray(stopIds) ? stopIds : [];
            const next = arr.filter((v: any) => sid(v) !== sid(stop.id));
            if (next.length !== arr.length) {
                await query(`UPDATE drivers SET stop_ids = ? WHERE id = ?`, [JSON.stringify(next), d.id]);
            }
        }

        // Add once to target
        const stopIds = Array.isArray(toDriver.stop_ids) ? toDriver.stop_ids : (typeof toDriver.stop_ids === "string" ? JSON.parse(toDriver.stop_ids) : []);
        const tgt = Array.isArray(stopIds) ? [...stopIds] : [];
        if (!tgt.map(sid).includes(sid(stop.id))) tgt.push(stop.id);
        await query(`UPDATE drivers SET stop_ids = ? WHERE id = ?`, [JSON.stringify(tgt), toDriver.id]);

        // Mirror convenience
        await query(`UPDATE stops SET assigned_driver_id = ? WHERE id = ?`, [toDriver.id, stop.id]);

        return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    } catch (e: any) {
        console.error("reassign error", e);
        return NextResponse.json({ error: "Server error" }, { status: 500 });
    }
}

