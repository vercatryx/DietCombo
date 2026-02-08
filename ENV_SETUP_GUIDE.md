# Environment Variables Setup Guide

## Problem
If you're seeing "no clients found" or database connection issues, it's likely because your Supabase environment variables are not set correctly.

## Required Environment Variables

Create a `.env.local` file in your project root with these variables:

```env
# Supabase Configuration (REQUIRED)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key_here
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key_here

# Admin Account (Optional but recommended)
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
```

## How to Get Your Supabase Credentials

1. Go to your Supabase project: https://app.supabase.com
2. Select your project
3. Go to **Settings** → **API**
4. You'll find:
   - **Project URL** → Use for `NEXT_PUBLIC_SUPABASE_URL`
   - **anon/public key** → Use for `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role key** → Use for `SUPABASE_SERVICE_ROLE_KEY` (⚠️ Keep this secret!)

## Why SUPABASE_SERVICE_ROLE_KEY is Important

The service role key bypasses Row Level Security (RLS), which is essential for:
- Server-side queries to work properly
- Admin operations to access all data
- Background jobs and API routes

**Without it**, queries may return empty results even if data exists in the database.

## Verification

After setting up your `.env.local` file:

1. **Restart your Next.js dev server** (environment variables are loaded at startup)
   ```bash
   # Stop the server (Ctrl+C) and restart:
   npm run dev
   ```

2. **Check the console output** - You should see:
   ```
   [supabase] Environment check:
     NEXT_PUBLIC_SUPABASE_URL: ✅ Set
     NEXT_PUBLIC_SUPABASE_ANON_KEY: ✅ Set
     SUPABASE_SERVICE_ROLE_KEY: ✅ Set
   ```

3. **If you see warnings**, the variables aren't loaded correctly

## Common Issues

### Issue: "Missing Supabase environment variables" error on startup
**Solution**: Make sure `.env.local` exists in the project root (same directory as `package.json`)

### Issue: Variables show as missing even though they're in `.env.local`
**Solution**: 
- Restart your dev server (variables are only loaded at startup)
- Check for typos in variable names
- Make sure there are no spaces around the `=` sign
- Don't use quotes around values (unless the value itself contains spaces)

### Issue: "Queries may fail if RLS is enabled" warning
**Solution**: Add `SUPABASE_SERVICE_ROLE_KEY` to your `.env.local` file

### Issue: Can log in but no data shows up
**Solution**: This is likely because `SUPABASE_SERVICE_ROLE_KEY` is missing. RLS is blocking queries.

## File Location

Your `.env.local` file should be in:
```
/Users/shloimieheimowitz/WebstormProjects/DietCombo/.env.local
```

## Security Notes

⚠️ **Never commit `.env.local` to git!** It should already be in `.gitignore`.

The service role key has full database access - keep it secret!

## Quick Test

Run this to check if your environment is set up:
```bash
node check-env.js
```

This will show you which variables are set and which are missing.
