/**
 * Verify that settings.default_order_template has recurring (top) items for Food.
 * Run from project root:
 *   npm run verify-default-order-template
 *
 * Uses same env as debug-portal-food (.env.local, SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY).
 * Exits 0 if Food template has at least one recurring item; 1 otherwise.
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

function loadEnv() {
  try {
    const envConfig = readFileSync('.env.local', 'utf8');
    envConfig.split('\n').forEach((line) => {
      const [key, ...values] = line.split('=');
      if (key && values.length > 0) {
        const value = values.join('=').trim();
        process.env[key.trim()] = value.replace(/^["']|["']$/g, '');
      }
    });
  } catch {
    require('dotenv').config({ path: '.env.local' });
  }
}

loadEnv();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or Supabase key in .env.local');
  process.exit(2);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function getRecurringItems(allTemplates: any): Record<string, number> | null {
  if (!allTemplates || typeof allTemplates !== 'object') return null;
  // New format: keyed by service type { Food: { vendorSelections: [...] } }
  let food = allTemplates.Food ?? null;
  if (!food && allTemplates.serviceType === 'Food') food = allTemplates;
  if (!food) return null;
  const vs = food.vendorSelections ?? food.vendor_selections;
  if (!Array.isArray(vs) || vs.length === 0) return null;
  const items = vs[0]?.items ?? {};
  return typeof items === 'object' && !Array.isArray(items) ? items : null;
}

async function main() {
  const { data: row, error } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'default_order_template')
    .maybeSingle();

  if (error) {
    console.error('Failed to fetch default_order_template:', error.message);
    process.exit(2);
  }

  if (!row?.value) {
    console.error('No row or empty value for key default_order_template.');
    process.exit(1);
  }

  let allTemplates: any = row.value;
  if (typeof allTemplates === 'string') {
    try {
      allTemplates = JSON.parse(allTemplates);
    } catch (e) {
      console.error('settings.value is not valid JSON.');
      process.exit(1);
    }
  }

  const topLevelKeys = typeof allTemplates === 'object' && allTemplates !== null ? Object.keys(allTemplates) : [];
  console.log('default_order_template top-level keys:', topLevelKeys.join(', ') || '(none)');

  const items = getRecurringItems(allTemplates);
  if (!items || Object.keys(items).length === 0) {
    console.error('Recurring items (Food vendorSelections[0].items) missing or empty.');
    process.exit(1);
  }

  const totalQty = Object.values(items).reduce((s, q) => s + Number(q) || 0, 0);
  console.log('Recurring items count:', Object.keys(items).length, '| total quantity:', totalQty);
  console.log('Item IDs and quantities:', items);
  console.log('OK: default_order_template has recurring items.');
  process.exit(0);
}

main();
