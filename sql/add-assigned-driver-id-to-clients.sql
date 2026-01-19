-- Migration: Add assigned_driver_id to clients table
-- This allows clients to be assigned to drivers, and stops will automatically inherit this assignment

-- Add assigned_driver_id column to clients table
ALTER TABLE clients 
ADD COLUMN IF NOT EXISTS assigned_driver_id VARCHAR(36) NULL;

-- Add foreign key constraint to drivers table
ALTER TABLE clients 
ADD CONSTRAINT IF NOT EXISTS clients_assigned_driver_id_fkey 
FOREIGN KEY (assigned_driver_id) REFERENCES drivers(id) ON DELETE SET NULL;

-- Add index for performance
CREATE INDEX IF NOT EXISTS idx_clients_assigned_driver_id ON clients(assigned_driver_id);

-- Update existing stops to match their client's assigned driver (if client has one)
-- This migration step ensures existing stops are synchronized with client assignments
UPDATE stops s
SET assigned_driver_id = c.assigned_driver_id
FROM clients c
WHERE s.client_id = c.id 
  AND c.assigned_driver_id IS NOT NULL
  AND (s.assigned_driver_id IS NULL OR s.assigned_driver_id != c.assigned_driver_id);
