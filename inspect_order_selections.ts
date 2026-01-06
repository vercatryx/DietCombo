import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function inspect() {
    console.log('--- order_vendor_selections ---');
    const { data: vData, error: vError } = await supabase.from('order_vendor_selections').select('*').limit(1);
    console.log(vData);

    console.log('\n--- order_box_selections ---');
    const { data: bData, error: bError } = await supabase.from('order_box_selections').select('*').limit(1);
    console.log(bData);
    
    console.log('\n--- upcoming_orders ---');
    const { data: uData, error: uError } = await supabase.from('upcoming_orders').select('*').limit(1);
    console.log(uData);
}

inspect();
