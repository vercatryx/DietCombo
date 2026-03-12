-- Migration: Add produce_vendors table and clients.produce_vendor_id column
-- Run this in Supabase SQL Editor.

-- 1. Create produce_vendors reference table
CREATE TABLE IF NOT EXISTS produce_vendors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(16), 'hex'),
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Add produce_vendor_id to clients (nullable FK)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS produce_vendor_id UUID REFERENCES produce_vendors(id);

-- 3. Index for fast lookups by token (external vendor page) and by produce_vendor_id (filtering)
CREATE INDEX IF NOT EXISTS idx_produce_vendors_token ON produce_vendors(token);
CREATE INDEX IF NOT EXISTS idx_clients_produce_vendor_id ON clients(produce_vendor_id);
