
-- Add enable_passwordless_login column to app_settings table
ALTER TABLE app_settings 
ADD COLUMN IF NOT EXISTS enable_passwordless_login BOOLEAN DEFAULT FALSE;

-- Create table specifically for passwordless login codes
CREATE TABLE IF NOT EXISTS passwordless_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    code TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    attempts INTEGER DEFAULT 0
);

-- Index for faster lookup by email
CREATE INDEX IF NOT EXISTS idx_passwordless_codes_email ON passwordless_codes(email);

-- Comment for documentation
COMMENT ON TABLE passwordless_codes IS 'Stores temporary OTP codes for passwordless login.';
