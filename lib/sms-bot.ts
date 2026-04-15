import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseDbApiKey } from './supabase-env';
import { sendSms } from './telnyx';
import { normalizePhone } from './phone-utils';
import { identifyClientByPhone, runAssistantTurn } from './bot-core';

const MAX_SMS_LENGTH = 1500;

function getSupabaseAdmin(): SupabaseClient {
    return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        getSupabaseDbApiKey()!,
    );
}

// ── Main conversation handler ───────────────────────────────────────

export async function handleInboundSms(phone: string, messageText: string): Promise<void> {
    try {
        const supabase = getSupabaseAdmin();
        // Client is actively texting us, so this number works.
        // Clear do_not_text flag for this number on all matched accounts.
        const clients = await identifyClientByPhone(supabase, phone);
        const e164Phone = normalizePhone(phone);
        for (const c of clients) {
            const flaggedMap: Record<string, string> = c.do_not_text_numbers || {};
            if (e164Phone && flaggedMap[e164Phone]) {
                delete flaggedMap[e164Phone];
                await supabase.from('clients').update({ do_not_text_numbers: flaggedMap, do_not_text: false }).eq('id', c.id);
            }
        }

        const { replyText, activeClientId, clientName } = await runAssistantTurn({
            supabase,
            channel: 'sms',
            phone,
            conversationTable: 'sms_conversations',
            where: { phone_number: phone },
            messageText,
            restoreActiveClientFromTable: true,
        });

        const truncated = replyText.length > MAX_SMS_LENGTH ? replyText.slice(0, MAX_SMS_LENGTH - 3) + '...' : replyText;
        await sendSms(phone, truncated, { clientId: activeClientId || undefined, clientName: clientName || undefined, messageType: 'bot_reply' });

    } catch (err: any) {
        console.error('[SMS Bot] Fatal error:', err);
        await sendSms(phone, 'Sorry, we hit a temporary issue. Please try again or call (845) 478-6605 for help. — The Diet Fantasy', { messageType: 'bot_reply' }).catch(() => {});
    }
}
