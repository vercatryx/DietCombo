-- Drop the existing check constraint on orders status
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status_check;

-- Optionally, we could add a new constraint with more values, but the user requested flexibility ("whatever we put in it").
-- So we will leave it as text without a check constraint, or a very loose one if needed.
-- However, typically `orders_status_check` limits the values. Dropping it allows any text.
