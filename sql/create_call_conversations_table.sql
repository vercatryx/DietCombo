CREATE TABLE IF NOT EXISTS call_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    call_control_id VARCHAR(100) NOT NULL,
    phone_number VARCHAR(40) NOT NULL,
    client_id VARCHAR(36),
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    telnyx_event_id VARCHAR(100),
    utterance_id VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_call_conversations_call_created
    ON call_conversations (call_control_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_call_conversations_phone_created
    ON call_conversations (phone_number, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_call_conversations_client_created
    ON call_conversations (client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_call_conversations_telnyx_event_id
    ON call_conversations (telnyx_event_id) WHERE telnyx_event_id IS NOT NULL;
