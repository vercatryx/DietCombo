-- Add meal value per item (e.g. points/credits) to meal planner custom items
ALTER TABLE "meal_planner_custom_items" ADD COLUMN IF NOT EXISTS "value" DECIMAL(10,2);
