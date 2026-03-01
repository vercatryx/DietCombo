/**
 * Verify day-specific items show for Monday March 9, 2026, including "ACAI W GRANOLA & MANGO & KIVI".
 * 1) Queries meal_planner_custom_items for 2026-03-09 (default template).
 * 2) Calls getCombinedMenuItemsForDate('2026-03-09', null) and checks ACAI is in the result.
 *
 * Run: npm run verify-meal-plan-mar9-acai
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

const TARGET_DATE = '2026-03-09';
const ACAI_DAY_ITEM = 'ACAI W GRANOLA & MANGO & KIVI';
const ACAI_PATTERN = /acai.*granola.*mango|acai w granola/i;

async function main() {
  console.log('--- 1. Day-specific items in DB for', TARGET_DATE, '(client_id IS NULL) ---');
  const { data: customRows, error: customErr } = await supabase
    .from('meal_planner_custom_items')
    .select('id, name, quantity, value, sort_order')
    .eq('calendar_date', TARGET_DATE)
    .is('client_id', null)
    .order('sort_order', { ascending: true });

  if (customErr) {
    console.error('meal_planner_custom_items query error:', customErr.message);
    process.exit(2);
  }

  const dayNames = (customRows ?? []).map((r: any) => r.name);
  const hasAcaiInDb = dayNames.some((n) => (n && String(n).trim().toUpperCase() === ACAI_DAY_ITEM.toUpperCase()) || ACAI_PATTERN.test(n || ''));
  console.log('Row count:', (customRows ?? []).length);
  console.log('Names:', dayNames);
  console.log('Contains "' + ACAI_DAY_ITEM + '" (DB):', hasAcaiInDb);

  console.log('\n--- 2. Combined menu (getCombinedMenuItemsForDate) ---');
  const { getCombinedMenuItemsForDate } = await import('../lib/actions');
  const combined = await getCombinedMenuItemsForDate(TARGET_DATE, null);
  const combinedNames = combined.map((i) => i.name);
  const foundDayItem = combined.find((i) => i.name && String(i.name).trim().toUpperCase() === ACAI_DAY_ITEM.toUpperCase());
  const acaiInCombined = !!foundDayItem;
  console.log('Combined item count:', combined.length);
  console.log('Contains "' + ACAI_DAY_ITEM + '" (combined):', acaiInCombined);
  if (foundDayItem) {
    console.log('Found day-specific item:', foundDayItem.name, 'qty=', foundDayItem.quantity);
  }

  const ok = hasAcaiInDb && acaiInCombined;
  if (ok) {
    console.log('\nOK: "' + ACAI_DAY_ITEM + '" is in DB and in combined list for Mon Mar 9.');
    process.exit(0);
  } else {
    if (!hasAcaiInDb) console.log('\nFAIL: Day-specific item not in meal_planner_custom_items for', TARGET_DATE);
    if (!acaiInCombined) console.log('\nFAIL: Day-specific item not in getCombinedMenuItemsForDate result.');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
