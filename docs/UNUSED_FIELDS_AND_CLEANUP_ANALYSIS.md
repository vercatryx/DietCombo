# Unused Fields and Post-Order-Deletion Cleanup

## 1. Tables to Clear After Deleting All Orders

You deleted all rows from the **orders** table. These related tables may still have orphaned data:

| Table | What to do | Notes |
|-------|------------|-------|
| **order_vendor_selections** | Delete orphaned rows | FK to orders was CASCADE—if you used `DELETE`, these were auto-deleted. If you used `TRUNCATE` without CASCADE, run cleanup. |
| **order_items** | Delete orphaned rows | References `order_vendor_selections`; cascades when those are deleted |
| **order_box_selections** | Delete orphaned rows | FK to orders was CASCADE |
| **billing_records** | `SET order_id = NULL` | FK was DROPPED in migration—orphaned `order_id` values remain |
| **signatures** | `SET order_id = NULL` | FK was DROPPED—orphaned refs remain |
| **stops** | `SET order_id = NULL` | `order_id` can reference orders OR upcoming_orders; clear only refs to deleted orders |
| **upcoming_orders** | `SET processed_order_id = NULL` | Links to the order it was processed into |
| **meal_planner_orders** | `SET processed_order_id = NULL` | Same—links to processed order |

**Use the script:** `sql/cleanup_after_orders_deleted.sql`

```bash
psql $DATABASE_URL -f sql/cleanup_after_orders_deleted.sql
```

---

## 2. Potentially Unused or Redundant Fields

### 2.1 Clients Table: `latitude` / `longitude` vs `lat` / `lng`

- **Schema:** Clients have both `latitude`/`longitude` and `lat`/`lng`.
- **Usage:** Code primarily uses `lat`/`lng` (ClientInfoShelf, routes, ClientDriverAssignment, process-weekly-orders, etc.).
- **Fallback:** `DriversMapLeaflet.jsx` uses `lat ?? latitude` and `lng ?? longitude` as fallback.
- **Verdict:** `latitude`/`longitude` appear to be legacy. Consider migrating any remaining uses to `lat`/`lng` and eventually dropping `latitude`/`longitude`.

### 2.2 Clients Table: `billings` and `visits` (JSONB)

- **Usage:** Mapped in `mapClientFromDB` and persisted in `updateClient` / `addClient`.
- **Read/Write:** Used in `lib/actions.ts` for client profile load/save.
- **Verdict:** In use. No cleanup needed unless you confirm these features are deprecated.

### 2.3 Orders Table: `deliveryDistribution` (JSON)

- **Usage:** Set in process-weekly-orders, simulate-delivery-cycle, and read in various order-fetch flows. Displayed in `VendorDeliveryOrders.tsx`.
- **Verdict:** In use.

### 2.4 Orders Table: `proofOfDeliveryUrl`

- **Usage:** Heavily used for delivery proof, billing, completed deliveries. Also `proof_of_delivery_image` in `delivery_history`.
- **Verdict:** In use.

### 2.5 Order Tables: `vendorSelectionId` vs `upcomingVendorSelectionId` (upcoming_order_items)

- **Schema:** `upcoming_order_items` has both `vendor_selection_id` (-> order_vendor_selections) and `upcoming_vendor_selection_id` (-> upcoming_order_vendor_selections).
- **Note:** `vendor_selection_id` points to `order_vendor_selections` (orders table), while `upcoming_vendor_selection_id` points to `upcoming_order_vendor_selections`. Used for different flows.
- **Verdict:** Both in use for different contexts.

### 2.6 Delivery History: `proof_of_delivery_image`

- **Usage:** Used in `lib/actions.ts` for `getCompletedOrdersWithDeliveryProof` and similar.
- **Verdict:** In use (legacy field name; orders use `proof_of_delivery_url`).

---

## 3. Summary

- **Run:** `sql/cleanup_after_orders_deleted.sql` after deleting all orders.
- **Redundant fields to review:** `clients.latitude`, `clients.longitude` (prefer `lat`/`lng`).
- **Other fields checked:** In active use.
