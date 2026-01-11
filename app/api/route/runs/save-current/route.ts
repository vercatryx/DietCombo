export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
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
        const { data: drivers } = await supabase
            .from('drivers')
            .select('id, name, color, stop_ids')
            .eq('day', day)
            .order('id', { ascending: true });

        // Build snapshot: array of drivers with their stop_ids
        const snapshot = (drivers || []).map(d => ({
            driverId: d.id,
            driverName: d.name,
            color: d.color,
            stopIds: Array.isArray(d.stop_ids) ? d.stop_ids : (typeof d.stop_ids === "string" ? JSON.parse(d.stop_ids || "[]") : []),
        }));

        if (asNew) {
            // Always create a new route run when asNew is true
            const newId = uuidv4();
            await supabase
                .from('route_runs')
                .insert([{ id: newId, day, snapshot }]);
            
            return NextResponse.json({ id: newId, message: "Route run saved" }, { headers: { "Cache-Control": "no-store" } });
        } else if (runId) {
            // Update existing run by ID
            await supabase
                .from('route_runs')
                .update({ snapshot })
                .eq('id', runId)
                .eq('day', day);
            
            return NextResponse.json({ id: runId, message: "Route run updated" }, { headers: { "Cache-Control": "no-store" } });
        } else {
            // No runId provided and not asNew: find most recent run for this day and update it, or create if none exists
            const { data: existing } = await supabase
                .from('route_runs')
                .select('id')
                .eq('day', day)
                .order('created_at', { ascending: false })
                .limit(1)
                .single();
            
            if (existing) {
                // Update most recent run
                await supabase
                    .from('route_runs')
                    .update({ snapshot })
                    .eq('id', existing.id);
                return NextResponse.json({ id: existing.id, message: "Route run updated" }, { headers: { "Cache-Control": "no-store" } });
            } else {
                // Create new run
                const newId = uuidv4();
                await supabase
                    .from('route_runs')
                    .insert([{ id: newId, day, snapshot }]);
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

