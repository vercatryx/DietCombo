# Environment-Based Admin Account Setup

## Overview

The application supports an **always-available admin account** that is configured via environment variables. This admin account works even if the database is down or unreachable, making it perfect for emergency access.

## Setup

### Step 1: Add Environment Variables

Add these to your `.env` or `.env.local` file:

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
```

**Important:** 
- Change these to secure values in production!
- The username is case-sensitive
- The password is plain text (not hashed) - this is intentional for emergency access

### Step 2: Restart Your Server

After adding the environment variables, restart your Next.js development server:

```bash
npm run dev
```

## How It Works

1. **Login Flow**: When a user tries to log in, the system first checks if the username matches `ADMIN_USERNAME` and the password matches `ADMIN_PASSWORD`
2. **Identity Check**: When checking if an account exists (e.g., for passwordless login), the system recognizes the admin username as a valid admin account
3. **Priority**: The environment admin takes precedence over database admins - if both exist with the same username, the env admin is used

## Usage

### Standard Login

1. Go to `/login`
2. Enter your `ADMIN_USERNAME` as the username
3. Enter your `ADMIN_PASSWORD` as the password
4. Click "Sign In"

### Passwordless Login (if enabled)

1. Go to `/login`
2. Enter your `ADMIN_USERNAME` as the username
3. Click "Next"
4. The system will recognize it as an admin account (not a client), so it will proceed to password entry instead of OTP

## Security Notes

⚠️ **Important Security Considerations:**

1. **Never commit `.env` or `.env.local` to version control** - these files should be in `.gitignore`
2. **Use strong passwords in production** - the default `admin123` is only for development
3. **This account bypasses all database checks** - it's designed for emergency access when the database is unavailable
4. **The password is stored in plain text** - this is intentional for emergency scenarios, but means you should protect your `.env` file carefully

## Troubleshooting

### Admin account not working?

1. **Check environment variables are set:**
   ```bash
   # In your terminal, verify the variables are loaded
   echo $ADMIN_USERNAME
   echo $ADMIN_PASSWORD
   ```

2. **Restart your server** - environment variables are loaded at startup

3. **Check the username is exact match** - it's case-sensitive and must match exactly (including any spaces)

4. **Check server logs** - if there are errors, they'll be logged to the console

### Environment admin vs Database admin

- If you have both an env admin and a database admin with the same username, the **env admin takes precedence**
- To use the database admin instead, either:
  - Use a different username for the env admin
  - Remove the env admin variables
  - Or use the database admin's exact username (if different)

## Example Configuration

```env
# Development
ADMIN_USERNAME=admin
ADMIN_PASSWORD=dev_password_123

# Production (example - use strong passwords!)
ADMIN_USERNAME=emergency_admin
ADMIN_PASSWORD=SuperSecurePassword!2024#xyz
```

## Code Reference

The environment admin is implemented in:
- `lib/auth-actions.ts` - `login()` function (line ~146-153)
- `lib/auth-actions.ts` - `checkEmailIdentity()` function (line ~260-265)
- `lib/auth-actions.ts` - `verifyOtp()` function (line ~105-113)
