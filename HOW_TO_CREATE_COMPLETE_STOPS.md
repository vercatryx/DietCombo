# How to Create Clients, Orders, and Stops with Complex Stops

This guide explains how to create clients, orders, and stops that will show as "complex stops" in the system.

## Overview

A **complex stop** is a stop that is marked as complex, typically because the associated client has the `complex` flag set to `TRUE`. Complex stops are handled specially in the system:

- They are printed separately in route labels (in a segregated section after all non-complex stops)
- They maintain their driver's color but are grouped together
- They are detected by checking the client's `complex` field

To create a complex stop, you need to:

1. Create a client with `complex: true`
2. Create an order (or upcoming order) for that client
3. Process the order to create a stop (or create a stop manually)
4. The stop will automatically be marked as complex based on the client's complex flag

## Step-by-Step Process

### Step 1: Create a Client

Clients can be created through:
- **UI**: Use the Client List page and click "Create Client"
- **API**: Use the `addClient` function from `lib/actions.ts`
- **Extension API**: POST to `/api/extension/create-client`

**Required fields for a client:**
- `fullName` (required)
- `serviceType` (e.g., 'Food' or 'Boxes')
- `statusId` (client status)
- `navigatorId` (optional)
- Address fields: `address`, `city`, `state`, `zip` (needed for stops)
- `delivery: true` (must be true for stops to be created)
- `paused: false` (must be false for stops to be created)
- `complex: true` (set to true to create complex stops)

**Example client creation:**
```typescript
const newClient = await addClient({
    fullName: "John Doe",
    email: "john@example.com",
    address: "123 Main St",
    apt: "Apt 2B",
    city: "Anytown",
    state: "NY",
    zip: "12345",
    phoneNumber: "555-0101",
    navigatorId: navigatorId,
    statusId: statusId,
    serviceType: 'Food',
    approvedMealsPerWeek: 21,
    delivery: true,  // IMPORTANT: Must be true
    paused: false,   // IMPORTANT: Must be false
    complex: true    // IMPORTANT: Set to true for complex stops
});
```

### Step 2: Create an Order

Orders can be created in two ways:

#### Option A: Create an Upcoming Order

Upcoming orders are created when clients have active orders that need to be delivered. They're typically created through:
- The client profile when saving an active order
- The weekly order processing system

**Upcoming orders table structure:**
- `client_id` - Links to the client
- `scheduled_delivery_date` - The delivery date (required for stop creation)
- `delivery_day` - Day of week (e.g., 'Monday')
- `status` - Should not be 'processed' for stops to be created
- `service_type` - 'Food' or 'Boxes'

#### Option B: Create a Regular Order

Regular orders are in the `orders` table and can be created directly:
- `client_id` - Links to the client
- `service_type` - 'Food' or 'Boxes'
- `status` - 'pending', 'completed', etc.
- `scheduled_delivery_date` - The delivery date

### Step 3: Create a Stop

Stops are automatically created when:
- Orders are processed through `/api/process-weekly-orders`
- The `createOrUpdateStopForOrder` function is called

**Stop creation requirements:**
- Client must have `delivery: true` and `paused: false`
- Order must have a `scheduled_delivery_date` or `scheduled_delivery_date`
- Client must have address information (address, city, state, zip)

**Stop fields populated from client:**
- `name` - From client's `full_name`
- `address`, `apt`, `city`, `state`, `zip` - From client's address fields
- `phone` - From client's `phone_number`
- `dislikes` - From client's `dislikes`
- `lat`, `lng` - From client's geocoded coordinates
- `assigned_driver_id` - From client's `assigned_driver_id`
- `day` - Calculated from `delivery_date`
- `delivery_date` - From order's `scheduled_delivery_date`
- `client_id` - Links to the client
- `order_id` - Links to the order
- `completed` - Defaults to `FALSE`
- `complex` - Inherited from client's `complex` field (stops are marked as complex if the client is complex)

### Step 4: Complex Stop Detection

Complex stops are automatically detected during route processing based on the client's `complex` field. The system uses the `markStopComplex` function which checks:

1. **Direct complex flag**: If the stop has `complex: true` or `isComplex: true`
2. **Client complex flag**: If `client.complex === true` or `user.complex === true`
3. **Nested paths**: Checks various nested object paths (`flags.complex`, `User.complex`, etc.)
4. **Complex index**: Builds an index of complex users/clients and matches stops against it

When a stop is created for a complex client, it will be automatically marked as complex when routes are generated.

**How Complex Stops Are Handled:**
- Complex stops are printed separately in route labels
- They appear in a segregated section after all non-complex stops
- They maintain their driver's color but are grouped together
- The PDF export includes a "COMPLEX STOPS" header section

### Step 5: Mark Stop as Completed (Optional)

To mark a stop as complete, you can:

#### Option A: Use the Mobile API

**Endpoint:** `POST /api/mobile/stop/complete`

**Request body:**
```json
{
    "userId": "driver-user-id",
    "stopId": "stop-uuid",
    "completed": true
}
```

**Example:**
```typescript
const response = await fetch('/api/mobile/stop/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
        userId: 'driver-id',
        stopId: 'stop-uuid-here',
        completed: true
    })
});
```

#### Option B: Update Directly in Database

```sql
UPDATE stops 
SET completed = TRUE 
WHERE id = 'stop-uuid-here';
```

#### Option C: Use Supabase Client

```typescript
const { error } = await supabase
    .from('stops')
    .update({ completed: true })
    .eq('id', stopId);
```

## Complete Example: Creating a Complex Stop

Here's a complete example that creates a complex client, order, and stop:

```typescript
import { addClient } from '@/lib/actions';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// Step 1: Create client
const client = await addClient({
    fullName: "Jane Smith",
    address: "456 Oak Ave",
    city: "Somewhere",
    state: "CA",
    zip: "67890",
    phoneNumber: "555-0201",
    serviceType: 'Food',
    statusId: 'your-status-id',
    navigatorId: 'your-navigator-id',
    approvedMealsPerWeek: 21,
    delivery: true,
    paused: false,
    complex: true  // Set to true to create complex stops
});

// Step 2: Create upcoming order
const deliveryDate = new Date();
deliveryDate.setDate(deliveryDate.getDate() + 7); // 7 days from now
const deliveryDateStr = deliveryDate.toISOString().split('T')[0];
const dayOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][deliveryDate.getDay()];

const { data: upcomingOrder, error: orderError } = await supabase
    .from('upcoming_orders')
    .insert({
        id: randomUUID(),
        client_id: client.id,
        service_type: 'Food',
        scheduled_delivery_date: deliveryDateStr,
        delivery_day: dayOfWeek,
        status: 'pending',
        items: {} // Add your order items here
    })
    .select()
    .single();

// Step 3: Process order to create stop (or call process-weekly-orders API)
// The stop will be created automatically when process-weekly-orders runs
// Or you can manually create it:

const { data: stop, error: stopError } = await supabase
    .from('stops')
    .insert({
        id: randomUUID(),
        day: dayOfWeek,
        delivery_date: deliveryDateStr,
        client_id: client.id,
        order_id: upcomingOrder.id,
        name: client.fullName,
        address: client.address,
        city: client.city,
        state: client.state,
        zip: client.zip,
        phone: client.phoneNumber,
        completed: false // Will mark as true in next step
    })
    .select()
    .single();

// Step 4: The stop will be automatically marked as complex during route processing
// because the client has complex: true

console.log('Complex stop created:', stop.id);
console.log('Note: Stop will be marked as complex when routes are generated');
```

## Quick SQL Script

If you want to quickly create test data with complex stops, you can use this SQL:

```sql
-- Create a complex client
INSERT INTO clients (id, full_name, address, city, state, zip, phone_number, service_type, status_id, delivery, paused, complex)
VALUES (
    UUID(),
    'Complex Test Client',
    '123 Test St',
    'Test City',
    'NY',
    '12345',
    '555-0000',
    'Food',
    (SELECT id FROM client_statuses LIMIT 1),
    TRUE,
    FALSE,
    TRUE  -- Set complex to TRUE
);

-- Create an order
INSERT INTO orders (id, client_id, service_type, status, scheduled_delivery_date)
VALUES (
    UUID(),
    (SELECT id FROM clients WHERE full_name = 'Test Client' LIMIT 1),
    'Food',
    'pending',
    DATE_ADD(CURDATE(), INTERVAL 7 DAY)
);

-- Create a stop (linked to the order)
-- Note: The stop will be marked as complex during route processing based on client.complex
INSERT INTO stops (id, day, delivery_date, client_id, order_id, name, address, city, state, zip)
SELECT 
    UUID(),
    DAYNAME(scheduled_delivery_date),
    scheduled_delivery_date,
    o.client_id,
    o.id,
    c.full_name,
    c.address,
    c.city,
    c.state,
    c.zip
FROM orders o
JOIN clients c ON c.id = o.client_id
WHERE c.full_name = 'Complex Test Client'
AND c.complex = TRUE  -- Only for complex clients
AND o.status = 'pending'
LIMIT 1;
```

## Important Notes

1. **Client Requirements:**
   - `delivery` must be `TRUE`
   - `paused` must be `FALSE`
   - `complex` must be `TRUE` for complex stops
   - Must have complete address (address, city, state, zip)

2. **Complex Stop Detection:**
   - Stops are marked as complex based on the client's `complex` field
   - Complex detection happens during route processing
   - The system checks `client.complex`, `stop.complex`, and various nested paths
   - Complex stops are printed separately in route labels

3. **Stop Uniqueness:**
   - There's a unique constraint: one stop per client per delivery_date
   - If a stop already exists for a client+date, it will be updated, not duplicated

4. **Order Status:**
   - Orders with status 'completed' or 'cancelled' typically don't create stops
   - Only active/pending orders create stops

5. **Geocoding:**
   - Stops use `lat` and `lng` from the client record
   - If coordinates are missing, the stop will still be created but won't show on maps

6. **Driver Assignment:**
   - Stops inherit `assigned_driver_id` from the client
   - This can be overridden later

## Troubleshooting

**Stop not showing as complex:**
- Check that the client has `complex = TRUE` in the database
- Verify the stop exists and is linked to a complex client: `SELECT s.*, c.complex FROM stops s JOIN clients c ON c.id = s.client_id WHERE s.id = 'your-stop-id'`
- Complex detection happens during route processing, so check route generation logs

**Stop not being created:**
- Verify client has `delivery = TRUE` and `paused = FALSE`
- Check that order has a `scheduled_delivery_date`
- Ensure client has address information

**Complex stop not appearing in route labels:**
- Verify the client has `complex = TRUE`
- Check that the stop was created for a complex client
- Review route generation logs for complex detection messages
- Complex stops are printed in a separate section after non-complex stops

**Multiple stops for same client/date:**
- The system enforces uniqueness, so duplicates should be prevented
- If you see duplicates, check the unique constraint: `UNIQUE KEY idx_stops_client_delivery_date (client_id, delivery_date)`
