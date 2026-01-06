
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

// Load .env.local manually
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf-8');
    envConfig.split('\n').forEach(line => {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
            const key = match[1].trim();
            const value = match[2].trim().replace(/^['"]|['"]$/g, ''); // Remove quotes if present
            process.env[key] = value;
        }
    });
} else {
    console.log('No .env.local found');
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
    console.log('Inspecting box_types table...');

    // Attempt to insert a dummy record with only name to see if it works or returns error
    // We can't easily "describe" table via Postgrest client without error induction or knowing the system API (which is restricted usually)
    // But we can try to select * limit 1 and see what we get.

    const { data, error } = await supabase.from('box_types').select('*').limit(1);

    if (error) {
        console.error('Error selecting:', error);
    } else {
        console.log('Select success. Data:', data);
        if (data && data.length > 0) {
            console.log('Columns:', Object.keys(data[0]));
        } else {
            console.log('Table is empty. Attempting insert to find missing columns is risky potentially, but let\'s try to just select dummy column.');
        }
    }

    // Now let's try to verify if 'vendor_id' exists by selecting it explicitly
    const { error: colError } = await supabase.from('box_types').select('vendor_id').limit(1);
    if (colError) {
        console.error("Checking 'vendor_id' column failed:", colError.message);
    } else {
        console.log("'vendor_id' column exists!");
    }

    // Now let's try to verify if 'vendor_ids' exists by selecting it explicitly
    const { error: colErrorIds } = await supabase.from('box_types').select('vendor_ids').limit(1);
    if (colErrorIds) {
        console.error("Checking 'vendor_ids' column failed:", colErrorIds.message);
    } else {
        console.log("'vendor_ids' column exists!");
    }

    // Check for box_type_vendors
    const { error: tableError } = await supabase.from('box_type_vendors').select('*').limit(1);
    if (tableError) {
        console.error("Checking 'box_type_vendors' table failed:", tableError.message);
    } else {
        console.log("'box_type_vendors' table exists!");
    }
}

main();
