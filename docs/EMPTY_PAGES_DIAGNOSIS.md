# Diagnosis: Empty Pages After MySQL to Supabase Conversion

## Problem Summary

After converting from MySQL to Supabase, three areas of the app are showing empty data:
1. **Drivers page** (`/drivers`) - No drivers/routes displayed
2. **Routes page** (`/routes`) - No routes displayed  
3. **Vendor combobox in Client Profile** - Empty vendor dropdown

## Root Cause: Row Level Security (RLS) Blocking Queries

The issue is caused by **Row Level Security (RLS)** being enabled on Supabase tables without proper policies, which blocks queries when using the anonymous (anon) key.

### How It Works

1. **Supabase Client Configuration** (`lib/supabase.ts`):
   - Prioritizes `SUPABASE_SERVICE_ROLE_KEY` if available
   - Falls back to `NEXT_PUBLIC_SUPABASE_ANON_KEY` if service role key is missing
   - Service role key **bypasses RLS**, anon key **respects RLS**

2. **The Problem**:
   - RLS is enabled on tables (`drivers`, `routes`, `stops`, `vendors`)
   - No RLS policies are configured (or policies are too restrictive)
   - App is using anon key (service role key not set)
   - Queries are blocked by RLS → return empty arrays
   - UI shows empty pages/comboboxes

## Affected Components

### 1. Drivers Page (`app/drivers/page.tsx`)
- **Data Source**: `/api/mobile/routes`
- **Tables Queried**: `drivers`, `routes`, `stops`
- **Function**: `fetchDrivers()` → `fetchJSON("/api/mobile/routes")`
- **API Route**: `app/api/mobile/routes/route.ts`
- **Supabase Query**: Uses `supabase` from `lib/supabase.ts`

### 2. Routes Page (`app/routes/page.tsx`)
- **Data Source**: Same as drivers page (`/api/mobile/routes`)
- **Tables Queried**: `drivers`, `routes`, `stops`
- **Function**: `fetchDrivers()` from `lib/api.js`
- **Same API Route**: `app/api/mobile/routes/route.ts`

### 3. Vendor Combobox (`components/clients/ClientProfile.tsx`)
- **Data Source**: `getVendors()` function
- **Table Queried**: `vendors`
- **Function**: `getVendors()` in `lib/actions.ts` (line 134)
- **Supabase Query**: 
  ```typescript
  const { data, error } = await supabase.from('vendors').select('*');
  ```

## Evidence in Code

### API Route Checks for Service Key
```typescript
// app/api/mobile/routes/route.ts (line 22-25)
const isUsingServiceKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!isUsingServiceKey) {
    console.warn("[mobile/routes] ⚠️  Not using service role key - RLS may block queries");
}
```

### getVendors() Has RLS Error Handling
```typescript
// lib/actions.ts (line 134-217)
export async function getVendors() {
    const isUsingServiceKey = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!isUsingServiceKey) {
        console.warn('[getVendors] ⚠️  Not using service role key - RLS may block queries');
    }
    
    // If RLS error, provide helpful message
    if (error.code === 'PGRST301' || error.message?.includes('permission denied')) {
        console.error('[getVendors] ❌ RLS is blocking the query. Ensure SUPABASE_SERVICE_ROLE_KEY is set.');
    }
    return [];
}
```

### Supabase Client Configuration
```typescript
// lib/supabase.ts (line 8-22)
const supabaseKey = supabaseServiceKey || supabaseAnonKey;

if (!supabaseServiceKey && process.env.NODE_ENV !== 'production') {
    console.warn('⚠️  SUPABASE_SERVICE_ROLE_KEY not set. Using anon key. Queries may fail if RLS is enabled.');
}
```

## Solutions

You have **three options** to fix this issue:

### Option 1: Set Service Role Key (RECOMMENDED)

**Best for**: Production apps where you want to keep RLS enabled but bypass it for server-side operations.

**Steps**:
1. Go to your Supabase project dashboard
2. Navigate to **Settings** → **API**
3. Copy the **service_role** key (⚠️ keep this secret!)
4. Add to your `.env.local` file:
   ```env
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
   ```
5. Restart your development server

**Pros**:
- ✅ Keeps RLS enabled (good security practice)
- ✅ Server-side operations bypass RLS (needed for admin operations)
- ✅ Client-side code can still use anon key with RLS
- ✅ Recommended approach for production

**Cons**:
- ⚠️ Service role key must be kept secret (never expose in client code)

### Option 2: Disable RLS on Tables

**Best for**: Internal/admin apps where RLS is not needed.

**Steps**:
1. Open Supabase SQL Editor
2. Run the script: `sql/disable-rls.sql`
3. This disables RLS on all relevant tables

**Pros**:
- ✅ Simple solution
- ✅ Works immediately
- ✅ No environment variables needed

**Cons**:
- ⚠️ Removes row-level security (less secure)
- ⚠️ Not recommended for production if you need user-specific access control

### Option 3: Add Permissive RLS Policies

**Best for**: When you want to keep RLS enabled but allow all operations.

**Steps**:
1. Open Supabase SQL Editor
2. Run the script: `sql/enable-permissive-rls.sql`
3. This creates permissive policies allowing all operations

**Pros**:
- ✅ Keeps RLS structure in place
- ✅ Can refine policies later
- ✅ Works with anon key

**Cons**:
- ⚠️ Policies allow all operations (essentially disabling RLS but keeping it enabled)
- ⚠️ More complex than Option 2

## Recommended Solution

**For your use case (internal admin app)**: I recommend **Option 1 (Set Service Role Key)** because:
- You already have error handling and logging in place for it
- It's the most secure approach for server-side operations
- It's the recommended pattern by Supabase
- The codebase is already designed to use it

## Verification Steps

After applying the fix:

1. **Check environment variables**:
   ```bash
   # Should show the service role key (masked)
   echo $SUPABASE_SERVICE_ROLE_KEY | cut -c1-10
   ```

2. **Check server logs**:
   - Look for: `✅ Fetched X vendors from database`
   - Should NOT see: `⚠️  Not using service role key - RLS may block queries`
   - Should NOT see: `❌ RLS is blocking the query`

3. **Test the pages**:
   - **Drivers page** (`/drivers`): Should show routes/drivers
   - **Routes page** (`/routes`): Should show routes list
   - **Client Profile**: Vendor dropdown should be populated

4. **Check browser console**:
   - Should see successful API calls
   - Should see data being returned (check Network tab)

## Files Involved

- `lib/supabase.ts` - Supabase client configuration
- `lib/actions.ts` - `getVendors()` function (line 134)
- `app/api/mobile/routes/route.ts` - Drivers/routes API endpoint
- `sql/disable-rls.sql` - Script to disable RLS (Option 2)
- `sql/enable-permissive-rls.sql` - Script to add permissive policies (Option 3)

## Additional Notes

- The code already has extensive logging to help diagnose RLS issues
- All three affected areas use the same Supabase client configuration
- The error handling returns empty arrays on error (explains why pages are empty, not showing errors)
- This is a common issue when migrating from MySQL (no RLS) to Supabase (RLS enabled by default)
