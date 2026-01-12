-- Make updated_by nullable in new order tables
-- This allows orders to be saved even when the session user ID doesn't match a valid foreign key reference

-- Check if tables exist before altering
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'client_food_orders') THEN
        ALTER TABLE client_food_orders ALTER COLUMN updated_by DROP NOT NULL;
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'client_meal_orders') THEN
        ALTER TABLE client_meal_orders ALTER COLUMN updated_by DROP NOT NULL;
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'client_box_orders') THEN
        ALTER TABLE client_box_orders ALTER COLUMN updated_by DROP NOT NULL;
    END IF;
END $$;

ALTER TABLE orders ALTER COLUMN updated_by DROP NOT NULL;
