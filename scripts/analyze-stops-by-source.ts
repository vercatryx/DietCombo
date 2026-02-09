/**
 * Analyze stops table: identify which stops are created from orders vs upcoming_orders
 *
 * Run: npx tsx scripts/analyze-stops-by-source.ts
 * (or: npx ts-node scripts/analyze-stops-by-source.ts)
 */

import { supabase } from '../lib/supabase';

async function main() {
    console.log('\n=== Stops Analysis: orders vs upcoming_orders ===\n');

    // 1. Fetch all stops with order_id
    const { data: stops, error: stopsError } = await supabase
        .from('stops')
        .select('id, order_id, client_id, delivery_date, day, name, created_at');

    if (stopsError) {
        console.error('Error fetching stops:', stopsError.message);
        process.exit(1);
    }

    const totalStops = stops?.length ?? 0;
    const stopsWithOrderId = (stops ?? []).filter((s) => s.order_id != null);
    const stopsWithoutOrderId = (stops ?? []).filter((s) => s.order_id == null);

    console.log(`Total stops: ${totalStops}`);
    console.log(`  - With order_id: ${stopsWithOrderId.length}`);
    console.log(`  - Without order_id: ${stopsWithoutOrderId.length}\n`);

    if (stopsWithOrderId.length === 0) {
        console.log('No stops with order_id to analyze.');
        process.exit(0);
    }

    // 2. Get all unique order_ids from stops
    const orderIds = [...new Set(stopsWithOrderId.map((s) => String(s.order_id!)))];

    // 3. Check which order_ids exist in orders table
    const { data: ordersById } = await supabase
        .from('orders')
        .select('id')
        .in('id', orderIds);

    const orderIdsFromOrders = new Set((ordersById ?? []).map((o) => String(o.id)));

    // 4. Check which order_ids exist in upcoming_orders table
    const { data: upcomingById } = await supabase
        .from('upcoming_orders')
        .select('id')
        .in('id', orderIds);

    const orderIdsFromUpcoming = new Set((upcomingById ?? []).map((o) => String(o.id)));

    // 5. Classify each stop
    const fromOrders: typeof stops = [];
    const fromUpcoming: typeof stops = [];
    const orphaned: typeof stops = []; // order_id references neither table

    for (const stop of stopsWithOrderId) {
        const oid = String(stop.order_id!);
        if (orderIdsFromOrders.has(oid)) {
            fromOrders.push(stop);
        } else if (orderIdsFromUpcoming.has(oid)) {
            fromUpcoming.push(stop);
        } else {
            orphaned.push(stop);
        }
    }

    // 6. Report
    console.log('--- Results ---');
    console.log(`Stops with order_id referencing orders table:     ${fromOrders.length}`);
    console.log(`Stops with order_id referencing upcoming_orders:  ${fromUpcoming.length}`);
    console.log(`Stops with order_id referencing neither (orphaned): ${orphaned.length}`);

    if (fromOrders.length > 0) {
        console.log('\nSample stops from ORDERS (first 5):');
        fromOrders.slice(0, 5).forEach((s) => {
            console.log(`  ${s.id} | order_id=${s.order_id} | client=${s.client_id} | delivery_date=${s.delivery_date} | ${s.name}`);
        });
    }

    if (fromUpcoming.length > 0) {
        console.log('\nSample stops from UPCOMING_ORDERS (first 5):');
        fromUpcoming.slice(0, 5).forEach((s) => {
            console.log(`  ${s.id} | order_id=${s.order_id} | client=${s.client_id} | delivery_date=${s.delivery_date} | ${s.name}`);
        });
    }

    if (orphaned.length > 0) {
        console.log('\nSample ORPHANED stops (order_id not found in either table, first 5):');
        orphaned.slice(0, 5).forEach((s) => {
            console.log(`  ${s.id} | order_id=${s.order_id} | client=${s.client_id} | delivery_date=${s.delivery_date} | ${s.name}`);
        });
    }

    // Summary by delivery_date (optional)
    const byDate = new Map<string, { orders: number; upcoming: number; orphaned: number }>();
    for (const s of fromOrders) {
        const d = s.delivery_date ?? '(null)';
        const curr = byDate.get(d) ?? { orders: 0, upcoming: 0, orphaned: 0 };
        curr.orders++;
        byDate.set(d, curr);
    }
    for (const s of fromUpcoming) {
        const d = s.delivery_date ?? '(null)';
        const curr = byDate.get(d) ?? { orders: 0, upcoming: 0, orphaned: 0 };
        curr.upcoming++;
        byDate.set(d, curr);
    }
    for (const s of orphaned) {
        const d = s.delivery_date ?? '(null)';
        const curr = byDate.get(d) ?? { orders: 0, upcoming: 0, orphaned: 0 };
        curr.orphaned++;
        byDate.set(d, curr);
    }

    const sortedDates = [...byDate.keys()].sort();
    if (sortedDates.length > 0) {
        console.log('\n--- By delivery_date ---');
        for (const d of sortedDates.slice(0, 15)) {
            const v = byDate.get(d)!;
            console.log(`  ${d}: orders=${v.orders} | upcoming=${v.upcoming} | orphaned=${v.orphaned}`);
        }
        if (sortedDates.length > 15) {
            console.log(`  ... and ${sortedDates.length - 15} more dates`);
        }
    }

    console.log('\nDone.\n');
    process.exit(0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
