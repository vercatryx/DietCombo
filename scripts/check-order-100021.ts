import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Load env
const envPath = path.resolve(process.cwd(), '.env.local');
const envFile = fs.readFileSync(envPath, 'utf8');
const envConfig: Record<string, string> = {};
envFile.split('\n').forEach(line => {
    const [key, ...values] = line.split('=');
    if (key && values) {
        envConfig[key.trim()] = values.join('=').trim().replace(/(^"|"$)/g, '');
    }
});

const supabaseAdmin = createClient(
    envConfig['NEXT_PUBLIC_SUPABASE_URL'],
    envConfig['SUPABASE_SERVICE_ROLE_KEY']
);

async function checkOrder100021() {
    console.log('Checking order #100021...\n');

    // Check in orders table
    console.log('1. Checking in orders table:');
    const { data: orderInOrders, error: orderError } = await supabaseAdmin
        .from('orders')
        .select('id, order_number, client_id, status, created_at')
        .eq('order_number', 100021)
        .maybeSingle();

    if (orderError) {
        console.error('   Error:', orderError);
    } else if (orderInOrders) {
        console.log('   ✓ Found in orders table:', {
            id: orderInOrders.id,
            order_number: orderInOrders.order_number,
            client_id: orderInOrders.client_id,
            status: orderInOrders.status,
            created_at: orderInOrders.created_at
        });
    } else {
        console.log('   ✗ Not found in orders table');
    }

    // Check in upcoming_orders table
    console.log('\n2. Checking in upcoming_orders table:');
    const { data: orderInUpcoming, error: upcomingError } = await supabaseAdmin
        .from('upcoming_orders')
        .select('id, order_number, client_id, status, created_at')
        .eq('order_number', 100021)
        .maybeSingle();

    if (upcomingError) {
        console.error('   Error:', upcomingError);
    } else if (orderInUpcoming) {
        console.log('   ✓ Found in upcoming_orders table:', {
            id: orderInUpcoming.id,
            order_number: orderInUpcoming.order_number,
            client_id: orderInUpcoming.client_id,
            status: orderInUpcoming.status,
            created_at: orderInUpcoming.created_at
        });
    } else {
        console.log('   ✗ Not found in upcoming_orders table');
    }

    // Check with string (as it might come from URL)
    console.log('\n3. Checking with string "100021" in orders table:');
    const { data: orderAsString, error: stringError } = await supabaseAdmin
        .from('orders')
        .select('id, order_number, client_id, status')
        .eq('order_number', '100021')
        .maybeSingle();

    if (stringError) {
        console.error('   Error:', stringError);
    } else if (orderAsString) {
        console.log('   ✓ Found with string:', orderAsString);
    } else {
        console.log('   ✗ Not found with string');
    }

    // Check with parsed int (as the page does)
    console.log('\n4. Checking with parsed int in orders table:');
    const idInt = parseInt('100021', 10);
    console.log('   Parsed int:', idInt, 'isNaN:', isNaN(idInt));
    const { data: orderAsInt, error: intError } = await supabaseAdmin
        .from('orders')
        .select('id, order_number, client_id, status')
        .eq('order_number', idInt)
        .maybeSingle();

    if (intError) {
        console.error('   Error:', intError);
    } else if (orderAsInt) {
        console.log('   ✓ Found with int:', orderAsInt);
    } else {
        console.log('   ✗ Not found with int');
    }

    // List all orders with order_number around 100021
    console.log('\n5. Checking nearby order numbers:');
    const { data: nearbyOrders, error: nearbyError } = await supabaseAdmin
        .from('orders')
        .select('id, order_number, client_id, status')
        .gte('order_number', 100019)
        .lte('order_number', 100023)
        .order('order_number', { ascending: true });

    if (nearbyError) {
        console.error('   Error:', nearbyError);
    } else if (nearbyOrders && nearbyOrders.length > 0) {
        console.log('   Nearby orders:');
        nearbyOrders.forEach(o => {
            console.log(`     - Order #${o.order_number} (id: ${o.id}, status: ${o.status})`);
        });
    } else {
        console.log('   No nearby orders found');
    }

    // Check upcoming_orders nearby
    console.log('\n6. Checking nearby order numbers in upcoming_orders:');
    const { data: nearbyUpcoming, error: nearbyUpcomingError } = await supabaseAdmin
        .from('upcoming_orders')
        .select('id, order_number, client_id, status')
        .gte('order_number', 100019)
        .lte('order_number', 100023)
        .order('order_number', { ascending: true });

    if (nearbyUpcomingError) {
        console.error('   Error:', nearbyUpcomingError);
    } else if (nearbyUpcoming && nearbyUpcoming.length > 0) {
        console.log('   Nearby upcoming orders:');
        nearbyUpcoming.forEach(o => {
            console.log(`     - Order #${o.order_number} (id: ${o.id}, status: ${o.status})`);
        });
    } else {
        console.log('   No nearby upcoming orders found');
    }
}

checkOrder100021().catch(console.error);
