import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseDbApiKey } from '@/lib/supabase-env';
import { buildClientInvoicePayload } from '@/lib/invoice/build-client-invoice-payload';
import { buildClientInvoicePdfBytes, buildClientInvoicePdfFilename } from '@/lib/invoice/build-client-invoice-pdf';

/** Public CORS — treat shared URLs as sensitive (anyone with the link can download this PDF). */
const corsHeaders: Record<string, string> = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

export function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: corsHeaders });
}

/**
 * GET /api/client-invoice-pdf?clientId=&from=YYYY-MM-DD&to=YYYY-MM-DD&produce=1
 * Public — no session. Returns application/pdf (download).
 * `produce=1` (or true/yes) uses the produce voucher line (1 × $146) on the PDF.
 */
export async function GET(req: NextRequest) {
    const { searchParams } = req.nextUrl;
    const clientId = searchParams.get('clientId')?.trim();
    const from = searchParams.get('from')?.trim();
    const to = searchParams.get('to')?.trim();
    const produceRaw = searchParams.get('produce')?.trim().toLowerCase();
    const produceInvoice = produceRaw === '1' || produceRaw === 'true' || produceRaw === 'yes';

    if (!clientId || !from || !to) {
        return NextResponse.json(
            { error: 'Missing clientId, from, or to' },
            { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = getSupabaseDbApiKey();
    if (!url || !key) {
        return NextResponse.json(
            { error: 'Server database is not configured' },
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
    }

    const db = createClient(url, key, { auth: { persistSession: false } });

    const result = await buildClientInvoicePayload(db, { clientId, from, to, produceInvoice });
    if (!result.ok) {
        return NextResponse.json(
            { error: result.error },
            { status: result.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        );
    }

    const bytes = buildClientInvoicePdfBytes(result.payload);
    const filename = buildClientInvoicePdfFilename(result.payload);
    const body = Buffer.from(bytes);

    return new NextResponse(body, {
        status: 200,
        headers: {
            ...corsHeaders,
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Cache-Control': 'private, no-store',
        },
    });
}
