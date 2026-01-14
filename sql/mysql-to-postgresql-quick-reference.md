# MySQL to PostgreSQL Quick Reference

## Common Data Type Conversions

| MySQL | PostgreSQL | Notes |
|-------|------------|-------|
| `INT(11)` | `INTEGER` or `SERIAL` | Use SERIAL for auto-increment |
| `BIGINT(20)` | `BIGINT` or `BIGSERIAL` | Use BIGSERIAL for auto-increment |
| `VARCHAR(n)` | `VARCHAR(n)` | Same |
| `TEXT` | `TEXT` | Same |
| `LONGTEXT` | `TEXT` | PostgreSQL TEXT has no limit |
| `DATE` | `DATE` | Same |
| `TIME` | `TIME` | Same |
| `DATETIME` | `TIMESTAMP` | Use TIMESTAMP |
| `TIMESTAMP` | `TIMESTAMP` | Same |
| `FLOAT(10,2)` | `NUMERIC(10,2)` or `REAL` | Use NUMERIC for exact precision |
| `DOUBLE` | `DOUBLE PRECISION` | Same |
| `DECIMAL(10,2)` | `NUMERIC(10,2)` | Same |
| `TINYINT(1)` | `BOOLEAN` or `SMALLINT` | Use BOOLEAN for true/false |
| `TINYINT(4)` | `SMALLINT` | For small integers |
| `BLOB` | `BYTEA` | Binary data |
| `JSON` | `JSONB` | Use JSONB for better performance |

## Syntax Conversions

### Auto Increment
**MySQL:**
```sql
id INT(11) NOT NULL AUTO_INCREMENT PRIMARY KEY
```

**PostgreSQL:**
```sql
id SERIAL PRIMARY KEY
-- or
id INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY
```

### Default Values
**MySQL:**
```sql
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
```

**PostgreSQL:**
```sql
created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
-- Then create a trigger for ON UPDATE (see below)
```

### ON UPDATE CURRENT_TIMESTAMP
**PostgreSQL requires a trigger:**
```sql
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_table_updated_at 
    BEFORE UPDATE ON table_name
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();
```

### Character Sets
**MySQL:**
```sql
DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
```

**PostgreSQL:**
```sql
-- No need to specify, PostgreSQL uses UTF-8 by default
-- Or set at database level:
CREATE DATABASE dbname WITH ENCODING 'UTF8';
```

### Storage Engines
**MySQL:**
```sql
ENGINE=InnoDB
```

**PostgreSQL:**
```sql
-- Remove entirely, PostgreSQL doesn't use storage engines
```

### Reserved Words
**MySQL:**
```sql
CREATE TABLE user (...)
```

**PostgreSQL:**
```sql
CREATE TABLE "user" (...)
-- Quote reserved words
```

## Common Patterns

### Boolean Fields
**MySQL:**
```sql
is_active TINYINT(1) DEFAULT 1
```

**PostgreSQL:**
```sql
is_active BOOLEAN DEFAULT TRUE
-- Or keep as INTEGER if you need 0/1 for compatibility
```

### JSON Fields
**MySQL:**
```sql
data JSON
```

**PostgreSQL:**
```sql
data JSONB  -- JSONB is faster and supports indexing
```

### UUID Primary Keys
**PostgreSQL:**
```sql
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE example (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    ...
);
```

### Full Text Search
**PostgreSQL:**
```sql
-- Add tsvector column
ALTER TABLE table_name ADD COLUMN search_vector tsvector;

-- Create index
CREATE INDEX idx_search ON table_name USING gin(search_vector);

-- Update trigger
CREATE TRIGGER tsvectorupdate BEFORE INSERT OR UPDATE ON table_name
    FOR EACH ROW EXECUTE FUNCTION 
    tsvector_update_trigger(search_vector, 'pg_catalog.english', column1, column2);
```

## Indexes

### Basic Index
**Both:**
```sql
CREATE INDEX idx_name ON table_name(column_name);
```

### Unique Index
**Both:**
```sql
CREATE UNIQUE INDEX idx_name ON table_name(column_name);
```

### Composite Index
**Both:**
```sql
CREATE INDEX idx_name ON table_name(col1, col2);
```

## Foreign Keys

**Both (syntax is similar):**
```sql
ALTER TABLE child_table
    ADD CONSTRAINT fk_name
    FOREIGN KEY (child_column) 
    REFERENCES parent_table(parent_column)
    ON DELETE CASCADE;
```

## Common Functions

### String Functions
| MySQL | PostgreSQL |
|-------|------------|
| `CONCAT()` | `CONCAT()` or `\|\|` |
| `SUBSTRING()` | `SUBSTRING()` |
| `LENGTH()` | `LENGTH()` or `CHAR_LENGTH()` |
| `UPPER()` | `UPPER()` |
| `LOWER()` | `LOWER()` |

### Date Functions
| MySQL | PostgreSQL |
|-------|------------|
| `NOW()` | `NOW()` or `CURRENT_TIMESTAMP` |
| `CURDATE()` | `CURRENT_DATE` |
| `DATE_FORMAT()` | `TO_CHAR()` |
| `DATEDIFF()` | `AGE()` or subtraction |

### Aggregation
| MySQL | PostgreSQL |
|-------|------------|
| `COUNT()` | `COUNT()` |
| `SUM()` | `SUM()` |
| `AVG()` | `AVG()` |
| `GROUP_CONCAT()` | `STRING_AGG()` |

## Migration Checklist

1. ✅ Convert data types
2. ✅ Replace AUTO_INCREMENT with SERIAL
3. ✅ Remove ENGINE clauses
4. ✅ Remove CHARSET/COLLATE clauses
5. ✅ Quote reserved words
6. ✅ Convert datetime to timestamp
7. ✅ Convert float to numeric where precision matters
8. ✅ Add triggers for ON UPDATE CURRENT_TIMESTAMP
9. ✅ Review and add indexes
10. ✅ Add foreign key constraints
11. ✅ Enable RLS if needed
12. ✅ Test all queries
