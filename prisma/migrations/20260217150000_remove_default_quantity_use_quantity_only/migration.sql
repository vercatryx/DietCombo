-- Single quantity field only: quantity = how many the customer gets by default (default 1).
-- Remove the separate default_quantity column.
ALTER TABLE "meal_planner_custom_items" DROP COLUMN IF EXISTS "default_quantity";
