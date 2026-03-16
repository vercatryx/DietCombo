-- Add role column to admins table for account types: 'admin' (full), 'brooklyn_admin' (Brooklyn-only).
-- Existing rows default to 'admin'.

ALTER TABLE admins
ADD COLUMN IF NOT EXISTS role VARCHAR(50) NULL;

UPDATE admins SET role = 'admin' WHERE role IS NULL;

COMMENT ON COLUMN admins.role IS 'Account type: admin (full access), brooklyn_admin (clients/routes/meal-plan-edits, Brooklyn only).';
