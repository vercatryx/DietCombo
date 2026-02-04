-- Double VARCHAR limits for clients, stops, signatures, drivers so backup import
-- and long values never hit length limits. Run in Supabase SQL Editor.
-- Safe to run: only increases column sizes.
-- (clients.address is TEXT in DB so not altered.)

-- ========== clients ==========
ALTER TABLE clients ALTER COLUMN full_name TYPE varchar(510);
ALTER TABLE clients ALTER COLUMN first_name TYPE varchar(510);
ALTER TABLE clients ALTER COLUMN last_name TYPE varchar(510);
ALTER TABLE clients ALTER COLUMN email TYPE varchar(510);
ALTER TABLE clients ALTER COLUMN apt TYPE varchar(100);
ALTER TABLE clients ALTER COLUMN city TYPE varchar(200);
ALTER TABLE clients ALTER COLUMN state TYPE varchar(4);
ALTER TABLE clients ALTER COLUMN zip TYPE varchar(20);
ALTER TABLE clients ALTER COLUMN county TYPE varchar(200);
ALTER TABLE clients ALTER COLUMN phone_number TYPE varchar(510);
ALTER TABLE clients ALTER COLUMN secondary_phone_number TYPE varchar(510);
ALTER TABLE clients ALTER COLUMN client_id_external TYPE varchar(200);
ALTER TABLE clients ALTER COLUMN case_id_external TYPE varchar(200);
ALTER TABLE clients ALTER COLUMN sign_token TYPE varchar(510);
ALTER TABLE clients ALTER COLUMN updated_by TYPE varchar(510);

-- ========== stops ==========
ALTER TABLE stops ALTER COLUMN day TYPE varchar(40);
ALTER TABLE stops ALTER COLUMN name TYPE varchar(510);
ALTER TABLE stops ALTER COLUMN address TYPE varchar(1000);
ALTER TABLE stops ALTER COLUMN apt TYPE varchar(100);
ALTER TABLE stops ALTER COLUMN city TYPE varchar(200);
ALTER TABLE stops ALTER COLUMN state TYPE varchar(4);
ALTER TABLE stops ALTER COLUMN zip TYPE varchar(20);
ALTER TABLE stops ALTER COLUMN phone TYPE varchar(40);
ALTER TABLE stops ALTER COLUMN proof_url TYPE varchar(1000);

-- ========== signatures ==========
ALTER TABLE signatures ALTER COLUMN ip TYPE varchar(90);
ALTER TABLE signatures ALTER COLUMN user_agent TYPE varchar(1000);

-- ========== drivers ==========
ALTER TABLE drivers ALTER COLUMN day TYPE varchar(40);
ALTER TABLE drivers ALTER COLUMN name TYPE varchar(510);
ALTER TABLE drivers ALTER COLUMN color TYPE varchar(14);
