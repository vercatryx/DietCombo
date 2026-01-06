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
    console.log('Inspecting admins table...');
    const { data, error } = await supabase
        .from('admins')
        .select('*')
        .limit(1);

    if (error) {
        console.error('Error fetching admins:', error);
    } else if (data && data.length > 0) {
        console.log('Admin Record Keys:', Object.keys(data[0]));
        console.log('Full Record:', data[0]);
    } else {
        console.log('No admins found to inspect (or table empty).');
    }

    // Also try to just insert a dummy with email to see if it fails if we are not sure
    // But selecting should be enough if there are rows.
}

inspect();
