-- Voice + SMS (single account / single number)
-- Paste/run once in Supabase SQL editor.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS voice_sms_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel VARCHAR(10) NOT NULL CHECK (channel IN ('sms', 'voice')),
  user_number VARCHAR(40) NOT NULL,
  call_id VARCHAR(120),
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  telnyx_message_id VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_voice_sms_conversations_channel_user_created
  ON voice_sms_conversations (channel, user_number, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_voice_sms_conversations_call_created
  ON voice_sms_conversations (call_id, created_at DESC)
  WHERE call_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_voice_sms_conversations_telnyx_message_id
  ON voice_sms_conversations (telnyx_message_id)
  WHERE telnyx_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS voice_sms_call_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  call_id VARCHAR(120),
  agent_id VARCHAR(120),
  from_number VARCHAR(40),
  to_number VARCHAR(40),
  event VARCHAR(40) NOT NULL,
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_voice_sms_call_logs_created
  ON voice_sms_call_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_voice_sms_call_logs_call_id
  ON voice_sms_call_logs (call_id);

