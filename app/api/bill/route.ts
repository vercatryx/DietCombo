/**
 * Billing by client: one entry per client (parent + all dependents).
 * Amount = 336 × people (non-Produce) or 146 × people (Produce). Based on parent service_type only.
 * Same JSON format as /api/extension/billing-requests.
 *
 * - Order list: only orders NOT already marked billing_successful.
 * - Proof URLs:
 *   - Prefer the parent’s signature PDF when `sign_token` is set (`/api/signatures/{token}/pdf`).
 *   - Otherwise (no sign_token), use up to 2 photo proofs from orders: prefer orders whose delivery date
 *     falls within the 7-day window (?date through date+6); if none in-window, use the 2 most recent
 *     proofs across all orders.
 * - Unite Us `url`: parent client's case_id_external / client_id_external only (not copied from orders).
 *
 * GET /api/bill
 * Query params:
 *   ?date=YYYY-MM-DD   – billing window start (default 2026-02-23)
 *   ?account=regular|brooklyn|both  – filter by unite_account (default: both)
 * Excludes parent clients with clients.bill === false (same as app “no billing” / bill unchecked).
 * Each entry includes createdAt (ISO 8601) for the parent client and each dependant.
 * No auth required.
 *
 * For a fixed invoice-PDF proof URL per row, see GET /api/bill/invoices.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getBillHouseholdRows } from '@/lib/api/bill-household-rows';

export async function GET(request: NextRequest) {
    try {
        const result = await getBillHouseholdRows(request, 'signatureOrOrderProofs', '[api/bill]');
        return NextResponse.json(result);
    } catch (error: any) {
        console.error('[api/bill] Error:', error);
        return NextResponse.json(
            { success: false, error: error.message || 'Internal Server Error' },
            { status: 500 }
        );
    }
}
