# Routes Page – Stops Duplication / Re-creation: Analysis & Solution Plan

## Summary

The `/routes` page (and its API `GET /api/route/routes`) creates stop records from the orders table. Stops are being duplicated or re-created on every page visit because the “existing stop” check is unreliable, so the handler keeps deciding that stops are “missing” and attempts to create them again.

---

## Root Cause Analysis

### 1. When stops are created

- **File:** `app/api/route/routes/route.ts`
- **Flow:** The **GET** handler:
  1. Loads drivers, routes, and **existing stops** (filtered by `day` / `delivery_date`).
  2. Builds route payloads and “unrouted” stops.
  3. **Step 9 (lines ~427–836):** Determines “clients without stops” from **orders** (and upcoming_orders), then **creates missing stops** by inserting into `stops`.

So every time the routes page is opened or the day/date filter changes, the front end calls `GET /api/route/routes`, and step 9 runs. If the “does this client already have a stop for this delivery date?” check is wrong, the same logical stop is “missing” on every request and the code tries to create it again.

### 2. How “existing stops” are tracked

- A single query loads **all** stops:  
  `supabase.from('stops').select('client_id, delivery_date, day')`.
- A map is built: **client_id → Set of delivery_date** (only when both `client_id` and `delivery_date` are truthy):

```ts
// Lines 437–446
for (const s of (existingStops || [])) {
    if (s.client_id && s.delivery_date) {
        const clientId = String(s.client_id);
        // ...
        clientStopsByDate.get(clientId)!.add(s.delivery_date);  // raw value from DB
    }
}
```

- When deciding whether to create a stop, the code checks:  
  `existingStopDates.has(deliveryDateStr)`  
  where `deliveryDateStr` is **normalized** from orders (e.g. `order.scheduled_delivery_date.split('T')[0]` → `"YYYY-MM-DD"`).

So:

- **Keys in the Set** = whatever Supabase returns for `delivery_date` (could be `"2025-02-05"` or `"2025-02-05T00:00:00.000Z"` or another format).
- **Lookup key** = normalized `"YYYY-MM-DD"`.

If the DB returns an ISO string with time, then `existingStopDates.has("2025-02-05")` is **false** even when a stop for that date already exists. So the code keeps adding the same (client, delivery_date) to `stopsToCreate` on every request.

### 3. What happens on insert

- Each “missing” stop is inserted with a **new UUID** (`uuidv4()`).
- **Upsert** is used with `onConflict: 'id'`. Because the id is always new, this is effectively an **INSERT**, not an update of an existing row.
- The schema defines a **partial unique index** on `(client_id, delivery_date)` where `delivery_date IS NOT NULL`. So:
  - If the index is present: the second insert for the same (client_id, delivery_date) fails with **23505**; the catch block ignores it, so you don’t get duplicate rows but you do get **repeated failed insert attempts** and the impression of “recreating” every time.
  - If the index is missing or dates differ slightly: you can get **real duplicate rows** for the same logical (client, date).

### 4. Stops with NULL `delivery_date`

- Only stops with non-null `delivery_date` are added to `clientStopsByDate`. So legacy (or otherwise) stops with `delivery_date = NULL` are **invisible** to the “already has a stop for this date” logic. The code may try to create another stop for the same client/date, which can lead to duplicates if the unique index doesn’t apply (e.g. one row with NULL, one with a date).

---

## Contributing Factors

| Factor | Effect |
|--------|--------|
| **Date format mismatch** | `clientStopsByDate` uses raw `s.delivery_date`; lookup uses normalized `"YYYY-MM-DD"`. Existing stops are not recognized → same stops queued for creation every visit. |
| **Upsert on `id` only** | New UUID every time → no conflict on `id`; duplicate (client_id, delivery_date) is only prevented by the unique index, not by upsert. |
| **Create-on-every-GET** | Step 9 runs on every load of the routes page; any bug in the “existing stop” check is hit on every visit. |
| **NULL delivery_date** | Stops with NULL are not counted as “existing” for any date, so the code may try to create extra stops. |

---

## Solution Plan

### Fix 1: Normalize `delivery_date` when building “existing stops” (recommended, minimal change)

- **Where:** `app/api/route/routes/route.ts`, step 9, where `clientStopsByDate` is built (lines ~432–446).
- **What:** Normalize every `s.delivery_date` to **YYYY-MM-DD** before adding it to the Set (same format as `deliveryDateStr` from orders).
- **Why:** Ensures that “already has a stop for this date” is true whenever a stop exists for that client and date, regardless of how Supabase returns the date. This stops the same stop from being queued for creation on every request.
- **Example:** Add a small helper, e.g. `normalizeDate(s.delivery_date)`, and use it when adding to `clientStopsByDate` and when comparing. Reuse the same normalization already used elsewhere in the file (e.g. `split('T')[0]` or a shared `normalizeDate`).

### Fix 2: Include NULL `delivery_date` in “existing” when appropriate (optional)

- If you want to avoid creating a second stop for a client when the only existing stop has `delivery_date = NULL`, you could:
  - Either backfill `delivery_date` for those stops from orders (one-time migration), or
  - When building “existing,” treat a client with **any** stop (including NULL date) for the requested date range as “has stop” for that logical date (e.g. by also tracking “client has at least one stop for this day” or by matching on `day` when `delivery_date` is null). This is more heuristic and depends on your business rules.

### Fix 3: Make creation idempotent with upsert on (client_id, delivery_date) (optional, stronger)

- **Where:** Same file, block that inserts into `stops` (lines ~802–831).
- **What:**  
  - Either use a **deterministic id** per (client_id, delivery_date) (e.g. UUID v5) and keep `upsert(..., { onConflict: 'id' })`, or  
  - **Upsert on** `(client_id, delivery_date)` so that if a row already exists, it is updated instead of inserting a second row. In Supabase this requires the unique constraint to exist and specifying the conflict columns (e.g. `onConflict: 'client_id,delivery_date'` if supported by your Supabase/PostgREST version).
- **Why:** Even if the “existing stop” check were wrong, you would not create duplicate rows; you’d at most update the same row. Combined with Fix 1, this gives robust idempotency.

### Fix 4: Don’t create stops on every GET (optional, product decision)

- **Options:**  
  - Run “create missing stops” only when a query flag is set (e.g. `?create_missing=1`) or from a dedicated button/endpoint.  
  - Or run it in a background job or a separate “sync” endpoint instead of inside the routes GET.
- **Why:** Reduces redundant work and limits the impact of any remaining logic bugs to explicit “sync” actions rather than every page load.

---

## Recommended Order of Implementation

1. **Implement Fix 1** (normalize `delivery_date` in `clientStopsByDate` and in the “existing stop” check). This directly addresses the “duplicating or recreating every time the page was visited” behavior with minimal risk.
2. **Verify** that the unique index `idx_stops_client_delivery_date` exists in the target database so that duplicate (client_id, delivery_date) rows cannot be inserted.
3. Optionally add **Fix 3** (upsert on client_id + delivery_date) for extra safety.
4. Optionally consider **Fix 4** if you want to avoid running creation logic on every routes page load.

---

## Files to Touch

- **Primary:** `app/api/route/routes/route.ts`  
  - Normalize `delivery_date` when building `clientStopsByDate`.  
  - Optionally: change insert to upsert on `(client_id, delivery_date)` and/or use a deterministic id.
- **Reference (same pattern):** `app/api/route/cleanup/route.ts` uses similar “existing stops” and “stops to create” logic; apply the same normalization there for consistency.

---

## Testing Suggestions

- Load the routes page for a given day/date that already has stops; confirm no duplicate stops appear and no 23505 errors in logs (or that creation is not attempted once Fix 1 is in place).
- Create a new order for a client/date that has no stop; load routes and confirm exactly one new stop is created and that reloading does not create another.
- If you have stops with NULL `delivery_date`, verify behavior after Fix 1 (and optionally Fix 2) so that you don’t get unintended duplicates.
