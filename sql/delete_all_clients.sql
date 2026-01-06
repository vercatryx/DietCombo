-- DATA CLEANUP SCRIPT
-- Deletes all clients and their associated data including orders, billing history, and logs.
-- Executed in reverse dependency order to satisfy foreign key constraints.

BEGIN;

-- 1. Delete Upcoming Order Data (Deepest Level First)
DELETE FROM upcoming_order_items;
DELETE FROM upcoming_order_vendor_selections;
DELETE FROM upcoming_order_box_selections;
DELETE FROM upcoming_orders;

-- 2. Delete Active/Past Order Data (Deepest Level First)
DELETE FROM order_items;
DELETE FROM order_vendor_selections;
DELETE FROM order_box_selections;
DELETE FROM billing_records; -- References clients and/or orders
DELETE FROM orders;

-- 3. Delete Client Auxiliary Data
DELETE FROM form_submissions;
DELETE FROM navigator_logs;

-- 4. Delete Clients
-- First delete dependents (clients referencing other clients)
DELETE FROM clients WHERE parent_client_id IS NOT NULL;
-- Then delete remaining clients (parents)
DELETE FROM clients;

COMMIT;

-- Verify results
SELECT count(*) as remaining_clients FROM clients;
