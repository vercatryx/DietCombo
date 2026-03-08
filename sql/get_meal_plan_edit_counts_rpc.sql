-- RPC: for a date range, return each delivery date that has at least one client who changed
-- from the default meal plan, along with the count of such clients.
-- Sources from clients.meal_planner_data (same as get_clients_changed_from_default).
-- Run in Supabase SQL Editor to create the function.

CREATE OR REPLACE FUNCTION get_meal_plan_edit_counts(p_start_date text, p_end_date text)
RETURNS TABLE(delivery_date text, client_count bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT
    (entry ->> 'scheduledDeliveryDate')::text AS delivery_date,
    count(DISTINCT c.id)::bigint AS client_count
  FROM clients c,
       jsonb_array_elements(c.meal_planner_data) AS entry
  WHERE c.meal_planner_data IS NOT NULL
    AND jsonb_typeof(c.meal_planner_data) = 'array'
    AND (entry ->> 'scheduledDeliveryDate') >= p_start_date
    AND (entry ->> 'scheduledDeliveryDate') <= p_end_date
  GROUP BY (entry ->> 'scheduledDeliveryDate')
  ORDER BY delivery_date;
$$;
