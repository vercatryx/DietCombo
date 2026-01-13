-- Fix for Simulate Delivery Cycle Errors
-- 
-- Issues Fixed:
-- 1. order_vendor_selections.id column missing default UUID generation
-- 2. Order dbe1f9c8-4b72-49bd-8470-1ea4ef82fc10 has null delivery_day
--
-- Run this in Supabase SQL Editor

-- ============================================
-- Fix 0: Fix the update_updated_at_column function to handle both updated_at and last_updated
-- ============================================
-- The function currently only handles updated_at, but upcoming_orders uses last_updated
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    -- Handle tables with updated_at column (admins, app_settings, etc.)
    IF TG_TABLE_NAME IN ('admins', 'app_settings', 'clients', 'drivers', 'equipment', 
                          'menu_items', 'box_types', 'vendors', 'navigators', 'client_statuses') THEN
        NEW.updated_at := CURRENT_TIMESTAMP;
    END IF;
    
    -- Handle tables with last_updated column (upcoming_orders, orders, etc.)
    IF TG_TABLE_NAME IN ('upcoming_orders', 'orders') THEN
        NEW.last_updated := CURRENT_TIMESTAMP;
    END IF;
    
    RETURN NEW;
END;
$$ language 'plpgsql';

-- ============================================
-- Fix 1: Add default UUID generation to order_vendor_selections.id
-- ============================================
-- This allows inserts without explicitly providing an id
ALTER TABLE order_vendor_selections 
ALTER COLUMN id SET DEFAULT uuid_generate_v4()::text;

-- ============================================
-- Fix 2: Update order with null delivery_day
-- ============================================
-- For order dbe1f9c8-4b72-49bd-8470-1ea4ef82fc10, set delivery_day based on vendor information
-- If the order has vendor selections, use the first delivery day from the vendor
-- Otherwise, set a default delivery day (Monday)

DO $$
DECLARE
    order_id_to_fix VARCHAR(36) := 'dbe1f9c8-4b72-49bd-8470-1ea4ef82fc10';
    vendor_delivery_day VARCHAR(50);
    default_delivery_day VARCHAR(50) := 'Monday';
BEGIN
    -- Try to find delivery day from vendor selections
    -- Get the first delivery day from the first vendor associated with this order
    SELECT TRIM(BOTH '"' FROM (v.delivery_days->0)::text) INTO vendor_delivery_day
    FROM upcoming_orders uo
    LEFT JOIN upcoming_order_vendor_selections uovs ON uovs.upcoming_order_id = uo.id
    LEFT JOIN vendors v ON v.id = uovs.vendor_id
    WHERE uo.id = order_id_to_fix
      AND v.delivery_days IS NOT NULL
      AND jsonb_typeof(v.delivery_days) = 'array'
      AND jsonb_array_length(v.delivery_days) > 0
    ORDER BY uovs.created_at
    LIMIT 1;

    -- If no vendor delivery day found, use default
    IF vendor_delivery_day IS NULL THEN
        vendor_delivery_day := default_delivery_day;
    END IF;

    -- Update the order
    -- The trigger function is now fixed to handle last_updated, so we can update normally
    UPDATE upcoming_orders
    SET delivery_day = vendor_delivery_day
    WHERE id = order_id_to_fix
      AND delivery_day IS NULL;
    
    -- The trigger will automatically update last_updated

    -- Log the update
    RAISE NOTICE 'Updated order % with delivery_day: %', order_id_to_fix, vendor_delivery_day;
END $$;

-- ============================================
-- Verification queries
-- ============================================
-- Check that the order_vendor_selections table now has default
SELECT 
    column_name,
    column_default,
    is_nullable
FROM information_schema.columns
WHERE table_name = 'order_vendor_selections'
  AND column_name = 'id';

-- Check that the order now has a delivery_day
SELECT 
    id,
    client_id,
    service_type,
    delivery_day,
    status
FROM upcoming_orders
WHERE id = 'dbe1f9c8-4b72-49bd-8470-1ea4ef82fc10';
