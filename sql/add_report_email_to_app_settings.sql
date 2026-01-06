-- Add report_email column to app_settings table
-- This column stores the email address for delivery simulation reports
-- Used in: GlobalSettings (admin UI) for automatic email notifications when orders are skipped

ALTER TABLE app_settings 
ADD COLUMN IF NOT EXISTS report_email TEXT;

-- Add comment for documentation
COMMENT ON COLUMN app_settings.report_email IS 'Email address to receive delivery simulation reports for skipped orders.';








