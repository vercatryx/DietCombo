
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function inspectRecentOrders() {
    console.log('--- INSPECTING RECENT ORDERS ---');

    // Get last 5 orders
    const { data: orders, error } = await supabase
        .from('orders')
        .select(`
            id, 
            order_number, 
            scheduled_delivery_date, 
            created_at, 
            client_id,
            total_value
        `)
        .order('created_at', { ascending: false })
        .limit(5);

    if (error) {
        console.error('Error fetching orders:', error);
        return;
    }

    if (!orders || orders.length === 0) {
        console.log('No orders found.');
        return;
    }

    for (const order of orders) {
        console.log(`\nOrder #${order.order_number} (ID: ${order.id})`);
        console.log(`Created At: ${order.created_at}`);
        console.log(`Scheduled Delivery: ${order.scheduled_delivery_date} (${new Date(order.scheduled_delivery_date).toLocaleDateString('en-US', { weekday: 'long' })})`); // Verify weekday
        console.log(`Client ID: ${order.client_id}`);

        // Get corresponding upcoming order to check delivery_day
        const { data: upcoming, error: upError } = await supabase
            .from('upcoming_orders')
            .select('delivery_day, service_type')
            .eq('client_id', order.client_id)
            .maybeSingle(); // Note: there might be multiple or none if it was deleted, but usually 1 per client/day logic now?

        if (upcoming) {
            console.log(`Source Upcoming Order: Delivery Day = ${upcoming.delivery_day}, Service Type = ${upcoming.service_type}`);
        } else {
            console.log(`Source Upcoming Order: NOT FOUND (or multiple)`);
        }
    }
}

inspectRecentOrders();
