# Meal Planner Orders / Order Items — Save Performance Analysis

## Where data is saved

All persistence for `meal_planner_orders` and `meal_planner_order_items` happens in **`lib/actions.ts`**. Main entry points:

| Flow | Function(s) | When |
|------|-------------|------|
| Default template → all Food clients | `propagateDefaultTemplateToFoodClients` | Admin saves default order template |
| Admin saves/updates meals for a calendar date (one or all clients) | `syncMealPlannerCustomItemsToOrders` | After saving meal plan custom items for a date |
| Admin saves meal plan for a day (all Food clients) | `syncMealPlannerCustomItemsToMealPlannerOrders` | Calendar save for a single date, all clients |
| Client quantity change for one date | `syncMealPlanDateToOrderForClient` → `syncMealPlannerCustomItemsToOrders` | Client changes quantity in Saved Meal Plan |
| Client meal selections (active order) → 8 weeks | `syncMealPlannerToOrders` (from `saveClientMealOrder`) | Saving client meal order |
| Client profile: quantity edits in Saved Meal Plan | `saveClientMealPlannerOrderQuantities` | Saving client profile with quantity changes |

---

## Bottlenecks identified

### 1. **Per-client, per-item round-trips (main cause of slowness)**

- **`syncMealPlannerCustomItemsToOrders`** (lines ~1861–2030) and **`syncMealPlannerCustomItemsToMealPlannerOrders`** (lines ~2039–2118):
  - For **each client**: 1 query for `case_id` (`getUpcomingOrderCaseIdForFoodClient`) and 1 query for effective items (`getEffectiveMealPlanItemsForDate`).
  - Then for **each item**: a separate **`insert`** into `meal_planner_order_items`.
- With 50 clients and 10 items per order: **50×2 + 50×10 = 600** round-trips for the “all clients, one date” sync. With 20 items: **50×2 + 50×20 = 1,100** round-trips.

### 2. **Per-date, per-item round-trips in `syncMealPlannerToOrders`**

- **`syncMealPlannerToOrders`** (lines ~10546–10666):
  - For **each delivery date** (~16 over 8 weeks): `getEffectiveMealPlanItemsForDate` (1 query), 1 order insert, then **one insert per catalog item** and **one insert per custom item**.
  - Example: 16 dates × (1 + 1 + 15 + 5) ≈ **352** round-trips for one client.

### 3. **Sequential per-client work**

- Both sync functions loop over `clientIds` and do all DB work **sequentially** per client (case fetch, effective items fetch, then order + item writes). No batching across clients and no parallelization.

### 4. **Redundant deletes**

- **`syncMealPlannerCustomItemsToMealPlannerOrders`**: deletes existing orders with a **loop** (one `delete().eq('id', row.id)` per order). With CASCADE on `meal_planner_order_items`, a single `.in('id', ids)` delete would suffice.

### 5. **Per-order and per-item updates in `saveClientMealPlannerOrderQuantities`**

- **`saveClientMealPlannerOrderQuantities`** (lines ~2439–2486): one **update** per order and one **update** per item, all **sequential**. Many orders × many items → many round-trips.

### 6. **`syncMealPlannerCustomItemsToOrders` — user_modified path**

- When an order exists and is `user_modified`: **one delete per item** for `toDelete`, then **one insert per item** for `toAdd`. Again, N deletes + M inserts instead of batched deletes and batched inserts.

---

## What is already efficient

- **`propagateDefaultTemplateToFoodClients`**:
  - Uses **batch** `getUpcomingOrderCaseIdsForFoodClients(clientIds)` (one query for all clients).
  - Builds all `orderRows` and `itemRows` in memory, then inserts in batches (`BATCH_ORDERS = 80`, `BATCH_ITEMS = 400`).
  - Bulk deletes in chunks. This is the right pattern; the slow paths are the sync and single-client flows that do not follow it.

---

## Recommendations

### High impact

1. **Batch case_id and effective items for “all clients” sync**
   - In `syncMealPlannerCustomItemsToOrders` and `syncMealPlannerCustomItemsToMealPlannerOrders`, when `clientIds.length > 1`:
     - Call **`getUpcomingOrderCaseIdsForFoodClients(supabaseAdmin, clientIds)`** once instead of `getUpcomingOrderCaseIdForFoodClient` per client.
     - Add **`getEffectiveMealPlanItemsForDateBatch(supabase, clientIds, dateOnly)`**: one (or two) query to `meal_planner_custom_items` with `.eq('calendar_date', dateOnly).or(`client_id.in.(${clientIds.join(',')}),client_id.is.null`)`, then in memory split by `client_id` and apply the same “default + client override by name” merge per client. Use the result map `clientId → EffectiveMealPlanItem[]` inside the loop instead of calling `getEffectiveMealPlanItemsForDate` per client.

2. **Batch insert for `meal_planner_order_items` in sync flows**
   - In both sync functions, **collect all item rows** (with correct `meal_planner_order_id`) in an array, then insert in chunks (e.g. 200–400 rows per call), e.g.:
     - `for (let i = 0; i < itemRows.length; i += BATCH_ITEMS) { await supabaseAdmin.from('meal_planner_order_items').insert(itemRows.slice(i, i + BATCH_ITEMS)); }`
   - Apply the same pattern in the **user_modified** branch of `syncMealPlannerCustomItemsToOrders`: batch `toAdd` inserts and, if possible, delete by `.in('id', toDeleteIds)` in one or few calls.

3. **Batch order deletes in `syncMealPlannerCustomItemsToMealPlannerOrders`**
   - Replace the loop `for (const row of existingOrders) { await ... delete().eq('id', row.id) }` with a single delete using the list of ids:  
     `await supabaseAdmin.from('meal_planner_orders').delete().in('id', existingOrders.map(r => r.id))`  
   - (Schema has ON DELETE CASCADE on `meal_planner_order_items`, so items are removed automatically.)

4. **Optimize `syncMealPlannerToOrders` (client meal selections → 8 weeks)**
   - **Effective items**: Fetch once for **all** delivery dates:  
     `meal_planner_custom_items` where `calendar_date` in `deliveryDates` and `(client_id = clientId or client_id is null)`. Index the result by `calendar_date` in memory and use it inside the date loop instead of calling `getEffectiveMealPlanItemsForDate` per date.
   - **Orders**: Build all order rows (one per date), then **batch insert** (e.g. 50–80 per batch).
   - **Items**: Build all item rows (order_id, menu_item_id, meal_item_id, quantity, sort_order, etc.), then **batch insert** (e.g. 200–400 per batch).

### Medium impact

5. **Batch or parallelize updates in `saveClientMealPlannerOrderQuantities`**
   - Option A: Run order updates in parallel (e.g. `Promise.all` in chunks of 10–20) so multiple updates are in flight.
   - Option B: If the backend supports it, use a single RPC or raw SQL that updates multiple `meal_planner_order_items` in one call (e.g. `UPDATE ... SET quantity = v WHERE id = id1; UPDATE ... WHERE id = id2; ...` or a batch upsert). Supabase does not support multi-row `update` with different values per row in one call; the practical improvement is **parallel updates** (Promise.all chunks) for both order and item updates.

6. **Batch deletes in `syncMealPlannerCustomItemsToOrders` (user_modified path)**
   - Replace `for (const row of toDelete) { await ... delete().eq('id', row.id) }` with  
     `await supabaseAdmin.from('meal_planner_order_items').delete().in('id', toDelete.map(r => r.id))`  
   - Optionally chunk if the list is very large (e.g. 100 ids per delete).

### Lower impact / structural

7. **Consider batching order inserts when syncing “all clients” for one date**
   - In `syncMealPlannerCustomItemsToMealPlannerOrders`, build all new order rows (one per client that has items), then insert orders in batches (e.g. 50–80 at a time). Then build item rows using the inserted order ids and batch-insert items. This requires either returning inserted ids from Supabase (e.g. `.select('id')` on insert) or pre-generating UUIDs and using them for both order and item rows (current code already uses pre-generated orderId), so you can build item rows before inserting orders and keep the same pattern as `propagateDefaultTemplateToFoodClients`.

8. **Indexes**
   - Ensure indexes exist for hot filters:  
     `meal_planner_orders(client_id, scheduled_delivery_date, status)`,  
     `meal_planner_order_items(meal_planner_order_id)`,  
     `meal_planner_custom_items(calendar_date, client_id)`.  
   - Check execution plans for the batch effective-items query if you add it.

9. **Optional: background/async sync for “all clients”**
   - When admin saves the default template or a calendar date for “all clients”, the sync can be heavy. Consider returning success to the UI immediately and running the sync in a background job (e.g. server action that spawns a fire-and-forget promise or a queue job) so the user is not waiting on hundreds of round-trips.

---

## Implementation order

1. **Batch case_id and effective items** for the “all clients” sync (biggest reduction in round-trips).
2. **Batch insert items** in both sync functions (and batch delete where applicable).
3. **Single delete for existing orders** in `syncMealPlannerCustomItemsToMealPlannerOrders`.
4. **Refactor `syncMealPlannerToOrders`** to one effective-items query for all dates + batch order/item inserts.
5. **Parallelize updates** in `saveClientMealPlannerOrderQuantities`.

After these changes, “sync one date for all Food clients” should go from O(clients × (2 + items)) round-trips to O(1) for case ids + O(1) for effective items + O(orders_batch) + O(items_batch), which will make the meal_planner_orders / meal_planner_order_items save path much faster.
