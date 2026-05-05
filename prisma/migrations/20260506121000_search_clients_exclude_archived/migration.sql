-- Dashboard search: exclude archived clients from matches and household expansion.

CREATE OR REPLACE FUNCTION public.search_clients_for_dashboard(
  p_search_query text,
  p_brooklyn_only boolean DEFAULT false
)
RETURNS SETOF public.clients
LANGUAGE sql
STABLE
AS $$
  WITH q AS (
    SELECT
      trim(p_search_query) AS raw,
      replace(replace(replace(trim(p_search_query), E'\\', E'\\\\'), '%', E'\\%'), '_', E'\\_') AS esc
  ),
  direct AS (
    SELECT c.id, c.parent_client_id
    FROM public.clients c, q
    WHERE length(q.raw) > 0
      AND c.archived_at IS NULL
      AND (NOT p_brooklyn_only OR trim(coalesce(c.unite_account, '')) = 'Brooklyn')
      AND (
        c.full_name ILIKE '%' || q.esc || '%' ESCAPE '\'
        OR coalesce(c.phone_number, '') ILIKE '%' || q.esc || '%' ESCAPE '\'
        OR coalesce(c.secondary_phone_number, '') ILIKE '%' || q.esc || '%' ESCAPE '\'
        OR coalesce(c.address, '') ILIKE '%' || q.esc || '%' ESCAPE '\'
        OR coalesce(c.email, '') ILIKE '%' || q.esc || '%' ESCAPE '\'
        OR coalesce(c.notes, '') ILIKE '%' || q.esc || '%' ESCAPE '\'
      )
  ),
  roots AS (
    SELECT DISTINCT coalesce(d.parent_client_id, d.id) AS root_id
    FROM direct d
  )
  SELECT c.*
  FROM public.clients c
  WHERE c.archived_at IS NULL
    AND (
      c.id IN (SELECT root_id FROM roots)
      OR c.parent_client_id IN (SELECT root_id FROM roots)
    )
  ORDER BY c.full_name ASC;
$$;

GRANT EXECUTE ON FUNCTION public.search_clients_for_dashboard(text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_clients_for_dashboard(text, boolean) TO service_role;
