-- Migration: Add delivery_date column to stops table in Supabase
-- Run this in Supabase SQL Editor if the column doesn't exist yet

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
