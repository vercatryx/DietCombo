# Supabase Data Fetch Issue - Fix Guide

## Problem Identified

Some functionalities in the app weren't able to fetch data from Supabase tables even though data exists. This was caused by **Row Level Security (RLS)** blocking queries when using the anon key.

## Root Causes

1. **RLS Enabled Without Policies**: Row Level Security may be enabled on tables in Supabase, but without proper policies, queries using the anon key are blocked.

2. **Missing Service Role Key**: The app was falling back to the anon key when `SUPABASE_SERVICE_ROLE_KEY` wasn't set. The service role key bypasses RLS.

3. **Silent Error Handling**: Many queries were returning empty arrays on error without logging, making it hard to diagnose the issue.

## Solutions Implemented

### 1. Improved Supabase Client Configuration

**File**: `lib/supabase.ts`

- Now prioritizes `SUPABASE_SERVICE_ROLE_KEY` over anon key
- Added warning when service role key is missing
- Better error messages for missing environment variables

### 2. Enhanced Error Logging

**File**: `lib/actions.ts`

- Added `logQueryError()` helper function
- Improved `handleError()` to detect RLS issues
- Better error messages that identify RLS problems

### 3. SQL Scripts to Fix RLS

Two SQL scripts were created in the `sql/` directory:

#### Option A: Disable RLS (Recommended for internal apps)
**File**: `sql/disable-rls.sql`
- Disables RLS on all tables
- Use this if you don't need row-level security
- Run in Supabase SQL Editor

#### Option B: Enable Permissive Policies (For apps that need RLS)
**File**: `sql/enable-permissive-rls.sql`
- Keeps RLS enabled but adds permissive policies
- Allows all operations (SELECT, INSERT, UPDATE, DELETE) for all users
- Use this if you want to keep RLS structure but allow access

### 4. Diagnostic Script

**File**: `scripts/diagnose-supabase.ts`

Run this script to check:
- Environment variable configuration
- Which queries work with anon key vs service role key
- RLS status on tables
- Specific error messages

```bash
npx tsx scripts/diagnose-supabase.ts
```

## How to Fix

### Step 1: Set Service Role Key (Recommended)

1. Go to your Supabase project dashboard
2. Navigate to **Settings** → **API**
3. Copy the **service_role** key (keep this secret!)
4. Add it to your `.env.local` file:

```env
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
```

**Note**: The service role key bypasses RLS, so it's perfect for server-side operations.

### Step 2: Fix RLS Configuration

Choose one of these options:

#### Option A: Disable RLS (Easiest)

1. Open Supabase SQL Editor
2. Copy and paste contents of `sql/disable-rls.sql`
3. Run the script
4. This disables RLS on all tables

#### Option B: Add Permissive Policies

1. Open Supabase SQL Editor
2. Copy and paste contents of `sql/enable-permissive-rls.sql`
3. Run the script
4. This keeps RLS enabled but allows all operations

### Step 3: Verify the Fix

1. Run the diagnostic script:
   ```bash
   npx tsx scripts/diagnose-supabase.ts
   ```

2. Check your app - data should now be fetching correctly

3. Check server logs for any remaining errors

## Environment Variables Required

Make sure these are set in your `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=your-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key  # Recommended
```

## Testing

After applying the fix, test these common operations:

1. ✅ Fetch clients list
2. ✅ Fetch orders
3. ✅ Fetch vendors
4. ✅ Fetch menu items
5. ✅ Fetch upcoming orders
6. ✅ Create/update/delete operations

## Troubleshooting

### Still seeing empty results?

1. **Check environment variables**:
   ```bash
   # In your terminal
   echo $SUPABASE_SERVICE_ROLE_KEY
   ```

2. **Run diagnostic script**:
   ```bash
   npx tsx scripts/diagnose-supabase.ts
   ```

3. **Check Supabase logs**:
   - Go to Supabase Dashboard → Logs
   - Look for permission denied errors

4. **Verify RLS status**:
   - Run this in Supabase SQL Editor:
   ```sql
   SELECT tablename, rowsecurity 
   FROM pg_tables t
   JOIN pg_class c ON c.relname = t.tablename
   WHERE schemaname = 'public'
   AND tablename IN ('clients', 'orders', 'vendors');
   ```

### Error: "permission denied" or "PGRST301"

This confirms RLS is blocking queries. Follow Step 2 above to fix.

### Error: "Missing Supabase environment variables"

Check your `.env.local` file has all required variables (see Environment Variables section above).

## Security Notes

⚠️ **Important**: 
- The service role key has full access to your database and bypasses RLS
- Never expose it in client-side code
- Only use it in server-side code (API routes, server actions)
- The anon key is safe for client-side use (if RLS policies allow)

## Files Modified

- `lib/supabase.ts` - Improved client configuration
- `lib/actions.ts` - Enhanced error logging
- `sql/disable-rls.sql` - Script to disable RLS
- `sql/enable-permissive-rls.sql` - Script to add permissive policies
- `scripts/diagnose-supabase.ts` - Diagnostic tool

## Next Steps

After fixing, consider:
1. Reviewing which tables actually need RLS
2. Creating more granular RLS policies if needed
3. Setting up proper authentication if you want user-specific access
4. Monitoring logs for any remaining issues
