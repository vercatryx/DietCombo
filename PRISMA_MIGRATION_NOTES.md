# Prisma Migration Notes

This document outlines important considerations when migrating from the Supabase SQL schema to Prisma.

## ✅ Completed Migration

The Prisma schema (`prisma/schema.prisma`) has been fully created to match the Supabase schema with all:
- 40+ tables
- All field types correctly mapped
- All foreign key relationships with proper cascade behaviors
- All indexes
- All unique constraints (where directly supported)
- Default values
- Nullable fields

## 🔧 Special Considerations

### 1. Updated At Timestamps

**Original SQL:** Uses PostgreSQL triggers (`update_updated_at_column()`) to automatically update `updated_at` fields.

**Prisma Solution:** Uses `@updatedAt` attribute which automatically handles timestamp updates. This is equivalent to the trigger functionality.

**Status:** ✅ Handled automatically by Prisma

### 2. Partial Unique Index on Stops Table

**Original SQL:**
```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_stops_client_delivery_date 
ON stops(client_id, delivery_date) 
WHERE delivery_date IS NOT NULL;
```

**Issue:** Prisma does not support partial unique indexes (indexes with WHERE clauses) directly in the schema.

**Solution:** This constraint needs to be added manually after running Prisma migrations:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_stops_client_delivery_date 
ON stops(client_id, delivery_date) 
WHERE delivery_date IS NOT NULL;
```

**Action Required:** Add this index manually after initial migration, or create a migration script.

### 3. UUID Generation

**Original SQL:** Uses `uuid-ossp` extension and `uuid_generate_v4()` or application-level UUID generation.

**Prisma Solution:** Uses `@default(uuid())` which generates UUIDs at the application level.

**Status:** ✅ Handled automatically by Prisma

### 4. JSONB Fields

**Original SQL:** Uses `JSONB` type for JSON fields.

**Prisma Solution:** Uses `Json @db.JsonB` which correctly maps to PostgreSQL JSONB.

**Status:** ✅ Correctly mapped

### 5. Decimal/Numeric Types

**Original SQL:** Uses `NUMERIC(10,2)` and `NUMERIC(10,0)`.

**Prisma Solution:** Uses `Decimal @db.Decimal(10, 2)` and `Decimal @db.Decimal(10, 0)`.

**Status:** ✅ Correctly mapped

### 6. Foreign Key Cascade Behaviors

All foreign key relationships have been mapped with correct cascade behaviors:
- `ON DELETE CASCADE` → `onDelete: Cascade`
- `ON DELETE SET NULL` → `onDelete: SetNull`

**Status:** ✅ All relationships correctly mapped

## 📋 Migration Steps

1. **Backup your database** before running migrations
2. **Review the Prisma schema** to ensure it matches your requirements
3. **Run Prisma migration:**
   ```bash
   npx prisma migrate dev --name init
   ```
4. **Add the partial unique index manually:**
   ```sql
   CREATE UNIQUE INDEX IF NOT EXISTS idx_stops_client_delivery_date 
   ON stops(client_id, delivery_date) 
   WHERE delivery_date IS NOT NULL;
   ```
5. **Generate Prisma Client:**
   ```bash
   npx prisma generate
   ```
6. **Update your code** to use Prisma Client instead of Supabase client
7. **Test all functionality** to ensure everything works as expected

## 🔄 Code Migration

After the schema is migrated, you'll need to update your application code:

### Before (Supabase):
```typescript
const { data, error } = await supabase
  .from('clients')
  .select('*')
  .eq('id', id)
  .single();
```

### After (Prisma):
```typescript
const client = await prisma.client.findUnique({
  where: { id }
});
```

## ⚠️ Important Notes

1. **Row Level Security (RLS):** The original schema has commented-out RLS policies. If you're using RLS, you'll need to configure it separately in Supabase or your PostgreSQL setup, as Prisma doesn't manage RLS policies.

2. **Triggers:** The `update_updated_at_column()` trigger function is no longer needed as Prisma handles `@updatedAt` automatically.

3. **Extensions:** The `uuid-ossp` extension is still needed in PostgreSQL if you want to use database-level UUID generation, but Prisma's `@default(uuid())` works at the application level.

4. **Default Values:** All default values from the original schema have been preserved in the Prisma schema.

## ✅ Verification Checklist

- [x] All tables mapped
- [x] All field types correct
- [x] All foreign keys with correct cascade behaviors
- [x] All indexes (except partial unique index on stops)
- [x] All unique constraints (except partial unique index)
- [x] All default values
- [x] All nullable fields
- [x] Updated_at timestamps handled
- [ ] Partial unique index on stops (manual step required)
- [ ] Code migration to Prisma Client
- [ ] Testing all functionality

## 📚 Resources

- [Prisma Schema Reference](https://www.prisma.io/docs/reference/api-reference/prisma-schema-reference)
- [Prisma Migration Guide](https://www.prisma.io/docs/guides/migrate-to-prisma)
- [PostgreSQL to Prisma Type Mapping](https://www.prisma.io/docs/concepts/database-connectors/postgresql)
