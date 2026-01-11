import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables from .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('=== Supabase Configuration Check ===\n');
console.log('Supabase URL:', supabaseUrl ? '✓ Set' : '✗ Missing');
console.log('Anon Key:', supabaseAnonKey ? '✓ Set' : '✗ Missing');
console.log('Service Role Key:', supabaseServiceKey ? '✓ Set' : '✗ Missing (will use anon key)');
console.log('');

if (!supabaseUrl || !supabaseAnonKey) {
    console.error('ERROR: Missing required Supabase environment variables!');
    process.exit(1);
}

// Test with anon key
console.log('=== Testing with Anon Key ===');
const anonClient = createClient(supabaseUrl, supabaseAnonKey);

async function testQueries(client: any, keyType: string) {
    console.log(`\n--- Testing queries with ${keyType} ---`);
    
    const tables = [
        'clients',
        'orders',
        'vendors',
        'menu_items',
        'upcoming_orders',
        'client_statuses',
        'box_types',
        'navigators'
    ];
    
    for (const table of tables) {
        try {
            const { data, error, count } = await client
                .from(table)
                .select('*', { count: 'exact', head: false })
                .limit(1);
            
            if (error) {
                console.log(`  ${table}: ✗ ERROR - ${error.message}`);
                if (error.code === 'PGRST301' || error.message.includes('permission denied') || error.message.includes('RLS')) {
                    console.log(`    → This looks like an RLS (Row Level Security) issue!`);
                }
            } else {
                const rowCount = count ?? data?.length ?? 0;
                console.log(`  ${table}: ✓ OK (${rowCount} rows)`);
            }
        } catch (err: any) {
            console.log(`  ${table}: ✗ EXCEPTION - ${err.message}`);
        }
    }
}

await testQueries(anonClient, 'ANON KEY');

// Test with service role key if available
if (supabaseServiceKey) {
    console.log('\n=== Testing with Service Role Key ===');
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
    await testQueries(serviceClient, 'SERVICE ROLE KEY');
} else {
    console.log('\n=== Service Role Key Not Available ===');
    console.log('⚠️  Without service role key, queries may fail if RLS is enabled.');
    console.log('   Set SUPABASE_SERVICE_ROLE_KEY environment variable to bypass RLS.');
}

// Check RLS status (requires service role key)
if (supabaseServiceKey) {
    console.log('\n=== Checking RLS Status ===');
    const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
    
    try {
        const { data, error } = await serviceClient.rpc('exec_sql', {
            query: `
                SELECT 
                    schemaname,
                    tablename,
                    rowsecurity as rls_enabled
                FROM pg_tables t
                LEFT JOIN pg_class c ON c.relname = t.tablename
                LEFT JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE schemaname = 'public'
                AND tablename IN (
                    'clients', 'orders', 'vendors', 'menu_items', 
                    'upcoming_orders', 'client_statuses', 'box_types', 'navigators'
                )
                ORDER BY tablename;
            `
        });
        
        if (error) {
            // Try alternative method
            console.log('  (Could not check RLS status via RPC, trying direct query...)');
        } else if (data) {
            console.log('  RLS Status:');
            data.forEach((row: any) => {
                console.log(`    ${row.tablename}: ${row.rls_enabled ? 'ENABLED ⚠️' : 'DISABLED ✓'}`);
            });
        }
    } catch (err: any) {
        console.log('  (Could not check RLS status - this is normal if RPC is not available)');
    }
}

console.log('\n=== Recommendations ===');
if (!supabaseServiceKey) {
    console.log('1. Set SUPABASE_SERVICE_ROLE_KEY environment variable');
    console.log('2. This will allow queries to bypass RLS policies');
}
console.log('3. If RLS is enabled, either:');
console.log('   a) Disable RLS on tables (if not needed)');
console.log('   b) Add permissive policies for anon key');
console.log('   c) Use service role key for server-side queries');
