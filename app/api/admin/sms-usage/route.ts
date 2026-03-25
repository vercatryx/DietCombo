import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseDbApiKey } from '@/lib/supabase-env';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  if (!from || !to) {
    return NextResponse.json({ error: 'Missing from/to date params' }, { status: 400 });
  }

  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, getSupabaseDbApiKey()!);

  const { data, error } = await supabase
    .from('sms_outbound_log')
    .select('client_id, client_name, phone_to, message_type, success, created_at')
    .gte('created_at', `${from}T00:00:00`)
    .lte('created_at', `${to}T23:59:59`)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[SMS Usage] Query error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const byClient: Record<string, {
    clientId: string | null;
    clientName: string;
    total: number;
    botReply: number;
    delivery: number;
    other: number;
    failed: number;
    numbers: Set<string>;
  }> = {};

  for (const row of data || []) {
    const key = row.client_id || row.phone_to;
    if (!byClient[key]) {
      byClient[key] = {
        clientId: row.client_id,
        clientName: row.client_name || row.phone_to,
        total: 0,
        botReply: 0,
        delivery: 0,
        other: 0,
        failed: 0,
        numbers: new Set(),
      };
    }
    const entry = byClient[key];
    entry.total++;
    entry.numbers.add(row.phone_to);
    if (!row.success) entry.failed++;
    if (row.message_type === 'bot_reply') entry.botReply++;
    else if (row.message_type === 'delivery_notification') entry.delivery++;
    else entry.other++;
  }

  const clients = Object.values(byClient)
    .map(e => ({
      clientId: e.clientId,
      clientName: e.clientName,
      total: e.total,
      botReply: e.botReply,
      delivery: e.delivery,
      other: e.other,
      failed: e.failed,
      numbers: [...e.numbers],
    }))
    .sort((a, b) => b.total - a.total);

  const totalMessages = (data || []).length;
  const totalFailed = (data || []).filter(r => !r.success).length;

  return NextResponse.json({ clients, totalMessages, totalFailed, from, to });
}
