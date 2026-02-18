/**
 * Diagnose why create-expired-meal-planner-orders did not create an order
 * for a specific client. Default: client 1787dd60-a411-4491-bb08-19c2ade7bb91, date 2026-02-19.
 *
 * Run (from project root):
 *   npx ts-node --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' scripts/diagnose-expired-order-client.ts
 * Or with a custom expiration date (the date param you passed to the API):
 *   EXPIRATION_DATE=2026-02-18 npx ts-node --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' scripts/diagnose-expired-order-client.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as path from 'path';
import * as fs from 'fs';

const CLIENT_ID = process.env.CLIENT_ID || '1787dd60-a411-4491-bb08-19c2ade7bb91';
const DELIVERY_DATE = process.env.DELIVERY_DATE || '2026-02-19';
// Expiration date that would have been used when calling the API (e.g. day before delivery or same day)
const EXPIRATION_DATE = process.env.EXPIRATION_DATE || DELIVERY_DATE;

function loadEnv(): Record<string, string> {
    const envPath = path.resolve(process.cwd(), '.env.local');
    try {
        const envFile = fs.readFileSync(envPath, 'utf8');
        const env: Record<string, string> = {};
        envFile.split('\n').forEach((line) => {
            const [key, ...values] = line.split('=');
            if (key && values.length > 0) {
                env[key.trim()] = values.join('=').trim().replace(/^["']|["']$/g, '');
            }
        });
        return env;
    } catch (e) {
        console.error('Failed to load .env.local:', e);
        process.exit(1);
    }
}

function main() {
    const env = loadEnv();
    const url = env['NEXT_PUBLIC_SUPABASE_URL'];
    const serviceKey = env['SUPABASE_SERVICE_ROLE_KEY'];
    if (!url || !serviceKey) {
        console.error('Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local');
        process.exit(1);
    }

    const supabase = createClient(url, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
    });

    run(supabase as any).then(
        () => process.exit(0),
        (err) => {
            console.error(err);
            process.exit(1);
        }
    );
}

async function run(supabase: any) {
    console.log('=== Diagnose: why no order for this client? ===\n');
    console.log('Client ID:', CLIENT_ID);
    console.log('Delivery date (scheduled_delivery_date):', DELIVERY_DATE);
    console.log('Expiration date (API ?date= param):', EXPIRATION_DATE);
    console.log('');

    const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const deliveryDay = dayNames[new Date(DELIVERY_DATE + 'T12:00:00').getDay()];
    console.log('Delivery day of week:', deliveryDay);
    console.log('');

    // 1. Fetch client
    const { data: clientRow, error: clientErr } = await supabase
        .from('clients')
        .select('*')
        .eq('id', CLIENT_ID)
        .maybeSingle();

    if (clientErr) {
        console.error('Failed to fetch client:', clientErr.message);
        return;
    }
    if (!clientRow) {
        console.log('RESULT: Client not found in database.');
        return;
    }

    const row = clientRow as any;
    const serviceType = row.service_type || 'Food';
    const paused = row.paused ?? false;
    const delivery = row.delivery ?? true;
    const mealPlannerData = row.meal_planner_data ?? null;
    const upcomingOrder = row.upcoming_order || null;

    console.log('--- 1. Client eligibility (foodClients filter) ---');
    console.log('Full name:', row.full_name);
    console.log('Service type:', serviceType);
    console.log('Paused:', paused);
    console.log('Delivery enabled:', delivery);

    const isFood = serviceType === 'Food' || (serviceType && String(serviceType).includes('Food'));
    const wouldBeInFoodClients = isFood && !paused && delivery;

    if (!isFood) {
        console.log('\nRESULT: Client is NOT a Food client. They are excluded before any order logic. No order created.');
        return;
    }
    if (paused) {
        console.log('\nRESULT: Client is PAUSED. They are excluded. No order created.');
        return;
    }
    if (!delivery) {
        console.log('\nRESULT: Delivery is DISABLED for this client. They are excluded. No order created.');
        return;
    }
    console.log('=> Client passes foodClients filter.\n');

    // 2. Is 2026-02-19 in expiredDates? (Would require default template to have that calendar_date with this expiration_date)
    const { data: expiredItems, error: expiredErr } = await supabase
        .from('meal_planner_custom_items')
        .select('calendar_date, expiration_date, name, quantity')
        .is('client_id', null)
        .eq('expiration_date', EXPIRATION_DATE)
        .order('calendar_date', { ascending: true });

    if (expiredErr) {
        console.error('Failed to fetch expired items:', expiredErr.message);
        return;
    }

    const expiredDates = !expiredItems?.length
        ? []
        : [...new Set(expiredItems.map((r: any) => String(r.calendar_date).slice(0, 10)))];
    const dateInExpiredDates = expiredDates.includes(DELIVERY_DATE);

    console.log('--- 2. Was this delivery date in expiredDates? ---');
    console.log('Expiration date used:', EXPIRATION_DATE);
    console.log('Default template items expiring on that date:', expiredItems?.length ?? 0);
    console.log('expiredDates (delivery dates that were processed):', expiredDates.join(', ') || '(none)');
    console.log('Is', DELIVERY_DATE, 'in expiredDates?', dateInExpiredDates);
    if (!dateInExpiredDates) {
        console.log('\nRESULT: This delivery date was NOT in the list of expired dates. The API only creates orders for dates that appear in the DEFAULT meal planner (admin calendar) with expiration_date =', EXPIRATION_DATE + '. Add', DELIVERY_DATE, 'to the default template with that expiration date and re-run the API.');
        return;
    }
    console.log('');

    // 3. Existing order?
    const { data: existingOrders } = await supabase
        .from('orders')
        .select('id, order_number, status')
        .eq('client_id', CLIENT_ID)
        .eq('scheduled_delivery_date', DELIVERY_DATE)
        .eq('service_type', 'Food');

    const orderExists = existingOrders && existingOrders.length > 0;
    console.log('--- 3. Existing order for this client + date? ---');
    if (orderExists) {
        console.log('YES. Existing order(s):', existingOrders!.map((o: any) => ({ id: o.id, order_number: o.order_number, status: o.status })));
        console.log('\nRESULT: An order already exists for this client and', DELIVERY_DATE + '. The API skips to avoid duplicates.');
        return;
    }
    console.log('No existing order.');
    console.log('');

    // 4. Client meal planner data for this date
    console.log('--- 4. Client meal_planner_data for this date ---');
    const raw = Array.isArray(mealPlannerData) ? mealPlannerData : null;
    if (!raw) {
        console.log('meal_planner_data is null or not an array.');
    } else {
        console.log('Number of entries in meal_planner_data:', raw.length);
        const entryForDate = raw.find(
            (e: any) => String(e?.scheduledDeliveryDate ?? e?.scheduled_delivery_date ?? '').slice(0, 10) === DELIVERY_DATE
        );
        if (!entryForDate) {
            console.log('No entry with scheduledDeliveryDate/scheduled_delivery_date =', DELIVERY_DATE);
        } else {
            const items = Array.isArray(entryForDate.items) ? entryForDate.items : [];
            console.log('Entry for', DELIVERY_DATE, 'found. Items count:', items.length);
            if (items.length > 0) {
                console.log('Items:', JSON.stringify(items.map((i: any) => ({ name: i?.name, quantity: i?.quantity })), null, 2));
            }
        }
    }

    // Build clientItems the same way the API does
    let clientItems: { name: string; quantity: number }[] = [];
    if (raw) {
        for (const entry of raw) {
            const d = String(entry?.scheduledDeliveryDate ?? entry?.scheduled_delivery_date ?? '').slice(0, 10);
            if (d !== DELIVERY_DATE || !expiredDates.includes(d)) continue;
            const items = Array.isArray(entry?.items) ? entry.items : [];
            if (items.length === 0) continue;
            clientItems = items.map((it: any) => ({
                name: ((it?.name ?? 'Item').trim() || 'Item') as string,
                quantity: Number(it?.quantity) ?? 1,
            }));
            break;
        }
    }
    console.log('Parsed clientItems for API logic:', clientItems.length, 'items');
    console.log('');

    // 5. Default items for this date
    const { data: defaultRows } = await supabase
        .from('meal_planner_custom_items')
        .select('name, quantity')
        .is('client_id', null)
        .eq('calendar_date', DELIVERY_DATE)
        .order('sort_order', { ascending: true });
    const defaultItems = (defaultRows || []).map((r: any) => ({ name: r.name, quantity: r.quantity ?? 1 }));
    console.log('--- 5. Default meal planner items for', DELIVERY_DATE, '---');
    console.log('Count:', defaultItems.length);
    if (defaultItems.length) console.log('Items:', defaultItems.map((i: { name: string; quantity: number }) => i.name + ' x' + i.quantity).join(', '));
    console.log('');

    // 6. Default template (Food) for vendor selections fallback
    const { data: settingsRow } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'default_order_template')
        .maybeSingle();
    let defaultTemplate: any = null;
    const sr = settingsRow as any;
    if (sr?.value != null) {
        const val = sr.value;
        const parsed = typeof val === 'string' ? (() => { try { return JSON.parse(val); } catch { return null; } })() : val;
        if (parsed?.serviceType === 'Food') defaultTemplate = parsed;
        else if (parsed?.Food) defaultTemplate = parsed.Food;
    }
    const hasDeliveryDayOrders = defaultTemplate?.deliveryDayOrders && Object.keys(defaultTemplate.deliveryDayOrders).length > 0;
    const hasTopLevelVendorSelections = Array.isArray(defaultTemplate?.vendorSelections) && defaultTemplate.vendorSelections.length > 0;
    const fallbackVsFromTemplate =
        hasDeliveryDayOrders && defaultTemplate.deliveryDayOrders[deliveryDay]
            ? (defaultTemplate.deliveryDayOrders[deliveryDay].vendorSelections || [])
            : hasDeliveryDayOrders
                ? (defaultTemplate.deliveryDayOrders[Object.keys(defaultTemplate.deliveryDayOrders)[0]]?.vendorSelections || [])
                : hasTopLevelVendorSelections
                    ? defaultTemplate.vendorSelections
                    : [];

    console.log('--- 6. Vendor selections (fallback from client or default template) ---');
    const ao = upcomingOrder && typeof upcomingOrder === 'object' ? upcomingOrder : {};
    const hasClientVs = (ao.vendorSelections && ao.vendorSelections.length > 0) || (ao.deliveryDayOrders && Object.keys(ao.deliveryDayOrders).length > 0);
    console.log('Client activeOrder has vendorSelections or deliveryDayOrders?', hasClientVs);
    if (hasClientVs && ao.deliveryDayOrders?.[deliveryDay]) {
        console.log('Client deliveryDayOrders[' + deliveryDay + ']:', ao.deliveryDayOrders[deliveryDay]?.vendorSelections?.length ?? 0, 'selections');
    } else if (hasClientVs && ao.deliveryDayOrders) {
        const first = Object.keys(ao.deliveryDayOrders)[0];
        console.log('Client has deliveryDayOrders but not for', deliveryDay, '; first day fallback:', first);
    }
    console.log('Default template has deliveryDayOrders?', hasDeliveryDayOrders);
    console.log('Default template has top-level vendorSelections?', hasTopLevelVendorSelections);
    console.log('Vendor selections that would be used as fallback:', fallbackVsFromTemplate.length, 'selections');
    console.log('');

    // 7. Would we build vendorSelections from clientItems?
    const { data: menuRows } = await supabase.from('menu_items').select('id, name');
    const menuItems = (menuRows || []) as any[];
    const nameToMenu = new Map<string, any>(menuItems.map((m: any) => [String(m.name || '').trim().toLowerCase(), m]));
    const itemsByMenuId: Record<string, number> = {};
    const customItems: { name: string; quantity: number }[] = [];
    for (const item of clientItems) {
        const name = (item.name || '').trim();
        const qty = Math.max(0, Number(item.quantity) ?? 0);
        if (qty === 0) continue;
        const menuItem = nameToMenu.get(name.toLowerCase()) as any;
        if (menuItem) itemsByMenuId[menuItem.id] = (itemsByMenuId[menuItem.id] || 0) + qty;
        else customItems.push({ name: item.name || 'Item', quantity: qty });
    }
    const hasMenuMatches = Object.keys(itemsByMenuId).length > 0;
    const hasCustomItems = customItems.length > 0;
    const defaultVendorId = await getDefaultVendorId(supabase);
    const wouldSetVsFromMealPlan = (hasMenuMatches || hasCustomItems) && defaultVendorId;

    console.log('--- 7. Vendor selections from meal plan (clientItems) ---');
    console.log('Menu matches (by name):', hasMenuMatches, hasMenuMatches ? Object.keys(itemsByMenuId).length + ' items' : '');
    console.log('Custom items (no menu match):', hasCustomItems, hasCustomItems ? customItems.length + ' items' : '');
    console.log('Default vendor ID:', defaultVendorId ?? '(null)');
    console.log('Would set vendorSelections from meal plan?', wouldSetVsFromMealPlan);
    if (!wouldSetVsFromMealPlan && clientItems.length > 0 && !defaultVendorId) {
        console.log('  => defaultVendorId is null; API would still create one VS with empty items and use meal plan custom items.');
    }
    console.log('');

    // Final verdict
    const wouldHaveVendorSelections = wouldSetVsFromMealPlan || (clientItems.length > 0 && (hasMenuMatches || hasCustomItems)) || fallbackVsFromTemplate.length > 0;
    if (!wouldHaveVendorSelections) {
        console.log('RESULT: No vendor selections. The API would skip with:');
        console.log('  "Client', CLIENT_ID, '(...): No vendor selections or meal plan items for', DELIVERY_DATE + '"');
        console.log('');
        console.log('Likely cause:');
        if (clientItems.length === 0) {
            console.log('- Client meal_planner_data has no entry for', DELIVERY_DATE, 'with items (or was not saved when the API ran).');
        }
        console.log('- And client has no activeOrder vendor/delivery-day config, and default template has no vendor selections for', deliveryDay + '.');
        return;
    }

    console.log('All checks passed: client is Food, not paused, delivery on; date in expiredDates; no existing order; has meal plan items or fallback vendor selections.');
    console.log('RESULT: The API should have created an order. If it did not, possible causes:');
    console.log('  - meal_planner_data was different when the API ran (e.g. not yet saved).');
    console.log('  - Run the API again and check the response skippedReasons for this client ID.');
}

async function getDefaultVendorId(supabase: any): Promise<string | null> {
    const { data: vendors } = await supabase.from('vendors').select('id, is_default, is_active').order('is_default', { ascending: false });
    const list = (vendors || []) as any[];
    if (!list.length) return null;
    const def = list.find((v: any) => v.is_default === true);
    if (def) return def.id;
    const first = list.find((v: any) => v.is_active !== false) || list[0];
    return first?.id ?? null;
}

main();
