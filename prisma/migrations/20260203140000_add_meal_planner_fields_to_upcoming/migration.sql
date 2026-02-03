-- Add user_modified to upcoming_orders (for meal planner: don't overwrite client edits)
ALTER TABLE "upcoming_orders" ADD COLUMN "user_modified" BOOLEAN NOT NULL DEFAULT false;

-- Add sort_order to upcoming_order_items (for meal planner item display order)
ALTER TABLE "upcoming_order_items" ADD COLUMN "sort_order" INTEGER DEFAULT 0;
