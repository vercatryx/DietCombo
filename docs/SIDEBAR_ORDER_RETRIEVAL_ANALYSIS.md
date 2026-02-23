# Sidebar Order Retrieval Analysis

## Overview
This document analyzes how the `SidebarActiveOrderSummary` component in the `/clients` page retrieves and displays the current order of a client and its items.

## Component Flow

### 1. Component Location
- **File**: `components/SidebarActiveOrderSummary.tsx`
- **Usage**: Rendered in `components/Sidebar.tsx` (line 862) when sidebar is not collapsed
- **Condition**: Only displays when on `/clients/[id]` route

### 2. Client ID Extraction
```typescript
// Line 19-20 in SidebarActiveOrderSummary.tsx
const clientIdMatch = pathname.match(/\/clients\/([^\/]+)/);
const clientId = clientIdMatch ? clientIdMatch[1] : null;
```
- Extracts client ID from the URL pathname using regex
- Returns `null` if not on a client detail page

### 3. Data Fetching Process

#### Step 1: Fetch Client Data
```typescript
// Lines 31-36 in SidebarActiveOrderSummary.tsx
const [clientData, vendorsData, menuItemsData, boxTypesData] = await Promise.all([
    getClient(clientId),
    getVendors(),
    getMenuItems(),
    getBoxTypes()
]);
```

#### Step 2: getClient() Function Flow
**Location**: `lib/actions.ts` (line 1023)

1. **Database Query**:
   ```typescript
   const { data, error } = await supabase
       .from('clients')
       .select('*')
       .eq('id', id)
       .single();
   ```

2. **Mapping from Database**:
   - Uses `mapClientFromDB()` function (line 936)
   - Maps `active_order` JSON column directly from database:
     ```typescript
     const activeOrder = c.active_order || {};
     ```
   - The `activeOrder` is stored as a JSON column in the `clients` table

3. **Special Handling for Box Orders**:
   - If `client.serviceType === 'Boxes'`, additional data is loaded:
     ```typescript
     const boxOrdersFromDb = await getClientBoxOrder(id);
     ```
   - **Location**: `lib/actions.ts` (line 7049)
   - Queries `client_box_orders` table:
     ```typescript
     const { data, error } = await supabase
         .from('client_box_orders')
         .select('*')
         .eq('client_id', clientId);
     ```
   - Merges box orders into `client.activeOrder.boxOrders` array

### 4. Active Order Structure

The `activeOrder` object can have different structures depending on service type:

#### For Food Service:
```typescript
{
    serviceType: 'Food',
    vendorSelections: [
        {
            vendorId: string,
            items: {
                [itemId: string]: number  // quantity
            }
        }
    ],
    deliveryDayOrders?: {  // Multi-day format
        [day: string]: {
            vendorSelections: [...]
        }
    }
}
```

#### For Boxes Service:
```typescript
{
    serviceType: 'Boxes',
    boxOrders: [  // NEW format (from client_box_orders table)
        {
            boxTypeId: string,
            vendorId: string,
            quantity: number,
            items: {
                [itemId: string]: number | { quantity: number, price: number }
            },
            itemNotes: { [itemId: string]: string }
        }
    ],
    // OR legacy format:
    vendorId?: string,
    boxTypeId?: string,
    items?: { [itemId: string]: number }
}
```

### 5. Order Summary Generation

**Function**: `getOrderSummary()` in `SidebarActiveOrderSummary.tsx` (line 84)

#### For Food Orders:
1. Extracts vendor selections from `activeOrder.vendorSelections` or `activeOrder.deliveryDayOrders`
2. Counts items per vendor
3. Displays vendor names with item counts
4. Shows meal limit if `approvedMealsPerWeek > 0`

#### For Box Orders:
1. **Priority 1**: Checks `activeOrder.boxOrders` array (new format)
   - Iterates through each box order
   - Extracts vendor IDs and items
   - Handles items stored as JSON strings (parses if needed)
   - Supports both quantity formats:
     - Simple: `{ itemId: 2 }`
     - Complex: `{ itemId: { quantity: 2, price: 10 } }`

2. **Priority 2**: Falls back to legacy format
   - Checks `activeOrder.vendorId` and `activeOrder.boxTypeId`
   - Checks nested day-based structure
   - Falls back to `activeOrder.items` if boxOrders is empty

3. **Item Aggregation**:
   - Aggregates quantities if same item appears in multiple boxes
   - Maps item IDs to menu item names using `menuItems` array
   - Displays as: `"Item Name x2, Another Item x3"`

### 6. Data Sources Summary

| Data Type | Source | Table/Column |
|-----------|--------|--------------|
| Client Profile | `getClient(clientId)` | `clients` table |
| Active Order (JSON) | `clients.active_order` | JSON column in `clients` table |
| Box Orders (Boxes only) | `getClientBoxOrder(clientId)` | `client_box_orders` table |
| Vendors | `getVendors()` | `vendors` table |
| Menu Items | `getMenuItems()` | `menu_items` table |
| Box Types | `getBoxTypes()` | `box_types` table |

### 7. Key Points

1. **Primary Source**: The `activeOrder` is primarily stored in the `clients.active_order` JSON column
2. **Box Orders Enhancement**: For Boxes service type, additional data is loaded from `client_box_orders` table and merged
3. **No Direct Order Table Query**: The sidebar component does NOT query the `orders` table directly. It relies on the `activeOrder` JSON stored in the client record
4. **Format Flexibility**: The component handles multiple order formats:
   - Single-day Food orders
   - Multi-day Food orders (`deliveryDayOrders`)
   - New Box orders format (`boxOrders` array)
   - Legacy Box orders format
5. **Item Resolution**: Item IDs are resolved to names using the `menuItems` array fetched separately
6. **Vendor Resolution**: Vendor IDs are resolved to names using the `vendors` array

### 8. Differences from `getActiveOrderForClient()`

There's also a `getActiveOrderForClient()` function in `lib/actions.ts` (line 4387) that:
- Queries the `orders` table directly
- Fetches related data from `order_vendor_selections`, `order_items`, `order_box_selections`
- Returns actual order records from the orders table

**However**, the sidebar component does NOT use this function. It uses `getClient()` which only reads from the `clients.active_order` JSON column.

### 9. Caching

The sidebar component does NOT use the cached data functions from `lib/cached-data.tsx`. It directly calls:
- `getClient()` from `lib/actions.ts` (not cached)
- `getVendors()`, `getMenuItems()`, `getBoxTypes()` from `lib/actions.ts` (not cached)

This means the sidebar makes fresh database queries each time the component mounts or the clientId changes.

## Summary

The sidebar preview component retrieves the current order through this flow:

1. **Extract client ID** from URL pathname
2. **Fetch client data** via `getClient(clientId)` which:
   - Queries `clients` table
   - Extracts `active_order` JSON column
   - For Boxes: additionally queries `client_box_orders` table
3. **Fetch reference data** (vendors, menu items, box types) in parallel
4. **Process activeOrder** to extract vendor and item information
5. **Display summary** showing service type, vendors, and items

The key insight is that the sidebar uses the `activeOrder` JSON stored directly in the client record, not the `orders` table. This is a snapshot/configuration of the current order, not the actual order records.
