/**
 * Debug why /vendors/cccccccc-cccc-cccc-cccc-cccccccccccc/delivery/2026-02-15 shows empty.
 * Run: npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/debug-delivery-2026-02-15.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const VENDOR_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const TARGET_DATE = '2026-02-15';

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

function extractDateStr(val: unknown): string | null {
    if (val == null) return null;
    if (typeof val === 'string') return val.slice(0, 10);
    if (val instanceof Date) return val.toISOString().slice(0, 10);
    return String(val).slice(0, 10);
}

async function main() {
    const env = loadEnv();
    const url = env['NEXT_PUBLIC_SUPABASE_URL'];
    const serviceKey = env['SUPABASE_SERVICE_ROLE_KEY'];
    if (!url || !serviceKey) {
        console.error('Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
        process.exit(1);
    }

    const supabase = createClient(url, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
    });

    console.log('=== Delivery page debug ===');
    console.log('Vendor ID:', VENDOR_ID);
    console.log('Target date (from URL):', TARGET_DATE);
    console.log('');

    // 1. Orders from orders table with vendor_id
    const { data: directOrders } = await supabase
        .from('orders')
        .select('id, order_number, client_id, service_type, scheduled_delivery_date, vendor_id')
        .eq('vendor_id', VENDOR_ID);
    const directOrderIds = new Set((directOrders || []).map((o: any) => o.id));

    // 2. Orders from junction tables
    const { data: foodIds } = await supabase
        .from('order_vendor_selections')
        .select('order_id')
        .eq('vendor_id', VENDOR_ID);
    const { data: boxIds } = await supabase
        .from('order_box_selections')
        .select('order_id')
        .eq('vendor_id', VENDOR_ID);
    const junctionIds = [...new Set([
        ...(foodIds || []).map((r: any) => r.order_id),
        ...(boxIds || []).map((r: any) => r.order_id),
    ])];

    const missingJunction = junctionIds.filter(id => !directOrderIds.has(id));
    let ordersUnique: any[] = [...(directOrders || [])];
    if (missingJunction.length > 0) {
        const { data: extra } = await supabase
            .from('orders')
            .select('id, order_number, client_id, service_type, scheduled_delivery_date, vendor_id')
            .in('id', missingJunction);
        const seen = new Set(ordersUnique.map((o: any) => o.id));
        for (const o of extra || []) {
            if (!seen.has(o.id)) {
                seen.add(o.id);
                ordersUnique.push(o);
            }
        }
    }

    console.log('--- ORDERS table (completed) ---');
    console.log('From vendor_id:', (directOrders || []).length);
    console.log('From junction (order_vendor + order_box):', junctionIds.length, 'unique');
    console.log('Total orders for vendor:', ordersUnique.length);

    const orderDates = ordersUnique.map(o => extractDateStr(o.scheduled_delivery_date)).filter(Boolean) as string[];
    const orderDatesSet = [...new Set(orderDates)].sort();
    console.log('Distinct scheduled_delivery_date values:', orderDatesSet.slice(0, 20));
    if (orderDatesSet.length > 20) console.log('  ... and', orderDatesSet.length - 20, 'more');

    const ordersForTarget = ordersUnique.filter(o => {
        const d = extractDateStr(o.scheduled_delivery_date);
        return d === TARGET_DATE;
    });
    console.log(`Orders with scheduled_delivery_date = ${TARGET_DATE}:`, ordersForTarget.length);
    if (ordersForTarget.length > 0) {
        console.log('  Sample:', ordersForTarget[0]);
    }
    console.log('');

    // 3. Upcoming orders
    const { data: uoFoodIds } = await supabase
        .from('upcoming_order_vendor_selections')
        .select('upcoming_order_id')
        .eq('vendor_id', VENDOR_ID);
    const { data: uoBoxIds } = await supabase
        .from('upcoming_order_box_selections')
        .select('upcoming_order_id')
        .eq('vendor_id', VENDOR_ID);
    const upcomingIds = [...new Set([
        ...(uoFoodIds || []).map((r: any) => r.upcoming_order_id),
        ...(uoBoxIds || []).map((r: any) => r.upcoming_order_id),
    ])];

    let upcomingRows: any[] = [];
    if (upcomingIds.length > 0) {
        const { data } = await supabase
            .from('upcoming_orders')
            .select('id, order_number, client_id, service_type, scheduled_delivery_date')
            .in('id', upcomingIds);
        upcomingRows = data || [];
    }

    console.log('--- UPCOMING_ORDERS table ---');
    console.log('From junction tables:', upcomingIds.length, 'unique upcoming_order_ids');
    console.log('Fetched rows:', upcomingRows.length);

    const upcomingDates = upcomingRows.map(o => extractDateStr(o.scheduled_delivery_date)).filter(Boolean) as string[];
    const upcomingDatesSet = [...new Set(upcomingDates)].sort();
    console.log('Distinct scheduled_delivery_date values:', upcomingDatesSet.slice(0, 20));
    if (upcomingDatesSet.length > 20) console.log('  ... and', upcomingDatesSet.length - 20, 'more');

    const upcomingForTarget = upcomingRows.filter(o => {
        const d = extractDateStr(o.scheduled_delivery_date);
        return d === TARGET_DATE;
    });
    console.log(`Upcoming with scheduled_delivery_date = ${TARGET_DATE}:`, upcomingForTarget.length);
    if (upcomingForTarget.length > 0) {
        console.log('  Sample:', upcomingForTarget[0]);
    }
    console.log('');

    // 4. Date format check - raw values for a few rows
    console.log('--- Date format check ---');
    const sampleOrder = ordersUnique[0] || upcomingRows[0];
    if (sampleOrder) {
        const raw = sampleOrder.scheduled_delivery_date;
        console.log('Sample scheduled_delivery_date (raw):', JSON.stringify(raw), typeof raw);
        console.log('extractDateStr result:', extractDateStr(raw));
        console.log('Would match', TARGET_DATE, '?', extractDateStr(raw) === TARGET_DATE);
    } else {
        console.log('No sample row - tables may be empty for this vendor');
    }
    console.log('');

    // 5. Summary
    console.log('=== SUMMARY ===');
    const totalForDate = ordersForTarget.length + upcomingForTarget.length;
    if (totalForDate === 0) {
        console.log(`No orders found for ${TARGET_DATE}.`);
        console.log('');
        console.log('Dates that DO have orders:');
        const allDates = [...new Set([...orderDatesSet, ...upcomingDatesSet])].sort();
        if (allDates.length === 0) {
            console.log('  (none - no orders at all for this vendor)');
        } else {
            allDates.slice(0, 15).forEach(d => {
                const c = ordersUnique.filter(o => extractDateStr(o.scheduled_delivery_date) === d).length;
                const u = upcomingRows.filter(o => extractDateStr(o.scheduled_delivery_date) === d).length;
                console.log(`  ${d}: ${c} completed, ${u} upcoming`);
            });
            if (allDates.length > 15) console.log(`  ... and ${allDates.length - 15} more dates`);
        }
    } else {
        console.log(`Found ${totalForDate} orders for ${TARGET_DATE} (${ordersForTarget.length} completed, ${upcomingForTarget.length} upcoming).`);
        console.log('If the page is still empty, the issue may be in getOrdersByVendor logic or client-side.');
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
