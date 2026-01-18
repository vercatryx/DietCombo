-- Fix Supabase Error 42501: permission denied for schema public
-- Run this script in your Supabase SQL Editor to grant necessary permissions
-- This fixes the issue where the app can't read data from Supabase even though data exists

-- Ensure roles can use the public schema
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Give full access on existing tables, routines (functions), sequences in public
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

-- Set default privileges going forward (for new objects created in public schema)
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

-- Verify the grants (optional - run this to check)
SELECT 
    grantee, 
    table_schema, 
    privilege_type 
FROM information_schema.role_table_grants 
WHERE table_schema = 'public' 
    AND grantee IN ('anon', 'authenticated', 'service_role')
ORDER BY grantee, privilege_type;
