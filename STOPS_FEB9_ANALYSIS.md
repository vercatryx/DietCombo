# Analysis: Why the App Has 1000+ Stops on Feb 9, 2026

## Summary

The large number of stops on **February 9, 2026** is primarily due to **all clients with the same delivery day (e.g. Monday) being assigned the same “next occurrence” date**, which falls on Feb 9. There is no spreading of deliveries across weeks, so one weekday can accumulate every client that delivers on that day. A secondary risk is the **10,000-row limit** when loading existing stops in the routes API, which can lead to duplicate stop creation in edge cases.

---

## Root Cause 1: Single “Next Occurrence” Date per Delivery Day

### How delivery date is chosen

1. **Routes API** (`app/api/route/routes/route.ts`):
   - For **orders**: uses `scheduled_delivery_date` from the `orders` table.
   - For **upcoming_orders** without `scheduled_delivery_date`: uses **`getNextOccurrence(delivery_day, refToday)`** where `refToday` is “today” in app timezone (Eastern).

2. **`getNextOccurrence`** (`lib/order-dates.ts`):
   - Returns the **next calendar occurrence** of the given weekday (e.g. "Monday").
   - If today is Monday Feb 9, 2026, then `getNextOccurrence("Monday", refToday)` returns **Feb 9, 2026** for every client with `delivery_day = "Monday"`.

3. **Process-weekly-orders** (`app/api/process-weekly-orders/route.ts`):
   - When transferring upcoming orders to `orders`, it sets `scheduled_delivery_date` from `delivery_day` by finding the **first occurrence of that day in the next 1–7 days** (same idea: one date per weekday).

So:

- Every client with the same **delivery_day** gets the **same** “next occurrence” date.
- If that date is **Feb 9, 2026** (e.g. “next Monday” when today is Monday or earlier), then **all** such clients get a stop on Feb 9.
- If you have **1000+ clients** with that delivery day, you get **1000+ stops** on Feb 9.

This is consistent with the current design: one stop per order, and the delivery date is “next occurrence” of the client’s delivery day, not spread across weeks.

---

## Root Cause 2: Routes API Existing-Stops Query Uses `limit(10000)`

In **`app/api/route/routes/route.ts`** (around lines 435–438):

```ts
const { data: existingStops } = await supabase
    .from('stops')
    .select('client_id, delivery_date, day, order_id')
    .limit(10000);  // ← Only first 10k stops loaded
```

- `orderIdsWithStops` and `clientStopsByDate` are built from this result.
- If the total number of stops in the DB is **greater than 10,000**, these sets are **incomplete**.
- The code can then believe that some clients do **not** yet have a stop for Feb 9 and add them to `stopsToCreate`.
- A later check filters by `order_id` before insert, so duplicates are partly mitigated, but:
  - The same logical order can have different IDs (e.g. `upcoming_orders.id` vs `orders.id`), so you could still get multiple stops per delivery.
  - Relying on a global 10k cap is fragile as data grows.

So the **10k limit** is a secondary cause that can **amplify** the number of stops (e.g. duplicates) when total stops exceed 10,000.

---

## Data Flow Summary

| Source                | How delivery date is set for Feb 9                         |
|-----------------------|-------------------------------------------------------------|
| **orders**            | `scheduled_delivery_date` stored on the order (often from “next occurrence” at transfer time). |
| **upcoming_orders**   | No date → `getNextOccurrence(delivery_day, refToday)` → e.g. 2026-02-09 for all “Monday” clients. |
| **Routes GET**        | Builds one stop per (client, delivery_date) from orders + upcoming_orders; uses refToday so all same-day clients get the same date. |
| **process-weekly-orders** | When creating/updating stops, uses each order’s `scheduled_delivery_date` (again, often “next occurrence” of delivery_day). |

So both the **routes page** and **process-weekly-orders** align on “next occurrence” of the delivery day, and when that day is Feb 9, every client with that weekday gets a stop on Feb 9.

---

## Recommendations

1. **Confirm business intent**
   - If 1000+ stops on one day is **not** desired, you need a rule to spread deliveries (e.g. by client segment, region, or week). That would require product/UX and backend changes (e.g. assign “week 1 / week 2” or explicit dates per client).

2. **Fix the 10k limit in the routes API**
   - When the user is viewing a **specific** `delivery_date`, load existing stops **only for that date** instead of a global `limit(10000)`:
     - e.g. `.eq('delivery_date', normalizedDeliveryDate)` and then no limit (or a high limit) for that date.
   - That way you have a complete set of existing stops for the date you’re about to create stops for, and you avoid duplicate creation when total stops > 10k.

3. **Optional: unique constraint**
   - Consider a **unique constraint** on `(order_id)` in the `stops` table (with `order_id` non-null), so the database prevents multiple stops per order even if the app misbehaves.

4. **Optional: analytics**
   - Add a simple report or query: count of stops by `delivery_date` and by `day` (and maybe by client segment). That will make it obvious when one date has an unusually high number of stops and tie it to “next occurrence” for a single weekday.

---

## Files Involved

- **Delivery date logic**: `lib/order-dates.ts` (`getNextOccurrence`), `lib/timezone.ts` (`getTodayDateInAppTzAsReference`).
- **Routes API (stop creation + 10k limit)**: `app/api/route/routes/route.ts` (existing stops query ~435–438, stop creation and dedupe ~758–884).
- **Process weekly orders (transfer + stop creation)**: `app/api/process-weekly-orders/route.ts` (transfer ~378–401, `createOrUpdateStopForOrder` ~92–302).
- **Cleanup**: `app/api/route/cleanup/route.ts` (no limit on existing stops; used for cleanup only).

Implementing **recommendation 2** (scope existing-stops by `delivery_date` when a date is selected and remove/replace the global 10k limit for that path) is the most direct code change to prevent duplicate stops while keeping current “next occurrence” behavior.
