-- Create clients table for Supabase/PostgreSQL
-- This table is required by the DietCombo application
-- Run this in Supabase SQL Editor

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create clients table
CREATE TABLE IF NOT EXISTS clients (
    id VARCHAR(36) PRIMARY KEY,
    full_name VARCHAR(255) NOT NULL,
    -- Additional name fields
    first_name VARCHAR(255) NULL,
    last_name VARCHAR(255) NULL,
    email VARCHAR(255) NULL,
    address TEXT NULL,
    -- Address components
    apt VARCHAR(50) NULL,
    city VARCHAR(100) NULL,
    state VARCHAR(2) NULL,
    zip VARCHAR(10) NULL,
    county VARCHAR(100) NULL,
    phone_number VARCHAR(255) NULL,
    secondary_phone_number VARCHAR(255) NULL,
    -- External identifiers
    client_id_external VARCHAR(100) NULL,
    case_id_external VARCHAR(100) NULL,
    -- Status flags
    medicaid BOOLEAN DEFAULT FALSE,
    paused BOOLEAN DEFAULT FALSE,
    complex BOOLEAN DEFAULT FALSE,
    bill BOOLEAN DEFAULT TRUE,
    delivery BOOLEAN DEFAULT TRUE,
    -- Dietary preferences
    dislikes TEXT NULL,
    -- Geocoding fields
    latitude DOUBLE PRECISION NULL,
    longitude DOUBLE PRECISION NULL,
    lat DOUBLE PRECISION NULL,
    lng DOUBLE PRECISION NULL,
    geocoded_at TIMESTAMP NULL,
    -- JSON data fields
    billings JSONB NULL,
    visits JSONB NULL,
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
    approved_meals_per_week INTEGER NULL,
    parent_client_id VARCHAR(36) NULL,
    dob DATE NULL,
    cin NUMERIC(10, 0) NULL,
    authorized_amount NUMERIC(10, 2) NULL,
    expiration_date DATE NULL,
    active_order JSONB NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_clients_client_id_external ON clients(client_id_external);
CREATE INDEX IF NOT EXISTS idx_clients_case_id_external ON clients(case_id_external);
CREATE INDEX IF NOT EXISTS idx_clients_sign_token ON clients(sign_token);
CREATE INDEX IF NOT EXISTS idx_clients_navigator_id ON clients(navigator_id);
CREATE INDEX IF NOT EXISTS idx_clients_status_id ON clients(status_id);
CREATE INDEX IF NOT EXISTS idx_clients_parent_client_id ON clients(parent_client_id);
CREATE INDEX IF NOT EXISTS idx_clients_service_type ON clients(service_type);

-- Add foreign key constraints (only if referenced tables exist)
-- Uncomment these if navigators and client_statuses tables exist:
-- ALTER TABLE clients ADD CONSTRAINT fk_clients_navigator 
--     FOREIGN KEY (navigator_id) REFERENCES navigators(id) ON DELETE SET NULL;
-- ALTER TABLE clients ADD CONSTRAINT fk_clients_status 
--     FOREIGN KEY (status_id) REFERENCES client_statuses(id) ON DELETE SET NULL;
-- ALTER TABLE clients ADD CONSTRAINT fk_clients_parent 
--     FOREIGN KEY (parent_client_id) REFERENCES clients(id) ON DELETE SET NULL;

-- Create trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_clients_updated_at BEFORE UPDATE ON clients
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
