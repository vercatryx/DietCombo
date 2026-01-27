-- MySQL Database Schema for DietCombo
-- Run this script to create all tables

CREATE DATABASE IF NOT EXISTS dietcombo CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE dietcombo;

-- Client Statuses
CREATE TABLE IF NOT EXISTS client_statuses (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    is_system_default BOOLEAN DEFAULT FALSE,
    deliveries_allowed BOOLEAN DEFAULT TRUE,
    requires_units_on_change BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Vendors
CREATE TABLE IF NOT EXISTS vendors (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NULL,
    password VARCHAR(255) NULL,
    service_type VARCHAR(255) NULL,
    delivery_days JSON NULL,
    delivery_frequency VARCHAR(50) DEFAULT 'Once',
    is_active BOOLEAN DEFAULT TRUE,
    minimum_meals INT DEFAULT 0,
    cutoff_hours INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Item Categories
CREATE TABLE IF NOT EXISTS item_categories (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    set_value DECIMAL(10, 2) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Menu Items
CREATE TABLE IF NOT EXISTS menu_items (
    id VARCHAR(36) PRIMARY KEY,
    vendor_id VARCHAR(36) NULL,
    name VARCHAR(255) NOT NULL,
    value DECIMAL(10, 2) NOT NULL,
    price_each DECIMAL(10, 2) NULL,
    is_active BOOLEAN DEFAULT TRUE,
    category_id VARCHAR(36) NULL,
    quota_value DECIMAL(10, 2) NULL,
    minimum_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE SET NULL,
    FOREIGN KEY (category_id) REFERENCES item_categories(id) ON DELETE SET NULL
);

-- Equipment
CREATE TABLE IF NOT EXISTS equipment (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    vendor_id VARCHAR(36) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE SET NULL
);

-- Box Types
CREATE TABLE IF NOT EXISTS box_types (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    vendor_id VARCHAR(36) NULL,
    is_active BOOLEAN DEFAULT TRUE,
    price_each DECIMAL(10, 2) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE SET NULL
);

-- Box Quotas
CREATE TABLE IF NOT EXISTS box_quotas (
    id VARCHAR(36) PRIMARY KEY,
    box_type_id VARCHAR(36) NOT NULL,
    category_id VARCHAR(36) NOT NULL,
    target_value DECIMAL(10, 2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (box_type_id) REFERENCES box_types(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES item_categories(id) ON DELETE CASCADE
);

-- App Settings
CREATE TABLE IF NOT EXISTS app_settings (
    id VARCHAR(36) PRIMARY KEY DEFAULT '1',
    weekly_cutoff_day VARCHAR(50) DEFAULT 'Friday',
    weekly_cutoff_time VARCHAR(50) DEFAULT '17:00',
    report_email VARCHAR(255) NULL,
    enable_passwordless_login BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Navigators
CREATE TABLE IF NOT EXISTS navigators (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NULL,
    password VARCHAR(255) NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Nutritionists
CREATE TABLE IF NOT EXISTS nutritionists (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Admins
CREATE TABLE IF NOT EXISTS admins (
    id VARCHAR(36) PRIMARY KEY,
    username VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    name VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Clients (merged with User fields from dietfantasy)
CREATE TABLE IF NOT EXISTS clients (
    id VARCHAR(36) PRIMARY KEY,
    full_name VARCHAR(255) NOT NULL,
    -- Additional name fields from dietfantasy (can be derived from full_name or stored separately)
    first_name VARCHAR(255) NULL,
    last_name VARCHAR(255) NULL,
    email VARCHAR(255) NULL,
    address TEXT NULL,
    -- Address components from dietfantasy
    apt VARCHAR(50) NULL,
    city VARCHAR(100) NULL,
    state VARCHAR(2) NULL,
    zip VARCHAR(10) NULL,
    county VARCHAR(100) NULL,
    phone_number VARCHAR(255) NULL,
    secondary_phone_number VARCHAR(255) NULL,
    -- External identifiers from dietfantasy
    client_id_external VARCHAR(100) NULL,
    case_id_external VARCHAR(100) NULL,
    -- Status flags from dietfantasy
    medicaid BOOLEAN DEFAULT FALSE,
    paused BOOLEAN DEFAULT FALSE,
    complex BOOLEAN DEFAULT FALSE,
    bill BOOLEAN DEFAULT TRUE,
    delivery BOOLEAN DEFAULT TRUE,
    -- Dietary preferences
    dislikes TEXT NULL,
    -- Geocoding fields from dietfantasy
    latitude DOUBLE NULL,
    longitude DOUBLE NULL,
    lat DOUBLE NULL,
    lng DOUBLE NULL,
    geocoded_at TIMESTAMP NULL,
    -- JSON data fields from dietfantasy
    billings JSON NULL,
    visits JSON NULL,
    -- Signature token for digital signatures
    sign_token VARCHAR(255) NULL UNIQUE,
    -- Original DietCombo fields
    navigator_id VARCHAR(36) NULL,
    end_date DATE NULL,
    screening_took_place BOOLEAN DEFAULT FALSE,
    screening_signed BOOLEAN DEFAULT FALSE,
    screening_status VARCHAR(50) DEFAULT 'not_started',
    notes TEXT NULL,
    status_id VARCHAR(36) NULL,
    service_type VARCHAR(50) NOT NULL,
    approved_meals_per_week INT NULL,
    parent_client_id VARCHAR(36) NULL,
    dob DATE NULL,
    cin DECIMAL(10, 0) NULL,
    authorized_amount DECIMAL(10, 2) NULL,
    expiration_date DATE NULL,
    active_order JSON NULL,
    assigned_driver_id VARCHAR(36) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (navigator_id) REFERENCES navigators(id) ON DELETE SET NULL,
    FOREIGN KEY (status_id) REFERENCES client_statuses(id) ON DELETE SET NULL,
    FOREIGN KEY (parent_client_id) REFERENCES clients(id) ON DELETE SET NULL,
    FOREIGN KEY (assigned_driver_id) REFERENCES drivers(id) ON DELETE SET NULL,
    INDEX idx_clients_client_id_external (client_id_external),
    INDEX idx_clients_assigned_driver_id (assigned_driver_id),
    INDEX idx_clients_case_id_external (case_id_external),
    INDEX idx_clients_sign_token (sign_token)
);

-- Orders
CREATE TABLE IF NOT EXISTS orders (
    id VARCHAR(36) PRIMARY KEY,
    client_id VARCHAR(36) NOT NULL,
    service_type VARCHAR(50) NOT NULL,
    case_id VARCHAR(255) NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    scheduled_delivery_date DATE NULL,
    actual_delivery_date DATE NULL,
    delivery_day VARCHAR(50) NULL,
    delivery_distribution JSON NULL,
    total_value DECIMAL(10, 2) NULL,
    total_items INT NULL,
    bill_amount DECIMAL(10, 2) NULL,
    notes TEXT NULL,
    proof_of_delivery_url VARCHAR(500) NULL,
    order_number INT NULL UNIQUE,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    INDEX idx_orders_order_number (order_number)
);

-- Order Vendor Selections
CREATE TABLE IF NOT EXISTS order_vendor_selections (
    id VARCHAR(36) PRIMARY KEY,
    order_id VARCHAR(36) NOT NULL,
    vendor_id VARCHAR(36) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
);

-- Order Items
CREATE TABLE IF NOT EXISTS order_items (
    id VARCHAR(36) PRIMARY KEY,
    vendor_selection_id VARCHAR(36) NOT NULL,
    menu_item_id VARCHAR(36) NOT NULL,
    quantity INT NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (vendor_selection_id) REFERENCES order_vendor_selections(id) ON DELETE CASCADE,
    FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE
);

-- Order Box Selections
CREATE TABLE IF NOT EXISTS order_box_selections (
    id VARCHAR(36) PRIMARY KEY,
    order_id VARCHAR(36) NOT NULL,
    vendor_id VARCHAR(36) NOT NULL,
    box_type_id VARCHAR(36) NOT NULL,
    quantity INT NOT NULL DEFAULT 1,
    items JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE,
    FOREIGN KEY (box_type_id) REFERENCES box_types(id) ON DELETE CASCADE
);

-- Upcoming Orders
CREATE TABLE IF NOT EXISTS upcoming_orders (
    id VARCHAR(36) PRIMARY KEY,
    client_id VARCHAR(36) NOT NULL,
    service_type VARCHAR(50) NOT NULL,
    case_id VARCHAR(255) NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'scheduled',
    scheduled_delivery_date DATE NULL,
    take_effect_date DATE NULL,
    delivery_day VARCHAR(50) NULL,
    delivery_distribution JSON NULL,
    total_value DECIMAL(10, 2) NULL,
    total_items INT NULL,
    bill_amount DECIMAL(10, 2) NULL,
    notes TEXT NULL,
    order_number INT NULL,
    processed_order_id VARCHAR(36) NULL,
    processed_at TIMESTAMP NULL,
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    updated_by VARCHAR(255) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    FOREIGN KEY (processed_order_id) REFERENCES orders(id) ON DELETE SET NULL,
    INDEX idx_upcoming_orders_order_number (order_number),
    INDEX idx_upcoming_orders_processed_order_id (processed_order_id)
);

-- Upcoming Order Vendor Selections
CREATE TABLE IF NOT EXISTS upcoming_order_vendor_selections (
    id VARCHAR(36) PRIMARY KEY,
    upcoming_order_id VARCHAR(36) NOT NULL,
    vendor_id VARCHAR(36) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (upcoming_order_id) REFERENCES upcoming_orders(id) ON DELETE CASCADE,
    FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
);

-- Upcoming Order Items
CREATE TABLE IF NOT EXISTS upcoming_order_items (
    id VARCHAR(36) PRIMARY KEY,
    upcoming_order_id VARCHAR(36) NOT NULL,
    vendor_selection_id VARCHAR(36) NULL,
    upcoming_vendor_selection_id VARCHAR(36) NULL,
    menu_item_id VARCHAR(36) NOT NULL,
    quantity INT NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (upcoming_order_id) REFERENCES upcoming_orders(id) ON DELETE CASCADE,
    FOREIGN KEY (vendor_selection_id) REFERENCES order_vendor_selections(id) ON DELETE CASCADE,
    FOREIGN KEY (upcoming_vendor_selection_id) REFERENCES upcoming_order_vendor_selections(id) ON DELETE CASCADE,
    FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE,
    INDEX idx_upcoming_order_items_upcoming_order_id (upcoming_order_id)
);

-- Upcoming Order Box Selections
CREATE TABLE IF NOT EXISTS upcoming_order_box_selections (
    id VARCHAR(36) PRIMARY KEY,
    upcoming_order_id VARCHAR(36) NOT NULL,
    vendor_id VARCHAR(36) NOT NULL,
    box_type_id VARCHAR(36) NOT NULL,
    quantity INT NOT NULL DEFAULT 1,
    items JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (upcoming_order_id) REFERENCES upcoming_orders(id) ON DELETE CASCADE,
    FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE,
    FOREIGN KEY (box_type_id) REFERENCES box_types(id) ON DELETE CASCADE
);

-- Delivery History
CREATE TABLE IF NOT EXISTS delivery_history (
    id VARCHAR(36) PRIMARY KEY,
    client_id VARCHAR(36) NOT NULL,
    vendor_id VARCHAR(36) NOT NULL,
    service_type VARCHAR(50) NOT NULL,
    delivery_date DATE NOT NULL,
    items_summary TEXT NULL,
    proof_of_delivery_image VARCHAR(500) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
);

-- Order History Log
CREATE TABLE IF NOT EXISTS order_history (
    id VARCHAR(36) PRIMARY KEY,
    client_id VARCHAR(36) NOT NULL,
    who VARCHAR(255) NOT NULL,
    summary TEXT NOT NULL,
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);

-- Billing Records
CREATE TABLE IF NOT EXISTS billing_records (
    id VARCHAR(36) PRIMARY KEY,
    client_id VARCHAR(36) NOT NULL,
    order_id VARCHAR(36) NULL,
    status VARCHAR(50) NOT NULL,
    remarks TEXT NULL,
    navigator VARCHAR(255) NULL,
    amount DECIMAL(10, 2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
);

-- Navigator Logs
CREATE TABLE IF NOT EXISTS navigator_logs (
    id VARCHAR(36) PRIMARY KEY,
    navigator_id VARCHAR(36) NOT NULL,
    client_id VARCHAR(36) NOT NULL,
    action VARCHAR(255) NOT NULL,
    details TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (navigator_id) REFERENCES navigators(id) ON DELETE CASCADE,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);

-- Forms
CREATE TABLE IF NOT EXISTS forms (
    id VARCHAR(36) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Questions
CREATE TABLE IF NOT EXISTS questions (
    id VARCHAR(36) PRIMARY KEY,
    form_id VARCHAR(36) NOT NULL,
    text TEXT NOT NULL,
    type VARCHAR(50) NOT NULL,
    options JSON NULL,
    conditional_text_inputs JSON NULL,
    `order` INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (form_id) REFERENCES forms(id) ON DELETE CASCADE
);

-- Filled Forms
CREATE TABLE IF NOT EXISTS filled_forms (
    id VARCHAR(36) PRIMARY KEY,
    form_id VARCHAR(36) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (form_id) REFERENCES forms(id) ON DELETE CASCADE
);

-- Form Answers
CREATE TABLE IF NOT EXISTS form_answers (
    id VARCHAR(36) PRIMARY KEY,
    filled_form_id VARCHAR(36) NOT NULL,
    question_id VARCHAR(36) NOT NULL,
    value TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (filled_form_id) REFERENCES filled_forms(id) ON DELETE CASCADE,
    FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
);

-- Form Submissions
CREATE TABLE IF NOT EXISTS form_submissions (
    id VARCHAR(36) PRIMARY KEY,
    form_id VARCHAR(36) NOT NULL,
    client_id VARCHAR(36) NULL,
    token VARCHAR(255) NOT NULL UNIQUE,
    status VARCHAR(50) DEFAULT 'pending',
    data JSON NULL,
    signature_url VARCHAR(500) NULL,
    pdf_url VARCHAR(500) NULL,
    comments TEXT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (form_id) REFERENCES forms(id) ON DELETE CASCADE,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
);

-- Passwordless Codes
CREATE TABLE IF NOT EXISTS passwordless_codes (
    id VARCHAR(36) PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    code VARCHAR(10) NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    attempts INT DEFAULT 0,
    INDEX idx_passwordless_codes_email (email)
);

-- Schedule (from dietfantasy - delivery schedule per client)
CREATE TABLE IF NOT EXISTS schedules (
    id VARCHAR(36) PRIMARY KEY,
    client_id VARCHAR(36) NOT NULL UNIQUE,
    monday BOOLEAN DEFAULT TRUE,
    tuesday BOOLEAN DEFAULT TRUE,
    wednesday BOOLEAN DEFAULT TRUE,
    thursday BOOLEAN DEFAULT TRUE,
    friday BOOLEAN DEFAULT TRUE,
    saturday BOOLEAN DEFAULT TRUE,
    sunday BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    INDEX idx_schedules_client_id (client_id)
);

-- Stops (from dietfantasy - delivery stops for routing)
CREATE TABLE IF NOT EXISTS stops (
    id VARCHAR(36) PRIMARY KEY,
    day VARCHAR(20) NOT NULL,
    delivery_date DATE NULL,
    client_id VARCHAR(36) NULL,
    order_id VARCHAR(36) NULL,
    `order` INT NULL,
    name VARCHAR(255) NOT NULL,
    address VARCHAR(500) NOT NULL,
    apt VARCHAR(50) NULL,
    city VARCHAR(100) NOT NULL,
    state VARCHAR(2) NOT NULL,
    zip VARCHAR(10) NOT NULL,
    phone VARCHAR(20) NULL,
    dislikes TEXT NULL,
    lat DOUBLE NULL,
    lng DOUBLE NULL,
    completed BOOLEAN DEFAULT FALSE,
    proof_url VARCHAR(500) NULL,
    assigned_driver_id VARCHAR(36) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
    INDEX idx_stops_day (day),
    INDEX idx_stops_delivery_date (delivery_date),
    INDEX idx_stops_client_id (client_id),
    INDEX idx_stops_order_id (order_id),
    UNIQUE KEY idx_stops_client_delivery_date (client_id, delivery_date)
);

-- Drivers (from dietfantasy - driver management)
CREATE TABLE IF NOT EXISTS drivers (
    id VARCHAR(36) PRIMARY KEY,
    day VARCHAR(20) NOT NULL,
    name VARCHAR(255) NOT NULL,
    color VARCHAR(7) NULL,
    stop_ids JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_drivers_day (day)
);

-- Routes (from dietfantasy - route configurations)
CREATE TABLE IF NOT EXISTS routes (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    color VARCHAR(7) NULL,
    stop_ids JSON NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Route Runs (from dietfantasy - historical route snapshots)
CREATE TABLE IF NOT EXISTS route_runs (
    id VARCHAR(36) PRIMARY KEY,
    day VARCHAR(20) NOT NULL,
    snapshot JSON NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_route_runs_day (day),
    INDEX idx_route_runs_created_at (created_at)
);

-- Signatures (from dietfantasy - digital signatures)
CREATE TABLE IF NOT EXISTS signatures (
    id VARCHAR(36) PRIMARY KEY,
    client_id VARCHAR(36) NOT NULL,
    order_id VARCHAR(36) NULL,
    slot INT NOT NULL,
    strokes JSON NOT NULL,
    signed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    ip VARCHAR(45) NULL,
    user_agent VARCHAR(500) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
    UNIQUE KEY unique_client_slot (client_id, slot),
    INDEX idx_signatures_client_id (client_id),
    INDEX idx_signatures_order_id (order_id)
);

-- City Colors (from dietfantasy - city color coding for maps)
CREATE TABLE IF NOT EXISTS city_colors (
    id VARCHAR(36) PRIMARY KEY,
    city VARCHAR(100) NOT NULL UNIQUE,
    color VARCHAR(7) NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Settings (from dietfantasy - key-value configuration storage)
-- Note: This is separate from app_settings which has specific fields
CREATE TABLE IF NOT EXISTS settings (
    id VARCHAR(36) PRIMARY KEY,
    `key` VARCHAR(255) NOT NULL UNIQUE,
    value TEXT NOT NULL,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_settings_key (`key`)
);

-- Create indexes for better performance
CREATE INDEX idx_orders_client_id ON orders(client_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_scheduled_delivery_date ON orders(scheduled_delivery_date);
CREATE INDEX idx_upcoming_orders_client_id ON upcoming_orders(client_id);
CREATE INDEX idx_upcoming_orders_status ON upcoming_orders(status);
CREATE INDEX idx_clients_navigator_id ON clients(navigator_id);
CREATE INDEX idx_clients_status_id ON clients(status_id);
CREATE INDEX idx_order_vendor_selections_order_id ON order_vendor_selections(order_id);
CREATE INDEX idx_order_items_vendor_selection_id ON order_items(vendor_selection_id);
CREATE INDEX idx_form_submissions_token ON form_submissions(token);
CREATE INDEX idx_form_submissions_client_id ON form_submissions(client_id);
-- Additional indexes for new tables from dietfantasy
CREATE INDEX idx_stops_completed ON stops(completed);
CREATE INDEX idx_drivers_name ON drivers(name);
CREATE INDEX idx_routes_name ON routes(name);
CREATE INDEX idx_signatures_signed_at ON signatures(signed_at);

-- Insert default app settings
INSERT INTO app_settings (id, weekly_cutoff_day, weekly_cutoff_time, enable_passwordless_login)
VALUES ('1', 'Friday', '17:00', FALSE)
ON DUPLICATE KEY UPDATE id=id;

