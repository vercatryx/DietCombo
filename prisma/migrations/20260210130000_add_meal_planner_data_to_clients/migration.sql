-- Add meal_planner_data JSONB column to clients table
-- Stores individual client meal planner details (per-date items with quantities)
-- On save: remove entries where scheduledDeliveryDate < today - 7 days
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "meal_planner_data" JSONB;
