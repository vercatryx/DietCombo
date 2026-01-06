-- Add authorized_amount and expiration_date columns to clients table
-- authorized_amount: The authorized amount for the client (numeric/decimal for currency)
-- expiration_date: The expiration date for the client's authorization (DATE type)

ALTER TABLE clients 
ADD COLUMN IF NOT EXISTS authorized_amount NUMERIC(10, 2),
ADD COLUMN IF NOT EXISTS expiration_date DATE;

-- Add comments for documentation
COMMENT ON COLUMN clients.authorized_amount IS 'Authorized amount for the client.';
COMMENT ON COLUMN clients.expiration_date IS 'Expiration date for the client authorization (DATE type).';

