# Quick Fix: Cloudflare WARP Blocking Supabase

## The Problem
Cloudflare WARP Zero Trust is intercepting DNS/network traffic and blocking Supabase connections.

## Fastest Solution

### Option 1: Pause WARP Temporarily (Easiest)
1. Click the **Cloudflare WARP icon** in your menu bar
2. Click **"Pause for 1 hour"** (or your preferred duration)
3. **Restart your dev server**: `npm run dev`
4. Test - connections should work now

### Option 2: Exclude Supabase from WARP (Best for Long-term)

1. **Open WARP Settings**
   - Click WARP icon → **Preferences** or **Settings**

2. **Find Split Tunneling**
   - Look for "Split Tunneling", "Local Network Exclusion", or "Bypass Rules"

3. **Add Supabase Domain**
   - Add: `*.supabase.co`
   - Or specifically: `uqgbekvxvqntiptgvccw.supabase.co`

4. **Save and Restart**
   - Save settings
   - Restart your dev server: `npm run dev`

## Verify It's Working

After configuring, check your server logs. You should see:
- ✅ No more `ENOTFOUND` errors
- ✅ Successful Supabase connections
- ✅ Data loading correctly

## If Still Not Working

1. **Completely disconnect WARP**
   - WARP icon → **Disconnect**
   - Test again

2. **Check WARP Gateway Settings**
   - If using WARP Gateway, disable it for local development
   - Or add local network exclusion

3. **Restart Computer**
   - Some WARP settings require a full restart

## Why This Happens

WARP routes all DNS and network traffic through Cloudflare's network. This can:
- Interfere with DNS resolution
- Block certain connections
- Cause timeouts for local development

Split tunneling allows you to keep WARP enabled for security while bypassing it for specific domains (like Supabase).
