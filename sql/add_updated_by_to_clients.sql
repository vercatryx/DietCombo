-- Add updated_by column to clients table
-- This column tracks who last updated the client record

ALTER TABLE clients 
ADD COLUMN IF NOT EXISTS updated_by VARCHAR(255) NULL;

-- Add comment for documentation
COMMENT ON COLUMN clients.updated_by IS 'User who last updated the client record';
