# Route Stops Calculation Analysis

## Overview
This document analyzes how route stops are calculated in the DietCombo application. The system determines which clients should have delivery stops on a given day and how those stops are organized into driver routes.

## Architecture Overview

The route stops system consists of several key components:

1. **Database Tables:**
   - `stops` - Individual delivery stops (one per client per day)
   - `drivers` - Driver assignments with ordered stop lists
   - `routes` - Legacy route configurations
   - `schedules` - Client delivery day preferences
   - `clients` - Client information including delivery settings

2. **Key API Endpoints:**
   - `/api/route/routes` - Main route data retrieval and stop creation
   - `/api/route/cleanup` - Creates missing stops for eligible clients
   - `/api/route/generate` - Distributes stops among drivers
   - `/api/route/optimize` - Optimizes stop order using nearest neighbor algorithm

## Stop Creation Logic

### Primary Flow: `/api/route/routes` (GET)

**Location:** `app/api/route/routes/route.ts`

The route stops calculation follows this process:

#### 1. Fetch Existing Stops
```typescript
// Fetches all stops (not filtered by day for legacy compatibility)
const allStops = await query<any[]>(`
    SELECT id, client_id as userId, address, apt, city, state, zip, phone, lat, lng, dislikes
    FROM stops
    ORDER BY id ASC
`);
```

#### 2. Identify Clients Needing Stops
The system determines which clients should have stops based on three criteria:

**A. Client must not be paused:**
```typescript
if (client.paused) {
    reasons.push("paused");
}
```

**B. Client must have delivery enabled:**
```typescript
const isDeliverable = (c: any) => {
    const v = c?.delivery;
    return v === undefined || v === null ? true : Boolean(v);
};
```

**C. Client must be scheduled for the delivery day:**
```typescript
const isOnDay = (c: any, dayValue: string) => {
    if (dayValue === "all") return true;
    const sc = schedulesMap.get(c.id);
    if (!sc) return true; // back-compat: no schedule means all days
    const dayMap: Record<string, string> = {
        monday: "monday",
        tuesday: "tuesday",
        // ... etc
    };
    return !!sc[dayMap[dayValue]];
};
```

The schedule is checked from the `schedules` table:
```typescript
const schedules = await query<any[]>(`
    SELECT client_id, monday, tuesday, wednesday, thursday, friday, saturday, sunday
    FROM schedules
    WHERE client_id IN (...)
`);
```

#### 3. Create Missing Stops
For clients that pass all three checks but don't have a stop for the day:

```typescript
stopsToCreate.push({
    id: uuidv4(),
    day: day,
    client_id: String(client.id),
    name: name || "(Unnamed)",
    address: s(client.address),
    apt: client.apt ? s(client.apt) : null,
    city: s(client.city),
    state: s(client.state),
    zip: s(client.zip),
    phone: client.phone ? s(client.phone) : null,
    lat: n(client.lat),
    lng: n(client.lng),
});
```

The stop data is copied from the client record, including:
- Name (from `first_name` + `last_name`)
- Address information (address, apt, city, state, zip)
- Contact (phone)
- Geocoding (lat, lng)

#### 4. Stop Creation SQL
```sql
INSERT INTO stops (id, day, client_id, name, address, apt, city, state, zip, phone, lat, lng)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON DUPLICATE KEY UPDATE name = VALUES(name)
```

### Secondary Flow: `/api/route/cleanup` (POST)

**Location:** `app/api/route/cleanup/route.ts`

This endpoint performs a similar process but is called explicitly to create missing stops. It's triggered:
- Automatically when the Routes dialog opens (`DriversDialog.jsx`)
- For both the selected day and "all" day routes

```typescript
// Auto-cleanup after initial load
const res3 = await fetch(`/api/route/cleanup?day=${selectedDay}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
});
```

## Stop Distribution to Drivers

### Route Generation: `/api/route/generate` (POST)

**Location:** `app/api/route/generate/route.ts`

Once stops exist, they are distributed among drivers:

#### 1. Get All Stops for Day
```typescript
const allStops = await query<any[]>(`
    SELECT id FROM stops ${dayWhere}
    ORDER BY id ASC
`, dayParams);
```

#### 2. Even Distribution Algorithm
Stops are distributed evenly among the specified number of drivers:

```typescript
const stopsPerDriver = Math.floor(stopIds.length / driverCount);
const remainder = stopIds.length % driverCount;

let stopIndex = 0;
for (let i = 0; i < driverCount; i++) {
    const driver = drivers[i];
    // Give one extra stop to first 'remainder' drivers
    const count = stopsPerDriver + (i < remainder ? 1 : 0);
    const driverStops = stopIds.slice(stopIndex, stopIndex + count);
    stopIndex += count;
    
    await query(`
        UPDATE drivers
        SET stop_ids = ?
        WHERE id = ?
    `, [JSON.stringify(driverStops), driver.id]);
}
```

**Example:** If there are 10 stops and 3 drivers:
- Driver 0: 4 stops (10/3 = 3 remainder 1, gets +1)
- Driver 1: 3 stops
- Driver 2: 3 stops

## Route Optimization

### Stop Order Optimization: `/api/route/optimize` (POST)

**Location:** `app/api/route/optimize/route.ts`

Uses the **Nearest Neighbor algorithm** to optimize the order of stops for a driver:

#### 1. Haversine Distance Calculation
```typescript
function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = 
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}
```

#### 2. Nearest Neighbor Algorithm
```typescript
function optimizeRouteOrder(stops: Array<{ id: string; lat: number | null; lng: number | null }>): string[] {
    // Filter out stops without valid coordinates
    const validStops = stops.filter(s => 
        s.lat !== null && s.lng !== null && 
        Number.isFinite(s.lat) && Number.isFinite(s.lng)
    );
    
    // Start with first stop
    let current = validStops[0];
    ordered.push(current.id);
    visited.add(current.id);
    
    // Greedily select nearest unvisited stop
    while (visited.size < validStops.length) {
        let nearest: typeof current | null = null;
        let minDistance = Infinity;
        
        for (const stop of validStops) {
            if (visited.has(stop.id)) continue;
            
            const distance = calculateDistance(
                current.lat!, current.lng!,
                stop.lat!, stop.lng!
            );
            
            if (distance < minDistance) {
                minDistance = distance;
                nearest = stop;
            }
        }
        
        if (nearest) {
            ordered.push(nearest.id);
            visited.add(nearest.id);
            current = nearest;
        }
    }
    
    // Add stops without coordinates at the end
    const invalidStops = stops.filter(s => 
        !validStops.some(vs => vs.id === s.id)
    );
    ordered.push(...invalidStops.map(s => s.id));
    
    return ordered;
}
```

**Note:** Stops without valid coordinates are placed at the end of the route.

#### 3. Duplicate Consolidation
The optimization endpoint also consolidates duplicate stops (same `client_id` assigned to multiple drivers):

```typescript
if (consolidateDuplicates) {
    // Find stops with the same client_id assigned to multiple drivers
    // Keep only one (prefer Driver 0, then first driver)
    // Remove others from their drivers
}
```

## Data Flow Summary

```
1. Client Configuration
   └─> Schedules table (delivery days)
   └─> Clients table (paused, delivery enabled)

2. Stop Creation (on-demand)
   └─> /api/route/routes (GET) or /api/route/cleanup (POST)
   └─> Creates stops in `stops` table for eligible clients
   └─> Copies address/geocoding from client record

3. Stop Distribution
   └─> /api/route/generate (POST)
   └─> Evenly distributes stops among drivers
   └─> Stores ordered stop IDs in `drivers.stop_ids` (JSON array)

4. Route Optimization
   └─> /api/route/optimize (POST)
   └─> Reorders stops using nearest neighbor algorithm
   └─> Updates `drivers.stop_ids` with optimized order

5. Route Retrieval
   └─> /api/route/routes (GET) or /api/mobile/routes (GET)
   └─> Hydrates stops with live client data
   └─> Returns routes with ordered stops
```

## Key Design Decisions

### 1. Stops Based on Schedules, Not Orders
**Important:** Stops are created based on client schedules, NOT directly from orders. This means:
- A client with a schedule for Monday will get a stop on Monday
- The stop exists regardless of whether there's a specific order
- Orders are handled separately in the `orders` and `upcoming_orders` tables

### 2. Denormalized Stop Data
Stops store a copy of client address/contact information. This allows:
- Historical accuracy (if client address changes, old stops retain original address)
- Performance (no join needed for route display)
- The system prefers live client data when hydrating routes, falling back to stop data

### 3. Day-Based Organization
Stops are organized by delivery day:
- `day` field in stops table: "monday", "tuesday", ..., "all"
- Drivers also have a `day` field
- Routes can be filtered by day for planning

### 4. Driver vs Route Tables
Two tables store route information:
- `drivers` - Current active routes (has `day` field)
- `routes` - Legacy route configurations (no `day` field)

The system combines both when retrieving routes to maintain backward compatibility.

## Edge Cases & Special Handling

### Missing Coordinates
- Stops without valid lat/lng are placed at the end of optimized routes
- Geocoding should be performed separately (via geocoding API)

### Duplicate Stops
- Same `client_id` can appear in multiple drivers' routes
- Optimization endpoint can consolidate these (keeps Driver 0's stop, removes others)

### Legacy Data
- Stops without a `day` field are still retrieved (for backward compatibility)
- When `day="all"`, all stops are returned regardless of day value

### Client Updates
- When client address is updated, existing stops are NOT automatically updated
- Stops maintain historical address data
- Routes prefer live client data when displaying, but stop data is preserved

## API Usage Examples

### Create stops for a day
```bash
POST /api/route/cleanup?day=monday
```

### Generate routes with 6 drivers
```bash
POST /api/route/generate
{
  "day": "monday",
  "driverCount": 6
}
```

### Optimize a driver's route
```bash
POST /api/route/optimize
{
  "day": "monday",
  "driverId": "driver-uuid-here",
  "consolidateDuplicates": true
}
```

### Get routes for mobile app
```bash
GET /api/mobile/routes?day=monday
```

## Potential Improvements

1. **Order-Based Stop Creation**: Currently stops are schedule-based. Could enhance to only create stops for clients with active orders on that day.

2. **Multi-Day Optimization**: Current optimization is per-driver. Could optimize across all drivers for better overall efficiency.

3. **Capacity Constraints**: Current distribution is purely even. Could add capacity constraints (max stops per driver, max distance, etc.).

4. **Real-time Geocoding**: Could auto-geocode stops when created if coordinates are missing.

5. **Stop-Order Linking**: The `stops.order` field exists but isn't used in current logic. Could link stops to specific orders for better traceability.
