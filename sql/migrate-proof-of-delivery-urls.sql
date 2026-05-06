-- =============================================================================
-- Proof of delivery: store any number of image URLs per order
-- =============================================================================
-- Run this once on your Supabase Postgres database (SQL editor or psql).
--
-- Adds `proof_of_delivery_urls` (JSONB array of text URLs), migrates existing
-- data from `proof_of_delivery_url` and optional `proof_of_delivery_image`,
-- keeps `proof_of_delivery_url` as the first URL for legacy code/APIs, and
-- drops `proof_of_delivery_image` if present.
-- =============================================================================

-- 1) New column: ordered list of proof image URLs
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS proof_of_delivery_urls JSONB NOT NULL DEFAULT '[]'::jsonb;

-- 2) Backfill array from legacy columns (handles DBs with or without proof_of_delivery_image)
DO $$
DECLARE
  has_second BOOLEAN;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'orders'
      AND column_name = 'proof_of_delivery_image'
  ) INTO has_second;

  IF has_second THEN
    UPDATE orders o
    SET proof_of_delivery_urls = x.arr
    FROM (
      SELECT
        id,
        CASE
          WHEN proof_of_delivery_url IS NOT NULL AND btrim(proof_of_delivery_url::text) <> ''
           AND proof_of_delivery_image IS NOT NULL AND btrim(proof_of_delivery_image::text) <> ''
            THEN jsonb_build_array(
              btrim(proof_of_delivery_url::text),
              btrim(proof_of_delivery_image::text)
            )
          WHEN proof_of_delivery_url IS NOT NULL AND btrim(proof_of_delivery_url::text) <> ''
            THEN jsonb_build_array(btrim(proof_of_delivery_url::text))
          WHEN proof_of_delivery_image IS NOT NULL AND btrim(proof_of_delivery_image::text) <> ''
            THEN jsonb_build_array(btrim(proof_of_delivery_image::text))
          ELSE '[]'::jsonb
        END AS arr
      FROM orders
    ) x
    WHERE o.id = x.id;
  ELSE
    UPDATE orders o
    SET proof_of_delivery_urls = x.arr
    FROM (
      SELECT
        id,
        CASE
          WHEN proof_of_delivery_url IS NOT NULL AND btrim(proof_of_delivery_url::text) <> ''
            THEN jsonb_build_array(btrim(proof_of_delivery_url::text))
          ELSE '[]'::jsonb
        END AS arr
      FROM orders
    ) x
    WHERE o.id = x.id;
  END IF;
END $$;

-- 3) Keep legacy single-URL column = first entry (mobile APIs, old queries)
UPDATE orders
SET proof_of_delivery_url = proof_of_delivery_urls->>0
WHERE jsonb_array_length(proof_of_delivery_urls) > 0;

UPDATE orders
SET proof_of_delivery_url = NULL
WHERE jsonb_array_length(proof_of_delivery_urls) = 0;

-- 4) Drop second-image column — all URLs now live in the JSONB array
ALTER TABLE orders DROP COLUMN IF EXISTS proof_of_delivery_image;

-- 5) Optional: faster queries that only care “is there any proof?”
CREATE INDEX IF NOT EXISTS idx_orders_proof_of_delivery_urls_gin
  ON orders USING GIN (proof_of_delivery_urls);

COMMENT ON COLUMN orders.proof_of_delivery_urls IS 'Ordered list of delivery proof image URLs (JSON array of strings).';
COMMENT ON COLUMN orders.proof_of_delivery_url IS 'First proof URL; mirror of proof_of_delivery_urls[0] for legacy readers.';
