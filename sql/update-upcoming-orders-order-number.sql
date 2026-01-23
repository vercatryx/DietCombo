-- Update upcoming orders to assign order_number for records that don't have one
-- This assigns sequential order numbers starting from the maximum existing order_number + 1
-- Ensures minimum order number of 100000 (6 digits)

-- Recommended: Using CTE with UPDATE FROM (PostgreSQL 9.1+)
WITH max_order_number AS (
    SELECT COALESCE(
        GREATEST(
            COALESCE((SELECT MAX(order_number) FROM orders WHERE order_number IS NOT NULL), 0),
            COALESCE((SELECT MAX(order_number) FROM upcoming_orders WHERE order_number IS NOT NULL), 0),
            99999  -- Start from 100000 minimum (99999 + 1 = 100000)
        ),
        99999
    ) AS max_num
),
numbered_upcoming AS (
    SELECT 
        id,
        ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS row_num
    FROM upcoming_orders
    WHERE order_number IS NULL
)
UPDATE upcoming_orders uo
SET order_number = mon.max_num + nu.row_num
FROM max_order_number mon, numbered_upcoming nu
WHERE uo.id = nu.id;

-- Alternative: If you want to update only "current" upcoming orders (status = 'scheduled')
-- Uncomment and modify the WHERE clause in numbered_upcoming CTE:
-- WITH max_order_number AS (
--     SELECT COALESCE(
--         GREATEST(
--             COALESCE((SELECT MAX(order_number) FROM orders WHERE order_number IS NOT NULL), 0),
--             COALESCE((SELECT MAX(order_number) FROM upcoming_orders WHERE order_number IS NOT NULL), 0),
--             99999
--         ),
--         99999
--     ) AS max_num
-- ),
-- numbered_upcoming AS (
--     SELECT 
--         id,
--         ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS row_num
--     FROM upcoming_orders
--     WHERE order_number IS NULL 
--       AND status = 'scheduled'  -- Only update scheduled orders
-- )
-- UPDATE upcoming_orders uo
-- SET order_number = mon.max_num + nu.row_num
-- FROM max_order_number mon, numbered_upcoming nu
-- WHERE uo.id = nu.id;
