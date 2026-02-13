-- RPC for orders billing list: search/filter in DB and return paginated order ids + total.
-- Run this in Supabase SQL Editor once to create the function.
-- Search matches: client full_name, order_number (as text), vendor names (via order_vendor_selections + order_box_selections).
-- If your orders table does not have creation_id, remove the "AND (p_creation_id IS NULL OR o.creation_id = p_creation_id)" line below.

CREATE OR REPLACE FUNCTION get_orders_billing_search(
    p_search text DEFAULT NULL,
    p_status text DEFAULT NULL,
    p_creation_id bigint DEFAULT NULL,
    p_limit int DEFAULT 50,
    p_offset int DEFAULT 0
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_order_ids uuid[];
    v_total bigint;
BEGIN
    WITH filtered AS (
        SELECT o.id
        FROM orders o
        LEFT JOIN clients c ON c.id = o.client_id
        LEFT JOIN (
            SELECT ov.order_id, v.name AS vendor_name
            FROM order_vendor_selections ov
            JOIN vendors v ON v.id = ov.vendor_id
            UNION
            SELECT ob.order_id, v.name AS vendor_name
            FROM order_box_selections ob
            JOIN vendors v ON v.id = ob.vendor_id
        ) v ON v.order_id = o.id
        WHERE
            (p_search IS NULL OR trim(p_search) = '' OR (
                (c.full_name IS NOT NULL AND c.full_name ILIKE '%' || trim(p_search) || '%')
                OR (o.order_number::text ILIKE '%' || trim(p_search) || '%')
                OR (v.vendor_name IS NOT NULL AND v.vendor_name ILIKE '%' || trim(p_search) || '%')
            ))
            AND (p_status IS NULL OR trim(p_status) = '' OR p_status = 'all' OR o.status = p_status)
            AND (p_creation_id IS NULL OR o.creation_id = p_creation_id)
    ),
    ordered AS (
        SELECT f.id
        FROM filtered f
        JOIN orders o ON o.id = f.id
        ORDER BY o.created_at DESC
    ),
    total_ct AS (
        SELECT count(*) AS n FROM ordered
    ),
    page AS (
        SELECT id FROM ordered
        LIMIT greatest(0, p_limit)
        OFFSET greatest(0, p_offset)
    )
    SELECT
        (SELECT array_agg(id) FROM page),
        (SELECT n FROM total_ct)
    INTO v_order_ids, v_total;

    RETURN json_build_object(
        'order_ids', COALESCE(v_order_ids, ARRAY[]::uuid[]),
        'total', COALESCE(v_total, 0)::bigint
    );
END;
$$;
