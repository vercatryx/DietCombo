import { NextRequest, NextResponse } from 'next/server';
import { processUpcomingOrders } from '@/lib/actions';

/**
 * API Route: Process upcoming orders that have been delivered with proof
 * 
 * POST /api/process-upcoming-orders
 * 
 * This endpoint processes upcoming orders from the upcoming_orders table that:
 * - Have status = 'delivered'
 * - Have a delivery_proof_url (not null and not empty)
 * 
 * These orders are moved to the orders table with status 'completed' and
 * the delivery_proof_url is copied to the orders table.
 * 
 * Returns a summary of processed orders and any errors encountered.
 */
export async function POST(request: NextRequest) {
    try {
        const result = await processUpcomingOrders();

        return NextResponse.json({
            success: true,
            processed: result.processed,
            billingRecordsCreated: 0,
            errors: result.errors,
            processedAt: new Date().toISOString()
        }, { status: 200 });

    } catch (error: any) {
        console.error('Error processing upcoming orders:', error);
        return NextResponse.json({
            success: false,
            error: error.message || 'Failed to process upcoming orders',
            processedAt: new Date().toISOString()
        }, { status: 500 });
    }
}

/**
 * GET endpoint for manual testing/debugging
 */
export async function GET(request: NextRequest) {
    try {
        const result = await processUpcomingOrders();

        return NextResponse.json({
            success: true,
            processed: result.processed,
            billingRecordsCreated: 0,
            errors: result.errors,
            processedAt: new Date().toISOString(),
            message: `Processed ${result.processed} upcoming order(s)`
        }, { status: 200 });

    } catch (error: any) {
        console.error('Error processing upcoming orders:', error);
        return NextResponse.json({
            success: false,
            error: error.message || 'Failed to process upcoming orders',
            processedAt: new Date().toISOString()
        }, { status: 500 });
    }
}



