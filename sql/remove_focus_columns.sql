-- Remove focus columns from menu_items and breakfast_items
ALTER TABLE menu_items DROP COLUMN IF EXISTS focus_x;
ALTER TABLE menu_items DROP COLUMN IF EXISTS focus_y;
ALTER TABLE menu_items DROP COLUMN IF EXISTS focus_zoom;

ALTER TABLE breakfast_items DROP COLUMN IF EXISTS focus_x;
ALTER TABLE breakfast_items DROP COLUMN IF EXISTS focus_y;
ALTER TABLE breakfast_items DROP COLUMN IF EXISTS focus_zoom;
