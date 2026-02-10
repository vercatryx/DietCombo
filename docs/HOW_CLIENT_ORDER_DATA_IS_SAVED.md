# How Client Order Data Is Saved

This document describes where and how **regular Food items** and **meal planner items** are persisted for individual clients.

**Single source of truth:** All client order data is stored only in the `clients` table. No sync to `upcoming_orders`, `meal_planner_orders`, or related tables.

---

## 1. Regular Food Items (Vendor / Menu Selections)

### What It Is

Food orders from the client profile: vendor selections, delivery days, and menu items (e.g. chicken, rice) chosen per delivery day. This is the "Current Order Request" / delivery-day food ordering flow.

### Where It's Saved

| Location | Purpose |
|----------|---------|
| **`clients.upcoming_order`** (JSONB) | **Single source of truth.** Holds the full active order snapshot: `serviceType`, `caseId`, `deliveryDayOrders`, `vendorSelections`, etc. Exactly how many of each item—not just changes from default. |

**No longer used:** `upcoming_orders`, `upcoming_order_vendor_selections`, `upcoming_order_items` tables are not written to or read from for client order data.

### Save Flow

1. **User saves** in Client Profile (Food service).
2. **`saveClientFoodOrder(clientId, data, fullActiveOrder)`** runs:
   - Uses the provided `fullActiveOrder` (full snapshot of current state).
   - Writes to **`clients.upcoming_order`** via `UPDATE clients SET upcoming_order = activeOrder WHERE id = clientId`.
3. **`getUpcomingOrderForClient(clientId)`** reads from `clients.upcoming_order` (via `getClient`).

### JSON Structure (in `clients.upcoming_order`)

```json
{
  "serviceType": "Food",
  "caseId": "CASE-123",
  "deliveryDayOrders": {
    "Thursday_Food": {
      "vendorSelections": [
        {
          "vendorId": "vendor-uuid",
          "items": { "menu-item-id-1": 2, "menu-item-id-2": 1 }
        }
      ]
    }
  }
}
```

---

## 2. Meal Planner Items (Saved Meal Plan for the Month)

### What It Is

Per-date meal plan items (e.g. Soup, Sandwich) with quantities, shown in the "Saved Meal Plan for the Month" section of the client profile.

### Where It's Saved

| Location | Purpose |
|----------|---------|
| **`clients.meal_planner_data`** (JSONB) | **Single source of truth.** Client-specific meal plan as JSON. Full snapshot per date. |

**Admin default template only:** `meal_planner_custom_items` with `client_id IS NULL` is still used for the admin calendar default (expiration dates, etc.). Client data is **not** stored there.

### JSON Structure (in `clients.meal_planner_data`)

```json
[
  {
    "scheduledDeliveryDate": "2025-02-15",
    "items": [
      { "id": "uuid", "name": "Chicken", "quantity": 2, "value": 5.00 }
    ]
  }
]
```

### Save Rules

1. **Merge by date:** When saving one day, other days are preserved (add/update only that date).
2. **Clear old entries:** On every save, remove entries where `scheduledDeliveryDate < today - 7 days`.
3. **Full snapshot:** Save exact quantities for each item, not deltas from default.

### Save Flow

1. **Single-date save** (quantity change in Saved Meal Plan):
   - **`saveClientMealPlannerData(clientId, date, items)`** → merges that date into existing `meal_planner_data`, clears entries older than 7 days.

2. **Full save** (saving client profile with meal plan changes):
   - **`saveClientMealPlannerDataFull(clientId, orders)`** → replaces `meal_planner_data` with full snapshot of all orders, clears entries older than 7 days.

3. **Read:** **`getClientMealPlannerData(clientId)`** → returns data from `clients.meal_planner_data`.

---

## 3. Summary Table

| Data Type | Storage | Entry Points |
|-----------|---------|--------------|
| **Food items** | `clients.upcoming_order` (JSONB) | `saveClientFoodOrder`, `getUpcomingOrderForClient` |
| **Meal planner** | `clients.meal_planner_data` (JSONB) | `saveClientMealPlannerData`, `saveClientMealPlannerDataFull`, `getClientMealPlannerData` |

---

## 4. Related Documentation

- **MEAL_PLANNER_SCHEMA.md** – Schema for `meal_planner_custom_items` (admin default only).
- **sql/add_meal_planner_data_to_clients.sql** – SQL to add the `meal_planner_data` column.
