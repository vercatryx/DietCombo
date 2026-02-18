/**
 * Preview what would be in an order for a client + delivery date if we ran
 * create-expired-meal-planner-orders now (with the fixed logic: no double menu+custom).
 * Does NOT write to DB.
 *
 * Usage:
 *   CLIENT_ID=86060f23-f069-43d8-b19f-f992b2acb1d1 DELIVERY_DATE=2026-02-19 npm run preview-order-for-client-date
 */

import { createClient } from '@supabase/supabase-js';
import * as path from 'path';
import * as fs from 'fs';

const CLIENT_ID = process.env.CLIENT_ID || '86060f23-f069-43d8-b19f-f992b2acb1d1';
const DELIVERY_DATE = process.env.DELIVERY_DATE || '2026-02-19';

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

async function getDefaultVendorId(supabase: any): Promise<string | null> {
    const { data: vendors } = await supabase
        .from('vendors')
        .select('id, is_default, is_active')
        .order('is_default', { ascending: false });
    const list = (vendors || []) as any[];
    if (!list.length) return null;
    const def = list.find((v: any) => v.is_default === true);
    if (def) return def.id;
    const first = list.find((v: any) => v.is_active !== false) || list[0];
    return first?.id ?? null;
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
    console.log('=== Preview: what would be in the order now (fixed logic) ===\n');
    console.log('Client ID:', CLIENT_ID);
    console.log('Delivery date:', DELIVERY_DATE);
    console.log('');

    const { data: clientRow, error: clientErr } = await supabase
        .from('clients')
        .select('id, full_name, meal_planner_data, upcoming_order, service_type, paused, delivery')
        .eq('id', CLIENT_ID)
        .maybeSingle();

    if (clientErr || !clientRow) {
        console.error('Client not found or error:', (clientRow as any)?.message || clientErr?.message);
        return;
    }
    const c = clientRow as any;
    const raw = Array.isArray(c.meal_planner_data) ? c.meal_planner_data : null;
    let clientItems: { name: string; quantity: number }[] = [];
    if (raw) {
        for (const entry of raw) {
            const d = String(entry?.scheduledDeliveryDate ?? entry?.scheduled_delivery_date ?? '').slice(0, 10);
            if (d !== DELIVERY_DATE) continue;
            const items = Array.isArray(entry?.items) ? entry.items : [];
            if (items.length === 0) break;
            clientItems = items.map((it: any) => ({
                name: ((it?.name ?? 'Item').trim() || 'Item') as string,
                quantity: Math.max(0, Number(it?.quantity) ?? 1),
            }));
            break;
        }
    }

    const { data: defaultRows } = await supabase
        .from('meal_planner_custom_items')
        .select('name, quantity')
        .is('client_id', null)
        .eq('calendar_date', DELIVERY_DATE)
        .order('sort_order', { ascending: true });
    const defaultItems = (defaultRows || []).map((r: any) => ({ name: r.name, quantity: r.quantity ?? 1 }));

    const mealPlanMap = new Map<string, { name: string; quantity: number }>();
    for (const i of defaultItems) mealPlanMap.set(i.name, i);
    for (const i of clientItems) mealPlanMap.set(i.name, i);

    const { data: menuRows } = await supabase.from('menu_items').select('id, name, value, price_each');
    const menuItems = (menuRows || []) as any[];
    const nameToMenu = new Map<string, any>(menuItems.map((m: any) => [String(m.name || '').trim().toLowerCase(), m]));

    const itemsByMenuId: Record<string, number> = {};
    const customItems: { name: string; quantity: number }[] = [];
    for (const item of clientItems) {
        const name = (item.name || '').trim();
        const qty = Math.max(0, Number(item.quantity) ?? 0);
        if (qty === 0) continue;
        const menuItem = nameToMenu.get(name.toLowerCase());
        if (menuItem) {
            itemsByMenuId[menuItem.id] = (itemsByMenuId[menuItem.id] || 0) + qty;
        } else {
            customItems.push({ name: item.name || 'Item', quantity: qty });
        }
    }
    for (const item of defaultItems) {
        if (mealPlanMap.get(item.name) !== item) continue;
        const name = (item.name || '').trim();
        const qty = Math.max(0, Number(item.quantity) ?? 0);
        if (qty === 0) continue;
        const menuItem = nameToMenu.get(name.toLowerCase());
        if (menuItem && !itemsByMenuId[menuItem.id]) {
            itemsByMenuId[menuItem.id] = qty;
        } else if (!menuItem) {
            customItems.push({ name: item.name || 'Item', quantity: qty });
        }
    }

    const mealPlanCustomOnly = customItems.filter(
        (c) => (c.name || '').trim().toLowerCase() !== 'item'
    );
    const defaultVendorId = await getDefaultVendorId(supabase);

    const hasContent = Object.keys(itemsByMenuId).length > 0 || mealPlanCustomOnly.length > 0;
    if (!hasContent) {
        console.log('No items would be in the order (no client meal plan for this date or no vendor/default items).');
        return;
    }

    const menuById = new Map(menuItems.map((m: any) => [m.id, m]));
    let totalValue = 0;
    let totalItems = 0;

    console.log('--- What would be in the order now ---\n');
    console.log('Menu items (from meal plan, name matched to menu):');
    for (const [itemId, qty] of Object.entries(itemsByMenuId)) {
        const menuItem = menuById.get(itemId) as any;
        const name = menuItem?.name ?? itemId;
        const price = menuItem?.priceEach ?? menuItem?.value ?? 0;
        totalValue += price * qty;
        totalItems += qty;
        console.log('  -', name + ':', qty, '(menu_item_id:', itemId + ')');
    }
    if (mealPlanCustomOnly.length > 0) {
        console.log('\nCustom items (from meal plan, no menu match):');
        for (const item of mealPlanCustomOnly) {
            totalItems += item.quantity;
            console.log('  -', item.name + ':', item.quantity);
        }
    }
    console.log('\n--- Summary ---');
    console.log('Total menu item lines:', Object.keys(itemsByMenuId).length);
    console.log('Total custom item lines:', mealPlanCustomOnly.length);
    console.log('Total items (quantity sum):', totalItems);
    console.log('Total value (menu items only):', totalValue.toFixed(2));
    console.log('\nVendor ID that would be used:', defaultVendorId ?? '(null)');
}

main();
