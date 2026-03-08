/**
 * Copy admin users from parent (dietcombo) Supabase to Brooklyn Supabase.
 *
 * Run from repo root: npm run copy-admins-to-brooklyn
 *
 * Credentials (in order of use):
 *   1) .env.copy-admins with PARENT_SUPABASE_URL, PARENT_SUPABASE_SERVICE_ROLE_KEY,
 *      BROOKLYN_SUPABASE_URL, BROOKLYN_SUPABASE_SERVICE_ROLE_KEY
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

// 1) Optional .env.copy-admins (all four vars in one file)
loadEnvFile('.env.copy-admins');
loadEnvFile('brooklyn clone/.env.copy-admins');

// 2) If PARENT_* missing, load parent .env from repo root and set PARENT_*
if (!process.env.PARENT_SUPABASE_URL || !process.env.PARENT_SUPABASE_SERVICE_ROLE_KEY) {
  loadEnvFile('.env.local');
  loadEnvFile('.env');
  if (!process.env.PARENT_SUPABASE_URL) process.env.PARENT_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!process.env.PARENT_SUPABASE_SERVICE_ROLE_KEY) process.env.PARENT_SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
}

// 3) If BROOKLYN_* missing, read brooklyn clone/.env from file (don't load into process.env or we overwrite parent)
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
  console.error('Or run from repo root with parent .env.local and brooklyn clone/.env present.');
  process.exit(1);
}
if (!brooklynUrl || !brooklynKey) {
  console.error('Missing Brooklyn DB credentials. Set BROOKLYN_SUPABASE_URL and BROOKLYN_SUPABASE_SERVICE_ROLE_KEY');
  console.error('Or run from repo root so script can read brooklyn clone/.env.');
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

type AdminRow = {
  id: string;
  username: string;
  password: string;
  name: string | null;
  created_at: string;
  updated_at: string;
};

async function main() {
  console.log('Fetching admins from parent DB...');
  const { data: admins, error: fetchError } = await parentSupabase
    .from('admins')
    .select('id, username, password, name, created_at, updated_at');

  if (fetchError) {
    console.error('Parent DB error:', fetchError.message);
    process.exit(1);
  }
  if (!admins?.length) {
    console.log('No admins found in parent DB.');
    process.exit(0);
  }

  console.log(`Found ${admins.length} admin(s). Copying to Brooklyn DB...`);

  for (const row of admins as AdminRow[]) {
    const { error: upsertError } = await brooklynSupabase
      .from('admins')
      .upsert(
        {
          id: row.id,
          username: row.username,
          password: row.password,
          name: row.name ?? null,
          created_at: row.created_at,
          updated_at: row.updated_at,
        },
        { onConflict: 'id' }
      );

    if (upsertError) {
      console.error(`Failed to upsert admin "${row.username}" (${row.id}):`, upsertError.message);
    } else {
      console.log(`  ✓ ${row.username} (${row.name ?? row.id})`);
    }
  }

  console.log('Done. Admins in Brooklyn DB can log in with the same usernames and passwords as in the parent.');
}

main();
