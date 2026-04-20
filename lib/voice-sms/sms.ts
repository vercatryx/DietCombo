import type { SupabaseClient } from '@supabase/supabase-js';
import { sendSms } from '../telnyx';
import { getVoiceSmsConfig } from './config';
import { loadVoiceSmsHistory, pruneVoiceSmsConversation, saveVoiceSmsMessage } from './conversations';
import { runVoiceSmsLlmTurn } from './llm';

const MAX_SMS_LENGTH = 1500;

export async function handleVoiceSmsInboundSms(opts: {
  supabase: SupabaseClient;
  fromNumber: string;
  text: string;
  telnyxMessageId?: string | null;
}): Promise<void> {
  const cfg = getVoiceSmsConfig();
  if (!cfg.sms_enabled) return;

  const where = { channel: 'sms' as const, user_number: opts.fromNumber };
  await pruneVoiceSmsConversation(opts.supabase, where);

  const history = await loadVoiceSmsHistory(opts.supabase, where);
  await saveVoiceSmsMessage(opts.supabase, { channel: 'sms', user_number: opts.fromNumber, role: 'user', content: opts.text, telnyx_message_id: opts.telnyxMessageId ?? null });

  const reply = await runVoiceSmsLlmTurn({
    llm_provider: cfg.llm_provider,
    llm_model: cfg.llm_model,
    system_prompt: cfg.system_prompt,
    history,
    userText: opts.text,
  }).catch((err) => {
    console.error('[VoiceSms SMS] LLM error:', err);
    return 'Sorry — we hit a temporary issue. Please try again.';
  });

  const out = (reply || '').trim();
  const truncated = out.length > MAX_SMS_LENGTH ? out.slice(0, MAX_SMS_LENGTH - 3) + '...' : out;

  await saveVoiceSmsMessage(opts.supabase, { channel: 'sms', user_number: opts.fromNumber, role: 'assistant', content: truncated || '(No response)' });
  await sendSms(opts.fromNumber, truncated, { messageType: 'voice_sms_bot_reply' });
}

