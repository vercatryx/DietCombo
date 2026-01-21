-- Migration: Modify stops.order_id foreign key to allow upcoming_order IDs
-- This allows stops to reference upcoming_orders.id in addition to orders.id
-- 
-- IMPORTANT: Since PostgreSQL doesn't support foreign keys that reference multiple tables,
-- we need to remove the foreign key constraint and handle referential integrity at the application level
-- OR create a union/abstract table structure (more complex)
--
-- For now, we'll remove the FK constraint to allow both orders.id and upcoming_orders.id values

-- Drop the existing foreign key constraint
ALTER TABLE "stops" 
DROP CONSTRAINT IF EXISTS "fk_stops_order_id";

ALTER TABLE "stops" 
DROP CONSTRAINT IF EXISTS "stops_order_id_fkey";

-- Note: The order_id column will now accept any UUID value
-- Application code must ensure referential integrity by:
-- 1. Validating that order_id exists in either orders.id OR upcoming_orders.id
-- 2. Handling cascading deletes/updates in application logic

-- Keep the index for performance
CREATE INDEX IF NOT EXISTS "idx_stops_order_id" ON "stops"("order_id");
