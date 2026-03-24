import { NextResponse } from 'next/server';
import { handleInboundSms } from '@/lib/sms-bot';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        console.log('[Telnyx Inbound] Webhook received:', JSON.stringify(body).slice(0, 500));

        const msg = body?.data?.payload || body?.data;
        if (!msg || msg.direction !== 'inbound') {
            return NextResponse.json({ ok: true });
        }

        const from = msg.from?.phone_number;
        const text = msg.text?.trim();
        if (!from || !text) {
            return NextResponse.json({ ok: true });
        }

        console.log(`[Telnyx Inbound] Message from ${from}: "${text.slice(0, 100)}"`);

        await handleInboundSms(from, text);

        return NextResponse.json({ ok: true });
    } catch (err) {
        console.error('[Telnyx Inbound] Webhook error:', err);
        return NextResponse.json({ ok: true }, { status: 200 });
    }
}
