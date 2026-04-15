CREATE TABLE IF NOT EXISTS call_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone_number VARCHAR(40) NOT NULL,
    client_id VARCHAR(36),
    direction VARCHAR(20) NOT NULL DEFAULT 'inbound' CHECK (direction IN ('inbound', 'outbound')),
    provider VARCHAR(30) NOT NULL DEFAULT 'telnyx',
    telnyx_event_id VARCHAR(100),
    telnyx_call_control_id VARCHAR(100),
    event_type VARCHAR(100) NOT NULL,
    status VARCHAR(40),
    started_at TIMESTAMPTZ,
    ended_at TIMESTAMPTZ,
    duration_seconds INTEGER,
    from_number VARCHAR(40),
    to_number VARCHAR(40),
    raw_payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_call_events_phone_created
    ON call_events (phone_number, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_call_events_client_created
    ON call_events (client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_call_events_telnyx_call_control_id
    ON call_events (telnyx_call_control_id) WHERE telnyx_call_control_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_call_events_telnyx_event_id
    ON call_events (telnyx_event_id) WHERE telnyx_event_id IS NOT NULL;
