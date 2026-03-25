import { NextResponse, after } from 'next/server';
import { handleInboundSms } from '@/lib/sms-bot';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseDbApiKey } from '@/lib/supabase-env';

// In-memory set for fast dedup within the same instance; DB for cross-instance
const recentlyProcessed = new Set<string>();

async function isAlreadyProcessed(messageId: string): Promise<boolean> {
    if (!messageId) return false;
    if (recentlyProcessed.has(messageId)) return true;
    try {
        const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, getSupabaseDbApiKey()!);
        const { data } = await supabase
            .from('sms_conversations')
            .select('id')
            .eq('telnyx_message_id', messageId)
            .limit(1);
        return (data?.length ?? 0) > 0;
    } catch {
        return false;
    }
}

async function markProcessed(messageId: string, phone: string): Promise<void> {
    if (!messageId) return;
    recentlyProcessed.add(messageId);
    // Cap memory set size
    if (recentlyProcessed.size > 1000) {
        const first = recentlyProcessed.values().next().value;
        if (first) recentlyProcessed.delete(first);
    }
    try {
        const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, getSupabaseDbApiKey()!);
        await supabase.from('sms_conversations').insert({
            phone_number: phone,
            role: 'system',
            content: `[processed:${messageId}]`,
            telnyx_message_id: messageId,
        });
    } catch {
        // Column may not exist yet — dedup still works via in-memory set
    }
}

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
        const messageId = msg.id || '';
        if (!from || !text) {
            return NextResponse.json({ ok: true });
        }

        // Skip duplicate webhook deliveries
        if (messageId && await isAlreadyProcessed(messageId)) {
            console.log(`[Telnyx Inbound] Skipping duplicate message ${messageId}`);
            return NextResponse.json({ ok: true });
        }

        console.log(`[Telnyx Inbound] Message from ${from}: "${text.slice(0, 100)}" (id: ${messageId})`);

        // Mark as processed immediately to prevent duplicate processing from retries
        await markProcessed(messageId, from);

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
