# Supabase Connection Fix Guide

## Problem
The app can't read data from Supabase even though data exists in the database. You may see errors like:
- `Error 42501: permission denied for schema public`
- Empty results from queries
- Silent failures in data fetching

## Root Cause
The database roles (`anon`, `authenticated`, `service_role`) don't have the necessary GRANT permissions on the `public` schema. This is a database-level permission issue that needs to be fixed in Supabase.

## Solution

### Step 1: Apply the Prisma Migration

The fix has been applied via Prisma migration. To apply it to your database:

```bash
npx prisma migrate deploy
```

This will run the migration `20260119012743_fix_schema_permissions` which:
- Grants USAGE permission on the public schema to all roles
- Grants ALL privileges on existing tables, functions, and sequences
- Sets default privileges for future objects

**Alternative:** If you prefer to run SQL directly in Supabase:
1. Open your **Supabase Dashboard**
2. Navigate to **SQL Editor**
3. Open the file `sql/fix-schema-permissions.sql` from this project
4. Copy and paste the SQL commands into the SQL Editor
5. Click **Run** to execute the script

### Step 2: Verify the Fix

After running the SQL script, test the connection:

```bash
npx tsx scripts/diagnose-supabase.ts
```

You should see:
- ✅ Success messages for all table queries
- No more "permission denied" errors

### Step 3: Test Your App

Restart your Next.js development server and verify that:
- Data loads correctly from Supabase
- API routes return data instead of empty arrays
- No console errors related to Supabase queries

## What Was Fixed

1. **Database Permissions** (via Prisma Migration):
   - Created Prisma migration `20260119012743_fix_schema_permissions`
   - Grants necessary schema permissions to `anon`, `authenticated`, and `service_role` roles
   - Applied via `npx prisma migrate deploy`

2. **Supabase Client Configuration** (`lib/supabase.ts`):
   - Added explicit `schema: 'public'` configuration
   - Added proper client headers

3. **Error Handling**:
   - Added error checking to all Supabase queries in `lib/local-db.ts`
   - Added error handling to API routes (`app/api/users/route.ts`)
   - Improved error messages in `lib/actions.ts` to guide users to this fix

4. **Better Diagnostics**:
   - Updated `scripts/diagnose-supabase.ts` to provide clearer error messages
   - Added specific guidance for error 42501

## Why This Happens

This issue can occur when:
- Database permissions were reset or modified
- A migration removed default privileges
- The Supabase project was restored from a backup
- Custom database operations altered the default grants

## Prevention

The SQL script includes `ALTER DEFAULT PRIVILEGES` statements that ensure future objects created in the public schema will automatically have the correct permissions.

## Additional Resources

- [Supabase Troubleshooting Guide](https://supabase.com/docs/guides/troubleshooting/database-api-42501-errors)
- [Supabase Database Permissions](https://supabase.com/docs/guides/database/postgres/roles)
