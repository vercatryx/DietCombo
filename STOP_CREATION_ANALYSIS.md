# Complete Analysis: How Stops Are Created

## Executive Summary

Stops are created through **order-based logic** (migrated from schedule-based) in two main API endpoints. The system creates stops for clients who have active orders with scheduled delivery dates, ensuring that only clients with actual deliveries get stops created.

---

## 1. Primary Stop Creation Endpoints

### 1.1 `/api/route/routes` (GET)
**Location:** `app/api/route/routes/route.ts`

**Purpose:** Main route retrieval endpoint that also creates missing stops on-the-fly.

**Trigger:** Called when:
- Routes page is loaded
- User requests routes for a specific day
- Mobile app fetches routes

**Key Behavior:**
- Fetches existing routes and stops
- Identifies clients who should have stops but don't
- Creates missing stops automatically
- Returns routes with newly created stops included

### 1.2 `/api/route/cleanup` (POST)
**Location:** `app/api/route/cleanup/route.ts`

**Purpose:** Explicit stop creation endpoint for cleanup/maintenance.

**Trigger:** Called when:
- Routes dialog opens (`DriversDialog.jsx`)
- Manual cleanup is requested
- Scheduled maintenance tasks

**Key Behavior:**
- Focused solely on creating missing stops
- Returns count of stops created
- Can filter by specific day or process all days

---

## 2. Order-Based Stop Creation Logic

### 2.1 Migration History

**Before (Schedule-Based):**
- Stops created based on `schedules` table
- Client with Monday schedule → Monday stop created
- Independent of actual orders

**After (Order-Based - Current):**
- Stops created based on active orders
- Only clients with active orders get stops
- Respects order statuses (completed/cancelled orders ignored)

### 2.2 Data Sources

The system queries **two order tables**:

#### A. `orders` Table
```typescript
// Query for active orders
const { data: activeOrders } = await supabase
    .from('orders')
    .select('client_id, scheduled_delivery_date, delivery_day, status')
    .in('status', ['pending', 'scheduled', 'confirmed'])
    .not('scheduled_delivery_date', 'is', null);
```

**Active Statuses:**
- `pending` - Order is pending
- `scheduled` - Order is scheduled
- `confirmed` - Order is confirmed

**Ignored Statuses:**
- `completed` - Delivery completed
- `cancelled` - Order cancelled
- `billing_pending` - Waiting for billing
- `waiting_for_proof` - Waiting for delivery proof

#### B. `upcoming_orders` Table
```typescript
// Query for upcoming orders
const { data: upcomingOrders } = await supabase
    .from('upcoming_orders')
    .select('client_id, delivery_day, scheduled_delivery_date, status')
    .eq('status', 'scheduled')
    .or('delivery_day.not.is.null,scheduled_delivery_date.not.is.null');
```

**Key Fields:**
- `delivery_day` - Day of week (e.g., "Monday", "Tuesday")
- `scheduled_delivery_date` - Specific date (if available)
- `status` - Must be `'scheduled'`

---

## 3. Stop Eligibility Criteria

### 3.1 Client-Level Checks

A client must pass **ALL** of these checks to get a stop:

#### ✅ Check 1: Client Not Paused
```typescript
if (client.paused) {
    reasons.push("paused");
    // Skip stop creation
}
```

#### ✅ Check 2: Delivery Enabled
```typescript
const isDeliverable = (c: any) => {
    const v = c?.delivery;
    return v === undefined || v === null ? true : Boolean(v);
};

if (!isDeliverable(client)) {
    reasons.push("delivery off");
    // Skip stop creation
}
```

**Note:** Default is `true` if `delivery` is `null` or `undefined`.

#### ✅ Check 3: Has Active Order for Delivery Date
```typescript
// Get delivery dates for this client
const datesMap = clientDeliveryDates.get(clientId);
if (!datesMap || datesMap.size === 0) {
    reasons.push(`no active order for ${day}`);
    // Skip stop creation
}
```

### 3.2 Order-to-Delivery-Date Mapping

The system builds a map: `client_id → Map<delivery_date, { deliveryDate, dayOfWeek }>`

#### For `orders` Table:
```typescript
// Process active orders - use scheduled_delivery_date directly
for (const order of activeOrders || []) {
    if (!order.scheduled_delivery_date) continue;
    
    const clientId = String(order.client_id);
    const deliveryDateStr = order.scheduled_delivery_date.split('T')[0]; // Get date part only
    const dayOfWeek = getDayOfWeek(order.scheduled_delivery_date);
    
    if (!dayOfWeek) continue;
    
    // Store in map
    datesMap.set(deliveryDateStr, { deliveryDate: deliveryDateStr, dayOfWeek });
}
```

#### For `upcoming_orders` Table:
```typescript
// Process upcoming orders - calculate delivery_date from delivery_day or use scheduled_delivery_date
for (const order of upcomingOrders || []) {
    const clientId = String(order.client_id);
    let deliveryDateStr: string | null = null;
    let dayOfWeek: string | null = null;
    
    if (order.scheduled_delivery_date) {
        // Use scheduled_delivery_date if available
        deliveryDateStr = order.scheduled_delivery_date.split('T')[0];
        dayOfWeek = getDayOfWeek(order.scheduled_delivery_date);
    } else if (order.delivery_day) {
        // Calculate next occurrence of delivery_day
        const nextDate = getNextOccurrence(order.delivery_day, currentTime);
        if (nextDate) {
            deliveryDateStr = nextDate.toISOString().split('T')[0];
            dayOfWeek = getDayOfWeek(deliveryDateStr);
        }
    }
    
    if (!deliveryDateStr || !dayOfWeek) continue;
    
    // Store in map
    datesMap.set(deliveryDateStr, { deliveryDate: deliveryDateStr, dayOfWeek });
}
```

**Key Function:** `getNextOccurrence()` from `lib/order-dates.ts`
- Finds the next occurrence of a day of week (0-6 days ahead)
- Does NOT skip weeks or check cutoffs
- Returns `Date` object or `null`

---

## 4. Stop Creation Process

### 4.1 Identifying Missing Stops

```typescript
// Build map of existing stops by client_id and delivery_date
const clientStopsByDate = new Map<string, Set<string>>();
for (const s of (existingStops || [])) {
    if (s.client_id && s.delivery_date) {
        const clientId = String(s.client_id);
        if (!clientStopsByDate.has(clientId)) {
            clientStopsByDate.set(clientId, new Set());
        }
        clientStopsByDate.get(clientId)!.add(s.delivery_date);
    }
}
```

### 4.2 Building Stop Creation List

```typescript
const stopsToCreate: Array<{
    id: string;
    day: string;
    delivery_date: string;
    client_id: string;
    name: string;
    address: string;
    apt: string | null;
    city: string;
    state: string;
    zip: string;
    phone: string | null;
    lat: number | null;
    lng: number | null;
}> = [];

for (const client of allClients || []) {
    const clientId = String(client.id);
    
    // Check eligibility (paused, delivery, etc.)
    if (client.paused || !isDeliverable(client)) {
        continue;
    }
    
    // Get delivery dates for this client
    const datesMap = clientDeliveryDates.get(clientId);
    if (!datesMap || datesMap.size === 0) {
        continue; // No active orders
    }
    
    // Get existing stops for this client
    const existingStopDates = clientStopsByDate.get(clientId) || new Set<string>();
    
    // Create a stop for each unique delivery date
    for (const [deliveryDateStr, dateInfo] of datesMap.entries()) {
        // Skip if stop already exists for this delivery date
        if (existingStopDates.has(deliveryDateStr)) {
            continue;
        }
        
        // If filtering by specific day, only create stops for that day
        if (day !== "all" && dateInfo.dayOfWeek !== day.toLowerCase()) {
            continue;
        }
        
        // Client should have a stop for this delivery date - create it
        const name = `${client.first_name || ""} ${client.last_name || ""}`.trim() || "Unnamed";
        stopsToCreate.push({
            id: uuidv4(),
            day: dateInfo.dayOfWeek, // Keep day for backward compatibility
            delivery_date: deliveryDateStr,
            client_id: clientId,
            name: name || "(Unnamed)",
            address: s(client.address),
            apt: client.apt ? s(client.apt) : null,
            city: s(client.city),
            state: s(client.state),
            zip: s(client.zip),
            phone: client.phone_number ? s(client.phone_number) : null,
            lat: n(client.lat),
            lng: n(client.lng),
        });
    }
}
```

### 4.3 Database Insertion

```typescript
// Insert stops one at a time to handle duplicates gracefully
for (const stopData of stopsToCreate) {
    try {
        const { error: insertError } = await supabase
            .from('stops')
            .upsert({
                id: stopData.id,
                day: stopData.day,
                delivery_date: stopData.delivery_date,
                client_id: stopData.client_id,
                name: stopData.name,
                address: stopData.address,
                apt: stopData.apt,
                city: stopData.city,
                state: stopData.state,
                zip: stopData.zip,
                phone: stopData.phone,
                lat: stopData.lat,
                lng: stopData.lng,
            }, { onConflict: 'id' });
        if (insertError) throw insertError;
    } catch (createError: any) {
        // Skip if stop already exists (duplicate key)
        if (createError?.code !== "23505" && !createError?.message?.includes('duplicate')) {
            console.error(`Failed to create stop for client ${stopData.client_id}:`, createError?.message);
        }
    }
}
```

**Key Points:**
- Uses `upsert` with `onConflict: 'id'` to handle duplicates
- Inserts one at a time for error handling
- Ignores duplicate key errors (PostgreSQL code `23505`)
- Copies data from client record (denormalized)

---

## 5. Database Schema

### 5.1 Stops Table Structure

```sql
CREATE TABLE IF NOT EXISTS stops (
    id VARCHAR(36) PRIMARY KEY,
    day VARCHAR(20) NOT NULL,                    -- Day of week (e.g., "monday")
    delivery_date DATE NULL,                     -- Specific delivery date (NEW)
    client_id VARCHAR(36) NULL,
    "order" INTEGER NULL,                        -- Order in route (not used currently)
    name VARCHAR(255) NOT NULL,                 -- Client name (denormalized)
    address VARCHAR(500) NOT NULL,              -- Address (denormalized)
    apt VARCHAR(50) NULL,
    city VARCHAR(100) NOT NULL,
    state VARCHAR(2) NOT NULL,
    zip VARCHAR(10) NOT NULL,
    phone VARCHAR(20) NULL,
    dislikes TEXT NULL,
    lat DOUBLE PRECISION NULL,
    lng DOUBLE PRECISION NULL,
    completed BOOLEAN DEFAULT FALSE,
    proof_url VARCHAR(500) NULL,
    assigned_driver_id VARCHAR(36) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### 5.2 Key Indexes

```sql
-- Index on day for filtering
CREATE INDEX idx_stops_day ON stops(day);

-- Index on delivery_date for date-based queries
CREATE INDEX idx_stops_delivery_date ON stops(delivery_date);

-- Index on client_id for client lookups
CREATE INDEX idx_stops_client_id ON stops(client_id);

-- Unique constraint: one stop per client per delivery_date
CREATE UNIQUE INDEX idx_stops_client_delivery_date 
ON stops(client_id, delivery_date) 
WHERE delivery_date IS NOT NULL;
```

**Important:** The unique index ensures:
- One stop per client per delivery date
- Multiple stops per client for different dates (allowed)
- Backward compatibility with `day` field (not unique)

---

## 6. Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Client Has Active Order                                  │
│    - orders table: status IN ('pending', 'scheduled',       │
│      'confirmed')                                            │
│    - upcoming_orders table: status = 'scheduled'            │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Extract Delivery Date                                    │
│    - From scheduled_delivery_date (if available)            │
│    - From delivery_day using getNextOccurrence()           │
│    - Calculate day of week                                  │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. Check Client Eligibility                                 │
│    - Not paused?                                            │
│    - Delivery enabled?                                      │
│    - Has order for target day?                              │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. Check Existing Stops                                      │
│    - Query stops table for client_id + delivery_date        │
│    - Skip if stop already exists                            │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. Create Stop Record                                       │
│    - Generate UUID                                          │
│    - Copy client data (name, address, lat/lng, etc.)        │
│    - Set day and delivery_date                              │
│    - Insert into stops table                                │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. Day Filtering Logic

### 7.1 Day Parameter

Both endpoints accept a `day` parameter:
- `"all"` - Process all days
- `"monday"`, `"tuesday"`, etc. - Process specific day

### 7.2 Filtering Behavior

```typescript
// If filtering by specific day, only create stops for that day
if (day !== "all" && dateInfo.dayOfWeek !== day.toLowerCase()) {
    continue; // Skip this delivery date
}
```

**Example:**
- Request: `GET /api/route/routes?day=monday`
- Client has orders for Monday and Wednesday
- Only Monday stop is created
- Wednesday stop is skipped (will be created when `day=wednesday`)

---

## 8. Edge Cases & Special Handling

### 8.1 Multiple Orders Same Day

**Current Behavior:**
- Multiple orders on the same delivery date → **One stop created**
- The unique index `idx_stops_client_delivery_date` prevents duplicates
- First order processed wins

**Future Enhancement:**
- Could create multiple stops or link multiple orders to one stop

### 8.2 Missing Coordinates

**Behavior:**
- Stops created with `lat: null, lng: null` if client has no coordinates
- Route optimization places these stops at the end
- Geocoding should be performed separately

### 8.3 Order Status Changes

**Scenario:** Order status changes from `scheduled` → `completed`

**Current Behavior:**
- Existing stop remains in database
- No automatic cleanup
- Stop won't be recreated (order no longer active)

**Future Enhancement:**
- Automatic cleanup job to remove stops for completed/cancelled orders

### 8.4 Delivery Date Calculation

**For `upcoming_orders` with `delivery_day` only:**
```typescript
const nextDate = getNextOccurrence(order.delivery_day, currentTime);
```

**Behavior:**
- Finds next occurrence (0-6 days ahead)
- Does NOT respect vendor cutoffs
- Does NOT skip weeks
- Always returns the immediate next occurrence

**Example:**
- Today: Wednesday
- `delivery_day`: "Monday"
- Result: Next Monday (5 days away)

### 8.5 Legacy Stops Without delivery_date

**Backward Compatibility:**
- Old stops may have `delivery_date = NULL`
- System still retrieves them
- New stops always have `delivery_date` set

---

## 9. Error Handling

### 9.1 Duplicate Key Errors

```typescript
catch (createError: any) {
    // Skip if stop already exists (duplicate key)
    if (createError?.code !== "23505" && !createError?.message?.includes('duplicate')) {
        console.error(`Failed to create stop:`, createError?.message);
    }
}
```

**PostgreSQL Error Code `23505`:** Unique violation
- Ignored silently (stop already exists)
- Prevents duplicate creation

### 9.2 Missing Data

**Client without address:**
- Uses empty string: `address: ""`
- Stop still created (may cause routing issues)

**Client without name:**
- Uses `"(Unnamed)"` as fallback

**Order without delivery date:**
- Skipped (no stop created)

---

## 10. Performance Considerations

### 10.1 Query Optimization

**Current Approach:**
- Fetches all clients (could be large)
- Fetches all orders (could be large)
- Builds in-memory maps for lookups

**Optimization Opportunities:**
- Filter clients by day before fetching
- Use database joins instead of in-memory maps
- Batch inserts instead of one-by-one

### 10.2 Index Usage

**Effective Indexes:**
- `idx_stops_client_delivery_date` - Fast duplicate checking
- `idx_stops_day` - Fast day filtering
- `idx_stops_client_id` - Fast client lookups

---

## 11. Testing Scenarios

### 11.1 Basic Stop Creation

**Test:**
1. Create order with `scheduled_delivery_date = "2024-01-15"` (Monday)
2. Call `GET /api/route/routes?day=monday`
3. **Expected:** Stop created for client on 2024-01-15

### 11.2 Upcoming Order with delivery_day

**Test:**
1. Create `upcoming_order` with `delivery_day = "Tuesday"`
2. Call `GET /api/route/routes?day=tuesday`
3. **Expected:** Stop created for next Tuesday

### 11.3 Paused Client

**Test:**
1. Create order for client
2. Set `client.paused = true`
3. Call cleanup endpoint
4. **Expected:** No stop created

### 11.4 Multiple Delivery Dates

**Test:**
1. Create orders for Monday and Wednesday
2. Call `GET /api/route/routes?day=all`
3. **Expected:** Two stops created (one per date)

### 11.5 Duplicate Prevention

**Test:**
1. Create stop manually
2. Call cleanup endpoint
3. **Expected:** No duplicate created, no error

---

## 12. Key Functions Reference

### 12.1 `getNextOccurrence()`
**Location:** `lib/order-dates.ts`

```typescript
export function getNextOccurrence(
    deliveryDay: string,
    referenceDate: Date = new Date()
): Date | null
```

**Purpose:** Find next occurrence of a day of week (0-6 days ahead)

**Returns:** `Date` object or `null`

### 12.2 `getDayOfWeek()`
**Location:** `app/api/route/routes/route.ts` (inline)

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

**Purpose:** Extract day name from date string

**Returns:** Lowercase day name (e.g., `"monday"`) or `null`

---

## 13. Summary

### 13.1 Key Takeaways

1. **Order-Based:** Stops are created from active orders, not schedules
2. **Date-Specific:** Each stop is unique per `client_id + delivery_date`
3. **Automatic:** Stops created on-demand when routes are fetched
4. **Denormalized:** Stop data copied from client record
5. **Status-Aware:** Only active order statuses create stops

### 13.2 Migration Impact

**Breaking Changes:**
- Clients with schedules but no orders → No stops created
- This is intentional (stops should reflect actual deliveries)

**Backward Compatibility:**
- Existing stops remain unchanged
- `day` field still populated for compatibility
- Legacy stops without `delivery_date` still work

### 13.3 Future Enhancements

1. **Order-Stop Linking:** Add `order_id` to stops table
2. **Automatic Cleanup:** Remove stops for completed/cancelled orders
3. **Multi-Order Stops:** Handle multiple orders on same date
4. **Batch Operations:** Optimize for large datasets
5. **Real-time Updates:** Update stops when orders change

---

## 14. Code Locations

### Primary Files:
- `app/api/route/routes/route.ts` - Main route endpoint (GET)
- `app/api/route/cleanup/route.ts` - Cleanup endpoint (POST)
- `lib/order-dates.ts` - Date calculation utilities

### Supporting Files:
- `sql/dietcombo-supabase-schema.sql` - Database schema
- `sql/add_delivery_date_to_stops.sql` - Migration script
- `STOP_CREATION_MIGRATION.md` - Migration documentation
- `ROUTE_STOPS_CALCULATION_ANALYSIS.md` - Legacy analysis (schedule-based)

---

**Document Version:** 1.0  
**Last Updated:** Based on current codebase analysis  
**Analysis Date:** 2024
