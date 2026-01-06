
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

// Load env manully to ensure we have keys
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

async function mockPageLookup(id: string) {
    console.log(`[MockLookup] ID: "${id}"`);

    // Verify if it is a UUID
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    console.log(`[MockLookup] Is UUID: ${isUuid}`);

    // --- 1. Check Orders ---
    let query = supabaseAdmin
        .from('orders')
        .select(`
            id, 
            order_number, 
            client_id, 
            scheduled_delivery_date,
            proof_of_delivery_image
        `);

    if (isUuid) {
        query = query.eq('id', id);
    } else {
        const idInt = parseInt(id, 10);
        if (!isNaN(idInt)) {
            console.log(`[MockLookup] Querying orders by order_number (int): ${idInt}`);
            query = query.eq('order_number', idInt);
        } else {
            console.log(`[MockLookup] Querying orders by order_number (string): ${id}`);
            query = query.eq('order_number', id);
        }
    }

    const { data: existingOrder, error: orderError } = await query.maybeSingle();

    if (orderError) console.error('[MockLookup] Orders Error:', orderError);
    if (existingOrder) console.log('[MockLookup] Found in orders:', existingOrder.id);
    else console.log('[MockLookup] Not found in orders.');

    let order = existingOrder;

    // --- 2. Check Upcoming Orders ---
    if (!order) {
        let upcomingQuery = supabaseAdmin
            .from('upcoming_orders')
            .select(`
                id, 
                order_number, 
                client_id, 
                scheduled_delivery_date,
                delivery_proof_url
            `);

        if (isUuid) {
            upcomingQuery = upcomingQuery.eq('id', id);
        } else {
            const idInt = parseInt(id, 10);
            if (!isNaN(idInt)) {
                console.log(`[MockLookup] Querying upcoming_orders by order_number (int): ${idInt}`);
                upcomingQuery = upcomingQuery.eq('order_number', idInt);
            } else {
                console.log(`[MockLookup] Querying upcoming_orders by order_number (string): ${id}`);
                upcomingQuery = upcomingQuery.eq('order_number', id);
            }
        }

        const { data: upcomingOrder, error: upcomingError } = await upcomingQuery.maybeSingle();

        if (upcomingError) console.error('[MockLookup] Upcoming Error:', upcomingError);

        if (upcomingOrder) {
            console.log('[MockLookup] Found in upcoming_orders:', upcomingOrder.id);
            order = {
                ...upcomingOrder,
                proof_of_delivery_image: upcomingOrder.delivery_proof_url
            };
        } else {
            console.log('[MockLookup] Not found in upcoming_orders.');
        }
    }

    // --- Result ---
    if (order) {
        console.log('SUCCESS: Order found.');
        console.log(order);
    } else {
        console.log('FAILURE: Order not found.');
    }
}

// Test with the problematic ID
mockPageLookup('100002');
