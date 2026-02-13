export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

/**
 * GET /api/route/orders-dates
 * Returns dates that have orders (from orders table) with counts.
 * Used by Orders View calendar to show which days have orders (not stops).
 * Excludes cancelled and produce.
 */
export async function GET() {
    try {
        const { data, error } = await supabase
            .from("orders")
            .select("scheduled_delivery_date, service_type")
            .not("status", "eq", "cancelled")
            .not("scheduled_delivery_date", "is", null);

        if (error) {
            console.error("[/api/route/orders-dates] Error:", error);
            return NextResponse.json({ error: error.message }, { status: 500 });
        }

        const dateCounts: Record<string, number> = {};
        (data || []).forEach((row: any) => {
            if (row.service_type != null && String(row.service_type).toLowerCase().trim() === "produce") return;
            const st = row.scheduled_delivery_date;
            if (!st) return;
            const dateStr = typeof st === "string" ? st.split("T")[0].split(" ")[0] : null;
            if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return;
            dateCounts[dateStr] = (dateCounts[dateStr] || 0) + 1;
        });

        return NextResponse.json(
            { dates: dateCounts },
            { headers: { "Cache-Control": "no-store" } }
        );
    } catch (e: any) {
        console.error("[/api/route/orders-dates] error:", e);
        return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
    }
}
