-- Platform Voice & SMS (Retell + Telnyx) — single paste migration
-- Safe to run multiple times (IF NOT EXISTS / ADD COLUMN IF NOT EXISTS where applicable)

-- Required for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ───────────────────────────────────────────────────────────────────────────────
-- Per-client configuration (one shared infra, many clients)
-- ───────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS platform_clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number VARCHAR(40) NOT NULL,
  retell_agent_id VARCHAR(120),

  llm_provider VARCHAR(20) NOT NULL DEFAULT 'anthropic' CHECK (llm_provider IN ('anthropic', 'openai', 'google')),
  llm_model VARCHAR(120) NOT NULL DEFAULT 'claude-haiku-4-5',
  system_prompt TEXT NOT NULL DEFAULT '',

  transfer_number VARCHAR(40),
  post_call_email VARCHAR(255),
  webhook_url TEXT,

  sms_enabled BOOLEAN NOT NULL DEFAULT true,
  voice_enabled BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_clients_phone_number
  ON platform_clients (phone_number);

CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_clients_retell_agent_id
  ON platform_clients (retell_agent_id)
  WHERE retell_agent_id IS NOT NULL;

-- ───────────────────────────────────────────────────────────────────────────────
-- Conversation history (shared logic for SMS + Voice)
-- ───────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS platform_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES platform_clients(id) ON DELETE CASCADE,
  channel VARCHAR(10) NOT NULL CHECK (channel IN ('sms', 'voice')),
  user_number VARCHAR(40) NOT NULL,
  call_id VARCHAR(120),

  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,

  telnyx_message_id VARCHAR(120),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_conversations_client_channel_user_created
  ON platform_conversations (client_id, channel, user_number, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_platform_conversations_call_created
  ON platform_conversations (call_id, created_at DESC)
  WHERE call_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_conversations_telnyx_message_id
  ON platform_conversations (telnyx_message_id)
  WHERE telnyx_message_id IS NOT NULL;

-- ───────────────────────────────────────────────────────────────────────────────
-- Call lifecycle logs from Retell webhook
-- ───────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS platform_call_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES platform_clients(id) ON DELETE CASCADE,
  call_id VARCHAR(120),
  agent_id VARCHAR(120),
  from_number VARCHAR(40),
  to_number VARCHAR(40),
  event VARCHAR(40) NOT NULL,
  raw_payload JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_call_logs_client_created
  ON platform_call_logs (client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_platform_call_logs_call_id
  ON platform_call_logs (call_id);

