import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Max SMS bot replies to numbers that are not in `clients` (outbound with no client_id) per rolling 24h.
 * Stops unknown-number ping-pong when `sms_bot_inbound_blocks` is not migrated or auto-detect misses.
 * Set to 0 to disable. Default 1.
 */
export function getUnknownCannedReplyCap24h(): number {
  const raw = process.env.SMS_BOT_MAX_UNKNOWN_CANS_PER_24H;
  if (raw === undefined || raw.trim() === '') return 1;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n) || n < 0) return 1;
  return n;
}

/** Successful bot_reply rows with no client in the last 24h (rolling). */
export async function countNonClientBotRepliesLast24h(
  supabase: SupabaseClient,
  phoneE164: string,
): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from('sms_outbound_log')
    .select('id', { count: 'exact', head: true })
    .eq('phone_to', phoneE164)
    .eq('message_type', 'bot_reply')
    .is('client_id', null)
    .eq('success', true)
    .gte('created_at', since);
  if (error) {
    console.warn('[sms_outbound_log] count for unknown cap failed:', error.message);
    return 0;
  }
  return count ?? 0;
}

/** Returns true when this E.164 should receive no SMS bot replies (persisted block). */
export async function isSmsInboundBlocked(supabase: SupabaseClient, phoneE164: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('sms_bot_inbound_blocks')
    .select('phone_e164')
    .eq('phone_e164', phoneE164)
    .maybeSingle();
  if (error) {
    console.warn('[sms_bot_inbound_blocks] read failed:', error.message);
    return false;
  }
  return !!data?.phone_e164;
}

export async function blockInboundSmsSender(
  supabase: SupabaseClient,
  phoneE164: string,
  reason: string,
): Promise<void> {
  const { error } = await supabase.from('sms_bot_inbound_blocks').upsert(
    { phone_e164: phoneE164, reason: reason.slice(0, 255) },
    { onConflict: 'phone_e164' },
  );
  if (error) console.error('[sms_bot_inbound_blocks] upsert failed:', error.message);
}

/** Call when a real client matches this phone so automated-reply blocks don’t stick if they enroll later. */
export async function clearSmsInboundBlockIfPresent(
  supabase: SupabaseClient,
  phoneE164: string,
): Promise<void> {
  const { error } = await supabase.from('sms_bot_inbound_blocks').delete().eq('phone_e164', phoneE164);
  if (error) console.warn('[sms_bot_inbound_blocks] delete failed:', error.message);
}
