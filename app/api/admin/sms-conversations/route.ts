import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseDbApiKey } from '@/lib/supabase-env';
import { getSession } from '@/lib/session';
import { appTzDateKeysToUtcIsoRangeInclusive } from '@/lib/timezone';
import { getAllClientNumbers, normalizePhone } from '@/lib/phone-utils';

const PAGE = 1000;

/**
 * GET /api/admin/sms-conversations?clientId=…&from=YYYY-MM-DD&to=YYYY-MM-DD
 * Admin-only. SMS bot rows from sms_conversations.
 *
 * Date bounds use America/New_York calendar days (see appTzDateKeysToUtcIsoRangeInclusive).
 * Rows match client_id OR any normalized phone on the client (same thread, Telnyx E.164).
 * Webhook dedupe markers ([processed:…]) are omitted from the response.
 *
 * Bot still prunes rows older than ~2 hours on each reply — only recent turns persist.
 */
export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session || (session.role !== 'admin' && session.role !== 'super-admin')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = req.nextUrl;
  const clientId = searchParams.get('clientId')?.trim();
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  if (!clientId) {
    return NextResponse.json({ error: 'Missing clientId' }, { status: 400 });
  }
  if (!from || !to) {
    return NextResponse.json({ error: 'Missing from/to date params' }, { status: 400 });
  }

  let startIso: string;
  let endIso: string;
  try {
    ({ startIso, endIso } = appTzDateKeysToUtcIsoRangeInclusive(from, to));
  } catch {
    return NextResponse.json({ error: 'Invalid from/to dates (use YYYY-MM-DD)' }, { status: 400 });
  }

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, getSupabaseDbApiKey()!);

  const { data: clientRow } = await supabase
    .from('clients')
    .select('phone_number, secondary_phone_number')
    .eq('id', clientId)
    .maybeSingle();

  const phones = clientRow
    ? [...new Set(getAllClientNumbers(clientRow).map((r) => normalizePhone(r)).filter(Boolean) as string[])]
    : [];

  type Row = {
    id: string;
    phone_number: string;
    client_id: string | null;
    role: string;
    content: string;
    created_at: string;
  };

  try {
    const byClient: Row[] = [];
    let off = 0;
    while (true) {
      const { data, error } = await supabase
        .from('sms_conversations')
        .select('id, phone_number, client_id, role, content, created_at')
        .eq('client_id', clientId)
        .gte('created_at', startIso)
        .lte('created_at', endIso)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(off, off + PAGE - 1);
      if (error) {
        console.error('[SMS Conversations] Query error:', error);
        throw new Error(error.message);
      }
      const chunk = (data || []) as Row[];
      byClient.push(...chunk);
      if (chunk.length < PAGE) break;
      off += PAGE;
    }

    const byPhone: Row[] = [];
    if (phones.length > 0) {
      off = 0;
      while (true) {
        const { data, error } = await supabase
          .from('sms_conversations')
          .select('id, phone_number, client_id, role, content, created_at')
          .in('phone_number', phones)
          .gte('created_at', startIso)
          .lte('created_at', endIso)
          .order('created_at', { ascending: true })
          .order('id', { ascending: true })
          .range(off, off + PAGE - 1);
        if (error) {
          console.error('[SMS Conversations] Query error:', error);
          throw new Error(error.message);
        }
        const chunk = (data || []) as Row[];
        byPhone.push(...chunk);
        if (chunk.length < PAGE) break;
        off += PAGE;
      }
    }

    const map = new Map<string, Row>();
    for (const r of [...byClient, ...byPhone]) {
      map.set(r.id, r);
    }

    const rows = [...map.values()]
      .filter((r) => !String(r.content || '').startsWith('[processed:'))
      .sort((a, b) => {
        const c = a.created_at.localeCompare(b.created_at);
        return c !== 0 ? c : a.id.localeCompare(b.id);
      });

    return NextResponse.json({
      messages: rows,
      total: rows.length,
      from,
      to,
      clientId,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Query failed' }, { status: 500 });
  }
}
