/**
 * GET /api/vendors/[vendorId]/orders?date=YYYY-MM-DD
 * Returns full orders with items for the vendor on the given date.
 * Enriches Food order items with menuItemName (like orders page) so labels/CSV show names.
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

    // Enrich Food order items with menuItemName using service-role db (avoids RLS)
    const [{ data: menuRows }, { data: mealRows }] = await Promise.all([
        db.from('menu_items').select('id, name'),
        db.from('breakfast_items').select('id, name'),
    ]);
    const menuByName = new Map<string, string>((menuRows || []).map((r: { id: string; name: string }) => [r.id, r.name]));
    const mealByName = new Map<string, string>((mealRows || []).map((r: { id: string; name: string }) => [r.id, r.name]));

    const enrichedOrders = orders.map((order: any) => {
        if (order.service_type !== 'Food' || !Array.isArray(order.items) || order.items.length === 0) {
            return order;
        }
        return {
            ...order,
            items: order.items.map((item: any) => {
                const name = (item.custom_name && String(item.custom_name).trim())
                    || (item.menu_item_id && menuByName.get(item.menu_item_id))
                    || (item.meal_item_id && mealByName.get(item.meal_item_id))
                    || item.menuItemName
                    || 'Unknown Item';
                return { ...item, menuItemName: name };
            }),
        };
    });

    return Response.json(enrichedOrders);
}
