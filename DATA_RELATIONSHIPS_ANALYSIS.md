# Data Relationships Analysis: Order ID and Client Name Tracking

## Overview
This document traces the complete data flow from database to frontend for tracking **Order ID** and **Client Name** in the routes/stops system.

---

## 1. Database Schema Relationships

### Core Tables

```
┌─────────────┐         ┌─────────────┐         ┌─────────────┐
│   clients   │◄────────│    stops    │────────►│   orders    │
└─────────────┘         └─────────────┘         └─────────────┘
     │                        │                        │
     │                        │                        │
  id (PK)              client_id (FK)           id (PK)
  first_name            order_id (FK)           client_id (FK)
  last_name             delivery_date            scheduled_delivery_date
  full_name             name (denormalized)      status
  address               address (denormalized)  created_at
  phone_number          lat/lng                  actual_delivery_date
  lat/lng
  assigned_driver_id
```

### Stops Table Structure
```sql
CREATE TABLE stops (
    id VARCHAR(36) PRIMARY KEY,
    day VARCHAR(20) NOT NULL,
    delivery_date DATE NULL,
    client_id VARCHAR(36) NULL,        -- FK → clients.id
    order_id VARCHAR(36) NULL,           -- FK → orders.id
    name VARCHAR(255) NOT NULL,          -- Denormalized client name
    address VARCHAR(500) NOT NULL,      -- Denormalized from client
    apt VARCHAR(50) NULL,
    city VARCHAR(100) NOT NULL,
    state VARCHAR(2) NOT NULL,
    zip VARCHAR(10) NOT NULL,
    phone VARCHAR(20) NULL,
    lat DOUBLE NULL,
    lng DOUBLE NULL,
    completed BOOLEAN DEFAULT FALSE,
    assigned_driver_id VARCHAR(36) NULL,
    ...
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
    UNIQUE KEY idx_stops_client_delivery_date (client_id, delivery_date)
);
```

**Key Points:**
- `stops.client_id` → Links to `clients.id`
- `stops.order_id` → Links to `orders.id` (can be NULL for upcoming orders)
- `stops.name` → Denormalized copy of client name (may be stale)
- `stops.delivery_date` → Used to match orders by date

---

## 2. API Data Flow (`/api/route/routes/route.ts`)

### Step 1: Fetch Stops
```typescript
// Fetch all stops (filtered by delivery_date if provided)
const { data: allStops } = await supabase
    .from('stops')
    .select('id, client_id, address, apt, city, state, zip, phone, lat, lng, dislikes, delivery_date, completed')
```

**Data Available:**
- `stop.id` - Stop UUID
- `stop.client_id` - Client UUID (for joining)
- `stop.delivery_date` - Used for order matching
- Denormalized fields: `address`, `apt`, `city`, `state`, `zip`, `phone`

### Step 2: Fetch Clients
```typescript
// Get unique client IDs from stops
const clientIds = Array.from(new Set(stops.map(s => s.client_id)));

// Fetch client data
const { data: clients } = await supabase
    .from('clients')
    .select('id, first_name, last_name, address, apt, city, state, zip, phone_number, lat, lng, dislikes, paused, delivery, assigned_driver_id')
    .in('id', clientIds);
```

**Data Available:**
- `client.id` - Client UUID
- `client.first_name` - **Source of client name**
- `client.last_name` - **Source of client name**
- `client.phone_number` - Live phone (preferred over stop.phone)
- `client.lat/lng` - Live coordinates (preferred over stop.lat/lng)

### Step 3: Fetch Orders
```typescript
// Fetch orders for all client IDs
const { data: orders } = await supabase
    .from('orders')
    .select('id, client_id, created_at, scheduled_delivery_date, actual_delivery_date, status, case_id')
    .in('client_id', clientIds)
    .not('status', 'eq', 'cancelled')
    .order('created_at', { ascending: false });

// Also check upcoming_orders
const { data: upcomingOrders } = await supabase
    .from('upcoming_orders')
    .select('id, client_id, created_at, scheduled_delivery_date, actual_delivery_date, status, case_id')
    .in('client_id', clientIds)
    .not('status', 'eq', 'cancelled')
    .order('created_at', { ascending: false });
```

**Data Available:**
- `order.id` - **Order ID (UUID)**
- `order.client_id` - Links to client
- `order.scheduled_delivery_date` - Used for matching
- `order.actual_delivery_date` - Actual delivery date
- `order.status` - Order status
- `order.created_at` - Order creation date

### Step 4: Build Order Maps
```typescript
// Map 1: Exact match by client_id + delivery_date
const orderMapByClientAndDate = new Map<string, any>();
// Key: "client_id|delivery_date" → order

// Map 2: Fallback to most recent order per client
const orderMapByClient = new Map<string, any>();
// Key: "client_id" → most recent order

// Build maps:
for (const order of allOrders) {
    const cid = String(order.client_id);
    
    // Store most recent order per client (fallback)
    if (!orderMapByClient.has(cid)) {
        orderMapByClient.set(cid, order);
    }
    
    // Store order by client_id + delivery_date for exact matching
    const deliveryDateStr = normalizeDate(order.scheduled_delivery_date);
    if (deliveryDateStr) {
        const key = `${cid}|${deliveryDateStr}`;
        if (!orderMapByClientAndDate.has(key)) {
            orderMapByClientAndDate.set(key, order);
        }
    }
}
```

**Matching Strategy:**
1. **Primary:** Match by `client_id + delivery_date` (exact match)
2. **Fallback:** Use most recent order for `client_id` (if no exact match)

### Step 5: Hydrate Stops with Client and Order Data
```typescript
for (const s of allStops) {
    const c = clientById.get(s.client_id);  // Get client data
    
    // Build client name from first_name + last_name
    const name = c ? `${c.first || ""} ${c.last || ""}`.trim() : "(Unnamed)";
    
    // Match order by client_id + delivery_date, or fallback to most recent
    let order = null;
    if (s.client_id) {
        const cid = String(s.client_id);
        
        // Try exact match first
        if (s.delivery_date) {
            const stopDeliveryDate = normalizeDate(s.delivery_date);
            if (stopDeliveryDate) {
                const exactKey = `${cid}|${stopDeliveryDate}`;
                order = orderMapByClientAndDate.get(exactKey) || null;
            }
        }
        
        // Fallback to most recent order
        if (!order) {
            order = orderMapByClient.get(cid) || null;
        }
    }
    
    // Build enriched stop object
    stopById.set(s.id, {
        id: s.id,
        userId: s.client_id ?? null,
        name,  // Client name from first_name + last_name
        
        // Preserve name fields for frontend
        first: c?.first || null,
        last: c?.last || null,
        first_name: c?.first || null,
        last_name: c?.last || null,
        
        // Prefer live client fields over denormalized stop fields
        address: (c?.address ?? s.address ?? "") as string,
        apt: (c?.apt ?? s.apt ?? "") as string,
        city: (c?.city ?? s.city ?? "") as string,
        state: (c?.state ?? s.state ?? "") as string,
        zip: (c?.zip ?? s.zip ?? "") as string,
        phone: (c?.phone ?? s.phone ?? "") as string,
        lat: toNum(c?.lat ?? s.lat),
        lng: toNum(c?.lng ?? s.lng),
        
        // Order tracking fields
        orderId: order?.id || null,                    // ← ORDER ID
        orderDate: order?.created_at || null,
        deliveryDate: order?.actual_delivery_date || order?.scheduled_delivery_date || null,
        orderStatus: order?.status || null,
        
        // Stop-specific fields
        completed: s.completed ?? false,
        delivery_date: s.delivery_date || null,
    });
}
```

**Key Enrichment:**
- **Client Name:** Built from `client.first_name + client.last_name`
- **Order ID:** Matched from `orders` table using `client_id + delivery_date`
- **Order Status:** Included from matched order
- **Live Data:** Prefers client table fields over denormalized stop fields

---

## 3. Frontend Consumption (`DriversMapLeaflet.jsx`)

### Data Received from API
```typescript
// Stop object structure from API:
{
    id: string,
    userId: string,           // client_id
    name: string,             // Client name (first + last)
    first: string | null,     // first_name
    last: string | null,      // last_name
    first_name: string | null,
    last_name: string | null,
    address: string,
    apt: string,
    city: string,
    state: string,
    zip: string,
    phone: string,
    lat: number,
    lng: number,
    orderId: string | null,    // ← ORDER ID (from orders table)
    orderDate: string | null, // created_at
    deliveryDate: string | null,
    orderStatus: string | null,
    completed: boolean,
    delivery_date: string | null,
}
```

### Client Name Extraction Logic
```typescript
function getClientFullName() {
    // Priority 1: Construct from first/last name directly on stop
    const first = getField(stop, 'first', 'firstName', 'first_name');
    const last = getField(stop, 'last', 'lastName', 'last_name');
    const firstLastCombined = `${first} ${last}`.trim();
    
    if (firstLastCombined) return firstLastCombined;
    if (first) return first;
    if (last) return last;
    
    // Priority 2: Check nested user/client objects
    const userFirstLast = getFirstLast(stop.user);
    if (userFirstLast) return userFirstLast;
    
    const clientFirstLast = getFirstLast(stop.client);
    if (clientFirstLast) return clientFirstLast;
    
    // Priority 3: Direct full name fields
    if (stop.fullName && !looksLikeAddress(stop.fullName)) {
        return stop.fullName;
    }
    
    // Priority 4: stop.name field (from API)
    if (stop.name && stop.name.trim() !== "" && stop.name !== "(Unnamed)") {
        return stop.name;
    }
    
    // Last resort
    return "Unnamed";
}
```

### Order ID Display
```typescript
// In openPreviewPopup function:
const orderIdDisplay = stop.orderId || "N/A";  // Full order ID (UUID)

// Displayed in popup:
<div style="display:flex;justify-content:space-between;margin-bottom:4px">
    <span style="color:#6b7280"><strong>Order ID:</strong></span>
    <span style="font-weight:500">${orderIdDisplay}</span>
</div>
```

---

## 4. Data Flow Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                         DATABASE LAYER                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  clients table:          orders table:         stops table:     │
│  ├─ id (PK)              ├─ id (PK)            ├─ id (PK)      │
│  ├─ first_name           ├─ client_id (FK)     ├─ client_id (FK)│
│  ├─ last_name            ├─ scheduled_...      ├─ order_id (FK) │
│  └─ ...                  └─ status              └─ delivery_date  │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         API LAYER                                │
│                    (/api/route/routes/route.ts)                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. Fetch stops (with client_id, delivery_date)                │
│  2. Fetch clients (by client_id from stops)                     │
│  3. Fetch orders (by client_id from stops)                      │
│  4. Build order maps:                                            │
│     - orderMapByClientAndDate[client_id|delivery_date] → order  │
│     - orderMapByClient[client_id] → most recent order           │
│  5. Hydrate stops:                                              │
│     - Match order: exact (client_id+date) or fallback (recent)  │
│     - Build name: client.first_name + client.last_name          │
│     - Add: orderId, orderStatus, orderDate, deliveryDate        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      FRONTEND LAYER                              │
│                    (DriversMapLeaflet.jsx)                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Stop object received:                                          │
│  {                                                               │
│    name: "John Doe",          ← From client.first_name + last   │
│    first: "John",             ← From client.first_name           │
│    last: "Doe",               ← From client.last_name           │
│    orderId: "uuid-...",        ← From matched order.id          │
│    orderStatus: "pending",     ← From matched order.status       │
│    orderDate: "2025-01-15",    ← From matched order.created_at   │
│    deliveryDate: "2025-01-20", ← From order.scheduled_delivery... │
│    ...                                                           │
│  }                                                               │
│                                                                  │
│  Popup display:                                                  │
│  - Client Name: Extracted via getClientFullName()               │
│  - Order ID: stop.orderId (full UUID)                           │
│  - Order Date: REMOVED (per user request)                       │
│  - Delivery Date: stop.deliveryDate                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 5. Key Relationships

### Order ID Tracking
1. **Source:** `orders.id` (UUID)
2. **Link:** `stops.order_id` (FK) OR matched via `client_id + delivery_date`
3. **Matching Logic:**
   - **Primary:** Match `order.client_id = stop.client_id` AND `order.scheduled_delivery_date = stop.delivery_date`
   - **Fallback:** Use most recent order for `client_id` if no exact date match
4. **Edge Cases:**
   - `stops.order_id` can be NULL for upcoming orders (not yet in `orders` table)
   - API matches orders dynamically, so `order_id` in stops table may be stale
   - API always uses live order matching, not the `stops.order_id` field

### Client Name Tracking
1. **Source:** `clients.first_name` + `clients.last_name`
2. **Denormalized:** `stops.name` (may be stale)
3. **API Enrichment:**
   - Always uses live `client.first_name + client.last_name`
   - Falls back to `stops.name` if client not found
4. **Frontend Display:**
   - Priority: `first + last` → nested objects → `fullName` → `name` → "Unnamed"
   - Handles various field name variations (first_name, firstName, etc.)

---

## 6. Potential Issues & Solutions

### Issue 1: Missing Order ID
**Cause:** Stop created before order exists (from `upcoming_orders`)
**Solution:** API matches orders dynamically, so order ID is found even if `stops.order_id` is NULL

### Issue 2: Stale Client Name
**Cause:** `stops.name` is denormalized and may be outdated
**Solution:** API always fetches live client data and rebuilds name from `first_name + last_name`

### Issue 3: Multiple Orders Per Client
**Cause:** Client can have multiple orders for different dates
**Solution:** API matches by `client_id + delivery_date` for exact matching

### Issue 4: Order Not Found
**Cause:** Order cancelled or deleted
**Solution:** API filters out cancelled orders, falls back to most recent non-cancelled order

---

## 7. Data Integrity Checks

### Recommended Queries

```sql
-- Check stops without matching orders
SELECT s.id, s.client_id, s.delivery_date, s.order_id
FROM stops s
LEFT JOIN orders o ON s.order_id = o.id
WHERE s.order_id IS NOT NULL AND o.id IS NULL;

-- Check stops without matching clients
SELECT s.id, s.client_id, s.name
FROM stops s
LEFT JOIN clients c ON s.client_id = c.id
WHERE s.client_id IS NOT NULL AND c.id IS NULL;

-- Check for stale client names in stops
SELECT s.id, s.name, c.first_name, c.last_name,
       CONCAT(c.first_name, ' ', c.last_name) as live_name
FROM stops s
JOIN clients c ON s.client_id = c.id
WHERE s.name != CONCAT(c.first_name, ' ', c.last_name);
```

---

## 8. Summary

**Order ID Flow:**
```
orders.id → (matched via client_id + delivery_date) → stop.orderId → popup display
```

**Client Name Flow:**
```
clients.first_name + clients.last_name → stop.name (enriched) → getClientFullName() → popup display
```

**Key Takeaway:**
- API performs live joins and matching, ensuring data freshness
- Frontend receives enriched stop objects with both `orderId` and client name fields
- Order matching is intelligent (exact date match → fallback to recent)
- Client name is always rebuilt from live client data, not denormalized stop.name
