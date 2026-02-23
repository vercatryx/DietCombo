# Order Processing and Status Analysis

## Executive Summary

This document provides a comprehensive analysis of how orders are processed and how their status is managed throughout the DietCombo application lifecycle.

---

## Order Lifecycle Overview

### 1. **Order Creation Phase**

#### Initial Order Creation
- **Location**: `components/clients/ClientPortalInterface.tsx`
- **Function**: `handleSave()` → `syncCurrentOrderToUpcoming()`
- **Process**:
  1. User creates/edits order configuration in client portal
  2. Order config is saved to `clients.active_order` (JSON field)
  3. Order is synced to `upcoming_orders` table via `syncSingleOrderForDeliveryDay()`
  4. Status: **`scheduled`** (default for upcoming_orders)

#### Key Functions:
- `syncCurrentOrderToUpcoming()` - Main entry point for saving orders
- `syncSingleOrderForDeliveryDay()` - Creates/updates individual upcoming orders per delivery day

**Database Tables Involved**:
- `clients.active_order` - Draft order configuration (JSON)
- `upcoming_orders` - Scheduled future orders
- `upcoming_order_vendor_selections` - Vendor selections for upcoming orders
- `upcoming_order_items` - Items for upcoming orders
- `upcoming_order_box_selections` - Box selections for upcoming orders

---

### 2. **Order Processing Phase**

#### Weekly Order Processing
- **Endpoint**: `GET /api/process-weekly-orders`
- **Location**: `app/api/process-weekly-orders/route.ts`
- **Purpose**: Processes orders from `upcoming_orders` → `orders` table

**Processing Logic**:

1. **Precheck Phase** (`precheckAndTransferUpcomingOrders()`):
   - Transfers upcoming orders for clients who have NO existing orders
   - Creates orders in `orders` table with status: **`pending`**
   - Marks upcoming orders as **`processed`**
   - Creates stops for route planning

2. **Main Processing**:
   - **If orders table is empty**: Processes ALL upcoming orders (excluding `processed`)
   - **If orders table has records**: Processes only active orders (`pending`, `confirmed`)
   - For each order:
     - Copies from `upcoming_orders` to `orders` table
     - Status set to: **`pending`**
     - Creates related records (vendor selections, items, box selections)
     - Creates billing records with status: **`request sent`**
     - Creates/updates stops for route planning
     - Generates new upcoming orders for next cycle

**Key Status Transitions**:
- `upcoming_orders.status`: `scheduled` → `processed` (when copied to orders)
- `orders.status`: Created as **`pending`**

---

### 3. **Order Status Management**

#### Available Statuses

**Defined in `lib/types.ts`**:
```typescript
type OrderStatus = 
  | 'pending'        // Order awaiting confirmation
  | 'confirmed'      // Order confirmed and ready for delivery
  | 'completed'      // Order delivered successfully
  | 'waiting_for_proof' // Awaiting proof of delivery upload
  | 'billing_pending'  // Ready for billing process
  | 'cancelled'        // Order cancelled
```

**Additional Status (used but not in type definition)**:
- `scheduled` - Used for upcoming_orders (default status)

#### Status Flow Diagram

```
┌─────────────┐
│  scheduled  │ (upcoming_orders table)
│             │
└──────┬──────┘
       │
       │ process-weekly-orders
       │
       ▼
┌─────────────┐
│   pending   │ (orders table)
│             │
└──────┬──────┘
       │
       │ Manual confirmation or auto-confirm
       │
       ▼
┌─────────────┐
│  confirmed  │
│             │
└──────┬──────┘
       │
       │ Delivery completed
       │
       ▼
┌─────────────┐
│  completed  │
│             │
└──────┬──────┘
       │
       │ OR: Delivery proof uploaded
       │
       ▼
┌──────────────────┐
│ waiting_for_proof │
│                   │
└────────┬─────────┘
         │
         │ Proof uploaded
         │
         ▼
┌─────────────────┐
│ billing_pending │
│                 │
└─────────────────┘

Alternative paths:
- Any status → cancelled (can be cancelled at any time)
- completed → billing_pending (direct transition)
```

---

### 4. **Status Update Mechanisms**

#### A. Delivery Proof Upload
- **Location**: `app/delivery/actions.ts` → `processDeliveryProof()`
- **Process**:
  1. Driver/vendor uploads delivery proof image
  2. File uploaded to R2 storage
  3. Order status updated:
     - **For `upcoming_orders`**: Calls `saveDeliveryProofUrlAndProcessOrder()` → moves to `orders` with status **`completed`**
     - **For `orders`**: Status set to **`billing_pending`**
  4. Creates billing record if doesn't exist
  5. Deducts from client's `authorized_amount`

**Status Transition**:
- `upcoming_orders` → `orders` with status **`completed`**
- `orders` (any status) → **`billing_pending`**

#### B. Manual Status Updates
- **Location**: `app/api/extension/update-status/route.ts`
- **Endpoint**: `POST /api/extension/update-status`
- **Purpose**: External API for updating order status by order number
- **Usage**: Allows external systems to update order status

#### C. Automatic Processing
- **Location**: `lib/actions.ts` → `processUpcomingOrders()`
- **Endpoint**: `POST /api/process-upcoming-orders`
- **Purpose**: Processes upcoming orders that have reached their `take_effect_date`
- **Process**:
  1. Finds upcoming orders where `take_effect_date <= today` and `status = 'scheduled'`
  2. Moves to `orders` table with status: **`pending`**
  3. Copies all related data (vendor selections, items, etc.)

---

### 5. **Status Usage in Routes System**

#### Active Statuses (Create Stops)
Orders with these statuses create stops for route planning:
- `pending`
- `scheduled`
- `confirmed`

**Location**: `app/api/route/cleanup/route.ts`, `app/api/route/routes/route.ts`

#### Inactive Statuses (Don't Create Stops)
- `completed` - Already delivered
- `cancelled` - Order cancelled
- `waiting_for_proof` - Awaiting proof
- `billing_pending` - In billing process

---

### 6. **Status Display and UI**

#### Orders List (`components/orders/OrdersList.tsx`)
- Displays all order statuses with color-coded badges
- Status formatting: Replaces underscores with spaces and uppercases
- CSS classes:
  - `statusPending` - Orange/warning
  - `statusConfirmed` - Green
  - `statusCompleted` - Green/success
  - `statusWaitProof` - Purple/accent
  - `statusBilling` - Orange/warning
  - `statusCancelled` - Red/danger

#### Stop Preview Dialog (`components/routes/StopPreviewDialog.tsx`)
Color coding:
- `cancelled` - Red (#ef4444)
- `waiting_for_proof` - Orange/Amber (#f59e0b)
- `billing_pending` - Purple (#8b5cf6)
- `completed` - Green (#16a34a)
- `pending`, `scheduled`, `confirmed` - Blue (#3b82f6)
- Default/Unknown - Gray (#6b7280)

---

### 7. **Database Schema**

#### `orders` Table
```sql
status VARCHAR(50) NOT NULL DEFAULT 'pending'
```
- No check constraint (flexible - accepts any text value)
- Index: `idx_orders_status`

#### `upcoming_orders` Table
```sql
status VARCHAR(50) NOT NULL DEFAULT 'scheduled'
```
- Default status: `'scheduled'`
- Index: `idx_upcoming_orders_status`
- Special status: `'processed'` - indicates order has been copied to orders table

---

### 8. **Key Processing Functions**

#### `syncCurrentOrderToUpcoming()`
- **Purpose**: Saves client's active order to upcoming_orders
- **Status**: Creates orders with status `scheduled`
- **Location**: `lib/actions.ts:3851`

#### `syncSingleOrderForDeliveryDay()`
- **Purpose**: Creates/updates a single upcoming order for a specific delivery day
- **Status**: Creates with status `scheduled`
- **Location**: `lib/actions.ts:2485`

#### `processUpcomingOrders()`
- **Purpose**: Moves upcoming orders to orders table when take_effect_date is reached
- **Status**: Creates orders with status `pending`
- **Location**: `lib/actions.ts:4221`

#### `saveDeliveryProofUrlAndProcessOrder()`
- **Purpose**: Processes upcoming orders with delivery proof
- **Status**: Moves to orders with status `completed`
- **Location**: `lib/actions.ts` (referenced in delivery actions)

---

### 9. **Billing Integration**

#### Billing Record Creation
- **Created during**: `process-weekly-orders` endpoint
- **Status**: `'request sent'`
- **Location**: `app/api/process-weekly-orders/route.ts:1099-1111`

#### Billing Status Updates
- When delivery proof is uploaded, billing record may be created/updated
- Status can be: `'success'`, `'failed'`, `'pending'`, `'request sent'`

---

### 10. **Critical Processing Points**

#### Weekly Order Processing Flow
```
1. User saves order → upcoming_orders (status: scheduled)
2. Weekly processing runs → copies to orders (status: pending)
3. Order confirmed → status: confirmed
4. Delivery completed → status: completed OR waiting_for_proof
5. Proof uploaded → status: billing_pending
6. Billing processed → order lifecycle complete
```

#### Stop Creation
- Stops are created/updated during:
  - `process-weekly-orders` (for all processed orders)
  - `createOrUpdateStopForOrder()` function
- Stops link to orders via `order_id` field
- Only active statuses create stops

---

### 11. **Status Validation and Constraints**

#### Current Issues
1. **Type Definition Gap**: `scheduled` status is used extensively but not in TypeScript `OrderStatus` type
2. **No Database Constraints**: Status field accepts any string value
3. **Status Consistency**: Multiple code paths can set status, need to ensure consistency

#### Recommendations
1. Add `'scheduled'` to `OrderStatus` type definition
2. Consider adding database check constraint for valid statuses
3. Centralize status transition logic
4. Add status validation before updates

---

### 12. **Status Query Patterns**

#### Common Queries

**Get active orders**:
```typescript
status IN ('pending', 'confirmed')
```

**Get upcoming orders**:
```typescript
status = 'scheduled' AND status != 'processed'
```

**Get orders for routes**:
```typescript
status IN ('pending', 'scheduled', 'confirmed')
```

**Get completed orders**:
```typescript
status = 'completed'
```

**Get billing pending**:
```typescript
status = 'billing_pending'
```

---

## Summary

### Order Processing Flow
1. **Creation**: Orders created in `upcoming_orders` with status `scheduled`
2. **Processing**: Weekly processing moves orders to `orders` table with status `pending`
3. **Confirmation**: Manual or automatic confirmation sets status to `confirmed`
4. **Delivery**: Status changes to `completed` or `waiting_for_proof`
5. **Billing**: Status changes to `billing_pending` after proof upload
6. **Completion**: Order lifecycle complete

### Status Management
- **7 distinct statuses** used throughout the system
- **Active statuses** (`pending`, `scheduled`, `confirmed`) create route stops
- **Inactive statuses** (`completed`, `cancelled`, `waiting_for_proof`, `billing_pending`) don't create stops
- Status updates happen through multiple mechanisms (delivery proof, manual updates, automatic processing)

### Key Files
- `lib/actions.ts` - Core order processing functions
- `app/api/process-weekly-orders/route.ts` - Weekly order processing
- `app/delivery/actions.ts` - Delivery proof processing
- `lib/types.ts` - Status type definitions
- `components/orders/OrdersList.tsx` - Status display
- `components/routes/StopPreviewDialog.tsx` - Status in routes

---

**Last Updated**: Current Date
**Status**: Complete Analysis
