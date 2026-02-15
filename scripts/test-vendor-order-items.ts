/**
 * Test that vendor order items are returned by the same Supabase queries
 * used in getOrdersByVendor / processVendorOrderDetails.
 * Run: npx ts-node --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' scripts/test-vendor-order-items.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const VENDOR_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const DELIVERY_DATE = '2026-02-16'; // use a date that has orders (DB has 545 on this date)

function loadEnv() {
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

// Match app: date-only YYYY-MM-DD stays as-is; otherwise use noon UTC for calendar day
function toCalendarDateKeyInAppTz(dateInput: string | Date): string | null {
    try {
        const s = typeof dateInput === 'string' ? dateInput.trim() : dateInput.toISOString?.()?.slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
            const d = new Date(s + 'T12:00:00.000Z');
            const y = d.getUTCFullYear();
            const m = String(d.getUTCMonth() + 1).padStart(2, '0');
            const day = String(d.getUTCDate()).padStart(2, '0');
            return `${y}-${m}-${day}`;
        }
        const d = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day = String(d.getUTCDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    } catch {
        return null;
    }
}

async function main() {
    const env = loadEnv();
    const url = env['NEXT_PUBLIC_SUPABASE_URL'];
    const serviceKey = env['SUPABASE_SERVICE_ROLE_KEY'];

    if (!url || !serviceKey) {
        console.error('Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local');
        process.exit(1);
    }

    const db = createClient(url, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
    });

    console.log('=== Vendor order items test ===');
    console.log('Vendor ID:', VENDOR_ID);
    console.log('Delivery date filter:', DELIVERY_DATE);
    console.log('Using SERVICE_ROLE key\n');

    // 1. Fetch orders (same as getOrdersByVendor first step)
    const { data: ordersFromTable, error: ordersErr } = await db
        .from('orders')
        .select('id, service_type, vendor_id, scheduled_delivery_date')
        .eq('vendor_id', VENDOR_ID)
        .order('created_at', { ascending: false })
        .limit(100);

    if (ordersErr) {
        console.error('Orders query error:', ordersErr.message, ordersErr.code);
        process.exit(1);
    }

    const dateKey = toCalendarDateKeyInAppTz(DELIVERY_DATE) ?? DELIVERY_DATE;
    const filtered = (ordersFromTable || []).filter((o: any) => {
        if (!o.scheduled_delivery_date) return false;
        const orderDateKey = toCalendarDateKeyInAppTz(o.scheduled_delivery_date);
        return orderDateKey != null && orderDateKey === dateKey;
    });

    console.log('Orders with vendor_id =', VENDOR_ID, ':', ordersFromTable?.length ?? 0);
    console.log('Orders after filtering by date', dateKey, ':', filtered.length);
    if (filtered.length === 0) {
        console.log('No orders for this date. Try another date or run without date filter.');
        const anyOrder = ordersFromTable?.[0];
        if (anyOrder?.scheduled_delivery_date) {
            const k = toCalendarDateKeyInAppTz(anyOrder.scheduled_delivery_date);
            console.log('Sample order date key:', k);
        }
    }
    console.log('');

    // 2. For each order, run exact same queries as processVendorOrderDetails (Food)
    let vsNullCount = 0;
    let itemsEmptyCount = 0;
    let okCount = 0;

    for (let i = 0; i < Math.min(10, filtered.length); i++) {
        const order = filtered[i];
        if (order.service_type !== 'Food') continue;

        const { data: vsData, error: vsError } = await db
            .from('order_vendor_selections')
            .select('id')
            .eq('order_id', order.id)
            .eq('vendor_id', VENDOR_ID)
            .maybeSingle();

        if (vsError) {
            console.log(`Order ${order.id}: vs query ERROR:`, vsError.message);
            continue;
        }

        if (!vsData) {
            vsNullCount++;
            console.log(`Order ${order.id}: NO vendor selection (vs null)`);
            continue;
        }

        const { data: items, error: itemsError } = await db
            .from('order_items')
            .select('*')
            .eq('vendor_selection_id', vsData.id);

        if (itemsError) {
            console.log(`Order ${order.id}: items query ERROR:`, itemsError.message, itemsError.code);
            continue;
        }

        const count = items?.length ?? 0;
        if (count === 0) {
            itemsEmptyCount++;
            console.log(`Order ${order.id}: vs_id=${vsData.id} but 0 items`);
        } else {
            okCount++;
            if (i < 3) console.log(`Order ${order.id}: vs_id=${vsData.id} -> ${count} items`);
        }
    }

    console.log('');
    console.log('Summary (first 10 Food orders for date):');
    console.log('  With items:', okCount);
    console.log('  No vendor selection:', vsNullCount);
    console.log('  VS found but 0 items:', itemsEmptyCount);

    if (okCount === 0 && (vsNullCount > 0 || itemsEmptyCount > 0)) {
        console.log('\n>>> Problem: Supabase JS client is not returning vs or items. Check table/column names and RLS.');
    } else if (okCount > 0) {
        console.log('\n>>> Queries work in script. Issue may be in Next.js (server action env, serialization, or different client).');
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
