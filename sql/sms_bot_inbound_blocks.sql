-- Numbers that triggered automated-reply / bounce detection: stop all SMS bot outbound to them.
CREATE TABLE IF NOT EXISTS sms_bot_inbound_blocks (
    phone_e164 VARCHAR(24) PRIMARY KEY,
    reason VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sms_bot_inbound_blocks_created ON sms_bot_inbound_blocks (created_at DESC);
