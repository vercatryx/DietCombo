# How Food and Meal Planner Info Are Saved by Client (with Defaults)

This document describes **where** and **how** client food orders and meal planner data are stored, and **how they work by default** (when a client has no saved data yet).

**Single source of truth:** All client order data lives in the `clients` table. Food in `clients.upcoming_order`, meal planner in `clients.meal_planner_data`. No separate sync to `upcoming_orders` or `meal_planner_orders` for *storing* client choices—those tables are used for downstream order processing.

---

## 1. Food (Vendor / Menu Selections)

### What It Is

The client’s **current food order**: delivery days, vendor choices, and menu items (e.g. chicken, rice) per delivery day. Shown as “Current Order Request” / delivery-day food ordering in the client profile.

### Where It’s Saved

| Location | Purpose |
|----------|---------|
| **`clients.upcoming_order`** (JSONB) | **Single source of truth.** Full active order: `serviceType`, `caseId`, `deliveryDayOrders`, `vendorSelections`, etc. Stored as exact quantities (full snapshot), not deltas. |

**Not used for client order storage:** `upcoming_orders`, `upcoming_order_vendor_selections`, `upcoming_order_items` are not the source when loading/saving the client’s food order; they may be synced *from* `clients.upcoming_order` for backward compatibility or order processing.

### How It Works by Default

1. **Default template**  
   The admin default food menu is stored in **`settings`** with key **`default_order_template`**. It can be keyed by service type (e.g. `Food`, `Produce`).  
   - **Read:** `getDefaultOrderTemplate(serviceType)` loads from `settings` where `key = 'default_order_template'`.  
   - **Write:** `saveDefaultOrderTemplate(template, serviceType)` updates that same row (or merges by service type into the stored JSON).

2. **New client (no saved order)**  
   - When **creating** a client (`addClient`), if `activeOrder` is not provided, the app loads the default template for the client’s `serviceType` and saves it into `clients.upcoming_order`.  
   - So a new Food client gets `upcoming_order` = default Food template by default.

3. **Existing client (no saved order)**  
   - **Read:** `getUpcomingOrderForClient(clientId)` returns `client.activeOrder`, which comes from `clients.upcoming_order` (mapped in `mapClientFromDB`).  
   - If `clients.upcoming_order` is null/empty, the client has **no** active order; the UI may then offer to “apply default” or show empty state.  
   - The default template is **not** automatically written into `clients.upcoming_order` on every load; it’s only applied when the user explicitly applies it or when the client is first created.

4. **Saving**  
   - **From client profile (full save):** `updateClient` with `data.activeOrder` writes to `clients.upcoming_order` (and may sync to `upcoming_orders` for compatibility).  
   - **Food-specific save:** `saveClientFoodOrder(clientId, data, fullActiveOrder)` writes the **full** active order (preferring `fullActiveOrder` when provided) to `clients.upcoming_order` so vendor selections and structure are preserved.

### JSON Shape (in `clients.upcoming_order`)

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

### Save / Read Entry Points

| Action | Function / flow |
|--------|------------------|
| Read for client | `getUpcomingOrderForClient(clientId)` → `getClient(clientId)` → `mapClientFromDB` maps `upcoming_order` → `activeOrder`. |
| Save from profile | `updateClient(..., { activeOrder })` or `saveClientFoodOrder(clientId, data, fullActiveOrder)` → `UPDATE clients SET upcoming_order = ...`. |
| Default template | `getDefaultOrderTemplate(serviceType)`, `saveDefaultOrderTemplate(template, serviceType)` (settings table). |

---

## 2. Meal Planner (Saved Meal Plan for the Month)

### What It Is

Per-date meal plan items (e.g. Soup, Sandwich) with quantities, shown in the “Saved Meal Plan for the Month” section. Each date has a list of items with `id`, `name`, `quantity`, and optional `value`.

### Where It’s Saved

| Location | Purpose |
|----------|---------|
| **`clients.meal_planner_data`** (JSONB) | **Single source of truth** for the client’s saved meal plan. Array of `{ scheduledDeliveryDate, items[] }`. Full snapshot per date. |

**Admin default only:** The table **`meal_planner_custom_items`** with **`client_id IS NULL`** is the **default template** (admin calendar): which dates exist and which items/quantities appear by default. Client-specific overrides are **not** stored there; they are stored in `clients.meal_planner_data`.

### How It Works by Default

1. **Default template (admin)**  
   - **Dates:** `getDefaultTemplateMealPlanDatesForFuture()` returns distinct `calendar_date` from `meal_planner_custom_items` where `client_id IS NULL` and `calendar_date >= today`.  
   - **Items per date:** `getMealPlannerCustomItems(calendarDate, null)` returns items for that date from `meal_planner_custom_items` where `client_id IS NULL`.

2. **New client (`clientId === 'new'`)**  
   - **Load:** `getDefaultMealPlanTemplateForNewClient()` or `getAvailableMealPlanTemplateWithAllDates()` builds the list of future dates from the default template and, for each date, uses default items/quantities from `getMealPlannerCustomItems(date, null)`.  
   - **Save:** When the client is created, the meal plan is written to **`clients.meal_planner_data`** via `saveClientMealPlannerDataFull(clientId, orders)` (full snapshot).

3. **Existing client**  
   - **Load:** The UI loads two things:  
     - Default template: `getAvailableMealPlanTemplateWithAllDates()` (all future dates + default items from `meal_planner_custom_items`, `client_id IS NULL`).  
     - Client saved data: `getClientMealPlannerData(clientId)` from `clients.meal_planner_data`.  
   - **Merge:** For each date, client saved data **overrides** the template. So: “all configured dates from the admin template, with the client’s saved quantities where they’ve set them.”  
   - **Save (single date):** `saveClientMealPlannerData(clientId, date, items)` merges that date into existing `meal_planner_data` and clears entries older than 7 days.  
   - **Save (full):** `saveClientMealPlannerDataFull(clientId, orders)` replaces `meal_planner_data` with the full list of orders (again dropping entries older than 7 days).

4. **7-day cleanup**  
   On every meal planner save, entries with `scheduledDeliveryDate < today - 7 days` are removed so old dates don’t accumulate. Implemented in `mealPlannerCutoffDate()` (7 days ago in app timezone).

### JSON Shape (in `clients.meal_planner_data`)

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

### Save Rules (summary)

- **Merge by date:** Single-date save only updates that date; other dates are preserved.  
- **Full snapshot:** Stored values are exact quantities per item, not deltas from default.  
- **Cleanup:** On each save, remove entries where `scheduledDeliveryDate < today - 7 days`.

### Save / Read Entry Points

| Action | Function |
|--------|----------|
| Read | `getClientMealPlannerData(clientId)` → `SELECT meal_planner_data FROM clients WHERE id = clientId`. |
| Save one date | `saveClientMealPlannerData(clientId, dateToSave, items)` → merge date into existing array, apply 7-day cutoff, then `UPDATE clients SET meal_planner_data = ...`. |
| Save full | `saveClientMealPlannerDataFull(clientId, orders)` → replace `meal_planner_data` with filtered/sorted array, apply 7-day cutoff. |
| Default template (dates) | `getDefaultTemplateMealPlanDatesForFuture()` (from `meal_planner_custom_items`, `client_id IS NULL`). |
| Default template (items per date) | `getMealPlannerCustomItems(calendarDate, null)`. |

---

## 3. Summary Table

| Data type | Stored in | Default source | Main entry points |
|-----------|-----------|----------------|-------------------|
| **Food** | `clients.upcoming_order` (JSONB) | `settings.value` where `key = 'default_order_template'` (by service type) | `getUpcomingOrderForClient`, `saveClientFoodOrder`, `updateClient`; `getDefaultOrderTemplate`, `saveDefaultOrderTemplate` |
| **Meal planner** | `clients.meal_planner_data` (JSONB) | `meal_planner_custom_items` where `client_id IS NULL` (dates + items per date) | `getClientMealPlannerData`, `saveClientMealPlannerData`, `saveClientMealPlannerDataFull`; `getAvailableMealPlanTemplateWithAllDates`, `getDefaultMealPlanTemplateForNewClient` |

---

## 4. Related Docs and SQL

- **HOW_CLIENT_ORDER_DATA_IS_SAVED.md** – Shorter overview of where data is stored.  
- **MEAL_PLANNER_SCHEMA.md** – Schema for `meal_planner_custom_items` (admin default).  
- **sql/add_meal_planner_data_to_clients.sql** – Adds `meal_planner_data` column to `clients`.
