import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    console.log('--- Box Types ---');
    const { data: bTypes } = await supabase.from('box_types').select('*');
    console.log(bTypes);

    console.log('\n--- Menu Items (vendorId is null) ---');
    const { data: items } = await supabase.from('menu_items').select('*').is('vendor_id', null);
    console.log(items);
}

check();
