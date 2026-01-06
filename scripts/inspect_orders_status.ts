// Inspect orders with status values not allowed by the constraint
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

// Load required env vars
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
    console.error('Supabase URL or service key missing in environment variables.');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey);

async function main() {
    const { data, error } = await supabase
        .from('orders')
        .select('id, status')
        .neq('status', 'scheduled')
        .neq('status', 'processed')
        .neq('status', 'delivered');

    if (error) {
        console.error('Error fetching orders:', error);
        return;
    }
    console.log('Orders with unexpected status:', data);
}

main();
