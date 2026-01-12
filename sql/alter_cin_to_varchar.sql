-- Migration: Change CIN column from NUMERIC to VARCHAR to allow letters
-- This updates the existing column type if it was previously created as NUMERIC

-- First, check if the column exists and alter it
-- Note: This will fail if the column doesn't exist, so run add_dob_and_cin_to_clients.sql first if needed

ALTER TABLE clients 
ALTER COLUMN cin TYPE VARCHAR(50) USING cin::text;

-- Update the comment
COMMENT ON COLUMN clients.cin IS 'CIN number for the dependent (can contain letters and numbers).';
