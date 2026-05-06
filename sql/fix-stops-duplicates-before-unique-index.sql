-- =============================================================================
-- Fix: duplicate stops rows block idx_stops_client_delivery_date (ERROR 23505)
-- =============================================================================
-- Run in Supabase SQL Editor BEFORE creating:
--   CREATE UNIQUE INDEX idx_stops_client_delivery_date ON stops(client_id, delivery_date)
--   WHERE delivery_date IS NOT NULL;
--
-- Preview duplicates (optional):
--   SELECT client_id, delivery_date, COUNT(*) AS n
--   FROM stops
--   WHERE delivery_date IS NOT NULL AND client_id IS NOT NULL
--   GROUP BY 1, 2
--   HAVING COUNT(*) > 1;
-- =============================================================================

-- Keep one row per (client_id, delivery_date): prefer stop linked to an order,
-- then most recently updated, then smallest id for stability.
WITH ranked AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY client_id, delivery_date
            ORDER BY
                (order_id IS NOT NULL AND btrim(order_id::text) <> '') DESC,
                updated_at DESC NULLS LAST,
                created_at DESC NULLS LAST,
                id
        ) AS rn
    FROM stops
    WHERE delivery_date IS NOT NULL
      AND client_id IS NOT NULL
)
DELETE FROM stops s
WHERE s.id IN (
    SELECT id FROM ranked WHERE rn > 1
);

-- Now the unique index should succeed:
CREATE UNIQUE INDEX IF NOT EXISTS idx_stops_client_delivery_date
    ON stops(client_id, delivery_date)
    WHERE delivery_date IS NOT NULL;
