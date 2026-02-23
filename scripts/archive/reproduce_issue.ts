
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

// Load env
try {
    const envConfig = readFileSync('.env.local', 'utf8');
    envConfig.split('\n').forEach(line => {
        const [key, ...values] = line.split('=');
        if (key && values.length > 0) {
            const value = values.join('=').trim();
            process.env[key.trim()] = value.replace(/^["']|["']$/g, '');
        }
    });
} catch (e) {
    console.error('Error loading .env.local', e);
}

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

async function run() {
    console.log('Creating a new client...');

    const { data: newClient, error } = await supabase
        .from('clients')
        .insert([{
            full_name: 'Test Client ' + Date.now(),
            service_type: 'Food',
            upcoming_order: {}
        }])
        .select()
        .single();

    if (error) {
        console.error('Error creating client:', error);
        return;
    }

    console.log('Created Client ID:', newClient.id);
    console.log('ID Data Type:', typeof newClient.id);

    // Check for "ghost" upcoming orders immediately
    const { data: upcomingOrders } = await supabase
        .from('upcoming_orders')
        .select('*')
        .eq('client_id', newClient.id);

    console.log('Upcoming Orders for new client:', upcomingOrders);

    if (upcomingOrders && upcomingOrders.length > 0) {
        console.log('ISSUE REPRODUCED: Found ghost upcoming orders for fresh client ID');
    } else {
        console.log('No ghost orders found on creation.');
    }

    // Clean up
    await supabase.from('clients').delete().eq('id', newClient.id);
}

run();
