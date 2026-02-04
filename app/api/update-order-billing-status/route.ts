/**
 * Update order billing status. Used by the Billing list page.
 * POST /api/update-order-billing-status
 * Body: { orderIds: string[], status: 'billing_pending' | 'billing_successful' | 'billing_failed', billingNotes?: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { orderIds, status } = body;

        if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
            return NextResponse.json(
                { success: false, error: 'orderIds is required and must be a non-empty array' },
                { status: 400 }
            );
        }

        if (!status || !['billing_successful', 'billing_failed', 'billing_pending'].includes(status)) {
            return NextResponse.json(
                { success: false, error: 'status must be one of: billing_successful, billing_failed, billing_pending' },
                { status: 400 }
            );
        }

        const { data: updatedOrders, error } = await supabase
            .from('orders')
            .update({ status })
            .in('id', orderIds)
            .select('id, status');

        if (error) {
            console.error('Error updating orders:', error);
            return NextResponse.json(
                { success: false, error: error.message || 'Failed to update orders' },
                { status: 500 }
            );
        }

        return NextResponse.json({
            success: true,
            updated: updatedOrders?.length ?? 0,
            orderIds,
            status,
            updatedOrders,
            updatedAt: new Date().toISOString(),
        });
    } catch (error: any) {
        console.error('Error updating order billing status:', error);
        return NextResponse.json(
            { success: false, error: error.message || 'Failed to update order billing status' },
            { status: 500 }
        );
    }
}
