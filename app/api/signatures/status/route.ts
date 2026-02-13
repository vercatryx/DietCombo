import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET() {
    try {
        // Use RPC for fast batch counts (no 1000-row limit, single DB query)
        const { data: rows, error } = await supabase.rpc("get_signature_counts");

        if (error) {
            // Fallback: RPC may not exist yet; paginate raw table
            if (error.code === "42883" || error.message?.includes("function")) {
                const counts = new Map<string, number>();
                let from = 0;
                const CHUNK = 1000;
                while (true) {
                    const { data: chunk, error: chunkErr } = await supabase
                        .from("signatures")
                        .select("client_id")
                        .order("client_id")
                        .range(from, from + CHUNK - 1);
                    if (chunkErr) throw chunkErr;
                    if (!chunk?.length) break;
                    chunk.forEach((r: { client_id: string }) => {
                        counts.set(r.client_id, (counts.get(r.client_id) || 0) + 1);
                    });
                    if (chunk.length < CHUNK) break;
                    from += CHUNK;
                }
                return NextResponse.json(
                    Array.from(counts.entries()).map(([client_id, count]) => ({
                        userId: client_id,
                        collected: Number(count),
                    }))
                );
            }
            throw error;
        }

        return NextResponse.json(
            (rows || []).map((r: { client_id: string; collected: number }) => ({
                userId: r.client_id,
                collected: Number(r.collected || 0),
            }))
        );
    } catch (err: any) {
        console.error("[signatures status GET] error:", err);
        return NextResponse.json(
            { error: "Internal error", detail: err?.message },
            { status: 500 }
        );
    }
}
