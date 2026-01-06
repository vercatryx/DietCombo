
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

async function checkUpcoming() {
    console.log('Checking upcoming_orders table...');

    // Check columns first (by fetching one)
    const { data: sample } = await supabaseAdmin.from('upcoming_orders').select('*').limit(1);
    if (sample && sample.length > 0) {
        console.log('Upcoming keys:', Object.keys(sample[0]));
    }

    // List recent upcoming orders
    const { data: upcoming, error } = await supabaseAdmin
        .from('upcoming_orders')
        .select('id, client_id, status, order_number, created_at')
        .order('created_at', { ascending: false })
        .limit(20);

    if (error) {
        console.error('Error fetching upcoming:', error);
    } else {
        console.log('Recent Upcoming Orders:');
        console.table(upcoming);
    }
}

checkUpcoming();
