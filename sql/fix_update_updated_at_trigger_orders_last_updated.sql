-- Fix: delivery proof (and any order update) fails with:
--   record "new" has no field "updated_at" (PostgreSQL 42703)
--
-- Cause: public.orders and public.upcoming_orders use column last_updated,
-- but update_updated_at_column() only sets NEW.updated_at (correct for most tables).
--
-- Run once in Supabase SQL Editor (or psql) against your production DB.

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_TABLE_NAME IN ('orders', 'upcoming_orders') THEN
        NEW.last_updated := CURRENT_TIMESTAMP;
    ELSE
        NEW.updated_at := CURRENT_TIMESTAMP;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
