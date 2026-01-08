import { NextResponse } from "next/server";
import { query } from "@/lib/mysql";

export async function GET() {
    try {
        // Group signatures by client to get counts
        const rows = await query<{ client_id: string; count: number }>(
            `SELECT client_id, COUNT(*) as count FROM signatures GROUP BY client_id`
        );

        // Return as an easy map list
        return NextResponse.json(
            rows.map((r) => ({ userId: r.client_id, collected: Number(r.count) }))
        );
    } catch (err: any) {
        console.error("[signatures status GET] error:", err);
        return NextResponse.json(
            { error: "Internal error", detail: err?.message },
            { status: 500 }
        );
    }
}
