-- Add meal_item_id to upcoming_order_items
ALTER TABLE upcoming_order_items 
ADD COLUMN IF NOT EXISTS meal_item_id VARCHAR(36) REFERENCES breakfast_items(id);

-- Make menu_item_id nullable if it isn't already (usually it is, but to be safe)
ALTER TABLE upcoming_order_items 
ALTER COLUMN menu_item_id DROP NOT NULL;

-- Add meal_item_id to order_items (for when orders are promoted)
ALTER TABLE order_items 
ADD COLUMN IF NOT EXISTS meal_item_id VARCHAR(36) REFERENCES breakfast_items(id);

-- Make menu_item_id nullable in order_items
ALTER TABLE order_items 
ALTER COLUMN menu_item_id DROP NOT NULL;

-- Optional: specific constraint to ensure at least one is set?
-- ALTER TABLE upcoming_order_items ADD CONSTRAINT check_item_id_exists CHECK (menu_item_id IS NOT NULL OR meal_item_id IS NOT NULL);
-- ALTER TABLE order_items ADD CONSTRAINT check_order_item_id_exists CHECK (menu_item_id IS NOT NULL OR meal_item_id IS NOT NULL);
