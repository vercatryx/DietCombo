import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseDbApiKey } from './supabase-env';
import { normalizePhone, getAllClientNumbers, getTextableNumbers } from './phone-utils';

export { normalizePhone, parsePhoneField, getAllClientNumbers, getTextableNumbers } from './phone-utils';

const SMS_UNFIXABLE_CODES = new Set([400, 403, 404, 422]);

function getAdminSupabase(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, getSupabaseDbApiKey()!);
}

async function flagNumberDoNotText(clientId: string, e164: string, reason: string) {
  try {
    const supabase = getAdminSupabase();
    const { data: client } = await supabase
      .from('clients')
      .select('phone_number, secondary_phone_number, do_not_text_numbers')
      .eq('id', clientId)
      .single();
    if (!client) return;

    const flaggedMap: Record<string, string> = client.do_not_text_numbers || {};
    flaggedMap[e164] = reason;

    const allNumbers = getAllClientNumbers(client);
    const allFlagged = allNumbers.every(raw => {
      const norm = normalizePhone(raw);
      return !norm || !!flaggedMap[norm];
    });

    await supabase.from('clients').update({
      do_not_text_numbers: flaggedMap,
      do_not_text: allFlagged,
      do_not_text_reason: reason,
    }).eq('id', clientId);

    console.log(`[Telnyx] Flagged ${e164} for client ${clientId}: ${reason} (all_flagged=${allFlagged})`);
  } catch (err) {
    console.error('[Telnyx] Failed to flag do_not_text_numbers:', err);
  }
}

async function logOutboundSms(entry: {
  clientId?: string; clientName?: string; phoneTo: string; messageType: string;
  telnyxMessageId?: string; success: boolean; error?: string;
}) {
  try {
    const supabase = getAdminSupabase();
    await supabase.from('sms_outbound_log').insert({
      client_id: entry.clientId || null,
      client_name: entry.clientName || null,
      phone_to: entry.phoneTo,
      message_type: entry.messageType,
      telnyx_message_id: entry.telnyxMessageId || null,
      success: entry.success,
      error: entry.error || null,
    });
  } catch (err) {
    console.error('[Telnyx] Failed to log outbound SMS:', err);
  }
}

export async function sendSms(
  to: string,
  text: string,
  options?: { clientId?: string; clientName?: string; messageType?: string },
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const apiKey = process.env.TELNYX_API_KEY;
  const fromNumber = process.env.TELNYX_FROM_NUMBER;

  if (!apiKey || !fromNumber) {
    console.error('[Telnyx] Missing TELNYX_API_KEY or TELNYX_FROM_NUMBER');
    return { success: false, error: 'Telnyx not configured' };
  }

  const e164 = normalizePhone(to);
  if (!e164) {
    return { success: false, error: `Invalid phone number: ${to}` };
  }

  const msgType = options?.messageType || 'unknown';

  try {
    const res = await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ from: fromNumber, to: e164, text }),
    });

    const data: any = await res.json().catch(() => ({}));

    if (!res.ok) {
      const errorDetail = data?.errors?.[0]?.detail || 'unknown';
      const errorCode = data?.errors?.[0]?.code || '';
      console.error('[Telnyx] API error:', res.status, data);

      logOutboundSms({ clientId: options?.clientId, clientName: options?.clientName, phoneTo: e164, messageType: msgType, success: false, error: `${res.status}/${errorCode}: ${errorDetail}` });

      if (options?.clientId && SMS_UNFIXABLE_CODES.has(res.status)) {
        const reason = `Telnyx ${res.status}/${errorCode}: ${errorDetail}`.slice(0, 255);
        await flagNumberDoNotText(options.clientId, e164, reason);
      }

      return { success: false, error: `Telnyx ${res.status}: ${errorDetail}` };
    }

    const messageId = data?.data?.id;
    console.log(`[Telnyx] SMS queued to ${e164} (id: ${messageId})`);
    logOutboundSms({ clientId: options?.clientId, clientName: options?.clientName, phoneTo: e164, messageType: msgType, telnyxMessageId: messageId, success: true });
    return { success: true, messageId };
  } catch (err: any) {
    console.error('[Telnyx] Network error:', err);
    logOutboundSms({ clientId: options?.clientId, clientName: options?.clientName, phoneTo: e164, messageType: msgType, success: false, error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * Send an SMS to a client, trying each of their numbers in order.
 * Skips numbers already flagged in do_not_text_numbers.
 * Falls through to the next number on Telnyx failure.
 * Returns the result of the first successful send, or the last failure.
 */
export async function sendSmsToClient(
  client: {
    id: string;
    full_name?: string | null;
    phone_number?: string | null;
    secondary_phone_number?: string | null;
    do_not_text?: boolean;
    do_not_text_numbers?: Record<string, string> | null;
  },
  text: string,
  messageType = 'delivery_notification',
): Promise<{ success: boolean; error?: string }> {
  if (client.do_not_text) {
    console.log(`[Telnyx] Skipping client ${client.id} — do_not_text is set`);
    return { success: false, error: 'Client flagged as do_not_text' };
  }

  const allNumbers = getAllClientNumbers(client);
  const flaggedMap = client.do_not_text_numbers || {};
  const textable = getTextableNumbers(allNumbers, flaggedMap);

  if (textable.length === 0) {
    console.log(`[Telnyx] No textable numbers for client ${client.id}`);
    return { success: false, error: 'No textable numbers' };
  }

  let lastResult: { success: boolean; error?: string } = { success: false, error: 'No numbers tried' };
  for (const number of textable) {
    lastResult = await sendSms(number, text, { clientId: client.id, clientName: client.full_name || undefined, messageType });
    if (lastResult.success) return lastResult;
    console.log(`[Telnyx] Failed to send to ${number} for client ${client.id}, trying next...`);
  }

  return lastResult;
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
