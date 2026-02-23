# Food Service Type - Client Creation and Save Flow

## Overview
This document explains what happens when a user creates a client in the ClientProfile dialog with `servicetype = food` and how the service configuration is saved.

## 1. Client Creation Flow

### Initial Setup
When a client is created with `serviceType = 'Food'`:
- The client record is created in the `clients` table with `service_type = 'Food'`
- An `active_order` JSON field is initialized (can be empty initially)
- The client must have a `caseId` to enable service configuration

### Service Configuration Component Location
The Service Configuration section is rendered in `ClientProfile.tsx` starting at line **4564**:
```tsx
<h3 className={styles.sectionTitle}>Service Configuration</h3>
```

## 2. Service Configuration UI (Food Service Type)

### When `serviceType === 'Food'` (lines 4602-5038)

The component displays:

1. **Approved Meals Per Week Input** (lines 4605-4612)
   - User can set `formData.approvedMealsPerWeek`
   - This value is stored in the client record

2. **Current Order Request Section** (lines 4616-5036)
   - Shows budget display: `Value: {total} / {approvedMealsPerWeek}`
   - Displays existing upcoming orders items (if any)
   - Shows vendor cutoff warnings
   - **Menu Items Selection Interface** (lines 4849-5036):
     - Uses a default vendor (from `getDefaultVendor('Food')`)
     - Displays menu items for the default vendor
     - Quantity controls (+/-) for each menu item
     - Minimum meal requirements validation

### Data Structure - Order Configuration

The order configuration (`orderConfig`) can be in two formats:

#### Format 1: Multi-Day Format (`deliveryDayOrders`)
```typescript
{
  caseId: string,
  deliveryDayOrders: {
    [deliveryDay: string]: {
      vendorSelections: [
        {
          vendorId: string,
          items: { [itemId: string]: number },
          deliveryDay?: string
        }
      ]
    }
  }
}
```

#### Format 2: Single-Day Format (`vendorSelections`)
```typescript
{
  caseId: string,
  vendorSelections: [
    {
      vendorId: string,
      items: { [itemId: string]: number },
      itemsByDay?: { [day: string]: { [itemId: string]: number } },
      selectedDeliveryDays?: string[]
    }
  ]
}
```

### Helper Functions for Managing Selections

1. **`getVendorSelectionsForDay(day: string | null)`** (lines 2674-2693)
   - Returns vendor selections for a specific delivery day
   - If `day` is null and in multi-day format, returns first day's selections
   - If in single-day format, returns `orderConfig.vendorSelections`

2. **`setVendorSelectionsForDay(day: string | null, vendorSelections: any[])`** (lines 2696-2746)
   - Updates vendor selections for a specific day
   - Automatically ensures default vendor is set for empty selections
   - Handles conversion between single-day and multi-day formats
   - For "one vendor setup", updates the first day when `day` is null

## 3. Save Process

### Save Flow (`executeSave` function, line 3183)

When the user clicks Save:

#### Step 1: Prepare Active Order (`prepareActiveOrder`, lines 3185-3350)

For Food service type (lines 3197-3288):

1. **Multi-Day Format Handling** (lines 3199-3219):
   - Cleans `deliveryDayOrders` structure
   - Filters out empty vendor selections
   - Ensures default vendor is set for selections with items but no vendorId
   - Preserves `deliveryDay` on each day's order

2. **Single-Day Format Handling** (lines 3220-3287):
   - Checks for per-vendor delivery days (`itemsByDay` format)
   - If found, converts to `deliveryDayOrders` format
   - Otherwise, cleans `vendorSelections` array
   - Filters out empty selections
   - Ensures default vendor is set

#### Step 2: Update Client Record (line 3676)

```typescript
await updateClient(clientId, updateData);
```

Where `updateData` includes:
- All form fields (`formData`)
- `activeOrder`: The prepared order configuration

#### Step 3: Sync to Independent Tables (lines 3685-3758)

After updating the client record, the system syncs to specialized tables:

**For Food Service** (lines 3735-3746):
```typescript
if (serviceType === 'Food') {
    const hasDeliveryDayOrders = activeOrderAny.deliveryDayOrders && 
        typeof activeOrderAny.deliveryDayOrders === 'object' &&
        Object.keys(activeOrderAny.deliveryDayOrders).length > 0;
    
    await saveClientFoodOrder(clientId, {
        caseId: activeOrderAny.caseId,
        ...(hasDeliveryDayOrders && { deliveryDayOrders: activeOrderAny.deliveryDayOrders })
    }, activeOrderAny); // Pass full activeOrder to preserve structure
}
```

**Also saves Meal Orders** (lines 3752-3757):
```typescript
if ((updateData.activeOrder as any).mealSelections || serviceType === 'Meal' || serviceType === 'Food') {
    await saveClientMealOrder(clientId, {
        caseId: updateData.activeOrder.caseId,
        mealSelections: (updateData.activeOrder as any).mealSelections || {}
    });
}
```

### `saveClientFoodOrder` Function (lib/actions.ts, lines 8430-8535)

This function:

1. **Preserves Full Active Order Structure** (lines 8440-8467):
   - If `fullActiveOrder` is provided, uses it directly
   - Otherwise, fetches current `active_order` from database
   - This ensures `vendorSelections` and other fields are preserved

2. **Updates Active Order** (lines 8469-8488):
   - Sets `serviceType = 'Food'`
   - Updates `caseId` if provided
   - Updates `deliveryDayOrders` only if it has actual data (prevents clearing selections)
   - Preserves existing `vendorSelections` for backward compatibility

3. **Saves to Database** (lines 8494-8524):
   - Updates `clients.active_order` JSON field
   - Updates `updated_at` timestamp
   - Updates `updated_by` (if user session exists)

4. **Returns Formatted Data** (lines 8526-8534):
   - Returns in `ClientFoodOrder` format for API consistency

## 4. Data Storage Locations

### Primary Storage: `clients` table
- **Field**: `active_order` (JSONB/JSON)
- **Structure**: Contains the full order configuration including:
  - `serviceType: 'Food'`
  - `caseId: string`
  - `deliveryDayOrders: { [day: string]: { vendorSelections: [...] } }`
  - `vendorSelections: [...]` (legacy format, preserved for compatibility)

### Secondary Storage: Independent Tables
The system also maintains data in specialized tables (though the primary source is `clients.active_order`):
- `client_food_orders` table (if exists) - synced via `saveClientFoodOrder`
- `client_meal_orders` table (if exists) - synced via `saveClientMealOrder`

## 5. Key Behaviors

### Default Vendor Assignment
- When vendor selections are empty or missing `vendorId`, the system automatically assigns the default vendor
- Default vendor is determined by `getDefaultVendor('Food')` which finds:
  - Vendor with `isDefault === true` and `serviceTypes.includes('Food')`
  - Or first active vendor with `serviceTypes.includes('Food')`

### Format Conversion
- The system can convert between single-day and multi-day formats automatically
- Per-vendor delivery days (`itemsByDay`) are converted to `deliveryDayOrders` format on save
- This ensures consistency and supports multi-vendor, multi-day orders

### Data Preservation
- Empty `deliveryDayOrders` objects are NOT saved (prevents clearing existing selections)
- Only selections with items or valid vendorIds are preserved
- The full `activeOrder` structure is passed to `saveClientFoodOrder` to preserve all fields

## 6. Current Implementation Notes

1. **One Vendor Setup**: The UI is simplified for a single default vendor, but the data structure supports multiple vendors
2. **Backward Compatibility**: Both `vendorSelections` and `deliveryDayOrders` formats are supported
3. **Meal Selections**: Food service can also have `mealSelections` (e.g., for Breakfast items)
4. **Case ID Required**: Service configuration is only enabled when `caseId` is provided

## 7. Related Functions

- `getDefaultVendor(serviceType: string)`: Returns the default vendor for a service type
- `getVendorMenuItems(vendorId: string)`: Returns active menu items for a vendor
- `getCurrentOrderTotalValueAllDays()`: Calculates total order value across all days
- `mergeActiveOrderIntoOrderConfig()`: Merges active order data into order config
- `syncCurrentOrderToUpcoming()`: Syncs current order to upcoming_orders table

## 8. CRITICAL – Do Not Break (Food → upcoming_orders)

**When `serviceType = Food`, orders must always save to `upcoming_orders` and related tables.** The following rules must not be changed or relaxed:

### 8.1 `service_type` in `upcoming_orders`

- **Always use `'Food'`, `'Boxes'`, `'Custom'`, `'Produce'`** (capitalized). Never use lowercase (`'food'`, `'boxes'`, etc.).
- The schema and `process-weekly-orders` expect these exact values. Lowercase causes inserts/queries to fail or not match.
- **Relevant code**: `syncSingleOrderForDeliveryDay` (`serviceTypeForUpcomingOrders`), `syncCurrentOrderToUpcoming` (`serviceTypeForQuery`), placeholder insert/delete.

### 8.2 Food sync to `upcoming_orders`

- **Always call `saveClientFoodOrder`** when `serviceType === 'Food'` and we have `activeOrder`, even without `caseId`. This keeps `vendorSelections` (and related structure) so `syncCurrentOrderToUpcoming` can persist to `upcoming_orders`.
- **Always call `syncCurrentOrderToUpcoming`** for Food when we have order data (new or existing client). Do not gate this on `caseId` for Food.
- **Produce**: Never sync to `upcoming_orders`. Produce uses `active_orders` only. `syncCurrentOrderToUpcoming` returns early for Produce; `updateClient` and ClientProfile skip sync for Produce.

### 8.3 Preserve `vendorSelections` / `deliveryDayOrders`

- Pass the **full `activeOrder`** into `saveClientFoodOrder` (e.g. as `fullActiveOrder`). Do not overwrite with a partial object that drops `vendorSelections` or `deliveryDayOrders`.
- `syncCurrentOrderToUpcoming` and `syncSingleOrderForDeliveryDay` rely on either `vendorSelections` (legacy) or `deliveryDayOrders` to create/update `upcoming_orders` and related tables. Stripping these breaks Food order save.

### 8.4 Touch discipline

- Avoid refactors that change:
  - `service_type` casing in `upcoming_orders` reads/writes.
  - When `saveClientFoodOrder` or `syncCurrentOrderToUpcoming` run for Food.
  - The shape of `activeOrder` passed into `saveClientFoodOrder` and into sync.
- When adding features or fixing bugs around Food orders, run through: create client (Food) → add items → Save → confirm rows in `upcoming_orders` and related tables.
