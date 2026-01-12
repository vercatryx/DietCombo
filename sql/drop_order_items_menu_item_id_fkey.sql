-- The order_items table has a foreign key constraint 'order_items_menu_item_id_fkey' 
-- that forces 'menu_item_id' to exist in the 'menu_items' table.
-- However, 'Meal' orders use items from 'breakfast_items', which are not in 'menu_items'.
-- This prevents Meal order items from being inserted.
-- We verify if the constraint exists before dropping it to make the script idempotent.

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
