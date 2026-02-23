# Sample Credentials

## Option 1: Environment Variable Super Admin (Recommended for Quick Start)

Add these to your `.env` or `.env.local` file:

```env
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
```

**Login with:**
- Username: `admin`
- Password: `admin123`

## Option 2: Database Admin

### Using the Script

Run the provided script to create a database admin:

```bash
node scripts/create-admin.js <username> <password> <name>
```

**Example:**
```bash
node scripts/create-admin.js admin admin123 "Admin User"
```

This will create an admin with:
- Username: `admin`
- Password: `admin123`
- Name: `Admin User`

### Manual SQL Insert

If you prefer to create the admin manually, you'll need to:

1. Generate a bcrypt hash for your password (use bcryptjs with 10 rounds)
2. Generate a UUID for the admin ID
3. Insert into the database

**Example SQL (replace the hashed password with your own):**

```sql
-- First, generate a UUID and bcrypt hash for your password
-- You can use Node.js: const { hash } = require('bcryptjs'); hash('yourpassword', 10).then(console.log)

INSERT INTO admins (id, username, password, name) 
VALUES (
    UUID(),  -- or use a specific UUID
    'admin',
    '$2a$10$YourBcryptHashHere',  -- Replace with actual bcrypt hash
    'Admin User'
);
```

## Sample Credentials Summary

| Type | Username | Password | Notes |
|------|----------|----------|-------|
| Environment Admin | `admin` | `admin123` | Set in `.env` file |
| Database Admin | `admin` | `admin123` | Created via script or SQL |

## Notes

- Passwords are hashed using bcryptjs with 10 rounds
- Environment admin takes precedence over database admin
- You can create multiple database admins
- Database admin passwords must be hashed before insertion

