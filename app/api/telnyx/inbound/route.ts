import { NextResponse } from 'next/server';
import { sendSms } from '@/lib/telnyx';

const AUTO_REPLY =
    'Thank you for your message. This number is not able to receive replies. ' +
    'For any questions or support, please call us at (845) 478-6605. ' +
    '— The Diet Fantasy';

export async function POST(request: Request) {
    try {
        const body = await request.json();
        const event = body?.data;

        if (event?.event_type !== 'message.received') {
            return NextResponse.json({ ok: true });
        }

        const from = event?.payload?.from?.phone_number;
        if (!from) {
            return NextResponse.json({ ok: true });
        }

        await sendSms(from, AUTO_REPLY);

        console.log(`[Telnyx Inbound] Auto-replied to ${from}`);
        return NextResponse.json({ ok: true });
    } catch (err) {
        console.error('[Telnyx Inbound] Webhook error:', err);
        return NextResponse.json({ ok: true }, { status: 200 });
    }
}
