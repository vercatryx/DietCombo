-- Rename clients.active_order to clients.upcoming_order to align with UPCOMING_ORDER_SCHEMA.md
-- The column stores the client's upcoming order payload (JSONB); only allowed fields per serviceType are persisted.

ALTER TABLE "clients" RENAME COLUMN "active_order" TO "upcoming_order";
