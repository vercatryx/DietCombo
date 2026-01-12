-- Add 'Meal' to service_type check constraints

-- Update check constraint for orders table
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_service_type_check;
ALTER TABLE orders ADD CONSTRAINT orders_service_type_check CHECK (service_type IN ('Food', 'Boxes', 'Equipment', 'Meal'));

-- Update check constraint for upcoming_orders table
ALTER TABLE upcoming_orders DROP CONSTRAINT IF EXISTS upcoming_orders_service_type_check;
ALTER TABLE upcoming_orders ADD CONSTRAINT upcoming_orders_service_type_check CHECK (service_type IN ('Food', 'Boxes', 'Equipment', 'Meal'));

-- Verify the change (optional)
-- SELECT constraint_name, check_clause FROM information_schema.check_constraints WHERE constraint_name IN ('orders_service_type_check', 'upcoming_orders_service_type_check');
