export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { toCalendarDateKeyInAppTz } from "@/lib/timezone";

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/** Normalize DB date to YYYY-MM-DD in app timezone (no UTC shift). */
function toDateKey(raw: string | null | undefined): string | null {
    if (raw == null || typeof raw !== "string") return null;
    const s = String(raw).trim();
    if (DATE_ONLY_REGEX.test(s)) return s;
    return toCalendarDateKeyInAppTz(s);
}

/**
 * GET /api/route/orders-dates
 * Returns dates that have orders (and upcoming_orders) with counts.
 * Used by Drivers calendar so dates/amounts match "orders for that day" (America/New_York).
 * Excludes cancelled and produce from orders.
 */
export async function GET() {
    try {
        const dateCounts: Record<string, number> = {};

        // 1) orders: scheduled_delivery_date, exclude cancelled and produce
        const { data: ordersData, error: ordersError } = await supabase
            .from("orders")
            .select("scheduled_delivery_date, service_type")
            .not("status", "eq", "cancelled")
            .not("scheduled_delivery_date", "is", null);

        if (ordersError) {
            console.error("[/api/route/orders-dates] orders error:", ordersError);
            return NextResponse.json({ error: ordersError.message }, { status: 500 });
        }

        (ordersData || []).forEach((row: any) => {
            if (row.service_type != null && String(row.service_type).toLowerCase().trim() === "produce") return;
            const key = toDateKey(row.scheduled_delivery_date);
            if (key) dateCounts[key] = (dateCounts[key] || 0) + 1;
        });

        // 2) upcoming_orders: scheduled_delivery_date when set (scheduled status)
        const { data: upcomingData, error: upcomingError } = await supabase
            .from("upcoming_orders")
            .select("scheduled_delivery_date")
            .eq("status", "scheduled")
            .not("scheduled_delivery_date", "is", null);

        if (!upcomingError && upcomingData) {
            upcomingData.forEach((row: any) => {
                const key = toDateKey(row.scheduled_delivery_date);
                if (key) dateCounts[key] = (dateCounts[key] || 0) + 1;
            });
        }

        return NextResponse.json(
            { dates: dateCounts },
            { headers: { "Cache-Control": "no-store" } }
        );
    } catch (e: any) {
        console.error("[/api/route/orders-dates] error:", e);
        return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
    }
}
