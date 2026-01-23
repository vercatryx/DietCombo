# Order Status Analysis

## Overview
This document identifies all order statuses used in the DietCombo application and how they are utilized throughout the system.

## Defined Order Statuses

### Primary Status Types (from `lib/types.ts`)
The TypeScript type definition specifies these statuses:

1. **`pending`** - Order is pending confirmation
2. **`confirmed`** - Order has been confirmed
3. **`completed`** - Order has been completed/delivered
4. **`waiting_for_proof`** - Waiting for proof of delivery
5. **`billing_pending`** - Order is pending billing
6. **`cancelled`** - Order has been cancelled

### Additional Status Used in Code
7. **`scheduled`** - Order is scheduled for delivery (used for upcoming orders and active orders)

**Note:** While `scheduled` is not in the TypeScript type definition, it is extensively used throughout the codebase, particularly for:
- `upcoming_orders` table (default status)
- Active orders that are scheduled for delivery
- Route creation logic

## Status Usage by Component

### 1. Orders List (`components/orders/OrdersList.tsx`)
- Displays all order statuses with color-coded badges
- Status formatting: Replaces underscores with spaces and uppercases (e.g., `waiting_for_proof` → `WAITING FOR PROOF`)
- CSS classes for styling:
  - `statusPending` - Orange/warning color
  - `statusConfirmed` - Green color
  - `statusCompleted` - Green/success color
  - `statusWaitProof` - Purple/accent color
  - `statusBilling` - Orange/warning color
  - `statusCancelled` - Red/danger color

### 2. Route Creation (`app/api/route/cleanup/route.ts` & `app/api/route/routes/route.ts`)
**Active Order Statuses** (orders that create stops for routes):
- `pending`
- `scheduled`
- `confirmed`

Orders with these statuses will:
- Create stops in the routes system
- Appear on the routes map
- Be assigned to drivers

**Inactive Order Statuses** (orders that do NOT create stops):
- `completed` - Already delivered
- `cancelled` - Order cancelled
- `waiting_for_proof` - Awaiting proof
- `billing_pending` - In billing process

### 3. Stop Preview Dialog (`components/routes/StopPreviewDialog.tsx`)
Color coding for order statuses:
- `cancelled` - Red (#ef4444)
- `waiting_for_proof` - Orange/Amber (#f59e0b)
- `billing_pending` - Purple (#8b5cf6)
- `completed` - Green (#16a34a)
- `pending`, `scheduled`, `confirmed` - Blue (#3b82f6)
- Default/Unknown - Gray (#6b7280)

### 4. Client Driver Assignment (`components/routes/ClientDriverAssignment.tsx`)
Special color handling:
- `cancelled` - Red (#ef4444)
- `waiting_for_proof` - Orange/Amber (#f59e0b)
- `billing_pending` - Purple (#8b5cf6)
- `completed`, `pending`, `scheduled`, `confirmed` - Default styling (no special color)

### 5. Orders Page Visibility (`ORDERS_PAGE_VISIBILITY_CONDITIONS.md`)
Orders appear on `/orders` page if:
- Status is NOT `billing_pending` (billing pending orders belong on billing page)
- Order has a `scheduled_delivery_date`
- Order is in the `orders` table (not just `upcoming_orders`)

## Database Schema

### `orders` Table
- Column: `status VARCHAR(50) NOT NULL DEFAULT 'pending'`
- Index: `idx_orders_status` on `status` column
- No check constraint (flexible - can accept any text value)

### `upcoming_orders` Table
- Column: `status VARCHAR(50) NOT NULL DEFAULT 'scheduled'`
- Index: `idx_upcoming_orders_status` on `status` column
- Default status is `'scheduled'` for all upcoming orders

## Status Flow

### Typical Order Lifecycle
1. **`scheduled`** - Order created in `upcoming_orders` table
2. **`pending`** - Order moved to `orders` table, awaiting confirmation
3. **`confirmed`** - Order confirmed and ready for delivery
4. **`completed`** - Order delivered successfully
5. **`waiting_for_proof`** - Delivery completed, awaiting proof upload
6. **`billing_pending`** - Ready for billing process

### Alternative Flows
- **Cancellation**: Order can be set to `cancelled` at any point
- **Direct to Billing**: Order can go from `completed` → `billing_pending`

## Key Files Referencing Order Status

1. **Type Definition**: `lib/types.ts` - Defines `OrderStatus` type
2. **Orders List**: `components/orders/OrdersList.tsx` - Displays and formats statuses
3. **Order Detail**: `components/orders/OrderDetailView.tsx` - Shows status in detail view
4. **Route Cleanup**: `app/api/route/cleanup/route.ts` - Filters by active statuses
5. **Route Routes**: `app/api/route/routes/route.ts` - Includes order status in stop data
6. **Stop Preview**: `components/routes/StopPreviewDialog.tsx` - Displays order status
7. **Client Assignment**: `components/routes/ClientDriverAssignment.tsx` - Color codes by status
8. **Map Component**: `components/routes/DriversMapLeaflet.jsx` - Shows status on map

## Recommendations

1. **Update Type Definition**: Consider adding `'scheduled'` to the `OrderStatus` type in `lib/types.ts` since it's widely used
2. **Status Consistency**: Ensure all components handle the same set of statuses consistently
3. **Documentation**: The status flow should be documented for developers working with orders

## Summary

The app uses **7 distinct order statuses**:
- 6 defined in TypeScript types
- 1 additional (`scheduled`) used extensively but not in type definition

**Active statuses** (create routes): `pending`, `scheduled`, `confirmed`
**Inactive statuses** (don't create routes): `completed`, `cancelled`, `waiting_for_proof`, `billing_pending`
