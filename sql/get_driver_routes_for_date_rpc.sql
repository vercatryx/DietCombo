-- Optional RPC for drivers page: get driver list + route order in one call.
-- Use from API when delivery_date is set to reduce round-trips (drivers + driver_route_order).
-- Returns: driver_id, name, color, client_ids (ordered by driver_route_order.position).
-- p_delivery_date is reserved for future per-date filtering if needed.

CREATE OR REPLACE FUNCTION get_driver_routes_for_date(p_delivery_date text DEFAULT NULL)
RETURNS TABLE (
    driver_id text,
    name text,
    color text,
    client_ids text[]
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
    WITH ordered AS (
        SELECT dro.driver_id, dro.client_id, dro.position
        FROM driver_route_order dro
    ),
    aggregated AS (
        SELECT o.driver_id,
               array_agg(o.client_id ORDER BY o.position, o.client_id) AS client_ids
        FROM ordered o
        GROUP BY o.driver_id
    ),
    from_drivers AS (
        SELECT d.id AS did, d.name, d.color
        FROM drivers d
    ),
    from_routes AS (
        SELECT r.id AS rid, r.name, r.color
        FROM routes r
    )
    SELECT
        agg.driver_id::text,
        COALESCE(fd.name, fr.name, '')::text,
        COALESCE(NULLIF(TRIM(COALESCE(fd.color, fr.color)), ''), '#3665F3')::text,
        agg.client_ids
    FROM aggregated agg
    LEFT JOIN from_drivers fd ON fd.did = agg.driver_id
    LEFT JOIN from_routes fr ON fr.rid = agg.driver_id
    ORDER BY 2;
$$;

COMMENT ON FUNCTION get_driver_routes_for_date(text) IS 'Returns driver id, name, color, and ordered client_ids for route building.';
