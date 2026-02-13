/**
 * Investigate why /vendors/cccccccc-cccc-cccc-cccc-cccccccccccc shows no orders.
 * Run: npx ts-node --compiler-options '{"module":"CommonJS"}' scripts/investigate-vendor-orders.ts
 * Or: node --loader ts-node/esm scripts/investigate-vendor-orders.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const VENDOR_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

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

async function main() {
    const env = loadEnv();
    const url = env['NEXT_PUBLIC_SUPABASE_URL'];
    const serviceKey = env['SUPABASE_SERVICE_ROLE_KEY'];
    const anonKey = env['NEXT_PUBLIC_SUPABASE_ANON_KEY'];

    if (!url) {
        console.error('NEXT_PUBLIC_SUPABASE_URL missing');
        process.exit(1);
    }
    const key = serviceKey || anonKey;
    if (!key) {
        console.error('Need SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY');
        process.exit(1);
    }

    const supabase = createClient(url, key, {
        auth: { autoRefreshToken: false, persistSession: false },
        db: { schema: 'public' },
    });

    console.log('=== Vendor orders investigation ===');
    console.log('Vendor ID:', VENDOR_ID);
    console.log('Using key:', serviceKey ? 'SERVICE_ROLE' : 'ANON');
    console.log('');

    // 1. orders with vendor_id = VENDOR_ID
    const { data: directOrders, error: e1 } = await supabase
        .from('orders')
        .select('id, order_number, client_id, service_type, vendor_id, created_at')
        .eq('vendor_id', VENDOR_ID)
        .order('created_at', { ascending: false })
        .limit(20);
    console.log('1. orders.vendor_id =', VENDOR_ID);
    if (e1) {
        console.log('   Error:', e1.message, e1.code);
    } else {
        console.log('   Count (sample):', directOrders?.length ?? 0);
        if (directOrders?.length) console.log('   Sample:', directOrders[0]);
    }
    const { count: countDirect } = await supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .eq('vendor_id', VENDOR_ID);
    console.log('   Total count:', countDirect ?? 0);
    console.log('');

    // 2. order_vendor_selections for this vendor
    const { data: foodSelections, error: e2 } = await supabase
        .from('order_vendor_selections')
        .select('order_id, vendor_id')
        .eq('vendor_id', VENDOR_ID);
    console.log('2. order_vendor_selections.vendor_id =', VENDOR_ID);
    if (e2) {
        console.log('   Error:', e2.message, e2.code);
    } else {
        const orderIds = [...new Set((foodSelections || []).map((r: any) => r.order_id))];
        console.log('   Rows:', foodSelections?.length ?? 0, '| Unique order_ids:', orderIds.length);
        if (orderIds.length > 0) console.log('   First 3 order_ids:', orderIds.slice(0, 3));
    }
    console.log('');

    // 3. order_box_selections for this vendor
    const { data: boxSelections, error: e3 } = await supabase
        .from('order_box_selections')
        .select('order_id, vendor_id')
        .eq('vendor_id', VENDOR_ID);
    console.log('3. order_box_selections.vendor_id =', VENDOR_ID);
    if (e3) {
        console.log('   Error:', e3.message, e3.code);
    } else {
        const orderIds = [...new Set((boxSelections || []).map((r: any) => r.order_id))];
        console.log('   Rows:', boxSelections?.length ?? 0, '| Unique order_ids:', orderIds.length);
        if (orderIds.length > 0) console.log('   First 3 order_ids:', orderIds.slice(0, 3));
    }
    console.log('');

    // 4. upcoming_order_vendor_selections
    const { data: upcomingFood, error: e4 } = await supabase
        .from('upcoming_order_vendor_selections')
        .select('upcoming_order_id, vendor_id')
        .eq('vendor_id', VENDOR_ID);
    console.log('4. upcoming_order_vendor_selections.vendor_id =', VENDOR_ID);
    if (e4) {
        console.log('   Error:', e4.message, e4.code);
    } else {
        const ids = [...new Set((upcomingFood || []).map((r: any) => r.upcoming_order_id))];
        console.log('   Rows:', upcomingFood?.length ?? 0, '| Unique upcoming_order_ids:', ids.length);
        if (ids.length > 0) console.log('   First 3 upcoming_order_ids:', ids.slice(0, 3));
    }
    console.log('');

    // 5. upcoming_order_box_selections
    const { data: upcomingBox, error: e5 } = await supabase
        .from('upcoming_order_box_selections')
        .select('upcoming_order_id, vendor_id')
        .eq('vendor_id', VENDOR_ID);
    console.log('5. upcoming_order_box_selections.vendor_id =', VENDOR_ID);
    if (e5) {
        console.log('   Error:', e5.message, e5.code);
    } else {
        const ids = [...new Set((upcomingBox || []).map((r: any) => r.upcoming_order_id))];
        console.log('   Rows:', upcomingBox?.length ?? 0, '| Unique upcoming_order_ids:', ids.length);
        if (ids.length > 0) console.log('   First 3 upcoming_order_ids:', ids.slice(0, 3));
    }
    console.log('');

    // 6. What vendor_ids actually exist in these tables?
    console.log('6. Distinct vendor_id values in DB (to see if vendor id is different):');
    const { data: vendorsInOrders } = await supabase.from('orders').select('vendor_id').not('vendor_id', 'is', null).limit(500);
    const vendorIdsOrders = [...new Set((vendorsInOrders || []).map((r: any) => r.vendor_id))];
    console.log('   orders.vendor_id distinct:', vendorIdsOrders.slice(0, 10));

    const { data: vendorsInOvs } = await supabase.from('order_vendor_selections').select('vendor_id').limit(500);
    const vendorIdsOvs = [...new Set((vendorsInOvs || []).map((r: any) => r.vendor_id))];
    console.log('   order_vendor_selections.vendor_id distinct:', vendorIdsOvs.slice(0, 10));

    const { data: vendorsInUovs } = await supabase.from('upcoming_order_vendor_selections').select('vendor_id').limit(500);
    const vendorIdsUovs = [...new Set((vendorsInUovs || []).map((r: any) => r.vendor_id))];
    console.log('   upcoming_order_vendor_selections.vendor_id distinct:', vendorIdsUovs.slice(0, 10));
    console.log('');

    // 7. Total orders and upcoming_orders (any vendor)
    const { count: totalOrders } = await supabase.from('orders').select('*', { count: 'exact', head: true });
    const { count: totalUpcoming } = await supabase.from('upcoming_orders').select('*', { count: 'exact', head: true });
    console.log('7. Total rows: orders =', totalOrders, ', upcoming_orders =', totalUpcoming);
    console.log('');

    console.log('=== Summary ===');
    const hasDirect = (countDirect ?? 0) > 0;
    const hasFood = (foodSelections?.length ?? 0) > 0;
    const hasBox = (boxSelections?.length ?? 0) > 0;
    const hasUpcomingFood = (upcomingFood?.length ?? 0) > 0;
    const hasUpcomingBox = (upcomingBox?.length ?? 0) > 0;
    const anyData = hasDirect || hasFood || hasBox || hasUpcomingFood || hasUpcomingBox;
    if (!anyData) {
        console.log('No rows found for vendor', VENDOR_ID);
        if (vendorIdsUovs.length > 0 || vendorIdsOvs.length > 0) {
            console.log('Other vendor_ids in DB:', [...new Set([...vendorIdsOrders, ...vendorIdsOvs, ...vendorIdsUovs])]);
            console.log('-> If your vendor id differs, getOrdersByVendor is querying the wrong id, or rows use a different vendor_id.');
        }
        console.log('-> Also ensure you are logged in as admin or as this vendor when opening the page (getOrdersByVendor requires session).');
    } else {
        console.log('Data EXISTS for this vendor. If the page still shows no orders:');
        console.log('-> getOrdersByVendor returns [] when session is missing or user is not admin and not this vendor.');
        console.log('-> Log in as admin (or as this vendor) and open /vendors/' + VENDOR_ID);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
