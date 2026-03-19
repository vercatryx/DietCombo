import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Debug logging for environment variables
if (process.env.NODE_ENV !== 'production') {
    console.log('[supabase] Environment check:');
    console.log(`  NEXT_PUBLIC_SUPABASE_URL: ${supabaseUrl ? '✅ Set' : '❌ Missing'}`);
    console.log(`  NEXT_PUBLIC_SUPABASE_ANON_KEY: ${supabaseAnonKey ? '✅ Set' : '❌ Missing'}`);
    console.log(`  SUPABASE_SERVICE_ROLE_KEY: ${supabaseServiceKey ? '✅ Set' : '⚠️  Missing (will use anon key)'}`);
    
    if (supabaseUrl) {
        console.log(`  Supabase URL: ${supabaseUrl.substring(0, 30)}...`);
    }
}

// Prioritize service role key for server-side operations to bypass RLS
// If service role key is not available, fall back to anon key (may fail if RLS is enabled)
const supabaseKey = supabaseServiceKey || supabaseAnonKey;

if (!supabaseUrl || !supabaseKey) {
    const missing = [];
    if (!supabaseUrl) missing.push('NEXT_PUBLIC_SUPABASE_URL');
    if (!supabaseAnonKey) missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    if (!supabaseServiceKey && !supabaseAnonKey) missing.push('SUPABASE_SERVICE_ROLE_KEY (or ANON_KEY)');
    console.error('[supabase] ❌ Missing environment variables:', missing.join(', '));
    throw new Error(`Missing Supabase environment variables: ${missing.join(', ')}`);
}

// Log warning if service role key is not set (RLS may block queries)
if (!supabaseServiceKey && process.env.NODE_ENV !== 'production') {
    console.warn('[supabase] ⚠️  SUPABASE_SERVICE_ROLE_KEY not set. Using anon key. Queries may fail if RLS is enabled.');
    console.warn('[supabase] 💡 To fix: Add SUPABASE_SERVICE_ROLE_KEY to your .env.local file');
}

// Extract hostname for validation
let hostname: string | null = null;
try {
    const url = new URL(supabaseUrl);
    hostname = url.hostname;
} catch (error) {
    console.error('[supabase] ❌ Invalid Supabase URL format:', supabaseUrl);
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    },
    db: {
        schema: 'public'
    },
    global: {
        headers: {
            'x-client-info': 'dietcombo-app'
        }
    }
});

/**
 * Paginate through all rows for a query that may exceed Supabase's 1000-row default limit.
 * Usage: const rows = await fetchAllRows(sb => sb.from('orders').select('id, name').eq('status', 'active'));
 */
export async function fetchAllRows<T = any>(
    buildQuery: (sb: typeof supabase) => any,
    pageSize = 1000
): Promise<T[]> {
    const allData: T[] = [];
    let from = 0;
    while (true) {
        const { data, error } = await buildQuery(supabase).range(from, from + pageSize - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        allData.push(...data);
        if (data.length < pageSize) break;
        from += pageSize;
    }
    return allData;
}

// Helper function to check for DNS/connection errors
export function isConnectionError(error: any): boolean {
    if (!error) return false;
    const message = error.message || '';
    const details = error.details || '';
    const combined = `${message} ${details}`.toLowerCase();
    
    return (
        combined.includes('enotfound') ||
        combined.includes('getaddrinfo') ||
        combined.includes('dns') ||
        combined.includes('network') ||
        combined.includes('fetch failed')
    );
}

// Helper function to provide helpful error messages
export function getConnectionErrorHelp(error: any): string {
    if (!isConnectionError(error)) return '';
    
    const hostnameMatch = error.message?.match(/([a-z0-9]+\.supabase\.co)/);
    const hostname = hostnameMatch ? hostnameMatch[1] : 'your-project';
    
    return `
🔴 DNS/Connection Error Detected!

The hostname "${hostname}" cannot be resolved. This usually means:

1. 🛡️  Cloudflare WARP is blocking (if you have WARP enabled)
   → Configure WARP Split Tunneling to exclude *.supabase.co
   → Or pause WARP temporarily for development
   → See CLOUDFLARE_WARP_FIX.md for details

2. ⏸️  Supabase project is PAUSED
   → Go to https://app.supabase.com and restore your project

3. ❌ Project was DELETED
   → Check if project still exists in Supabase dashboard

4. 🔗 Incorrect project URL
   → Verify NEXT_PUBLIC_SUPABASE_URL in .env.local matches your project

5. 🌐 Network/DNS issue
   → Check your internet connection

Quick fix: If using WARP, exclude Supabase from WARP or pause it temporarily.
`;
}
