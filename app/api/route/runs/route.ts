export const runtime = "nodejs";
import { NextResponse } from "next/server";
import { query } from "@/lib/mysql";

function normalizeDay(raw?: string | null) {
    const s = String(raw ?? "all").toLowerCase().trim();
    const days = ["monday","tuesday","wednesday","thursday","friday","saturday","sunday","all"];
    return days.includes(s) ? s : "all";
}

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const day = normalizeDay(searchParams.get("day"));

        const runs = await query<any[]>(`
            SELECT id, created_at as createdAt
            FROM route_runs
            WHERE day = ?
            ORDER BY created_at DESC
            LIMIT 10
        `, [day]);

        return NextResponse.json({
            runs: runs.map(r => ({
                id: r.id,
                createdAt: new Date(r.createdAt).toISOString(),
            })),
        }, { headers: { "Cache-Control": "no-store" }});
    } catch (e:any) {
        console.error("[/api/route/runs] error:", e);
        return NextResponse.json({ runs: [] }, { status: 200 });
    }
}

