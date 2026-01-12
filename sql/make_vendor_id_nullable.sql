-- Allow vendor_id to be NULL in upcoming_order_vendor_selections
ALTER TABLE upcoming_order_vendor_selections ALTER COLUMN vendor_id DROP NOT NULL;

-- Also apply to order_vendor_selections to ensure consistency when moving to active orders
ALTER TABLE order_vendor_selections ALTER COLUMN vendor_id DROP NOT NULL;
