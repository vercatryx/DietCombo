-- AlterTable: Remove foreign key constraint on stops.order_id
-- This allows stops.order_id to reference either orders.id or upcoming_orders.id

-- DropForeignKeys
ALTER TABLE "stops" DROP CONSTRAINT IF EXISTS "fk_stops_order_id";
ALTER TABLE "stops" DROP CONSTRAINT IF EXISTS "stops_order_id_fkey";

-- Note: The order_id column will remain as a String field and can now accept
-- values from both orders.id and upcoming_orders.id tables.
-- Referential integrity must be handled at the application level.
