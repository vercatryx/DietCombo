/**
 * Debug script: why does the client portal show zero food items?
 *
 * Run from project root:
 *   npm run debug-portal-food [clientId]
 *
 * Default clientId: 70e5781b-2aba-408e-93ce-cad877662e79
 *
 * Uses the real fromStoredUpcomingOrder from lib so we test the exact portal path.
 */

import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { fromStoredUpcomingOrder } from '../lib/upcoming-order-schema';

// Load .env.local
try {
  const envConfig = readFileSync('.env.local', 'utf8');
  envConfig.split('\n').forEach((line) => {
    const [key, ...values] = line.split('=');
    if (key && values.length > 0) {
      const value = values.join('=').trim();
      process.env[key.trim()] = value.replace(/^["']|["']$/g, '');
    }
  });
} catch (e) {
  dotenv.config({ path: '.env.local' });
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or Supabase key in .env.local');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const CLIENT_ID = process.argv[2] || '70e5781b-2aba-408e-93ce-cad877662e79';

// --- Helpers matching ClientPortalInterface / mapClientFromDB ---
function countItemsInOrder(order: any): { vendorSelections: number; deliveryDayOrders: number; totalItemEntries: number } {
  let totalItemEntries = 0;
  const vs = order?.vendorSelections ?? order?.vendor_selections;
  let vendorSelections = 0;
  if (Array.isArray(vs)) {
    vendorSelections = vs.length;
    vs.forEach((s: any) => {
      const items = s?.items ?? {};
      if (items && typeof items === 'object') totalItemEntries += Object.keys(items).length;
    });
  }
  const ddo = order?.deliveryDayOrders ?? order?.delivery_day_orders;
  let deliveryDayOrders = 0;
  if (ddo && typeof ddo === 'object') {
    deliveryDayOrders = Object.keys(ddo).length;
    Object.values(ddo).forEach((d: any) => {
      const sel = d?.vendorSelections ?? d?.vendor_selections ?? [];
      sel.forEach((s: any) => {
        const items = s?.items ?? {};
        if (items && typeof items === 'object') totalItemEntries += Object.keys(items).length;
      });
    });
  }
  return { vendorSelections, deliveryDayOrders, totalItemEntries };
}

function hasOrderDetailsInOrder(order: any): boolean {
  if (!order || typeof order !== 'object') return false;
  const vs = order.vendorSelections ?? order.vendor_selections;
  if (Array.isArray(vs) && vs.some((s: any) => s?.items && typeof s.items === 'object' && Object.keys(s.items).length > 0))
    return true;
  const ddo = order.deliveryDayOrders ?? order.delivery_day_orders;
  if (ddo && typeof ddo === 'object' && Object.values(ddo).some((d: any) => (d?.vendorSelections || d?.vendor_selections || []).some((s: any) => s?.items && Object.keys(s.items || {}).length > 0)))
    return true;
  return false;
}

async function main() {
  console.log('========================================');
  console.log('CLIENT PORTAL FOOD DEBUG');
  console.log('========================================');
  console.log('Client ID:', CLIENT_ID);
  console.log('');

  // 1. Fetch client row
  const { data: clientRow, error: clientError } = await supabase
    .from('clients')
    .select('id, full_name, service_type, upcoming_order')
    .eq('id', CLIENT_ID)
    .maybeSingle();

  if (clientError) {
    console.error('Error fetching client:', clientError);
    process.exit(1);
  }
  if (!clientRow) {
    console.error('Client not found.');
    process.exit(1);
  }

  console.log('--- 1. CLIENT ROW ---');
  console.log('id:', clientRow.id);
  console.log('full_name:', clientRow.full_name);
  console.log('service_type:', clientRow.service_type);
  const rawUpcoming = clientRow.upcoming_order;
  console.log('upcoming_order (raw) type:', rawUpcoming == null ? 'null/undefined' : typeof rawUpcoming);
  if (rawUpcoming != null) {
    const rawStr = JSON.stringify(rawUpcoming);
    console.log('upcoming_order (raw) length:', rawStr.length);
    console.log('upcoming_order (raw) preview:', rawStr.slice(0, 500) + (rawStr.length > 500 ? '...' : ''));
    const counts = countItemsInOrder(rawUpcoming);
    console.log('upcoming_order item counts:', counts);
  } else {
    console.log('upcoming_order: null or undefined (empty in DB)');
  }
  console.log('');

  // 2. Hydrated activeOrder using REAL fromStoredUpcomingOrder (same as getClient / portal)
  const serviceTypeForHydration = (clientRow.service_type || 'Food') as 'Food' | 'Meal';
  const hydrated = fromStoredUpcomingOrder(rawUpcoming ?? {}, serviceTypeForHydration);
  const sourceOrder = hydrated ?? (typeof rawUpcoming === 'object' && rawUpcoming !== null ? rawUpcoming : null);
  console.log('--- 2. SOURCE ORDER (fromStoredUpcomingOrder = what getClient / portal uses) ---');
  if (sourceOrder == null) {
    console.log('sourceOrder: null (fromStoredUpcomingOrder returned null; portal would use "default" path)');
  } else {
    console.log('sourceOrder keys:', Object.keys(sourceOrder));
    const counts = countItemsInOrder(sourceOrder);
    console.log('sourceOrder item counts:', counts);
    console.log('hasOrderDetailsInOrder(sourceOrder):', hasOrderDetailsInOrder(sourceOrder));
    if (counts.totalItemEntries === 0 && rawUpcoming && typeof rawUpcoming === 'object') {
      console.log('>>> WARNING: Raw DB has data but hydrated has 0 items (multi-day or snake_case not handled?)');
    }
  }
  console.log('');

  // 3. Default order template from settings
  const { data: settingsRow, error: settingsError } = await supabase
    .from('settings')
    .select('value')
    .eq('key', 'default_order_template')
    .maybeSingle();

  if (settingsError) {
    console.error('Error fetching default_order_template:', settingsError);
  } else if (!settingsRow?.value) {
    console.log('--- 3. DEFAULT ORDER TEMPLATE ---');
    console.log('No row or empty value for key default_order_template.');
    console.log('Portal cannot show default items if template is missing.');
  } else {
    let allTemplates: any = settingsRow.value;
    if (typeof allTemplates === 'string') {
      try {
        allTemplates = JSON.parse(allTemplates);
      } catch (e) {
        console.log('--- 3. DEFAULT ORDER TEMPLATE ---');
        console.log('settings.value is string but not valid JSON.');
        allTemplates = null;
      }
    }
    console.log('--- 3. DEFAULT ORDER TEMPLATE ---');
    console.log('Top-level keys:', allTemplates && typeof allTemplates === 'object' ? Object.keys(allTemplates) : 'N/A');
    const foodTemplate = allTemplates?.Food ?? (allTemplates?.serviceType === 'Food' ? allTemplates : null);
    if (foodTemplate) {
      const counts = countItemsInOrder(foodTemplate);
      console.log('Food template item counts:', counts);
      console.log('Food template vendorSelections length:', foodTemplate.vendorSelections?.length ?? foodTemplate.vendor_selections?.length ?? 0);
      console.log('Food template deliveryDayOrders keys:', foodTemplate.deliveryDayOrders ? Object.keys(foodTemplate.deliveryDayOrders) : foodTemplate.delivery_day_orders ? Object.keys(foodTemplate.delivery_day_orders) : []);
    } else {
      console.log('Food template: NOT FOUND (no allTemplates.Food and no allTemplates.serviceType === "Food")');
    }
  }
  console.log('');

  // 4. Portal logic simulation
  console.log('--- 4. PORTAL LOGIC SIMULATION ---');
  const useOnlyClientUpcomingOrder = true;
  const serviceType = clientRow.service_type || 'Food';
  const hasNoOrderData = !sourceOrder || !hasOrderDetailsInOrder(sourceOrder);
  const shouldApplyDefaultTemplate = useOnlyClientUpcomingOrder && serviceType === 'Food' && hasNoOrderData;
  console.log('useOnlyClientUpcomingOrder:', useOnlyClientUpcomingOrder);
  console.log('client.serviceType:', serviceType);
  console.log('sourceOrder is null?:', sourceOrder == null);
  console.log('hasOrderDetailsInOrder(sourceOrder):', sourceOrder != null ? hasOrderDetailsInOrder(sourceOrder) : 'N/A');
  console.log('hasNoOrderData:', hasNoOrderData);
  console.log('shouldApplyDefaultTemplate:', shouldApplyDefaultTemplate);
  console.log('');
  console.log('--- 5. DIAGNOSIS ---');
  if (sourceOrder != null && hasOrderDetailsInOrder(sourceOrder)) {
    const c = countItemsInOrder(sourceOrder);
    if (c.totalItemEntries === 0) {
      console.log('Source order exists but has 0 item entries. Check hydration (camelCase vs snake_case).');
    } else {
      console.log('Source order has', c.totalItemEntries, 'item entries. Portal should show them unless UI filter is wrong.');
    }
  } else if (shouldApplyDefaultTemplate) {
    if (!settingsRow?.value) {
      console.log('Portal would try to apply default template but settings.default_order_template is missing → stays zero.');
    } else {
      const allT = typeof settingsRow.value === 'string' ? JSON.parse(settingsRow.value) : settingsRow.value;
      const foodT = allT?.Food ?? (allT?.serviceType === 'Food' ? allT : null);
      if (!foodT || countItemsInOrder(foodT).totalItemEntries === 0) {
        console.log('Portal would apply default template but Food template is missing or has 0 items → stays zero.');
      } else {
        console.log('Portal should load default template with', countItemsInOrder(foodT).totalItemEntries, 'items. If still zero, check: sync cache, effect overwriting, or single-vendor effect.');
      }
    }
  } else {
    console.log('Portal would not apply default (hasNoOrderData=false or serviceType != Food). Config would be empty → zero.');
  }
  // 6. Menu items: do the item IDs in the order exist and match vendor?
  console.log('--- 6. MENU ITEMS (do order item IDs exist?) ---');
  const itemIdsInOrder: string[] = [];
  if (sourceOrder) {
    const vs = sourceOrder.vendorSelections ?? sourceOrder.vendor_selections ?? [];
    vs.forEach((s: any) => {
      Object.keys(s?.items ?? {}).forEach((id) => itemIdsInOrder.push(id));
    });
    const ddo = sourceOrder.deliveryDayOrders ?? sourceOrder.delivery_day_orders ?? {};
    Object.values(ddo).forEach((d: any) => {
      (d?.vendorSelections ?? d?.vendor_selections ?? []).forEach((s: any) => {
        Object.keys(s?.items ?? {}).forEach((id) => itemIdsInOrder.push(id));
      });
    });
  }
  const uniqueIds = [...new Set(itemIdsInOrder)];
  console.log('Unique menu item IDs in order:', uniqueIds.length, uniqueIds.slice(0, 10).join(', ') + (uniqueIds.length > 10 ? '...' : ''));
  const ddo = sourceOrder?.deliveryDayOrders ?? sourceOrder?.delivery_day_orders;
  const firstDaySel: any = ddo && typeof ddo === 'object' ? Object.values(ddo)[0] : null;
  const orderVendorId = sourceOrder?.vendorSelections?.[0]?.vendorId ?? (firstDaySel?.vendorSelections?.[0] ?? firstDaySel?.vendor_selections?.[0])?.vendorId ?? null;
  if (orderVendorId) console.log('Order vendorId (first selection):', orderVendorId);
  if (uniqueIds.length > 0) {
    const { data: menuRows } = await supabase.from('menu_items').select('id, name, vendor_id, is_active').in('id', uniqueIds);
    const foundIds = new Set((menuRows ?? []).map((r: any) => r.id));
    const missing = uniqueIds.filter((id) => !foundIds.has(id));
    const inactive = (menuRows ?? []).filter((r: any) => r.is_active === false).map((r: any) => r.id);
    const wrongVendor = orderVendorId ? (menuRows ?? []).filter((r: any) => r.vendor_id !== orderVendorId) : [];
    console.log('Found in menu_items:', foundIds.size, '/', uniqueIds.length);
    if (missing.length > 0) console.log('Missing IDs (will show as zero/unknown):', missing.slice(0, 15).join(', ') + (missing.length > 15 ? '...' : ''));
    if (inactive.length > 0) console.log('Inactive menu_items (filtered out by getVendorMenuItems):', inactive.slice(0, 15).join(', ') + (inactive.length > 15 ? '...' : ''));
    if (wrongVendor.length > 0) console.log('Items with different vendor_id than order (getVendorMenuItems filters by vendor → these hidden):', wrongVendor.map((r: any) => r.id).join(', '));
    const visibleCount = (menuRows ?? []).filter((r: any) => r.is_active !== false && (!orderVendorId || r.vendor_id === orderVendorId)).length;
    console.log('Items that would show in portal for this vendor:', visibleCount);
  }
  console.log('');
  // Final pass/fail: after fix, hydrated config should have items when raw has them
  const rawCounts = countItemsInOrder(rawUpcoming ?? {});
  const hydratedCounts = sourceOrder ? countItemsInOrder(sourceOrder) : { totalItemEntries: 0 };
  if (rawCounts.totalItemEntries > 0 && hydratedCounts.totalItemEntries === 0) {
    console.log('*** FAIL: Raw order has', rawCounts.totalItemEntries, 'items but hydrated has 0. Portal will show zero.');
  } else if (hydratedCounts.totalItemEntries > 0) {
    console.log('*** PASS: Hydrated config has', hydratedCounts.totalItemEntries, 'item entries. Portal should show them.');
  } else {
    console.log('*** No items in raw order; portal will show default or empty.');
  }
  console.log('Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
