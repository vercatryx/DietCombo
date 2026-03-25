CREATE TABLE IF NOT EXISTS sms_outbound_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id VARCHAR(36),
    client_name VARCHAR(255),
    phone_to VARCHAR(40) NOT NULL,
    message_type VARCHAR(30) NOT NULL DEFAULT 'bot_reply',
    telnyx_message_id VARCHAR(100),
    success BOOLEAN NOT NULL DEFAULT true,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sms_outbound_log_created
    ON sms_outbound_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sms_outbound_log_client
    ON sms_outbound_log (client_id, created_at DESC);
