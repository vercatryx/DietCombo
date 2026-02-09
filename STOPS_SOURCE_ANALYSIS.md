# Stops Table: Orders vs Upcoming Orders Source Analysis

## Schema

The `stops` table has an `order_id` column that can reference **either**:
- `orders.id` (confirmed/active orders)
- `upcoming_orders.id` (scheduled future orders)

There is **no foreign key constraint**—the same `order_id` column flexibly points to either table.

---

## How to Distinguish Them

For any stop with a non-null `order_id`:
- If `order_id` exists in `orders` table → stop was created from an **order**
- If `order_id` exists in `upcoming_orders` table → stop was created from an **upcoming order**
- If `order_id` exists in neither → orphaned (e.g. order was deleted or ID is invalid)

**Run the analysis script** (with your `.env.local` loaded):
```bash
npx tsx scripts/analyze-stops-by-source.ts
```

---

## Where Stops Are Created

### 1. **process-weekly-orders** (`app/api/process-weekly-orders/route.ts`)

Creates stops via `createOrUpdateStopForOrder()`.

| Source | When | order_id points to |
|--------|------|--------------------|
| **Upcoming orders** | When transferring upcoming orders to `orders` (lines ~552, ~1093) | `upcoming_orders.id` |
| **Orders** | When processing orders from `orders` table (line ~1101) | `orders.id` |

**Logic in `createOrUpdateStopForOrder`:**
- Tries to resolve an upcoming order by `orderId`, `client_id`, and `scheduled_delivery_date`
- Uses `finalOrderId = upcomingOrderId || orderId`
- Sets `stop.order_id = finalOrderId` (upcoming order ID when found, else the passed order ID)
- Comment: "Creating/updating stop with order_id=... (upcoming order)"

So **process-weekly-orders** can create stops with:
- `order_id` → `upcoming_orders.id` (when processing upcoming orders)
- `order_id` → `orders.id` (when processing from orders table)

---

### 2. **Routes API** (`app/api/route/routes/route.ts`)

Creates missing stops on GET when clients have orders but no corresponding stop.

**Data sources for `clientDeliveryDates`:**

| Source | Lines | orderId used |
|--------|-------|--------------|
| **orders** | 486–490, 557–575 | `order.id` (from `orders` table) |
| **upcoming_orders** | 492–499, 582–651 | `order.id` (from `upcoming_orders` table) |

**Stop creation (lines 764–804):**
- Uses `dateInfo.orderId` from `clientDeliveryDates`
- For orders: `orderId` = `orders.id`
- For upcoming orders: `orderId` = `upcoming_orders.id` (line 650: "order_id will reference the upcoming_order.id")

So the **Routes API** can create stops with:
- `order_id` → `orders.id`
- `order_id` → `upcoming_orders.id`

---

### 3. **Route Cleanup** (`app/api/route/cleanup/route.ts`)

Same pattern as the Routes API: builds `clientDeliveryDates` from both `orders` and `upcoming_orders`, then creates stops using each record’s `order.id`.

---

## Summary Table

| Creator | order_id → orders | order_id → upcoming_orders |
|---------|-------------------|----------------------------|
| **process-weekly-orders** | ✓ (when processing orders) | ✓ (when processing upcoming orders) |
| **Routes API** (GET) | ✓ | ✓ |
| **Route Cleanup** (POST) | ✓ | ✓ |

---

## Distinguishing in the Database

Run:

```sql
-- Stops from orders
SELECT s.* FROM stops s
INNER JOIN orders o ON s.order_id = o.id;

-- Stops from upcoming_orders
SELECT s.* FROM stops s
INNER JOIN upcoming_orders uo ON s.order_id = uo.id;

-- Stops with order_id not in either (orphaned)
SELECT s.* FROM stops s
WHERE s.order_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = s.order_id)
  AND NOT EXISTS (SELECT 1 FROM upcoming_orders uo WHERE uo.id = s.order_id);
```

Or use the provided script: `npx tsx scripts/analyze-stops-by-source.ts`.
