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

// Simulate exactly what the delivery page does
async function simulateDeliveryPageLookup(id: string) {
    console.log(`Simulating delivery page lookup for: "${id}"\n`);

    // Verify if it is a UUID
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    console.log(`Is UUID: ${isUuid}`);

    // Fetch order details
    let query = supabaseAdmin
        .from('orders')
        .select('id, order_number, client_id, scheduled_delivery_date, proof_of_delivery_url');

    if (isUuid) {
        query = query.eq('id', id);
        console.log('Querying orders by UUID:', id);
    } else {
        // Assume it's an order number - Parse as int for safety
        const idInt = parseInt(id, 10);
        if (!isNaN(idInt)) {
            query = query.eq('order_number', idInt);
            console.log('Querying orders by order_number (int):', idInt);
        } else {
            query = query.eq('order_number', id);
            console.log('Querying orders by order_number (string):', id);
        }
    }

    const { data: existingOrder, error: orderError } = await query.maybeSingle();
    console.log('\nOrders table result:');
    console.log('  Data:', existingOrder ? 'Found' : 'Not found');
    console.log('  Error:', orderError);

    let order = existingOrder;
    let isUpcoming = false;
    let upcomingOrderError = null;

    if (!order && !orderError) {
        console.log('\nTrying upcoming_orders table...');
        // Try upcoming_orders
        // Note: upcoming_orders doesn't have a delivery_proof_url column
        let upcomingQuery = supabaseAdmin
            .from('upcoming_orders')
            .select('id, order_number, client_id, scheduled_delivery_date');

        if (isUuid) {
            upcomingQuery = upcomingQuery.eq('id', id);
            console.log('Querying upcoming_orders by UUID:', id);
        } else {
            const idInt = parseInt(id, 10);
            if (!isNaN(idInt)) {
                upcomingQuery = upcomingQuery.eq('order_number', idInt);
                console.log('Querying upcoming_orders by order_number (int):', idInt);
            } else {
                upcomingQuery = upcomingQuery.eq('order_number', id);
                console.log('Querying upcoming_orders by order_number (string):', id);
            }
        }

        const { data: upcomingOrder, error: upcomingErr } = await upcomingQuery.maybeSingle();
        upcomingOrderError = upcomingErr;
        
        console.log('\nUpcoming_orders table result:');
        console.log('  Data:', upcomingOrder ? 'Found' : 'Not found');
        console.log('  Error:', upcomingOrderError);
        
        if (upcomingOrder) {
            order = {
                ...upcomingOrder,
                // upcoming_orders doesn't have delivery_proof_url, so set it to null
                proof_of_delivery_url: null
            };
            isUpcoming = true;
            console.log('  ✓ Order found in upcoming_orders!');
        }
    }

    if (orderError || upcomingOrderError || !order) {
        console.log('\n❌ RESULT: Order Not Found');
        if (orderError) console.log('  Orders table error:', orderError);
        if (upcomingOrderError) console.log('  Upcoming_orders table error:', upcomingOrderError);
        if (!order) console.log('  No order data found in either table');
    } else {
        console.log('\n✓ RESULT: Order Found!');
        console.log('  Order ID:', order.id);
        console.log('  Order Number:', order.order_number);
        console.log('  Client ID:', order.client_id);
        console.log('  Is Upcoming:', isUpcoming);
    }
}

// Test with order number 100021
simulateDeliveryPageLookup('100021').catch(console.error);
