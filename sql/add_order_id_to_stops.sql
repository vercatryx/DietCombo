-- Migration: Add order_id column to stops table
-- This migration adds the order_id field to link stops to their related orders

-- For Supabase/PostgreSQL
-- Add order_id column
ALTER TABLE stops 
ADD COLUMN IF NOT EXISTS order_id VARCHAR(36) NULL;

-- Add foreign key constraint
ALTER TABLE stops
ADD CONSTRAINT fk_stops_order_id 
FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;

-- Add index for better query performance
CREATE INDEX IF NOT EXISTS idx_stops_order_id ON stops(order_id);

-- For MySQL (uncomment if using MySQL)
-- ALTER TABLE stops 
-- ADD COLUMN order_id VARCHAR(36) NULL AFTER client_id,
-- ADD INDEX idx_stops_order_id (order_id),
-- ADD CONSTRAINT fk_stops_order_id 
-- FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;

-- Optional: Update existing stops to link them to orders based on client_id and delivery_date
-- This is a one-time data migration to populate order_id for existing stops
-- Uncomment and run this if you want to backfill order_id for existing stops

/*
UPDATE stops s
SET order_id = (
    SELECT o.id
    FROM orders o
    WHERE o.client_id = s.client_id
      AND o.scheduled_delivery_date = s.delivery_date
      AND o.status IN ('pending', 'scheduled', 'confirmed')
    ORDER BY o.created_at DESC
    LIMIT 1
)
WHERE s.order_id IS NULL
  AND s.client_id IS NOT NULL
  AND s.delivery_date IS NOT NULL;
*/
