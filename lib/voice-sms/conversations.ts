import type { SupabaseClient } from '@supabase/supabase-js';

const CONVERSATION_TTL_HOURS = 6;
const MAX_HISTORY_MESSAGES = 30;

function cutoffIso(): string {
  return new Date(Date.now() - CONVERSATION_TTL_HOURS * 60 * 60 * 1000).toISOString();
}

export async function pruneVoiceSmsConversation(
  supabase: SupabaseClient,
  where: { channel: 'sms' | 'voice'; user_number: string; call_id?: string | null },
): Promise<void> {
  const cutoff = cutoffIso();
  let q: any = supabase.from('voice_sms_conversations').delete();
  q = q.eq('channel', where.channel).eq('user_number', where.user_number);
  if (where.call_id) q = q.eq('call_id', where.call_id);
  await q.lt('created_at', cutoff);
}

export async function loadVoiceSmsHistory(
  supabase: SupabaseClient,
  where: { channel: 'sms' | 'voice'; user_number: string; call_id?: string | null },
): Promise<{ role: 'user' | 'assistant'; content: string }[]> {
  const cutoff = cutoffIso();
  let q: any = supabase
    .from('voice_sms_conversations')
    .select('role, content')
    .eq('channel', where.channel)
    .eq('user_number', where.user_number)
    .gte('created_at', cutoff);
  if (where.call_id) q = q.eq('call_id', where.call_id);
  const { data, error } = await q.order('created_at', { ascending: true }).limit(MAX_HISTORY_MESSAGES);
  if (error) throw error;

  const raw = (data ?? []).filter((r: any) =>
    r.content &&
    r.role !== 'system' &&
    !String(r.content).startsWith('[processed:') &&
    !String(r.content).startsWith('Sorry, we hit a temporary issue')
  );

  const history: { role: 'user' | 'assistant'; content: string }[] = [];
  for (const row of raw) {
    if (row.role !== 'user' && row.role !== 'assistant') continue;
    if (history.length > 0 && history[history.length - 1].role === row.role) history[history.length - 1].content += '\n' + row.content;
    else history.push({ role: row.role, content: row.content });
  }

  while (history.length > 0 && history[0].role !== 'user') history.shift();
  while (history.length > 0 && history[history.length - 1].role !== 'user') history.pop();
  return history;
}

export async function saveVoiceSmsMessage(
  supabase: SupabaseClient,
  row: {
    channel: 'sms' | 'voice';
    user_number: string;
    call_id?: string | null;
    role: 'user' | 'assistant' | 'system';
    content: string;
    telnyx_message_id?: string | null;
  },
): Promise<void> {
  const { error } = await supabase.from('voice_sms_conversations').insert({
    channel: row.channel,
    user_number: row.user_number,
    call_id: row.call_id ?? null,
    role: row.role,
    content: row.content,
    telnyx_message_id: row.telnyx_message_id ?? null,
  });
  if (error) throw error;
}

