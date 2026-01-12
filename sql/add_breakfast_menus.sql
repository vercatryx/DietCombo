-- Create breakfast_categories table
CREATE TABLE IF NOT EXISTS breakfast_categories (
    id VARCHAR(36) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    name TEXT NOT NULL,
    set_value NUMERIC(10,2), -- Optional quota requirement
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create breakfast_items table
CREATE TABLE IF NOT EXISTS breakfast_items (
    id VARCHAR(36) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
    category_id VARCHAR(36) REFERENCES breakfast_categories(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    quota_value NUMERIC(10,2) DEFAULT 1,
    price_each NUMERIC(10,2),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Add indexes
CREATE INDEX IF NOT EXISTS breakfast_items_category_id_idx ON breakfast_items(category_id);
