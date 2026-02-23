import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function check() {
    console.log('--- upcoming_orders columns ---');
    const { data, error } = await supabase.rpc('get_table_info', { table_name: 'upcoming_orders' });
    // If rpc not available, use standard query
    const { data: cols } = await supabase.from('upcoming_orders').select('*').limit(1);
    console.log(Object.keys(cols?.[0] || {}));
}

check();
