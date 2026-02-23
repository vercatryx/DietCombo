# DNS Resolution Error Fix

## Problem

You're seeing this error repeatedly:
```
Error: getaddrinfo ENOTFOUND uqgbekvxvqntiptgvccw.supabase.co (ENOTFOUND)
```

This means your system **cannot resolve the DNS hostname** for your Supabase project.

## Root Cause

The hostname `uqgbekvxvqntiptgvccw.supabase.co` cannot be found. This typically means:

1. **Supabase project is paused** - Free tier projects pause after inactivity
2. **Project was deleted** - The project no longer exists
3. **Incorrect project URL** - The project reference ID is wrong
4. **Network/DNS issue** - Temporary DNS resolution problem

## Diagnosis

From your logs, I can see:
- ✅ Environment variables are set correctly
- ✅ Supabase URL is configured: `https://uqgbekvxvqntiptgvccw.supabase.co`
- ❌ DNS cannot resolve the hostname

## Solutions

### Solution 1: Check if Project is Paused (Most Likely)

1. Go to https://app.supabase.com
2. Log in to your account
3. Check if your project `uqgbekvxvqntiptgvccw` is listed
4. If it shows as **"Paused"**:
   - Click on the project
   - Click **"Restore"** or **"Resume"** to reactivate it
   - Wait a few minutes for DNS to propagate

### Solution 2: Verify Project URL

1. Go to https://app.supabase.com
2. Select your project
3. Go to **Settings** → **API**
4. Copy the **Project URL** (should look like `https://xxxxx.supabase.co`)
5. Compare it with what's in your `.env.local`:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
   ```
6. If they don't match, update your `.env.local` file
7. Restart your dev server

### Solution 3: Check Project Status

1. Go to https://app.supabase.com
2. Check your project dashboard
3. Look for any warnings or status messages
4. If the project is missing, it may have been deleted

### Solution 4: Test DNS Resolution Manually

Run this in your terminal to test DNS:
```bash
nslookup uqgbekvxvqntiptgvccw.supabase.co
# or
dig uqgbekvxvqntiptgvccw.supabase.co
```

If these fail, the hostname doesn't exist (project paused/deleted).

### Solution 5: Create a New Project (If Old One is Gone)

If the project was deleted or you can't restore it:

1. Create a new Supabase project
2. Get the new project URL from Settings → API
3. Update your `.env.local`:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://NEW_PROJECT_ID.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=new_anon_key
   SUPABASE_SERVICE_ROLE_KEY=new_service_role_key
   ```
4. You'll need to migrate your data or start fresh

## Quick Check

Run this command to see if the hostname resolves:
```bash
ping uqgbekvxvqntiptgvccw.supabase.co
```

If you get "unknown host" or "cannot resolve", the project is paused/deleted.

## Most Common Issue: Paused Free Tier Project

Supabase free tier projects automatically pause after 7 days of inactivity. To restore:

1. Log into https://app.supabase.com
2. Find your paused project
3. Click "Restore" 
4. Wait 2-3 minutes for DNS to update
5. Restart your Next.js server

## After Fixing

Once the project is restored or URL is corrected:

1. **Restart your Next.js dev server** (environment variables are cached)
2. Check the console - you should see successful connections
3. The `ENOTFOUND` errors should stop

## Verification

After fixing, you should see in your logs:
- ✅ Successful database queries
- ✅ No more `ENOTFOUND` errors
- ✅ Data loading correctly

If errors persist, check:
- Project is active (not paused)
- URL is correct
- API keys are correct
- Network connectivity
