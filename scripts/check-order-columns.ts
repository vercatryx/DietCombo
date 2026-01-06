

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

async function checkColumns() {
    console.log('Checking orders table columns...');
    const { data, error } = await supabaseAdmin
        .from('orders')
        .select('*')
        .limit(1);

    if (error) {
        console.error('Error:', error);
        return;
    }

    if (data && data.length > 0) {
        console.log('Found order keys:', Object.keys(data[0]));
        console.log('Sample order:', data[0]);
    } else {
        console.log('No orders found to inspect.');
    }
}

checkColumns();
