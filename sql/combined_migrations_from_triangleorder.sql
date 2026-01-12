-- ============================================================================
-- Combined Migration Script from triangleorder
-- This script includes all database schema updates from /triangleorder/sql
-- Run this script to apply all migrations at once
-- ============================================================================

-- ============================================================================
-- 1. CREATE NEW TABLES
-- ============================================================================

-- Create breakfast_categories table
CREATE TABLE IF NOT EXISTS breakfast_categories (
    id VARCHAR(36) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    name TEXT NOT NULL,
    set_value NUMERIC(10,2), -- Optional quota requirement
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create breakfast_items table
CREATE TABLE IF NOT EXISTS breakfast_items (
    id VARCHAR(36) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    category_id VARCHAR(36) REFERENCES breakfast_categories(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    quota_value NUMERIC(10,2) DEFAULT 1,
    price_each NUMERIC(10,2),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Add indexes for breakfast tables
CREATE INDEX IF NOT EXISTS breakfast_items_category_id_idx ON breakfast_items(category_id);

-- Create client_box_orders table
CREATE TABLE IF NOT EXISTS client_box_orders (
  id VARCHAR(36) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  client_id VARCHAR(36) NOT NULL REFERENCES clients(id),
  case_id TEXT,
  box_type_id VARCHAR(36) REFERENCES box_types(id),
  vendor_id VARCHAR(36) REFERENCES vendors(id),
  quantity INTEGER DEFAULT 1,
  items JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- ============================================================================
-- 2. ADD COLUMNS TO EXISTING TABLES
-- ============================================================================

-- Add meal_type to breakfast_categories
ALTER TABLE breakfast_categories 
ADD COLUMN IF NOT EXISTS meal_type TEXT NOT NULL DEFAULT 'Breakfast';

-- Add meal_type to item_categories
ALTER TABLE item_categories 
ADD COLUMN IF NOT EXISTS meal_type TEXT NOT NULL DEFAULT 'Lunch';

-- Add image_url to menu_items
ALTER TABLE menu_items
ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Add sort_order to menu_items
ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

-- Add sort_order to item_categories
ALTER TABLE item_categories ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

-- Add sort_order and image_url to breakfast tables
ALTER TABLE breakfast_categories ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;
ALTER TABLE breakfast_items ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;
ALTER TABLE breakfast_items ADD COLUMN IF NOT EXISTS image_url TEXT;

-- Add notes to order items
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE upcoming_order_items ADD COLUMN IF NOT EXISTS notes TEXT;

-- Add custom_name and custom_price to upcoming_order_items
ALTER TABLE upcoming_order_items
ADD COLUMN IF NOT EXISTS custom_name TEXT,
ADD COLUMN IF NOT EXISTS custom_price NUMERIC(10, 2);

-- Add custom_name and custom_price to order_items
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS custom_name TEXT;
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS custom_price NUMERIC(10, 2);

-- Add meal_item_id to order_items and upcoming_order_items
ALTER TABLE upcoming_order_items 
ADD COLUMN IF NOT EXISTS meal_item_id VARCHAR(36) REFERENCES breakfast_items(id);

ALTER TABLE order_items 
ADD COLUMN IF NOT EXISTS meal_item_id VARCHAR(36) REFERENCES breakfast_items(id);

-- Add meal_type to upcoming_orders
ALTER TABLE upcoming_orders 
ADD COLUMN IF NOT EXISTS meal_type TEXT DEFAULT 'Lunch';

-- ============================================================================
-- 3. MODIFY DATA TYPES
-- ============================================================================

-- Change quota_value and set_value columns to support decimal values
ALTER TABLE breakfast_categories ALTER COLUMN set_value TYPE NUMERIC(10,2) USING set_value::NUMERIC;
ALTER TABLE breakfast_items ALTER COLUMN quota_value TYPE NUMERIC(10,2) USING quota_value::NUMERIC;

-- Change menu_items.quota_value to support decimal values for box category items
ALTER TABLE menu_items ALTER COLUMN quota_value TYPE NUMERIC(10,2) USING quota_value::NUMERIC;

-- Change item_categories.set_value to support decimal values (if column exists)
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'item_categories' AND column_name = 'set_value'
    ) THEN
        ALTER TABLE item_categories ALTER COLUMN set_value TYPE NUMERIC(10,2) USING set_value::NUMERIC;
    END IF;
END $$;

-- Change CIN column from NUMERIC to VARCHAR to allow letters
ALTER TABLE clients 
ALTER COLUMN cin TYPE VARCHAR(50) USING cin::text;

-- Update the comment for CIN
COMMENT ON COLUMN clients.cin IS 'CIN number for the dependent (can contain letters and numbers).';

-- ============================================================================
-- 4. UPDATE EXISTING DATA
-- ============================================================================

-- Update existing records to have a default meal_type if it was null
UPDATE upcoming_orders SET meal_type = 'Lunch' WHERE meal_type IS NULL;

-- ============================================================================
-- 5. MODIFY CONSTRAINTS - Make columns nullable
-- ============================================================================

-- Make menu_item_id nullable in order_items and upcoming_order_items
ALTER TABLE order_items ALTER COLUMN menu_item_id DROP NOT NULL;
ALTER TABLE upcoming_order_items ALTER COLUMN menu_item_id DROP NOT NULL;

-- Allow vendor_id to be NULL in vendor selections
ALTER TABLE upcoming_order_vendor_selections ALTER COLUMN vendor_id DROP NOT NULL;
ALTER TABLE order_vendor_selections ALTER COLUMN vendor_id DROP NOT NULL;

-- Make take_effect_date nullable
ALTER TABLE upcoming_orders ALTER COLUMN take_effect_date DROP NOT NULL;

-- Make updated_by nullable in order tables
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'client_food_orders' AND column_name = 'updated_by'
    ) THEN
        ALTER TABLE client_food_orders ALTER COLUMN updated_by DROP NOT NULL;
    END IF;
    
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'client_meal_orders' AND column_name = 'updated_by'
    ) THEN
        ALTER TABLE client_meal_orders ALTER COLUMN updated_by DROP NOT NULL;
    END IF;
    
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'client_box_orders' AND column_name = 'updated_by'
    ) THEN
        ALTER TABLE client_box_orders ALTER COLUMN updated_by DROP NOT NULL;
    END IF;
END $$;

ALTER TABLE orders ALTER COLUMN updated_by DROP NOT NULL;

-- ============================================================================
-- 6. DROP OLD CONSTRAINTS
-- ============================================================================

-- Drop the foreign key constraint on menu_item_id in order_items
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 
        FROM information_schema.table_constraints 
        WHERE constraint_name = 'order_items_menu_item_id_fkey' 
        AND table_name = 'order_items'
    ) THEN
        ALTER TABLE order_items DROP CONSTRAINT order_items_menu_item_id_fkey;
    END IF;
END $$;

-- Drop foreign key constraints on updated_by
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE table_name = 'client_food_orders' 
        AND constraint_name = 'client_food_orders_updated_by_fkey'
    ) THEN
        ALTER TABLE client_food_orders DROP CONSTRAINT client_food_orders_updated_by_fkey;
    END IF;
    
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE table_name = 'client_meal_orders' 
        AND constraint_name = 'client_meal_orders_updated_by_fkey'
    ) THEN
        ALTER TABLE client_meal_orders DROP CONSTRAINT client_meal_orders_updated_by_fkey;
    END IF;
    
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE table_name = 'client_box_orders' 
        AND constraint_name = 'client_box_orders_updated_by_fkey'
    ) THEN
        ALTER TABLE client_box_orders DROP CONSTRAINT client_box_orders_updated_by_fkey;
    END IF;
END $$;

-- Drop old unique constraint on upcoming_orders
ALTER TABLE upcoming_orders DROP CONSTRAINT IF EXISTS unique_upcoming_order_per_client_per_day;
DROP INDEX IF EXISTS unique_upcoming_order_per_client_per_day;

-- ============================================================================
-- 7. ADD NEW CONSTRAINTS AND INDEXES
-- ============================================================================

-- Add indexes for meal_type columns
CREATE INDEX IF NOT EXISTS idx_breakfast_categories_meal_type ON breakfast_categories(meal_type);
CREATE INDEX IF NOT EXISTS idx_item_categories_meal_type ON item_categories(meal_type);

-- Add new unique constraint including meal_type for upcoming_orders
CREATE UNIQUE INDEX IF NOT EXISTS unique_upcoming_order_per_client_day_meal 
ON upcoming_orders (client_id, delivery_day, meal_type)
WHERE delivery_day IS NOT NULL;

-- Add foreign key constraints for meal_item_id with proper delete behavior
ALTER TABLE upcoming_order_items 
DROP CONSTRAINT IF EXISTS upcoming_order_items_meal_item_id_fkey;

ALTER TABLE upcoming_order_items
ADD CONSTRAINT upcoming_order_items_meal_item_id_fkey 
FOREIGN KEY (meal_item_id) 
REFERENCES breakfast_items(id) 
ON DELETE CASCADE;

ALTER TABLE order_items 
DROP CONSTRAINT IF EXISTS order_items_meal_item_id_fkey;

ALTER TABLE order_items
ADD CONSTRAINT order_items_meal_item_id_fkey 
FOREIGN KEY (meal_item_id) 
REFERENCES breakfast_items(id) 
ON DELETE SET NULL;

-- Update service_type check constraints to include 'Meal' and 'Custom'
-- Drop constraints first (allows dropping even if data violates them)
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_service_type_check;
ALTER TABLE upcoming_orders DROP CONSTRAINT IF EXISTS upcoming_orders_service_type_check;

-- Update any existing data that might not match the new constraint
-- Temporarily disable triggers to avoid trigger function errors
SET session_replication_role = 'replica';

-- Update orders table: ensure all service_type values are valid
-- Map common variations to valid values
UPDATE orders 
SET service_type = CASE 
    WHEN service_type IN ('Food', 'Meal', 'Boxes', 'Equipment', 'Custom') THEN service_type
    WHEN service_type = 'Meals' THEN 'Meal'
    WHEN service_type LIKE '%Food%' OR service_type LIKE '%Meal%' THEN 'Food'
    WHEN service_type LIKE '%Box%' THEN 'Boxes'
    WHEN service_type LIKE '%Equipment%' THEN 'Equipment'
    ELSE 'Food'  -- Default fallback
END
WHERE service_type IS NOT NULL 
  AND service_type NOT IN ('Food', 'Meal', 'Boxes', 'Equipment', 'Custom');

-- Update upcoming_orders table: ensure all service_type values are valid
UPDATE upcoming_orders 
SET service_type = CASE 
    WHEN service_type IN ('Food', 'Meal', 'Boxes', 'Equipment', 'Custom') THEN service_type
    WHEN service_type = 'Meals' THEN 'Meal'
    WHEN service_type LIKE '%Food%' OR service_type LIKE '%Meal%' THEN 'Food'
    WHEN service_type LIKE '%Box%' THEN 'Boxes'
    WHEN service_type LIKE '%Equipment%' THEN 'Equipment'
    ELSE 'Food'  -- Default fallback
END
WHERE service_type IS NOT NULL 
  AND service_type NOT IN ('Food', 'Meal', 'Boxes', 'Equipment', 'Custom');

-- Re-enable triggers
SET session_replication_role = 'origin';

-- Now add the constraints back (will validate all existing data)
ALTER TABLE orders ADD CONSTRAINT orders_service_type_check CHECK (service_type IN ('Food', 'Meal', 'Boxes', 'Equipment', 'Custom'));

ALTER TABLE upcoming_orders ADD CONSTRAINT upcoming_orders_service_type_check CHECK (service_type IN ('Food', 'Meal', 'Boxes', 'Equipment', 'Custom'));

-- ============================================================================
-- 8. REMOVE COLUMNS
-- ============================================================================

-- Remove focus columns from menu_items and breakfast_items
ALTER TABLE menu_items DROP COLUMN IF EXISTS focus_x;
ALTER TABLE menu_items DROP COLUMN IF EXISTS focus_y;
ALTER TABLE menu_items DROP COLUMN IF EXISTS focus_zoom;

ALTER TABLE breakfast_items DROP COLUMN IF EXISTS focus_x;
ALTER TABLE breakfast_items DROP COLUMN IF EXISTS focus_y;
ALTER TABLE breakfast_items DROP COLUMN IF EXISTS focus_zoom;

-- ============================================================================
-- Migration Complete
-- ============================================================================
