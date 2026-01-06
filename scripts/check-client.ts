
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase credentials');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkClient() {
    console.log('Checking for client with ID: CLIENT-005');

    // Check if ID exists
    const { data: client, error } = await supabase
        .from('clients')
        .select('*')
        .eq('id', 'CLIENT-005')
        .maybeSingle();

    if (error) {
        console.error('Error fetching client:', error);
    } else {
        console.log('Client result:', client);
    }

    // List first 5 clients to see ID format
    console.log('\nScanning first 5 clients to check ID format:');
    const { data: clients } = await supabase.from('clients').select('id, full_name').limit(5);
    console.log(clients);
}

checkClient();
