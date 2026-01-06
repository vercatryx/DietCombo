
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function inspectSchema() {
    console.log('Inspecting orders table schema...');

    // We can't legally query information_schema easily with just the JS client usually, 
    // but we can try to insert a dummy row or just fetch one and see properties.
    // Better yet, we can try to call a postgres function if we had one.
    // Or just try to select * limit 1 and print keys.

    const { data, error } = await supabase.from('orders').select('*').limit(1);

    if (error) {
        console.error('Error fetching orders:', error);
        return;
    }

    if (data && data.length > 0) {
        console.log('Sample Order Row Keys:', Object.keys(data[0]));
        console.log('Sample Order Row:', JSON.stringify(data[0], null, 2));
    } else {
        console.log('Orders table is empty.');
    }

    // Also check if there is an existing sequence or numeric id
}

inspectSchema();
