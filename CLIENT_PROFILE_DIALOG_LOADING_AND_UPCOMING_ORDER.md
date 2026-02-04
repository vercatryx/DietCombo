# Client Profile Dialog: Slow Loading Fix & Upcoming Order Schema Integration

This document describes the **issue** (slow client profile dialog loading), the **changes made** to address it, how they relate to the **upcoming order schema** (`UPCOMING_ORDER_SCHEMA.md`), and **instructions to reimplement** the fix if it is lost or needs to be ported.

---

## 1. The Issue

### 1.1 Slow loading when opening the client profile

When a user opens the **client profile dialog** (full profile from the client list or info shelf):

- **Expected**: Dialog opens quickly with client details and current order (upcoming order) already visible.
- **Actual (before fix)**: The dialog often showed a loading state for a long time because it always ran a heavy **full load** (`loadData()`), which:
  - Calls `getClientProfilePageData(clientId)` — a single server round-trip that still fetches many things in parallel (statuses, navigators, vendors, menu items, box types, settings, categories, all clients, regular clients, active order, history, billing, **upcoming order**, order history, dependents, box orders, submissions).
  - Even with one round-trip, this is slow when the cache is cold or when the user opens the profile **before** any prefetched data is ready.

### 1.2 Root cause

- The profile can receive **initial data** from the parent (`ClientList`) when that parent has already prefetched details for the selected client (e.g. when the user opened the **info shelf** first, which triggers `prefetchClient(clientId)` and populates `detailsCache[clientId]`).
- The dialog only skipped the heavy load when it had **both**:
  - `initialData` (from `detailsCache[selectedClientId]`), and  
  - `initialData.upcomingOrder != null`.
- If `upcomingOrder` was `null` (e.g. because the **upcoming order** was read from a **local DB** that was empty or out of sync with Supabase), the dialog **ignored** the rest of the initial data and called `loadData()` anyway, causing slow loading.

So the slowness was a combination of:

1. **Not using initial data when `upcomingOrder` was missing** — even though the rest of the prefetched data could have been used.
2. **Upcoming order often missing from prefetch** — because `getUpcomingOrderForClient(clientId)` (used inside `getClientFullDetails`) was returning `null` when the local orders DB had no data or was not yet synced from Supabase.

---

## 2. Upcoming Order Schema Context

Two different concepts exist in the codebase:

| Concept | Where | Purpose |
|--------|--------|--------|
| **`clients.upcoming_order`** (JSONB column) | Client row in DB | Per `UPCOMING_ORDER_SCHEMA.md`: single JSON object per client; shape depends on `serviceType` (Boxes, Custom, Food/Meal). Full replace on save; only schema-allowed fields are stored. |
| **`upcoming_orders` table** | Separate table | Used for order processing (e.g. process-weekly-orders). Synced from the client’s order config; fed by sanitized/hydrated payload. |

- **Profile loading** uses **upcoming order** data to populate the “Current Order Request” form. That data can come from:
  - The **`upcoming_orders` table** (via `getUpcomingOrderForClient` → local DB, then Supabase sync), and/or  
  - The **`clients.upcoming_order`** column (e.g. via client’s `activeOrder` / stored payload).
- The **implementation plan** (`UPCOMING_ORDER_IMPLEMENTATION_PLAN.md`) describes sanitizers (`toStoredUpcomingOrder`) and hydration (`fromStoredUpcomingOrder`) so that:
  - Writes to `clients.upcoming_order` are schema-only.
  - Reads are hydrated for the UI. The same payload can be used to sync to the `upcoming_orders` table.

The **slow-loading fix** does not change the schema; it ensures that when we **read** upcoming order (for prefetch and for the dialog), we get a value when one exists (e.g. from the table via synced local DB), so the dialog can **hydrate from initial data** and avoid the heavy `loadData()` path.

---

## 3. Changes Made

### 3.1 ClientProfile: Use initial data when it includes `upcomingOrder`

**File:** `components/clients/ClientProfile.tsx`

- **Logic (useEffect that runs when `clientId` / `initialData` / `isNewClient` change):**
  - If `initialData` exists, matches the current `clientId`, and **`initialData.upcomingOrder != null`**:
    - Call **`hydrateFromInitialData(initialData)`** to set client, formData, active order, history, order history, billing history, and — using the same logic as `loadData()` — **orderConfig** and **allUpcomingOrders** from `initialData.upcomingOrder`.
    - Optionally set auxiliary data from props (settings, categories, allClients, regularClients, dependents) when provided.
    - Load lookups (statuses, vendors, etc.) only if needed; set loading false so the dialog paints quickly.
  - If `initialData` exists and matches but **`upcomingOrder` is null**, the code can still use `initialData` for other fields and avoid full `loadData()` in some branches (e.g. when `hasAuxiliaryFromProps`), but the critical fast path is when **`upcomingOrder` is present**.
  - If there is no usable initial data (or no `upcomingOrder` and no auxiliary), call **`loadData()`** and set loading true until it finishes.

- **Comment in code:**  
  *“If we have initialData with upcomingOrder, hydrate instantly. Otherwise run full loadData() so we fetch existing upcoming_orders (reimplemented fix for client profile dialog).”*

So the **change** is: treat **initialData + upcomingOrder** as sufficient to open the dialog quickly and only run the full server load when necessary.

### 3.2 getUpcomingOrderForClient: Sync local DB when result is null

**File:** `lib/actions.ts`

- **Function:** `getUpcomingOrderForClient(clientId, caseId?)`
- **Behavior:**
  - Get upcoming order from the **local DB** via `getUpcomingOrderForClientLocal(clientId, caseId)`.
  - **Reimplemented fix:** If the result is **`null`**, call **`syncLocalDBFromSupabase()`** to refresh the local orders DB from Supabase (including `upcoming_orders` and related tables), then call **`getUpcomingOrderForClientLocal(clientId, caseId)`** again.
  - Return the (possibly retried) result.

- **Comment in code:**  
  *“Reimplemented fix: when local DB is empty or out of sync, sync from Supabase and retry so the client profile dialog can load existing upcoming_orders records.”*

So the **change** is: when the local DB has no upcoming order for the client, sync from Supabase once and retry, so that existing `upcoming_orders` rows are available for prefetch and for the dialog.

### 3.3 hydrateFromInitialData and loadData: Same upcoming-order logic

- **`hydrateFromInitialData(initialData)`** and **`loadData()`** both derive **orderConfig** and **allUpcomingOrders** from the same kind of **upcoming order** payload (multi-day vs single order, Food vs Boxes vs Custom, etc.).  
- They share the same filtering and normalization (e.g. for Food clients, only use Food orders; multi-day format → `deliveryDayOrders`; legacy fields → `boxOrders` / `vendorSelections`).  
- This keeps behavior consistent whether the dialog opens from **initial data** (fast path) or from **loadData()** (full load path).

---

## 4. Data Flow Summary

1. **ClientList** prefetches details with **`getClientFullDetails(clientId)`** (e.g. on hover or when opening the info shelf). That function calls **`getUpcomingOrderForClient(clientId)`** and includes the result in **`upcomingOrder`**.
2. **getUpcomingOrderForClient** reads from the **local DB** (populated from the **`upcoming_orders`** table). If the local DB returns null, it **syncs from Supabase and retries**, so existing upcoming orders are returned when they exist.
3. When the user opens the **full profile**, **ClientList** passes **`initialData={detailsCache[selectedClientId]}`** into **ClientProfileDetail**.
4. **ClientProfile** checks **`initialData?.upcomingOrder != null`**. If true, it calls **`hydrateFromInitialData(initialData)`** and avoids **`loadData()`**, so the dialog opens quickly with the same order state as a full load would produce.

---

## 5. Instructions to Reimplement

If this behavior is reverted or you need to reimplement it elsewhere:

### 5.1 Ensure prefetch includes upcoming order

- **ClientList** (or any parent that opens the profile) must prefetch **full client details** including **upcoming order** before or when opening the dialog (e.g. `getClientFullDetails(clientId)`), and pass that into the profile as **`initialData`**.
- **getClientFullDetails** must call **`getUpcomingOrderForClient(clientId)`** and attach the result to the returned object as **`upcomingOrder`** (see `lib/types.ts` → `ClientFullDetails.upcomingOrder`).

### 5.2 getUpcomingOrderForClient: sync and retry when null

In **`lib/actions.ts`**, in **`getUpcomingOrderForClient`**:

1. Call **`getUpcomingOrderForClientLocal(clientId, caseId)`** (or equivalent local/table read).
2. If the result is **`null`** (or empty), call **`syncLocalDBFromSupabase()`** (or your sync-from-Supabase routine) to refresh the local copy of **`upcoming_orders`** (and related tables).
3. Call **`getUpcomingOrderForClientLocal(clientId, caseId)`** again and return that result.

This guarantees that after a sync, existing `upcoming_orders` rows are available so prefetch and profile load see them.

### 5.3 ClientProfile: fast path when initialData has upcomingOrder

In **`components/clients/ClientProfile.tsx`**, in the **useEffect** that runs when `clientId` / `initialData` / `isNewClient` change:

1. Compute:
   - `hasInitialData = initialData && initialData.client.id === clientId`
   - `hasUpcomingOrderInInitial = hasInitialData && initialData.upcomingOrder != null`
2. If **`hasInitialData && hasUpcomingOrderInInitial`**:
   - Call **`hydrateFromInitialData(initialData)`** so that client, formData, orderConfig, allUpcomingOrders, history, etc. are set from **initialData** (including **initialData.upcomingOrder**).
   - Apply the **same** upcoming-order parsing/filtering logic as in **`loadData()`** (Food-only filtering, multi-day → deliveryDayOrders, Boxes/Custom handling) inside **`hydrateFromInitialData`** so the UI state is identical.
   - Set auxiliary data from props if provided; load lookups only if missing; set **loading** to false so the dialog renders immediately.
3. Otherwise (no initial data or no upcoming order in initial data), set loading true and call **`loadData()`**, then set loading false when done.

Keep the dependency array stable (e.g. use `initialData?.client?.id ?? null` instead of `initialData` so parent re-renders with the same client do not retrigger unnecessarily).

### 5.4 Keep hydrateFromInitialData and loadData in sync

- Any change to how **orderConfig** or **allUpcomingOrders** is derived from **upcoming order** in **`loadData()`** should be reflected in **`hydrateFromInitialData()`** (and vice versa) so that the fast path and the full-load path produce the same UI state.
- When adopting **UPCOMING_ORDER_SCHEMA** and **fromStoredUpcomingOrder** (see `UPCOMING_ORDER_IMPLEMENTATION_PLAN.md` Phase 3), apply hydration in **both**:
  - The place that fills **orderConfig** in **loadData()**, and  
  - The place that fills **orderConfig** in **hydrateFromInitialData()** (from **initialData.upcomingOrder** or from client’s stored payload, depending on where prefetch gets its data).

### 5.5 Optional: Fallback when upcomingOrder is null but initialData exists

If you want the dialog to still open quickly when prefetch has **initialData** but **upcomingOrder** is null (e.g. client has no upcoming order yet), you can add a branch that:

- Calls **`hydrateFromInitialData(initialData)`** (with a small adaptation so it can handle **upcomingOrder === null** by setting orderConfig from **activeOrder** or defaults),
- Sets loading false,
- And only fetches **upcoming order** in the background or on demand, instead of running the full **loadData()**.

That would reduce reliance on **upcomingOrder** being non-null for the fast path, while the current implementation treats **upcomingOrder != null** as the key to the fast path.

---

## 6. Related Files and Docs

| Item | Purpose |
|------|--------|
| **UPCOMING_ORDER_SCHEMA.md** | Schema for **`clients.upcoming_order`** (Boxes, Custom, Food/Meal shapes; full replace; no `upcoming_orders` table content). |
| **UPCOMING_ORDER_IMPLEMENTATION_PLAN.md** | Sanitizers, hydration, and phases to adopt the schema; sync to **`upcoming_orders`** table. |
| **lib/actions.ts** | `getClientFullDetails`, `getUpcomingOrderForClient` (sync-on-null), `getClientProfilePageData`. |
| **lib/local-db.ts** | `getUpcomingOrderForClientLocal`, `syncLocalDBFromSupabase` (reads from **`upcoming_orders`** and related tables). |
| **components/clients/ClientProfile.tsx** | `hydrateFromInitialData`, `loadData()`, useEffect that chooses fast path vs full load. |
| **components/clients/ClientList.tsx** | Prefetch (`prefetchClient`, `getBatchClientDetails`), **detailsCache**, **initialData={detailsCache[selectedClientId]}** passed to **ClientProfileDetail**. |
| **lib/types.ts** | **ClientFullDetails** (includes **upcomingOrder**). |

---

## 7. Summary

- **Issue:** Client profile dialog was slow because it often ran a full **loadData()** even when the parent had prefetched details, due to **upcomingOrder** being null (local DB empty/out of sync) and the dialog not using initial data when **upcomingOrder** was missing.
- **Changes:**  
  (1) **ClientProfile** uses **initialData** and **initialData.upcomingOrder** to **hydrate** and skip **loadData()** when possible.  
  (2) **getUpcomingOrderForClient** **syncs the local DB from Supabase and retries** when the local read returns null, so prefetch and dialog get existing **upcoming_orders** data.
- **Schema:** The fix does not alter **UPCOMING_ORDER_SCHEMA** or the **upcoming_orders** table; it only ensures that existing upcoming order data is available for prefetch and for the fast path. Future schema integration (sanitize/hydrate) should be applied in both **loadData()** and **hydrateFromInitialData()** so both paths stay aligned.
