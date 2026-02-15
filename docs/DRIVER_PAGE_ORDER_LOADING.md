# How the driver detail page loads orders and order numbers

## Data flow

1. **Driver detail page** (`app/drivers/[id]/page.tsx`)
   - When user has a **date** selected: calls `fetchDriversPageData(selectedDate)` → **route API**.
   - When no date or driver not in route list: calls `fetchDriver(id)` + `fetchStops(date)` → **mobile stops API**.

2. **Route API path** (date selected)
   - `GET /api/route/routes?delivery_date=YYYY-MM-DD&light=1`
   - Returns `{ routes, unrouted }`. Each route has `stops` (hydrated stop objects).
   - `fetchDriversPageData` in `lib/api.js` builds:
     - `drivers` from `routes` (id, name, color, stopIds from `r.stops.map(s => s.id)`).
     - `allStops = [...routes.flatMap(r => r.stops), ...unrouted]`.
   - Driver page then: `stopsById = Map(allStops by id)`, `orderedServer = stopIds.map(id => stopsById.get(id))`, `setStops(orderedServer)`.
   - So **stops on the driver page are the same objects returned by the route API** (including `orderNumber`, `orderId`, etc.).

3. **Mobile API path** (no date or fallback)
   - `GET /api/mobile/stops?delivery_date=...` (optional driverId).
   - Returns array of stop objects with `orderNumber`, `orderId`, etc.

4. **Where order number comes from (same source as /orders page)**
   - **Primary when a delivery date is set:** Direct query to `orders` for that date:  
     `orders.scheduled_delivery_date = delivery_date` and `orders.client_id IN (stop client_ids)`.  
     Each stop’s `orderNumber` is set from this when `stop.client_id` and `stop.delivery_date` match. This is the **same table and logic** as the orders list (`getOrdersPaginatedBilling` uses `orders` only).
   - **Fallbacks:** Orders are also loaded by `order_id` (prefer `orders` then `upcoming_orders`) and by `client_id` / `client_id|delivery_date`; client/date maps are filled from `orders` first, then gaps from `upcoming_orders`.  
   - Final `orderNumber` for a stop: resolved order’s `order_number`, or the direct orders-by-date lookup when the stop’s date matches the selected delivery date.

## Why "Order #: N/A" can still appear

- No row in `orders` for that `client_id` and `scheduled_delivery_date` (e.g. order only in `upcoming_orders` or not yet created).
- Stop’s `delivery_date` is null or doesn’t match the selected date, so the direct orders-by-date lookup doesn’t apply and fallback maps don’t have a matching order with `order_number`.

## Fixes applied

- **Direct orders-by-date:** When `delivery_date` is set, both route API and mobile stops API query `orders` for `scheduled_delivery_date = delivery_date` and `client_id IN (stops’ client_ids)`, and set each stop’s `orderNumber` from that (same source as /orders page). No DB function change required.
- When building client and client+date maps, fill from `orders` first, then fill gaps from `upcoming_orders`.
- When resolving by `order_id`, prefer `orders` table then fill gaps from `upcoming_orders`.
- Driver UI reads both `s.orderNumber` and `s.order_number`.

## Verify order numbers

With the dev server running:

```bash
npm run verify-driver-order-numbers
```

Optional: `DELIVERY_DATE=YYYY-MM-DD` to filter by date (omit to get all routes/stops).  
If all stops show “MISSING order number”, ensure `order_number` is populated in your DB (e.g. run `sql/update-upcoming-orders-order-number.sql` or your backfill).
