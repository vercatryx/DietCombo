const TELNYX_API_KEY = process.env.TELNYX_API_KEY;
const TELNYX_FROM_NUMBER = process.env.TELNYX_FROM_NUMBER;

export async function sendSms(to: string, text: string): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!TELNYX_API_KEY || !TELNYX_FROM_NUMBER) {
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
        Authorization: `Bearer ${TELNYX_API_KEY}`,
      },
      body: JSON.stringify({ from: TELNYX_FROM_NUMBER, to: e164, text }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.error('[Telnyx] API error:', res.status, data);
      return { success: false, error: `Telnyx ${res.status}: ${data?.errors?.[0]?.detail || 'unknown'}` };
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
