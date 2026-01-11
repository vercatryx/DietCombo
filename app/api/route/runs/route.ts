export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

function normalizeDay(raw?: string | null) {
    const s = String(raw ?? "all").toLowerCase().trim();
    const days = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday","all"];
    return days.includes(s) ? s : "all";
}

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const day = normalizeDay(searchParams.get("day"));

        const { data: runs } = await supabase
            .from('route_runs')
            .select('id, created_at')
            .eq('day', day)
            .order('created_at', { ascending: false })
            .limit(10);

        return NextResponse.json({
            runs: (runs || []).map(r => ({
                id: r.id,
                createdAt: new Date(r.created_at).toISOString(),
            })),
        }, { headers: { "Cache-Control": "no-store" }});
    } catch (e:any) {
        console.error("[/api/route/runs] error:", e);
        return NextResponse.json({ runs: [] }, { status: 200 });
    }
}

