export type VoiceSmsProvider = 'anthropic' | 'openai' | 'google';

export function getVoiceSmsConfig(): {
  llm_provider: VoiceSmsProvider;
  llm_model: string;
  system_prompt: string;
  sms_enabled: boolean;
  voice_enabled: boolean;
  post_call_email: string | null;
  webhook_url: string | null;
} {
  const llm_provider = (process.env.VOICE_SMS_LLM_PROVIDER || 'anthropic') as VoiceSmsProvider;
  const llm_model = process.env.VOICE_SMS_LLM_MODEL || 'claude-haiku-4-5';
  const system_prompt = process.env.VOICE_SMS_SYSTEM_PROMPT || '';
  const sms_enabled = (process.env.VOICE_SMS_SMS_ENABLED ?? 'true') === 'true';
  const voice_enabled = (process.env.VOICE_SMS_VOICE_ENABLED ?? 'true') === 'true';
  const post_call_email = (process.env.VOICE_SMS_POST_CALL_EMAIL || '').trim() || null;
  const webhook_url = (process.env.VOICE_SMS_WEBHOOK_URL || '').trim() || null;

  return { llm_provider, llm_model, system_prompt, sms_enabled, voice_enabled, post_call_email, webhook_url };
}

