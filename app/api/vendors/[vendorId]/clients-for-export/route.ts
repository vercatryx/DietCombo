/**
 * GET /api/vendors/[vendorId]/clients-for-export
 *
 * Full client list with route-driver merge for PDF/label exports. Served as plain JSON
 * so the browser does not use the Server Action response path (which can fail on hosted
 * Next.js when the payload is very large).
 */

import { createClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';
import { getSession } from '@/lib/session';
import { getSupabaseDbApiKey } from '@/lib/supabase-env';
import { getClientsForAdmin, mergeRouteAssignedDriverIntoClients } from '@/lib/actions';

export async function GET(
    _request: NextRequest,
    { params }: { params: Promise<{ vendorId: string }> }
) {
    const { vendorId } = await params;

    if (!vendorId) {
        return Response.json({ error: 'vendorId required' }, { status: 400 });
    }

    const session = await getSession();
    if (!session?.userId) {
        return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const role = session.role;
    const allowed =
        role === 'admin' ||
        role === 'super-admin' ||
        role === 'navigator' ||
        session.userId === vendorId;

    if (!allowed) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = getSupabaseDbApiKey();
    if (!url || !serviceKey) {
        return Response.json({ error: 'Server missing Supabase config' }, { status: 500 });
    }

    const db = createClient(url, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
    });

    const clients = await getClientsForAdmin(db);
    const merged = await mergeRouteAssignedDriverIntoClients(clients);
    return Response.json(merged);
}
