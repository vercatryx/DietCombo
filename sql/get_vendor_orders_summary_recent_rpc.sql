-- RPC: get_vendor_orders_summary_recent
-- Returns per-date order summary for a vendor, filtered to dates >= p_since_date.
-- Also returns total_dates (count of ALL dates) so the UI knows how many are hidden.
-- Faster than the original get_vendor_orders_summary when only recent dates are needed.
-- Run this in Supabase SQL Editor once to create the function.

CREATE OR REPLACE FUNCTION get_vendor_orders_summary_recent(
    p_vendor_id uuid,
    p_since_date date DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_rows json;
    v_total bigint;
BEGIN
    WITH all_order_ids AS (
        SELECT id FROM orders WHERE vendor_id = p_vendor_id
        UNION
        SELECT order_id AS id FROM order_vendor_selections WHERE vendor_id = p_vendor_id
        UNION
        SELECT order_id AS id FROM order_box_selections WHERE vendor_id = p_vendor_id
    ),
    dated AS (
        SELECT
            COALESCE(o.scheduled_delivery_date::text, 'no-date') AS date_key,
            COUNT(DISTINCT o.id) AS order_count,
            COALESCE(SUM(o.total_items), 0) AS total_items
        FROM orders o
        JOIN all_order_ids a ON a.id = o.id
        WHERE o.service_type IS DISTINCT FROM 'Produce'
        GROUP BY COALESCE(o.scheduled_delivery_date::text, 'no-date')
    ),
    sorted AS (
        SELECT * FROM dated
        ORDER BY
            CASE WHEN date_key = 'no-date' THEN 1 ELSE 0 END,
            date_key DESC
    ),
    total_ct AS (
        SELECT count(*) AS n FROM sorted
    ),
    filtered AS (
        SELECT * FROM sorted
        WHERE p_since_date IS NULL
           OR date_key = 'no-date'
           OR date_key >= p_since_date::text
    )
    SELECT
        (SELECT COALESCE(json_agg(row_to_json(f)), '[]'::json) FROM filtered f),
        (SELECT n FROM total_ct)
    INTO v_rows, v_total;

    RETURN json_build_object(
        'rows', v_rows,
        'total_dates', COALESCE(v_total, 0)
    );
END;
$$;
