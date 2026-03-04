-- RPC: return full_name of clients who have an entry in clients.meal_planner_data
-- for the given delivery date. Presence of an entry means the client (or admin on their
-- behalf) customised the order for that day.
-- Run in Supabase SQL Editor to create the function.

CREATE OR REPLACE FUNCTION get_clients_changed_from_default(p_delivery_date text)
RETURNS TABLE(full_name text)
LANGUAGE sql
STABLE
AS $$
  SELECT c.full_name::text
  FROM clients c
  WHERE c.meal_planner_data IS NOT NULL
    AND jsonb_typeof(c.meal_planner_data) = 'array'
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(c.meal_planner_data) AS entry
      WHERE (entry ->> 'scheduledDeliveryDate') = p_delivery_date
    )
  ORDER BY c.full_name;
$$;
