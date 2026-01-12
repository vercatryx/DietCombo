-- Add custom_name and custom_price to upcoming_order_items for Custom Order templates
ALTER TABLE upcoming_order_items
ADD COLUMN IF NOT EXISTS custom_name TEXT,
ADD COLUMN IF NOT EXISTS custom_price NUMERIC(10, 2);
