/**
 * GET /api/vendors/[vendorId]/orders/summary
 * Returns per-date order count and total_items only (no full orders).
 * Used for fast vendor page load when vendor has many orders.
 */

import { createClient } from '@supabase/supabase-js';
import { getSession } from '@/lib/session';

const SINGLE_VENDOR_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

export async function GET(
    _request: Request,
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

    const { data, error } = await db.rpc('get_vendor_orders_summary', { p_vendor_id: vendorId });

    if (error) {
        console.error('[vendor orders summary] RPC error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }

    const summary = Array.isArray(data) ? data : (data ?? []);
    return Response.json(summary);
}
