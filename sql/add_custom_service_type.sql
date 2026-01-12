-- Add 'Custom' to the valid service types for orders
-- We drop the existing constraint and add a new one that includes 'Custom'

DO $$
BEGIN
    -- Drop the existing constraint if it exists (names may vary, checking standard name)
    IF EXISTS (
        SELECT 1 
        FROM information_schema.table_constraints 
        WHERE constraint_name = 'orders_service_type_check' 
        AND table_name = 'orders'
    ) THEN
        ALTER TABLE orders DROP CONSTRAINT orders_service_type_check;
    END IF;

    -- Add the new constraint
    ALTER TABLE orders 
    ADD CONSTRAINT orders_service_type_check 
    CHECK (service_type IN ('Food', 'Meal', 'Boxes', 'Equipment', 'Custom'));
END $$;
