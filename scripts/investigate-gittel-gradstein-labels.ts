/**
 * Investigate: GITTEL GRADSTEIN has 1 order on the 22nd but 2 labels were printed.
 * Run: npx ts-node --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' scripts/investigate-gittel-gradstein-labels.ts
 *
 * Possible causes:
 * - "Labels – address + order details (2 per customer)" prints 2 labels per order by design.
 * - Duplicate orders in DB for same client/date.
 * - Dependants expansion: one order can produce extra label rows for dependants.
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const VENDOR_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const CLIENT_NAME_SEARCH = 'GITTEL GRADSTEIN';
// "the 22" – try Feb 22 in current year and previous
const DATES_TO_CHECK = ['2025-02-22', '2026-02-22', '2026-02-23', '2024-02-22'];

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

function toCalendarDateKey(dateInput: string): string {
    const s = dateInput.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = new Date(dateInput);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
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

    console.log('=== GITTEL GRADSTEIN labels investigation ===\n');
    console.log('Vendor ID:', VENDOR_ID);
    console.log('Client name search:', CLIENT_NAME_SEARCH);
    console.log('Dates to check:', DATES_TO_CHECK.join(', '));
    console.log('');

    // 1. Find client(s) matching GITTEL GRADSTEIN
    const { data: clients, error: clientsErr } = await db
        .from('clients')
        .select('id, full_name, parent_client_id')
        .ilike('full_name', `%${CLIENT_NAME_SEARCH.replace(/\s+/g, '%')}%`);

    if (clientsErr) {
        console.error('Error fetching clients:', clientsErr.message);
        process.exit(1);
    }
    if (!clients?.length) {
        console.log('No clients found matching "' + CLIENT_NAME_SEARCH + '". Trying exact match.');
        const { data: exact } = await db
            .from('clients')
            .select('id, full_name, parent_client_id')
            .or('full_name.eq.' + CLIENT_NAME_SEARCH + ',full_name.ilike.GITTEL%GRADSTEIN');
        if (!exact?.length) {
            console.log('No clients found. Listing a few with "GITTEL" in name:');
            const { data: gittel } = await db.from('clients').select('id, full_name').ilike('full_name', '%GITTEL%').limit(10);
            console.log(gittel || []);
            process.exit(1);
        }
        clients.length = 0;
        clients.push(...exact);
    }

    console.log('1. Client(s) found:', clients!.length);
    clients!.forEach((c: any) => console.log('   -', c.id, '|', c.full_name, '| parent_client_id:', c.parent_client_id ?? 'null'));
    const clientIds = clients!.map((c: any) => c.id);
    const parentId = (clients as any[])[0]?.parent_client_id;
    if (parentId) {
        console.log('   GITTEL is a dependant; parent_client_id:', parentId);
    }
    console.log('');

    // 2. Orders for this vendor on each date (same sources as getOrdersByVendor: orders.vendor_id + junction)
    for (const dateKey of DATES_TO_CHECK) {
        console.log('--- Date:', dateKey, '---');

        const { data: directOrders } = await db
            .from('orders')
            .select('id, order_number, client_id, service_type, scheduled_delivery_date, vendor_id, created_at')
            .eq('vendor_id', VENDOR_ID)
            .not('scheduled_delivery_date', 'is', null)
            .order('created_at', { ascending: false });

        const { data: foodRows } = await db
            .from('order_vendor_selections')
            .select('order_id')
            .eq('vendor_id', VENDOR_ID);
        const { data: boxRows } = await db
            .from('order_box_selections')
            .select('order_id')
            .eq('vendor_id', VENDOR_ID);
        const junctionOrderIds = [...new Set([
            ...(foodRows || []).map((r: any) => r.order_id),
            ...(boxRows || []).map((r: any) => r.order_id),
        ])];

        let orderIdsToFetch = (directOrders || []).map((o: any) => o.id);
        const directIdSet = new Set(orderIdsToFetch);
        for (const id of junctionOrderIds) {
            if (!directIdSet.has(id)) orderIdsToFetch.push(id);
        }

        let allOrders: any[] = directOrders || [];
        if (junctionOrderIds.length > 0) {
            const missing = orderIdsToFetch.filter((id) => !(directOrders || []).some((o: any) => o.id === id));
            if (missing.length > 0) {
                const { data: extra } = await db.from('orders').select('id, order_number, client_id, service_type, scheduled_delivery_date, vendor_id, created_at').in('id', missing);
                allOrders = [...(directOrders || []), ...(extra || [])];
            }
        }

        const filteredByDate = allOrders.filter((o: any) => {
            if (!o.scheduled_delivery_date) return false;
            const orderDateKey = toCalendarDateKey(o.scheduled_delivery_date);
            return orderDateKey === dateKey;
        });

        const gittelOrdersOnDate = filteredByDate.filter((o: any) => clientIds.includes(o.client_id));
        const parentOrdersOnDate = parentId ? filteredByDate.filter((o: any) => o.client_id === parentId) : [];

        console.log('   Total orders for vendor on this date:', filteredByDate.length);
        console.log('   Orders for GITTEL (client_id = GITTEL):', gittelOrdersOnDate.length);
        if (parentId) {
            console.log('   Orders for PARENT (client_id = parent):', parentOrdersOnDate.length);
            if (parentOrdersOnDate.length > 0) {
                console.log('     -> Label export adds 1 row per dependant; so 1 parent order can produce 2+ labels (parent + GITTEL).');
            }
        }
        if (gittelOrdersOnDate.length > 0) {
            gittelOrdersOnDate.forEach((o: any) => {
                console.log('     - Order', o.order_number, '| id:', o.id, '| client_id:', o.client_id, '| service_type:', o.service_type);
            });
        }
        console.log('');
    }

    // 3. All orders for GITTEL with this vendor (any date)
    console.log('--- All orders for GITTEL (this vendor, any date) ---');
    const { data: foodRows3 } = await db.from('order_vendor_selections').select('order_id').eq('vendor_id', VENDOR_ID);
    const { data: boxRows3 } = await db.from('order_box_selections').select('order_id').eq('vendor_id', VENDOR_ID);
    const junctionIds = [...new Set([
        ...(foodRows3 || []).map((r: any) => r.order_id),
        ...(boxRows3 || []).map((r: any) => r.order_id),
    ])];
    const { data: ordersDirect3 } = await db.from('orders').select('id, order_number, client_id, service_type, scheduled_delivery_date, vendor_id').eq('vendor_id', VENDOR_ID);
    const { data: ordersJunction3 } = junctionIds.length
        ? await db.from('orders').select('id, order_number, client_id, service_type, scheduled_delivery_date, vendor_id').in('id', junctionIds)
        : { data: [] };
    const allForVendor = [...(ordersDirect3 || []), ...(ordersJunction3 || [])];
    const uniqueOrders = Array.from(new Map(allForVendor.map((o: any) => [o.id, o])).values());
    const gittelAll = uniqueOrders.filter((o: any) => clientIds.includes(o.client_id));
    console.log('   Orders for this vendor where client is GITTEL:', gittelAll.length);
    gittelAll.forEach((o: any) => console.log('     ', o.scheduled_delivery_date, '|', o.order_number, '|', o.id));

    console.log('');
    console.log('=== Label count explanation ===');
    console.log('On the vendor page there are two label actions:');
    console.log('  1. "Download Labels" -> 1 label per order (and 1 per dependant without own order).');
    console.log('  2. "Labels – address + order details (2 per customer)" -> 2 labels per order (one row = left label + right label).');
    console.log('If you used option 2, one order for GITTEL would produce exactly 2 labels. So 1 order -> 2 labels is expected.');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
