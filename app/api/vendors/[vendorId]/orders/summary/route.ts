/**
 * GET /api/vendors/[vendorId]/orders/summary
 * GET /api/vendors/[vendorId]/orders/summary?since=YYYY-MM-DD
 *
 * Returns per-date order count and total_items only (no full orders).
 * When `since` is provided, uses the faster `get_vendor_orders_summary_recent`
 * RPC which returns { rows, total_dates } for dates >= since.
 * Falls back to the original `get_vendor_orders_summary` + JS filtering
 * if the new function hasn't been deployed yet.
 */

import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { getSession } from '@/lib/session';

const SINGLE_VENDOR_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ vendorId: string }> }
) {
    const { vendorId } = await params;

    if (!vendorId) {
        return Response.json({ error: 'vendorId required' }, { status: 400 });
    }

    const session = await getSession();
    const isSingleVendor = vendorId === SINGLE_VENDOR_ID;
    const allowed = isSingleVendor || (session && (session.role === 'admin' || session.userId === vendorId));
    if (!allowed) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
        return Response.json({ error: 'Server missing Supabase config' }, { status: 500 });
    }

    const db = createClient(url, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
    });

    const sinceParam = request.nextUrl.searchParams.get('since');

    if (sinceParam) {
        const { data, error } = await db.rpc('get_vendor_orders_summary_recent', {
            p_vendor_id: vendorId,
            p_since_date: sinceParam,
        });

        if (!error && data) {
            return Response.json(data);
        }

        // Fallback: new RPC not deployed yet — use old RPC and filter in JS
        console.warn('[vendor orders summary] get_vendor_orders_summary_recent not available, falling back:', error?.message);
        const { data: allData, error: fallbackErr } = await db.rpc('get_vendor_orders_summary', { p_vendor_id: vendorId });
        if (fallbackErr) {
            console.error('[vendor orders summary] fallback RPC error:', fallbackErr);
            return Response.json({ error: fallbackErr.message }, { status: 500 });
        }
        const allRows: any[] = Array.isArray(allData) ? allData : (allData ?? []);
        const filtered = allRows.filter(r => r.date_key === 'no-date' || r.date_key >= sinceParam);
        return Response.json({
            rows: filtered,
            total_dates: allRows.length,
        });
    }

    // No since param — return all summaries (legacy behaviour / "Show More")
    const { data, error } = await db.rpc('get_vendor_orders_summary', { p_vendor_id: vendorId });

    if (error) {
        console.error('[vendor orders summary] RPC error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }

    const summary = Array.isArray(data) ? data : (data ?? []);
    return Response.json(summary);
}
