/**
 * Compare an order's items to the expected meal planner list.
 * Finds duplicates/extras (order has more than expected).
 *
 * Usage:
 *   ORDER_ID=49ffb65a-da7b-4f6b-85fc-5a513fa3005f npm run diagnose-order-items-doubles
 * Or pass expected JSON via EXPECTED_JSON env (optional; script has a default).
 */

import { createClient } from '@supabase/supabase-js';
import * as path from 'path';
import * as fs from 'fs';

const ORDER_ID = process.env.ORDER_ID || '49ffb65a-da7b-4f6b-85fc-5a513fa3005f';

const EXPECTED_FROM_MEAL_PLANNER = [
    { name: 'Item', quantity: 2 },
    { name: 'test top', quantity: 3 },
    { name: 'wholesome cheese cake', quantity: 1 },
    { name: 'test bo', quantity: 1 },
];

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

    let expected: { name: string; quantity: number }[] = EXPECTED_FROM_MEAL_PLANNER;
    const jsonEnv = process.env.EXPECTED_JSON;
    if (jsonEnv) {
        try {
            const parsed = JSON.parse(jsonEnv) as any;
            const first = Array.isArray(parsed) ? parsed[0] : parsed;
            const items = first?.items;
            if (Array.isArray(items)) {
                expected = items.map((i: any) => ({
                    name: (i?.name ?? 'Item').trim() || 'Item',
                    quantity: Math.max(0, Number(i?.quantity) ?? 0),
                })).filter((i: any) => i.quantity > 0);
            }
        } catch (e) {
            console.warn('Could not parse EXPECTED_JSON, using built-in expected list.');
        }
    }

    const supabase = createClient(url, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
    });

    run(supabase as any, expected).then(
        () => process.exit(0),
        (err) => {
            console.error(err);
            process.exit(1);
        }
    );
}

async function run(supabase: any, expected: { name: string; quantity: number }[]) {
    console.log('=== Order items vs expected (meal planner) ===\n');
    console.log('Order ID:', ORDER_ID);
    console.log('Expected (meal planner for the day):');
    expected.forEach((e) => console.log('  -', e.name + ':', e.quantity));
    console.log('');

    const { data: order, error: orderErr } = await supabase
        .from('orders')
        .select('id, order_number, client_id, scheduled_delivery_date, service_type, total_items, total_value')
        .eq('id', ORDER_ID)
        .maybeSingle();

    if (orderErr || !order) {
        console.error('Order not found or error:', orderErr?.message || 'not found');
        return;
    }

    console.log('Order:', order.order_number, '| client:', order.client_id, '| scheduled:', order.scheduled_delivery_date);
    console.log('Order total_items (stored):', order.total_items, '| total_value:', order.total_value);
    console.log('');

    const { data: vsList } = await supabase
        .from('order_vendor_selections')
        .select('id')
        .eq('order_id', ORDER_ID);
    const vsIds = ((vsList || []) as any[]).map((r: any) => r.id);
    if (vsIds.length === 0) {
        console.log('No vendor selections for this order.');
        return;
    }

    const { data: items } = await supabase
        .from('order_items')
        .select('id, vendor_selection_id, menu_item_id, quantity, custom_name, custom_price')
        .in('vendor_selection_id', vsIds);
    const orderItems = (items || []) as any[];

    const menuIds = [...new Set(orderItems.map((i: any) => i.menu_item_id).filter(Boolean))];
    let menuMap: Record<string, string> = {};
    if (menuIds.length > 0) {
        const { data: menuRows } = await supabase
            .from('menu_items')
            .select('id, name')
            .in('id', menuIds);
        for (const r of (menuRows || []) as any[]) {
            menuMap[r.id] = r.name || 'Item';
        }
    }

    const actualByName: Record<string, number> = {};
    const details: { name: string; quantity: number; source: string }[] = [];
    for (const row of orderItems) {
        const name = row.custom_name
            ? (String(row.custom_name).trim() || 'Item')
            : (menuMap[row.menu_item_id] || (row.menu_item_id ? 'Unknown menu item' : 'Item'));
        const qty = Math.max(0, Number(row.quantity) || 0);
        actualByName[name] = (actualByName[name] || 0) + qty;
        details.push({
            name,
            quantity: qty,
            source: row.custom_name ? 'custom' : 'menu_item_id=' + (row.menu_item_id || 'null'),
        });
    }

    console.log('--- Actual order_items in DB ---');
    console.log('Total rows in order_items:', orderItems.length);
    console.log('');
    details.forEach((d) => console.log('  -', d.name + ':', d.quantity, '(' + d.source + ')'));
    console.log('');
    console.log('--- Summed by name (actual) ---');
    Object.entries(actualByName).forEach(([name, qty]) => console.log('  -', name + ':', qty));
    console.log('');

    const expectedByName: Record<string, number> = {};
    for (const e of expected) {
        const n = e.name.trim() || 'Item';
        expectedByName[n] = (expectedByName[n] || 0) + e.quantity;
    }

    console.log('--- Comparison (expected vs actual) ---');
    const allNames = new Set([...Object.keys(expectedByName), ...Object.keys(actualByName)]);
    const extras: { name: string; expected: number; actual: number; diff: number }[] = [];
    const missing: { name: string; expected: number; actual: number }[] = [];
    for (const name of allNames) {
        const exp = expectedByName[name] ?? 0;
        const act = actualByName[name] ?? 0;
        if (act > exp) extras.push({ name, expected: exp, actual: act, diff: act - exp });
        if (act < exp) missing.push({ name, expected: exp, actual: act });
    }

    if (extras.length > 0) {
        console.log('Items with MORE in order than expected (doubles/extras):');
        extras.forEach((x) => console.log('  -', x.name + ': expected', x.expected, '| actual', x.actual, '| extra', x.diff));
        console.log('');
    }
    if (missing.length > 0) {
        console.log('Items with LESS in order than expected:');
        missing.forEach((x) => console.log('  -', x.name + ': expected', x.expected, '| actual', x.actual));
        console.log('');
    }
    if (extras.length === 0 && missing.length === 0) {
        console.log('Quantities match expected.');
    }

    const onlyInOrder = Object.keys(actualByName).filter((n) => !(n in expectedByName));
    if (onlyInOrder.length > 0) {
        console.log('Items in order but NOT in expected list:');
        onlyInOrder.forEach((n) => console.log('  -', n + ':', actualByName[n]));
    }
}

main();
