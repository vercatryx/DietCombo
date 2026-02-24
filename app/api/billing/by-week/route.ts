/**
 * Billing-by-week API: same data as the Billing tab, grouped by household (parent + dependants' orders).
 * GET /api/billing/by-week?week=YYYY-MM-DD
 * Optional query: week = Sunday of the week (YYYY-MM-DD). If omitted, returns all weeks.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getBillingRequestsByWeek } from '@/lib/actions-orders-billing';

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const weekParam = searchParams.get('week');
        let weekStartDate: Date | undefined;
        if (weekParam) {
            const parsed = new Date(weekParam + 'T00:00:00');
            if (Number.isNaN(parsed.getTime())) {
                return NextResponse.json({ error: 'Invalid week date; use YYYY-MM-DD' }, { status: 400 });
            }
            weekStartDate = parsed;
        }
        const data = await getBillingRequestsByWeek(weekStartDate);
        return NextResponse.json(data);
    } catch (e) {
        console.error('Error in GET /api/billing/by-week:', e);
        return NextResponse.json({ error: 'Failed to load billing by week' }, { status: 500 });
    }
}
