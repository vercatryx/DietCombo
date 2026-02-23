# Recent Orders Functionality Analysis

## Overview

This document analyzes how the "Recent Orders" feature works in the DietCombo application. The `/triangleorder` folder is not present in the current workspace (it's in `.gitignore`), but this analysis covers the current implementation and references to triangleorder patterns.

## Current Implementation

### 1. Core Function: `getRecentOrdersForClient`

**Location:** `lib/actions.ts` (lines 4851-5076)

**Purpose:** Retrieves the most recent orders from the `orders` table for a specific client.

**Key Features:**
- Queries the `orders` table filtered by `client_id`
- Orders results by `created_at` in descending order (most recent first)
- Default limit: 3 orders (configurable via `limit` parameter)
- Returns `null` if no orders found or on error

**Function Signature:**
```typescript
export async function getRecentOrdersForClient(clientId: string, limit: number = 3)
```

**Return Structure:**
```typescript
{
    orders: OrderConfig[],  // Array of processed order configurations
    multiple: true           // Flag indicating it's a list of orders
}
```

### 2. Data Retrieval Process

The function performs the following steps:

#### Step 1: Query Orders Table
```typescript
const { data: ordersData } = await supabase
    .from('orders')
    .select('*')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(limit);
```

#### Step 2: Fetch Related Data
- Menu items (`getMenuItems()`)
- Vendors (`getVendors()`)
- Box types (`getBoxTypes()`)

#### Step 3: Process Each Order

For each order, the function builds a comprehensive `orderConfig` object:

**Base Order Properties:**
- `id`: Order UUID
- `serviceType`: 'Food', 'Boxes', or 'Equipment'
- `caseId`: Associated case ID
- `status`: Order status (pending, confirmed, processing, completed, etc.)
- `lastUpdated`: Timestamp of last update
- `updatedBy`: User who last updated
- `scheduledDeliveryDate`: Scheduled delivery date
- `createdAt`: Order creation timestamp
- `deliveryDistribution`: JSON object for delivery schedule
- `totalValue`: Total order value
- `totalItems`: Total number of items
- `notes`: Order notes
- `deliveryDay`: Delivery day
- `isUpcoming`: Always `false` for recent orders
- `orderNumber`: Order number (if assigned)
- `proofOfDelivery`: URL to proof of delivery image

#### Step 4: Fetch Vendor Selections (Food Orders)

For Food service orders:
- Queries `order_vendor_selections` table
- For each vendor selection, queries `order_items` table
- Builds `vendorSelections` array with:
  - `id`: Vendor selection ID
  - `vendorId`: Vendor ID
  - `selectedDeliveryDays`: Array of delivery days
  - `items`: Map of `menu_item_id -> quantity`
  - `itemNotes`: Map of `menu_item_id -> notes`
  - `itemsByDay`: Multi-day items structure (new format)
  - `itemNotesByDay`: Multi-day notes structure (new format)

#### Step 5: Fetch Box Selections (Box Orders)

For Boxes service orders:
- Queries `order_box_selections` table
- Queries `order_items` table for box items (where `vendor_selection_id` is null)

**Priority System for Box Items:**
1. **Priority 1:** Items from `order_items` table (primary source)
2. **Priority 2:** Fallback to JSON field in `order_box_selections.items` if table is empty

**Box Order Structure:**
```typescript
boxOrders: [{
    boxTypeId: string,
    vendorId: string,
    quantity: number,
    items: { [itemId: string]: number },
    itemNotes: { [itemId: string]: string }
}]
```

**Backward Compatibility:**
- If only one box, also sets top-level properties:
  - `boxTypeId`
  - `vendorId`
  - `boxQuantity`
  - `items`
  - `itemPrices` (if custom prices exist)

### 3. Caching Layer

**Location:** `lib/cached-data.ts` (lines 262-271)

**Implementation:**
- Uses in-memory cache (`recentOrdersCache` Map)
- Cache key format: `${clientId}_${limit}`
- Cache duration: `CACHE_DURATION.ORDER_DATA` (defined in cached-data.ts)
- Cache invalidation: Called via `invalidateOrderData(clientId)`

**Cache Flow:**
1. Check if cached data exists and is not stale
2. If valid, return cached data
3. If stale/missing, call server function `serverGetRecentOrdersForClient`
4. Store result in cache with timestamp
5. Return data

### 4. UI Display Components

#### 4.1 ClientProfile Component

**Location:** `components/clients/ClientProfile.tsx` (lines 5288-5595)

**Features:**
- Displays "Recent Orders" section with Calendar icon
- Shows loading state while fetching
- Handles both single order (backward compatibility) and multiple orders
- Displays order details grouped by service type

**Order Display Structure:**
- **Header Section:**
  - Order number (clickable link to `/orders/{id}`)
  - Scheduled delivery date
  - Proof of delivery link (if available)
  - Status indicator

- **Food Orders:**
  - Vendor name
  - Items grouped by vendor
  - Item quantities displayed

- **Box Orders:**
  - Vendor name
  - Box type and quantity
  - Items list with quantities
  - Supports multiple boxes per order

- **Equipment Orders:**
  - Vendor name
  - Equipment name
  - Price display

**Empty State:**
- Shows "No recent orders." message when no orders exist

#### 4.2 ClientPortalInterface Component

**Location:** `components/clients/ClientPortalInterface.tsx` (lines 2066-2270)

**Similar Features:**
- Same structure as ClientProfile
- Uses `previousOrders` prop (from `getOrderHistory` or `getRecentOrdersForClient`)
- Displays actual delivery date in addition to scheduled date
- Shows total value for orders

**Data Source:**
- Receives `previousOrders` from parent component
- Parent fetches via `getOrderHistory(id)` or `getRecentOrdersForClient(id)`

### 5. Data Flow

```
User Opens Client Profile
    ↓
Component Calls getRecentOrdersForClient(clientId, 3)
    ↓
Check Cache (cached-data.ts)
    ↓
If Cache Miss/Stale:
    ↓
Query Supabase orders table
    ↓
For Each Order:
    ├─ Fetch vendor_selections (Food)
    ├─ Fetch order_items (Food & Boxes)
    └─ Fetch box_selections (Boxes)
    ↓
Build OrderConfig Objects
    ↓
Return { orders: [...], multiple: true }
    ↓
Store in Cache
    ↓
Display in UI Component
```

### 6. Key Differences: Recent Orders vs Active Order vs Upcoming Order

| Feature | Recent Orders | Active Order | Upcoming Order |
|---------|--------------|--------------|----------------|
| **Source Table** | `orders` | `orders` | `upcoming_orders` |
| **Status Filter** | All statuses | `pending`, `confirmed`, `processing` | `scheduled` |
| **Time Filter** | None (all time) | Current week | Future orders |
| **Limit** | 3 (default) | 1 per delivery day | 1 per delivery day |
| **Purpose** | Historical view | Current week's orders | Future scheduled orders |
| **isUpcoming Flag** | `false` | `false` | `true` |

### 7. Order Number Display

**Current Implementation:**
- Displays `order.orderNumber` if available
- Falls back to "Order {index + 1}" if no order number
- Order number is a separate field from the UUID `id`

**Note:** According to `TRIANGLEORDER_ORDER_NUMBER_ANALYSIS.md`, triangleorder may display the UUID `id` as the order number in some contexts, but the current implementation uses the `order_number` field.

### 8. Error Handling

**In `getRecentOrdersForClient`:**
- Returns `null` on error
- Logs errors to console
- Gracefully handles missing related data (vendors, items, box types)

**In UI Components:**
- Shows loading state during fetch
- Shows empty state if `null` or empty array
- Handles missing order properties gracefully

### 9. Performance Considerations

1. **Caching:** Reduces database queries for frequently accessed data
2. **Parallel Processing:** Uses `Promise.all()` to process multiple orders concurrently
3. **Limit Parameter:** Default limit of 3 prevents loading too much data
4. **Selective Queries:** Only fetches related data when needed (vendor selections, box selections)

### 10. Integration Points

**Where Recent Orders Are Used:**
1. `components/clients/ClientProfile.tsx` - Admin view
2. `components/clients/ClientPortalInterface.tsx` - Client portal view
3. `app/client-portal/[id]/page.tsx` - Client portal page (fetches via `getOrderHistory`)

**Related Functions:**
- `getActiveOrderForClient()` - Gets current week's orders
- `getUpcomingOrderForClient()` - Gets future scheduled orders
- `getOrderHistory()` - Gets full order history (may include recent orders)

## TriangleOrder References

Based on documentation files:

### Potential Differences in TriangleOrder

1. **Order Number Display:**
   - TriangleOrder may display UUID `id` as order number in orders table
   - Current app uses separate `order_number` field

2. **Component Structure:**
   - TriangleOrder has `ClientPortalSidebar.tsx` which may display order summaries
   - TriangleOrder has `ClientInfoShelf.tsx` which may show active order summary

3. **Data Format:**
   - TriangleOrder may have additional fields for meal types, meal categories
   - TriangleOrder supports multi-day delivery per vendor with enhanced structure

## Summary

The Recent Orders feature provides a historical view of a client's orders by:
1. Querying the `orders` table for the most recent orders
2. Enriching each order with vendor selections, items, and box selections
3. Caching results for performance
4. Displaying orders in a user-friendly format grouped by service type

The implementation supports:
- Multiple orders per client
- Food, Boxes, and Equipment service types
- Multi-vendor food orders
- Multiple boxes per order
- Proof of delivery links
- Order status and delivery dates
