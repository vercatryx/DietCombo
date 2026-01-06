import { createClient } from '@supabase/supabase-js';

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function checkOrder() {
    console.log('Checking order 100002...');
    const { data: order, error } = await supabase
        .from('orders')
        .select('*')
        .eq('order_number', 100002)
        .single();

    if (error) {
        console.error('Error fetching order:', error);
    } else {
        console.log('Order found:', {
            id: order.id,
            status: order.status,
            client_id: order.client_id,
            proof_of_delivery_image: order.proof_of_delivery_image,
            scheduled_delivery_date: order.scheduled_delivery_date
        });
    }

    // Also check upcoming orders for this client to see if fallback is happening
    if (order) {
        console.log('Checking upcoming orders for client:', order.client_id);
        const { data: upcoming, error: upError } = await supabase
            .from('upcoming_orders')
            .select('*')
            .eq('client_id', order.client_id)
            .eq('status', 'scheduled');

        if (upError) console.error('Error fetching upcoming:', upError);
        else console.log('Upcoming orders found:', upcoming.length);
    }
}

checkOrder();
