# AGENTS.md

## Cursor Cloud specific instructions

### ⛔ CRITICAL: PRODUCTION DATABASE — DO NOT MODIFY DATA OR SCHEMA

**The environment variables in this workspace point to the LIVE PRODUCTION database with real customer data.** There is no staging or local database layer.

**NEVER run any of the following commands:**
- `prisma db push` — pushes schema changes to production, can DROP tables/columns
- `prisma migrate deploy` / `prisma migrate dev` — applies migrations to production
- `prisma db seed` — inserts data into production
- Any raw SQL that modifies data (`INSERT`, `UPDATE`, `DELETE`, `DROP`, `ALTER`, `TRUNCATE`)
- Any script that writes to the database (e.g., scripts in `scripts/` that insert/update/delete rows)
- `supabase db push` or `supabase db reset`

**ONLY safe Prisma command:** `npx prisma generate` (generates the TypeScript client locally, does NOT touch the database)

**If you need to test schema changes:** Edit `prisma/schema.prisma` and commit the file. Do NOT apply it. The owner will review and apply manually.

**If you need to test with data:** Use read-only queries only. Do NOT insert, update, or delete any records.

---

### Project Overview

DietCombo / Diet Fantasy is a food delivery management platform (Next.js 16 + React 19 + Supabase + Prisma). It handles clients, orders, billing, delivery routes, drivers, vendors, and meal planning for food assistance programs.

### Running the Application

- **Dev server**: `npm run dev` (runs on port 3000 with Turbopack)
- **Lint**: `npx eslint app/ lib/ components/` (pre-existing lint errors exist — mostly `@typescript-eslint/no-explicit-any`)
- **Build**: `npm run build`

### Environment Variables

All required secrets are injected as environment variables (no `.env.local` needed in cloud agent sessions):
- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`, `SUPABASE_SECRET_KEY` — Supabase connection (**PRODUCTION**)
- `DATABASE_URL` — PostgreSQL connection for Prisma (**PRODUCTION — read-only use only**)
- `ADMIN_USERNAME`, `ADMIN_PASSWORD` — Env-based super-admin login (bypasses DB check)
- `R2_*` — Cloudflare R2 storage
- `JWT_SECRET` — Session signing

### Authentication

The login flow is multi-step: first validates the username/email exists, then shows the password field. The env-based super-admin (`ADMIN_USERNAME`/`ADMIN_PASSWORD`) bypasses the database admin check entirely.

### Key Gotchas

- **Prisma client must be generated** before the app starts (`npx prisma generate`). The generated output lives in `lib/generated/prisma/`.
- **`prisma.config.ts`** loads `.env.local` explicitly via dotenv; in cloud agent sessions shell env vars take precedence (dotenv does not override existing env vars).
- **Supabase client initialization** (`lib/supabase.ts`) throws at module import time if `NEXT_PUBLIC_SUPABASE_URL` or a valid API key is missing.
- **Middleware deprecation warning** ("middleware file convention is deprecated") is expected with Next.js 16 — it still works.
- The app uses a hosted Supabase instance (not local). Schema changes should ONLY be made to `prisma/schema.prisma` file — never applied directly.
- The `tsconfig.json` excludes `scripts/`, `docs/`, and `df ext and server/` from TypeScript checks.
- No formal test framework (Jest/Vitest) is set up — testing is manual or via scripts in `scripts/`.
