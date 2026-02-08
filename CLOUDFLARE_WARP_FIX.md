# Cloudflare WARP Zero Trust Fix

## Problem

Cloudflare WARP is intercepting DNS and network traffic, causing Supabase connections to fail with `ENOTFOUND` errors.

## Solution Options

### Option 1: Exclude Supabase from WARP (Recommended)

Configure WARP to bypass Supabase domains:

1. **Open Cloudflare WARP settings**
   - Click the WARP icon in your menu bar
   - Go to **Preferences** or **Settings**

2. **Add Split Tunneling Rules**
   - Look for **Split Tunneling** or **Local Network Exclusion**
   - Add these domains to bypass:
     - `*.supabase.co`
     - `supabase.co`
     - Or add your specific project: `uqgbekvxvqntiptgvccw.supabase.co`

3. **Alternative: Use Local Network Mode**
   - Enable "Local Network" mode in WARP
   - This allows local development traffic to bypass WARP

### Option 2: Disable WARP for Development

Temporarily disable WARP when developing:

1. **Pause WARP**
   - Click WARP icon → **Pause for 1 hour** (or your preferred duration)
   - Or completely disconnect WARP

2. **Restart your dev server**
   ```bash
   npm run dev
   ```

### Option 3: Configure WARP Split Tunneling via Command Line

If you have WARP CLI access:

```bash
# List current split tunnel rules
warp-cli get-excluded-routes

# Add Supabase to split tunnel (bypass WARP)
warp-cli add-excluded-route *.supabase.co
```

### Option 4: Use Direct DNS (Bypass WARP DNS)

Configure your system to use direct DNS for Supabase:

1. **macOS Network Settings**
   - System Preferences → Network
   - Advanced → DNS
   - Add `1.1.1.1` or `8.8.8.8` as primary DNS
   - This may help bypass WARP's DNS

### Option 5: Configure Next.js to Use Direct Connection

We can configure the Supabase client to use direct connections, but WARP may still intercept. The best solution is to exclude Supabase from WARP.

## Quick Test

After configuring WARP:

1. **Test DNS resolution:**
   ```bash
   nslookup uqgbekvxvqntiptgvccw.supabase.co
   ```
   Should return IP addresses, not fail.

2. **Test connection:**
   ```bash
   curl -I https://uqgbekvxvqntiptgvccw.supabase.co
   ```
   Should return HTTP headers.

3. **Restart your dev server:**
   ```bash
   npm run dev
   ```

## Recommended Configuration

For development, I recommend:

1. **Enable Split Tunneling** in WARP
2. **Add `*.supabase.co` to bypass list**
3. **Keep WARP enabled** for other traffic (security benefits)
4. **Test connection** after configuration

## Verification

After configuring, check your server logs. You should see:
- ✅ Successful Supabase connections
- ✅ No more `ENOTFOUND` errors
- ✅ Data loading correctly

## Alternative: Use WARP Gateway Exclusion

If your WARP setup uses a gateway:

1. Check WARP settings for **Gateway Exclusion** or **Local Network**
2. Add your local network range (e.g., `192.168.0.0/16`, `10.0.0.0/8`)
3. This allows local development to bypass WARP

## Notes

- WARP is great for security, but can interfere with local development
- Split tunneling is the best solution - keeps WARP enabled but bypasses specific domains
- You may need to restart your computer after changing WARP settings
- Some WARP configurations require admin privileges to change
