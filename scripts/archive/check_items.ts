import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    console.log('--- Menu Items (vendor_id IS NULL) ---');
    const { data, error } = await supabase.from('menu_items').select('*').is('vendor_id', null);
    if (error) console.error(error);
    else console.log('Found', data?.length, 'items');
    
    console.log('\n--- First Item Detail ---');
    if (data && data.length > 0) console.log(data[0]);

    console.log('\n--- Box Types ---');
    const { data: btypes, error: berror } = await supabase.from('box_types').select('*').eq('is_active', true);
    if (berror) console.error(berror);
    else console.log('Found', btypes?.length, 'active box types');
}

check();
