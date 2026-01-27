-- SQL Script to Migrate Vendor References and Delete Old Vendor
-- This script replaces all references to vendor 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb' 
-- with 'cccccccc-cccc-cccc-cccc-cccccccccccc' and then safely deletes the old vendor.
--
-- IMPORTANT: Review and verify the vendor IDs before running this script!
-- Old Vendor ID: bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb
-- New Vendor ID: cccccccc-cccc-cccc-cccc-cccccccccccc

BEGIN;

-- Step 1: Verify the new vendor exists
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM vendors WHERE id = 'cccccccc-cccc-cccc-cccc-cccccccccccc') THEN
        RAISE EXCEPTION 'New vendor with id cccccccc-cccc-cccc-cccc-cccccccccccc does not exist. Please verify the vendor ID.';
    END IF;
END $$;

-- Step 2: Update client_box_orders table (the main problematic table)
UPDATE client_box_orders
SET vendor_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    updated_at = NOW()
WHERE vendor_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

-- Step 3: Update order_vendor_selections table
UPDATE order_vendor_selections
SET vendor_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
WHERE vendor_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

-- Step 4: Update order_box_selections table
UPDATE order_box_selections
SET vendor_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
WHERE vendor_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

-- Step 5: Update upcoming_order_vendor_selections table
UPDATE upcoming_order_vendor_selections
SET vendor_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
WHERE vendor_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

-- Step 6: Update upcoming_order_box_selections table
UPDATE upcoming_order_box_selections
SET vendor_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
WHERE vendor_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

-- Step 7: Update delivery_history table
UPDATE delivery_history
SET vendor_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
WHERE vendor_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

-- Step 8: Update menu_items table (optional - these have ON DELETE SET NULL, but we'll migrate them)
UPDATE menu_items
SET vendor_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    updated_at = NOW()
WHERE vendor_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

-- Step 9: Update equipment table (optional - these have ON DELETE SET NULL, but we'll migrate them)
UPDATE equipment
SET vendor_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    updated_at = NOW()
WHERE vendor_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

-- Step 10: Update box_types table (optional - these have ON DELETE SET NULL, but we'll migrate them)
UPDATE box_types
SET vendor_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    updated_at = NOW()
WHERE vendor_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

-- Step 11: Verify no remaining references exist
DO $$
DECLARE
    remaining_count INTEGER;
BEGIN
    -- Check client_box_orders
    SELECT COUNT(*) INTO remaining_count
    FROM client_box_orders
    WHERE vendor_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    
    IF remaining_count > 0 THEN
        RAISE EXCEPTION 'Still % references remaining in client_box_orders table', remaining_count;
    END IF;
    
    -- Check other tables
    SELECT COUNT(*) INTO remaining_count
    FROM order_vendor_selections
    WHERE vendor_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    
    IF remaining_count > 0 THEN
        RAISE EXCEPTION 'Still % references remaining in order_vendor_selections table', remaining_count;
    END IF;
    
    SELECT COUNT(*) INTO remaining_count
    FROM order_box_selections
    WHERE vendor_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    
    IF remaining_count > 0 THEN
        RAISE EXCEPTION 'Still % references remaining in order_box_selections table', remaining_count;
    END IF;
    
    SELECT COUNT(*) INTO remaining_count
    FROM upcoming_order_vendor_selections
    WHERE vendor_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    
    IF remaining_count > 0 THEN
        RAISE EXCEPTION 'Still % references remaining in upcoming_order_vendor_selections table', remaining_count;
    END IF;
    
    SELECT COUNT(*) INTO remaining_count
    FROM upcoming_order_box_selections
    WHERE vendor_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    
    IF remaining_count > 0 THEN
        RAISE EXCEPTION 'Still % references remaining in upcoming_order_box_selections table', remaining_count;
    END IF;
    
    SELECT COUNT(*) INTO remaining_count
    FROM delivery_history
    WHERE vendor_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
    
    IF remaining_count > 0 THEN
        RAISE EXCEPTION 'Still % references remaining in delivery_history table', remaining_count;
    END IF;
END $$;

-- Step 12: Delete the old vendor
DELETE FROM vendors
WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

-- Step 13: Verify deletion
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM vendors WHERE id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb') THEN
        RAISE EXCEPTION 'Failed to delete vendor. Vendor still exists.';
    END IF;
END $$;

COMMIT;

-- Display summary
DO $$
DECLARE
    updated_count INTEGER;
BEGIN
    RAISE NOTICE 'Migration completed successfully!';
    RAISE NOTICE 'All vendor references have been migrated from bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb to cccccccc-cccc-cccc-cccc-cccccccccccc';
    RAISE NOTICE 'Old vendor has been deleted.';
END $$;
