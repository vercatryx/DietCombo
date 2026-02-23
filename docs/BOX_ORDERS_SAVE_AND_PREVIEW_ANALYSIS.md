# Box Orders Save and Preview Dialog Analysis

## Executive Summary

The app has **two critical issues** preventing box orders from being saved and displayed properly:

1. **Box orders saved to `client_box_orders` table are NOT being loaded** when initializing client profiles in the main codebase
2. **The preview dialog does NOT display box order details** - it only shows basic order information

## Issue 1: Box Orders Not Being Loaded from Database

### Root Cause
When box orders are saved via `saveClientBoxOrder()` in `lib/actions.ts`, they are correctly saved to the `client_box_orders` table. However, when loading client data, the app does NOT fetch box orders from `client_box_orders` and merge them into the `orderConfig.boxOrders` array.

### Current Flow (Broken)
1. ✅ User creates box order in UI → `orderConfig.boxOrders` array is populated
2. ✅ User saves → `saveClientBoxOrder()` saves to `client_box_orders` table
3. ✅ `syncCurrentOrderToUpcoming()` saves to `upcoming_orders` table and `clients.active_order` JSON field
4. ❌ **When reloading client**: Box orders from `client_box_orders` are NOT loaded
5. ❌ **Result**: Box orders appear empty/missing when client profile is reopened

### Where Box Orders Should Be Loaded

#### Function: `getClient()` in `lib/actions.ts`
- **Location**: Line ~1022
- **Current behavior**: Only loads from `clients` table, doesn't load `client_box_orders`
- **Fix needed**: After loading client, fetch box orders and merge into `client.activeOrder.boxOrders`

#### Function: `getClientFullDetails()` in `lib/actions.ts`
- **Location**: Line ~4825
- **Current behavior**: Loads client, history, etc., but doesn't load `client_box_orders`
- **Fix needed**: Call `getClientBoxOrder()` and merge box orders into `activeOrder.boxOrders`

#### Function: `loadData()` in `components/clients/ClientProfile.tsx`
- **Location**: Line ~850
- **Current behavior**: Only uses box orders from `upcomingOrder`, `activeOrder`, or `client.activeOrder`
- **Fix needed**: Also load from `client_box_orders` table if no box orders found in other sources

### Existing Function (NOT Being Used)
There IS a function `getClientBoxOrder()` in `lib/actions.ts` (line 6597) that correctly loads box orders from `client_box_orders`:
```typescript
export async function getClientBoxOrder(clientId: string): Promise<ClientBoxOrder[]>
```

**This function exists but is NEVER called** in the main codebase when loading client data. It's only used in `triangleorder` version.

### Expected Fix
1. Call `getClientBoxOrder(clientId)` when loading client data
2. Convert the returned `ClientBoxOrder[]` to `boxOrders` format:
   ```typescript
   const boxOrdersFromDb = await getClientBoxOrder(clientId);
   if (boxOrdersFromDb.length > 0) {
       const boxOrders = boxOrdersFromDb.map(bo => ({
           boxTypeId: bo.boxTypeId,
           vendorId: bo.vendorId,
           quantity: bo.quantity,
           items: bo.items || {},
           itemNotes: bo.itemNotes || {}
       }));
       // Merge into activeOrder.boxOrders or orderConfig.boxOrders
   }
   ```

## Issue 2: Preview Dialog Not Showing Box Order Details

### Root Cause
The `StopPreviewDialog` component (`components/routes/StopPreviewDialog.tsx`) only displays basic order information (Order ID, Order Number, Order Date, Delivery Date, Status, etc.). It does NOT display box order details such as:
- Box type
- Box quantity
- Box items with quantities
- Item notes

### Current Preview Dialog Display
The dialog shows:
- ✅ Stop Information (name, address, phone)
- ✅ Order Information (ID, number, dates, status)
- ✅ Delivery Information (driver, stop order, coordinates)
- ✅ Special Notes (dislikes)
- ❌ **Box Order Details** (MISSING)

### Expected Fix
Add a new section to display box order details when the order is a Boxes service type:
```typescript
{stop.order?.serviceType === 'Boxes' && stop.order?.boxOrders && (
    <Box>
        <Typography variant="subtitle2">Box Order Details</Typography>
        {stop.order.boxOrders.map((box, idx) => (
            <Box key={idx}>
                <Typography>Box Type: {getBoxTypeName(box.boxTypeId)}</Typography>
                <Typography>Quantity: {box.quantity}</Typography>
                {box.items && Object.keys(box.items).length > 0 && (
                    <Box>
                        <Typography>Items:</Typography>
                        {Object.entries(box.items).map(([itemId, qty]) => (
                            <Typography key={itemId}>
                                - {getMenuItemName(itemId)}: {qty}
                            </Typography>
                        ))}
                    </Box>
                )}
            </Box>
        ))}
    </Box>
)}
```

### Additional Issues
1. The `stop` object passed to the preview dialog may not contain box order data if it wasn't loaded properly
2. Need to ensure box orders are loaded when building the stop data for the routes page

## Data Flow Analysis

### Saving Flow (Working)
```
ClientProfile.tsx:saveBoxOrder()
  ↓
saveClientBoxOrder(clientId, boxesToSave)
  ↓
client_box_orders table (✅ Saved)
  ↓
syncCurrentOrderToUpcoming()
  ↓
upcoming_order_box_selections table (✅ Saved)
  ↓
clients.active_order JSON field (✅ Saved)
```

### Loading Flow (Broken)
```
getClient(clientId) or getClientFullDetails(clientId)
  ↓
clients table (✅ Loaded)
  ↓
client.active_order JSON field (✅ Loaded, but may be stale)
  ↓
getUpcomingOrderForClient() (✅ Loaded)
  ↓
getActiveOrderForClient() (✅ Loaded, but only from orders table)
  ↓
❌ getClientBoxOrder() (❌ NEVER CALLED)
  ↓
❌ client_box_orders table (❌ NOT LOADED)
```

## Fix Recommendations

### Priority 1: Load Box Orders from Database
1. **Modify `getClientFullDetails()`** in `lib/actions.ts`:
   - Add call to `getClientBoxOrder(clientId)`
   - Merge box orders into `activeOrder.boxOrders` if service type is Boxes

2. **Modify `getClient()`** in `lib/actions.ts`:
   - After loading client, check if service type is Boxes
   - If so, load box orders and merge into `client.activeOrder.boxOrders`

3. **Modify `loadData()`** in `components/clients/ClientProfile.tsx`:
   - Add fallback to load from `client_box_orders` if no box orders found in other sources

### Priority 2: Display Box Orders in Preview Dialog
1. **Modify `StopPreviewDialog`** component:
   - Add section to display box order details
   - Show box type, quantity, items with quantities, and item notes

2. **Ensure stop data includes box orders**:
   - Verify routes page loads box orders when building stop data
   - May need to fetch box orders separately if not included in order data

## Code Locations

### Files That Need Changes

1. **`lib/actions.ts`**
   - `getClient()` - Line ~1022 (Add box order loading)
   - `getClientFullDetails()` - Line ~4825 (Add box order loading)
   - `getClientBoxOrder()` - Line 6597 (Already exists, needs to be called)

2. **`components/clients/ClientProfile.tsx`**
   - `loadData()` - Line ~850 (Add fallback to load box orders)

3. **`components/routes/StopPreviewDialog.tsx`**
   - Entire component - Line 1-293 (Add box order display section)

4. **Routes page components** (if box orders not included in stop data)
   - `components/routes/ClientDriverAssignment.tsx`
   - `components/routes/DriversMapLeaflet.jsx`

## Testing Checklist

After fixes are implemented, verify:

- [ ] Box orders are saved to `client_box_orders` table
- [ ] Box orders are loaded when opening client profile
- [ ] Box orders appear in `orderConfig.boxOrders` array
- [ ] Box orders are displayed in the UI correctly
- [ ] Box orders show up in preview dialog with all details
- [ ] Box orders persist after page reload
- [ ] Multiple box orders are handled correctly
- [ ] Box orders with items are displayed with item details
- [ ] Item notes are displayed if present

## Related Files

- `lib/actions.ts` - Save and load functions
- `components/clients/ClientProfile.tsx` - Client profile UI
- `components/routes/StopPreviewDialog.tsx` - Preview dialog
- `lib/cached-data.ts` - Cache wrapper functions
- `prisma/schema.prisma` - Database schema (confirms `client_box_orders` table structure)

## Notes

- The `triangleorder` version appears to have some of these fixes (based on grep results)
- The main codebase should be updated to match the working pattern
- Box orders use a dual-storage approach: `client_box_orders` table (persistent) and `clients.active_order` JSON field (for quick access)
