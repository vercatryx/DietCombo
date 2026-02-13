# Routes Section: Client Loading Slowness — Research & Proposals

## Summary

Loading clients in both the **Client Assignment** tab and the **Orders View** tab (routes page) is slow due to **redundant full-data fetches**, **no shared state**, and **heavy APIs** that each pull full client lists and run many DB round-trips. No code changes have been made; this document only researches causes and proposes fixes.

---

## 1. Where “loading clients” happens

### Client Assignment tab

- **Component:** `components/routes/ClientDriverAssignment.tsx`
- **When:** On mount (default tab is "clients").
- **What runs:**
  1. `loadClients()` → `GET /api/users` (all clients + all schedules).
  2. Then `loadClientDriverAssignments(clientsList)`:
     - **Again** `GET /api/users` (duplicate).
     - Then `GET /api/route/routes?day=...` (and optionally `delivery_date=...`).

So the Client Assignment tab alone does **2× `/api/users`** and **1× `/api/route/routes`**.

### Orders View tab

- **Component:** Map (`DriversMapLeaflet`) gets `drivers` and `unrouted` from the parent routes page state (no direct client fetch when switching to the tab).
- **When clients are loaded:**
  1. **On initial Routes page load:** The page runs two useEffects:
     - One fetches **`/api/users`** (for geocoding / `missingBatch`).
     - Another fetches **`/api/route/routes`** → then **`/api/route/cleanup`** (and optionally cleanup for `day=all`) → then **`/api/route/routes`** again.
  2. **When user clicks “Download Labels”:** The handler fetches **`/api/users`** and **`/api/route/routes`** again.

So the **Orders View** feels slow because:
- The **initial page load** (which runs regardless of tab) is heavy (users + routes + cleanup + routes again).
- **Download Labels** re-fetches full users and full routes even though the page already had routes (and could reuse or share client data).

---

## 2. Root causes

### 2.1 Duplicate `/api/users` calls

| Caller | When |
|--------|------|
| Routes page `useEffect` | On mount (for `users` / `missingBatch`) |
| `ClientDriverAssignment.loadClients()` | When Client Assignment tab is mounted |
| `ClientDriverAssignment.loadClientDriverAssignments()` | Right after same mount (second full users fetch) |
| “Download Labels” click | On demand |

So we can get **3× full client list** on a normal open (page + Client Assignment), and another **2×** when clicking Download Labels, with **no reuse** of already-fetched data.

### 2.2 `/api/users` is heavy and unbounded

**File:** `app/api/users/route.ts`

- **Queries:**
  1. `clients` — **all rows**, selected columns, ordered by `id`.
  2. `schedules` — **all rows** (client_id, monday…sunday).
- **Processing:** Builds a `scheduleMap` and maps every client to a “user” object with schedule.

With a large number of clients and schedules, this is a large transfer and a lot of work per request. There is **no pagination**, **no filter** (e.g. by `paused`/`delivery`), and **no caching** (response is `Cache-Control: no-store`).

### 2.3 `/api/route/routes` is very heavy

**File:** `app/api/route/routes/route.ts`

Rough list of DB/API work (order of magnitude):

- `drivers` (by day).
- `routes` (legacy).
- `stops` (filtered by day/delivery_date; sometimes a second stops query for null `delivery_date`).
- `clients` **only for client IDs present in stops** (`.in('id', clientIds)`).
- Orders: by `order_id` from stops → `upcoming_orders` then `orders` for missing IDs.
- Orders by `client_id`: full `orders` and `upcoming_orders` for those client IDs (fallback matching).
- `existingStops` (stops, optionally limited to 10k or by delivery_date).
- **`allClientsWithDriver`** — **full `clients` table** again (for stop-creation / “users without stops” logic).
- `activeOrders` (orders with active statuses).
- `upcoming_orders` (scheduled) and sometimes `upcoming_orders` by delivery_date.
- **`getVendors()`** (additional heavy call).
- Per upcoming order (e.g. boxes): possible `upcoming_order_box_selections` + `upcoming_orders` update.
- Chunked `stops` by `order_id`; for missing stops, `stops` lookup by `order_id` and then `stops` insert.

So the routes API does **many sequential round-trips** and fetches **all clients** again via `allClientsWithDriver`, on top of clients already loaded by `/api/users` and by the same API for stop-based `clientIds`.

### 2.4 No data sharing between page and Client Assignment

- The routes page already fetches **`/api/users`** and stores result in `users` state.
- **`ClientDriverAssignment`** does not receive `users` (or any preloaded clients); it always fetches its own data.
- So the same full client list is fetched again when the user is on the Client Assignment tab, plus again inside `loadClientDriverAssignments`.

### 2.5 Redundant routes fetch after cleanup

- Initial load: **routes** → **cleanup** → **routes** again.
- `ClientDriverAssignment` then fetches **routes** again to build driver assignments and stop info.
- So we get **3×** full routes API calls on a typical load (initial, post-cleanup, Client Assignment).

### 2.6 Cleanup API also loads full clients

**File:** `app/api/route/cleanup/route.ts`

- Fetches **all clients**, **existing stops**, **active orders**, **upcoming orders**, then may create missing stops.
- So “all clients” and related data are loaded again during the same page load (routes + cleanup + Client Assignment).

---

## 3. Proposed changes (high level)

### 3.1 Remove duplicate `/api/users` in Client Assignment

- **Option A (recommended):** Have the routes page pass **preloaded users** (from its existing `/api/users` fetch) into `ClientDriverAssignment` as a prop (e.g. `initialUsers`). Client Assignment uses that when non-null and only fetches when needed (e.g. explicit refresh or no initial data).
- **Option B:** In `loadClientDriverAssignments`, **do not** call `/api/users` again. Use the `assigned_driver_id` (and any other needed fields) that are already on the objects returned by the **first** `/api/users` in `loadClients()`, and get stop/assignment info only from **`/api/route/routes`** (which already returns routes with stops and driver info). That alone removes one full client fetch per load.

**Effect:** Removes at least one (Option B) or two (Option A with no fetch on mount when data exists) full client fetches when opening the Client Assignment tab.

### 3.2 Single source of truth for “users” on the routes page

- Fetch **`/api/users`** once at page level (you already do this for geocoding).
- Pass the same `users` (or a filtered “active” list) into:
  - **ClientDriverAssignment** (for list + assignments, using routes only for stop/driver mapping).
  - The **Download Labels** handler (reuse in-memory users instead of calling `/api/users` again).
- Only refetch users when the user explicitly refreshes or after an action that changes client data (e.g. driver assignment, geocoding).

**Effect:** Cuts repeated full client fetches on load and on Download Labels.

### 3.3 Avoid duplicate routes fetch in Client Assignment

- The routes page already has **`routes`** (and can refresh after cleanup). Pass **`routes`** (and optionally `unrouted`) into `ClientDriverAssignment`.
- For driver assignments and stop info, **derive** from the passed-in `routes` / `unrouted` instead of calling **`/api/route/routes`** again. The parent can pass the same data it already used to render the map.
- If the tab needs a fresher snapshot after an assignment, the parent can refetch **once** and pass updated `routes` (and run `loadRoutes()` as today); the child should not refetch routes independently for the same day/delivery_date.

**Effect:** Removes one full `/api/route/routes` call when opening the Client Assignment tab.

### 3.4 Optimize `/api/users` (backend)

- **Narrow columns:** Select only what the routes section needs (e.g. id, first_name, last_name, full_name, address, apt, city, state, zip, phone_number, lat, lng, paused, delivery, assigned_driver_id; drop `dislikes`, `complex` if not needed for routes).
- **Schedules:** Only fetch schedules for clients that are actually used on the routes page (e.g. active, not paused, delivery on), or add a lightweight “routes” endpoint that returns users **without** schedules if the assignment tab doesn’t need schedule.
- **Filter at DB:** Add `.eq('paused', false)` and, if applicable, filter by `delivery === true` so the server sends fewer rows.
- **Pagination (optional):** If the list is huge, add cursor or page-based pagination and have the client request pages (e.g. for “Download Labels” or very long lists). For the assignment list UI, virtualized scrolling + one or two pages might be enough.

**Effect:** Smaller payload and less work per request; fewer rows if filtered.

### 3.5 Optimize `/api/route/routes` (backend)

- **Reuse clients already loaded:** The API first loads clients for stop-based `clientIds`, then later loads **`allClientsWithDriver`** (full clients). Consider using the same client set (e.g. fetch all clients once, or fetch only clients that appear in stops or in active/upcoming orders) and reuse it for both stop hydration and “users without stops” / stop-creation logic, instead of two separate full-table client queries.
- **Parallelize where possible:** Run independent queries (e.g. drivers + routes, stops, then clients for those stops) in parallel with `Promise.all` to reduce wall-clock time.
- **Defer or slim “users without stops”:** If the “create missing stops” and “users without stops” logic is not needed on **every** routes request, consider:
  - Moving it to a dedicated endpoint (e.g. called only when user clicks “Ensure all have stops” or after initial load), or
  - Making it optional via a query flag (e.g. `?ensure_stops=1`) so the default routes response is lighter and faster.
- **Limit orders fallback:** The fallback that loads **all** orders and upcoming_orders by `client_id` (with `.in('client_id', clientIds)`) can be large. Restrict to recent dates or limit rows if possible.
- **Cache or slim `getVendors()`:** If vendor list changes rarely, cache it or return a minimal view (e.g. id + delivery days) for route-building only.

**Effect:** Fewer round-trips and less data per request; faster response for both Client Assignment (if it still calls routes once) and Orders View (initial load + Download Labels).

### 3.6 Reduce initial load chain on Routes page

- **Cleanup:** Consider running **cleanup** only when the user explicitly asks (e.g. “Ensure stops exist”) or in the background **after** the first routes response is shown, so the UI can render routes from the first **`/api/route/routes`** call without waiting for cleanup and a second routes call.
- **Single routes call for Client Assignment:** As in 3.3, don’t call `/api/route/routes` again from Client Assignment; use the routes (and unrouted) the page already has.

**Effect:** Faster first paint and less duplicate work on mount.

### 3.7 Download Labels

- Use **in-memory** `users` (and optionally `routes`) from the page state when building the label data, instead of calling **`/api/users`** and **`/api/route/routes`** again. If a refresh is needed (e.g. after assignments), do one refetch and then run the label export.
- If the backend is optimized (3.4 and 3.5), any remaining fetch for labels will still be cheaper.

**Effect:** No duplicate full client + full routes fetch on every “Download Labels” click.

---

## 4. Suggested order of implementation

1. **Quick wins (no new APIs):**
   - Remove the second **`/api/users`** call from **`loadClientDriverAssignments`** and use data from the first **`loadClients()`** response (e.g. `assignedDriverId` from users).
   - Pass **`routes`** (and `unrouted`) from the routes page into **ClientDriverAssignment** and derive assignments/stop info from them; remove the **`/api/route/routes`** call from **ClientDriverAssignment**.
   - Pass **`users`** from the routes page into **ClientDriverAssignment** as initial data and use it when available so the tab doesn’t refetch users on mount when the page already has them.
2. **Download Labels:** Use page-level `users` (and routes) instead of refetching.
3. **Backend:** Add filters and smaller selects to **`/api/users`**; then optimize **`/api/route/routes`** (single client load, parallel queries, optional cleanup/defer “users without stops”).
4. **UX:** Defer **cleanup** after first routes render or make it explicit; keep a single source of truth for users and routes on the routes page.

---

## 5. Files to touch (for reference)

- **Client Assignment / page flow:**  
  `app/routes/page.tsx`, `components/routes/ClientDriverAssignment.tsx`
- **Users API:**  
  `app/api/users/route.ts`
- **Routes API:**  
  `app/api/route/routes/route.ts`
- **Cleanup (optional defer):**  
  `app/routes/page.tsx` (when cleanup is called), `app/api/route/cleanup/route.ts` (if logic is moved or slimmed)

No code has been changed in this research; the above are proposed changes for implementation.
