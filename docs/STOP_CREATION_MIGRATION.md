# Stop Creation Logic Migration

## Overview
Migrated the route stops creation logic from **schedule-based** (DietFantasy approach) to **order-based** (current DietCombo approach) to align with the app's delivery scheduling system.

## Changes Made

### 1. `/app/api/route/routes/route.ts` (GET endpoint)
**Before:** Stops were created based on client schedules from the `schedules` table
**After:** Stops are created based on active orders from `orders` and `upcoming_orders` tables

### 2. `/app/api/route/cleanup/route.ts` (POST endpoint)
**Before:** Stops were created based on client schedules from the `schedules` table
**After:** Stops are created based on active orders from `orders` and `upcoming_orders` tables

## Key Logic Changes

### Stop Eligibility Criteria

**Client-level checks (unchanged):**
- ✅ Client must not be `paused`
- ✅ Client must have `delivery = true` (or null/undefined defaults to true)

**Delivery day determination (CHANGED):**
- ❌ **Old:** Checked `schedules` table for delivery days (monday, tuesday, etc.)
- ✅ **New:** Determined from active orders:
  - From `orders` table: Extract day of week from `scheduled_delivery_date` OR use `delivery_day` field if present
  - From `upcoming_orders` table: Use `delivery_day` field

### Active Order Statuses
Only orders with these statuses are considered for stop creation:
- `pending`
- `scheduled`
- `confirmed`

Orders with these statuses are **ignored**:
- `completed`
- `cancelled`
- `billing_pending`
- `waiting_for_proof`

## Implementation Details

### Day of Week Extraction
For orders with `scheduled_delivery_date` but no `delivery_day`:
```typescript
const getDayOfWeek = (dateStr: string | null): string | null => {
    if (!dateStr) return null;
    try {
        const date = new Date(dateStr);
        const dayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
        return dayNames[date.getDay()];
    } catch {
        return null;
    }
};
```

### Order Data Sources

**1. Active Orders (`orders` table):**
```sql
SELECT 
    client_id,
    scheduled_delivery_date,
    delivery_day,
    status
FROM orders
WHERE status IN ('pending', 'scheduled', 'confirmed')
AND (scheduled_delivery_date IS NOT NULL OR delivery_day IS NOT NULL)
```

**2. Upcoming Orders (`upcoming_orders` table):**
```sql
SELECT 
    client_id,
    delivery_day,
    status
FROM upcoming_orders
WHERE status = 'scheduled'
AND delivery_day IS NOT NULL
```

### Stop Creation Flow

1. **Fetch all clients** with delivery information
2. **Identify clients with existing stops** for the target day
3. **Query active orders** (from both `orders` and `upcoming_orders`)
4. **Build delivery day map** (`client_id` → `Set<delivery_days>`)
   - Extract day from `scheduled_delivery_date` if `delivery_day` not present
   - Normalize day names to lowercase
5. **For each client without a stop:**
   - Check if client is paused → skip
   - Check if delivery is enabled → skip if not
   - Check if client has active order for target day → skip if not
   - Create stop if all checks pass

## Benefits of Order-Based Approach

1. **Accurate Delivery Planning:** Stops are only created for clients who actually have orders scheduled
2. **Status Awareness:** Respects order statuses (completed/cancelled orders don't create stops)
3. **Date Flexibility:** Supports both date-based (`scheduled_delivery_date`) and day-based (`delivery_day`) scheduling
4. **Upcoming Orders Support:** Includes orders that haven't been processed yet but are scheduled

## Migration Notes

### Breaking Changes
- Clients with schedules but no active orders will **no longer** get stops
- This is intentional - stops should only exist when there's an actual delivery scheduled

### Backward Compatibility
- Existing stops in the database remain unchanged
- The cleanup endpoint will remove stops for clients without active orders (over time)
- When viewing routes, existing stops will still appear until cleanup runs

### Testing Recommendations

1. **Test with active orders:**
   - Create an order with `scheduled_delivery_date` = Monday
   - Verify stop is created for Monday

2. **Test with upcoming orders:**
   - Create an upcoming_order with `delivery_day` = "Tuesday"
   - Verify stop is created for Tuesday

3. **Test status filtering:**
   - Create order with status = "completed"
   - Verify no stop is created

4. **Test client eligibility:**
   - Pause a client with active order
   - Verify no stop is created

5. **Test day extraction:**
   - Create order with `scheduled_delivery_date` = "2024-01-15" (Monday)
   - Verify stop is created for "monday"

## API Endpoints Affected

- `GET /api/route/routes?day=<day>` - Now uses order-based logic
- `POST /api/route/cleanup?day=<day>` - Now uses order-based logic
- Both endpoints maintain the same response format for backward compatibility

## Database Schema

No schema changes required. The migration only changes the **logic** used to determine which clients need stops.

## Future Enhancements

1. **Order-Stop Linking:** Add `order_id` to stops table to track which order created each stop
2. **Stop Cleanup Job:** Automatically remove stops for orders that are completed/cancelled
3. **Multi-Order Stops:** Handle cases where a client has multiple orders on the same day (currently creates one stop per client per day)
