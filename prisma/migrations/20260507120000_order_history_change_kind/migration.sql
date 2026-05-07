-- Client change log: structured category for admin filtering (nullable for legacy rows).
ALTER TABLE "order_history" ADD COLUMN IF NOT EXISTS "change_kind" VARCHAR(64);

CREATE INDEX IF NOT EXISTS "idx_order_history_change_kind" ON "order_history"("change_kind");
CREATE INDEX IF NOT EXISTS "idx_order_history_timestamp" ON "order_history"("timestamp" DESC);
