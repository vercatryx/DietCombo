-- Migration: Add delivery_date column to stops table
-- This allows stops to be unique per client + delivery_date combination
-- instead of just per client + day of week

-- Add delivery_date column (nullable for backward compatibility)
ALTER TABLE stops 
ADD COLUMN IF NOT EXISTS delivery_date DATE NULL;

-- Create index on delivery_date for faster queries
CREATE INDEX IF NOT EXISTS idx_stops_delivery_date ON stops(delivery_date);

-- Create unique index on client_id + delivery_date to ensure uniqueness
-- Only applies when delivery_date is not null
CREATE UNIQUE INDEX IF NOT EXISTS idx_stops_client_delivery_date 
ON stops(client_id, delivery_date) 
WHERE delivery_date IS NOT NULL;

-- Optional: Backfill delivery_date for existing stops based on day field
-- This is a best-effort attempt - actual delivery dates should come from orders
-- Uncomment and run if you want to populate delivery_date for existing stops
/*
UPDATE stops s
SET delivery_date = (
    SELECT MIN(o.scheduled_delivery_date)
    FROM orders o
    WHERE o.client_id = s.client_id
    AND o.status IN ('pending', 'scheduled', 'confirmed')
    AND o.scheduled_delivery_date IS NOT NULL
    AND EXTRACT(DOW FROM o.scheduled_delivery_date) = (
        CASE s.day
            WHEN 'sunday' THEN 0
            WHEN 'monday' THEN 1
            WHEN 'tuesday' THEN 2
            WHEN 'wednesday' THEN 3
            WHEN 'thursday' THEN 4
            WHEN 'friday' THEN 5
            WHEN 'saturday' THEN 6
            ELSE NULL
        END
    )
    LIMIT 1
)
WHERE s.delivery_date IS NULL
AND s.client_id IS NOT NULL;
*/
