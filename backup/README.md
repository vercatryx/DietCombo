# Backup Supabase (produce vendors source)

This folder holds **environment templates only**. Put secrets in `backup/.env` (gitignored).

## 1. Create `backup/.env`

Copy `env.example` → `.env` and set:

- `BACKUP_SUPABASE_URL` — your older project URL (e.g. `https://tqjwmknxymhzbxtykjan.supabase.co`)
- `BACKUP_SUPABASE_ANON_KEY` — anon key from that project’s dashboard (Settings → API)

If `SELECT` on `produce_vendors` is blocked for anon, use **service role** as `BACKUP_SUPABASE_SERVICE_ROLE_KEY` instead (never commit it).

## 2. Import into DietCombo

From the **repository root** (parent of `backup/`):

```bash
npx ts-node --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' scripts/import-produce-vendors-from-backup.ts --dry-run
npx ts-node --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' scripts/import-produce-vendors-from-backup.ts
```

Root `.env.local` must define your **current** project URL and a **write** key (`SUPABASE_SECRET_KEY` recommended).

## 3. Clear browser cache

After import, clear `localStorage` key `dietcombo_cache_produce_vendors` or wait up to 24h so the UI reloads vendor lists.
