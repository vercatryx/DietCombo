# TriangleOrder Order Creation Analysis

This document provides a comprehensive analysis of how orders are created and recorded when submitting an order in the client profile form, comparing the current implementation with the triangleorder pattern.

## Executive Summary

The order creation process follows a two-stage approach:
1. **Draft Stage**: Order configuration is saved to `clients.active_order` JSON field
2. **Sync Stage**: Order is synced to `upcoming_orders` table for processing
3. **Processing Stage**: Orders are later moved from `upcoming_orders` to `orders` table via API endpoints

## Current Implementation Flow

### 1. Client Profile Form Submission

**Location**: `components/clients/ClientProfile.tsx`

#### Entry Point: `handleSave()` (Line 4340)
- Validates order configuration
- Checks approved meals per week bounds
- Validates order config if caseId exists
- Handles status change logic for navigators
- Calls `executeSave()`

#### Core Save Logic: `executeSave()` (Line 4405)

**For New Clients:**
1. Creates client WITHOUT order details first (line 4529-4570)
2. Updates client WITH order details (line 4596-4637)
3. Fetches updated client (line 4652)
4. Syncs to `upcoming_orders` if order data exists (line 4687)

**For Existing Clients:**
1. Prepares cleaned order configuration (line 4407-4507)
2. Updates client with new order config
3. Syncs to `upcoming_orders` via `syncCurrentOrderToUpcoming()` (line 4687)

### 2. Client Portal Form Submission

**Location**: `components/clients/ClientPortalInterface.tsx`

#### Entry Point: `handleSave()` (Line 238)
- Validates caseId for Food orders
- Cleans order configuration
- Converts per-vendor delivery days to `deliveryDayOrders` format
- Creates temporary client object with `activeOrder`
- Calls `syncCurrentOrderToUpcoming()` (line 325)
- Refreshes router to refetch server data

### 3. Order Configuration Preparation

**Key Function**: `prepareActiveOrder()` (within `executeSave`, line 4407)

**For Food Orders:**
- Preserves `caseId` at top level
- Handles `deliveryDayOrders` format (multi-day)
- Handles `vendorSelections` format (single-day)
- Converts `itemsByDay` format to `deliveryDayOrders` if needed
- Filters out empty vendor selections
- Preserves `vendorId` and `items` for each selection

**For Box Orders:**
- Preserves `vendorId`, `caseId`, `boxTypeId`
- Preserves `boxQuantity`, `items`, `itemPrices`
- Handles optional vendor assignment

**For Custom Orders:**
- Preserves `vendorId`, `caseId`
- Filters and preserves `customItems` array

### 4. Sync to Upcoming Orders

**Key Function**: `syncCurrentOrderToUpcoming()` (Line 2927 in `lib/actions.ts`)

#### Process Flow:

1. **Draft Persistence** (Line 2949-2965):
   - Saves raw `activeOrder` to `clients.active_order` JSON field
   - Ensures Case ID, Vendor, and selections are persisted even if sync fails
   - Updates `updated_at` timestamp

2. **Format Detection** (Line 2976-2981):
   - Checks if order uses new `deliveryDayOrders` format
   - Boxes orders should NOT use `deliveryDayOrders` format

3. **Multi-Day Format Handling** (Line 2983-3074):
   - For each delivery day in `deliveryDayOrders`:
     - Filters days with at least one vendor with items
     - Deletes orders for days no longer in config
     - Calls `syncSingleOrderForDeliveryDay()` for each day

4. **Single-Day Format Handling** (Line 3075-3200):
   - Determines delivery days from vendor configurations
   - For multiple delivery days: creates order for each day
   - For single delivery day: uses old logic
   - Handles Box orders specially (one order per week, not per day)

### 5. Single Order Sync

**Key Function**: `syncSingleOrderForDeliveryDay()` (Line 2249 in `lib/actions.ts`)

#### Process Flow:

1. **Date Calculation** (Line 2266-2387):
   - Calculates `take_effect_date` (must be Sunday, respects weekly locking)
   - Calculates `scheduled_delivery_date` based on vendor delivery days
   - For Boxes without vendor: uses fallback date (2099-12-31)

2. **Total Calculation** (Line 2389-2456):
   - For Food: Sums item prices × quantities from menu items
   - For Boxes: Calculates from `itemPrices` or falls back to box type pricing
   - Tracks `total_value` and `total_items`

3. **Upcoming Order Upsert** (Line 2468-2600):
   - Validates and normalizes `service_type`
   - Prepares `upcomingOrderData` with:
     - `client_id`, `service_type`, `case_id`
     - `status: 'scheduled'`
     - `take_effect_date`, `delivery_day`
     - `total_value`, `total_items`
     - `last_updated`, `updated_by`
   - Checks for existing order (by `client_id`, `service_type`, `delivery_day`)
   - Upserts (insert or update) the order

4. **Vendor Selections** (Line 2602-2750):
   - Deletes existing vendor selections for this order
   - For Food orders: Creates `upcoming_order_vendor_selections` records
   - For each vendor selection:
     - Calculates vendor totals
     - Inserts vendor selection record

5. **Order Items** (Line 2752-2809):
   - Deletes existing items for this order
   - For Food orders: Creates `upcoming_order_items` records
   - For each item:
     - Gets current menu item price
     - Inserts item record with `quantity`, `unit_value`, `total_value`
     - Supports `notes`, `custom_name`, `custom_price`, `meal_item_id`

6. **Box Selections** (Line 2811-2919):
   - Deletes existing box selections for this order
   - For Box orders: Creates `upcoming_order_box_selections` record
   - Includes `vendor_id`, `box_type_id`, `quantity`, `items` (JSON)

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
- **Status**: `'pending'`, `'confirmed'`, `'scheduled'`, `'delivered'`
- **Key Fields**:
  - `scheduled_delivery_date`: Actual delivery date
  - `order_number`: Unique 6+ digit order number
  - `case_id`: Unite Us case identifier

## Key Business Rules

1. **Weekly Locking**: `take_effect_date` must always be a Sunday
2. **Draft Persistence**: Order config is saved to `clients.active_order` immediately
3. **Multi-Day Support**: Food orders can have different items for different delivery days
4. **Box Orders**: One recurring order per week, not per delivery day
5. **Case ID**: Required for Food orders, optional for Box orders
6. **Price Recalculation**: Prices are recalculated from current menu items when syncing
7. **Vendor Assignment**: Box orders can infer vendor from `boxTypeId` if not specified

## Order Processing (From Upcoming to Actual Orders)

Orders are moved from `upcoming_orders` to `orders` table via:

1. **API Endpoint**: `/api/process-weekly-orders`
   - Precheck mode: Transfers upcoming orders for clients with no existing orders
   - Regular mode: Processes active orders (pending/confirmed)

2. **API Endpoint**: `/api/simulate-delivery-cycle`
   - Fetches all upcoming orders with status `'scheduled'`
   - Checks JIT cutoff rules
   - Checks client eligibility
   - Creates orders in `orders` table if within cutoff window

## Differences from TriangleOrder (Based on Documentation)

Based on `TRIANGLEORDER_UPDATES_ANALYSIS.md`, triangleorder may have:

1. **Enhanced Client Portal Components**:
   - `ClientInfoShelf.tsx`: Comprehensive client information sidebar
   - `ClientPortalHeader.tsx`: Meal count display with validation
   - `FoodServiceWidget.tsx`: Enhanced multi-day delivery support
   - `MenuItemCard.tsx`: Enhanced item selection UI

2. **Meal Management System**:
   - Category-based meal organization
   - Set value validation per category
   - Meal type support (Breakfast, Lunch, Dinner)
   - Image upload and cropping for meal items

3. **Enhanced Notes Support**:
   - Per-item, per-day note support
   - Enhanced note input using `react-textarea-autosize`

## Code Locations Reference

### Primary Order Creation Functions
- `handleSave()`: `components/clients/ClientProfile.tsx:4340`
- `executeSave()`: `components/clients/ClientProfile.tsx:4405`
- `handleSave()`: `components/clients/ClientPortalInterface.tsx:238`
- `syncCurrentOrderToUpcoming()`: `lib/actions.ts:2927`
- `syncSingleOrderForDeliveryDay()`: `lib/actions.ts:2249`

### Order Processing Functions
- `precheckAndTransferUpcomingOrders()`: `app/api/process-weekly-orders/route.ts:54`
- `simulate-delivery-cycle`: `app/api/simulate-delivery-cycle/route.ts`

### UI Components
- Client Profile: `components/clients/ClientProfile.tsx`
- Client Portal: `components/clients/ClientPortalInterface.tsx`

## Implementation Checklist

### Current Implementation Status
- ✅ Draft persistence to `clients.active_order`
- ✅ Sync to `upcoming_orders` table
- ✅ Multi-day delivery support
- ✅ Box order handling
- ✅ Food order handling
- ✅ Custom order handling
- ✅ Vendor selection management
- ✅ Item management with notes
- ✅ Total calculation
- ✅ Date calculation with weekly locking

### Potential Enhancements from TriangleOrder
- ⚠️ Enhanced client portal components (may already exist)
- ⚠️ Category-based meal organization (may already exist)
- ⚠️ Enhanced note support per item per day (may already exist)
- ⚠️ Meal type support (Breakfast, Lunch, Dinner) (may already exist)

## Notes

- Orders are created in a two-stage process: first as templates in `upcoming_orders`, then as actual orders in `orders`
- The system supports recurring orders through the `upcoming_orders` table
- Equipment orders are an exception and are created directly in the `orders` table (via `saveEquipmentOrder()`)
- Multiple processing pathways exist for different use cases (weekly processing, simulation, manual transfer)
- The `active_order` JSON field provides draft persistence even if the full sync fails

---

**Last Updated**: Current date
**Status**: Complete Analysis
