-- ================================================================
-- Cleanup Script: Run After Deleting All Orders
-- ================================================================
-- You deleted all rows from the orders table. These tables have
-- references to orders and may contain orphaned data. Run these
-- in order. Use a transaction for safety.
--
-- Tables affected:
-- 1. order_vendor_selections, order_items, order_box_selections
--    - Had CASCADE from orders, so may already be empty if you used
--      DELETE FROM orders. If you used TRUNCATE without CASCADE,
--      they may have orphaned rows.
-- 2. billing_records - order_id FK was DROPPED, orphaned refs remain
-- 3. signatures - order_id FK was DROPPED, orphaned refs remain
-- 4. stops - order_id FK removed (can ref orders or upcoming_orders)
-- 5. upcoming_orders - processed_order_id points to deleted orders
-- 6. meal_planner_orders - processed_order_id points to deleted orders
-- ================================================================

BEGIN;

-- 1. Delete order_vendor_selections that reference non-existent orders
--    When orders table is empty, this deletes ALL order_vendor_selections
DELETE FROM order_vendor_selections
WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = order_vendor_selections.order_id);

-- 2. Delete order_items whose vendor_selection no longer exists
DELETE FROM order_items
WHERE NOT EXISTS (SELECT 1 FROM order_vendor_selections ovs WHERE ovs.id = order_items.vendor_selection_id);

-- 3. Delete order_box_selections that reference non-existent orders
DELETE FROM order_box_selections
WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = order_box_selections.order_id);

-- 4. billing_records: SET order_id = NULL for refs to deleted orders
UPDATE billing_records
SET order_id = NULL
WHERE order_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = billing_records.order_id);

-- 5. signatures: SET order_id = NULL for refs to deleted orders
UPDATE signatures
SET order_id = NULL
WHERE order_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = signatures.order_id);

-- 6. stops: SET order_id = NULL where it pointed to orders (now deleted)
--    order_id can reference orders OR upcoming_orders; clear only refs to deleted orders
UPDATE stops
SET order_id = NULL
WHERE order_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = stops.order_id)
  AND NOT EXISTS (SELECT 1 FROM upcoming_orders uo WHERE uo.id = stops.order_id);

-- 7. upcoming_orders: clear processed_order_id (pointed to deleted orders)
UPDATE upcoming_orders
SET processed_order_id = NULL, processed_at = NULL
WHERE processed_order_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = upcoming_orders.processed_order_id);

-- 8. meal_planner_orders: clear processed_order_id
UPDATE meal_planner_orders
SET processed_order_id = NULL, processed_at = NULL
WHERE processed_order_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = meal_planner_orders.processed_order_id);

COMMIT;

-- ================================================================
-- Optional: If you also want to clear ALL data (not just orphans):
-- ================================================================
-- Run these only if you want a full reset of order-related data.
-- Uncomment as needed.

-- TRUNCATE order_items CASCADE;
-- TRUNCATE order_vendor_selections CASCADE;
-- TRUNCATE order_box_selections CASCADE;
-- DELETE FROM billing_records WHERE order_id IS NOT NULL;  -- or all billing_records
-- UPDATE signatures SET order_id = NULL WHERE order_id IS NOT NULL;
-- UPDATE stops SET order_id = NULL WHERE order_id IS NOT NULL;
-- UPDATE upcoming_orders SET processed_order_id = NULL, processed_at = NULL;
-- UPDATE meal_planner_orders SET processed_order_id = NULL, processed_at = NULL;
