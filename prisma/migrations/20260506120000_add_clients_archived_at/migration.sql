-- Soft-delete: archived clients stay in DB but are excluded from dashboard/ops by default.
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "archived_at" TIMESTAMPTZ NULL;
