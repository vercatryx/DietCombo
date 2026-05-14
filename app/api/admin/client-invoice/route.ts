import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseDbApiKey } from '@/lib/supabase-env';
import { getSession } from '@/lib/session';
import { buildClientInvoicePayload } from '@/lib/invoice/build-client-invoice-payload';

/**
 * GET /api/admin/client-invoice?clientId=&from=YYYY-MM-DD&to=YYYY-MM-DD&produce=1
 * Staff-only JSON payload for the in-app invoice preview (household + delivery-date window).
 * `produce=1` sets produce voucher presentation on the fixed invoice line.
 */
export async function GET(req: NextRequest) {
    const session = await getSession();
    if (
        !session ||
        (session.role !== 'admin' &&
            session.role !== 'super-admin' &&
            session.role !== 'navigator' &&
            session.role !== 'brooklyn_admin')
    ) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = req.nextUrl;
    const clientId = searchParams.get('clientId')?.trim();
    const from = searchParams.get('from')?.trim();
    const to = searchParams.get('to')?.trim();
    const produceRaw = searchParams.get('produce')?.trim().toLowerCase();
    const produceInvoice = produceRaw === '1' || produceRaw === 'true' || produceRaw === 'yes';

    if (!clientId || !from || !to) {
        return NextResponse.json({ error: 'Missing clientId, from, or to' }, { status: 400 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = getSupabaseDbApiKey();
    if (!url || !key) {
        return NextResponse.json({ error: 'Server database is not configured' }, { status: 500 });
    }

    const db = createClient(url, key, { auth: { persistSession: false } });

    if (session.role === 'brooklyn_admin') {
        const { data: row } = await db
            .from('clients')
            .select('parent_client_id, unite_account')
            .eq('id', clientId)
            .maybeSingle();
        if (!row) return NextResponse.json({ error: 'Client not found' }, { status: 404 });
        const rootId = row.parent_client_id != null ? String(row.parent_client_id) : clientId;
        const { data: root } = await db.from('clients').select('unite_account').eq('id', rootId).maybeSingle();
        if (root?.unite_account !== 'Brooklyn') {
            return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
        }
    }

    const result = await buildClientInvoicePayload(db, { clientId, from, to, produceInvoice });
    if (!result.ok) {
        return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json(result.payload);
}
