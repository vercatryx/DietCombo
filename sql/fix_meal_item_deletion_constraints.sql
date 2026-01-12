-- Fix foreign key constraints to allow deleting menu items
-- 1. For upcoming orders: If a menu item is deleted, remove it from the upcoming order (CASCADE)
-- 2. For past orders: If a menu item is deleted, keep the order item record but set the reference to NULL (SET NULL)

-- Adjusting 'upcoming_order_items'
ALTER TABLE upcoming_order_items 
DROP CONSTRAINT IF EXISTS upcoming_order_items_meal_item_id_fkey;

ALTER TABLE upcoming_order_items
ADD CONSTRAINT upcoming_order_items_meal_item_id_fkey 
FOREIGN KEY (meal_item_id) 
REFERENCES breakfast_items(id) 
ON DELETE CASCADE;

-- Adjusting 'order_items' (past records)
-- We use SET NULL here so we don't lose the record of the sale, 
-- but we don't block the deletion of the menu item.
ALTER TABLE order_items 
DROP CONSTRAINT IF EXISTS order_items_meal_item_id_fkey;

ALTER TABLE order_items
ADD CONSTRAINT order_items_meal_item_id_fkey 
FOREIGN KEY (meal_item_id) 
REFERENCES breakfast_items(id) 
ON DELETE SET NULL;
