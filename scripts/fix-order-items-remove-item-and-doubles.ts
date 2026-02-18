/**
 * Fix an order that has (1) generic "Item" custom rows and (2) duplicate custom rows
 * for items that already exist as menu items (e.g. "test top" both as menu and custom).
 * Deletes the bad rows and updates order.total_items.
 *
 * Usage:
 *   ORDER_ID=98b0522b-5fb4-4731-95e4-b7bbd868c568 npm run fix-order-items-remove-item-and-doubles
 * Add DRY_RUN=1 to only print what would be done, no DB writes.
 */

import { createClient } from '@supabase/supabase-js';
import * as path from 'path';
import * as fs from 'fs';

const ORDER_ID = process.env.ORDER_ID || '98b0522b-5fb4-4731-95e4-b7bbd868c568';
const DRY_RUN = process.env.DRY_RUN === '1';

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
    console.log('=== Fix order: remove "Item" and duplicate custom rows ===\n');
    console.log('Order ID:', ORDER_ID);
    if (DRY_RUN) console.log('DRY_RUN: no DB writes\n');

    const { data: order, error: orderErr } = await supabase
        .from('orders')
        .select('id, order_number, total_items, total_value')
        .eq('id', ORDER_ID)
        .maybeSingle();

    if (orderErr || !order) {
        console.error('Order not found or error:', orderErr?.message || 'not found');
        return;
    }

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
    let menuIdToName: Record<string, string> = {};
    if (menuIds.length > 0) {
        const { data: menuRows } = await supabase
            .from('menu_items')
            .select('id, name')
            .in('id', menuIds);
        for (const r of (menuRows || []) as any[]) {
            menuIdToName[r.id] = (r.name || '').trim();
        }
    }

    const namesFromMenuRows = new Set(
        orderItems
            .filter((r: any) => r.menu_item_id && menuIdToName[r.menu_item_id])
            .map((r: any) => menuIdToName[r.menu_item_id].toLowerCase())
    );

    const idsToDelete: string[] = [];
    for (const row of orderItems) {
        if (row.custom_name != null && row.custom_name !== '') {
            const name = String(row.custom_name).trim();
            const nameLower = name.toLowerCase();
            if (nameLower === 'item') {
                idsToDelete.push(row.id);
                console.log('Will delete (generic Item):', row.id, '|', name, 'x', row.quantity);
            } else if (namesFromMenuRows.has(nameLower)) {
                idsToDelete.push(row.id);
                console.log('Will delete (duplicate of menu item):', row.id, '|', name, 'x', row.quantity);
            }
        }
    }

    if (idsToDelete.length === 0) {
        console.log('No rows to delete.');
        return;
    }

    const remaining = orderItems.filter((r: any) => !idsToDelete.includes(r.id));
    const newTotalItems = remaining.reduce((sum: number, r: any) => sum + (Number(r.quantity) || 0), 0);

    if (!DRY_RUN) {
        const { error: delErr } = await supabase
            .from('order_items')
            .delete()
            .in('id', idsToDelete);
        if (delErr) {
            console.error('Failed to delete order_items:', delErr.message);
            return;
        }
        const { error: updErr } = await supabase
            .from('orders')
            .update({ total_items: newTotalItems, last_updated: new Date().toISOString() })
            .eq('id', ORDER_ID);
        if (updErr) {
            console.error('Failed to update order total_items:', updErr.message);
            return;
        }
    }

    console.log('\nDeleted', idsToDelete.length, 'row(s).');
    console.log('Order total_items updated to:', newTotalItems);
    console.log('Remaining items:', remaining.length, 'rows.');
}

main();
