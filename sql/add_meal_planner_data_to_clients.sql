-- Add meal_planner_data JSONB column to clients table
-- Stores individual client meal planner details (per-date items with quantities)
-- When saving, application should filter out entries older than 7 days (scheduledDeliveryDate < CURRENT_DATE - INTERVAL '7 days')
--
-- JSON structure:
-- [
--   {
--     "scheduledDeliveryDate": "2025-02-15",
--     "items": [
--       { "id": "uuid", "name": "Chicken", "quantity": 2, "value": 5.00 }
--     ]
--   }
-- ]

ALTER TABLE clients
ADD COLUMN IF NOT EXISTS meal_planner_data JSONB DEFAULT NULL;

COMMENT ON COLUMN clients.meal_planner_data IS 'Client-specific meal planner: array of { scheduledDeliveryDate, items: [{ id, name, quantity, value? }] }. On save, remove entries where scheduledDeliveryDate < today - 7 days.';
