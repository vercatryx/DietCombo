# Minimum Order Feature - Database Documentation

## Overview
This feature adds the ability for vendors to set minimum order quantities for their products. The minimum requirement is validated when orders are created or edited in the Service Configuration section (Food tab).

## Related Database & Models

### Database Table: `menu_items`

The `menu_items` table stores product/menu item information for vendors.

**Existing Columns:**
- `id` (UUID/STRING) - Primary key
- `vendor_id` (UUID/STRING) - Foreign key to `vendors` table
- `name` (TEXT) - Product name
- `value` (INTEGER/NUMERIC) - Price/points value
- `is_active` (BOOLEAN) - Active status
- `category_id` (UUID/STRING, nullable) - Foreign key to `item_categories` table
- `quota_value` (INTEGER/NUMERIC, nullable) - Quota value for box items

**New Column to Add:**
- `minimum_order` (INTEGER) - Minimum order quantity required (default: 0 = no minimum)

### TypeScript Model

**File:** `lib/types.ts`

```typescript
export interface MenuItem {
  id: string;
  vendorId: string;
  name: string;
  value: number;
  isActive: boolean;
  categoryId?: string | null;
  quotaValue?: number;
  minimumOrder?: number; // NEW: Minimum order quantity (default 0)
}
```

### Database Actions

**File:** `lib/actions.ts`

The following functions have been updated to handle `minimumOrder`:
- `getMenuItems()` - Maps `minimum_order` from database to `minimumOrder` in TypeScript
- `addMenuItem()` - Saves `minimumOrder` as `minimum_order` in database
- `updateMenuItem()` - Updates `minimum_order` column in database

**Column Mapping:**
- TypeScript: `minimumOrder` (camelCase)
- Database: `minimum_order` (snake_case)

## Supabase SQL Migration

**File:** `sql/add_minimum_order_to_menu_items.sql`

### Command to Run in Supabase SQL Editor

```sql
-- Add minimum_order column to menu_items table
-- This column stores the minimum order quantity required for each menu item/product
-- Default value is 0, which means no minimum order requirement
-- Used in: MenuManagement (admin UI) and ClientProfile (screening form validation)

ALTER TABLE menu_items 
ADD COLUMN IF NOT EXISTS minimum_order INTEGER NOT NULL DEFAULT 0;

-- Add comment for documentation
COMMENT ON COLUMN menu_items.minimum_order IS 'Minimum order quantity required for this product. Default is 0 (no minimum requirement).';
```

### Alternative: Using Supabase Dashboard

1. Go to your Supabase project dashboard
2. Navigate to **SQL Editor**
3. Create a new query
4. Paste the SQL command above
5. Click **Run** to execute

### Verification Query

After running the migration, verify the column was added:

```sql
-- Check if column exists and see its structure
SELECT 
    column_name, 
    data_type, 
    column_default, 
    is_nullable
FROM information_schema.columns 
WHERE table_name = 'menu_items' 
AND column_name = 'minimum_order';

-- Check existing data (should all be 0 by default)
SELECT id, name, minimum_order 
FROM menu_items 
LIMIT 10;
```

## Usage in Application

### Admin UI (MenuManagement)
- Location: Admin → Menu Management
- Allows vendors to set minimum order quantity when creating/editing products
- Displays minimum order in the product list

### Screening Form (ClientProfile)
- Location: Client Profile → Service Configuration → Food tab
- Displays minimum order requirement next to each product
- Validates order quantities before saving
- Shows validation errors if minimums are not met

## Notes

- Default value `0` means no minimum requirement (product can be ordered in any quantity ≥ 0)
- Validation only applies when quantity > 0 (users can still set quantity to 0 to remove items)
- The feature is scoped to the Food service type only

