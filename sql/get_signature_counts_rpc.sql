-- RPC: return signature counts grouped by client_id (fast, single query, no 1000-row limit).
-- Run in Supabase SQL Editor to create the function.
-- Returns one row per client that has at least one signature.

CREATE OR REPLACE FUNCTION get_signature_counts()
RETURNS TABLE(client_id text, collected bigint)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT s.client_id::text, COUNT(*)::bigint
  FROM signatures s
  GROUP BY s.client_id;
$$;
