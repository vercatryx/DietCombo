-- Change quota_value and set_value columns to support decimal values
ALTER TABLE breakfast_categories ALTER COLUMN set_value TYPE NUMERIC(10,2) USING set_value::NUMERIC;
ALTER TABLE breakfast_items ALTER COLUMN quota_value TYPE NUMERIC(10,2) USING quota_value::NUMERIC;

-- Change menu_items.quota_value to support decimal values for box category items
ALTER TABLE menu_items ALTER COLUMN quota_value TYPE NUMERIC(10,2) USING quota_value::NUMERIC;

-- Change item_categories.set_value to support decimal values (if column exists)
DO $$ 
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'item_categories' AND column_name = 'set_value'
    ) THEN
        ALTER TABLE item_categories ALTER COLUMN set_value TYPE NUMERIC(10,2) USING set_value::NUMERIC;
    END IF;
END $$;
