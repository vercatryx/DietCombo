CREATE TABLE IF NOT EXISTS client_box_orders (
  id VARCHAR(36) PRIMARY KEY DEFAULT uuid_generate_v4()::text,
  client_id VARCHAR(36) NOT NULL REFERENCES clients(id),
  case_id TEXT,
  box_type_id VARCHAR(36) REFERENCES box_types(id),
  vendor_id VARCHAR(36) REFERENCES vendors(id),
  quantity INTEGER DEFAULT 1,
  items JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
