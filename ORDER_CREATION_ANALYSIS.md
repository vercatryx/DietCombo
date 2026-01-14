# Order Creation Analysis

This document provides a comprehensive analysis of how orders are created in the DietCombo application.

## Overview

Orders in the DietCombo system follow a multi-stage creation process:
1. **Initial Creation**: Orders are initially created as "upcoming orders" in the `upcoming_orders` table
2. **Processing**: Upcoming orders are processed into actual orders in the `orders` table
3. **Multiple Entry Points**: Orders can be created through different pathways depending on the context

## Order Creation Pathways

### 1. User-Initiated Order Creation (Primary Pathway)

**Location**: `components/clients/ClientProfile.tsx` and `components/clients/ClientPortalInterface.tsx`

**Flow**:
1. User fills out order configuration in the UI (selects vendors, items, case ID, etc.)
2. User clicks "Save" button
3. `handleSave()` function is called (line 4139 in ClientProfile.tsx)
4. `executeSave()` function prepares the order configuration
5. `syncCurrentOrderToUpcoming()` is called (from `lib/actions.ts`, line 2860)

**Key Function**: `syncCurrentOrderToUpcoming()`
- **File**: `lib/actions.ts` (line 2860)
- **Purpose**: Syncs the active order configuration to the `upcoming_orders` table
- **Process**:
  - First saves the raw `activeOrder` metadata to the `clients.active_order` JSON field (draft persistence)
  - Determines if the order uses new `deliveryDayOrders` format or old single-order format
  - For each delivery day, calls `syncSingleOrderForDeliveryDay()` to create/update records in `upcoming_orders`

**Key Function**: `syncSingleOrderForDeliveryDay()`
- **File**: `lib/actions.ts` (line 2249)
- **Purpose**: Creates or updates a single upcoming order record for a specific delivery day
- **Process**:
  1. Calculates `take_effect_date` (must be a Sunday, respects weekly locking)
  2. Calculates `scheduled_delivery_date` based on vendor delivery days
  3. Calculates totals (total_value, total_items) from menu items
  4. Upserts record in `upcoming_orders` table
  5. Deletes existing vendor selections and items
  6. Creates new vendor selections in `upcoming_order_vendor_selections`
  7. Creates new items in `upcoming_order_items` (for Food orders)
  8. Creates box selections in `upcoming_order_box_selections` (for Box orders)

**Data Structure**:
- **Upcoming Orders Table**: Stores template/recurring orders
- **Service Types**: `Food`, `Boxes`, `Equipment`
- **Status**: Initially `'scheduled'` for recurring orders

---

### 2. Equipment Order Creation

**Location**: `lib/actions.ts` - `saveEquipmentOrder()` (line 504)

**Flow**:
1. User selects equipment item for a client
2. `saveEquipmentOrder()` is called
3. Creates order **directly in `orders` table** (not `upcoming_orders`)
4. Service type: `'Equipment'`
5. Stores equipment selection details in `notes` field as JSON
6. Creates vendor selection record for equipment vendor

**Key Differences**:
- Equipment orders bypass the `upcoming_orders` table
- Created directly as final orders with status `'pending'`
- Equipment details stored in JSON format in `notes` field

---

### 3. Automated Order Processing (Weekly Processing)

**Location**: `app/api/process-weekly-orders/route.ts`

**Flow**:
1. API endpoint: `GET /api/process-weekly-orders`
2. Two processing modes:
   - **Precheck Mode**: Transfers upcoming orders for clients with no existing orders
   - **Regular Mode**: Processes active orders (status: 'pending' or 'confirmed')

**Precheck Function**: `precheckAndTransferUpcomingOrders()` (line 54)
- Fetches all upcoming orders (excluding 'processed' status)
- For each client with no orders in `orders` table:
  - Transfers their upcoming orders to `orders` table
  - Copies vendor selections and items
  - Updates upcoming order status to 'processed'

**Main Processing Logic** (line 301):
- If `orders` table is empty: Processes ALL upcoming orders
- If `orders` table has records: Processes only active orders (pending/confirmed)
- For each order:
  1. If from `upcoming_orders`, copies to `orders` table
  2. Creates billing record
  3. Creates new upcoming orders for next cycle

**Key Features**:
- Supports both Food and Boxes service types
- Handles vendor selections, items, and box selections
- Creates billing records automatically
- Regenerates upcoming orders for recurring delivery

---

### 4. Delivery Cycle Simulation

**Location**: `app/api/simulate-delivery-cycle/route.ts`

**Flow**:
1. API endpoint: `POST /api/simulate-delivery-cycle`
2. Fetches ALL upcoming orders with status `'scheduled'`
3. For each upcoming order:
   - Calculates next delivery date from `delivery_day`
   - Checks JIT (Just-In-Time) cutoff rules
   - Checks client eligibility (status allows deliveries, client age)
   - Creates order in `orders` table if within cutoff window

**Key Features**:
- **JIT Cutoff Logic**: Only creates orders when delivery date is within vendor cutoff hours
- **Client Age Check**: Skips orders for clients created too recently (within cutoff period)
- **Duplicate Prevention**: Checks for existing orders before creating
- **Service Type Handling**:
  - **Food Orders**: Creates separate order for each vendor
  - **Box Orders**: Creates single order per upcoming order
- **Price Recalculation**: Uses current menu item prices when creating orders

**Order Creation** (line 368-390 for Food, line 535-560 for Boxes):
- Creates order with status `'scheduled'`
- Assigns unique `order_number` (minimum 6 digits, starting from 100000)
- Copies items with recalculated prices
- Creates vendor selections and items

---

## Data Flow Summary

### Stage 1: Order Configuration (User Input)
```
User Input → ClientProfile/ClientPortalInterface
           → handleSave()
           → executeSave()
           → syncCurrentOrderToUpcoming()
           → syncSingleOrderForDeliveryDay()
           → upcoming_orders table
```

### Stage 2: Order Processing
```
upcoming_orders table
    ↓
process-weekly-orders API (or simulate-delivery-cycle API)
    ↓
orders table (with status: 'pending' or 'scheduled')
    ↓
billing_records table (automatically created)
```

### Stage 3: Order Fulfillment
```
orders table (status: 'pending' → 'confirmed' → 'delivered')
    ↓
delivery_proofs table (optional)
    ↓
billing_records (status updates)
```

## Key Database Tables

### `upcoming_orders`
- **Purpose**: Template/recurring orders
- **Status Values**: `'scheduled'`, `'processed'`
- **Key Fields**:
  - `delivery_day`: Day of week for delivery
  - `take_effect_date`: Date when order becomes active (always Sunday)
  - `case_id`: Unite Us case identifier
  - `service_type`: 'Food' or 'Boxes'

### `orders`
- **Purpose**: Actual orders ready for processing/delivery
- **Status Values**: `'pending'`, `'confirmed'`, `'scheduled'`, `'delivered'`
- **Key Fields**:
  - `scheduled_delivery_date`: Actual delivery date
  - `order_number`: Unique 6+ digit order number
  - `case_id`: Unite Us case identifier
  - `service_type`: 'Food', 'Boxes', or 'Equipment'

### Related Tables
- `order_vendor_selections`: Links orders to vendors (Food orders)
- `order_items`: Individual menu items in orders (Food orders)
- `order_box_selections`: Box selections for Box orders
- `upcoming_order_vendor_selections`: Vendor selections for upcoming orders
- `upcoming_order_items`: Items for upcoming orders
- `upcoming_order_box_selections`: Box selections for upcoming orders

## Service Type Differences

### Food Orders
- **Multi-vendor support**: Can have multiple vendors per order
- **Item-based**: Uses `order_items` table with menu items
- **Delivery days**: Can have orders for different delivery days
- **Processing**: Creates separate orders per vendor when processing

### Box Orders
- **Single vendor**: Typically one vendor per order
- **Box-based**: Uses `order_box_selections` table
- **Custom items**: Boxes can contain custom item selections
- **Processing**: Creates single order per upcoming order

### Equipment Orders
- **Direct creation**: Bypasses `upcoming_orders` table
- **Single item**: One equipment item per order
- **Storage**: Equipment details stored in `notes` as JSON
- **Immediate**: Created directly as pending order

## Key Business Rules

1. **Weekly Locking**: `take_effect_date` must always be a Sunday
2. **Cutoff Rules**: Orders are created based on vendor cutoff hours (JIT logic)
3. **Client Eligibility**: Only clients with status allowing deliveries get orders
4. **Case ID**: Required for Food orders, optional for Box orders
5. **Order Numbers**: Minimum 6 digits, auto-incremented from 100000
6. **Price Recalculation**: Prices are recalculated from current menu items when processing
7. **Recurring Orders**: Upcoming orders remain as templates and generate new orders each cycle

## Code Locations Reference

### Primary Order Creation Functions
- `syncCurrentOrderToUpcoming()`: `lib/actions.ts:2860`
- `syncSingleOrderForDeliveryDay()`: `lib/actions.ts:2249`
- `saveEquipmentOrder()`: `lib/actions.ts:504`
- `handleSave()`: `components/clients/ClientProfile.tsx:4139`

### API Endpoints
- Process Weekly Orders: `app/api/process-weekly-orders/route.ts`
- Simulate Delivery Cycle: `app/api/simulate-delivery-cycle/route.ts`

### UI Components
- Client Profile: `components/clients/ClientProfile.tsx`
- Client Portal: `components/clients/ClientPortalInterface.tsx`

## Notes

- Orders are created in a two-stage process: first as templates in `upcoming_orders`, then as actual orders in `orders`
- The system supports recurring orders through the upcoming_orders table
- Equipment orders are an exception and are created directly in the orders table
- Multiple processing pathways exist for different use cases (weekly processing, simulation, manual transfer)
