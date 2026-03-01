/**
 * List all top/repeating items from the default order template (Food).
 * Pulls from both vendorSelections and deliveryDayOrders so nothing is missed.
 *
 * Run from project root:
 *   npm run list-default-order-template-recurring              # list only
 *   npm run list-default-order-template-recurring -- --reset-to-zero   # set all Food item quantities to 0 and save
 *   npm run list-default-order-template-recurring -- --remove-unnamed   # remove all items that have no name in menu_items
 *
 * Uses .env.local (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY).
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

function mergeItemsInto(acc: Record<string, number>, items: Record<string, unknown> | null | undefined) {
  if (!items || typeof items !== 'object' || Array.isArray(items)) return;
  for (const [id, qty] of Object.entries(items)) {
    const n = Number(qty);
    if (id != null && id !== '' && !Number.isNaN(n) && n >= 0) {
      acc[id] = Math.max(acc[id] ?? 0, n);
    }
  }
}

/** Pull all recurring (top) items from Food template: vendorSelections + deliveryDayOrders. */
function getAllRecurringItems(allTemplates: any): Record<string, number> {
  const merged: Record<string, number> = {};
  if (!allTemplates || typeof allTemplates !== 'object') return merged;

  const food = allTemplates.Food ?? (allTemplates.serviceType === 'Food' ? allTemplates : null);
  if (!food) return merged;

  const vs = food.vendorSelections ?? food.vendor_selections;
  if (Array.isArray(vs)) {
    for (const sel of vs) {
      mergeItemsInto(merged, sel?.items);
    }
  }

  const ddo = food.deliveryDayOrders ?? food.delivery_day_orders;
  if (ddo && typeof ddo === 'object') {
    for (const dayOrder of Object.values(ddo) as any[]) {
      const dayVs = dayOrder?.vendorSelections ?? dayOrder?.vendor_selections;
      if (Array.isArray(dayVs)) {
        for (const sel of dayVs) {
          mergeItemsInto(merged, sel?.items);
        }
      }
    }
  }

  return merged;
}

function zeroItemsInSelection(sel: any): void {
  if (!sel || typeof sel !== 'object') return;
  const items = sel.items;
  if (items && typeof items === 'object' && !Array.isArray(items)) {
    const ids = Object.keys(items);
    const zeroed: Record<string, number> = {};
    ids.forEach((id) => { zeroed[id] = 0; });
    sel.items = zeroed;
  }
}

/** Set every item quantity to 0 in Food template (vendorSelections and deliveryDayOrders). Mutates allTemplates. */
function resetFoodTemplateItemsToZero(allTemplates: any): void {
  if (!allTemplates || typeof allTemplates !== 'object') return;
  const food = allTemplates.Food ?? (allTemplates.serviceType === 'Food' ? allTemplates : null);
  if (!food) return;

  for (const key of ['vendorSelections', 'vendor_selections']) {
    const vs = food[key];
    if (Array.isArray(vs)) for (const sel of vs) zeroItemsInSelection(sel);
  }

  const ddo = food.deliveryDayOrders ?? food.delivery_day_orders;
  if (ddo && typeof ddo === 'object') {
    for (const dayOrder of Object.values(ddo) as any[]) {
      for (const key of ['vendorSelections', 'vendor_selections']) {
        const dayVs = (dayOrder as any)?.[key];
        if (Array.isArray(dayVs)) for (const sel of dayVs) zeroItemsInSelection(sel);
      }
    }
  }
}

/** Remove from Food template any item whose id is not in namedIds (not in menu_items). Mutates allTemplates. */
function removeUnnamedItemsFromFoodTemplate(allTemplates: any, namedIds: Set<string>): number {
  let removed = 0;
  if (!allTemplates || typeof allTemplates !== 'object') return removed;
  const food = allTemplates.Food ?? (allTemplates.serviceType === 'Food' ? allTemplates : null);
  if (!food) return removed;

  for (const key of ['vendorSelections', 'vendor_selections']) {
    const vs = food[key];
    if (Array.isArray(vs)) {
      for (const sel of vs) {
        if (!sel?.items || typeof sel.items !== 'object') continue;
        const before = Object.keys(sel.items).length;
        const kept: Record<string, number> = {};
        for (const [id, qty] of Object.entries(sel.items)) {
          if (namedIds.has(id)) kept[id] = Number(qty) ?? 0;
          else removed++;
        }
        sel.items = kept;
      }
    }
  }

  const ddo = food.deliveryDayOrders ?? food.delivery_day_orders;
  if (ddo && typeof ddo === 'object') {
    for (const dayOrder of Object.values(ddo) as any[]) {
      for (const key of ['vendorSelections', 'vendor_selections']) {
        const dayVs = (dayOrder as any)?.[key];
        if (Array.isArray(dayVs)) {
          for (const sel of dayVs) {
            if (!sel?.items || typeof sel.items !== 'object') continue;
            for (const [id] of Object.entries(sel.items)) {
              if (!namedIds.has(id)) removed++;
            }
            const kept: Record<string, number> = {};
            for (const [id, qty] of Object.entries(sel.items)) {
              if (namedIds.has(id)) kept[id] = Number(qty) ?? 0;
            }
            sel.items = kept;
          }
        }
      }
    }
  }
  return removed;
}

async function main() {
  const resetToZero = process.argv.includes('--reset-to-zero');
  const removeUnnamed = process.argv.includes('--remove-unnamed');
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

  const { data: menuRows } = await supabase.from('menu_items').select('id, name, vendor_id, sort_order');
  const menuList = (menuRows ?? []) as any[];
  const nameById: Record<string, string> = {};
  const namedIds = new Set<string>();
  const byVendor: Record<string, any[]> = {};
  for (const r of menuList) {
    const id = r?.id != null ? String(r.id) : null;
    const name = (r?.name ?? r?.title ?? '') as string;
    if (id) {
      nameById[id] = name;
      namedIds.add(id);
    }
    const vid = r?.vendor_id ?? r?.vendorId ?? null;
    if (vid != null) {
      if (!byVendor[vid]) byVendor[vid] = [];
      byVendor[vid].push(r);
    }
  }

  if (resetToZero) {
    resetFoodTemplateItemsToZero(allTemplates);
  }
  if (removeUnnamed) {
    const removed = removeUnnamedItemsFromFoodTemplate(allTemplates, namedIds);
    console.log('Removed', removed, 'item entry/entries with no name (not in menu_items).');
  }
  if (resetToZero || removeUnnamed) {
    const templateJson = JSON.stringify(allTemplates);
    const { error: updateError } = await supabase
      .from('settings')
      .update({ value: templateJson })
      .eq('key', 'default_order_template');
    if (updateError) {
      console.error('Failed to save template:', updateError.message);
      process.exit(2);
    }
    if (resetToZero) console.log('All Food template item quantities have been set to 0 and saved.');
    console.log('');
  }

  const items = getAllRecurringItems(allTemplates);
  const food = allTemplates?.Food ?? (allTemplates?.serviceType === 'Food' ? allTemplates : null);
  const vs = food?.vendorSelections ?? food?.vendor_selections;
  const templateVendorId = Array.isArray(vs) && vs[0] != null ? (vs[0]?.vendorId ?? vs[0]?.vendor_id ?? null) : null;

  const vendorIds = Object.keys(byVendor);
  const defaultVendorId = templateVendorId && byVendor[templateVendorId]
    ? templateVendorId
    : vendorIds[0] ?? null;
  const rowsToShow = defaultVendorId && byVendor[defaultVendorId]
    ? [...byVendor[defaultVendorId]].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
    : menuList;

  const seenIds = new Set<string>();
  const lines: { id: string; name: string; qty: number }[] = [];
  for (const r of rowsToShow) {
    const id = r?.id != null ? String(r.id) : null;
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);
    const name = nameById[id] ?? '(no name)';
    const qty = id in items ? items[id] : 0;
    lines.push({ id, name, qty });
  }
  const templateOnlyIds = Object.keys(items).filter((id) => !seenIds.has(id));
  for (const id of templateOnlyIds.sort()) {
    seenIds.add(id);
    lines.push({ id, name: nameById[id] ?? '(no name)', qty: items[id] });
  }
  const totalQty = lines.reduce((s, l) => s + l.qty, 0);
  console.log('--- Default order template (Food): top/repeating items ---');
  console.log('Total items:', lines.length, '| Total quantity:', totalQty);
  if (templateVendorId) console.log('Template vendor id:', templateVendorId);
  console.log('');
  console.log('id\tname\tquantity');
  console.log('--\t----\t--------');
  for (const { id, name, qty } of lines) {
    console.log(`${id}\t${name}\t${qty}`);
  }
  console.log('');
  console.log('Done.');
}

main();
