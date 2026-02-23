# All Customers Mode – Billing Feature (Issues & Plan)

## Summary

Add an **“All customers mode”** on the server (app) that:
1. **Download** – Fetches the billing list from `https://customer.thedietfantasy.com/api/bill`.
2. **Run it** – Bills using **the numbers from the list only** (skip the orders part): use `name`, `amount`, `dependants`, and whatever else is in the list. **Proof URL** source is TBD (you’ll specify where to get it). No order matching or week-based billing for this mode.

Ensure the **Chrome extension** and **server** stay **synced** for billing (data shape, auth, and usage).

This doc only records **issues and design points**; no code changes yet.

---

## Current State

### 1. External “All customers” list

- **URL:** `https://customer.thedietfantasy.com/api/bill`
- **Format:** JSON array of entries, same shape as `/api/extension/billing-requests`:
  - `name`, `url`, `orderNumber`, `date`, `amount`, `proofURL`, `dependants` (array of `{ name, Birthday, CIN }`).
- **Semantics:** One entry per **parent client** (household); amount is computed (e.g. 336 × people or 146 × people for Produce). Many entries have empty `url`, `orderNumber`, `date`, `proofURL` in the sample — i.e. it’s a full client roster with amounts, not necessarily tied to specific orders.

### 2. Server-side billing today

| Piece | Location | Purpose |
|-------|----------|--------|
| **Billing page** | `app/billing/page.tsx` → `components/billing/BillingList.tsx` | Week-based billing list; data from `getBillingRequestsByWeek()` (orders grouped by client + week). |
| **BillingRequest (app)** | `lib/types-orders-billing.ts` | Per client per week: `clientId`, `clientName`, `weekStart`, `weekEnd`, `orders[]`, `totalAmount`, `readyForBilling`, `billingCompleted`, `billingStatus`, etc. |
| **GET /api/bill** | `app/api/bill/route.ts` | Internal: returns **all** clients in the flat format (name, url, orderNumber, date, amount, proofURL, dependants). No auth. Same shape as external list. |
| **GET /api/extension/billing-requests** | `app/api/extension/billing-requests/route.ts` | Extension API: returns only orders with `status = 'billing_pending'` in the **same flat format**. Requires `Authorization: Bearer <EXTENSION_API_KEY>`. |

So we have **two different billing representations**:
- **App BillingList:** Week-based, order-centric (`BillingRequest` with `orders[]`, proof/billing status).
- **Flat list (extension + /api/bill):** One row per client (or per billing_pending order), with name, amount, dependants, url, orderNumber, date, proofURL.

### 3. Chrome extension and billing

- **Extension** does **not** call `billing-requests` anywhere in this repo (no references in `chrome-extension/`).
- **Extension** only has a “bill” **flag** on the create-client form (`flag-bill` checkbox) — it does not show or manage a billing list.
- So today, **who uses `/api/extension/billing-requests`?** Likely an external consumer (e.g. the “customer” app at thedietfantasy.com or another tool). That consumer may be the same app that exposes `https://customer.thedietfantasy.com/api/bill` (all-customers list).

---

## Proposed Addition: “All customers mode” (server only, for now)

- **Where:** Server-side UI (e.g. on or next to the existing Billing page).
- **Actions:**
  1. **“Download list”** – Button that fetches `https://customer.thedietfantasy.com/api/bill` and stores/displays the result (e.g. in state or a simple list view).
  2. **“Run it”** – Button that “uses this list for billing.” Bill for the numbers in the list only (no orders); use name, amount, dependants, and other list fields as-is. Proof URL from a source you'll specify later; everything else from the list can be used.

No other changes in this phase; this doc only captures issues.

**Decision (All customers "Run it"):** Skip the orders part; just bill for the numbers. Use the list as-is: `name`, `amount`, `dependants`, and any other list fields. Proof URL: source TBD — you will specify where to get it; we wire it in when known. Everything else from the list can be used.

---

## Issues to Resolve (for implementation)

### A. Server: All customers mode

1. **Auth / CORS for external URL**  
   - `https://customer.thedietfantasy.com/api/bill` may require auth or may block cross-origin requests when called from our app.  
   - **Issue:** If the app fetches from the browser, CORS and cookies/auth apply. If we proxy via a server route (e.g. `GET /api/bill-from-customer` that server-side fetches the URL), we need to decide auth (e.g. server-side API key or server-to-server token) and error handling.

2. **What “run it” means**  
   - Options (to be decided):  
     - **A)** Only display + export (CSV/Excel) for the downloaded list.  
     - **B)** “Import” rows into our week-based billing (map flat rows → `BillingRequest` or orders) and show in existing Billing list.  
     - **C)** Send the list to an external billing system (e.g. Unite Us or another API).  
     - **D)** Mark corresponding orders as “billing_successful” or similar in our DB.  
   - **Issue:** Product decision needed so we don’t build the wrong flow.

3. **Data shape mismatch**  
   - External (and `/api/bill`, `/api/extension/billing-requests`) use: `name`, `url`, `orderNumber`, `date`, `amount`, `proofURL`, `dependants`.  
   - App `BillingRequest` uses: `clientId`, `clientName`, `weekStart`, `weekEnd`, `orders[]`, `totalAmount`, etc.  
   - **Issue:** To “run” the all-customers list we must either (i) keep it as a separate flat list and only export/display, or (ii) map by `name` (or another key) to `clientId` and merge into the existing billing model — matching by name is fragile (duplicates, spelling).

4. **Where to put the UI**  
   - **Issue:** New section on `/billing` (e.g. “All customers mode” with two buttons) vs separate page (e.g. `/billing/all-customers`). Affects navigation and whether we reuse `BillingList` or add a new component.

5. **Persistence of downloaded list**  
   - **Issue:** Is the list only in-memory (lost on refresh) or should it be stored (e.g. in DB or session) so “Run it” and exports are consistent?

### B. Extension ↔ server sync (billing)

6. **Who consumes `/api/extension/billing-requests`?**  
   - Not the Chrome extension in this repo.  
   - **Issue:** Document or confirm the consumer (e.g. customer.thedietfantasy.com). If that consumer and our app both drive billing, we need a single source of truth and clear semantics (e.g. “billing_pending only” vs “all customers”).

7. **Same JSON shape, different semantics**  
   - `billing-requests`: one entry **per order** with `status = billing_pending`.  
   - `/api/bill`: one entry **per parent client** (all clients), amount computed by 336/146 × people.  
   - External `https://customer.thedietfantasy.com/api/bill`: same shape as `/api/bill` (all customers).  
   - **Issue:** Extension (or any client) that expects “only billing_pending orders” could be confused if we add a mode that returns “all customers” from the same or similar endpoint. Naming and docs should distinguish “billing_requests” (pending orders) vs “bill” (all customers list).

8. **Extension does not show a billing list**  
   - Extension has no UI that calls `billing-requests` or `/api/bill`.  
   - **Issue:** If we want the extension to support “all customers mode” (e.g. show downloaded list or trigger “run it”), we’ll need to add UI and possibly a new extension API (e.g. “get all customers bill list” or “run all customers billing”). Until then, “synced” means: (a) same data shape where both use it, (b) no conflicting semantics (e.g. one endpoint = pending only, another = all customers), and (c) doc/README updated.

9. **Auth consistency**  
   - `billing-requests` requires `EXTENSION_API_KEY`.  
   - `/api/bill` has no auth.  
   - **Issue:** If the extension ever calls an “all customers” list, should it use the same API key? Should we add an optional server-side “all customers” endpoint that uses the same key for consistency?

### C. General

10. **Duplicate / multiple clients with same name**  
    - Flat list is keyed by `name` (and dependants). Our app keys by `clientId`.  
    - **Issue:** Any mapping from “all customers” list to our DB (e.g. for “run it”) must handle duplicate names and define how to match (e.g. require `clientId` in the payload later, or use name+address).

11. **Environment / config**  
    - **Issue:** Base URL for “customer” app (e.g. `https://customer.thedietfantasy.com`) should be configurable (env or admin setting) so staging/dev can point elsewhere.

---

## Suggested next steps (after decisions)

1. **Product:** Define what “run it” does (display only, import, mark billed, or send elsewhere).
2. **Tech:** Decide fetch method (browser vs server proxy) and auth for `https://customer.thedietfantasy.com/api/bill`.
3. **Tech:** Choose UI placement (section on `/billing` vs new page) and whether the downloaded list is ephemeral or stored.
4. **Sync:** Document the consumer of `/api/extension/billing-requests` and add a short note in extension README and server API comments: “billing_requests = billing_pending orders; /api/bill = all customers flat list.”
5. **Implementation:** Add “All customers mode” UI (Download + Run it) per the above; only then consider extension changes if we want the extension to participate in “all customers” flow.

---

## References

- External list sample: [customer.thedietfantasy.com/api/bill](https://customer.thedietfantasy.com/api/bill) (same shape as our `/api/bill` and `/api/extension/billing-requests`).
- App billing: `app/billing/page.tsx`, `components/billing/BillingList.tsx`, `lib/actions-orders-billing.ts`, `lib/types-orders-billing.ts`.
- Flat list APIs: `app/api/bill/route.ts`, `app/api/extension/billing-requests/route.ts`.
- Extension: `chrome-extension/sidepanel.js`, `chrome-extension/sidepanel.html` (only `flag-bill`; no billing list usage).
