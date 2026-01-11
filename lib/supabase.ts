import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Prioritize service role key for server-side operations to bypass RLS
// If service role key is not available, fall back to anon key (may fail if RLS is enabled)
const supabaseKey = supabaseServiceKey || supabaseAnonKey;

if (!supabaseUrl || !supabaseKey) {
    const missing = [];
    if (!supabaseUrl) missing.push('NEXT_PUBLIC_SUPABASE_URL');
    if (!supabaseAnonKey) missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    if (!supabaseServiceKey && !supabaseAnonKey) missing.push('SUPABASE_SERVICE_ROLE_KEY (or ANON_KEY)');
    throw new Error(`Missing Supabase environment variables: ${missing.join(', ')}`);
}

// Log warning if service role key is not set (RLS may block queries)
if (!supabaseServiceKey && process.env.NODE_ENV !== 'production') {
    console.warn('⚠️  SUPABASE_SERVICE_ROLE_KEY not set. Using anon key. Queries may fail if RLS is enabled.');
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});
