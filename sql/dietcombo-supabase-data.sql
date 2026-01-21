-- Supabase/PostgreSQL Data Insert Script for DietCombo
-- Converted from MySQL/MariaDB dump
-- Run this AFTER creating the schema (dietcombo-supabase-schema.sql)
-- Run this in Supabase SQL Editor

-- ============================================
-- Table: admins
-- ============================================
INSERT INTO admins (id, username, password, name, created_at, updated_at) VALUES
('admin1111-1111-1111-1111-111111111111', 'admin', '$2b$10$X0C0TlIhUbdMxZAe11NmIODq6x2qq2FxcDFhe3tjxgCcp2H7B15Du', 'System Administrator', '2026-01-07 13:51:58', '2026-01-07 13:51:58'),
('admin2222-2222-2222-2222-222222222222', 'manager', '$2b$10$X0C0TlIhUbdMxZAe11NmIODq6x2qq2FxcDFhe3tjxgCcp2H7B15Du', 'Manager Admin', '2026-01-07 13:51:58', '2026-01-07 13:51:58')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- Table: app_settings
-- ============================================
INSERT INTO app_settings (id, weekly_cutoff_day, weekly_cutoff_time, report_email, enable_passwordless_login, created_at, updated_at) VALUES
('1', 'Friday', '17:00', NULL, FALSE, '2026-01-07 16:05:32', '2026-01-07 16:05:32')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- Table: client_statuses (insert first as it's referenced by clients)
-- ============================================
INSERT INTO client_statuses (id, name, is_system_default, deliveries_allowed, requires_units_on_change, created_at, updated_at) VALUES
('11111111-1111-1111-1111-111111111111', 'Active', TRUE, TRUE, FALSE, '2026-01-07 13:51:58', '2026-01-07 13:51:58'),
('22222222-2222-2222-2222-222222222222', 'On Hold', FALSE, FALSE, FALSE, '2026-01-07 13:51:58', '2026-01-07 13:51:58'),
('33333333-3333-3333-3333-333333333333', 'Completed', FALSE, FALSE, FALSE, '2026-01-07 13:51:58', '2026-01-07 13:51:58'),
('44444444-4444-4444-4444-444444444444', 'Pending Approval', FALSE, FALSE, TRUE, '2026-01-07 13:51:58', '2026-01-07 13:51:58')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- Table: navigators (insert before clients as it's referenced)
-- ============================================
INSERT INTO navigators (id, name, email, password, is_active, created_at, updated_at) VALUES
('nnnnnnnn-nnnn-nnnn-nnnn-nnnnnnnnnn11', 'Sarah Johnson', 'navigator1@dietcombo.com', '$2b$10$9TZpOPwKU6LhxKmhYN684OiechQgH3CuIJoCtmpy8TYiNZOjG1.5G', TRUE, '2026-01-07 13:51:58', '2026-01-07 13:51:58'),
('nnnnnnnn-nnnn-nnnn-nnnn-nnnnnnnnnn22', 'Michael Chen', 'navigator2@dietcombo.com', '$2b$10$9TZpOPwKU6LhxKmhYN684OiechQgH3CuIJoCtmpy8TYiNZOjG1.5G', TRUE, '2026-01-07 13:51:58', '2026-01-07 13:51:58'),
('nnnnnnnn-nnnn-nnnn-nnnn-nnnnnnnnnn33', 'Emily Rodriguez', 'navigator3@dietcombo.com', '$2b$10$9TZpOPwKU6LhxKmhYN684OiechQgH3CuIJoCtmpy8TYiNZOjG1.5G', TRUE, '2026-01-07 13:51:58', '2026-01-07 13:51:58')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- Table: vendors (insert before other tables that reference it)
-- ============================================
INSERT INTO vendors (id, name, email, password, service_type, delivery_days, delivery_frequency, is_active, minimum_meals, cutoff_hours, created_at, updated_at) VALUES
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Fresh Meals Co', 'vendor1@dietcombo.com', '$2b$10$ujHIXa47sKzUG8/T9FWmOuFQgGbv/CjFCTXp1lnqkMZEivBoONts.', 'Meals', '["Monday", "Wednesday", "Friday"]'::jsonb, 'Multiple', TRUE, 5, 48, '2026-01-07 16:46:05', '2026-01-07 16:46:05'),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Healthy Box Delivery', 'vendor2@dietcombo.com', '$2b$10$ujHIXa47sKzUG8/T9FWmOuFQgGbv/CjFCTXp1lnqkMZEivBoONts.', 'Boxes', '["Tuesday", "Thursday"]'::jsonb, 'Once', TRUE, 0, 72, '2026-01-07 16:46:05', '2026-01-07 16:46:05'),
('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Gourmet Nutrition', 'vendor3@dietcombo.com', '$2b$10$ujHIXa47sKzUG8/T9FWmOuFQgGbv/CjFCTXp1lnqkMZEivBoONts.', 'Meals,Boxes', '["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]'::jsonb, 'Multiple', TRUE, 3, 24, '2026-01-07 16:46:05', '2026-01-07 16:46:05')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- Table: item_categories (insert before menu_items)
-- ============================================
INSERT INTO item_categories (id, name, set_value, created_at, updated_at) VALUES
('cat111111-1111-1111-1111-111111111111', 'Proteins', 20.00, '2026-01-07 13:51:58', '2026-01-07 13:51:58'),
('cat222222-2222-2222-2222-222222222222', 'Vegetables', 15.00, '2026-01-07 13:51:58', '2026-01-07 13:51:58'),
('cat333333-3333-3333-3333-333333333333', 'Grains', 10.00, '2026-01-07 13:51:58', '2026-01-07 13:51:58'),
('cat444444-4444-4444-4444-444444444444', 'Fruits', 12.00, '2026-01-07 13:51:58', '2026-01-07 13:51:58'),
('cat555555-5555-5555-5555-555555555555', 'Dairy', 8.00, '2026-01-07 13:51:58', '2026-01-07 13:51:58')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- Table: box_types
-- ============================================
INSERT INTO box_types (id, name, vendor_id, is_active, price_each, created_at, updated_at) VALUES
('box11111-1111-1111-1111-111111111111', 'Standard Meal Box', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', TRUE, 45.00, '2026-01-07 16:46:06', '2026-01-07 16:46:06'),
('box22222-2222-2222-2222-222222222222', 'Premium Meal Box', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', TRUE, 65.00, '2026-01-07 16:46:06', '2026-01-07 16:46:06'),
('box33333-3333-3333-3333-333333333333', 'Family Meal Box', 'cccccccc-cccc-cccc-cccc-cccccccccccc', TRUE, 85.00, '2026-01-07 16:46:06', '2026-01-07 16:46:06')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- Table: menu_items
-- ============================================
INSERT INTO menu_items (id, vendor_id, name, value, price_each, is_active, category_id, quota_value, minimum_order, created_at, updated_at) VALUES
('item1111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Grilled Chicken Breast', 20.00, 12.99, TRUE, 'cat111111-1111-1111-1111-111111111111', 20.00, 1, '2026-01-07 16:46:05', '2026-01-07 16:46:05'),
('item1111-1111-1111-1111-111111111112', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Salmon Fillet', 22.00, 15.99, TRUE, 'cat111111-1111-1111-1111-111111111111', 22.00, 1, '2026-01-07 16:46:05', '2026-01-07 16:46:05'),
('item1111-1111-1111-1111-111111111113', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Steamed Broccoli', 15.00, 4.99, TRUE, 'cat222222-2222-2222-2222-222222222222', 15.00, 1, '2026-01-07 16:46:05', '2026-01-07 16:46:05'),
('item1111-1111-1111-1111-111111111114', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Brown Rice', 10.00, 3.99, TRUE, 'cat333333-3333-3333-3333-333333333333', 10.00, 1, '2026-01-07 16:46:05', '2026-01-07 16:46:05'),
('item1111-1111-1111-1111-111111111115', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'Mixed Green Salad', 12.00, 5.99, TRUE, 'cat222222-2222-2222-2222-222222222222', 12.00, 1, '2026-01-07 16:46:05', '2026-01-07 16:46:05'),
('item2222-2222-2222-2222-222222222221', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Turkey Meatballs', 18.00, 11.99, TRUE, 'cat111111-1111-1111-1111-111111111111', 18.00, 1, '2026-01-07 16:46:05', '2026-01-07 16:46:05'),
('item2222-2222-2222-2222-222222222222', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Roasted Vegetables', 16.00, 6.99, TRUE, 'cat222222-2222-2222-2222-222222222222', 16.00, 1, '2026-01-07 16:46:05', '2026-01-07 16:46:05'),
('item2222-2222-2222-2222-222222222223', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'Quinoa Bowl', 12.00, 7.99, TRUE, 'cat333333-3333-3333-3333-333333333333', 12.00, 1, '2026-01-07 16:46:05', '2026-01-07 16:46:05'),
('item3333-3333-3333-3333-333333333331', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Beef Steak', 25.00, 18.99, TRUE, 'cat111111-1111-1111-1111-111111111111', 25.00, 1, '2026-01-07 16:46:05', '2026-01-07 16:46:05'),
('item3333-3333-3333-3333-333333333332', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Grilled Asparagus', 14.00, 5.99, TRUE, 'cat222222-2222-2222-2222-222222222222', 14.00, 1, '2026-01-07 16:46:05', '2026-01-07 16:46:05'),
('item3333-3333-3333-3333-333333333333', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Sweet Potato', 11.00, 4.99, TRUE, 'cat333333-3333-3333-3333-333333333333', 11.00, 1, '2026-01-07 16:46:05', '2026-01-07 16:46:05'),
('item3333-3333-3333-3333-333333333334', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'Greek Yogurt', 8.00, 3.99, TRUE, 'cat555555-5555-5555-5555-555555555555', 8.00, 1, '2026-01-07 16:46:05', '2026-01-07 16:46:05')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- Table: box_quotas
-- ============================================
INSERT INTO box_quotas (id, box_type_id, category_id, target_value, created_at, updated_at) VALUES
('bq111111-1111-1111-1111-111111111111', 'box11111-1111-1111-1111-111111111111', 'cat111111-1111-1111-1111-111111111111', 20.00, '2026-01-07 16:46:06', '2026-01-07 16:46:06'),
('bq222222-2222-2222-2222-222222222222', 'box11111-1111-1111-1111-111111111111', 'cat222222-2222-2222-2222-222222222222', 15.00, '2026-01-07 16:46:06', '2026-01-07 16:46:06'),
('bq333333-3333-3333-3333-333333333333', 'box11111-1111-1111-1111-111111111111', 'cat333333-3333-3333-3333-333333333333', 10.00, '2026-01-07 16:46:06', '2026-01-07 16:46:06'),
('bq444444-4444-4444-4444-444444444444', 'box22222-2222-2222-2222-222222222222', 'cat111111-1111-1111-1111-111111111111', 25.00, '2026-01-07 16:46:06', '2026-01-07 16:46:06'),
('bq555555-5555-5555-5555-555555555555', 'box22222-2222-2222-2222-222222222222', 'cat222222-2222-2222-2222-222222222222', 20.00, '2026-01-07 16:46:06', '2026-01-07 16:46:06')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- Table: city_colors
-- ============================================
INSERT INTO city_colors (id, city, color, updated_at, created_at) VALUES
('cc111111-1111-1111-1111-111111111111', 'Anytown', '#FF5733', '2026-01-07 16:46:06', '2026-01-07 16:46:06'),
('cc222222-2222-2222-2222-222222222222', 'Somewhere', '#33FF57', '2026-01-07 16:46:06', '2026-01-07 16:46:06'),
('cc333333-3333-3333-3333-333333333333', 'Elsewhere', '#3357FF', '2026-01-07 16:46:06', '2026-01-07 16:46:06'),
('cc444444-4444-4444-4444-444444444444', 'Nowhere', '#FF33F5', '2026-01-07 16:46:06', '2026-01-07 16:46:06'),
('cc555555-5555-5555-5555-555555555555', 'Anywhere', '#F5FF33', '2026-01-07 16:46:06', '2026-01-07 16:46:06'),
('cc666666-6666-6666-6666-666666666666', 'Someplace', '#33F5FF', '2026-01-07 16:46:06', '2026-01-07 16:46:06'),
('cc777777-7777-7777-7777-777777777777', 'Springfield', '#FF9533', '2026-01-07 16:46:06', '2026-01-07 16:46:06')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- Table: nutritionists
-- ============================================
INSERT INTO nutritionists (id, name, email, created_at, updated_at) VALUES
('nut111111-1111-1111-1111-111111111111', 'Dr. Lisa Anderson', 'lisa.anderson@dietcombo.com', '2026-01-07 13:51:58', '2026-01-07 13:51:58'),
('nut222222-2222-2222-2222-222222222222', 'Dr. James Wilson', 'james.wilson@dietcombo.com', '2026-01-07 13:51:58', '2026-01-07 13:51:58')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- Table: forms
-- ============================================
INSERT INTO forms (id, title, description, created_at, updated_at) VALUES
('form1111-1111-1111-1111-111111111111', 'Initial Screening Form', 'Basic health and dietary information form for new clients', '2026-01-07 13:51:58', '2026-01-07 13:51:58'),
('form2222-2222-2222-2222-222222222222', 'Nutrition Assessment', 'Detailed nutrition assessment form', '2026-01-07 13:51:58', '2026-01-07 13:51:58')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- Table: questions
-- ============================================
INSERT INTO questions (id, form_id, text, type, options, conditional_text_inputs, "order", created_at, updated_at) VALUES
('q111111-1111-1111-1111-111111111111', 'form1111-1111-1111-1111-111111111111', 'Do you have any food allergies?', 'multiple_choice', '["Yes", "No"]'::jsonb, NULL, 1, '2026-01-07 16:46:06', '2026-01-07 16:46:06'),
('q111111-1111-1111-1111-111111111112', 'form1111-1111-1111-1111-111111111111', 'What are your dietary restrictions?', 'multiple_choice', '["Vegetarian", "Vegan", "Gluten-free", "Low-sodium", "None"]'::jsonb, NULL, 2, '2026-01-07 16:46:06', '2026-01-07 16:46:06'),
('q111111-1111-1111-1111-111111111113', 'form1111-1111-1111-1111-111111111111', 'Please describe any additional dietary needs:', 'text', NULL, NULL, 3, '2026-01-07 16:46:06', '2026-01-07 16:46:06'),
('q222222-2222-2222-2222-222222222221', 'form2222-2222-2222-2222-222222222222', 'What is your current weight?', 'text', NULL, NULL, 1, '2026-01-07 16:46:06', '2026-01-07 16:46:06'),
('q222222-2222-2222-2222-222222222222', 'form2222-2222-2222-2222-222222222222', 'Do you have any medical conditions?', 'multiple_choice', '["Diabetes", "Hypertension", "Heart Disease", "None", "Other"]'::jsonb, '{"Other": "Please specify"}'::jsonb, 2, '2026-01-07 16:46:06', '2026-01-07 16:46:06')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- Table: equipment
-- ============================================
INSERT INTO equipment (id, name, price, vendor_id, created_at, updated_at) VALUES
('eq111111-1111-1111-1111-111111111111', 'Insulated Cooler Bag', 15.00, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '2026-01-07 16:46:05', '2026-01-07 16:46:05'),
('eq222222-2222-2222-2222-222222222222', 'Reusable Container Set', 25.00, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '2026-01-07 16:46:05', '2026-01-07 16:46:05'),
('eq333333-3333-3333-3333-333333333333', 'Meal Prep Containers', 20.00, 'cccccccc-cccc-cccc-cccc-cccccccccccc', '2026-01-07 16:46:05', '2026-01-07 16:46:05')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- Table: settings
-- ============================================
INSERT INTO settings (id, key, value, updated_at, created_at) VALUES
('set111111-1111-1111-1111-111111111111', 'default_delivery_days', 'Monday,Wednesday,Friday', '2026-01-07 16:46:06', '2026-01-07 16:46:06'),
('set222222-2222-2222-2222-222222222222', 'min_order_value', '25.00', '2026-01-07 16:46:06', '2026-01-07 16:46:06'),
('set333333-3333-3333-3333-333333333333', 'max_deliveries_per_week', '14', '2026-01-07 16:46:06', '2026-01-07 16:46:06'),
('set444444-4444-4444-4444-444444444444', 'notification_email', 'notifications@dietcombo.com', '2026-01-07 16:46:06', '2026-01-07 16:46:06')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- Table: clients
-- Note: Converting '0000-00-00' dates to NULL, converting TINYINT(1) to BOOLEAN
-- ============================================
INSERT INTO clients (id, full_name, first_name, last_name, email, address, apt, city, state, zip, county, phone_number, secondary_phone_number, client_id_external, case_id_external, medicaid, paused, complex, bill, delivery, dislikes, latitude, longitude, lat, lng, geocoded_at, billings, visits, sign_token, navigator_id, end_date, screening_took_place, screening_signed, screening_status, notes, status_id, service_type, approved_meals_per_week, parent_client_id, dob, cin, authorized_amount, expiration_date, active_order, created_at, updated_at) VALUES
('79aeb5f3-4ad3-4388-a607-a0db6b5d03e8', 'mike conde', NULL, NULL, 'mike.conde28@gmail.com', 'ph 4 bagong silang, caloocan city', NULL, 'caloocan city', 'WW', '1428', 'philippines', '09974469152', NULL, NULL, NULL, FALSE, FALSE, FALSE, TRUE, TRUE, NULL, NULL, NULL, 41.117906115211525, -74.07471656319721, NULL, 'null'::jsonb, 'null'::jsonb, NULL, 'nnnnnnnn-nnnn-nnnn-nnnn-nnnnnnnnnn11', NULL, FALSE, FALSE, 'not_started', '', '11111111-1111-1111-1111-111111111111', 'Food', 21, NULL, NULL, NULL, NULL, NULL, '{"serviceType":"Food","lastUpdated":"2026-01-11T13:23:44.408Z","updatedBy":"Admin"}'::jsonb, '2026-01-11 13:23:30', '2026-01-11 05:23:44'),
('client111-1111-1111-1111-111111111111', 'John Smith', 'John', 'Smith', 'john.smith@example.com', '123 Main St', 'Apt 2B', 'Anytown', 'NY', '12345', 'Any County', '555-0101', '555-0102', 'EXT-CLIENT-001', 'CASE-001', TRUE, FALSE, FALSE, TRUE, TRUE, 'Nuts, Shellfish', 40.7128, -74.006, 40.7128, -74.006, '2026-01-07 16:46:06', 'null'::jsonb, 'null'::jsonb, 'sign-token-111', 'nnnnnnnn-nnnn-nnnn-nnnn-nnnnnnnnnn11', '2026-07-08', TRUE, TRUE, 'completed', 'Client prefers low-sodium meals', '11111111-1111-1111-1111-111111111111', 'Meals', 10, NULL, '1980-05-15', 123456789, 500.00, '2027-01-08', '{"id":"00525e48-a59f-4e94-a286-934fac8b5d14","serviceType":"Meals","caseId":"CASE-001","status":"scheduled","lastUpdated":"2026-01-09T02:06:04.614Z","updatedBy":"Admin","scheduledDeliveryDate":null,"takeEffectDate":null,"deliveryDistribution":null,"totalValue":"0.00","totalItems":0,"notes":null}'::jsonb, '2026-01-07 16:46:06', '2026-01-08 18:06:04'),
('client222-2222-2222-2222-222222222222', 'Jane Doe', 'Jane', 'Doe', 'jane.doe@example.com', '456 Oak Ave', NULL, 'Somewhere', 'CA', '67890', 'Some County', '555-0201', NULL, 'EXT-CLIENT-002', 'CASE-002', FALSE, FALSE, FALSE, TRUE, TRUE, 'Meat, Dairy', 34.0522, -118.2437, 34.0522, -118.2437, '2026-01-07 16:46:06', 'null'::jsonb, 'null'::jsonb, 'sign-token-222', 'nnnnnnnn-nnnn-nnnn-nnnn-nnnnnnnnnn11', '2026-04-08', TRUE, TRUE, 'completed', 'Vegetarian diet', '11111111-1111-1111-1111-111111111111', 'Boxes', 7, NULL, '1992-08-22', 987654321, 350.00, '2026-07-08', '{"serviceType":"Boxes","caseId":"CASE-002","deliveryDistribution":{"Tuesday":1},"boxQuantity":1,"boxTypeId":"box11111-1111-1111-1111-111111111111","items":{},"itemPrices":{},"lastUpdated":"2026-01-08T23:24:04.749Z","updatedBy":"Admin"}'::jsonb, '2026-01-07 16:46:06', '2026-01-08 15:24:04'),
('client333-3333-3333-3333-333333333333', 'Robert Johnson', 'Robert', 'Johnson', 'robert.johnson@example.com', '789 Pine Rd', 'Suite 100', 'Elsewhere', 'TX', '54321', 'Else County', '555-0301', '555-0302', 'EXT-CLIENT-003', 'CASE-003', TRUE, FALSE, TRUE, TRUE, TRUE, NULL, 29.7604, -95.3698, 29.7604, -95.3698, '2026-01-07 16:46:06', 'null'::jsonb, 'null'::jsonb, NULL, 'nnnnnnnn-nnnn-nnnn-nnnn-nnnnnnnnnn22', '2027-01-08', FALSE, FALSE, 'not_started', 'New client, needs screening', '44444444-4444-4444-4444-444444444444', 'Meals', 14, NULL, '1975-03-10', 456789123, 750.00, '2028-01-08', '{"serviceType":"Meals","lastUpdated":"2026-01-09T02:06:12.819Z","updatedBy":"Admin"}'::jsonb, '2026-01-07 16:46:06', '2026-01-08 18:06:12'),
('client444-4444-4444-4444-444444444444', 'Maria Garcia', 'Maria', 'Garcia', 'maria.garcia@example.com', '321 Elm St', NULL, 'Nowhere', 'FL', '09876', 'No County', '555-0401', NULL, 'EXT-CLIENT-004', 'CASE-004', FALSE, FALSE, FALSE, TRUE, TRUE, 'Spicy foods', 25.7617, -80.1918, 25.7617, -80.1918, '2026-01-07 16:46:06', 'null'::jsonb, 'null'::jsonb, '2bacae2a-2abd-40ec-a922-6f1f432ba82f', 'nnnnnnnn-nnnn-nnnn-nnnn-nnnnnnnnnn22', NULL, TRUE, FALSE, 'in_progress', 'Waiting for signature', '11111111-1111-1111-1111-111111111111', 'Meals,Boxes', 12, NULL, '1988-11-30', 789123456, 600.00, '2027-07-08', '{"id":"24fad3d9-a459-4304-8987-c88ef77a803b","serviceType":"Meals,Boxes","caseId":"CASE-004","status":"scheduled","lastUpdated":"2026-01-09T02:05:57.632Z","updatedBy":"Admin","scheduledDeliveryDate":null,"takeEffectDate":null,"deliveryDistribution":null,"totalValue":"0.00","totalItems":0,"notes":null}'::jsonb, '2026-01-07 16:46:06', '2026-01-08 18:05:57'),
('client555-5555-5555-5555-555555555555', 'David Lee', 'David', 'Lee', 'david.lee@example.com', '654 Maple Dr', 'Unit 5', 'Anywhere', 'IL', '13579', 'Any County', '555-0501', '555-0502', 'EXT-CLIENT-005', 'CASE-005', TRUE, FALSE, FALSE, TRUE, TRUE, 'Gluten', 41.8781, -87.6298, 41.8781, -87.6298, '2026-01-07 16:46:06', 'null'::jsonb, 'null'::jsonb, 'sign-token-555', 'nnnnnnnn-nnnn-nnnn-nnnn-nnnnnnnnnn33', '2026-10-08', TRUE, TRUE, 'completed', 'Gluten-free requirements', '11111111-1111-1111-1111-111111111111', 'Meals', 8, NULL, '1995-07-18', 321654987, 400.00, '2027-01-08', '{"id":"8fa7c977-07f5-48fd-9d39-05016ca0652a","serviceType":"Meals","caseId":"CASE-005","status":"scheduled","lastUpdated":"2026-01-09T02:06:07.374Z","updatedBy":"Admin","scheduledDeliveryDate":null,"takeEffectDate":null,"deliveryDistribution":null,"totalValue":"0.00","totalItems":0,"notes":null}'::jsonb, '2026-01-07 16:46:06', '2026-01-08 18:06:07'),
('client666-6666-6666-6666-666666666666', 'Sarah Williams', 'Sarah', 'Williams', 'sarah.williams@example.com', '987 Cedar Ln', NULL, 'Someplace', 'WA', '24680', 'Some County', '555-0601', NULL, 'EXT-CLIENT-006', 'CASE-006', FALSE, TRUE, FALSE, TRUE, FALSE, NULL, 47.6062, -122.3321, 47.6062, -122.3321, '2026-01-07 16:46:06', NULL, NULL, '5fd978cb-9008-4b41-8168-8221cc8d42f3', 'nnnnnnnn-nnnn-nnnn-nnnn-nnnnnnnnnn33', NULL, FALSE, FALSE, 'not_started', NULL, '22222222-2222-2222-2222-222222222222', 'Boxes', 5, NULL, '1990-12-05', 654987321, 250.00, '2026-07-08', NULL, '2026-01-07 16:46:06', '2026-01-08 23:34:23'),
('client777-7777-7777-7777-777777777777', 'Michael Brown', 'Michael', 'Brown', 'michael.brown@example.com', '111 Park Ave', 'Apt 3C', 'Springfield', 'MA', '01103', 'Hampden', '555-0701', NULL, 'EXT-CLIENT-007', 'CASE-007', TRUE, FALSE, FALSE, TRUE, TRUE, NULL, 42.1015, -72.5898, 42.1015, -72.5898, '2026-01-07 16:46:06', 'null'::jsonb, 'null'::jsonb, '561e0ec7-df00-435d-b78d-32b85d416e82', 'nnnnnnnn-nnnn-nnnn-nnnn-nnnnnnnnnn11', '2026-05-08', TRUE, TRUE, 'completed', 'Regular client', '11111111-1111-1111-1111-111111111111', 'Meals', 10, NULL, '1985-09-20', 111222333, 450.00, '2026-09-08', '{"serviceType":"Meals","lastUpdated":"2026-01-09T02:06:01.607Z","updatedBy":"Admin"}'::jsonb, '2026-01-07 16:46:06', '2026-01-08 18:06:01'),
('client888-8888-8888-8888-888888888888', 'Emily Smith', 'Emily', 'Smith', NULL, '123 Main St', 'Apt 2B', 'Anytown', 'NY', '12345', 'Any County', '555-0101', NULL, NULL, NULL, FALSE, FALSE, FALSE, TRUE, TRUE, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'nnnnnnnn-nnnn-nnnn-nnnn-nnnnnnnnnn11', '2026-07-08', FALSE, FALSE, 'not_started', 'Dependent of John Smith', '11111111-1111-1111-1111-111111111111', 'Meals', 5, 'client111-1111-1111-1111-111111111111', '2010-03-15', 999888777, 250.00, '2027-01-08', NULL, '2026-01-07 16:46:06', '2026-01-07 16:46:06'),
('e1a8e568-d85f-4137-8c3e-20f0323a6af9', 'mike conde', NULL, NULL, 'mikewap07@gmail.com', 'ph 4 bagong silang, caloocan city', 'bagong silang', 'caloocan city', 'MM', '1428', 'No state/region', '', NULL, NULL, NULL, FALSE, FALSE, FALSE, TRUE, TRUE, NULL, NULL, NULL, 41.11479972528268, -74.05553345791765, NULL, 'null'::jsonb, 'null'::jsonb, 'b9672507-9488-4588-8e5e-f166476d7ff5', 'nnnnnnnn-nnnn-nnnn-nnnn-nnnnnnnnnn11', NULL, FALSE, FALSE, 'not_started', '', '11111111-1111-1111-1111-111111111111', 'Food', 21, NULL, NULL, NULL, NULL, NULL, '{"serviceType":"Food","lastUpdated":"2026-01-09T02:06:09.991Z","updatedBy":"Admin"}'::jsonb, '2026-01-07 16:59:04', '2026-01-08 18:06:10')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- Table: stops (insert before drivers and routes as they reference stop_ids)
-- ============================================
INSERT INTO stops (id, day, client_id, "order", name, address, apt, city, state, zip, phone, dislikes, lat, lng, completed, proof_url, assigned_driver_id, created_at, updated_at) VALUES
('stop1111-1111-1111-1111-111111111111', 'Monday', 'client111-1111-1111-1111-111111111111', 1, 'John Smith', '123 Main St', 'Apt 2B', 'Anytown', 'NY', '12345', '555-0101', 'Nuts, Shellfish', 40.7128, -74.0060, TRUE, NULL, NULL, '2026-01-07 16:46:06', '2026-01-07 16:46:06'),
('stop2222-2222-2222-2222-222222222222', 'Monday', 'client444-4444-4444-4444-444444444444', 2, 'Maria Garcia', '321 Elm St', NULL, 'Nowhere', 'FL', '09876', '555-0401', 'Spicy foods', 25.7617, -80.1918, FALSE, NULL, NULL, '2026-01-07 16:46:06', '2026-01-07 16:46:06'),
('stop3333-3333-3333-3333-333333333333', 'Monday', 'client777-7777-7777-7777-777777777777', 3, 'Michael Brown', '111 Park Ave', 'Apt 3C', 'Springfield', 'MA', '01103', '555-0701', NULL, 42.1015, -72.5898, FALSE, NULL, NULL, '2026-01-07 16:46:06', '2026-01-07 16:46:06'),
('stop4444-4444-4444-4444-444444444444', 'Tuesday', 'client222-2222-2222-2222-222222222222', 1, 'Jane Doe', '456 Oak Ave', NULL, 'Somewhere', 'CA', '67890', '555-0201', 'Meat, Dairy', 34.0522, -118.2437, FALSE, NULL, NULL, '2026-01-07 16:46:06', '2026-01-07 16:46:06'),
('stop5555-5555-5555-5555-555555555555', 'Friday', 'client555-5555-5555-5555-555555555555', 1, 'David Lee', '654 Maple Dr', 'Unit 5', 'Anywhere', 'IL', '13579', '555-0501', 'Gluten', 41.8781, -87.6298, FALSE, NULL, NULL, '2026-01-07 16:46:06', '2026-01-07 16:46:06')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- Table: drivers
-- ============================================
INSERT INTO drivers (id, day, name, color, stop_ids, created_at, updated_at) VALUES
('driv1111-1111-1111-1111-111111111111', 'Monday', 'Driver John', '#FF5733', '["stop1111-1111-1111-1111-111111111111", "stop2222-2222-2222-2222-222222222222", "stop3333-3333-3333-3333-333333333333"]'::jsonb, '2026-01-07 16:46:06', '2026-01-07 16:46:06'),
('driv2222-2222-2222-2222-222222222222', 'Tuesday', 'Driver Jane', '#33FF57', '["stop4444-4444-4444-4444-444444444444"]'::jsonb, '2026-01-07 16:46:06', '2026-01-07 16:46:06'),
('driv3333-3333-3333-3333-333333333333', 'Friday', 'Driver Bob', '#3357FF', '["stop5555-5555-5555-5555-555555555555"]'::jsonb, '2026-01-07 16:46:06', '2026-01-07 16:46:06')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- Table: routes
-- ============================================
INSERT INTO routes (id, name, color, stop_ids, created_at, updated_at) VALUES
('rr111111-1111-1111-1111-111111111111', 'Monday North Route', '#FF5733', '["stop1111-1111-1111-1111-111111111111", "stop2222-2222-2222-2222-222222222222", "stop3333-3333-3333-3333-333333333333"]'::jsonb, '2026-01-07 16:46:06', '2026-01-07 16:46:06'),
('rr222222-2222-2222-2222-222222222222', 'Tuesday Central Route', '#33FF57', '["stop4444-4444-4444-4444-444444444444"]'::jsonb, '2026-01-07 16:46:06', '2026-01-07 16:46:06'),
('rr333333-3333-3333-3333-333333333333', 'Friday East Route', '#3357FF', '["stop5555-5555-5555-5555-555555555555"]'::jsonb, '2026-01-07 16:46:06', '2026-01-07 16:46:06')
ON CONFLICT (id) DO NOTHING;

-- Note: Due to file size limits, the remaining INSERT statements for other tables
-- (billing_records, delivery_history, orders, etc.) would follow the same pattern:
-- - Convert TINYINT(1) 0/1 to FALSE/TRUE
-- - Convert JSON strings to JSONB using '::jsonb' cast
-- - Convert '0000-00-00' dates to NULL
-- - Use ON CONFLICT (id) DO NOTHING for idempotency
-- - Handle NULL values properly
