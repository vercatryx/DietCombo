-- Fast RPC for /api/route/routes when delivery_date is provided.
-- Goal: replace multi-query JS hydration with a single DB roundtrip.
--
-- Returns: { routes: [...], unrouted: [...] }
-- routes[] shape matches the existing API payload:
--   { driverId, driverName, color, stops: [...] }
-- stop shape matches what the drivers UI reads today (subset is fine, extra fields ok):
--   id, client_id/userId, name, address, apt, city, state, zip, phone, lat, lng, dislikes,
--   delivery_date, completed, proofUrl, assigned_driver_id, order_id, orderId, orderNumber

create or replace function public.get_routes_for_date(
  p_delivery_date date,
  p_day text default 'all',
  p_exclude_produce boolean default false
)
returns jsonb
language sql
stable
as $$
with
drivers_union as (
  -- Primary drivers table (day-filtered)
  select
    d.id::text as id,
    d.name::text as name,
    coalesce(nullif(d.color::text, ''), '#3665F3') as color
  from public.drivers d
  where (p_day = 'all' or lower(d.day::text) = lower(p_day))

  union all

  -- Legacy routes table (treated as applicable to all days)
  select
    r.id::text as id,
    r.name::text as name,
    coalesce(nullif(r.color::text, ''), '#3665F3') as color
  from public.routes r
),
drivers_sorted as (
  select
    id, name, color,
    -- sort "Driver 0/1/2..." numerically, then name
    case
      when regexp_match(lower(name), 'driver\s+(\d+)') is null then 2147483647
      else (regexp_match(lower(name), 'driver\s+(\d+)'))[1]::int
    end as driver_rank
  from drivers_union
),
stops_for_date as (
  select
    s.id::text as id,
    s.client_id::text as client_id,
    s.name::text as name,
    coalesce(nullif(s.address::text, ''), c.address::text, '') as address,
    coalesce(s.apt::text, c.apt::text) as apt,
    coalesce(nullif(s.city::text, ''), c.city::text, '') as city,
    coalesce(nullif(s.state::text, ''), c.state::text, '') as state,
    coalesce(nullif(s.zip::text, ''), c.zip::text, '') as zip,
    coalesce(nullif(s.phone::text, ''), c.phone_number::text) as phone,
    coalesce(s.lat::double precision, c.lat::double precision) as lat,
    coalesce(s.lng::double precision, c.lng::double precision) as lng,
    coalesce(nullif(s.dislikes::text, ''), c.dislikes::text, '') as dislikes,
    s.delivery_date as delivery_date,
    coalesce(s.completed, false) as completed,
    nullif(s.proof_url::text, '') as stop_proof_url,
    coalesce(s.assigned_driver_id::text, c.assigned_driver_id::text) as assigned_driver_id,
    s.order_id::text as order_id,
    lower(c.service_type::text) as client_service_type,
    coalesce(c.paused, false) as client_paused,
    coalesce(c.delivery, true) as client_delivery
  from public.stops s
  left join public.clients c on c.id = s.client_id
  where s.delivery_date = p_delivery_date
    and (p_day = 'all' or lower(s.day::text) = lower(p_day))
),
stops_filtered as (
  select *
  from stops_for_date
  where client_paused is distinct from true
    and client_delivery is distinct from false
    and (not p_exclude_produce or client_service_type is distinct from 'produce')
),
stops_enriched as (
  select
    s.*,
    o_id.id::text as order_id_by_id,
    o_id.order_number::int as order_number_by_id,
    nullif(o_id.proof_of_delivery_url::text, '') as proof_by_id,
    o_cd.id::text as order_id_by_client_date,
    o_cd.order_number::int as order_number_by_client_date,
    nullif(o_cd.proof_of_delivery_url::text, '') as proof_by_client_date
  from stops_filtered s
  left join lateral (
    select o.id, o.order_number, o.proof_of_delivery_url
    from public.orders o
    where s.order_id is not null and o.id::text = s.order_id
    limit 1
  ) o_id on true
  left join lateral (
    select o.id, o.order_number, o.proof_of_delivery_url
    from public.orders o
    where s.client_id is not null
      and o.client_id::text = s.client_id
      and o.scheduled_delivery_date = p_delivery_date
      and (o.status is null or lower(o.status::text) <> 'cancelled')
    order by o.created_at desc nulls last
    limit 1
  ) o_cd on true
),
stops_payload as (
  select
    id,
    client_id,
    name,
    address,
    apt,
    city,
    state,
    zip,
    phone,
    lat,
    lng,
    dislikes,
    delivery_date,
    completed,
    coalesce(stop_proof_url, proof_by_id, proof_by_client_date) as "proofUrl",
    assigned_driver_id as assigned_driver_id,
    order_id as order_id,
    coalesce(order_id_by_id, order_id_by_client_date, order_id) as "orderId",
    coalesce(order_number_by_id, order_number_by_client_date) as "orderNumber"
  from stops_enriched
),
ordered_stops as (
  -- Stops placed by stable route order for each driver
  select
    dro.driver_id::text as driver_id,
    dro.position as position,
    sp.*
  from public.driver_route_order dro
  join stops_payload sp on sp.client_id = dro.client_id::text
),
ordered_stop_ids as (
  select distinct id from ordered_stops
),
tail_stops as (
  -- Stops that are assigned to a driver but not in route order (append after ordered list)
  select
    sp.assigned_driver_id as driver_id,
    100000000 + row_number() over (partition by sp.assigned_driver_id order by sp.id) as position,
    sp.*
  from stops_payload sp
  where sp.assigned_driver_id is not null
    and not exists (select 1 from ordered_stop_ids osi where osi.id = sp.id)
),
route_stops as (
  select * from ordered_stops
  union all
  select * from tail_stops
),
routes_json as (
  select jsonb_agg(
    jsonb_build_object(
      'driverId', d.id,
      'driverName', d.name,
      'color', d.color,
      'stops',
        coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', rs.id,
              'client_id', rs.client_id,
              'userId', rs.client_id,
              'name', rs.name,
              'address', rs.address,
              'apt', rs.apt,
              'city', rs.city,
              'state', rs.state,
              'zip', rs.zip,
              'phone', rs.phone,
              'lat', rs.lat,
              'lng', rs.lng,
              'dislikes', rs.dislikes,
              'delivery_date', rs.delivery_date,
              'completed', rs.completed,
              'proofUrl', rs."proofUrl",
              'proof_url', rs."proofUrl",
              'assigned_driver_id', rs.assigned_driver_id,
              'order_id', rs.order_id,
              'orderId', rs."orderId",
              'orderNumber', rs."orderNumber",
              'order_number', rs."orderNumber"
            )
            order by rs.position asc
          )
          from route_stops rs
          where rs.driver_id = d.id
        ), '[]'::jsonb)
    )
    order by d.driver_rank asc, d.name asc
  ) as routes
  from drivers_sorted d
),
claimed_stop_ids as (
  select distinct id from route_stops
),
driver_ids as (
  select distinct id from drivers_sorted
),
unrouted_json as (
  select jsonb_agg(
    jsonb_build_object(
      'id', sp.id,
      'client_id', sp.client_id,
      'userId', sp.client_id,
      'name', sp.name,
      'address', sp.address,
      'apt', sp.apt,
      'city', sp.city,
      'state', sp.state,
      'zip', sp.zip,
      'phone', sp.phone,
      'lat', sp.lat,
      'lng', sp.lng,
      'dislikes', sp.dislikes,
      'delivery_date', sp.delivery_date,
      'completed', sp.completed,
      'proofUrl', sp."proofUrl",
      'proof_url', sp."proofUrl",
      'assigned_driver_id', sp.assigned_driver_id,
      'order_id', sp.order_id,
      'orderId', sp."orderId",
      'orderNumber', sp."orderNumber",
      'order_number', sp."orderNumber"
    )
    order by sp.id
  ) as unrouted
  from stops_payload sp
  where not exists (select 1 from claimed_stop_ids c where c.id = sp.id)
    and (
      sp.assigned_driver_id is null
      or not exists (select 1 from driver_ids d where d.id = sp.assigned_driver_id)
    )
)
select jsonb_build_object(
  'routes', coalesce((select routes from routes_json), '[]'::jsonb),
  'unrouted', coalesce((select unrouted from unrouted_json), '[]'::jsonb)
);
$$;

