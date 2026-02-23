import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

try {
    const envConfig = readFileSync('.env.local', 'utf8');
    envConfig.split('\n').forEach(line => {
        const [key, ...values] = line.split('=');
        if (key && values.length > 0) {
            const value = values.join('=').trim();
            // Remove quotes if present
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


async function inspect() {
    console.log('Inspecting vendors table...');
    const { data, error } = await supabase
        .from('vendors')
        .select('*')
        .limit(1);

    if (error) {
        console.error('Error fetching vendors:', error);
    } else if (data && data.length > 0) {
        console.log('Vendor Record Keys:', Object.keys(data[0]));
        console.log('Full Record:', data[0]);
    } else {
        console.log('No vendors found to inspect (or table empty).');
    }
}

inspect();
