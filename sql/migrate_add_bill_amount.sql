-- Migration: Add bill_amount column to orders and upcoming_orders tables
-- This column stores the bill amount for Produce service type orders

-- Add bill_amount to orders table
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS bill_amount DECIMAL(10, 2) NULL;

-- Add bill_amount to upcoming_orders table
ALTER TABLE upcoming_orders 
ADD COLUMN IF NOT EXISTS bill_amount DECIMAL(10, 2) NULL;

-- Add comments to document the column purpose
COMMENT ON COLUMN orders.bill_amount IS 'Bill amount for Produce service type orders, set from ClientProfile dialog';
COMMENT ON COLUMN upcoming_orders.bill_amount IS 'Bill amount for Produce service type orders, set from ClientProfile dialog';
