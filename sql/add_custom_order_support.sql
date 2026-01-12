-- 1. Make menu_item_id nullable allows items without a predefined menu reference
ALTER TABLE order_items ALTER COLUMN menu_item_id DROP NOT NULL;

-- 2. Add custom_name column for the description of custom items
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS custom_name TEXT;

-- 3. Add custom_price column for the manually entered price
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS custom_price NUMERIC(10, 2);

-- Note: The constraint 'order_items_menu_item_id_fkey' might still enforce reference integrity if not null. 
-- Ensure the constraint allows nulls (standard behavior) or was dropped if it was overly strict.
-- Based on standard Postgres, DROP NOT NULL logic above is sufficient if the FK allows NULLs.
