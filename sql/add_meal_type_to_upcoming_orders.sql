-- Add meal_type column
ALTER TABLE upcoming_orders 
ADD COLUMN IF NOT EXISTS meal_type TEXT DEFAULT 'Lunch';

-- Update existing records to have a default meal_type if it was null (though we set default above)
UPDATE upcoming_orders SET meal_type = 'Lunch' WHERE meal_type IS NULL;

-- Drop old unique constraint
ALTER TABLE upcoming_orders 
DROP CONSTRAINT IF EXISTS unique_upcoming_order_per_client_per_day;

-- Drop the index if it exists under that name too (sometimes constraints are backed by indexes)
DROP INDEX IF EXISTS unique_upcoming_order_per_client_per_day;

-- Add new unique constraint including meal_type
CREATE UNIQUE INDEX IF NOT EXISTS unique_upcoming_order_per_client_day_meal 
ON upcoming_orders (client_id, delivery_day, meal_type)
WHERE delivery_day IS NOT NULL;
