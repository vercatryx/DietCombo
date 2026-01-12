-- Drop the foreign key constraints on updated_by to allow saves without valid user references
-- This is needed because the session userId doesn't always match a valid user in the database

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'client_food_orders') THEN
        ALTER TABLE client_food_orders DROP CONSTRAINT IF EXISTS client_food_orders_updated_by_fkey;
        ALTER TABLE client_food_orders ALTER COLUMN updated_by DROP NOT NULL;
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'client_meal_orders') THEN
        ALTER TABLE client_meal_orders DROP CONSTRAINT IF EXISTS client_meal_orders_updated_by_fkey;
        ALTER TABLE client_meal_orders ALTER COLUMN updated_by DROP NOT NULL;
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'client_box_orders') THEN
        ALTER TABLE client_box_orders DROP CONSTRAINT IF EXISTS client_box_orders_updated_by_fkey;
        ALTER TABLE client_box_orders ALTER COLUMN updated_by DROP NOT NULL;
    END IF;
END $$;
