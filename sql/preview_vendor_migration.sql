-- Preview Script: Shows what will be updated before running the migration
-- Run this first to see how many records will be affected
-- Old Vendor ID: bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb
-- New Vendor ID: cccccccc-cccc-cccc-cccc-cccccccccccc

-- Check if new vendor exists
SELECT 
    CASE 
        WHEN EXISTS (SELECT 1 FROM vendors WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc') 
        THEN '✓ New vendor exists' 
        ELSE '✗ ERROR: New vendor does NOT exist!' 
    END AS vendor_check;

-- Show vendor details
SELECT 
    id,
    name,
    email,
    service_type,
    is_active,
    created_at
FROM vendors
WHERE id IN ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'cccccccc-cccc-cccc-cccc-cccccccccccc')
ORDER BY id;

-- Count records that will be updated in each table
SELECT 
    'client_box_orders' AS table_name,
    COUNT(*) AS records_to_update
FROM client_box_orders
WHERE vendor_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

UNION ALL

SELECT 
    'order_vendor_selections' AS table_name,
    COUNT(*) AS records_to_update
FROM order_vendor_selections
WHERE vendor_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

UNION ALL

SELECT 
    'order_box_selections' AS table_name,
    COUNT(*) AS records_to_update
FROM order_box_selections
WHERE vendor_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

UNION ALL

SELECT 
    'upcoming_order_vendor_selections' AS table_name,
    COUNT(*) AS records_to_update
FROM upcoming_order_vendor_selections
WHERE vendor_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

UNION ALL

SELECT 
    'upcoming_order_box_selections' AS table_name,
    COUNT(*) AS records_to_update
FROM upcoming_order_box_selections
WHERE vendor_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

UNION ALL

SELECT 
    'delivery_history' AS table_name,
    COUNT(*) AS records_to_update
FROM delivery_history
WHERE vendor_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

UNION ALL

SELECT 
    'menu_items' AS table_name,
    COUNT(*) AS records_to_update
FROM menu_items
WHERE vendor_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

UNION ALL

SELECT 
    'equipment' AS table_name,
    COUNT(*) AS records_to_update
FROM equipment
WHERE vendor_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'

UNION ALL

SELECT 
    'box_types' AS table_name,
    COUNT(*) AS records_to_update
FROM box_types
WHERE vendor_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

-- Show sample records from client_box_orders (the main problematic table)
SELECT 
    id,
    client_id,
    case_id,
    box_type_id,
    vendor_id AS current_vendor_id,
    quantity,
    created_at
FROM client_box_orders
WHERE vendor_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
LIMIT 10;
