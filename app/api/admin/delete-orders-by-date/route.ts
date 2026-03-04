import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { createClient } from '@supabase/supabase-js';
import { deleteOrder } from '@/lib/actions-orders-billing';
import { revalidatePath } from 'next/cache';

const REQUIRED_CLICKS = 5;

/**
 * POST /api/admin/delete-orders-by-date
 * Body: { date: "YYYY-MM-DD", confirmClicks: number } — confirmClicks must equal REQUIRED_CLICKS.
 * Deletes all orders with scheduled_delivery_date on the given day. Admin only.
 */
export async function POST(request: NextRequest) {
    const session = await getSession();
    if (!session || (session.role !== 'admin' && session.role !== 'super-admin')) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    let body: { date?: string; confirmClicks?: number };
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }

    const dateStr = typeof body.date === 'string' ? body.date.trim() : '';
    const confirmClicks = typeof body.confirmClicks === 'number' ? body.confirmClicks : 0;

    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(dateStr) ? dateStr : null;
    if (!dateOnly) {
        return NextResponse.json({ error: 'Valid date (YYYY-MM-DD) is required' }, { status: 400 });
    }
    if (confirmClicks !== REQUIRED_CLICKS) {
        return NextResponse.json(
            { error: `Confirmation required: must send confirmClicks equal to ${REQUIRED_CLICKS}` },
            { status: 400 }
        );
    }

    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceRoleKey) {
        return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    const supabaseAdmin = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        serviceRoleKey,
        { auth: { persistSession: false } }
    );

    const { data: orders, error: fetchError } = await supabaseAdmin
        .from('orders')
        .select('id')
        .eq('scheduled_delivery_date', dateOnly);

    if (fetchError) {
        console.error('[delete-orders-by-date] fetch error:', fetchError);
        return NextResponse.json(
            { error: fetchError.message || 'Failed to fetch orders' },
            { status: 500 }
        );
    }

    const ids = (orders || []).map((o) => o.id);
    let deleted = 0;
    for (const id of ids) {
        const result = await deleteOrder(id);
        if (result.success) deleted++;
    }

    revalidatePath('/admin');
    revalidatePath('/orders');
    revalidatePath('/billing');

    return NextResponse.json({
        deleted,
        total: ids.length,
        date: dateOnly,
    });
}
