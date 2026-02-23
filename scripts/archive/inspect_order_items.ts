import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function inspect() {
    console.log('--- order_items ---');
    const { data, error } = await supabase.from('order_items').select('*').limit(1);
    console.log(data);
}

inspect();
