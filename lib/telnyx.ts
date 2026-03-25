import { createClient } from '@supabase/supabase-js';
import { getSupabaseDbApiKey } from './supabase-env';

const SMS_UNFIXABLE_CODES = new Set([400, 403, 404, 422]);

async function flagDoNotText(clientId: string, reason: string) {
  try {
    const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, getSupabaseDbApiKey()!);
    await supabase.from('clients').update({ do_not_text: true, do_not_text_reason: reason }).eq('id', clientId);
    console.log(`[Telnyx] Flagged client ${clientId} as do_not_text: ${reason}`);
  } catch (err) {
    console.error('[Telnyx] Failed to flag do_not_text:', err);
  }
}

export async function sendSms(
  to: string,
  text: string,
  options?: { clientId?: string },
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const apiKey = process.env.TELNYX_API_KEY;
  const fromNumber = process.env.TELNYX_FROM_NUMBER;

  if (!apiKey || !fromNumber) {
    console.error('[Telnyx] Missing TELNYX_API_KEY or TELNYX_FROM_NUMBER');
    return { success: false, error: 'Telnyx not configured' };
  }

  const cleaned = to.replace(/[^\d+]/g, '');
  if (cleaned.length < 10) {
    return { success: false, error: `Invalid phone number: ${to}` };
  }
  const e164 = cleaned.startsWith('+') ? cleaned : `+1${cleaned}`;

  try {
    const res = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ from: fromNumber, to: e164, text }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const errorDetail = data?.errors?.[0]?.detail || 'unknown';
      const errorCode = data?.errors?.[0]?.code || '';
      console.error('[Telnyx] API error:', res.status, data);

      if (options?.clientId && SMS_UNFIXABLE_CODES.has(res.status)) {
        const reason = `Telnyx ${res.status}/${errorCode}: ${errorDetail}`.slice(0, 255);
        flagDoNotText(options.clientId, reason);
      }

      return { success: false, error: `Telnyx ${res.status}: ${errorDetail}` };
    }

    const messageId = data?.data?.id;
    console.log(`[Telnyx] SMS queued to ${e164} (id: ${messageId})`);
    return { success: true, messageId };
  } catch (err: any) {
    console.error('[Telnyx] Network error:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Format a Date as "March 29, 5:32 PM" in Eastern time.
 */
export function formatDeliveryTimestamp(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
}
