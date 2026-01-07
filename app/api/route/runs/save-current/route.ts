export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { query } from "@/lib/mysql";
import { v4 as uuidv4 } from "uuid";

function normalizeDay(raw?: string | null) {
    const s = String(raw ?? "all").toLowerCase().trim();
    const days = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday","all"];
    return days.includes(s) ? s : "all";
}

export async function POST(req: Request) {
    try {
        const body = await req.json().catch(() => ({}));
        const day = normalizeDay(body?.day);
        const runId = body?.runId ? String(body.runId) : null;
        const asNew = Boolean(body?.asNew);

        // Fetch current state of drivers for this day
        const drivers = await query<any[]>(`
            SELECT id, name, color, stop_ids
            FROM drivers
            WHERE day = ?
            ORDER BY id ASC
        `, [day]);

        // Build snapshot: array of drivers with their stop_ids
        const snapshot = drivers.map(d => ({
            driverId: d.id,
            driverName: d.name,
            color: d.color,
            stopIds: Array.isArray(d.stop_ids) ? d.stop_ids : (typeof d.stop_ids === "string" ? JSON.parse(d.stop_ids || "[]") : []),
        }));

        if (asNew) {
            // Always create a new route run when asNew is true
            const newId = uuidv4();
            await query(`
                INSERT INTO route_runs (id, day, snapshot)
                VALUES (?, ?, ?)
            `, [newId, day, JSON.stringify(snapshot)]);
            
            return NextResponse.json({ id: newId, message: "Route run saved" }, { headers: { "Cache-Control": "no-store" } });
        } else if (runId) {
            // Update existing run by ID
            const updated = await query(`
                UPDATE route_runs
                SET snapshot = ?
                WHERE id = ? AND day = ?
            `, [JSON.stringify(snapshot), runId, day]);
            
            return NextResponse.json({ id: runId, message: "Route run updated" }, { headers: { "Cache-Control": "no-store" } });
        } else {
            // No runId provided and not asNew: find most recent run for this day and update it, or create if none exists
            const existing = await query<any[]>(`
                SELECT id FROM route_runs
                WHERE day = ?
                ORDER BY created_at DESC
                LIMIT 1
            `, [day]);
            
            if (existing && existing.length > 0) {
                // Update most recent run
                const existingId = existing[0].id;
                await query(`
                    UPDATE route_runs
                    SET snapshot = ?
                    WHERE id = ?
                `, [JSON.stringify(snapshot), existingId]);
                return NextResponse.json({ id: existingId, message: "Route run updated" }, { headers: { "Cache-Control": "no-store" } });
            } else {
                // Create new run
                const newId = uuidv4();
                await query(`
                    INSERT INTO route_runs (id, day, snapshot)
                    VALUES (?, ?, ?)
                `, [newId, day, JSON.stringify(snapshot)]);
                return NextResponse.json({ id: newId, message: "Route run saved" }, { headers: { "Cache-Control": "no-store" } });
            }
        }
    } catch (e: any) {
        console.error("[/api/route/runs/save-current] error:", e);
        return NextResponse.json(
            { error: e?.message || "Server error" },
            { status: 500 }
        );
    }
}

