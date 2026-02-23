# MySQL Migration Guide

This document outlines the conversion patterns used to migrate from Supabase to MySQL.

## Conversion Patterns

### SELECT Queries

**Supabase:**
```typescript
const { data, error } = await supabase.from('table').select('*');
if (error) return [];
```

**MySQL:**
```typescript
try {
    const data = await query<any>('SELECT * FROM table');
    // process data
} catch (error) {
    console.error('Error:', error);
    return [];
}
```

### SELECT Single Row

**Supabase:**
```typescript
const { data, error } = await supabase.from('table').select('*').eq('id', id).single();
if (error || !data) return null;
```

**MySQL:**
```typescript
const data = await queryOne<any>('SELECT * FROM table WHERE id = ?', [id]);
if (!data) return null;
```

### INSERT

**Supabase:**
```typescript
const { data, error } = await supabase.from('table').insert([payload]).select().single();
handleError(error);
return data;
```

**MySQL:**
```typescript
const id = generateUUID();
await insert('INSERT INTO table (id, col1, col2) VALUES (?, ?, ?)', [id, val1, val2]);
const data = await queryOne<any>('SELECT * FROM table WHERE id = ?', [id]);
return data;
```

### UPDATE

**Supabase:**
```typescript
const { error } = await supabase.from('table').update(payload).eq('id', id);
handleError(error);
```

**MySQL:**
```typescript
const updates: string[] = [];
const params: any[] = [];
if (data.field1) {
    updates.push('field1 = ?');
    params.push(data.field1);
}
// ... more fields
if (updates.length > 0) {
    params.push(id);
    await execute(`UPDATE table SET ${updates.join(', ')} WHERE id = ?`, params);
}
```

### DELETE

**Supabase:**
```typescript
const { error } = await supabase.from('table').delete().eq('id', id);
handleError(error);
```

**MySQL:**
```typescript
await execute('DELETE FROM table WHERE id = ?', [id]);
```

### Complex Queries

**Supabase:**
```typescript
const { data } = await supabase
    .from('orders')
    .select('*')
    .in('status', ['pending', 'confirmed'])
    .order('created_at', { ascending: false });
```

**MySQL:**
```typescript
const data = await query<any>(
    'SELECT * FROM orders WHERE status IN (?, ?) ORDER BY created_at DESC',
    ['pending', 'confirmed']
);
```

### JSON Fields

**Supabase:** Automatically handles JSON
**MySQL:** Need to use JSON.stringify() for inserts and JSON.parse() for selects

```typescript
// Insert
await insert('INSERT INTO table (json_field) VALUES (?)', [JSON.stringify(data)]);

// Select
const row = await queryOne<any>('SELECT * FROM table WHERE id = ?', [id]);
const parsed = typeof row.json_field === 'string' ? JSON.parse(row.json_field) : row.json_field;
```

## Remaining Conversions

The following functions in `lib/actions.ts` still need conversion:
- Box quota functions
- Box type functions
- App settings functions
- Navigator functions
- Nutritionist functions
- Client functions (complex)
- Order functions (very complex)
- Upcoming order functions
- Delivery history functions
- Billing functions
- Form submission functions

## Environment Variables

Add to `.env.local`:
```
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=your_password
MYSQL_DATABASE=dietcombo
```

## Database Setup

1. Install MySQL
2. Run `sql/mysql-schema.sql` to create the database and tables
3. Update environment variables
4. Test the connection

