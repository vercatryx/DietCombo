# Meal Planner Orders – Analysis and Recommended Approach

## Executive Summary

This document analyzes the current handling of meal planner orders in the DietCombo application and recommends the best approach for integrating them into the order lifecycle.

**Current state**: Meal orders are partially implemented. Data is saved to `clients.active_order` but **never flows** to `upcoming_orders` or `orders`. The `meal_planner_orders` table exists but has **no application code** using it.

---

## 1. Current Architecture

### 1.1 Entities Involved

| Entity | Purpose | Used By |
|--------|---------|---------|
| **ClientMealOrder** (type) | `mealSelections: { Breakfast, Lunch, Dinner }` per meal type | `clients.active_order` JSON |
| **saveClientMealOrder** | Persists meal selections to `clients.active_order` | ClientProfile, FoodServiceWidget |
| **MealPlannerCustomItem** | Admin default items per calendar date (template) | DefaultOrderTemplate |
| **MealPlannerOrder** | Per-delivery-date meal orders with items JSON | **Schema only – not used** |

### 1.2 Data Flow Today

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ FOOD ORDERS (working)                                                        │
│ clients.active_order (deliveryDayOrders) → syncCurrentOrderToUpcoming()      │
│   → upcoming_orders → process-weekly-orders → orders                         │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ MEAL ORDERS (broken)                                                         │
│ clients.active_order (mealSelections) → saveClientMealOrder()                │
│   → ❌ NO sync to upcoming_orders                                            │
│   → ❌ NO processing to orders                                               │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│ MEAL PLANNER ORDERS TABLE                                                    │
│ meal_planner_orders – schema exists, processedOrderId → orders               │
│   → ❌ No application code writes or reads it                                │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.3 Data Structures

**ClientMealOrder (current)**  
Stored in `clients.active_order` when `serviceType === 'Meal'`:

```typescript
{
  serviceType: 'Meal',
  caseId?: string,
  mealSelections: {
    Breakfast?: { vendorId?: string; items: { [itemId: string]: number }; itemNotes?: {...} },
    Lunch?:   { vendorId?: string; items: { [itemId: string]: number }; itemNotes?: {...} },
    Dinner?:  { vendorId?: string; items: { [itemId: string]: number }; itemNotes?: {...} }
  }
}
```

**MealPlannerOrder (schema)** – `meal_planner_orders` table:

```prisma
model MealPlannerOrder {
  id                    String
  clientId              String
  status                String   @default("draft")
  scheduledDeliveryDate DateTime?
  deliveryDay           String?
  totalValue            Decimal?
  totalItems            Int?
  items                 Json?    // Flexible structure
  notes                 String?
  processedOrderId      String?  // Links to orders when processed
  processedAt           DateTime?
  ...
}
```

### 1.4 Why Meal Orders Don’t Sync

`syncCurrentOrderToUpcoming()` only handles:

- **Food**: `deliveryDayOrders` + `vendorSelections` (per delivery day)
- **Boxes**: `boxOrders` (per delivery day)
- **Custom**: `customItems`
- **Produce**: `billAmount` (no sync to `upcoming_orders`)

There is **no branch** for `serviceType === 'Meal'` with `mealSelections`. The sync logic expects `deliveryDayOrders` / `vendorSelections`, which Meal orders do not provide.

---

## 2. Recommended Approach

### Option A: Map Meal to Existing Food Flow (Lower Effort)

**Idea**: Convert `mealSelections` into a `deliveryDayOrders`-like structure and reuse the existing Food sync and processing.

**Steps**:

1. Add a branch in `syncCurrentOrderToUpcoming()` for `serviceType === 'Meal'`:
   - Derive delivery days from client schedule or default vendor.
   - Build a `deliveryDayOrders` structure from `mealSelections` (e.g. spread meal types across delivery days).
2. Use `service_type = 'Meal'` in `upcoming_orders` and `orders`.
3. Ensure `process-weekly-orders` handles Meal orders like Food (it already supports `service_type = 'Meal'`).

**Pros**:

- Reuses current `upcoming_orders` and processing.
- Minimal schema changes.
- Stops and billing can work as for Food.

**Cons**:

- Loses meal-type-by-delivery-day granularity if not modeled carefully.
- `mealSelections` is per-meal-type, not per-day; mapping is business-logic-dependent.

---

### Option B: Use `meal_planner_orders` as Dedicated Pipeline (Recommended)

**Idea**: Introduce a dedicated path for meal planner orders and process them into `orders` similarly to `upcoming_orders` → `orders`.

**Data flow**:

```
clients.active_order (mealSelections)
    → saveClientMealOrder() [existing]
    → NEW: syncMealPlannerToOrders() 
        → meal_planner_orders (one row per delivery date)
        → process-weekly-orders (or new process) 
            → orders (processedOrderId backfilled)
```

**Steps**:

1. **Save path**
   - After `saveClientMealOrder()`, call a new `syncMealPlannerToUpcoming()`.
   - For each delivery date in the client’s schedule (or derived from vendor):
     - Build `items` JSON from `mealSelections` (and optionally `MealPlannerCustomItem` defaults).
     - Upsert `meal_planner_orders` with `status = 'scheduled'`, `scheduledDeliveryDate`, `deliveryDay`, `items`, `totalValue`, `totalItems`.

2. **Processing path**
   - Extend `process-weekly-orders` (or add a dedicated processor) to:
     - Fetch `meal_planner_orders` where `status = 'scheduled'` and `scheduledDeliveryDate` is in the processing window.
     - Create corresponding rows in `orders`.
     - Set `meal_planner_orders.processedOrderId` and `processedAt`, and update `status` to `'processed'`.

3. **Stops and billing**
   - Reuse existing logic for `orders` (stops, billing, delivery proof).

**Pros**:

- Preserves meal-type structure in `items` JSON.
- Clear separation from Food orders.
- Uses existing schema.
- Room for `MealPlannerCustomItem` integration (default items per date).

**Cons**:

- Requires new sync and processing code.
- Need to define how `mealSelections` maps to delivery dates (by schedule, by vendor, etc.).

---

### Option C: Hybrid – Meal as Sub-type of Food

**Idea**: Treat Meal as a Food variant. Store meal data in `active_order`, but represent it as `deliveryDayOrders` for sync.

**Steps**:

1. When saving a Meal order, derive `deliveryDayOrders` from `mealSelections` and client schedule.
2. Call `syncCurrentOrderToUpcoming()` with `serviceType = 'Food'` (or `'Meal'` if processing supports it).
3. Keep `mealSelections` in `active_order` for UI and editing; use derived `deliveryDayOrders` only for sync.

**Pros**:

- Reuses sync and processing.
- No new tables.

**Cons**:

- More complex mapping logic.
- Two representations of the same order.

---

## 3. Recommendation: Option B (Dedicated `meal_planner_orders`)

### 3.1 Rationale

- `meal_planner_orders` already exists and is designed for per-delivery-date meal orders.
- Meal orders are conceptually distinct from Food (meal types vs. delivery-day-only).
- `MealPlannerCustomItem` can plug into this flow for default items per date.
- Future features (e.g. per-day overrides) fit naturally in `meal_planner_orders.items`.

### 3.2 Implementation Outline

#### Phase 1: Sync meal selections to `meal_planner_orders`

1. Add `syncMealPlannerToUpcoming(clientId, client)`:
   - Read `clients.active_order` and client schedule.
   - Determine delivery dates (e.g. next N weeks based on vendor schedule).
   - For each date:
     - Build `items` from `mealSelections` (and optionally `MealPlannerCustomItem`).
     - Compute `totalValue`, `totalItems`.
     - Upsert `meal_planner_orders` with `status = 'scheduled'`, `scheduledDeliveryDate`, `deliveryDay`, `items`.

2. Call `syncMealPlannerToUpcoming()` from:
   - `saveClientMealOrder()` (or its caller in ClientProfile).

#### Phase 2: Process `meal_planner_orders` into `orders`

1. In `process-weekly-orders` (or a new endpoint):
   - Query `meal_planner_orders` where `status = 'scheduled'` and `scheduledDeliveryDate` in the processing window.
   - For each row:
     - Create `orders` row (mirror structure used for Food/Boxes).
     - Create stops.
     - Create billing record.
     - Update `meal_planner_orders.processedOrderId`, `processedAt`, `status = 'processed'`.

#### Phase 3: Read path and UI

1. Add `getMealPlannerOrders(clientId, startDate?, endDate?)` to fetch scheduled/processed meal planner orders.
2. Where needed, show meal planner orders alongside upcoming orders and orders.
3. Ensure ClientProfile / FoodServiceWidget can load and display meal planner orders when `serviceType === 'Meal'`.

### 3.3 `mealSelections` → delivery dates mapping

Define how many meals per type per week and how they map to delivery days, e.g.:

- Client schedule: Monday, Thursday.
- `mealSelections`: Breakfast 7, Lunch 7, Dinner 7.
- Split by day: 3–4 Breakfast, 3–4 Lunch, 3–4 Dinner per delivery (configurable).

This mapping should live in a shared helper (e.g. `lib/meal-planner-helpers.ts`) and be configurable via settings if needed.

### 3.4 Integration with `MealPlannerCustomItem`

- When building `items` for a delivery date, merge:
  - Items from `mealSelections`.
  - Default items from `MealPlannerCustomItem` for that date (global or client-specific).
- Define precedence (e.g. client overrides > custom items > defaults).

---

## 4. Quick Wins (If Option B is deferred)

1. **Validate and persist**: Ensure `saveClientMealOrder()` is called when Meal tab is used and `active_order` is correct.
2. **Document**: Note in code that Meal orders do not yet sync to `upcoming_orders` or `orders`.
3. **Unify Meal/Food where appropriate**: If some clients are really Food clients with meal-type selections, consider mapping those to `deliveryDayOrders` so they flow through the existing pipeline.

---

## 5. Files to Modify

| File | Changes |
|------|---------|
| `lib/actions.ts` | Add `syncMealPlannerToUpcoming()`, extend `saveClientMealOrder()` to call it |
| `lib/meal-planner-helpers.ts` (new) | `mealSelections` → delivery dates mapping, items aggregation |
| `app/api/process-weekly-orders/route.ts` | Process `meal_planner_orders` into `orders` |
| `components/clients/ClientProfile.tsx` | Ensure Meal save triggers sync |
| `components/admin/DefaultOrderTemplate.tsx` | Optional: apply `MealPlannerCustomItem` to meal planner orders |

---

## 6. Summary

| Aspect | Current | Recommended |
|--------|---------|-------------|
| Storage | `clients.active_order` only | Keep `active_order` + sync to `meal_planner_orders` |
| Sync | None | New `syncMealPlannerToUpcoming()` |
| Processing | None | Extend `process-weekly-orders` for `meal_planner_orders` |
| Tables | `meal_planner_orders` unused | Use `meal_planner_orders` as primary staging table |
| Default items | `MealPlannerCustomItem` only for templates | Merge into `meal_planner_orders.items` per date |

Implementing Option B will connect meal planner orders to the rest of the order lifecycle (upcoming → orders → stops → billing) while keeping the meal-type model and room for future enhancements.
