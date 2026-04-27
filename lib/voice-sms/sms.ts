import type { SupabaseClient } from '@supabase/supabase-js';
import { sendSms } from '../telnyx';
import { identifyClientByPhone } from '../bot-core';
import { detectInboundAutomatedPingPongReply } from '../sms-auto-reply-detection';
import {
  blockInboundSmsSender,
  clearSmsInboundBlockIfPresent,
  isSmsInboundBlocked,
} from '../sms-inbound-blocks';
import {
  countUnifiedUserBotMessagesToday,
  getSmsDailyQuotaExceededMessage,
  SMS_BOT_DAILY_USER_MESSAGE_LIMIT,
} from '../sms-daily-quota';
import { normalizePhone } from '../phone-utils';
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

  const norm = normalizePhone(opts.fromNumber);
  if (norm && (await isSmsInboundBlocked(opts.supabase, norm))) return;

  const linkedClients = await identifyClientByPhone(opts.supabase, opts.fromNumber);
  if (linkedClients.length > 0 && norm) {
    await clearSmsInboundBlockIfPresent(opts.supabase, norm);
  } else if (
    linkedClients.length === 0 &&
    norm &&
    (await detectInboundAutomatedPingPongReply(opts.text))
  ) {
    await blockInboundSmsSender(opts.supabase, norm, 'voice_sms_automated_inbound');
    console.log('[VoiceSms SMS] Blocked automated inbound (non-client):', norm);
    return;
  }

  const priorToday = await countUnifiedUserBotMessagesToday(opts.supabase, opts.fromNumber);
  if (priorToday > SMS_BOT_DAILY_USER_MESSAGE_LIMIT) return;

  const where = { channel: 'sms' as const, user_number: opts.fromNumber };
  await pruneVoiceSmsConversation(opts.supabase, where);

  if (priorToday === SMS_BOT_DAILY_USER_MESSAGE_LIMIT) {
    const quotaMsg = getSmsDailyQuotaExceededMessage();
    await saveVoiceSmsMessage(opts.supabase, {
      channel: 'sms',
      user_number: opts.fromNumber,
      role: 'user',
      content: opts.text,
      telnyx_message_id: opts.telnyxMessageId ?? null,
    });
    await saveVoiceSmsMessage(opts.supabase, {
      channel: 'sms',
      user_number: opts.fromNumber,
      role: 'assistant',
      content: quotaMsg,
    });
    await sendSms(opts.fromNumber, quotaMsg, { messageType: 'voice_sms_quota_exceeded' });
    return;
  }

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

