/**
 * Import all clients from Brooklyn clone Supabase into the parent (main) dietcombo Supabase.
 * Each imported client is set with unite_account = 'Brooklyn'.
 *
 * Run from repo root: npm run import-brooklyn-clients-to-parent
 *
 * Credentials (same as copy-admins):
 *   1) .env.copy-admins or BROOKLYN_* / PARENT_* env vars
 *   2) Else: parent from .env.local / .env, Brooklyn from brooklyn clone/.env
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as path from 'path';
import * as fs from 'fs';

const cwd = process.cwd();

function loadEnvFile(filePath: string): void {
  try {
    const full = path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
    if (!fs.existsSync(full)) return;
    const content = fs.readFileSync(full, 'utf8');
    content.split('\n').forEach((line) => {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) {
        const key = match[1].trim();
        const value = match[2].trim().replace(/^["']|["']$/g, '');
        if (!process.env[key]) process.env[key] = value;
      }
    });
  } catch {
    // ignore
  }
}

loadEnvFile('.env.copy-admins');
loadEnvFile('brooklyn clone/.env.copy-admins');

if (!process.env.PARENT_SUPABASE_URL || !process.env.PARENT_SUPABASE_SERVICE_ROLE_KEY) {
  loadEnvFile('.env.local');
  loadEnvFile('.env');
  if (!process.env.PARENT_SUPABASE_URL) process.env.PARENT_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!process.env.PARENT_SUPABASE_SERVICE_ROLE_KEY) process.env.PARENT_SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
}

let parentUrl = process.env.PARENT_SUPABASE_URL;
let parentKey = process.env.PARENT_SUPABASE_SERVICE_ROLE_KEY;
let brooklynUrl = process.env.BROOKLYN_SUPABASE_URL;
let brooklynKey = process.env.BROOKLYN_SUPABASE_SERVICE_ROLE_KEY;

if (!brooklynUrl || !brooklynKey) {
  const brooklynEnvPath = path.join(cwd, 'brooklyn clone', '.env');
  const brooklynEnvLocalPath = path.join(cwd, 'brooklyn clone', '.env.local');
  for (const p of [brooklynEnvLocalPath, brooklynEnvPath]) {
    if (fs.existsSync(p)) {
      const content = fs.readFileSync(p, 'utf8');
      content.split('\n').forEach((line) => {
        const match = line.match(/^([^#=]+)=(.*)$/);
        if (match) {
          const key = match[1].trim();
          const value = match[2].trim().replace(/^["']|["']$/g, '');
          if (key === 'NEXT_PUBLIC_SUPABASE_URL') brooklynUrl = brooklynUrl || value;
          else if (key === 'SUPABASE_SERVICE_ROLE_KEY') brooklynKey = brooklynKey || value;
        }
      });
      if (brooklynUrl && brooklynKey) break;
    }
  }
}

brooklynUrl = brooklynUrl || process.env.BROOKLYN_SUPABASE_URL;
brooklynKey = brooklynKey || process.env.BROOKLYN_SUPABASE_SERVICE_ROLE_KEY;

if (!parentUrl || !parentKey) {
  console.error('Missing parent DB credentials. Set PARENT_SUPABASE_URL and PARENT_SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
if (!brooklynUrl || !brooklynKey) {
  console.error('Missing Brooklyn DB credentials. Set BROOKLYN_SUPABASE_URL and BROOKLYN_SUPABASE_SERVICE_ROLE_KEY');
  console.error('Or run from repo root so script can read brooklyn clone/.env');
  process.exit(1);
}

const parentSupabase: SupabaseClient = createClient(parentUrl, parentKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  db: { schema: 'public' },
});

const brooklynSupabase: SupabaseClient = createClient(brooklynUrl, brooklynKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  db: { schema: 'public' },
});

// Parent clients table columns (snake_case). Omit id from copy if you want parent to generate; we keep id for upsert.
const PARENT_CLIENT_COLUMNS = [
  'id', 'full_name', 'first_name', 'last_name', 'email', 'address', 'apt', 'city', 'state', 'zip', 'county',
  'phone_number', 'secondary_phone_number', 'client_id_external', 'case_id_external', 'medicaid', 'paused',
  'complex', 'bill', 'delivery', 'dislikes', 'latitude', 'longitude', 'lat', 'lng', 'geocoded_at', 'billings',
  'visits', 'sign_token', 'navigator_id', 'end_date', 'screening_took_place', 'screening_signed', 'screening_status',
  'notes', 'status_id', 'service_type', 'approved_meals_per_week', 'parent_client_id', 'dob', 'cin',
  'authorized_amount', 'expiration_date', 'upcoming_order', 'meal_planner_data', 'assigned_driver_id',
  'created_at', 'updated_at', 'updated_by', 'unite_account', 'history', 'produce_vendor_id'
];

const PAGE_SIZE = 500;

function toParentRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const col of PARENT_CLIENT_COLUMNS) {
    if (col === 'unite_account') {
      out[col] = 'Brooklyn';
      continue;
    }
    // Brooklyn may use active_order instead of upcoming_order
    if (col === 'upcoming_order') {
      const val = row['upcoming_order'] ?? row['active_order'];
      if (val !== undefined) out[col] = val;
      continue;
    }
    let val = row[col];
    if (val !== undefined && val !== null) {
      out[col] = val;
    }
  }
  out.unite_account = 'Brooklyn';
  // No driver info: show as unrouted in parent
  out.assigned_driver_id = null;
  // Parent required columns
  if (!out.full_name) out.full_name = out.id ? String(out.id) : 'Unknown';
  if (!out.service_type) out.service_type = 'Food';
  return out;
}

async function main() {
  console.log('Fetching clients from Brooklyn DB...');
  const allRows: Record<string, unknown>[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await brooklynSupabase
      .from('clients')
      .select('*')
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.error('Brooklyn DB error:', error.message);
      process.exit(1);
    }
    const chunk = (data || []) as Record<string, unknown>[];
    allRows.push(...chunk);
    hasMore = chunk.length === PAGE_SIZE;
    offset += PAGE_SIZE;
  }

  if (allRows.length === 0) {
    console.log('No clients found in Brooklyn DB.');
    process.exit(0);
  }

  console.log(`Found ${allRows.length} client(s). Importing into parent DB with unite_account = 'Brooklyn'...`);

  const BATCH = 50;
  let ok = 0;
  let err = 0;

  for (let i = 0; i < allRows.length; i += BATCH) {
    const batch = allRows.slice(i, i + BATCH).map(toParentRow);
    const { error: upsertError } = await parentSupabase
      .from('clients')
      .upsert(batch, { onConflict: 'id' });

    if (upsertError) {
      console.error(`Batch ${i / BATCH + 1} upsert error:`, upsertError.message);
      err += batch.length;
    } else {
      ok += batch.length;
      for (const r of batch) {
        console.log(`  ✓ ${r.full_name ?? r.id}`);
      }
    }
  }

  console.log(`Done. Imported/updated ${ok} clients (unite_account = 'Brooklyn'). Errors: ${err}.`);
}

main();
