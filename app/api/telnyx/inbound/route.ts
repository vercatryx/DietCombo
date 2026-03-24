import { NextResponse } from 'next/server';
import { sendSms } from '@/lib/telnyx';

const AUTO_REPLY =
    'Thank you for your message. This number is not able to receive replies. ' +
    'For any questions or support, please call us at (845) 478-6605. ' +
    '— The Diet Fantasy';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        console.log('[Telnyx Inbound] Webhook received:', JSON.stringify(body).slice(0, 500));

        const msg = body?.data?.payload || body?.data;
        if (!msg) {
            console.log('[Telnyx Inbound] No data in payload, skipping');
            return NextResponse.json({ ok: true });
        }

        if (msg.direction !== 'inbound') {
            console.log('[Telnyx Inbound] Not inbound, skipping');
            return NextResponse.json({ ok: true });
        }

        const from = msg.from?.phone_number;
        if (!from) {
            console.log('[Telnyx Inbound] No from number, skipping');
            return NextResponse.json({ ok: true });
        }

        console.log(`[Telnyx Inbound] Sending auto-reply to ${from}`);
        const result = await sendSms(from, AUTO_REPLY);
        console.log(`[Telnyx Inbound] sendSms result:`, JSON.stringify(result));

        return NextResponse.json({ ok: true });
    } catch (err) {
        console.error('[Telnyx Inbound] Webhook error:', err);
        return NextResponse.json({ ok: true }, { status: 200 });
    }
}
