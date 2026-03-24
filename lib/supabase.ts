import { createClient } from '@supabase/supabase-js';
import { getSupabaseDbApiKey, getSupabaseDbKeySource, getSupabaseServerSecretKey } from './supabase-env';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabasePublishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServerSecret = getSupabaseServerSecretKey();

// New secret → publishable → legacy JWTs. Publishable before legacy avoids "Legacy API keys are disabled"
// when old service_role is still in .env but turned off in the dashboard.
const supabaseClientKey = getSupabaseDbApiKey();

if (process.env.NODE_ENV !== 'production') {
    const src = getSupabaseDbKeySource();
    console.log('[supabase] Environment check:');
    console.log(`  NEXT_PUBLIC_SUPABASE_URL: ${supabaseUrl ? '✅ Set' : '❌ Missing'}`);
    console.log(`  SUPABASE_SECRET_KEY (sb_secret_*): ${process.env.SUPABASE_SECRET_KEY ? '✅ Set' : '—'}`);
    console.log(
        `  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY: ${supabasePublishableKey ? '✅ Set' : '❌ Missing'}`
    );
    console.log(
        `  SUPABASE_SERVICE_ROLE_KEY (legacy JWT): ${process.env.SUPABASE_SERVICE_ROLE_KEY ? '✅ Set' : '—'}`
    );
    console.log(`  NEXT_PUBLIC_SUPABASE_ANON_KEY: ${supabaseAnonKey ? '✅ Set (legacy)' : '—'}`);
    console.log(
        `  [supabase] Active DB key source: ${src ?? 'none'} (secret > publishable > legacy service > legacy anon)`
    );

    if (supabaseUrl) {
        console.log(`  Supabase URL: ${supabaseUrl.substring(0, 30)}...`);
    }
    if (
        process.env.SUPABASE_SERVICE_ROLE_KEY &&
        src &&
        src !== 'legacy_service' &&
        src !== 'secret'
    ) {
        console.warn(
            '[supabase] 💡 Legacy SUPABASE_SERVICE_ROLE_KEY is set but not used (new key takes priority). If the dashboard disabled legacy keys, remove the old var from .env.local to avoid confusion.'
        );
    }
}

if (!supabaseUrl || !supabaseClientKey) {
    const missing: string[] = [];
    if (!supabaseUrl) missing.push('NEXT_PUBLIC_SUPABASE_URL');
    if (!getSupabaseDbApiKey()) {
        missing.push(
            'SUPABASE_SECRET_KEY, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY, or (legacy) SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY'
        );
    }
    console.error('[supabase] ❌ Missing environment variables:', missing.join(', '));
    throw new Error(`Missing Supabase environment variables: ${missing.join(', ')}`);
}

if (!supabaseServerSecret && process.env.NODE_ENV !== 'production') {
    console.warn(
        '[supabase] ⚠️  No SUPABASE_SECRET_KEY / SUPABASE_SERVICE_ROLE_KEY. Some admin-only actions may fail RLS; add sb_secret_* for full access.'
    );
}

let hostname: string | null = null;
try {
    const url = new URL(supabaseUrl);
    hostname = url.hostname;
} catch {
    console.error('[supabase] ❌ Invalid Supabase URL format:', supabaseUrl);
}

export const supabase = createClient(supabaseUrl, supabaseClientKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false,
    },
    db: {
        schema: 'public',
    },
    global: {
        headers: {
            'x-client-info': 'dietcombo-app',
        },
    },
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

export function isConnectionError(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const e = error as { message?: string; details?: string };
    const message = e.message || '';
    const details = e.details || '';
    const combined = `${message} ${details}`.toLowerCase();

    return (
        combined.includes('enotfound') ||
        combined.includes('getaddrinfo') ||
        combined.includes('dns') ||
        combined.includes('network') ||
        combined.includes('fetch failed')
    );
}

export function getConnectionErrorHelp(error: unknown): string {
    if (!isConnectionError(error)) return '';

    const e = error as { message?: string };
    const hostnameMatch = e.message?.match(/([a-z0-9]+\.supabase\.co)/);
    const host = hostnameMatch ? hostnameMatch[1] : 'your-project';

    return `
🔴 DNS/Connection Error Detected!

The hostname "${host}" cannot be resolved. This usually means:

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
