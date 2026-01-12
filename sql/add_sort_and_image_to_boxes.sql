ALTER TABLE item_categories ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;

-- menu_items already has image_url and sort_order from previous tasks.
-- If not, unrelated to this specific task but good to double check:
-- ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS image_url TEXT;
-- ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;
