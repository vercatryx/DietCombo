import { NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/platform/supabase-admin';
import { sendEmail } from '@/lib/email';
import { getVoiceSmsConfig } from '@/lib/voice-sms/config';

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const event = body?.event;
    const call = body?.call ?? {};

    const cfg = getVoiceSmsConfig();
    const supabase = getSupabaseAdmin();

    await supabase.from('voice_sms_call_logs').insert({
      call_id: call?.call_id ?? null,
      agent_id: call?.agent_id ?? null,
      from_number: call?.from_number ?? null,
      to_number: call?.to_number ?? null,
      event: String(event || 'unknown'),
      raw_payload: body,
    });

    if ((event === 'call_ended' || event === 'call_analyzed') && cfg.post_call_email) {
      const transcript = String(call?.transcript ?? '').trim();
      const subject = `Call ${event || 'event'}`;
      const html = `
        <h2>${event || 'event'}</h2>
        <p><strong>Call ID:</strong> ${call?.call_id ?? '(unknown)'}</p>
        <p><strong>From:</strong> ${call?.from_number ?? '(unknown)'}</p>
        <p><strong>To:</strong> ${call?.to_number ?? '(unknown)'}</p>
        <pre style="white-space:pre-wrap;border:1px solid #ddd;padding:12px;border-radius:8px;">${escapeHtml(transcript || '(no transcript)')}</pre>
      `;
      await sendEmail({ to: cfg.post_call_email, subject, html }).catch(() => {});
    }

    if (cfg.webhook_url) {
      fetch(cfg.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event, call }),
      }).catch(() => {});
    }

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    console.error('[Retell webhook] error:', err);
    return new NextResponse(null, { status: 204 });
  }
}

