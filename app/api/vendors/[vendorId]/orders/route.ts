/**
 * GET /api/vendors/[vendorId]/orders?date=YYYY-MM-DD
 * Returns full orders with items for the vendor on the given date.
 * Creates service-role client here so items are always loaded (avoids env/module issues in server actions).
 */

import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { getOrdersByVendor } from '@/lib/actions';

export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ vendorId: string }> }
) {
    const { vendorId } = await params;
    const date = request.nextUrl.searchParams.get('date');

    if (!vendorId) {
        return Response.json({ error: 'vendorId required' }, { status: 400 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !serviceKey) {
        return Response.json({ error: 'Server missing Supabase config' }, { status: 500 });
    }

    const db = createClient(url, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
    });

    const orders = await getOrdersByVendor(vendorId, date ?? undefined, { db });
    return Response.json(orders);
}
