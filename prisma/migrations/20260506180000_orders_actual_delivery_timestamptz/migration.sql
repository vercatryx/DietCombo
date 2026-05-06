-- Preserve proof capture / upload time (ISO strings were truncated when stored as DATE).
ALTER TABLE "orders"
ALTER COLUMN "actual_delivery_date" TYPE TIMESTAMPTZ(6)
USING (
  CASE
    WHEN "actual_delivery_date" IS NULL THEN NULL
    ELSE "actual_delivery_date"::timestamptz
  END
);
