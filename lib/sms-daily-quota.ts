import type { SupabaseClient } from '@supabase/supabase-js';
import { appTzDateKeysToUtcIsoRangeInclusive, getTodayInAppTz } from './timezone';

/** Max inbound user messages per phone per calendar day (Eastern) across SMS bot, voice bot, and voice-SMS. */
export const SMS_BOT_DAILY_USER_MESSAGE_LIMIT = Math.max(
  1,
  Number.parseInt(process.env.SMS_BOT_DAILY_USER_MESSAGE_LIMIT || '30', 10) || 30,
);

export function getSmsDailyQuotaExceededMessage(): string {
  const custom = process.env.SMS_BOT_QUOTA_EXCEEDED_MESSAGE?.trim();
  if (custom) return custom;
  return `You've reached the daily limit of ${SMS_BOT_DAILY_USER_MESSAGE_LIMIT} messages for this number. We'll be able to help again tomorrow. For urgent needs, call (845) 478-6605. — The Diet Fantasy`;
}

function phoneFuzzyPattern(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  const last10 = digits.slice(-10);
  if (last10.length < 10) return null;
  return `%${last10.split('').join('%')}%`;
}

/**
 * Counts user-role rows today (app TZ) for this phone across all bot surfaces.
 */
export async function countUnifiedUserBotMessagesToday(
  supabase: SupabaseClient,
  phone: string,
): Promise<number> {
  const fuzzy = phoneFuzzyPattern(phone);
  if (!fuzzy) return 0;

  const today = getTodayInAppTz();
  const { startIso, endIso } = appTzDateKeysToUtcIsoRangeInclusive(today, today);

  const [smsRes, voiceSmsRes, callRes] = await Promise.all([
    supabase
      .from('sms_conversations')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'user')
      .ilike('phone_number', fuzzy)
      .gte('created_at', startIso)
      .lte('created_at', endIso),
    supabase
      .from('voice_sms_conversations')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'user')
      .eq('channel', 'sms')
      .ilike('user_number', fuzzy)
      .gte('created_at', startIso)
      .lte('created_at', endIso),
    supabase
      .from('call_conversations')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'user')
      .ilike('phone_number', fuzzy)
      .gte('created_at', startIso)
      .lte('created_at', endIso),
  ]);

  return (smsRes.count ?? 0) + (voiceSmsRes.count ?? 0) + (callRes.count ?? 0);
}
