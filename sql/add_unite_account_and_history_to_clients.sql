-- Add unite_account and history columns to clients table
-- unite_account: e.g. 'Regular', 'Brooklyn'
-- history: free-text notes (not shown on dashboard, editable in client sidebar)

ALTER TABLE clients
ADD COLUMN IF NOT EXISTS unite_account VARCHAR(50) NULL,
ADD COLUMN IF NOT EXISTS history TEXT NULL;

COMMENT ON COLUMN clients.unite_account IS 'Account type: Regular, Brooklyn, etc.';
COMMENT ON COLUMN clients.history IS 'Free-form history/notes (sidebar only, not on dashboard).';

-- Set existing clients to Regular
UPDATE clients SET unite_account = 'Regular' WHERE unite_account IS NULL;
