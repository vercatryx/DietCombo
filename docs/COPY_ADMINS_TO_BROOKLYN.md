# Copy Admin Users to Brooklyn DB

Copy admin users (and their hashed passwords) from the **parent** Supabase project to the **Brooklyn** Supabase project so the same admins can log in to the Brooklyn app.

## Prerequisites

- Both projects use the same `admins` table schema (`id`, `username`, `password`, `name`, `created_at`, `updated_at`).
- You have the **service role key** for both Supabase projects (Dashboard → Project Settings → API).

## One-time setup

1. In the **repo root**, create a file `.env.copy-admins` (it is gitignored via `.env*`). Do not commit it.

2. Add the four variables (get parent values from root `.env` or `.env.local`, Brooklyn values from `brooklyn clone/.env`):

   ```env
   PARENT_SUPABASE_URL=https://xxxxx.supabase.co
   PARENT_SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
   BROOKLYN_SUPABASE_URL=https://yyyyy.supabase.co
   BROOKLYN_SUPABASE_SERVICE_ROLE_KEY=eyJhbGc...
   ```

## Run the copy

From the **repo root**:

```bash
npm run copy-admins-to-brooklyn
```

Or without the npm script (if you prefer to pass env another way):

```bash
npx dotenv -e .env.copy-admins -- npx ts-node --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' scripts/copy-admins-to-brooklyn-db.ts
```

The script will:

1. Read all rows from `admins` in the parent DB.
2. Upsert them into `admins` in the Brooklyn DB (same `id`; existing rows are updated).

Admins can then log in to the Brooklyn app with the **same username and password** as in the parent app. Passwords are copied as-is (hashed); nothing is re-hashed.

## Optional: run from Brooklyn clone

If you run from `brooklyn clone/`, the script still looks for `.env.copy-admins` in the current directory. So you can put `.env.copy-admins` inside `brooklyn clone/` with the same four variables and run:

```bash
cd "brooklyn clone"
npx dotenv -e .env.copy-admins -- npx ts-node --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' ../scripts/copy-admins-to-brooklyn-db.ts
```

## Security

- Use only the **service role key** in a secure, one-off script like this; never commit `.env.copy-admins` or expose the keys.
- The script does not create or modify Supabase Auth users—only the `admins` table used by the app’s login flow.
