# Where the Clients Dashboard Gets Its Data

The **Client Dashboard** (route `/clients`) and **Manual Geocoding** both use the same source for client data: the **`clients`** table in Supabase.

## Why do I see addresses on the dashboard but not in Manual Geocoding?

They come from the **same** `clients` table. The difference is **which** clients you’re looking at:

- **Dashboard:** Shows **all** clients (or the filtered list). Many of them have `address`, `city`, `state`, `zip` filled in the DB, so you see addresses there.
- **Manual Geocoding:** Shows only clients that are **missing lat/lng** (no coordinates yet). In your DB, that subset of clients currently has **empty** `address`/`city`/`state`/`zip` in the `clients` table (and no address on stops either).

So the dashboard is not “getting the address from somewhere else.” It’s showing addresses for clients that **do** have address data in the DB. The 20 in Manual Geocoding are a different set: they’re the ones without coordinates, and for those 20 the `clients` row is blank for address. If you open one of those 20 on the client profile, you’ll see blank address there too. To have addresses in Manual Geocoding for them, you need to fill in the **clients** table (e.g. via the client profile edit) for those clients.

## Client Dashboard (`/clients`)

| What | Where |
|------|--------|
| **Page** | `app/clients/page.tsx` → renders `<ClientList />` |
| **List data** | `components/clients/ClientList.tsx` calls `getClientsPaginated(1, limit, '')` |
| **Data source** | `lib/actions.ts` → **`getClientsPaginated()`** |
| **Query** | `supabase.from('clients').select('*', { count: 'exact' })` |
| **Mapping** | Each row is passed to **`mapClientFromDB(c)`** in the same file |

So the dashboard list is **pulled from the `clients` table** with `select('*')` (all columns, including `address`, `city`, `state`, `zip`).

## Individual client profile (`/clients/[id]`)

| What | Where |
|------|--------|
| **Page** | `app/clients/[id]/page.tsx` → `<ClientProfileDetail />` |
| **Data** | Uses `getClient(id)` (and related helpers) from `lib/actions.ts` |
| **Query** | `supabase.from('clients').select('*').eq('id', id).single()` |
| **Mapping** | **`mapClientFromDB(data)`** |

Same table, same mapping.

## How address is read

In **`mapClientFromDB()`** in `lib/actions.ts` (around lines 3310–3339):

- `address: c.address || ''`
- `city: c.city || null`
- `state: c.state || null`
- `zip: c.zip || null`

So the dashboard and the client profile both show whatever is stored in **`clients.address`**, **`clients.city`**, **`clients.state`**, and **`clients.zip`**.

## Manual Geocoding

The Manual Geocoding dialog gets its list from:

- **API:** `GET /api/route/clients-missing-geocode`
- **Implementation:** `app/api/route/clients-missing-geocode/route.ts`
- **Query:** `supabase.from('clients').select('id, first_name, last_name, full_name, address, apt, city, state, zip, lat, lng')` with filters for paused/delivery and missing lat/lng.

So Manual Geocoding is also **pulled from the `clients` table** (same table as the dashboard), with the same address columns.

## Summary

- **Clients dashboard list** → `clients` table via `getClientsPaginated()` in `lib/actions.ts`.
- **Client profile** → `clients` table via `getClient()` in `lib/actions.ts`.
- **Manual Geocoding list** → `clients` table via `/api/route/clients-missing-geocode`.

If a client has no address on the dashboard or in Manual Geocoding, the **`clients`** row for that client has empty/null in `address`, `city`, `state`, or `zip`. Updating those columns (e.g. in the client profile edit form) will make the address appear in both places.
