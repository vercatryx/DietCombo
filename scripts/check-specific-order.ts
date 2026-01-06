
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

async function listOrders() {
    console.log('Listing recent orders...');
    const { data, error } = await supabaseAdmin
        .from('orders')
        .select('id, order_number, created_at')
        .order('created_at', { ascending: false })
        .limit(20);

    if (data) {
        console.table(data);
    } else {
        console.error(error);
    }
}

async function checkOrder(id: string) {
    console.log(`Checking order: "${id}"`);

    // Check by number
    const { data: byNum, error: errNum } = await supabaseAdmin
        .from('orders')
        .select('*')
        .eq('order_number', parseInt(id))
        .maybeSingle();

    if (byNum) {
        console.log('Found by Number (int):', byNum.id);
        return;
    } else {
        console.log('Not found by Number (int). Error:', errNum);
    }

    // Check by string just in case
    const { data: byStr, error: errStr } = await supabaseAdmin
        .from('orders')
        .select('*')
        .eq('order_number', id)
        .maybeSingle();

    if (byStr) {
        console.log('Found by Number (string):', byStr.id);
    } else {
        console.log('Not found by Number (string). Error:', errStr);
    }
}

checkOrder('100005');
listOrders();
