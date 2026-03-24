import { NextResponse, after } from 'next/server';
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

        // Respond to Telnyx immediately, then process the bot in the background.
        // after() keeps the Vercel function alive until the work completes.
        after(async () => {
            try {
                await handleInboundSms(from, text);
            } catch (err) {
                console.error('[Telnyx Inbound] Bot error:', err);
            }
        });

        return NextResponse.json({ ok: true });
    } catch (err) {
        console.error('[Telnyx Inbound] Webhook error:', err);
        return NextResponse.json({ ok: true }, { status: 200 });
    }
}
