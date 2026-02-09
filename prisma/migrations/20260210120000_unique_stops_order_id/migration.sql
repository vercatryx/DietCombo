-- Deduplicate stops: keep one stop per order_id (keep the one with oldest created_at), remove the rest
DELETE FROM "stops" a
USING "stops" b
WHERE a."order_id" IS NOT NULL
  AND b."order_id" IS NOT NULL
  AND a."order_id" = b."order_id"
  AND a."created_at" > b."created_at";

-- If same created_at, keep lower id to avoid ambiguity
DELETE FROM "stops" a
USING "stops" b
WHERE a."order_id" IS NOT NULL
  AND b."order_id" IS NOT NULL
  AND a."order_id" = b."order_id"
  AND a."created_at" = b."created_at"
  AND a."id" > b."id";

-- Add unique constraint: at most one stop per non-null order_id (allows multiple NULLs)
CREATE UNIQUE INDEX "stops_order_id_key" ON "stops"("order_id") WHERE "order_id" IS NOT NULL;
