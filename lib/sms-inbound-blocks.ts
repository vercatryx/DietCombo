import type { SupabaseClient } from '@supabase/supabase-js';

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
