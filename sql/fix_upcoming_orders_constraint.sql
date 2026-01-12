-- Drop the old constraint strictly
ALTER TABLE upcoming_orders DROP CONSTRAINT IF EXISTS unique_upcoming_order_per_client_per_day;

-- Drop the index if it exists under that name too (sometimes constraints are backed by indexes)
DROP INDEX IF EXISTS unique_upcoming_order_per_client_per_day;

-- Create the new index including meal_type
CREATE UNIQUE INDEX IF NOT EXISTS unique_upcoming_order_per_client_day_meal 
ON upcoming_orders (client_id, delivery_day, meal_type)
WHERE delivery_day IS NOT NULL;
