import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

// Load environment variables
try {
    const envConfig = readFileSync('.env.local', 'utf8');
    envConfig.split('\n').forEach(line => {
        const [key, ...values] = line.split('=');
        if (key && values.length > 0) {
            const value = values.join('=').trim();
            process.env[key.trim()] = value.replace(/^["']|["']$/g, '');
        }
    });
} catch (e) {
    console.error('Error loading .env.local:', e);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

console.log('=== Supabase Configuration Check ===\n');
console.log('NEXT_PUBLIC_SUPABASE_URL:', supabaseUrl ? '✅ Set' : '❌ Missing');
console.log('NEXT_PUBLIC_SUPABASE_ANON_KEY:', supabaseAnonKey ? '✅ Set' : '❌ Missing');
console.log('SUPABASE_SERVICE_ROLE_KEY:', supabaseServiceKey ? '✅ Set' : '❌ Missing');
console.log('\n=== Using Service Role Key:', supabaseServiceKey ? 'YES ✅' : 'NO ❌ (RLS may block queries) ===\n');

if (!supabaseUrl || (!supabaseAnonKey && !supabaseServiceKey)) {
    console.error('❌ Missing required environment variables!');
    process.exit(1);
}

const supabaseKey = supabaseServiceKey || supabaseAnonKey!;
const supabase = createClient(supabaseUrl!, supabaseKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    },
    db: {
        schema: 'public'
    }
});

// Also test with explicit service role key
let supabaseAdmin: ReturnType<typeof createClient> | null = null;
if (supabaseServiceKey) {
    supabaseAdmin = createClient(supabaseUrl!, supabaseServiceKey, {
        auth: {
            autoRefreshToken: false,
            persistSession: false
        },
        db: {
            schema: 'public' as any
        } as any
    });
}

async function diagnose() {
    console.log('Service Role Key (first 20 chars):', supabaseServiceKey?.substring(0, 20) + '...');
    console.log('Anon Key (first 20 chars):', supabaseAnonKey?.substring(0, 20) + '...');
    console.log('Using key type:', supabaseServiceKey ? 'SERVICE_ROLE' : 'ANON');
    console.log('\n');
    console.log('=== Testing Database Queries ===\n');

    // Test 1: Check clients table with default client
    console.log('1. Testing clients table with default client...');
    const { data: clients, error: clientsError, count: clientsCount } = await supabase
        .from('clients')
        .select('*', { count: 'exact' })
        .limit(5);
    
    if (clientsError) {
        console.error('   ❌ Error:', clientsError.message);
        console.error('   Code:', clientsError.code);
        console.error('   Details:', clientsError.details);
        console.error('   Hint:', clientsError.hint);
        if (clientsError.code === 'PGRST301' || clientsError.message?.includes('permission denied') || clientsError.message?.includes('RLS')) {
            console.error('\n   ⚠️  RLS (Row Level Security) is blocking this query!');
            console.error('   Solution: Set SUPABASE_SERVICE_ROLE_KEY in .env.local');
        }
    } else {
        console.log(`   ✅ Success: Found ${clientsCount || clients?.length || 0} clients (showing first 5)`);
        if (clients && clients.length > 0) {
            console.log('   Sample client:', { id: clients[0].id, full_name: clients[0].full_name });
        }
    }

    // Test 2: Check vendors table
    console.log('\n2. Testing vendors table...');
    const { data: vendors, error: vendorsError } = await supabase
        .from('vendors')
        .select('*')
        .limit(5);
    
    if (vendorsError) {
        console.error('   ❌ Error:', vendorsError.message);
        console.error('   Code:', vendorsError.code);
    } else {
        console.log(`   ✅ Success: Found ${vendors?.length || 0} vendors`);
        if (vendors && vendors.length > 0) {
            console.log('   Sample vendor:', { id: vendors[0].id, name: vendors[0].name });
        }
    }

    // Test 3: Check orders table
    console.log('\n3. Testing orders table...');
    const { data: orders, error: ordersError, count: ordersCount } = await supabase
        .from('orders')
        .select('*', { count: 'exact' })
        .limit(5);
    
    if (ordersError) {
        console.error('   ❌ Error:', ordersError.message);
        console.error('   Code:', ordersError.code);
    } else {
        console.log(`   ✅ Success: Found ${ordersCount || orders?.length || 0} orders`);
    }

    // Test 4: Check menu_items table
    console.log('\n4. Testing menu_items table...');
    const { data: menuItems, error: menuItemsError } = await supabase
        .from('menu_items')
        .select('*')
        .limit(5);
    
    if (menuItemsError) {
        console.error('   ❌ Error:', menuItemsError.message);
        console.error('   Code:', menuItemsError.code);
    } else {
        console.log(`   ✅ Success: Found ${menuItems?.length || 0} menu items`);
    }

    // Test 5: Try with explicit admin client if available
    if (supabaseAdmin) {
        console.log('\n5. Testing with explicit admin client (service role only)...');
        const { data: adminClients, error: adminError, count: adminCount } = await supabaseAdmin
            .from('clients')
            .select('*', { count: 'exact' })
            .limit(5);
        
        if (adminError) {
            console.error('   ❌ Admin client error:', adminError.message);
            console.error('   Code:', adminError.code);
        } else {
            console.log(`   ✅ Admin client success: Found ${adminCount || adminClients?.length || 0} clients`);
        }
    }

    // Test 6: Check if we can query information_schema (low-level DB access test)
    console.log('\n6. Testing database-level permissions (information_schema)...');
    try {
        const { data: schemaTest, error: schemaError } = await supabase.rpc('version');
        if (schemaError) {
            // Try a direct query test
            const { error: directError } = await supabase.from('information_schema.tables').select('table_name').limit(1);
            if (directError) {
                console.log('   ⚠️  Cannot access information_schema (expected for Supabase REST API)');
            } else {
                console.log('   ✅ Can access information_schema');
            }
        } else {
            console.log('   ✅ RPC call succeeded');
        }
    } catch (e) {
        console.log('   ⚠️  RPC not available (this is normal)');
    }

    console.log('\n=== Diagnosis Complete ===');
    
    if (clientsError && clientsError.code === '42501') {
        console.log('\n🔍 ANALYSIS:');
        console.log('   Error 42501 = PostgreSQL permission denied for schema public');
        console.log('   This means the database roles (anon, authenticated, service_role) don\'t have');
        console.log('   proper GRANT permissions on the public schema.');
        console.log('\n   ✅ RECOMMENDED FIX:');
        console.log('   1. Open your Supabase dashboard > SQL Editor');
        console.log('   2. Run the SQL script: sql/fix-schema-permissions.sql');
        console.log('   3. This will grant USAGE and ALL privileges on the public schema to all roles');
        console.log('   4. After running the script, test the connection again');
        console.log('\n   Alternative: If you have database admin access, you can run:');
        console.log('   GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;');
        console.log('   GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;');
        console.log('\n   See: https://supabase.com/docs/guides/troubleshooting/database-api-42501-errors');
    }
}

diagnose().catch(console.error);