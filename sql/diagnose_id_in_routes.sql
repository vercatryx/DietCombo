-- Manual checks in Supabase SQL editor for "why is this id not on Routes?"
-- Replace :entity_id and :delivery_date (use Edit parameters if your client supports it,
-- or substitute literals).

-- 1) What is this id?
select 'clients' as tbl, id, full_name, paused, delivery, service_type, status_id, assigned_driver_id
from public.clients where id = '27871bdd-2c1f-4d95-8719-54815e44cfc6'
union all
select 'stops', id::text, name, null, null, null, null, assigned_driver_id::text
from public.stops where id = '27871bdd-2c1f-4d95-8719-54815e44cfc6'
union all
select 'orders', id::text, null, null, null, null, null, null
from public.orders where id = '27871bdd-2c1f-4d95-8719-54815e44cfc6'
union all
select 'drivers', id::text, name, null, null, null, null, null
from public.drivers where id = '27871bdd-2c1f-4d95-8719-54815e44cfc6'
union all
select 'routes_legacy', id::text, name, null, null, null, null, null
from public.routes where id = '27871bdd-2c1f-4d95-8719-54815e44cfc6';

-- 2) Stops for a client on a date (set client id if entity is a client)
-- select * from public.stops
-- where client_id = '...' and delivery_date = '2026-05-04'::date;

-- 3) Full RPC output (same as app)
-- select public.get_routes_for_date('2026-05-04'::date, 'all', true);
