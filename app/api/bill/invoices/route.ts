/**
 * Same household list as GET /api/bill (query: ?date=, ?account=), but each row’s `proofURLs`
 * is always exactly one URL pointing at the customer site’s client invoice PDF for that parent
 * and the calendar month containing ?date=.
 *
 * GET /api/bill/invoices
 * proofURLs[0] = {CUSTOMER_ORIGIN}/api/client-invoice-pdf?clientId={parentId}&from={monthStart}&to={monthEnd}
 *
 * CUSTOMER_ORIGIN: NEXT_PUBLIC_CUSTOMER_APP_URL or NEXT_PUBLIC_CUSTOMER_URL, else http://customer.thedietfantasy.com
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
