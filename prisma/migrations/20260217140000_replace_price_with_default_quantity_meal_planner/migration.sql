-- Remove price from meal_planner_custom_items. Single quantity field = how many the customer gets by default (default 1).
ALTER TABLE "meal_planner_custom_items" DROP COLUMN IF EXISTS "price";
