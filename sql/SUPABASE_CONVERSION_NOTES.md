# MySQL to Supabase/PostgreSQL Conversion Notes

## Overview
This document outlines the conversion of the `10_db` MySQL database schema to Supabase (PostgreSQL).

## Key Conversions Made

### Data Types
- `int(11)` → `INTEGER` or `SERIAL` (for auto-increment)
- `varchar(n)` → `VARCHAR(n)` (same)
- `text` → `TEXT` (same)
- `date` → `DATE` (same)
- `time` → `TIME` (same)
- `datetime` → `TIMESTAMP`
- `float(10,2)` → `NUMERIC(10,2)`
- `decimal(10,2)` → `NUMERIC(10,2)`
- `tinyint(1)` → `INTEGER` or `BOOLEAN` (depending on usage)

### Auto Increment
- `AUTO_INCREMENT` → `SERIAL` (PostgreSQL's auto-increment)
- Primary keys using `SERIAL` automatically get sequences

### Removed MySQL-Specific Features
- `ENGINE=InnoDB` - PostgreSQL doesn't use storage engines
- `DEFAULT CHARSET` - PostgreSQL handles encoding differently
- `COLLATE` clauses - PostgreSQL uses different collation system
- `USE database` statements - Not needed in Supabase

### Reserved Words
- `user` table name is quoted as `"user"` because it's a PostgreSQL reserved word

## Important Notes

### 1. Foreign Keys
Foreign key constraints are commented out in the schema. You should:
- Review each relationship
- Add foreign keys based on your business logic
- Consider cascade/restrict behaviors

Example:
```sql
ALTER TABLE appointment 
    ADD CONSTRAINT fk_appointment_patient 
    FOREIGN KEY (patientid) REFERENCES patient(patientid) ON DELETE CASCADE;
```

### 2. Row Level Security (RLS)
Supabase uses Row Level Security for access control. Consider enabling RLS on sensitive tables:

```sql
ALTER TABLE patient ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own records" ON patient
    FOR SELECT USING (auth.uid()::text = patientid::text);
```

### 3. UUIDs vs Serial IDs
The original schema uses `SERIAL` (auto-increment integers). Supabase often uses UUIDs. Consider:
- Keeping integer IDs for compatibility
- Or migrating to UUIDs for better distributed system support

To use UUIDs instead:
```sql
-- Replace SERIAL with UUID
CREATE TABLE admin (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ...
);
```

### 4. Timestamps
- `created_at` and `updated_at` columns should use `TIMESTAMP DEFAULT CURRENT_TIMESTAMP`
- For `updated_at`, you may want to use triggers:
```sql
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_admin_updated_at BEFORE UPDATE ON admin
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

### 5. JSON Fields
If you need JSON fields (like `delivery_days` in other tables), PostgreSQL has excellent JSON support:
```sql
delivery_days JSONB  -- Use JSONB for better performance
```

### 6. Text vs VARCHAR
- `TEXT` in PostgreSQL has no length limit
- `VARCHAR(n)` has a limit
- Both are fine, but `TEXT` is more flexible

### 7. Boolean Fields
Fields like `delete_status` that use `0`/`1` could be converted to `BOOLEAN`:
```sql
delete_status BOOLEAN DEFAULT FALSE
```

### 8. Indexes
Basic indexes have been added. You may want to add more based on:
- Common query patterns
- Foreign key lookups
- Search fields

### 9. Authentication
Supabase has built-in authentication. Consider:
- Using Supabase Auth instead of custom password fields
- Linking `admin`, `doctor`, and `patient` tables to `auth.users`
- Using `auth.uid()` in RLS policies

### 10. Storage
For file uploads (like `image` field in `admin` table), use Supabase Storage:
- Create storage buckets
- Store file URLs in database
- Use Supabase Storage API for uploads

## Migration Steps

1. **Run the schema file in Supabase SQL Editor:**
   - Open Supabase Dashboard
   - Go to SQL Editor
   - Paste and run `sql/supabase-10_db-schema.sql`

2. **Add Foreign Keys:**
   - Review relationships
   - Add appropriate foreign key constraints

3. **Enable RLS (if needed):**
   - Enable RLS on sensitive tables
   - Create policies based on your access requirements

4. **Migrate Data:**
   - Export data from MySQL
   - Transform data types if needed
   - Import into Supabase

5. **Update Application Code:**
   - Replace MySQL queries with Supabase client calls
   - Update data access patterns
   - Test thoroughly

## Data Migration Script Example

```typescript
// Example: Migrate admin table
import { createClient } from '@supabase/supabase-js';
import mysql from 'mysql2/promise';

const supabase = createClient(url, key);
const mysqlConn = await mysql.createConnection(mysqlConfig);

const [rows] = await mysqlConn.execute('SELECT * FROM admin');
for (const row of rows) {
  await supabase.from('admin').insert({
    id: row.id,
    username: row.username,
    // ... map all fields
  });
}
```

## Testing Checklist

- [ ] All tables created successfully
- [ ] Indexes are working
- [ ] Foreign keys (if added) are enforced
- [ ] RLS policies (if enabled) work correctly
- [ ] Data migration completed
- [ ] Application queries work with new schema
- [ ] Performance is acceptable

## Additional Resources

- [Supabase Documentation](https://supabase.com/docs)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [MySQL to PostgreSQL Migration Guide](https://www.postgresql.org/docs/current/migration.html)
