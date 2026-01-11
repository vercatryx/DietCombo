import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET() {
    try {
        // Group signatures by client to get counts
        const { data: rows, error } = await supabase
            .from('signatures')
            .select('client_id')
            .order('client_id');

        if (error) throw error;

        // Group and count manually since Supabase doesn't support GROUP BY directly in select
        const counts = new Map<string, number>();
        (rows || []).forEach((r: any) => {
            counts.set(r.client_id, (counts.get(r.client_id) || 0) + 1);
        });

        // Return as an easy map list
        return NextResponse.json(
            Array.from(counts.entries()).map(([client_id, count]) => ({ 
                userId: client_id, 
                collected: Number(count) 
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
