CREATE TABLE IF NOT EXISTS sms_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_number VARCHAR(40) NOT NULL,
    client_id VARCHAR(36),
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    telnyx_message_id VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sms_conversations_phone_created
    ON sms_conversations (phone_number, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sms_conversations_client_id
    ON sms_conversations (client_id);

CREATE INDEX IF NOT EXISTS idx_sms_conversations_telnyx_msg_id
    ON sms_conversations (telnyx_message_id)
    WHERE telnyx_message_id IS NOT NULL;
