# Finding: Why the same client (e.g. Gittel Gradstein) appears twice on vendor labels

**Script:** `scripts/find-duplicate-label-cause.ts`  
**Run:** `npx ts-node --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' scripts/find-duplicate-label-cause.ts`

---

## Definitive cause

**The same order is returned twice in the list used for labels** — not because there are two order rows in the DB for that client, but because **the chunked direct query in `getOrdersByVendor` returns the same order in more than one page**.

- Orders are fetched with:  
  `.order('created_at', { ascending: false }).range(offset, offset + ROW_CHUNK - 1)`  
- When many orders share the **same** `created_at` (e.g. same second), PostgreSQL’s `ORDER BY created_at DESC` does not define a unique order. Ties are broken arbitrarily, so the same row can appear in different chunks when paginating.  
- Result: `ordersFromTable` (and thus the merged list and labels) can contain the **same order_id** multiple times.  
- Example: Gittel has **one** order in the DB for that vendor+date, but that order appeared in two chunks, so the household list had 10 entries for 9 unique orders and Gittel’s order appeared twice (indices [8] and [9]).

So the duplicate label is caused by **pagination non-determinism** in the direct orders query, not by duplicate orders per client or by dependant-order logic.

---

## Evidence (from script run)

- **Raw DB:** For the vendor and date, each household member (including Gittel) has **exactly one** order row. No duplicate orders per client.
- **Simulated getOrdersByVendor:** The filtered list contained **duplicate order ids** (same `order_id` appearing twice). Gittel’s order `23f6a4cd-8add-48bc-8c8f-f21e3e7c6d49` appeared at positions [8] and [9].
- **Pagination check:** The same order ids that were duplicated in the final list were already duplicated in **ordersFromTable** (the direct query result before merge). So the duplication is introduced by the chunked direct query.
- **Junction:** No duplicate `(order_id, vendor_id)` rows in `order_vendor_selections`.

---

## Fix (applied)

In `lib/actions.ts` `getOrdersByVendor`:

1. **Stable sort for pagination** — Added `.order('id', { ascending: true })` after `.order('created_at', { ascending: false })` on both the direct chunked query and the extra-orders (junction) query. So `ORDER BY created_at DESC, id ASC` is deterministic and the same row cannot appear in two chunks.

2. **Deduplicate by order id** — After merging direct + junction results, the list is deduplicated by `order.id` (keep first occurrence, then re-sort by `created_at`). So any duplicate that might still slip through is removed before date filtering and label export.
