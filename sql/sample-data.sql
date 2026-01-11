-- Sample Data for DietCombo Application
-- This file contains sample data for testing and development
-- Run this after running mysql-schema.sql
-- This script uses INSERT IGNORE to allow safe re-execution without duplicate key errors

USE dietcombo;

-- ============================================
-- CLIENT STATUSES
-- ============================================
INSERT IGNORE INTO client_statuses (id, name, is_system_default, deliveries_allowed, requires_units_on_change) VALUES
('11111111-1111-1111-1111-111111111111', 'Active', TRUE, TRUE, FALSE),
('22222222-2222-2222-2222-222222222222', 'On Hold', FALSE, FALSE, FALSE),
('33333333-3333-3333-3333-333333333333', 'Completed', FALSE, FALSE, FALSE),
('44444444-4444-4444-4444-444444444444', 'Pending Approval', FALSE, FALSE, TRUE);

-- ============================================
-- VENDORS
-- ============================================
INSERT IGNORE INTO vendors (id, name, email, password, service_type, delivery_days, delivery_frequency, is_active, minimum_meals, cutoff_hours) VALUES
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Fresh Meals Co', 'vendor1@dietcombo.com', '$2b$10$ujHIXa47sKzUG8/T9FWmOuFQgGbv/CjFCTXp1lnqkMZEivBoONts.', 'Meals', '["Monday", "Wednesday", "Friday"]', 'Multiple', TRUE, 5, 48),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Healthy Box Delivery', 'vendor2@dietcombo.com', '$2b$10$ujHIXa47sKzUG8/T9FWmOuFQgGbv/CjFCTXp1lnqkMZEivBoONts.', 'Boxes', '["Tuesday", "Thursday"]', 'Once', TRUE, 0, 72),
('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Gourmet Nutrition', 'vendor3@dietcombo.com', '$2b$10$ujHIXa47sKzUG8/T9FWmOuFQgGbv/CjFCTXp1lnqkMZEivBoONts.', 'Meals,Boxes', '["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]', 'Multiple', TRUE, 3, 24);

-- ============================================
-- NAVIGATORS
-- ============================================
INSERT IGNORE INTO navigators (id, name, email, password, is_active) VALUES
('nnnnnnnn-nnnn-nnnn-nnnn-nnnnnnnnnnn1', 'Sarah Johnson', 'navigator1@dietcombo.com', '$2b$10$9TZpOPwKU6LhxKmhYN684OiechQgH3CuIJoCtmpy8TYiNZOjG1.5G', TRUE),
('nnnnnnnn-nnnn-nnnn-nnnn-nnnnnnnnnnn2', 'Michael Chen', 'navigator2@dietcombo.com', '$2b$10$9TZpOPwKU6LhxKmhYN684OiechQgH3CuIJoCtmpy8TYiNZOjG1.5G', TRUE),
('nnnnnnnn-nnnn-nnnn-nnnn-nnnnnnnnnnn3', 'Emily Rodriguez', 'navigator3@dietcombo.com', '$2b$10$9TZpOPwKU6LhxKmhYN684OiechQgH3CuIJoCtmpy8TYiNZOjG1.5G', TRUE);

-- ============================================
-- ADMINS
-- ============================================
INSERT IGNORE INTO admins (id, username, password, name) VALUES
('admin1111-1111-1111-1111-111111111111', 'admin', '$2b$10$X0C0TlIhUbdMxZAe11NmIODq6x2qq2FxcDFhe3tjxgCcp2H7B15Du', 'System Administrator'),
('admin2222-2222-2222-2222-222222222222', 'manager', '$2b$10$X0C0TlIhUbdMxZAe11NmIODq6x2qq2FxcDFhe3tjxgCcp2H7B15Du', 'Manager Admin');

-- ============================================
-- NUTRITIONISTS
-- ============================================
INSERT IGNORE INTO nutritionists (id, name, email) VALUES
('nut111111-1111-1111-1111-111111111111', 'Dr. Lisa Anderson', 'lisa.anderson@dietcombo.com'),
('nut222222-2222-2222-2222-222222222222', 'Dr. James Wilson', 'james.wilson@dietcombo.com');

-- ============================================
-- ITEM CATEGORIES
-- ============================================
INSERT IGNORE INTO item_categories (id, name, set_value) VALUES
('cat111111-1111-1111-1111-111111111111', 'Proteins', 20.00),
('cat222222-2222-2222-2222-222222222222', 'Vegetables', 15.00),
('cat333333-3333-3333-3333-333333333333', 'Grains', 10.00),
('cat444444-4444-4444-4444-444444444444', 'Fruits', 12.00),
('cat555555-5555-5555-5555-555555555555', 'Dairy', 8.00);

-- ============================================
-- MENU ITEMS
-- ============================================
INSERT IGNORE INTO menu_items (id, vendor_id, name, value, price_each, is_active, category_id, quota_value, minimum_order) VALUES
-- Fresh Meals Co items
('item1111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Grilled Chicken Breast', 20.00, 12.99, TRUE, 'cat111111-1111-1111-1111-111111111111', 20.00, 1),
('item1111-1111-1111-1111-111111111112', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Salmon Fillet', 22.00, 15.99, TRUE, 'cat111111-1111-1111-1111-111111111111', 22.00, 1),
('item1111-1111-1111-1111-111111111113', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Steamed Broccoli', 15.00, 4.99, TRUE, 'cat222222-2222-2222-2222-222222222222', 15.00, 1),
('item1111-1111-1111-1111-111111111114', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Brown Rice', 10.00, 3.99, TRUE, 'cat333333-3333-3333-3333-333333333333', 10.00, 1),
('item1111-1111-1111-1111-111111111115', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Mixed Green Salad', 12.00, 5.99, TRUE, 'cat222222-2222-2222-2222-222222222222', 12.00, 1),

-- Healthy Box Delivery items
('item2222-2222-2222-2222-222222222221', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Turkey Meatballs', 18.00, 11.99, TRUE, 'cat111111-1111-1111-1111-111111111111', 18.00, 1),
('item2222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Roasted Vegetables', 16.00, 6.99, TRUE, 'cat222222-2222-2222-2222-222222222222', 16.00, 1),
('item2222-2222-2222-2222-222222222223', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Quinoa Bowl', 12.00, 7.99, TRUE, 'cat333333-3333-3333-3333-333333333333', 12.00, 1),

-- Gourmet Nutrition items
('item3333-3333-3333-3333-333333333331', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Beef Steak', 25.00, 18.99, TRUE, 'cat111111-1111-1111-1111-111111111111', 25.00, 1),
('item3333-3333-3333-3333-333333333332', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Grilled Asparagus', 14.00, 5.99, TRUE, 'cat222222-2222-2222-2222-222222222222', 14.00, 1),
('item3333-3333-3333-3333-333333333333', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Sweet Potato', 11.00, 4.99, TRUE, 'cat333333-3333-3333-3333-333333333333', 11.00, 1),
('item3333-3333-3333-3333-333333333334', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Greek Yogurt', 8.00, 3.99, TRUE, 'cat555555-5555-5555-5555-555555555555', 8.00, 1);

-- ============================================
-- EQUIPMENT
-- ============================================
INSERT IGNORE INTO equipment (id, name, price, vendor_id) VALUES
('eq111111-1111-1111-1111-111111111111', 'Insulated Cooler Bag', 15.00, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
('eq222222-2222-2222-2222-222222222222', 'Reusable Container Set', 25.00, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
('eq333333-3333-3333-3333-333333333333', 'Meal Prep Containers', 20.00, 'cccccccc-cccc-cccc-cccc-cccccccccccc');

-- ============================================
-- BOX TYPES
-- ============================================
INSERT IGNORE INTO box_types (id, name, vendor_id, is_active, price_each) VALUES
('box11111-1111-1111-1111-111111111111', 'Standard Meal Box', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', TRUE, 45.00),
('box22222-2222-2222-2222-222222222222', 'Premium Meal Box', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', TRUE, 65.00),
('box33333-3333-3333-3333-333333333333', 'Family Meal Box', 'cccccccc-cccc-cccc-cccc-cccccccccccc', TRUE, 85.00);

-- ============================================
-- BOX QUOTAS
-- ============================================
INSERT IGNORE INTO box_quotas (id, box_type_id, category_id, target_value) VALUES
('bq111111-1111-1111-1111-111111111111', 'box11111-1111-1111-1111-111111111111', 'cat111111-1111-1111-1111-111111111111', 20.00),
('bq222222-2222-2222-2222-222222222222', 'box11111-1111-1111-1111-111111111111', 'cat222222-2222-2222-2222-222222222222', 15.00),
('bq333333-3333-3333-3333-333333333333', 'box11111-1111-1111-1111-111111111111', 'cat333333-3333-3333-3333-333333333333', 10.00),
('bq444444-4444-4444-4444-444444444444', 'box22222-2222-2222-2222-222222222222', 'cat111111-1111-1111-1111-111111111111', 25.00),
('bq555555-5555-5555-5555-555555555555', 'box22222-2222-2222-2222-222222222222', 'cat222222-2222-2222-2222-222222222222', 20.00);

-- ============================================
-- CLIENTS
-- ============================================
INSERT IGNORE INTO clients (id, full_name, first_name, last_name, email, address, apt, city, state, zip, county, phone_number, secondary_phone_number, client_id_external, case_id_external, medicaid, paused, complex, bill, delivery, dislikes, latitude, longitude, lat, lng, geocoded_at, billings, visits, sign_token, navigator_id, end_date, screening_took_place, screening_signed, screening_status, notes, status_id, service_type, approved_meals_per_week, parent_client_id, dob, cin, authorized_amount, expiration_date, active_order) VALUES
('client111-1111-1111-1111-111111111111', 'John Smith', 'John', 'Smith', 'john.smith@example.com', '123 Main St', 'Apt 2B', 'Anytown', 'NY', '12345', 'Any County', '555-0101', '555-0102', 'EXT-CLIENT-001', 'CASE-001', TRUE, FALSE, FALSE, TRUE, TRUE, 'Nuts, Shellfish', 40.7128, -74.0060, 40.7128, -74.0060, NOW(), NULL, NULL, 'sign-token-111', 'nnnnnnnn-nnnn-nnnn-nnnn-nnnnnnnnnnn1', DATE_ADD(CURDATE(), INTERVAL 6 MONTH), TRUE, TRUE, 'completed', 'Client prefers low-sodium meals', '11111111-1111-1111-1111-111111111111', 'Meals', 10, NULL, '1980-05-15', 123456789, 500.00, DATE_ADD(CURDATE(), INTERVAL 1 YEAR), '{"serviceType":"Meals","caseId":"CASE-001","deliveryDistribution":{"Monday":5,"Wednesday":5}}'),
('client222-2222-2222-2222-222222222222', 'Jane Doe', 'Jane', 'Doe', 'jane.doe@example.com', '456 Oak Ave', NULL, 'Somewhere', 'CA', '67890', 'Some County', '555-0201', NULL, 'EXT-CLIENT-002', 'CASE-002', FALSE, FALSE, FALSE, TRUE, TRUE, 'Meat, Dairy', 34.0522, -118.2437, 34.0522, -118.2437, NOW(), NULL, NULL, 'sign-token-222', 'nnnnnnnn-nnnn-nnnn-nnnn-nnnnnnnnnnn1', DATE_ADD(CURDATE(), INTERVAL 3 MONTH), TRUE, TRUE, 'completed', 'Vegetarian diet', '11111111-1111-1111-1111-111111111111', 'Boxes', 7, NULL, '1992-08-22', 987654321, 350.00, DATE_ADD(CURDATE(), INTERVAL 6 MONTH), '{"serviceType":"Boxes","caseId":"CASE-002","deliveryDistribution":{"Tuesday":1}}'),
('client333-3333-3333-3333-333333333333', 'Robert Johnson', 'Robert', 'Johnson', 'robert.johnson@example.com', '789 Pine Rd', 'Suite 100', 'Elsewhere', 'TX', '54321', 'Else County', '555-0301', '555-0302', 'EXT-CLIENT-003', 'CASE-003', TRUE, FALSE, TRUE, TRUE, TRUE, NULL, 29.7604, -95.3698, 29.7604, -95.3698, NOW(), NULL, NULL, NULL, 'nnnnnnnn-nnnn-nnnn-nnnn-nnnnnnnnnnn2', DATE_ADD(CURDATE(), INTERVAL 12 MONTH), FALSE, FALSE, 'not_started', 'New client, needs screening', '44444444-4444-4444-4444-444444444444', 'Meals', 14, NULL, '1975-03-10', 456789123, 750.00, DATE_ADD(CURDATE(), INTERVAL 2 YEAR), NULL),
('client444-4444-4444-4444-444444444444', 'Maria Garcia', 'Maria', 'Garcia', 'maria.garcia@example.com', '321 Elm St', NULL, 'Nowhere', 'FL', '09876', 'No County', '555-0401', NULL, 'EXT-CLIENT-004', 'CASE-004', FALSE, FALSE, FALSE, TRUE, TRUE, 'Spicy foods', 25.7617, -80.1918, 25.7617, -80.1918, NOW(), NULL, NULL, NULL, 'nnnnnnnn-nnnn-nnnn-nnnn-nnnnnnnnnnn2', NULL, TRUE, FALSE, 'in_progress', 'Waiting for signature', '11111111-1111-1111-1111-111111111111', 'Meals,Boxes', 12, NULL, '1988-11-30', 789123456, 600.00, DATE_ADD(CURDATE(), INTERVAL 18 MONTH), '{"serviceType":"Meals","caseId":"CASE-004","deliveryDistribution":{"Monday":6,"Wednesday":6}}'),
('client555-5555-5555-5555-555555555555', 'David Lee', 'David', 'Lee', 'david.lee@example.com', '654 Maple Dr', 'Unit 5', 'Anywhere', 'IL', '13579', 'Any County', '555-0501', '555-0502', 'EXT-CLIENT-005', 'CASE-005', TRUE, FALSE, FALSE, TRUE, TRUE, 'Gluten', 41.8781, -87.6298, 41.8781, -87.6298, NOW(), NULL, NULL, 'sign-token-555', 'nnnnnnnn-nnnn-nnnn-nnnn-nnnnnnnnnnn3', DATE_ADD(CURDATE(), INTERVAL 9 MONTH), TRUE, TRUE, 'completed', 'Gluten-free requirements', '11111111-1111-1111-1111-111111111111', 'Meals', 8, NULL, '1995-07-18', 321654987, 400.00, DATE_ADD(CURDATE(), INTERVAL 1 YEAR), '{"serviceType":"Meals","caseId":"CASE-005","deliveryDistribution":{"Friday":8}}'),
('client666-6666-6666-6666-666666666666', 'Sarah Williams', 'Sarah', 'Williams', 'sarah.williams@example.com', '987 Cedar Ln', NULL, 'Someplace', 'WA', '24680', 'Some County', '555-0601', NULL, 'EXT-CLIENT-006', 'CASE-006', FALSE, TRUE, FALSE, TRUE, FALSE, NULL, 47.6062, -122.3321, 47.6062, -122.3321, NOW(), NULL, NULL, NULL, 'nnnnnnnn-nnnn-nnnn-nnnn-nnnnnnnnnnn3', NULL, FALSE, FALSE, 'not_started', NULL, '22222222-2222-2222-2222-222222222222', 'Boxes', 5, NULL, '1990-12-05', 654987321, 250.00, DATE_ADD(CURDATE(), INTERVAL 6 MONTH), NULL),
('client777-7777-7777-7777-777777777777', 'Michael Brown', 'Michael', 'Brown', 'michael.brown@example.com', '111 Park Ave', 'Apt 3C', 'Springfield', 'MA', '01103', 'Hampden', '555-0701', NULL, 'EXT-CLIENT-007', 'CASE-007', TRUE, FALSE, FALSE, TRUE, TRUE, NULL, 42.1015, -72.5898, 42.1015, -72.5898, NOW(), NULL, NULL, NULL, 'nnnnnnnn-nnnn-nnnn-nnnn-nnnnnnnnnnn1', DATE_ADD(CURDATE(), INTERVAL 4 MONTH), TRUE, TRUE, 'completed', 'Regular client', '11111111-1111-1111-1111-111111111111', 'Meals', 10, NULL, '1985-09-20', 111222333, 450.00, DATE_ADD(CURDATE(), INTERVAL 8 MONTH), NULL);

-- Dependent client (child of client111)
INSERT IGNORE INTO clients (id, full_name, first_name, last_name, email, address, apt, city, state, zip, county, phone_number, secondary_phone_number, navigator_id, end_date, screening_took_place, screening_signed, screening_status, notes, status_id, service_type, approved_meals_per_week, parent_client_id, dob, cin, authorized_amount, expiration_date, active_order) VALUES
('client888-8888-8888-8888-888888888888', 'Emily Smith', 'Emily', 'Smith', NULL, '123 Main St', 'Apt 2B', 'Anytown', 'NY', '12345', 'Any County', '555-0101', NULL, 'nnnnnnnn-nnnn-nnnn-nnnn-nnnnnnnnnnn1', DATE_ADD(CURDATE(), INTERVAL 6 MONTH), FALSE, FALSE, 'not_started', 'Dependent of John Smith', '11111111-1111-1111-1111-111111111111', 'Meals', 5, 'client111-1111-1111-1111-111111111111', '2010-03-15', 999888777, 250.00, DATE_ADD(CURDATE(), INTERVAL 1 YEAR), NULL);

-- ============================================
-- ORDERS
-- ============================================
INSERT IGNORE INTO orders (id, client_id, service_type, case_id, status, scheduled_delivery_date, actual_delivery_date, delivery_day, delivery_distribution, total_value, total_items, notes, proof_of_delivery_url, order_number, updated_by) VALUES
('order111-1111-1111-1111-111111111111', 'client111-1111-1111-1111-111111111111', 'Meals', 'CASE-001', 'delivered', DATE_SUB(CURDATE(), INTERVAL 3 DAY), DATE_SUB(CURDATE(), INTERVAL 3 DAY), 'Monday', '{"Monday": 5, "Wednesday": 5}', 64.95, 10, 'Delivered successfully', NULL, 100001, 'admin'),
('order222-2222-2222-2222-222222222222', 'client222-2222-2222-2222-222222222222', 'Boxes', 'CASE-002', 'pending', DATE_ADD(CURDATE(), INTERVAL 2 DAY), NULL, 'Tuesday', '{"Tuesday": 1}', 45.00, 1, 'Standard box order', NULL, 100002, 'navigator1'),
('order333-3333-3333-3333-333333333333', 'client111-1111-1111-1111-111111111111', 'Meals', 'CASE-001', 'scheduled', DATE_ADD(CURDATE(), INTERVAL 5 DAY), NULL, 'Monday', '{"Monday": 5, "Wednesday": 5}', 64.95, 10, 'Next week delivery', NULL, 100003, 'admin'),
('order444-4444-4444-4444-444444444444', 'client555-5555-5555-5555-555555555555', 'Meals', 'CASE-005', 'in_progress', CURDATE(), NULL, 'Friday', '{"Friday": 8}', 51.92, 8, 'Gluten-free meals', NULL, 100004, 'navigator3'),
('order555-5555-5555-5555-555555555555', 'client777-7777-7777-7777-777777777777', 'Meals', 'CASE-007', 'delivered', DATE_SUB(CURDATE(), INTERVAL 7 DAY), DATE_SUB(CURDATE(), INTERVAL 7 DAY), 'Monday', '{"Monday": 10}', 129.90, 10, 'Completed delivery', NULL, 100005, 'navigator1');

-- ============================================
-- ORDER VENDOR SELECTIONS
-- ============================================
INSERT IGNORE INTO order_vendor_selections (id, order_id, vendor_id) VALUES
('ovs11111-1111-1111-1111-111111111111', 'order111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
('ovs22222-2222-2222-2222-222222222222', 'order222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
('ovs33333-3333-3333-3333-333333333333', 'order333-3333-3333-3333-333333333333', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
('ovs44444-4444-4444-4444-444444444444', 'order444-4444-4444-4444-444444444444', 'cccccccc-cccc-cccc-cccc-cccccccccccc');

-- ============================================
-- ORDER ITEMS
-- ============================================
INSERT IGNORE INTO order_items (id, vendor_selection_id, menu_item_id, quantity) VALUES
-- Order 1 items
('oi111111-1111-1111-1111-111111111111', 'ovs11111-1111-1111-1111-111111111111', 'item1111-1111-1111-1111-111111111111', 5),
('oi111111-1111-1111-1111-111111111112', 'ovs11111-1111-1111-1111-111111111111', 'item1111-1111-1111-1111-111111111113', 3),
('oi111111-1111-1111-1111-111111111113', 'ovs11111-1111-1111-1111-111111111111', 'item1111-1111-1111-1111-111111111114', 2),

-- Order 2 items (box order - items stored in box_selections)
('oi222222-2222-2222-2222-222222222221', 'ovs22222-2222-2222-2222-222222222222', 'item2222-2222-2222-2222-222222222221', 1),

-- Order 3 items
('oi333333-3333-3333-3333-333333333331', 'ovs33333-3333-3333-3333-333333333333', 'item1111-1111-1111-1111-111111111111', 5),
('oi333333-3333-3333-3333-333333333332', 'ovs33333-3333-3333-3333-333333333333', 'item1111-1111-1111-1111-111111111115', 5),

-- Order 4 items
('oi444444-4444-4444-4444-444444444441', 'ovs44444-4444-4444-4444-444444444444', 'item3333-3333-3333-3333-333333333331', 4),
('oi444444-4444-4444-4444-444444444442', 'ovs44444-4444-4444-4444-444444444444', 'item3333-3333-3333-3333-333333333332', 4);

-- ============================================
-- ORDER BOX SELECTIONS
-- ============================================
INSERT IGNORE INTO order_box_selections (id, order_id, vendor_id, box_type_id, quantity, items) VALUES
('obs11111-1111-1111-1111-111111111111', 'order222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'box11111-1111-1111-1111-111111111111', 1, '{"item2222-2222-2222-2222-222222222221": 1, "item2222-2222-2222-2222-222222222222": 1, "item2222-2222-2222-2222-222222222223": 1}');

-- ============================================
-- UPCOMING ORDERS
-- ============================================
INSERT IGNORE INTO upcoming_orders (id, client_id, service_type, case_id, status, scheduled_delivery_date, take_effect_date, delivery_day, delivery_distribution, total_value, total_items, notes, updated_by) VALUES
('upco1111-1111-1111-1111-111111111111', 'client444-4444-4444-4444-444444444444', 'Meals', 'CASE-004', 'scheduled', DATE_ADD(CURDATE(), INTERVAL 7 DAY), DATE_ADD(CURDATE(), INTERVAL 7 DAY), 'Monday', '{"Monday": 6, "Wednesday": 6}', 77.94, 12, 'Starting next week', 'navigator2'),
('upco2222-2222-2222-2222-222222222222', 'client666-6666-6666-6666-666666666666', 'Boxes', 'CASE-006', 'scheduled', DATE_ADD(CURDATE(), INTERVAL 10 DAY), DATE_ADD(CURDATE(), INTERVAL 10 DAY), 'Tuesday', '{"Tuesday": 1}', 45.00, 1, 'Pending activation', 'navigator3');

-- ============================================
-- UPCOMING ORDER VENDOR SELECTIONS
-- ============================================
INSERT IGNORE INTO upcoming_order_vendor_selections (id, upcoming_order_id, vendor_id) VALUES
('uovs1111-1111-1111-1111-111111111111', 'upco1111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
('uovs2222-2222-2222-2222-222222222222', 'upco2222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');

-- ============================================
-- UPCOMING ORDER ITEMS
-- ============================================
-- Note: vendor_selection_id must reference an existing order_vendor_selections record
-- For upcoming orders, we reference the vendor selection from a previous order as a template
INSERT IGNORE INTO upcoming_order_items (id, vendor_selection_id, upcoming_vendor_selection_id, menu_item_id, quantity) VALUES
('uoi11111-1111-1111-1111-111111111111', 'ovs11111-1111-1111-1111-111111111111', 'uovs1111-1111-1111-1111-111111111111', 'item1111-1111-1111-1111-111111111111', 6),
('uoi11111-1111-1111-1111-111111111112', 'ovs11111-1111-1111-1111-111111111111', 'uovs1111-1111-1111-1111-111111111111', 'item1111-1111-1111-1111-111111111113', 6);

-- ============================================
-- UPCOMING ORDER BOX SELECTIONS
-- ============================================
INSERT IGNORE INTO upcoming_order_box_selections (id, upcoming_order_id, vendor_id, box_type_id, quantity, items) VALUES
('uobs1111-1111-1111-1111-111111111111', 'upco2222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'box11111-1111-1111-1111-111111111111', 1, '{"item2222-2222-2222-2222-222222222221": 1, "item2222-2222-2222-2222-222222222222": 1}');

-- ============================================
-- DELIVERY HISTORY
-- ============================================
INSERT IGNORE INTO delivery_history (id, client_id, vendor_id, service_type, delivery_date, items_summary, proof_of_delivery_image) VALUES
('dh111111-1111-1111-1111-111111111111', 'client111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Meals', DATE_SUB(CURDATE(), INTERVAL 3 DAY), '5x Grilled Chicken Breast, 3x Steamed Broccoli, 2x Brown Rice', NULL),
('dh222222-2222-2222-2222-222222222222', 'client111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Meals', DATE_SUB(CURDATE(), INTERVAL 10 DAY), '5x Grilled Chicken Breast, 5x Mixed Green Salad', NULL);

-- ============================================
-- ORDER HISTORY LOG
-- ============================================
INSERT IGNORE INTO order_history (id, client_id, who, summary) VALUES
('oh111111-1111-1111-1111-111111111111', 'client111-1111-1111-1111-111111111111', 'admin', 'Order created for 10 meals'),
('oh222222-2222-2222-2222-222222222222', 'client111-1111-1111-1111-111111111111', 'navigator1', 'Order delivered successfully'),
('oh333333-3333-3333-3333-333333333333', 'client222-2222-2222-2222-222222222222', 'navigator1', 'Box order placed'),
('oh444444-4444-4444-4444-444444444444', 'client444-4444-4444-4444-444444444444', 'navigator2', 'Upcoming order scheduled');

-- ============================================
-- BILLING RECORDS
-- ============================================
INSERT IGNORE INTO billing_records (id, client_id, order_id, status, remarks, navigator, amount) VALUES
('bill1111-1111-1111-1111-111111111111', 'client111-1111-1111-1111-111111111111', 'order111-1111-1111-1111-111111111111', 'paid', 'Monthly billing cycle', 'Sarah Johnson', 64.95),
('bill2222-2222-2222-2222-222222222222', 'client222-2222-2222-2222-222222222222', 'order222-2222-2222-2222-222222222222', 'pending', 'Awaiting payment', 'Sarah Johnson', 45.00),
('bill3333-3333-3333-3333-333333333333', 'client555-5555-5555-5555-555555555555', 'order444-4444-4444-4444-444444444444', 'pending', 'Processing', 'Emily Rodriguez', 51.92);

-- ============================================
-- NAVIGATOR LOGS
-- ============================================
INSERT IGNORE INTO navigator_logs (id, navigator_id, client_id, action, details) VALUES
('nl111111-1111-1111-1111-111111111111', 'nnnnnnnn-nnnn-nnnn-nnnn-nnnnnnnnnnn1', 'client111-1111-1111-1111-111111111111', 'Client Contact', 'Called client to confirm delivery address'),
('nl222222-2222-2222-2222-222222222222', 'nnnnnnnn-nnnn-nnnn-nnnn-nnnnnnnnnnn1', 'client222-2222-2222-2222-222222222222', 'Order Created', 'Created new box order for client'),
('nl333333-3333-3333-3333-333333333333', 'nnnnnnnn-nnnn-nnnn-nnnn-nnnnnnnnnnn2', 'client333-3333-3333-3333-333333333333', 'Screening Scheduled', 'Scheduled screening appointment for next week'),
('nl444444-4444-4444-4444-444444444444', 'nnnnnnnn-nnnn-nnnn-nnnn-nnnnnnnnnnn3', 'client555-5555-5555-5555-555555555555', 'Dietary Update', 'Updated client dietary requirements to gluten-free');

-- ============================================
-- FORMS (Optional - for screening forms)
-- ============================================
INSERT IGNORE INTO forms (id, title, description) VALUES
('form1111-1111-1111-1111-111111111111', 'Initial Screening Form', 'Basic health and dietary information form for new clients'),
('form2222-2222-2222-2222-222222222222', 'Nutrition Assessment', 'Detailed nutrition assessment form');

-- ============================================
-- QUESTIONS
-- ============================================
INSERT IGNORE INTO questions (id, form_id, text, type, options, conditional_text_inputs, `order`) VALUES
('q1111111-1111-1111-1111-111111111111', 'form1111-1111-1111-1111-111111111111', 'Do you have any food allergies?', 'multiple_choice', '["Yes", "No"]', NULL, 1),
('q1111111-1111-1111-1111-111111111112', 'form1111-1111-1111-1111-111111111111', 'What are your dietary restrictions?', 'multiple_choice', '["Vegetarian", "Vegan", "Gluten-free", "Low-sodium", "None"]', NULL, 2),
('q1111111-1111-1111-1111-111111111113', 'form1111-1111-1111-1111-111111111111', 'Please describe any additional dietary needs:', 'text', NULL, NULL, 3),
('q2222222-2222-2222-2222-222222222221', 'form2222-2222-2222-2222-222222222222', 'What is your current weight?', 'text', NULL, NULL, 1),
('q2222222-2222-2222-2222-222222222222', 'form2222-2222-2222-2222-222222222222', 'Do you have any medical conditions?', 'multiple_choice', '["Diabetes", "Hypertension", "Heart Disease", "None", "Other"]', '{"Other": "Please specify"}', 2);

-- ============================================
-- FORM SUBMISSIONS
-- ============================================
INSERT IGNORE INTO form_submissions (id, form_id, client_id, token, status, data, signature_url, pdf_url, comments) VALUES
('fs111111-1111-1111-1111-111111111111', 'form1111-1111-1111-1111-111111111111', 'client111-1111-1111-1111-111111111111', 'token-111-abc123', 'completed', '{"allergies": "No", "restrictions": ["Low-sodium"], "additional": "Prefer mild spices"}', NULL, NULL, 'Form completed successfully'),
('fs222222-2222-2222-2222-222222222222', 'form2222-2222-2222-2222-222222222222', 'client555-5555-5555-5555-555555555555', 'token-555-xyz789', 'completed', '{"weight": "180 lbs", "conditions": ["None"]}', NULL, NULL, NULL);

-- ============================================
-- SCHEDULES
-- ============================================
INSERT IGNORE INTO schedules (id, client_id, monday, tuesday, wednesday, thursday, friday, saturday, sunday) VALUES
('sched111-1111-1111-1111-111111111111', 'client111-1111-1111-1111-111111111111', TRUE, FALSE, TRUE, FALSE, FALSE, FALSE, FALSE),
('sched222-2222-2222-2222-222222222222', 'client222-2222-2222-2222-222222222222', FALSE, TRUE, FALSE, FALSE, FALSE, FALSE, FALSE),
('sched333-3333-3333-3333-333333333333', 'client444-4444-4444-4444-444444444444', TRUE, FALSE, TRUE, FALSE, FALSE, FALSE, FALSE),
('sched444-4444-4444-4444-444444444444', 'client555-5555-5555-5555-555555555555', FALSE, FALSE, FALSE, FALSE, TRUE, FALSE, FALSE),
('sched555-5555-5555-5555-555555555555', 'client777-7777-7777-7777-777777777777', TRUE, FALSE, FALSE, FALSE, FALSE, FALSE, FALSE);

-- ============================================
-- STOPS (Delivery stops for routing)
-- ============================================
INSERT IGNORE INTO stops (id, day, client_id, `order`, name, address, apt, city, state, zip, phone, dislikes, lat, lng, completed, proof_url, assigned_driver_id) VALUES
('stop1111-1111-1111-1111-111111111111', 'Monday', 'client111-1111-1111-1111-111111111111', 1, 'John Smith', '123 Main St', 'Apt 2B', 'Anytown', 'NY', '12345', '555-0101', 'Nuts, Shellfish', 40.7128, -74.0060, TRUE, NULL, NULL),
('stop2222-2222-2222-2222-222222222222', 'Monday', 'client444-4444-4444-4444-444444444444', 2, 'Maria Garcia', '321 Elm St', NULL, 'Nowhere', 'FL', '09876', '555-0401', 'Spicy foods', 25.7617, -80.1918, FALSE, NULL, NULL),
('stop3333-3333-3333-3333-333333333333', 'Monday', 'client777-7777-7777-7777-777777777777', 3, 'Michael Brown', '111 Park Ave', 'Apt 3C', 'Springfield', 'MA', '01103', '555-0701', NULL, 42.1015, -72.5898, FALSE, NULL, NULL),
('stop4444-4444-4444-4444-444444444444', 'Tuesday', 'client222-2222-2222-2222-222222222222', 1, 'Jane Doe', '456 Oak Ave', NULL, 'Somewhere', 'CA', '67890', '555-0201', 'Meat, Dairy', 34.0522, -118.2437, FALSE, NULL, NULL),
('stop5555-5555-5555-5555-555555555555', 'Friday', 'client555-5555-5555-5555-555555555555', 1, 'David Lee', '654 Maple Dr', 'Unit 5', 'Anywhere', 'IL', '13579', '555-0501', 'Gluten', 41.8781, -87.6298, FALSE, NULL, NULL);

-- ============================================
-- DRIVERS
-- ============================================
INSERT IGNORE INTO drivers (id, day, name, color, stop_ids) VALUES
('driv1111-1111-1111-1111-111111111111', 'Monday', 'Driver John', '#FF5733', '["stop1111-1111-1111-1111-111111111111", "stop2222-2222-2222-2222-222222222222", "stop3333-3333-3333-3333-333333333333"]'),
('driv2222-2222-2222-2222-222222222222', 'Tuesday', 'Driver Jane', '#33FF57', '["stop4444-4444-4444-4444-444444444444"]'),
('driv3333-3333-3333-3333-333333333333', 'Friday', 'Driver Bob', '#3357FF', '["stop5555-5555-5555-5555-555555555555"]');

-- ============================================
-- ROUTES
-- ============================================
INSERT IGNORE INTO routes (id, name, color, stop_ids) VALUES
('route111-1111-1111-1111-111111111111', 'Monday North Route', '#FF5733', '["stop1111-1111-1111-1111-111111111111", "stop2222-2222-2222-2222-222222222222", "stop3333-3333-3333-3333-333333333333"]'),
('route2222-2222-2222-2222-222222222222', 'Tuesday Central Route', '#33FF57', '["stop4444-4444-4444-4444-444444444444"]'),
('route3333-3333-3333-3333-333333333333', 'Friday East Route', '#3357FF', '["stop5555-5555-5555-5555-555555555555"]');

-- ============================================
-- ROUTE RUNS (Historical route snapshots)
-- ============================================
INSERT IGNORE INTO route_runs (id, day, snapshot) VALUES
('rr111111-1111-1111-1111-111111111111', 'Monday', '{"route_id": "route111-1111-1111-1111-111111111111", "stops": ["stop1111-1111-1111-1111-111111111111", "stop2222-2222-2222-2222-222222222222"], "completed": 2, "total": 3}'),
('rr222222-2222-2222-2222-222222222222', 'Tuesday', '{"route_id": "route2222-2222-2222-2222-222222222222", "stops": ["stop4444-4444-4444-4444-444444444444"], "completed": 1, "total": 1}');

-- ============================================
-- SIGNATURES
-- ============================================
INSERT IGNORE INTO signatures (id, client_id, slot, strokes, signed_at, ip, user_agent) VALUES
('sig11111-1111-1111-1111-111111111111', 'client111-1111-1111-1111-111111111111', 1, '[{"x": 100, "y": 100, "time": 1234567890}]', DATE_SUB(NOW(), INTERVAL 5 DAY), '192.168.1.1', 'Mozilla/5.0'),
('sig22222-2222-2222-2222-222222222222', 'client222-2222-2222-2222-222222222222', 1, '[{"x": 150, "y": 150, "time": 1234567891}]', DATE_SUB(NOW(), INTERVAL 3 DAY), '192.168.1.2', 'Mozilla/5.0');

-- ============================================
-- CITY COLORS
-- ============================================
INSERT IGNORE INTO city_colors (id, city, color) VALUES
('cc111111-1111-1111-1111-111111111111', 'Anytown', '#FF5733'),
('cc222222-2222-2222-2222-222222222222', 'Somewhere', '#33FF57'),
('cc333333-3333-3333-3333-333333333333', 'Elsewhere', '#3357FF'),
('cc444444-4444-4444-4444-444444444444', 'Nowhere', '#FF33F5'),
('cc555555-5555-5555-5555-555555555555', 'Anywhere', '#F5FF33'),
('cc666666-6666-6666-6666-666666666666', 'Someplace', '#33F5FF'),
('cc777777-7777-7777-7777-777777777777', 'Springfield', '#FF9533');

-- ============================================
-- SETTINGS
-- ============================================
INSERT IGNORE INTO settings (id, `key`, value) VALUES
('set111111-1111-1111-1111-111111111111', 'default_delivery_days', 'Monday,Wednesday,Friday'),
('set222222-2222-2222-2222-222222222222', 'min_order_value', '25.00'),
('set333333-3333-3333-3333-333333333333', 'max_deliveries_per_week', '14'),
('set444444-4444-4444-4444-444444444444', 'notification_email', 'notifications@dietcombo.com');

-- ============================================
-- UPDATE UPCOMING ORDERS WITH ORDER NUMBERS
-- ============================================
UPDATE upcoming_orders SET order_number = 100006 WHERE id = 'upco1111-1111-1111-1111-111111111111';
UPDATE upcoming_orders SET order_number = 100007 WHERE id = 'upco2222-2222-2222-2222-222222222222';

-- ============================================
-- ADD MORE BILLING RECORDS WITH DIFFERENT STATUSES
-- ============================================
INSERT IGNORE INTO billing_records (id, client_id, order_id, status, remarks, navigator, amount) VALUES
('bill4444-4444-4444-4444-444444444444', 'client777-7777-7777-7777-777777777777', 'order555-5555-5555-5555-555555555555', 'success', 'Payment processed successfully', 'Sarah Johnson', 129.90),
('bill5555-5555-5555-5555-555555555555', 'client111-1111-1111-1111-111111111111', NULL, 'failed', 'Payment failed - insufficient funds', 'Sarah Johnson', 64.95),
('bill6666-6666-6666-6666-666666666666', 'client222-2222-2222-2222-222222222222', NULL, 'request sent', 'Billing request sent to client', 'Sarah Johnson', 45.00);

-- ============================================
-- ADD MORE DELIVERY HISTORY
-- ============================================
INSERT IGNORE INTO delivery_history (id, client_id, vendor_id, service_type, delivery_date, items_summary, proof_of_delivery_image) VALUES
('dh333333-3333-3333-3333-333333333333', 'client777-7777-7777-7777-777777777777', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Meals', DATE_SUB(CURDATE(), INTERVAL 7 DAY), '10x Grilled Chicken Breast', NULL),
('dh444444-4444-4444-4444-444444444444', 'client111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Meals', DATE_SUB(CURDATE(), INTERVAL 14 DAY), '5x Grilled Chicken Breast, 5x Salmon Fillet', NULL),
('dh555555-5555-5555-5555-555555555555', 'client222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Boxes', DATE_SUB(CURDATE(), INTERVAL 5 DAY), '1x Standard Meal Box', NULL);

-- ============================================
-- ADD MORE ORDER HISTORY LOGS
-- ============================================
INSERT IGNORE INTO order_history (id, client_id, who, summary) VALUES
('oh555555-5555-5555-5555-555555555555', 'client777-7777-7777-7777-777777777777', 'navigator1', 'Order created and delivered'),
('oh666666-6666-6666-6666-666666666666', 'client111-1111-1111-1111-111111111111', 'admin', 'Order modified - changed delivery schedule'),
('oh777777-7777-7777-7777-777777777777', 'client222-2222-2222-2222-222222222222', 'navigator1', 'Box order confirmed'),
('oh888888-8888-8888-8888-888888888888', 'client555-5555-5555-5555-555555555555', 'navigator3', 'Gluten-free order processed');

-- ============================================
-- ADD MORE NAVIGATOR LOGS
-- ============================================
INSERT IGNORE INTO navigator_logs (id, navigator_id, client_id, action, details) VALUES
('nl555555-5555-5555-5555-555555555555', 'nnnnnnnn-nnnn-nnnn-nnnn-nnnnnnnnnnn1', 'client777-7777-7777-7777-777777777777', 'Delivery Confirmed', 'Confirmed delivery with client'),
('nl666666-6666-6666-6666-666666666666', 'nnnnnnnn-nnnn-nnnn-nnnn-nnnnnnnnnnn2', 'client333-3333-3333-3333-333333333333', 'Screening Reminder', 'Sent reminder email for screening completion'),
('nl777777-7777-7777-7777-777777777777', 'nnnnnnnn-nnnn-nnnn-nnnn-nnnnnnnnnnn3', 'client555-5555-5555-5555-555555555555', 'Follow-up', 'Follow-up call regarding dietary preferences');

-- ============================================
-- SAMPLE DATA COMPLETE
-- ============================================

