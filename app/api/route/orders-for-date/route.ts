export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

/**
 * Returns order IDs for a given delivery date from orders table only (DB-side filter).
 * Uses RPC get_orders_for_delivery_date when available; otherwise queries orders directly.
 */
export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const dateParam = searchParams.get("date");
        if (!dateParam) {
            return NextResponse.json(
                { error: "Missing date (YYYY-MM-DD)" },
                { status: 400 }
            );
        }
        const deliveryDate = dateParam.split("T")[0].split(" ")[0];
        if (!/^\d{4}-\d{2}-\d{2}$/.test(deliveryDate)) {
            return NextResponse.json(
                { error: "Invalid date format (use YYYY-MM-DD)" },
                { status: 400 }
            );
        }

        let orderIds: string[] = [];
        let clientIds: string[] = [];

        const { data: rpcData, error: rpcError } = await supabase.rpc(
            "get_orders_for_delivery_date",
            { p_delivery_date: deliveryDate }
        );

        if (!rpcError && rpcData) {
            orderIds = Array.isArray(rpcData.order_ids) ? rpcData.order_ids : [];
            clientIds = Array.isArray(rpcData.client_ids) ? rpcData.client_ids : [];
        } else {
            const { data: orders } = await supabase
                .from("orders")
                .select("id, client_id, service_type")
                .eq("scheduled_delivery_date", deliveryDate)
                .neq("status", "cancelled");
            const filtered = (orders || []).filter(
                (o: any) => o.service_type == null || String(o.service_type).toLowerCase().trim() !== "produce"
            );
            orderIds = filtered.map((o: any) => String(o.id));
            const seen = new Set<string>();
            filtered.forEach((o: any) => {
                const c = o.client_id != null ? String(o.client_id) : "";
                if (c && !seen.has(c)) {
                    seen.add(c);
                    clientIds.push(c);
                }
            });
        }

        return NextResponse.json(
            {
                delivery_date: deliveryDate,
                order_ids: orderIds,
                client_ids: clientIds,
            },
            { headers: { "Cache-Control": "no-store" } }
        );
    } catch (e: any) {
        console.error("[/api/route/orders-for-date] error:", e);
        return NextResponse.json(
            { error: e?.message ?? "Unknown error" },
            { status: 500 }
        );
    }
}
