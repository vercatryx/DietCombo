# Create Order Button Analysis

## Overview

This document analyzes how the "Create Order" button works in the application. Note: The `/triangleorder` folder is not accessible in the current workspace (it's in `.gitignore`), but this analysis covers the current implementation which appears to follow similar patterns based on documentation references.

## Two Different "Create Order" Mechanisms

The application has two distinct order creation flows:

### 1. **"Create Orders" Button in Sidebar** (Bulk Order Processing)
   - **Location**: `components/Sidebar.tsx` (lines 183-221)
   - **Purpose**: Processes all scheduled upcoming orders into actual orders
   - **API Endpoint**: `/api/simulate-delivery-cycle`

### 2. **Order Creation in Client Profile** (Individual Order Configuration)
   - **Location**: `components/clients/ClientProfile.tsx`
   - **Purpose**: Saves order configuration when creating/editing a client
   - **Functions**: `handleSave()` → `executeSave()` → `syncCurrentOrderToUpcoming()`

---

## 1. Sidebar "Create Orders" Button

### Button Implementation

**File**: `components/Sidebar.tsx`

```typescript
// Lines 112-179: handleSimulateRun function
async function handleSimulateRun() {
    if (!confirm('This will create orders for all scheduled upcoming orders. The original Upcoming Orders will be preserved. Proceed?')) return;
    
    setSimulating(true);
    const res = await fetch('/api/simulate-delivery-cycle', { method: 'POST' });
    const data = await res.json();
    // ... handle results
}
```

**Button UI** (Lines 183-221):
- Shows "Create Orders" when idle
- Shows "Creating..." with spinner when processing
- Only visible to admin/super-admin users
- Displays results including skipped orders and errors

### API Endpoint: `/api/simulate-delivery-cycle`

**File**: `app/api/simulate-delivery-cycle/route.ts`

#### Process Flow:

1. **Fetch Scheduled Upcoming Orders**
   ```typescript
   const { data: upcomingOrders } = await supabase
       .from('upcoming_orders')
       .select('*')
       .eq('status', 'scheduled')
   ```

2. **For Each Upcoming Order:**
   - **Check Eligibility**: Verify client status allows deliveries
   - **Calculate Delivery Date**: Determine next delivery date from `delivery_day`
   - **Check Vendor Cutoff**: Verify order is within JIT (Just-In-Time) cutoff window
   - **Create Order**: Insert new record in `orders` table with:
     - Status: `'waiting_for_proof'`
     - Calculated `scheduled_delivery_date`
     - Generated `order_number` (6+ digits, starting from 100000)
     - Copy all vendor selections, items, and boxes

3. **Order Number Generation**:
   ```typescript
   // Get max from both upcoming_orders and orders tables
   const maxOrderNum = Math.max(maxOrderNum, maxUpcomingNum);
   let nextOrderNumber = Math.max(100000, maxNum + 1);
   ```

4. **Preserve Upcoming Orders**: Original upcoming orders remain unchanged (they're templates)

#### Key Logic Points:

- **JIT Cutoff Rule**: Orders are only created if `(DeliveryDate - Now) <= Max(VendorCutoffs)`
- **Eligibility Check**: Clients with status `deliveriesAllowed = false` are skipped
- **Delivery Day Inference**: If `delivery_day` is null, attempts to infer from vendor selections
- **Error Handling**: Collects errors and skipped reasons, returns detailed results

#### Response Format:
```typescript
{
    success: boolean,
    message: string,
    totalFound: number,
    processedCount: number,
    skippedCount: number,
    skippedReasons: string[],
    errors: string[],
    debugLogs: string[]
}
```

---

## 2. Client Profile Order Creation

### Entry Point: `handleSave()`

**File**: `components/clients/ClientProfile.tsx` (lines 5971-6041)

#### Validation Steps:

1. **Approved Meals Validation**: Checks min/max bounds (0-42 meals/week)
2. **Order Config Validation**: Validates order configuration based on service type
3. **Status Change Handling**: If navigator changes status, may show units modal
4. **Calls `executeSave()`**: Proceeds to actual save logic

### Core Save Logic: `executeSave()`

**File**: `components/clients/ClientProfile.tsx` (lines 6043-6608)

#### Process Flow:

1. **Prepare Active Order** (`prepareActiveOrder()` function, lines 6045-6209):
   - **For Food Orders**:
     - Handles `deliveryDayOrders` format (multi-day)
     - Handles `vendorSelections` format (single-day)
     - Converts `itemsByDay` format to `deliveryDayOrders` if needed
     - Filters out empty vendor selections
     - Preserves `vendorId` and `items` for each selection
   
   - **For Box Orders**:
     - Uses `boxOrders` array (supports multiple boxes)
     - Cleans items: only keeps items with `qty > 0`
     - Preserves `itemNotes` for items with quantity
     - Falls back to legacy format if `boxOrders` array missing
   
   - **For Custom Orders**:
     - Preserves `vendorId` and `customItems` array
     - Filters out items with empty names

2. **Save Client Data**:
   - **New Clients**: Creates client first, then updates with order data
   - **Existing Clients**: Updates client with new order config

3. **Sync to Upcoming Orders**: Calls `syncCurrentOrderToUpcoming()`

### Sync to Upcoming Orders: `syncCurrentOrderToUpcoming()`

**File**: `lib/actions.ts` (lines 2927-3200)

#### Process Flow:

1. **Draft Persistence** (Line 2949-2965):
   - Saves raw `activeOrder` to `clients.active_order` JSON field
   - Ensures data persists even if sync fails
   - Updates `updated_at` timestamp

2. **Format Detection**:
   - Checks if order uses `deliveryDayOrders` format (multi-day)
   - Box orders should NOT use `deliveryDayOrders` format

3. **Multi-Day Format Handling** (`deliveryDayOrders`):
   - For each delivery day:
     - Filters days with at least one vendor with items
     - Deletes orders for days no longer in config
     - Calls `syncSingleOrderForDeliveryDay()` for each day

4. **Single-Day Format Handling**:
   - Determines delivery days from vendor configurations
   - For multiple delivery days: creates order for each day
   - For single delivery day: uses legacy logic
   - Box orders: one order per week, not per day

### Single Order Sync: `syncSingleOrderForDeliveryDay()`

**File**: `lib/actions.ts` (lines 2249-2919)

#### Process Flow:

1. **Date Calculation** (Lines 2266-2387):
   - Calculates `take_effect_date` (must be Sunday, respects weekly locking)
   - Calculates `scheduled_delivery_date` based on vendor delivery days
   - For Boxes without vendor: uses fallback date (2099-12-31)

2. **Total Calculation** (Lines 2389-2456):
   - **Food**: Sums item prices × quantities from menu items
   - **Boxes**: Calculates from `itemPrices` or falls back to box type pricing
   - Tracks `total_value` and `total_items`

3. **Upcoming Order Upsert** (Lines 2468-2600):
   - Validates and normalizes `service_type`
   - Prepares `upcomingOrderData` with:
     - `client_id`, `service_type`, `case_id`
     - `status: 'scheduled'`
     - `take_effect_date`, `delivery_day`
     - `total_value`, `total_items`
     - `last_updated`, `updated_by`
   - Checks for existing order (by `client_id`, `service_type`, `delivery_day`)
   - Upserts (insert or update) the order
   - Generates `order_number` if missing (6+ digits, starting from 100000)

4. **Vendor Selections** (Lines 2602-2750):
   - Deletes existing vendor selections for this order
   - For Food orders: Creates `upcoming_order_vendor_selections` records
   - For each vendor selection:
     - Calculates vendor totals
     - Inserts vendor selection record

5. **Order Items** (Lines 2752-2809):
   - Deletes existing items for this order
   - For Food orders: Creates `upcoming_order_items` records
   - For each item:
     - Gets current menu item price
     - Inserts item record with `quantity`, `unit_value`, `total_value`
     - Supports `notes`, `custom_name`, `custom_price`, `meal_item_id`

6. **Box Selections** (Lines 2811-2919):
   - Deletes existing box selections for this order
   - For Box orders: Creates `upcoming_order_box_selections` record
   - Includes `vendor_id`, `box_type_id`, `quantity`, `items` (JSON)

---

## Database Tables Involved

### 1. `clients` Table
- **Field**: `active_order` (JSONB)
  - Stores draft order configuration
  - Persisted immediately on save
  - Contains: `serviceType`, `caseId`, `vendorSelections`, `deliveryDayOrders`, etc.

### 2. `upcoming_orders` Table
- **Purpose**: Template/recurring orders
- **Status**: `'scheduled'` (initial), `'processed'` (after transfer)
- **Key Fields**:
  - `client_id`: Links to client
  - `service_type`: 'Food', 'Boxes', 'Equipment', 'Custom'
  - `case_id`: Unite Us case identifier
  - `delivery_day`: Day of week for delivery
  - `take_effect_date`: Date when order becomes active (always Sunday)
  - `total_value`, `total_items`: Calculated totals
  - `status`: Order status
  - `order_number`: 6+ digit unique identifier

### 3. `upcoming_order_vendor_selections` Table
- **Purpose**: Vendor selections for upcoming orders (Food orders)
- **Key Fields**: `upcoming_order_id`, `vendor_id`, `total_value`, `total_items`

### 4. `upcoming_order_items` Table
- **Purpose**: Individual menu items in upcoming orders (Food orders)
- **Key Fields**: `upcoming_order_id`, `menu_item_id`, `quantity`, `unit_value`, `total_value`, `notes`, `custom_name`, `custom_price`, `meal_item_id`

### 5. `upcoming_order_box_selections` Table
- **Purpose**: Box selections for upcoming orders (Box orders)
- **Key Fields**: `upcoming_order_id`, `vendor_id`, `box_type_id`, `quantity`, `items` (JSON)

### 6. `orders` Table
- **Purpose**: Actual orders ready for processing/delivery
- **Status**: `'pending'`, `'confirmed'`, `'scheduled'`, `'waiting_for_proof'`, `'delivered'`
- **Key Fields**:
  - `scheduled_delivery_date`: Actual delivery date
  - `order_number`: Unique 6+ digit order number
  - `case_id`: Unite Us case identifier
  - `client_id`: Links to client

---

## Key Business Rules

1. **Weekly Locking**: `take_effect_date` must always be a Sunday
2. **Draft Persistence**: Order config is saved to `clients.active_order` immediately
3. **Multi-Day Support**: Food orders can have different items for different delivery days
4. **Box Orders**: One recurring order per week, not per delivery day
5. **Case ID**: Required for Food orders, optional for Box orders
6. **Price Recalculation**: Prices are recalculated from current menu items when syncing
7. **Vendor Assignment**: Box orders can infer vendor from `boxTypeId` if not specified
8. **Order Number**: Minimum 6 digits (100000+), generated sequentially from max existing number

---

## Order Processing Flow Summary

```
┌─────────────────────────────────────────────────────────────┐
│  Client Profile Form (ClientProfile.tsx)                     │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ User fills order configuration                          │ │
│  │ Click "Save" button                                     │ │
│  └─────────────────────────────────────────────────────────┘ │
│                    ↓                                          │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ handleSave() → executeSave()                             │ │
│  │ - Validates order config                                 │ │
│  │ - Prepares activeOrder                                   │ │
│  │ - Saves to clients.active_order (JSON)                  │ │
│  └─────────────────────────────────────────────────────────┘ │
│                    ↓                                          │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ syncCurrentOrderToUpcoming()                             │ │
│  │ - Detects format (multi-day vs single-day)              │ │
│  │ - For each delivery day:                                 │ │
│  │   → syncSingleOrderForDeliveryDay()                      │ │
│  └─────────────────────────────────────────────────────────┘ │
│                    ↓                                          │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ syncSingleOrderForDeliveryDay()                          │ │
│  │ - Calculates dates (take_effect_date, delivery_date)    │ │
│  │ - Calculates totals                                      │ │
│  │ - Upserts upcoming_orders record                        │ │
│  │ - Creates vendor selections                              │ │
│  │ - Creates order items                                    │ │
│  │ - Creates box selections (if Box order)                  │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  Upcoming Orders Table (Templates)                           │
│  - Status: 'scheduled'                                      │
│  - Contains order configuration                              │
│  - Reusable for recurring orders                             │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  "Create Orders" Button (Sidebar.tsx)                        │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ Admin clicks "Create Orders"                             │ │
│  │ → Calls /api/simulate-delivery-cycle                      │ │
│  └─────────────────────────────────────────────────────────┘ │
│                    ↓                                          │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │ simulate-delivery-cycle API                              │ │
│  │ - Fetches all 'scheduled' upcoming orders                │ │
│  │ - For each order:                                        │ │
│  │   - Checks eligibility                                   │ │
│  │   - Calculates delivery date                             │ │
│  │   - Checks vendor cutoff (JIT)                           │ │
│  │   - Creates order in orders table                        │ │
│  │   - Copies vendor selections, items, boxes               │ │
│  │   - Sets status: 'waiting_for_proof'                     │ │
│  └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  Orders Table (Actual Orders)                                │
│  - Status: 'waiting_for_proof'                              │
│  - Has scheduled_delivery_date                              │
│  - Ready for delivery processing                             │
└─────────────────────────────────────────────────────────────┘
```

---

## Code Locations Reference

### Primary Order Creation Functions

**Client Profile Flow:**
- `handleSave()`: `components/clients/ClientProfile.tsx:5971`
- `executeSave()`: `components/clients/ClientProfile.tsx:6043`
- `syncCurrentOrderToUpcoming()`: `lib/actions.ts:2927`
- `syncSingleOrderForDeliveryDay()`: `lib/actions.ts:2249`

**Bulk Order Processing:**
- `handleSimulateRun()`: `components/Sidebar.tsx:112`
- `simulate-delivery-cycle`: `app/api/simulate-delivery-cycle/route.ts:24`

**Client Portal Flow:**
- `handleSave()`: `components/clients/ClientPortalInterface.tsx:250`
- Also calls `syncCurrentOrderToUpcoming()`

### UI Components
- Client Profile: `components/clients/ClientProfile.tsx`
- Client Portal: `components/clients/ClientPortalInterface.tsx`
- Sidebar: `components/Sidebar.tsx`

---

## Differences from TriangleOrder (Based on Documentation)

Based on `TRIANGLEORDER_ORDER_CREATION_ANALYSIS.md` and other documentation:

1. **Enhanced Client Portal Components** (may exist in triangleorder):
   - `ClientInfoShelf.tsx`: Comprehensive client information sidebar
   - `ClientPortalHeader.tsx`: Meal count display with validation
   - `FoodServiceWidget.tsx`: Enhanced multi-day delivery support
   - `MenuItemCard.tsx`: Enhanced item selection UI

2. **Meal Management System** (may exist in triangleorder):
   - Category-based meal organization
   - Set value validation per category
   - Meal type support (Breakfast, Lunch, Dinner)
   - Image upload and cropping for meal items

3. **Enhanced Notes Support** (may exist in triangleorder):
   - Per-item, per-day note support
   - Enhanced note input using `react-textarea-autosize`

---

## Notes

- Orders are created in a two-stage process: first as templates in `upcoming_orders`, then as actual orders in `orders`
- The system supports recurring orders through the `upcoming_orders` table
- Equipment orders are an exception and are created directly in the `orders` table (via `saveEquipmentOrder()`)
- Multiple processing pathways exist for different use cases (weekly processing, simulation, manual transfer)
- The `active_order` JSON field provides draft persistence even if the full sync fails
- Order numbers are generated sequentially, ensuring uniqueness across both `upcoming_orders` and `orders` tables

---

**Last Updated**: January 25, 2026
**Status**: Complete Analysis
