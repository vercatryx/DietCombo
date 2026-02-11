# Create Expired Meal Planner Orders API – What Happens

This document describes what happens when you call:

**`POST /api/create-expired-meal-planner-orders?date=YYYY-MM-DD`**

Example: `POST http://localhost:3000/api/create-expired-meal-planner-orders?date=2026-02-09`

The `date` parameter is the **expiration date** (in EST) for meal planner items. When omitted, the API uses **today in app timezone (EST)**.

---

## Alignment with Data Schema

The API is **in sync** with the data model in [HOW_FOOD_AND_MEAL_PLANNER_ARE_SAVED_BY_CLIENT.md](./HOW_FOOD_AND_MEAL_PLANNER_ARE_SAVED_BY_CLIENT.md):

| Source | Doc | API usage |
|--------|-----|-----------|
| **Food (vendor/menu)** | `clients.upcoming_order` is single source of truth; default from `settings` (key `default_order_template`) | Uses `client.activeOrder` (from `clients.upcoming_order`). If missing/empty → uses default from `getDefaultOrderTemplate('Food')`. |
| **Meal planner** | `clients.meal_planner_data` is single source of truth; default from `meal_planner_custom_items` where `client_id IS NULL` | Default items from `meal_planner_custom_items` where `client_id IS NULL` for the expired dates. Client overrides from `client.mealPlannerData` (i.e. `clients.meal_planner_data`). Merged by item **name** (client wins). |
| **Created orders** | N/A (doc focuses on where client data is stored) | Writes **immutable snapshots** to `orders`, `order_vendor_selections`, `order_items` (menu items + custom meal planner items with `custom_name` / `custom_price`, `menu_item_id` null). |

---

## High-Level Flow

1. **Resolve expiration date**  
   From `?date=YYYY-MM-DD` or today (EST). Validate format.

2. **Find expired meal planner items (default template only)**  
   Query `meal_planner_custom_items` where `client_id IS NULL` and `expiration_date = date`.  
   - If **none**: return success, `ordersCreated: 0`, and optionally `availableExpirationDates`.  
   - Else: collect the distinct **calendar_date** values (the delivery dates that have items expiring on that day).

3. **Load reference data**  
   - All clients (`getClients()` → includes `upcoming_order` and `meal_planner_data`).  
   - Default food template (`getDefaultOrderTemplate('Food')`).  
   - Menu items, default vendor.

4. **Filter clients**  
   Only clients that:
   - Have `serviceType === 'Food'` (or string includes `'Food'`), and  
   - Are **not** paused (`paused !== true`), and  
   - Have delivery enabled (`delivery !== false`).

5. **Build meal plan per client and date**  
   - Default items per calendar date from `meal_planner_custom_items` (client_id IS NULL).  
   - Client overrides from `clients.meal_planner_data` for those same dates.  
   - Merge by **item name**: default first, then client data (client overwrites same name).

6. **Skip existing orders**  
   For each (client, expired calendar date), if an order already exists in `orders` for that `client_id`, `scheduled_delivery_date`, and `service_type = 'Food'`, skip (no duplicate order).

7. **Create orders**  
   For each (client, expired date) not skipped: build one order from food (vendor selections) + merged meal plan items; insert into `orders`, `order_vendor_selections`, `order_items` (menu items and custom items). Case ID from `clients.upcoming_order.caseId` or `clients.case_id_external`.

---

## What Happens for Each Client (By Situation)

### 1. No items expire on the given date

- **Who:** N/A (global).
- **What happens:** API returns `200`, `ordersCreated: 0`, message like *"No meal planner items expire on YYYY-MM-DD"*. May include `availableExpirationDates` from the default template.
- **No orders created; no clients processed for order creation.**

---

### 2. Items expire on the date, but client is not a “Food” client

- **Who:** Clients with `serviceType` other than Food (e.g. Produce, Boxes only).
- **What happens:** They are excluded before any per-client order logic. No order is created for them.
- **Result:** No order for this client.

---

### 3. Client is paused or delivery disabled

- **Who:** Food clients with `paused === true` or `delivery === false`.
- **What happens:** Filtered out with other non–Food clients. No order is created.
- **Result:** No order for this client.

---

### 4. Food client, delivery enabled, not paused – but no food template

- **Who:** Food client with no usable food order:  
  - `clients.upcoming_order` is null/empty or has no `vendorSelections` and no `deliveryDayOrders`, **and**  
  - Default food template from settings is also empty or has no vendor/delivery-day structure.
- **What happens:** Client is skipped. One of the `skippedReasons` will be:  
  *"Client &lt;id&gt; (&lt;name&gt;): No food order template available"*.
- **Result:** No order created for this client.

---

### 5. Food client has food template but no vendor selections for the delivery day

- **Who:** Client (or default) has `deliveryDayOrders` or `vendorSelections`, but for the specific delivery day (derived from the expired calendar date) there are no vendor selections (or fallback to first day also has none).
- **What happens:** Skipped. `skippedReasons`: *"Client &lt;id&gt; (&lt;name&gt;): No vendor selections found"*.
- **Result:** No order created for this client for that date.

---

### 6. Food client already has an order for that date

- **Who:** There is already a row in `orders` with this `client_id`, `scheduled_delivery_date` = one of the expired calendar dates, and `service_type = 'Food'`.
- **What happens:** Skipped for that (client, date). `skippedReasons`: *"Client &lt;id&gt; (&lt;name&gt;): Order already exists for &lt;date&gt;"*.
- **Result:** No new order for that client/date (idempotent).

---

### 7. Food client, has food template, no existing order – order created

- **Who:** Food client, not paused, delivery enabled; has (or gets from default) a food template with vendor selections for the delivery day; no existing order for that client and expired date.
- **What happens:**  
  - **Food:** From `clients.upcoming_order` if present and non-empty (vendor/delivery structure); otherwise default template.  
  - **Meal plan:** For each expired calendar date, default items from `meal_planner_custom_items` (client_id IS NULL) merged with `clients.meal_planner_data` for that date (client overrides by item name).  
  - One order per (client, expired date) is inserted: `orders`, `order_vendor_selections`, `order_items` (menu items from food; meal planner items as custom rows with `custom_name`, `custom_price`, `menu_item_id` null).  
  - `case_id` from `upcoming_order.caseId` or `case_id_external`.
- **Result:** One (or more) orders created; they are immutable snapshots and do not change when client or default data change later.

---

## Summary Table by Client Situation

| Situation | Order created? | Note |
|-----------|----------------|------|
| No items expire on `?date` | No (global) | Success, 0 orders; may return available expiration dates. |
| Not a Food client | No | Excluded by filter. |
| Paused or delivery disabled | No | Excluded by filter. |
| No food template (client + default empty) | No | Skipped; reason in `skippedReasons`. |
| No vendor selections for delivery day | No | Skipped; reason in `skippedReasons`. |
| Order already exists for (client, date) | No | Skipped; reason in `skippedReasons`. |
| Food client, has template, no existing order | **Yes** | One order per expired calendar date; food from `upcoming_order` or default; meal plan from default + `meal_planner_data` (client wins by name). |

---

## Response Shape (Success)

- `success: true`
- `message`: string
- `ordersCreated`: number
- `clientsProcessed`: number (all Food, not paused, delivery enabled)
- `expirationDate`: string (YYYY-MM-DD)
- `expiredDates`: string[] (calendar dates that had items expiring on `expirationDate`)
- `expiredItemsCount`: number (from default template)
- `errors`: string[] (optional)
- `skippedReasons`: string[] (optional) – why some (client, date) pairs were not created

---

## Calling the API

- **Method:** **POST** (GET is not implemented).
- **Query:** `date=YYYY-MM-DD` (optional; default = today in EST).
- Example with `curl`:
  ```bash
  curl -X POST "http://localhost:3000/api/create-expired-meal-planner-orders?date=2026-02-09"
  ```

---

## Related

- [HOW_FOOD_AND_MEAL_PLANNER_ARE_SAVED_BY_CLIENT.md](./HOW_FOOD_AND_MEAL_PLANNER_ARE_SAVED_BY_CLIENT.md) – Where food and meal planner data are stored and how defaults work.
- [HOW_CLIENT_ORDER_DATA_IS_SAVED.md](./HOW_CLIENT_ORDER_DATA_IS_SAVED.md) – Overview of order data storage.
- Implementation: `app/api/create-expired-meal-planner-orders/route.ts`.
