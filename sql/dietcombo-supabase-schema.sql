-- Supabase/PostgreSQL Schema for DietCombo
-- Converted from MySQL/MariaDB dump
-- Run this in Supabase SQL Editor

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- Helper function for updating updated_at timestamps
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- ============================================
-- Table: admins
-- ============================================
CREATE TABLE IF NOT EXISTS admins (
    id VARCHAR(36) PRIMARY KEY,
    username VARCHAR(255) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    name VARCHAR(255) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER update_admins_updated_at BEFORE UPDATE ON admins
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Table: app_settings
-- ============================================
CREATE TABLE IF NOT EXISTS app_settings (
    id VARCHAR(36) PRIMARY KEY DEFAULT '1',
    weekly_cutoff_day VARCHAR(50) DEFAULT 'Friday',
    weekly_cutoff_time VARCHAR(50) DEFAULT '17:00',
    report_email VARCHAR(255) NULL,
    enable_passwordless_login BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER update_app_settings_updated_at BEFORE UPDATE ON app_settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Table: billing_records
-- ============================================
CREATE TABLE IF NOT EXISTS billing_records (
    id VARCHAR(36) PRIMARY KEY,
    client_id VARCHAR(36) NOT NULL,
    order_id VARCHAR(36) NULL,
    status VARCHAR(50) NOT NULL,
    remarks TEXT NULL,
    navigator VARCHAR(255) NULL,
    amount NUMERIC(10,2) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_billing_records_client_id ON billing_records(client_id);
CREATE INDEX IF NOT EXISTS idx_billing_records_order_id ON billing_records(order_id);

-- ============================================
-- Table: box_quotas
-- ============================================
CREATE TABLE IF NOT EXISTS box_quotas (
    id VARCHAR(36) PRIMARY KEY,
    box_type_id VARCHAR(36) NOT NULL,
    category_id VARCHAR(36) NOT NULL,
    target_value NUMERIC(10,2) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_box_quotas_box_type_id ON box_quotas(box_type_id);
CREATE INDEX IF NOT EXISTS idx_box_quotas_category_id ON box_quotas(category_id);

CREATE TRIGGER update_box_quotas_updated_at BEFORE UPDATE ON box_quotas
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Table: box_types
-- ============================================
CREATE TABLE IF NOT EXISTS box_types (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    vendor_id VARCHAR(36) NULL,
    is_active BOOLEAN DEFAULT TRUE,
    price_each NUMERIC(10,2) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_box_types_vendor_id ON box_types(vendor_id);

CREATE TRIGGER update_box_types_updated_at BEFORE UPDATE ON box_types
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Table: city_colors
-- ============================================
CREATE TABLE IF NOT EXISTS city_colors (
    id VARCHAR(36) PRIMARY KEY,
    city VARCHAR(100) NOT NULL UNIQUE,
    color VARCHAR(7) NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER update_city_colors_updated_at BEFORE UPDATE ON city_colors
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Table: client_statuses
-- ============================================
CREATE TABLE IF NOT EXISTS client_statuses (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    is_system_default BOOLEAN DEFAULT FALSE,
    deliveries_allowed BOOLEAN DEFAULT TRUE,
    requires_units_on_change BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER update_client_statuses_updated_at BEFORE UPDATE ON client_statuses
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Table: clients
-- ============================================
CREATE TABLE IF NOT EXISTS clients (
    id VARCHAR(36) PRIMARY KEY,
    full_name VARCHAR(255) NOT NULL,
    first_name VARCHAR(255) NULL,
    last_name VARCHAR(255) NULL,
    email VARCHAR(255) NULL,
    address TEXT NULL,
    apt VARCHAR(50) NULL,
    city VARCHAR(100) NULL,
    state VARCHAR(2) NULL,
    zip VARCHAR(10) NULL,
    county VARCHAR(100) NULL,
    phone_number VARCHAR(255) NULL,
    secondary_phone_number VARCHAR(255) NULL,
    client_id_external VARCHAR(100) NULL,
    case_id_external VARCHAR(100) NULL,
    medicaid BOOLEAN DEFAULT FALSE,
    paused BOOLEAN DEFAULT FALSE,
    complex BOOLEAN DEFAULT FALSE,
    bill BOOLEAN DEFAULT TRUE,
    delivery BOOLEAN DEFAULT TRUE,
    dislikes TEXT NULL,
    latitude DOUBLE PRECISION NULL,
    longitude DOUBLE PRECISION NULL,
    lat DOUBLE PRECISION NULL,
    lng DOUBLE PRECISION NULL,
    geocoded_at TIMESTAMP NULL,
    billings JSONB NULL,
    visits JSONB NULL,
    sign_token VARCHAR(255) NULL UNIQUE,
    navigator_id VARCHAR(36) NULL,
    end_date DATE NULL,
    screening_took_place BOOLEAN DEFAULT FALSE,
    screening_signed BOOLEAN DEFAULT FALSE,
    screening_status VARCHAR(50) DEFAULT 'not_started',
    notes TEXT NULL,
    status_id VARCHAR(36) NULL,
    service_type VARCHAR(50) NOT NULL,
    approved_meals_per_week INTEGER NULL,
    parent_client_id VARCHAR(36) NULL,
    dob DATE NULL,
    cin NUMERIC(10,0) NULL,
    authorized_amount NUMERIC(10,2) NULL,
    expiration_date DATE NULL,
    active_order JSONB NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by VARCHAR(255) NULL
);

CREATE INDEX IF NOT EXISTS idx_clients_client_id_external ON clients(client_id_external);
CREATE INDEX IF NOT EXISTS idx_clients_case_id_external ON clients(case_id_external);
CREATE INDEX IF NOT EXISTS idx_clients_sign_token ON clients(sign_token);
CREATE INDEX IF NOT EXISTS idx_clients_navigator_id ON clients(navigator_id);
CREATE INDEX IF NOT EXISTS idx_clients_status_id ON clients(status_id);
CREATE INDEX IF NOT EXISTS idx_clients_parent_client_id ON clients(parent_client_id);

CREATE TRIGGER update_clients_updated_at BEFORE UPDATE ON clients
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Table: delivery_history
-- ============================================
CREATE TABLE IF NOT EXISTS delivery_history (
    id VARCHAR(36) PRIMARY KEY,
    client_id VARCHAR(36) NOT NULL,
    vendor_id VARCHAR(36) NOT NULL,
    service_type VARCHAR(50) NOT NULL,
    delivery_date DATE NOT NULL,
    items_summary TEXT NULL,
    proof_of_delivery_image VARCHAR(500) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_delivery_history_client_id ON delivery_history(client_id);
CREATE INDEX IF NOT EXISTS idx_delivery_history_vendor_id ON delivery_history(vendor_id);

-- ============================================
-- Table: drivers
-- ============================================
CREATE TABLE IF NOT EXISTS drivers (
    id VARCHAR(36) PRIMARY KEY,
    day VARCHAR(20) NOT NULL,
    name VARCHAR(255) NOT NULL,
    color VARCHAR(7) NULL,
    stop_ids JSONB NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_drivers_day ON drivers(day);
CREATE INDEX IF NOT EXISTS idx_drivers_name ON drivers(name);

CREATE TRIGGER update_drivers_updated_at BEFORE UPDATE ON drivers
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Table: equipment
-- ============================================
CREATE TABLE IF NOT EXISTS equipment (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    price NUMERIC(10,2) NOT NULL,
    vendor_id VARCHAR(36) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_equipment_vendor_id ON equipment(vendor_id);

CREATE TRIGGER update_equipment_updated_at BEFORE UPDATE ON equipment
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Table: filled_forms
-- ============================================
CREATE TABLE IF NOT EXISTS filled_forms (
    id VARCHAR(36) PRIMARY KEY,
    form_id VARCHAR(36) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_filled_forms_form_id ON filled_forms(form_id);

-- ============================================
-- Table: forms
-- ============================================
CREATE TABLE IF NOT EXISTS forms (
    id VARCHAR(36) PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    description TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER update_forms_updated_at BEFORE UPDATE ON forms
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Table: form_answers
-- ============================================
CREATE TABLE IF NOT EXISTS form_answers (
    id VARCHAR(36) PRIMARY KEY,
    filled_form_id VARCHAR(36) NOT NULL,
    question_id VARCHAR(36) NOT NULL,
    value TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_form_answers_filled_form_id ON form_answers(filled_form_id);
CREATE INDEX IF NOT EXISTS idx_form_answers_question_id ON form_answers(question_id);

-- ============================================
-- Table: form_submissions
-- ============================================
CREATE TABLE IF NOT EXISTS form_submissions (
    id VARCHAR(36) PRIMARY KEY,
    form_id VARCHAR(36) NOT NULL,
    client_id VARCHAR(36) NULL,
    token VARCHAR(255) NOT NULL UNIQUE,
    status VARCHAR(50) DEFAULT 'pending',
    data JSONB NULL,
    signature_url VARCHAR(500) NULL,
    pdf_url VARCHAR(500) NULL,
    comments TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_form_submissions_token ON form_submissions(token);
CREATE INDEX IF NOT EXISTS idx_form_submissions_client_id ON form_submissions(client_id);
CREATE INDEX IF NOT EXISTS idx_form_submissions_form_id ON form_submissions(form_id);

CREATE TRIGGER update_form_submissions_updated_at BEFORE UPDATE ON form_submissions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Table: item_categories
-- ============================================
CREATE TABLE IF NOT EXISTS item_categories (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    set_value NUMERIC(10,2) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER update_item_categories_updated_at BEFORE UPDATE ON item_categories
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Table: menu_items
-- ============================================
CREATE TABLE IF NOT EXISTS menu_items (
    id VARCHAR(36) PRIMARY KEY,
    vendor_id VARCHAR(36) NULL,
    name VARCHAR(255) NOT NULL,
    value NUMERIC(10,2) NOT NULL,
    price_each NUMERIC(10,2) NULL,
    is_active BOOLEAN DEFAULT TRUE,
    category_id VARCHAR(36) NULL,
    quota_value NUMERIC(10,2) NULL,
    minimum_order INTEGER DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_menu_items_vendor_id ON menu_items(vendor_id);
CREATE INDEX IF NOT EXISTS idx_menu_items_category_id ON menu_items(category_id);

CREATE TRIGGER update_menu_items_updated_at BEFORE UPDATE ON menu_items
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Table: navigators
-- ============================================
CREATE TABLE IF NOT EXISTS navigators (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NULL,
    password VARCHAR(255) NULL,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER update_navigators_updated_at BEFORE UPDATE ON navigators
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Table: navigator_logs
-- ============================================
CREATE TABLE IF NOT EXISTS navigator_logs (
    id VARCHAR(36) PRIMARY KEY,
    navigator_id VARCHAR(36) NOT NULL,
    client_id VARCHAR(36) NOT NULL,
    action VARCHAR(255) NOT NULL,
    details TEXT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_navigator_logs_navigator_id ON navigator_logs(navigator_id);
CREATE INDEX IF NOT EXISTS idx_navigator_logs_client_id ON navigator_logs(client_id);

-- ============================================
-- Table: nutritionists
-- ============================================
CREATE TABLE IF NOT EXISTS nutritionists (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER update_nutritionists_updated_at BEFORE UPDATE ON nutritionists
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Table: orders
-- ============================================
CREATE TABLE IF NOT EXISTS orders (
    id VARCHAR(36) PRIMARY KEY,
    client_id VARCHAR(36) NOT NULL,
    service_type VARCHAR(50) NOT NULL,
    case_id VARCHAR(255) NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending',
    scheduled_delivery_date DATE NULL,
    actual_delivery_date DATE NULL,
    delivery_day VARCHAR(50) NULL,
    delivery_distribution JSONB NULL,
    total_value NUMERIC(10,2) NULL,
    total_items INTEGER NULL,
    notes TEXT NULL,
    proof_of_delivery_url VARCHAR(500) NULL,
    order_number INTEGER NULL UNIQUE,
    last_updated TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by VARCHAR(255) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_orders_order_number ON orders(order_number);
CREATE INDEX IF NOT EXISTS idx_orders_client_id ON orders(client_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_scheduled_delivery_date ON orders(scheduled_delivery_date);

CREATE TRIGGER update_orders_last_updated BEFORE UPDATE ON orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Table: order_box_selections
-- ============================================
CREATE TABLE IF NOT EXISTS order_box_selections (
    id VARCHAR(36) PRIMARY KEY,
    order_id VARCHAR(36) NOT NULL,
    vendor_id VARCHAR(36) NOT NULL,
    box_type_id VARCHAR(36) NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    items JSONB NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_order_box_selections_order_id ON order_box_selections(order_id);
CREATE INDEX IF NOT EXISTS idx_order_box_selections_vendor_id ON order_box_selections(vendor_id);
CREATE INDEX IF NOT EXISTS idx_order_box_selections_box_type_id ON order_box_selections(box_type_id);

-- ============================================
-- Table: order_history
-- ============================================
CREATE TABLE IF NOT EXISTS order_history (
    id VARCHAR(36) PRIMARY KEY,
    client_id VARCHAR(36) NOT NULL,
    who VARCHAR(255) NOT NULL,
    summary TEXT NOT NULL,
    timestamp TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_order_history_client_id ON order_history(client_id);

-- ============================================
-- Table: order_items
-- ============================================
CREATE TABLE IF NOT EXISTS order_items (
    id VARCHAR(36) PRIMARY KEY,
    vendor_selection_id VARCHAR(36) NOT NULL,
    menu_item_id VARCHAR(36) NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_order_items_vendor_selection_id ON order_items(vendor_selection_id);
CREATE INDEX IF NOT EXISTS idx_order_items_menu_item_id ON order_items(menu_item_id);

-- ============================================
-- Table: order_vendor_selections
-- ============================================
CREATE TABLE IF NOT EXISTS order_vendor_selections (
    id VARCHAR(36) PRIMARY KEY,
    order_id VARCHAR(36) NOT NULL,
    vendor_id VARCHAR(36) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_order_vendor_selections_order_id ON order_vendor_selections(order_id);
CREATE INDEX IF NOT EXISTS idx_order_vendor_selections_vendor_id ON order_vendor_selections(vendor_id);

-- ============================================
-- Table: passwordless_codes
-- ============================================
CREATE TABLE IF NOT EXISTS passwordless_codes (
    id VARCHAR(36) PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    code VARCHAR(10) NOT NULL,
    expires_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    attempts INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_passwordless_codes_email ON passwordless_codes(email);

-- ============================================
-- Table: questions
-- ============================================
CREATE TABLE IF NOT EXISTS questions (
    id VARCHAR(36) PRIMARY KEY,
    form_id VARCHAR(36) NOT NULL,
    text TEXT NOT NULL,
    type VARCHAR(50) NOT NULL,
    options JSONB NULL,
    conditional_text_inputs JSONB NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_questions_form_id ON questions(form_id);

CREATE TRIGGER update_questions_updated_at BEFORE UPDATE ON questions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Table: routes
-- ============================================
CREATE TABLE IF NOT EXISTS routes (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    color VARCHAR(7) NULL,
    stop_ids JSONB NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_routes_name ON routes(name);

CREATE TRIGGER update_routes_updated_at BEFORE UPDATE ON routes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Table: route_runs
-- ============================================
CREATE TABLE IF NOT EXISTS route_runs (
    id VARCHAR(36) PRIMARY KEY,
    day VARCHAR(20) NOT NULL,
    snapshot JSONB NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_route_runs_day ON route_runs(day);
CREATE INDEX IF NOT EXISTS idx_route_runs_created_at ON route_runs(created_at);

-- ============================================
-- Table: schedules
-- ============================================
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
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_schedules_client_id ON schedules(client_id);

CREATE TRIGGER update_schedules_updated_at BEFORE UPDATE ON schedules
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Table: settings
-- ============================================
CREATE TABLE IF NOT EXISTS settings (
    id VARCHAR(36) PRIMARY KEY,
    key VARCHAR(255) NOT NULL UNIQUE,
    value TEXT NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_settings_key ON settings(key);

CREATE TRIGGER update_settings_updated_at BEFORE UPDATE ON settings
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Table: signatures
-- ============================================
CREATE TABLE IF NOT EXISTS signatures (
    id VARCHAR(36) PRIMARY KEY,
    client_id VARCHAR(36) NOT NULL,
    order_id VARCHAR(36) NULL,
    slot INTEGER NOT NULL,
    strokes JSONB NOT NULL,
    signed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ip VARCHAR(45) NULL,
    user_agent VARCHAR(500) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(client_id, slot)
);

CREATE INDEX IF NOT EXISTS idx_signatures_client_id ON signatures(client_id);
CREATE INDEX IF NOT EXISTS idx_signatures_signed_at ON signatures(signed_at);
CREATE INDEX IF NOT EXISTS idx_signatures_order_id ON signatures(order_id);

-- ============================================
-- Table: stops
-- ============================================
CREATE TABLE IF NOT EXISTS stops (
    id VARCHAR(36) PRIMARY KEY,
    day VARCHAR(20) NOT NULL,
    delivery_date DATE NULL,
    client_id VARCHAR(36) NULL,
    order_id VARCHAR(36) NULL,
    "order" INTEGER NULL,
    name VARCHAR(255) NOT NULL,
    address VARCHAR(500) NOT NULL,
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
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_stops_day ON stops(day);
CREATE INDEX IF NOT EXISTS idx_stops_delivery_date ON stops(delivery_date);
CREATE INDEX IF NOT EXISTS idx_stops_client_id ON stops(client_id);
CREATE INDEX IF NOT EXISTS idx_stops_order_id ON stops(order_id);
CREATE INDEX IF NOT EXISTS idx_stops_completed ON stops(completed);
CREATE UNIQUE INDEX IF NOT EXISTS idx_stops_client_delivery_date ON stops(client_id, delivery_date) WHERE delivery_date IS NOT NULL;

CREATE TRIGGER update_stops_updated_at BEFORE UPDATE ON stops
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Table: upcoming_orders
-- ============================================
CREATE TABLE IF NOT EXISTS upcoming_orders (
    id VARCHAR(36) PRIMARY KEY,
    client_id VARCHAR(36) NOT NULL,
    service_type VARCHAR(50) NOT NULL,
    case_id VARCHAR(255) NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'scheduled',
    scheduled_delivery_date DATE NULL,
    take_effect_date DATE NULL,
    delivery_day VARCHAR(50) NULL,
    delivery_distribution JSONB NULL,
    total_value NUMERIC(10,2) NULL,
    total_items INTEGER NULL,
    notes TEXT NULL,
    order_number INTEGER NULL,
    processed_order_id VARCHAR(36) NULL,
    processed_at TIMESTAMP NULL,
    last_updated TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_by VARCHAR(255) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_upcoming_orders_order_number ON upcoming_orders(order_number);
CREATE INDEX IF NOT EXISTS idx_upcoming_orders_processed_order_id ON upcoming_orders(processed_order_id);
CREATE INDEX IF NOT EXISTS idx_upcoming_orders_client_id ON upcoming_orders(client_id);
CREATE INDEX IF NOT EXISTS idx_upcoming_orders_status ON upcoming_orders(status);

CREATE TRIGGER update_upcoming_orders_last_updated BEFORE UPDATE ON upcoming_orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Table: upcoming_order_box_selections
-- ============================================
CREATE TABLE IF NOT EXISTS upcoming_order_box_selections (
    id VARCHAR(36) PRIMARY KEY,
    upcoming_order_id VARCHAR(36) NOT NULL,
    vendor_id VARCHAR(36) NOT NULL,
    box_type_id VARCHAR(36) NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    items JSONB NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_upcoming_order_box_selections_upcoming_order_id ON upcoming_order_box_selections(upcoming_order_id);
CREATE INDEX IF NOT EXISTS idx_upcoming_order_box_selections_vendor_id ON upcoming_order_box_selections(vendor_id);
CREATE INDEX IF NOT EXISTS idx_upcoming_order_box_selections_box_type_id ON upcoming_order_box_selections(box_type_id);

-- ============================================
-- Table: upcoming_order_items
-- ============================================
CREATE TABLE IF NOT EXISTS upcoming_order_items (
    id VARCHAR(36) PRIMARY KEY,
    upcoming_order_id VARCHAR(36) NOT NULL,
    vendor_selection_id VARCHAR(36) NULL,
    upcoming_vendor_selection_id VARCHAR(36) NULL,
    menu_item_id VARCHAR(36) NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_upcoming_order_items_upcoming_order_id ON upcoming_order_items(upcoming_order_id);
CREATE INDEX IF NOT EXISTS idx_upcoming_order_items_vendor_selection_id ON upcoming_order_items(vendor_selection_id);
CREATE INDEX IF NOT EXISTS idx_upcoming_order_items_upcoming_vendor_selection_id ON upcoming_order_items(upcoming_vendor_selection_id);
CREATE INDEX IF NOT EXISTS idx_upcoming_order_items_menu_item_id ON upcoming_order_items(menu_item_id);

-- ============================================
-- Table: upcoming_order_vendor_selections
-- ============================================
CREATE TABLE IF NOT EXISTS upcoming_order_vendor_selections (
    id VARCHAR(36) PRIMARY KEY,
    upcoming_order_id VARCHAR(36) NOT NULL,
    vendor_id VARCHAR(36) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_upcoming_order_vendor_selections_upcoming_order_id ON upcoming_order_vendor_selections(upcoming_order_id);
CREATE INDEX IF NOT EXISTS idx_upcoming_order_vendor_selections_vendor_id ON upcoming_order_vendor_selections(vendor_id);

-- ============================================
-- Table: vendors
-- ============================================
CREATE TABLE IF NOT EXISTS vendors (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255) NULL,
    password VARCHAR(255) NULL,
    service_type VARCHAR(255) NULL,
    delivery_days JSONB NULL,
    delivery_frequency VARCHAR(50) DEFAULT 'Once',
    is_active BOOLEAN DEFAULT TRUE,
    minimum_meals INTEGER DEFAULT 0,
    cutoff_hours INTEGER DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER update_vendors_updated_at BEFORE UPDATE ON vendors
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Foreign Key Constraints
-- ============================================
-- Note: Add foreign keys after all tables are created
-- Uncomment and run these after verifying all tables exist

-- ALTER TABLE billing_records
--     ADD CONSTRAINT fk_billing_records_client_id
--     FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
--     ADD CONSTRAINT fk_billing_records_order_id
--     FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL;

-- ALTER TABLE box_quotas
--     ADD CONSTRAINT fk_box_quotas_box_type_id
--     FOREIGN KEY (box_type_id) REFERENCES box_types(id) ON DELETE CASCADE,
--     ADD CONSTRAINT fk_box_quotas_category_id
--     FOREIGN KEY (category_id) REFERENCES item_categories(id) ON DELETE CASCADE;

-- ALTER TABLE box_types
--     ADD CONSTRAINT fk_box_types_vendor_id
--     FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE SET NULL;

-- ALTER TABLE clients
--     ADD CONSTRAINT fk_clients_navigator_id
--     FOREIGN KEY (navigator_id) REFERENCES navigators(id) ON DELETE SET NULL,
--     ADD CONSTRAINT fk_clients_status_id
--     FOREIGN KEY (status_id) REFERENCES client_statuses(id) ON DELETE SET NULL,
--     ADD CONSTRAINT fk_clients_parent_client_id
--     FOREIGN KEY (parent_client_id) REFERENCES clients(id) ON DELETE SET NULL;

-- ALTER TABLE delivery_history
--     ADD CONSTRAINT fk_delivery_history_client_id
--     FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
--     ADD CONSTRAINT fk_delivery_history_vendor_id
--     FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE;

-- ALTER TABLE equipment
--     ADD CONSTRAINT fk_equipment_vendor_id
--     FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE SET NULL;

-- ALTER TABLE filled_forms
--     ADD CONSTRAINT fk_filled_forms_form_id
--     FOREIGN KEY (form_id) REFERENCES forms(id) ON DELETE CASCADE;

-- ALTER TABLE form_answers
--     ADD CONSTRAINT fk_form_answers_filled_form_id
--     FOREIGN KEY (filled_form_id) REFERENCES filled_forms(id) ON DELETE CASCADE,
--     ADD CONSTRAINT fk_form_answers_question_id
--     FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE;

-- ALTER TABLE form_submissions
--     ADD CONSTRAINT fk_form_submissions_form_id
--     FOREIGN KEY (form_id) REFERENCES forms(id) ON DELETE CASCADE,
--     ADD CONSTRAINT fk_form_submissions_client_id
--     FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;

-- ALTER TABLE menu_items
--     ADD CONSTRAINT fk_menu_items_vendor_id
--     FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE SET NULL,
--     ADD CONSTRAINT fk_menu_items_category_id
--     FOREIGN KEY (category_id) REFERENCES item_categories(id) ON DELETE SET NULL;

-- ALTER TABLE navigator_logs
--     ADD CONSTRAINT fk_navigator_logs_navigator_id
--     FOREIGN KEY (navigator_id) REFERENCES navigators(id) ON DELETE CASCADE,
--     ADD CONSTRAINT fk_navigator_logs_client_id
--     FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;

-- ALTER TABLE orders
--     ADD CONSTRAINT fk_orders_client_id
--     FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;

-- ALTER TABLE order_box_selections
--     ADD CONSTRAINT fk_order_box_selections_order_id
--     FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
--     ADD CONSTRAINT fk_order_box_selections_vendor_id
--     FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE,
--     ADD CONSTRAINT fk_order_box_selections_box_type_id
--     FOREIGN KEY (box_type_id) REFERENCES box_types(id) ON DELETE CASCADE;

-- ALTER TABLE order_history
--     ADD CONSTRAINT fk_order_history_client_id
--     FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;

-- ALTER TABLE order_items
--     ADD CONSTRAINT fk_order_items_vendor_selection_id
--     FOREIGN KEY (vendor_selection_id) REFERENCES order_vendor_selections(id) ON DELETE CASCADE,
--     ADD CONSTRAINT fk_order_items_menu_item_id
--     FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE;

-- ALTER TABLE order_vendor_selections
--     ADD CONSTRAINT fk_order_vendor_selections_order_id
--     FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
--     ADD CONSTRAINT fk_order_vendor_selections_vendor_id
--     FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE;

-- ALTER TABLE questions
--     ADD CONSTRAINT fk_questions_form_id
--     FOREIGN KEY (form_id) REFERENCES forms(id) ON DELETE CASCADE;

-- ALTER TABLE schedules
--     ADD CONSTRAINT fk_schedules_client_id
--     FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;

-- ALTER TABLE signatures
--     ADD CONSTRAINT fk_signatures_order_id
--     FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL,
--     ADD CONSTRAINT fk_signatures_client_id
--     FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE;

-- ALTER TABLE stops
--     ADD CONSTRAINT fk_stops_client_id
--     FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL;

-- ALTER TABLE upcoming_orders
--     ADD CONSTRAINT fk_upcoming_orders_client_id
--     FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
--     ADD CONSTRAINT fk_upcoming_orders_processed_order_id
--     FOREIGN KEY (processed_order_id) REFERENCES orders(id) ON DELETE SET NULL;

-- ALTER TABLE upcoming_order_box_selections
--     ADD CONSTRAINT fk_upcoming_order_box_selections_upcoming_order_id
--     FOREIGN KEY (upcoming_order_id) REFERENCES upcoming_orders(id) ON DELETE CASCADE,
--     ADD CONSTRAINT fk_upcoming_order_box_selections_vendor_id
--     FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE,
--     ADD CONSTRAINT fk_upcoming_order_box_selections_box_type_id
--     FOREIGN KEY (box_type_id) REFERENCES box_types(id) ON DELETE CASCADE;

-- ALTER TABLE upcoming_order_items
--     ADD CONSTRAINT fk_upcoming_order_items_upcoming_order_id
--     FOREIGN KEY (upcoming_order_id) REFERENCES upcoming_orders(id) ON DELETE CASCADE,
--     ADD CONSTRAINT fk_upcoming_order_items_vendor_selection_id
--     FOREIGN KEY (vendor_selection_id) REFERENCES order_vendor_selections(id) ON DELETE CASCADE,
--     ADD CONSTRAINT fk_upcoming_order_items_upcoming_vendor_selection_id
--     FOREIGN KEY (upcoming_vendor_selection_id) REFERENCES upcoming_order_vendor_selections(id) ON DELETE CASCADE,
--     ADD CONSTRAINT fk_upcoming_order_items_menu_item_id
--     FOREIGN KEY (menu_item_id) REFERENCES menu_items(id) ON DELETE CASCADE;

-- ALTER TABLE upcoming_order_vendor_selections
--     ADD CONSTRAINT fk_upcoming_order_vendor_selections_upcoming_order_id
--     FOREIGN KEY (upcoming_order_id) REFERENCES upcoming_orders(id) ON DELETE CASCADE,
--     ADD CONSTRAINT fk_upcoming_order_vendor_selections_vendor_id
--     FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE;

-- ============================================
-- Row Level Security (RLS) Policies
-- ============================================
-- Enable RLS on tables that need it (uncomment as needed)
-- ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE form_submissions ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE signatures ENABLE ROW LEVEL SECURITY;

-- Example RLS policy (adjust based on your auth requirements):
-- CREATE POLICY "Users can view their own data" ON clients
--     FOR SELECT USING (auth.uid()::text = id);
