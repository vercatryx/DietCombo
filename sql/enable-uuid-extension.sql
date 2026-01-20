-- Enable uuid-ossp extension for PostgreSQL
-- This is required for uuid_generate_v4() function
-- Run this before running Prisma migrations if you get uuid_generate_v4() errors

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Verify the extension is enabled
SELECT * FROM pg_extension WHERE extname = 'uuid-ossp';
