# GoDaddy Email SMTP Setup

All outgoing email uses a **single sender**. Credentials are read from your env file (e.g. `.env` or `.env.local`).

## Environment Variables

Add these to your `.env` or `.env.local` file:

```env
SMTP_HOST=smtpout.secureserver.net
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=your-email@yourdomain.com
SMTP_PASS=your-email-password
```

Optional (sender display name; defaults to "Diet Fantasy"):

```env
SMTP_FROM_NAME=Diet Fantasy
```

**Replace:**
- `your-email@yourdomain.com` with your actual GoDaddy email address
- `your-email-password` with your actual email password

## Alternative Configuration (TLS)

If port 465 doesn't work, you can try port 587 with TLS:

```env
SMTP_HOST=smtpout.secureserver.net
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@yourdomain.com
SMTP_PASS=your-email-password
```

## Where to Find Your GoDaddy Email Settings

### Option 1: GoDaddy Email Dashboard
1. Log in to your **GoDaddy account**
2. Go to **My Products** → **Email**
3. Click on your email account
4. Look for **Email Settings** or **Email Client Setup**
5. You'll see your email address (use this for `SMTP_USER`)
6. Your password is the one you set when creating the email account (use this for `SMTP_PASS`)

### Option 2: GoDaddy Help Center
1. Go to: https://www.godaddy.com/help
2. Search for "SMTP settings" or "email client setup"
3. Or go directly to: https://www.godaddy.com/help/set-up-outlook-2016-for-email-680

### Option 3: Workspace Email (if using GoDaddy Workspace)
1. Log in to **GoDaddy Workspace Email** (email.godaddy.com)
2. Go to **Settings** → **Email Client Setup**
3. You'll find SMTP settings there

## Important Notes

- **SMTP Server**: `smtpout.secureserver.net` (for outgoing mail)
- **Port 465**: Uses SSL encryption (recommended)
- **Port 587**: Uses TLS encryption (alternative)
- **Authentication**: Your full email address and password are required
- **Security**: Make sure `.env.local` is in your `.gitignore` file (it should be by default)

## Testing

After adding the settings, restart your Next.js development server:
```bash
npm run dev
```

The email functionality will be used to send form submissions to nutritionists.












