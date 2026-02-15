/**
 * Debug: verify vendor order items are loaded on the server (same DB/client as getOrdersByVendor).
 * GET /api/debug/vendor-order-items?vendorId=cccccccc-cccc-cccc-cccc-cccccccccccc&date=2026-02-16
 * Returns JSON: { usedServiceRole, totalOrders, withItems, sample: [{ orderId, itemsLength }] }
 */

import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { toCalendarDateKeyInAppTz } from '@/lib/timezone';

const VENDOR_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

export async function GET(request: NextRequest) {
    const vendorId = request.nextUrl.searchParams.get('vendorId') || VENDOR_ID;
    const dateParam = request.nextUrl.searchParams.get('date') || '2026-02-16';

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const usedServiceRole = !!serviceKey;

    if (!url || !serviceKey) {
        return Response.json({
            error: 'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY',
            usedServiceRole: false,
        }, { status: 500 });
    }

    const db = createClient(url, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
    });

    const dateKey = toCalendarDateKeyInAppTz(dateParam) ?? dateParam;

    const { data: ordersFromTable, error: ordersErr } = await db
        .from('orders')
        .select('id, service_type, vendor_id, scheduled_delivery_date')
        .eq('vendor_id', vendorId)
        .order('created_at', { ascending: false })
        .limit(50);

    if (ordersErr) {
        return Response.json({
            error: 'Orders query failed',
            message: ordersErr.message,
            code: ordersErr.code,
        }, { status: 500 });
    }

    const filtered = (ordersFromTable || []).filter((o: { scheduled_delivery_date?: string }) => {
        if (!o.scheduled_delivery_date) return false;
        const orderDateKey = toCalendarDateKeyInAppTz(o.scheduled_delivery_date);
        return orderDateKey != null && orderDateKey === dateKey;
    }).filter((o: { service_type: string }) => o.service_type === 'Food');

    const sample: { orderId: string; itemsLength: number; vsId?: string }[] = [];
    let withItems = 0;

    for (let i = 0; i < Math.min(5, filtered.length); i++) {
        const order = filtered[i];
        const { data: vsData, error: vsError } = await db
            .from('order_vendor_selections')
            .select('id')
            .eq('order_id', order.id)
            .eq('vendor_id', vendorId)
            .maybeSingle();

        if (vsError || !vsData) {
            sample.push({ orderId: order.id, itemsLength: 0 });
            continue;
        }

        const { data: items, error: itemsError } = await db
            .from('order_items')
            .select('id')
            .eq('vendor_selection_id', vsData.id);

        const count = itemsError ? 0 : (items?.length ?? 0);
        if (count > 0) withItems++;
        sample.push({ orderId: order.id, itemsLength: count, vsId: vsData.id });
    }

    return Response.json({
        usedServiceRole,
        dateKey,
        totalOrdersForDate: filtered.length,
        withItems,
        sample,
    });
}
