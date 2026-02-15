-- RPC: return order IDs for a given delivery date from orders table only (DB-side filter).
-- Run in Supabase SQL Editor to create the function.
-- Uses America/New_York for date comparison so it matches vendor page grouping (toDateStringInAppTz).

CREATE OR REPLACE FUNCTION get_orders_for_delivery_date(p_delivery_date date)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_order_ids text[];
    v_client_ids text[];
BEGIN
    SELECT COALESCE(array_agg(o.id::text), ARRAY[]::text[])
    INTO v_order_ids
    FROM orders o
    WHERE ((o.scheduled_delivery_date AT TIME ZONE 'America/New_York')::date = p_delivery_date)
      AND o.status IS DISTINCT FROM 'cancelled'
      AND (o.service_type IS NULL OR LOWER(TRIM(o.service_type)) <> 'produce');

    SELECT COALESCE(array_agg(cid), ARRAY[]::text[])
    INTO v_client_ids
    FROM (SELECT DISTINCT o.client_id::text AS cid
          FROM orders o
          WHERE ((o.scheduled_delivery_date AT TIME ZONE 'America/New_York')::date = p_delivery_date)
            AND o.status IS DISTINCT FROM 'cancelled'
            AND (o.service_type IS NULL OR LOWER(TRIM(o.service_type)) <> 'produce')) sub;

    RETURN json_build_object(
        'order_ids', COALESCE(v_order_ids, ARRAY[]::text[]),
        'client_ids', COALESCE(v_client_ids, ARRAY[]::text[]),
        'delivery_date', p_delivery_date
    );
END;
$$;
