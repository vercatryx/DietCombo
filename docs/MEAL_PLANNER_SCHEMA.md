# Schema: Meal Planner (Tables and Behavior)

This document describes the **exact schema** for the **Meal Planner** feature: the tables that store template items per calendar date and per-delivery-date orders for Food clients. Meal planner is **separate** from `clients.upcoming_order` and from the `upcoming_orders` table.

- **Scope**: `meal_planner_custom_items`, `meal_planner_orders`, `meal_planner_order_items`.
- **Behavior on sync**: Admin default template (custom items with `client_id` null) and client overrides drive **sync** into `meal_planner_orders` and `meal_planner_order_items`. When a client has edited quantities (`user_modified = true`), sync preserves their quantities and only adds/removes items to match the template.
- **Service context**: Meal planner is used for **Food** (and optionally Meal) clients; equipment and other service types do not use these tables.

---

## Tables and allowed shapes

---

### 1. `meal_planner_custom_items`

Template items per **calendar date**. Used by the admin default order template (meal planner calendar) and optionally for client-specific overrides. One row = one named item on one date for one scope (default or client).

| Column           | Type       | Description |
|------------------|------------|-------------|
| `id`             | `string`   | UUID, primary key. |
| `client_id`      | `string?`  | **Null** = default template (admin). Non-null = client-specific override for that date. |
| `calendar_date`  | `date`     | The calendar date (YYYY-MM-DD). |
| `name`           | `string`   | Display name of the item. |
| `quantity`       | `integer`  | Default quantity (≥ 1). |
| `price`          | `decimal?` | Optional price per unit. |
| `value`          | `decimal?` | Optional total value. |
| `sort_order`     | `integer?` | Order when listing items (default 0). |
| `expiration_date`| `date?`    | Optional; can be used to hide item after a date. |
| `created_at`     | `timestamp`| Set on insert. |
| `updated_at`     | `timestamp`| Set on insert/update. |

**Merge rule**: For a given `calendar_date`, effective items are computed by **name**: default rows (`client_id` null) and client rows are merged; **client row overrides default** for that name (quantity and price). So client preferences are preserved when the admin updates the default template.

**Example (default template for one date):**

| id   | client_id | calendar_date | name        | quantity | price | sort_order |
|------|-----------|---------------|-------------|----------|-------|------------|
| uuid1| null      | 2025-02-10    | Soup        | 2        | 5.00  | 0          |
| uuid2| null      | 2025-02-10    | Sandwich    | 1        | 8.50  | 1          |

**Example (client override for same date):**

| id   | client_id | calendar_date | name   | quantity | price | sort_order |
|------|-----------|---------------|--------|----------|-------|------------|
| uuid3| client-1  | 2025-02-10    | Soup   | 3        | 5.00  | 0          |

Effective items for `client-1` on 2025-02-10: Soup (qty 3), Sandwich (qty 1).

---

### 2. `meal_planner_orders`

One row per **client** per **scheduled delivery date**. Represents “this client’s meal plan order for this date.” Line items are stored in `meal_planner_order_items`; the `items` JSON column is **not** used by current application code (reserved for future use).

| Column                    | Type       | Description |
|---------------------------|------------|-------------|
| `id`                      | `string`   | UUID, primary key. |
| `client_id`               | `string`   | Client this order belongs to. |
| `case_id`                 | `string?`  | Optional; can match the client’s Food upcoming order case. |
| `status`                  | `string`   | e.g. `"draft"`, `"scheduled"`. Default `"draft"`. |
| `scheduled_delivery_date` | `date?`    | Delivery date (YYYY-MM-DD). |
| `delivery_day`            | `string?`  | Day name (e.g. `"Monday"`) derived from date. |
| `total_value`             | `decimal?` | Optional total order value. |
| `total_items`             | `integer?` | Sum of line-item quantities. |
| `items`                   | `json?`    | **Reserved.** Line items are stored in `meal_planner_order_items`; do not rely on this for reads/writes. |
| `notes`                   | `string?`  | Optional order notes. |
| `processed_order_id`      | `string?`  | When processed, link to `orders.id`. |
| `processed_at`            | `timestamp?` | When the order was processed. |
| `user_modified`           | `boolean` | If true, client has changed quantities; sync must preserve their values for existing items. Default false. |
| `created_at`              | `timestamp`| Set on insert. |
| `updated_at`              | `timestamp`| Set on insert/update. |

**Example (single order row):**

- `id`: `"ord-uuid-1"`
- `client_id`: `"client-1"`
- `case_id`: `"CASE-789"`
- `status`: `"scheduled"`
- `scheduled_delivery_date`: `2025-02-10`
- `delivery_day`: `"Monday"`
- `total_items`: 4
- `user_modified`: false

---

### 3. `meal_planner_order_items`

Line items for each `meal_planner_orders` row. Each row is one item (by menu item, meal item, or custom name) with quantity and optional price. **This is the canonical source** for “what’s on the order” for a given date; do not use `meal_planner_orders.items` for that.

| Column                   | Type       | Description |
|--------------------------|------------|-------------|
| `id`                     | `string`   | UUID, primary key. |
| `meal_planner_order_id`  | `string`   | Parent `meal_planner_orders.id`. |
| `meal_type`              | `string`   | e.g. `"Breakfast"`, `"Lunch"`, `"Dinner"`. (Current sync often uses `"Lunch"` for template-driven items.) |
| `menu_item_id`           | `string?`  | Optional; links to menu item catalog. |
| `meal_item_id`           | `string?`  | Optional; links to breakfast_items (or other meal item catalog). |
| `quantity`               | `integer`  | Quantity (≥ 1). Default 1. |
| `notes`                  | `string?`  | Optional per-item notes. |
| `custom_name`            | `string?`  | When not using catalog: display name (used for template items from `meal_planner_custom_items`). |
| `custom_price`           | `decimal?` | Optional price when using `custom_name`. |
| `sort_order`             | `integer?` | Order within the order (default 0). |
| `created_at`             | `timestamp`| Set on insert. |
| `updated_at`             | `timestamp`| Set on insert/update. |

At least one of `menu_item_id`, `meal_item_id`, or `custom_name` identifies the item. For admin-template–driven items, sync typically uses `custom_name` and `custom_price` with `menu_item_id` and `meal_item_id` null.

**Example (two items for one order):**

| id    | meal_planner_order_id | meal_type | menu_item_id | meal_item_id | quantity | custom_name | custom_price | sort_order |
|-------|------------------------|-----------|--------------|--------------|----------|-------------|--------------|------------|
| item-1| ord-uuid-1             | Lunch     | null         | null         | 2        | Soup        | 5.00         | 0          |
| item-2| ord-uuid-1             | Lunch     | null         | null         | 1        | Sandwich    | 8.50         | 1          |

---

## Data flow and sync rules

1. **Admin saves default template (calendar date)**  
   - Write to `meal_planner_custom_items` with `client_id` null for that `calendar_date` (replace existing default items for that date).  
   - Sync: for that date, create or update `meal_planner_orders` and `meal_planner_order_items` for all Food clients (e.g. via `syncMealPlannerCustomItemsToOrders(calendarDate, null)`).  
   - Effective items per client = merge by name: default + client overrides; client wins.

2. **Admin or client saves client-specific items for a date**  
   - Write to `meal_planner_custom_items` with `client_id` set.  
   - Sync that date for that client (or all clients if default changed).  
   - Same merge rule: client row overrides default for that name.

3. **Client changes quantities in Saved Meal Plan (UI)**  
   - Update `meal_planner_order_items.quantity` for the affected item rows.  
   - Update `meal_planner_orders.total_items` and set `meal_planner_orders.user_modified = true`.  
   - Do **not** overwrite client quantities when syncing from template; only add new template items and remove items that no longer exist in the template; preserve client quantity for items that still exist.

4. **New client or first load (no orders for client)**  
   - Seed from default template: for today and future dates in `meal_planner_custom_items` (default only), create `meal_planner_orders` and `meal_planner_order_items` for that client (e.g. `ensureMealPlannerOrdersFromDefaultTemplate`).

5. **Case linking**  
   - When creating/updating `meal_planner_orders`, `case_id` can be set from the client’s Food upcoming order so meal planner orders align with the same case.

---

## Summary

| Table                        | Purpose |
|-----------------------------|---------|
| **meal_planner_custom_items** | Template items per calendar date: default (`client_id` null) and client overrides. Merged by name (client overrides default). |
| **meal_planner_orders**       | One row per client per scheduled delivery date. Status, totals, `user_modified`, link to `orders` when processed. Line items live in `meal_planner_order_items`; `items` JSON unused. |
| **meal_planner_order_items**  | Canonical line items: `meal_type`, `menu_item_id` / `meal_item_id` / `custom_name`, `quantity`, `custom_price`, `sort_order`. |

- **Where**: Dedicated meal planner tables; **not** `clients.upcoming_order` and **not** `upcoming_orders`.  
- **Sync**: Template and overrides in `meal_planner_custom_items` drive sync to `meal_planner_orders` and `meal_planner_order_items`; when `user_modified` is true, client quantities are preserved.  
- **Service**: Used for Food (and optionally Meal) clients; equipment and other types use separate flows.

Equipment orders and Boxes/Custom/Food upcoming-order column storage are **not** part of this schema; see `UPCOMING_ORDER_SCHEMA.md` for `clients.upcoming_order`.
