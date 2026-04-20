import { NextResponse, after } from 'next/server';
import { getSupabaseAdmin } from '@/lib/platform/supabase-admin';
import { handleVoiceSmsInboundSms } from '@/lib/voice-sms/sms';

const recentlyProcessed = new Set<string>();

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const msg = body?.data?.payload || body?.data;
    if (!msg || msg.direction !== 'inbound') return NextResponse.json({ ok: true });

    const from = msg.from?.phone_number;
    const text = msg.text?.trim();
    const messageId = msg.id || '';
    if (!from || !text) return NextResponse.json({ ok: true });

    if (messageId) {
      if (recentlyProcessed.has(messageId)) return NextResponse.json({ ok: true });
      recentlyProcessed.add(messageId);
      if (recentlyProcessed.size > 2000) {
        const first = recentlyProcessed.values().next().value;
        if (first) recentlyProcessed.delete(first);
      }
    }

    after(async () => {
      try {
        const supabase = getSupabaseAdmin();
        await handleVoiceSmsInboundSms({ supabase, fromNumber: from, text, telnyxMessageId: messageId || null });
      } catch (err) {
        console.error('[VoiceSms Telnyx Inbound] handler error:', err);
      }
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[VoiceSms Telnyx Inbound] webhook error:', err);
    return NextResponse.json({ ok: true }, { status: 200 });
  }
}

