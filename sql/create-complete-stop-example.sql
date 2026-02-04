-- SQL Script to Create a Client, Order, and Complex Stop
-- This is a quick way to create test data with a complex stop

-- Step 1: Create a complex client with delivery enabled
-- Replace the status_id and navigator_id with actual IDs from your database
INSERT INTO clients (
    id,
    full_name,
    address,
    city,
    state,
    zip,
    phone_number,
    service_type,
    status_id,
    navigator_id,
    delivery,
    paused,
    approved_meals_per_week,
    upcoming_order
) VALUES (
    UUID(),
    'Complex Stop Test Client',
    '789 Complete St',
    'Test City',
    'CA',
    '90210',
    '555-9999',
    'Food',
    (SELECT id FROM client_statuses WHERE deliveries_allowed = TRUE LIMIT 1), -- Get first eligible status
    (SELECT id FROM navigators WHERE is_active = TRUE LIMIT 1), -- Get first active navigator
    TRUE,  -- delivery must be TRUE
    FALSE, -- paused must be FALSE
    TRUE,  -- complex must be TRUE for complex stops
    21,
    '{}'::jsonb
)
RETURNING id, full_name;

-- Step 2: Create an upcoming order for the client
-- Note: Replace the client_id with the ID from Step 1, or use a subquery
INSERT INTO upcoming_orders (
    id,
    client_id,
    service_type,
    scheduled_delivery_date,
    delivery_day,
    status,
    items
) 
SELECT 
    UUID(),
    c.id,
    'Food',
    DATE_ADD(CURDATE(), INTERVAL 7 DAY), -- 7 days from today
    DAYNAME(DATE_ADD(CURDATE(), INTERVAL 7 DAY)),
    'pending',
    '{}'::jsonb
FROM clients c
WHERE c.full_name = 'Complex Stop Test Client'
LIMIT 1
RETURNING id, client_id, scheduled_delivery_date;

-- Step 3: Create a stop (will be marked as complex based on client.complex)
-- This links the stop to both the client and the order
INSERT INTO stops (
    id,
    day,
    delivery_date,
    client_id,
    order_id,
    name,
    address,
    city,
    state,
    zip,
    phone,
    completed  -- Set to TRUE for complete stop
)
SELECT 
    UUID(),
    DAYNAME(oo.scheduled_delivery_date),
    oo.scheduled_delivery_date,
    c.id,
    oo.id,
    c.full_name,
    c.address,
    c.city,
    c.state,
    c.zip,
    c.phone_number
    -- Note: Stop will be marked as complex during route processing based on client.complex
FROM clients c
JOIN upcoming_orders oo ON oo.client_id = c.id
WHERE c.full_name = 'Complex Stop Test Client'
AND c.complex = TRUE
AND oo.status = 'pending'
ORDER BY oo.created_at DESC
LIMIT 1
RETURNING id, name, completed, delivery_date;

-- Verify the complex stop was created
SELECT 
    s.id as stop_id,
    s.name,
    s.delivery_date,
    c.complex as client_is_complex,
    c.full_name as client_name,
    oo.id as order_id,
    oo.status as order_status
FROM stops s
JOIN clients c ON c.id = s.client_id
LEFT JOIN upcoming_orders oo ON oo.id = s.order_id
WHERE c.full_name = 'Complex Stop Test Client'
AND c.complex = TRUE;

-- Alternative: Mark an existing client as complex
-- Replace 'EXISTING_CLIENT_NAME' with an actual client name
/*
UPDATE clients
SET complex = TRUE
WHERE full_name = 'EXISTING_CLIENT_NAME';
*/

-- Alternative: Mark all stops for a complex client
-- Stops will be automatically detected as complex during route processing
-- based on the client's complex flag
