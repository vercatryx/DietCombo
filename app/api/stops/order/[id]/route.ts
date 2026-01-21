import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * GET /api/stops/order/[id]
 * 
 * Fetches order details by ID from upcoming_orders first, then orders table if not found
 * Used by StopPreviewDialog to look up order details using stop.order_id
 * This follows the same priority logic: check upcoming_orders.id first, then orders.id
 */
export async function GET(
    request: NextRequest,
    { params }: { params: Promise<{ id: string }> }
) {
    try {
        const { id } = await params;

        if (!id) {
            return NextResponse.json(
                { error: 'Order ID is required' },
                { status: 400 }
            );
        }

        // First, try to fetch from upcoming_orders table
        const { data: upcomingOrder, error: upcomingError } = await supabase
            .from('upcoming_orders')
            .select('id, order_number, client_id, status, scheduled_delivery_date, actual_delivery_date, created_at, total_value, total_items, notes, case_id, service_type, delivery_day')
            .eq('id', id)
            .maybeSingle();

        if (upcomingError) {
            console.error('[api/stops/order] Error fetching from upcoming_orders:', upcomingError);
        }

        if (upcomingOrder) {
            return NextResponse.json(upcomingOrder, { 
                headers: { 'Cache-Control': 'no-store' } 
            });
        }

        // If not found in upcoming_orders, try orders table
        const { data: order, error: orderError } = await supabase
            .from('orders')
            .select('id, order_number, client_id, status, scheduled_delivery_date, actual_delivery_date, created_at, total_value, total_items, notes, case_id, service_type, delivery_day')
            .eq('id', id)
            .maybeSingle();

        if (orderError) {
            console.error('[api/stops/order] Error fetching from orders:', orderError);
            return NextResponse.json(
                { error: orderError.message },
                { status: 500 }
            );
        }

        if (!order) {
            return NextResponse.json(
                { error: 'Order not found in upcoming_orders or orders table' },
                { status: 404 }
            );
        }

        return NextResponse.json(order, { 
            headers: { 'Cache-Control': 'no-store' } 
        });
    } catch (error: any) {
        console.error('[api/stops/order] Unexpected error:', error);
        return NextResponse.json(
            { error: error.message || 'Internal server error' },
            { status: 500 }
        );
    }
}
