/**
 * Same household list as GET /api/bill (query: ?date=, ?account=, ?onlyreal=), but each row’s `proofURLs`
 * is always exactly one URL pointing at the customer site’s client invoice PDF for that parent.
 * `from` and `to` match the same 7-day window as `date` and `endDate` on each row (?date= through +6 days).
 *
 * GET /api/bill/invoices
 * proofURLs[0] = {CUSTOMER_ORIGIN}/api/client-invoice-pdf?clientId={parentId}&from={date}&to={endDate}
 *
 * `orderNumbers` on each row includes only orders whose effective delivery date falls in the 7-day
 * window (?date through +6), excluding billing_successful (same rule as GET /api/bill).
 *
 * Archived clients are never included (same as GET /api/bill).
 * No auth required.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getBillHouseholdRows } from '@/lib/api/bill-household-rows';

export async function GET(request: NextRequest) {
    try {
        const result = await getBillHouseholdRows(request, 'customerInvoicePdf', '[api/bill/invoices]');
        return NextResponse.json(result);
    } catch (error: any) {
        console.error('[api/bill/invoices] Error:', error);
        return NextResponse.json(
            { success: false, error: error.message || 'Internal Server Error' },
            { status: 500 }
        );
    }
}
