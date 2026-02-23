# Prisma Setup Guide

This guide will help you set up Prisma to work with your existing MySQL database.

## Database Connection

The Prisma schema is configured to use MySQL. You need to set up the `DATABASE_URL` environment variable.

### Option 1: Use DATABASE_URL (Recommended for Prisma)

Add to your `.env.local` file:

```env
DATABASE_URL="mysql://USER:PASSWORD@HOST:PORT/DATABASE"
```

**Example:**
```env
DATABASE_URL="mysql://root:yourpassword@localhost:3306/dietcombo"
```

### Option 2: Convert from Individual MySQL Variables

If you're currently using individual MySQL environment variables (MYSQL_HOST, MYSQL_PORT, etc.), you can construct the DATABASE_URL:

```env
# Individual variables (for mysql2)
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=yourpassword
MYSQL_DATABASE=dietcombo

# Prisma DATABASE_URL (constructed from above)
DATABASE_URL="mysql://${MYSQL_USER}:${MYSQL_PASSWORD}@${MYSQL_HOST}:${MYSQL_PORT}/${MYSQL_DATABASE}"
```

Or manually:
```env
DATABASE_URL="mysql://root:yourpassword@localhost:3306/dietcombo"
```

## Schema Overview

The Prisma schema includes all tables from your MySQL database:

### Core Tables
- `ClientStatus` - Client statuses
- `Vendor` - Vendors
- `ItemCategory` - Item categories
- `MenuItem` - Menu items
- `BreakfastCategory` - Breakfast categories
- `BreakfastItem` - Breakfast items
- `Equipment` - Equipment
- `BoxType` - Box types
- `BoxQuota` - Box quotas

### Client & Order Management
- `Client` - Clients (with all fields from migrations)
- `Order` - Orders
- `OrderVendorSelection` - Order vendor selections
- `OrderItem` - Order items
- `OrderBoxSelection` - Order box selections
- `UpcomingOrder` - Upcoming orders
- `UpcomingOrderVendorSelection` - Upcoming order vendor selections
- `UpcomingOrderItem` - Upcoming order items
- `UpcomingOrderBoxSelection` - Upcoming order box selections

### Delivery & Routing
- `DeliveryHistory` - Delivery history
- `Stop` - Delivery stops
- `Driver` - Drivers
- `Route` - Routes
- `RouteRun` - Route run snapshots
- `Schedule` - Client delivery schedules

### Forms & Submissions
- `Form` - Forms
- `Question` - Form questions
- `FilledForm` - Filled forms
- `FormAnswer` - Form answers
- `FormSubmission` - Form submissions

### Other Tables
- `AppSetting` - App settings
- `Navigator` - Navigators
- `Nutritionist` - Nutritionists
- `Admin` - Admins
- `OrderHistory` - Order history log
- `BillingRecord` - Billing records
- `NavigatorLog` - Navigator logs
- `PasswordlessCode` - Passwordless login codes
- `Signature` - Digital signatures
- `CityColor` - City color coding
- `Setting` - Key-value settings

## Generating Prisma Client

After setting up your DATABASE_URL, generate the Prisma client:

```bash
npx prisma generate
```

This will create the Prisma client in `lib/generated/prisma` (as configured in the schema).

## Using Prisma Client

Import and use the Prisma client in your code:

```typescript
import { PrismaClient } from '@/lib/generated/prisma';

const prisma = new PrismaClient();

// Example: Get all clients
const clients = await prisma.client.findMany({
  include: {
    navigator: true,
    status: true,
  },
});

// Example: Create a client
const newClient = await prisma.client.create({
  data: {
    id: crypto.randomUUID(),
    fullName: 'John Doe',
    serviceType: 'Food',
    // ... other fields
  },
});
```

## Migration Strategy

Since you already have a MySQL database with the schema, you have two options:

### Option 1: Use Prisma Migrate (Recommended for new projects)
If you want Prisma to manage migrations going forward:

```bash
# This will create an initial migration based on your current schema
npx prisma migrate dev --name init

# For production
npx prisma migrate deploy
```

**Note:** This will create migration files. Since you already have the database, you may want to use `prisma db push` instead for the initial sync.

### Option 2: Use Prisma DB Push (Recommended for existing database)
If you want to keep using your existing MySQL schema and just sync Prisma:

```bash
# This will sync your Prisma schema with the database without creating migration files
npx prisma db push
```

This is safer for existing databases as it won't create migration files that might conflict with your existing setup.

## Field Mappings

The Prisma schema uses camelCase for field names, but maps to snake_case in the database using `@map` directives. For example:

- `fullName` → `full_name`
- `createdAt` → `created_at`
- `updatedAt` → `updated_at`

## JSON Fields

The following fields are stored as JSON in MySQL:
- `Vendor.deliveryDays`
- `Client.billings`
- `Client.visits`
- `Client.activeOrder`
- `Order.deliveryDistribution`
- `OrderBoxSelection.items`
- `UpcomingOrder.deliveryDistribution`
- `UpcomingOrderBoxSelection.items`
- `Question.options`
- `Question.conditionalTextInputs`
- `FormSubmission.data`
- `Driver.stopIds`
- `Route.stopIds`
- `RouteRun.snapshot`
- `Signature.strokes`

Prisma will automatically handle JSON serialization/deserialization.

## Important Notes

1. **UUIDs**: All IDs are VARCHAR(36) for UUIDs. You'll need to generate UUIDs manually (e.g., using `crypto.randomUUID()`).

2. **Timestamps**: MySQL uses `TIMESTAMP` with `ON UPDATE CURRENT_TIMESTAMP` for `updated_at` fields. Prisma's `@updatedAt` directive handles this automatically.

3. **Nullable Fields**: Many foreign keys and optional fields are nullable, matching your MySQL schema.

4. **Relations**: All foreign key relationships are properly defined with appropriate `onDelete` behaviors (Cascade, SetNull, etc.).

5. **Indexes**: All indexes from your MySQL schema are included in the Prisma schema.

## Next Steps

1. Set up your `DATABASE_URL` in `.env.local`
2. Run `npx prisma generate` to generate the client
3. Optionally run `npx prisma db push` to sync the schema
4. Start using Prisma client in your code instead of raw MySQL queries

## Troubleshooting

If you encounter connection issues:
- Verify your MySQL server is running
- Check that the database exists
- Ensure the user has proper permissions
- Verify the DATABASE_URL format is correct

If you get schema mismatch errors:
- Run `npx prisma db pull` to introspect your database and update the schema
- Or use `npx prisma db push` to push your schema changes to the database
