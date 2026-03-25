ALTER TABLE sms_conversations ADD COLUMN IF NOT EXISTS telnyx_message_id VARCHAR(100);
CREATE INDEX IF NOT EXISTS idx_sms_conversations_telnyx_msg_id ON sms_conversations (telnyx_message_id) WHERE telnyx_message_id IS NOT NULL;
