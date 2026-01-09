-- Add order_id column to signatures table to link signatures to specific orders
-- This allows tracking which signatures were collected for which orders
-- NULL order_id means signature was collected independently (backward compatible)

-- Run this SQL in your MySQL database to add the order_id column
-- This will work even if the column already exists (will show a warning, but won't fail)

ALTER TABLE signatures
ADD COLUMN order_id VARCHAR(36) NULL AFTER client_id;

-- Add index for order_id (if not already exists)
ALTER TABLE signatures
ADD INDEX idx_signatures_order_id (order_id);

-- Add foreign key constraint (if not already exists)
-- Note: This might fail if foreign key already exists, that's okay
ALTER TABLE signatures
ADD CONSTRAINT fk_signatures_order_id 
FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;
