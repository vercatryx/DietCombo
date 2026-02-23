# Client Preview Sidebar & Client Profile Dialog – Lag Analysis

## Summary

Lag when opening the **client preview sidebar** (Active Order summary in the main app sidebar on `/clients/[id]`) or the **Client Profile dialog** (modal from Client List) is caused by:

1. **Uncached or duplicate API calls** when data could use existing caches.
2. **Heavy work on every render** (order summary and hydration logic) without memoization.
3. **Many network requests** when opening the profile without prefetched data (15+ calls).
4. **Expensive dev logging** (e.g. `JSON.stringify(..., null, 2)` of large objects) on hot paths.

---

## 1. Client Preview Sidebar (`SidebarActiveOrderSummary.tsx`)

**Location:** Rendered in `Sidebar.tsx` when the sidebar is expanded; shows “Active Order” for the client when the route is `/clients/[id]`.

### Causes of lag

- **Uncached API calls:** Uses `getClient`, `getVendors`, `getMenuItems`, `getBoxTypes` from `@/lib/actions` instead of `@/lib/cached-data`. Every navigation to a client page triggers four full server round-trips even when the same data was just loaded elsewhere (e.g. Client List or Client Profile).
- **Heavy work on every render:** `getOrderSummary(client, vendors, menuItems, boxTypes)` is called in the render path (no `useMemo`). That function is large (~430 lines) and does nested loops, `Object.entries`, `JSON.parse` for box items, and multiple `Map`/`Set` operations. Any re-render of the component or parent recomputes it.
- **Dev-only logging:** In development, `getOrderSummary` logs a debug object on every render, adding work and potential main-thread blocking.

### Fixes applied

- Use cached data: import and use `getClient`, `getVendors`, `getMenuItems`, `getBoxTypes` from `@/lib/cached-data` so the sidebar benefits from the same cache as the rest of the app.
- Memoize the order summary: compute `orderSummary` with `useMemo` depending on `client`, `vendors`, `menuItems`, `boxTypes` so it only runs when those inputs change.
- Remove or guard the per-render `console.log` in the order summary (e.g. only in a debug flag or strip in production).

---

## 2. Client Profile Dialog (`ClientProfile.tsx`)

**Location:** Opened from Client List when a client row is clicked; rendered as `ClientProfileDetail` inside a modal.

### Causes of lag

- **Large initial load when cache is cold:** When the user opens the profile for a client that is **not** in `detailsCache`, the dialog runs `loadData()`, which:
  - Calls `getClient(clientId)` once.
  - Then runs a `Promise.all` of 15+ calls: `getStatuses`, `getNavigators`, `getVendors`, `getMenuItems`, `getBoxTypes`, `getSettings`, `getCategories`, `getClients`, `getRegularClients`, `getUpcomingOrderForClient`, `getRecentOrdersForClient`, `getClientHistory`, `getOrderHistory`, `getBillingHistory`.
  - Then calls `getDependentsByParentId(c.id)`.
  That many requests and subsequent `setState` updates (many state slices) cause a noticeable delay and possible UI jank.

- **Heavy work even with `initialData`:** When the dialog opens **with** `initialData` (prefetched client):
  - It calls `hydrateFromInitialData(initialData)`, which does a lot of branching, filtering, and `setOrderConfig`/`setClient`/etc. with complex nested structures.
  - It still runs `loadAuxiliaryData(client)`: `getSettings`, `getCategories`, `getClients`, `getRegularClients`, then `getDependentsByParentId`. So the dialog still triggers several extra requests and more state updates right after open.

- **Expensive dev logging:** In `loadData`, `hydrateFromInitialData`, and `loadLookups` there are many `console.log` calls that serialize large objects (e.g. `JSON.stringify(..., null, 2)`). In development this runs on the main thread and can add noticeable lag when opening the dialog or when dependencies change.

- **Many state slices and re-renders:** The component uses a large number of `useState` values (~60+). When `loadData()` or `hydrateFromInitialData()` finishes, it triggers many `setState` calls (client, formData, orderConfig, history, orderHistory, billingHistory, vendors, menuItems, etc.). That can result in multiple re-renders and a heavy single “commit” of the whole tree.

### Fixes recommended (partial application)

- **Reduce logging:** Remove or guard `console.log`/`console.warn` on hot paths (especially those that do `JSON.stringify` of full order/config objects). Use a dev-only flag or strip in production so production is not affected.
- **Defer non-critical data:** Consider loading auxiliary data (e.g. `loadAuxiliaryData`) after first paint (e.g. `requestIdleCallback` or `setTimeout(..., 0)`) so the dialog can show client and order data from `initialData` or the first batch of `loadData` before filling in settings, categories, dependents, etc.
- **Prefetch on hover/focus:** In Client List, prefetch `getClientFullDetails` when the user hovers or focuses a client row (in addition to current prefetch logic) so that when they click, `initialData` is more often already in `detailsCache`, avoiding the full 15+ request cold path.

---

## 3. Client Info Shelf (preview panel from Client List)

**Location:** Slide-out panel in Client List when a user opens the “preview” for a client (e.g. info shelf), showing summary and actions.

### Causes of lag

- **Order summary recomputed every Client List re-render:** The shelf receives `orderSummary={getOrderSummary(detailsCache[infoShelfClientId]?.client || clients.find(...), true)}`. `getOrderSummary` in Client List is a non-trivial function (vendor resolution, Food/Boxes branching). It runs on **every** render of Client List, so any state change (pagination, search, detailsCache update, etc.) recomputes the summary even when the shelf client and underlying data have not changed.

- **Cold cache when opening shelf:** When the user opens the shelf for a client that is not in `detailsCache`, Client List triggers `prefetchClient(id)`, which calls `getClientFullDetails(clientId)` (8 parallel requests). The UI may feel slow until that completes and the shelf content appears.

### Fixes applied

- **Memoize shelf order summary:** Compute the value passed to `ClientInfoShelf`’s `orderSummary` prop with `useMemo`, depending on `infoShelfClientId`, `detailsCache[infoShelfClientId]`, `clients`, `vendors`, `boxTypes` (and any other inputs to `getOrderSummary`). So the heavy `getOrderSummary` runs only when the shelf client or its data actually changes.

---

## 4. Duplicate / uncached data usage

- **Sidebar:** Uses `lib/actions` directly; the rest of the app often uses `lib/cached-data` for the same getters. That leads to duplicate requests and no cache reuse when navigating to a client page.
- **getClientFullDetails:** Implemented in `lib/actions` and does not use the cached `getClient` / order caches from `cached-data`. Prefetch and dialog load could be made to reuse cached client/order data where possible to reduce redundant work and lag.

---

## Files touched by fixes

| File | Change |
|------|--------|
| `components/SidebarActiveOrderSummary.tsx` | Use cached getters; memoize `orderSummary`; remove/guard dev `console.log` in order summary. |
| `components/clients/ClientList.tsx` | Memoize `orderSummary` passed to `ClientInfoShelf` with `useMemo`. |
| `components/clients/ClientProfile.tsx` | Optional: reduce or guard expensive `console.log` in `loadData` / `hydrateFromInitialData` / `loadLookups`. |

This document and the applied code changes address the main causes of lag when opening the client preview sidebar or the client profile dialog.
