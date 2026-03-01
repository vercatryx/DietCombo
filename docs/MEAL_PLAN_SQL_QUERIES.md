# Meal plan: SQL to see top vs bottom in the DB

- **Top items:** Recurring — same items and default amounts every day. Client can change per day in the portal.
- **Bottom items:** Day-specific — only show on certain days. Client can change; we use default if their saved data for that day is empty.
- **One place for all client saves:** `clients.meal_planner_data` (all days for that client).

---

## 1. Top (recurring) — default items and quantities (same every day)

Lives in **`settings`**, not per client. This is the default that repeats every day until the client overrides it.

```sql
-- Raw JSON (one row)
SELECT key, value
FROM settings
WHERE key = 'default_order_template';
```

The **value** is a JSON object keyed by service type (e.g. `Food`). The Food template has **`vendorSelections`** (array): each element is one vendor’s `items` (id → quantity).  
With one vendor, items are in `vendorSelections[0].items` (or `vendor_selections` if snake_case). Some templates use **`deliveryDayOrders`** (e.g. `Monday.vendorSelections[0].items`) instead; if you only see a few items above, try the deliveryDayOrders query below.  
*(`value` may be stored as `text`, so cast to `jsonb` before using `->`.)*  
Legacy format (no `'Food'` key): `value::jsonb->'vendorSelections'->0->'items'`.

**Recurring items from top-level vendorSelections** (one vendor; try both camelCase and snake_case):

```sql
SELECT key,
       jsonb_pretty(
         COALESCE(
           value::jsonb->'Food'->'vendorSelections'->0->'items',
           value::jsonb->'Food'->'vendor_selections'->0->'items'
         )
       ) AS recurring_items_quantity_by_id
FROM settings
WHERE key = 'default_order_template';
```

**If you only see a few items**, the template may store them in **deliveryDayOrders** (per day). Use a day key (e.g. `Monday`) that exists in your template:

```sql
SELECT jsonb_pretty(
         COALESCE(
           value::jsonb->'Food'->'deliveryDayOrders'->'Monday'->'vendorSelections'->0->'items',
           value::jsonb->'Food'->'delivery_day_orders'->'Monday'->'vendor_selections'->0->'items'
         )
       ) AS recurring_items_from_Monday
FROM settings
WHERE key = 'default_order_template';
```

**All recurring items** (all vendors merged; quantities summed if same id appears in multiple vendors):

```sql
-- Recurring (top) default: all item ids and quantities from all vendor selections (Food)
WITH s AS (
  SELECT value::jsonb AS v FROM settings WHERE key = 'default_order_template' LIMIT 1
),
vs AS (
  SELECT elem FROM s, jsonb_array_elements(COALESCE(s.v->'Food'->'vendorSelections', s.v->'Food'->'vendor_selections', '[]'::jsonb)) AS elem
),
items_flat AS (
  SELECT e.key AS item_id, (e.value)::int AS qty
  FROM vs, jsonb_each(vs.elem->'items') AS e
),
aggregated AS (
  SELECT item_id, sum(qty) AS qty FROM items_flat GROUP BY item_id
)
SELECT jsonb_pretty(jsonb_object_agg(item_id, qty)) AS recurring_items_quantity_by_id FROM aggregated;
```

If you have a `menu_items` table with `id` and `name`, you can expand to id + name + quantity. Use the same “all vendors” CTE so all items are included:

```sql
WITH s AS (
  SELECT value::jsonb AS v FROM settings WHERE key = 'default_order_template' LIMIT 1
),
vs AS (
  SELECT elem FROM s, jsonb_array_elements(COALESCE(s.v->'Food'->'vendorSelections', s.v->'Food'->'vendor_selections', '[]'::jsonb)) AS elem
),
items_flat AS (
  SELECT e.key AS item_id, sum((e.value)::int) AS qty
  FROM vs, jsonb_each(vs.elem->'items') AS e
  GROUP BY e.key
)
SELECT jsonb_object_agg(mi.name, if.qty) AS recurring_item_names_and_quantities
FROM items_flat if
JOIN menu_items mi ON mi.id::text = if.item_id;
```

(Adjust `menu_items` and `id` type if your schema differs.)

---

## 2. Bottom (day-specific) — which items show on which days (default)

Admin-defined “day-specific” defaults: **`meal_planner_custom_items`** with `client_id IS NULL`.  
One row per (calendar_date, item) = which items appear on which days. If the app uses this for “bottom” defaults, this is where they live.

```sql
-- Day-specific (bottom) default: which items on which days (client_id = null)
SELECT calendar_date,
       name,
       quantity,
       value,
       sort_order
FROM meal_planner_custom_items
WHERE client_id IS NULL
ORDER BY calendar_date, sort_order;
```

```sql
-- Same, but only future dates and one item name pattern
SELECT calendar_date, name, quantity, value
FROM meal_planner_custom_items
WHERE client_id IS NULL
  AND calendar_date >= CURRENT_DATE
  AND name ILIKE '%tuna%'
ORDER BY calendar_date, sort_order;
```

---

## 3. Client’s saved data (all days) — top + bottom together

Single column: **`clients.meal_planner_data`**. Holds **all** saved days for that client (both recurring overrides and day-specific overrides). Structure: array of `{ scheduledDeliveryDate, items: [ { id, name, quantity, value? } ] }`.

```sql
-- One client: full meal planner blob (all days)
SELECT id,
       full_name,
       meal_planner_data
FROM clients
WHERE id = 'YOUR_CLIENT_UUID';
```

```sql
-- One client: one row per date with that date’s items (expanded)
SELECT c.id,
       c.full_name,
       ord.scheduled_delivery_date,
       ord.items
FROM clients c,
     jsonb_to_recordset(
         COALESCE(c.meal_planner_data, '[]'::jsonb)
     ) AS ord(scheduled_delivery_date text, items jsonb)
WHERE c.id = 'YOUR_CLIENT_UUID'
ORDER BY ord.scheduled_delivery_date;
```

```sql
-- One client: one row per date per item (name + quantity)
SELECT c.id,
       c.full_name,
       ord.scheduled_delivery_date,
       itm->>'name'   AS item_name,
       (itm->>'quantity')::int AS quantity
FROM clients c,
     jsonb_to_recordset(COALESCE(c.meal_planner_data, '[]'::jsonb)) AS ord(scheduled_delivery_date text, items jsonb),
     jsonb_array_elements(ord.items) AS itm
WHERE c.id = 'YOUR_CLIENT_UUID'
ORDER BY ord.scheduled_delivery_date, itm->>'name';
```

In the app, “top” vs “bottom” for a given date is determined by **name**: items whose names match the recurring list (from settings) are treated as top; the rest as bottom. The DB does not store “top” and “bottom” in separate columns.

---

## Summary

| Part            | Where in DB                         | What it is |
|-----------------|-------------------------------------|------------|
| Top (recurring) | `settings` (key `default_order_template`) | Default items and quantities, same every day. |
| Bottom (day-specific) | `meal_planner_custom_items` (client_id NULL) | Default “which items on which days” (if used). |
| Client saves    | `clients.meal_planner_data`         | All days for that client; each day has one list (top + bottom combined by name). |
