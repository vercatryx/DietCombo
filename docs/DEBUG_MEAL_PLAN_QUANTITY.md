# Debug: Meal plan quantity discrepancy (admin vs client)

## Where the issue actually is: admin “top” vs client

- **Client portal (and client meal plan in admin)** shows **combined** data: **recurring** (default Food template) **+ per-date** (`meal_planner_custom_items`). So if you set Tuna Wrap to 1 or 2 **per date** in the meal planner, the client sees 1 or 2 for those dates.
- **Admin “top”** (Default Order Template → Food → the list of all menu items with +/-) shows **only the recurring source**: the default Food order template. It does **not** include per-date overrides from the meal planner. So it can show 0 for Tuna Wrap even when you set 2 in the meal planner for specific dates.

So the **admin page is not showing it correctly** when you expect it to reflect what you set in the meal planner: the “top” list is a different source (recurring only). What you set per date is in `meal_planner_custom_items` and is what the client (and the meal planner popup when you click a date) use.

---

## Where to check in the DB (manual verification)

### 1. Recurring / “admin top” quantities (default Food template)

- **Table:** `settings`
- **Row:** `key = 'default_order_template'`
- **Column:** `value` (JSON)

The JSON has e.g. `serviceType`, `vendorSelections` (array). For Food, `vendorSelections[0].items` is an object: `{ [menu_item_id]: quantity }`. So Tuna Wrap’s quantity in the “top” list is whatever is stored there for that menu item ID.

**Example (Supabase SQL editor or psql):**

```sql
SELECT key, value
FROM settings
WHERE key = 'default_order_template';
```

Inspect `value->'vendorSelections'->0->'items'` for each menu item ID (e.g. search for the Tuna Wrap menu item id and check its quantity).

### 2. Per-date quantities (what client sees for a given day)

- **Table:** `meal_planner_custom_items`
- **Columns:** `calendar_date`, `client_id`, `name`, `quantity`, `value`, `sort_order`
- **Default template:** `client_id IS NULL`. Client-specific overrides (if any): `client_id = '<client uuid>'`.

This is where the meal planner (admin “Meal planner” calendar → click a date → edit items) saves. The client portal and “combined” view use this for the chosen date.

**Example:**

```sql
-- All default-template rows for a date (what drives “combined” for that date)
SELECT id, name, quantity, value, calendar_date, client_id, sort_order
FROM meal_planner_custom_items
WHERE calendar_date = '2026-03-09'
  AND client_id IS NULL
ORDER BY sort_order;

-- Find Tuna Wrap (or any name) across dates
SELECT calendar_date, name, quantity, value
FROM meal_planner_custom_items
WHERE client_id IS NULL
  AND name ILIKE '%tuna%'
ORDER BY calendar_date, sort_order;
```

If you see `quantity = 1` or `2` here, that is what the client sees for that date. The admin “top” will still show 0 unless you also set Tuna Wrap in the default order template (settings) or we change the admin to show combined for a date.

---

## Optional fix applied (null quantity)

**Root cause (one possible case):** `getMealPlannerCustomItems` was using `row.quantity ?? 1`, so a row in `meal_planner_custom_items` with **null** quantity became **1** and could override recurring 0 (and scale to 2 with household size).

**Change:** In `lib/actions.ts`, `getMealPlannerCustomItems` now treats null/NaN quantity as **0**. Explicit 1 or 2 in the DB are unchanged.

---

## Problem (historical)

- **Admin section (top):** Alternate items / recurring show quantity **0** for e.g. Tuna Wrap.
- **Client view (any client, any day):** Same item shows quantity **2**.

## Why it happens

Two sources feed into “what you see for a day”:

1. **Recurring (admin “top”)**  
   From the default Food order template: `getRecurringItemsFromFoodTemplate()`.  
   This is what the admin sees for the recurring/alternate block → **0** for Tuna Wrap.

2. **Day-specific**  
   From `meal_planner_custom_items` for that date (`client_id` = null for default).  
   If there is a row for that date with the same item **name** and **quantity = 2**, the combined menu uses it.

**Merge rule** (in `getCombinedMenuItemsForDate`):

- For each item name: if the **day-specific** row has **quantity > 0**, that quantity is used.
- Otherwise the **recurring** quantity is used (e.g. 0).

So if Tuna Wrap has:

- Recurring: **0**
- Day-specific (in `meal_planner_custom_items` for that date): **2**

then the client (and admin when viewing “per day”) sees **2**. The admin “top” only shows recurring, so it stays **0**.

## Debug scripts

### 1. API (with dev server running)

```bash
# Start dev server first: npm run dev

# Default date 2026-03-09, search item "tuna"
curl -s "http://localhost:3000/api/debug/meal-plan?date=2026-03-09&item=tuna" | jq .

# Custom date and item
curl -s "http://localhost:3000/api/debug/meal-plan?date=2026-03-15&item=wrap" | jq .
```

Or use the helper script:

```bash
./scripts/debug-meal-plan-quantity.sh                    # date=2026-03-09, item=tuna
./scripts/debug-meal-plan-quantity.sh http://localhost:3000 2026-03-15 tuna
```

The response includes:

- `recurringItem`: quantity (and id/name) from the **recurring** list.
- `dayItem`: quantity (and id/name) from **meal_planner_custom_items** for that date (default template, `client_id` null).
- `combinedItem`: quantity (and id/name) in the **combined** menu for that date.
- `explanation`: short text saying why the combined quantity is what it is (day-specific vs recurring).

### 2. Inspect the database

To see why a day shows 2, check day-specific rows:

```sql
-- Rows for a given date (default template) that might override recurring
SELECT id, name, quantity, value, calendar_date, client_id
FROM meal_planner_custom_items
WHERE calendar_date = '2026-03-09'
  AND client_id IS NULL
  AND (name ILIKE '%tuna%' OR name ILIKE '%wrap%')
ORDER BY sort_order;
```

If you see `quantity = 2` here, that is why the client (and per-day view) show 2. To make it match the admin “top” (0):

- Set that row’s `quantity` to **0**, or
- Remove the day-specific row so the recurring quantity (0) is used.

## Summary

| Source              | Where it’s set              | What admin “top” uses | What client/per-day uses   |
|---------------------|-----------------------------|------------------------|----------------------------|
| Recurring           | Default Food order template | Yes (shows 0)          | Only if no day override    |
| Day-specific        | `meal_planner_custom_items` | No                     | Yes when qty > 0 (shows 2) |

So: **admin "top"** reads only from `settings`. **Client (and meal planner popup)** use `settings` + `meal_planner_custom_items` per date. To verify, check both tables as in the "Where to check in the DB" section above.
