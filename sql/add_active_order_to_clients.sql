-- Add active_order column to clients table
-- active_order: JSON field storing the client's current active order information

ALTER TABLE clients 
ADD COLUMN active_order JSON NULL;

