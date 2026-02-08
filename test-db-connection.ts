/**
 * Test script to verify Supabase database connection
 * Run with: npx tsx test-db-connection.ts
 */

import { supabase } from './lib/supabase';

async function testConnection() {
    console.log('🔍 Testing Supabase database connection...\n');

    // Test 1: Check environment variables
    console.log('1. Checking environment variables:');
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    console.log(`   NEXT_PUBLIC_SUPABASE_URL: ${supabaseUrl ? '✅ Set' : '❌ Missing'}`);
    console.log(`   NEXT_PUBLIC_SUPABASE_ANON_KEY: ${supabaseAnonKey ? '✅ Set' : '❌ Missing'}`);
    console.log(`   SUPABASE_SERVICE_ROLE_KEY: ${supabaseServiceKey ? '✅ Set (using service role)' : '⚠️  Missing (using anon key - RLS may block queries)'}`);
    console.log('');

    // Test 2: Test basic connection
    console.log('2. Testing basic connection:');
    try {
        const { data, error } = await supabase.from('clients').select('count').limit(1);
        if (error) {
            console.log(`   ❌ Connection failed: ${error.message}`);
            console.log(`   Error code: ${error.code}`);
            console.log(`   Error details: ${JSON.stringify(error.details, null, 2)}`);
            console.log(`   Error hint: ${error.hint}`);
            
            if (error.code === 'PGRST301' || error.message?.includes('permission denied')) {
                console.log('\n   💡 This looks like an RLS (Row Level Security) issue.');
                console.log('   Solutions:');
                console.log('   1. Set SUPABASE_SERVICE_ROLE_KEY environment variable');
                console.log('   2. Or disable RLS on the tables (not recommended for production)');
                console.log('   3. Or add permissive RLS policies');
            }
        } else {
            console.log('   ✅ Connection successful!');
        }
    } catch (err: any) {
        console.log(`   ❌ Connection error: ${err.message}`);
    }
    console.log('');

    // Test 3: Test querying clients table
    console.log('3. Testing clients table query:');
    try {
        const { data: clients, error: clientsError } = await supabase
            .from('clients')
            .select('id, email')
            .not('email', 'is', null)
            .limit(5);
        
        if (clientsError) {
            console.log(`   ❌ Query failed: ${clientsError.message}`);
            console.log(`   Error code: ${clientsError.code}`);
            console.log(`   Error details: ${JSON.stringify(clientsError.details, null, 2)}`);
        } else {
            console.log(`   ✅ Query successful! Found ${clients?.length || 0} clients with emails (showing first 5)`);
            if (clients && clients.length > 0) {
                clients.forEach((c, i) => {
                    console.log(`      ${i + 1}. Client ID: ${c.id}, Email: ${c.email}`);
                });
            }
        }
    } catch (err: any) {
        console.log(`   ❌ Query error: ${err.message}`);
    }
    console.log('');

    // Test 4: Test querying admins table
    console.log('4. Testing admins table query:');
    try {
        const { data: admins, error: adminsError } = await supabase
            .from('admins')
            .select('id, username')
            .limit(5);
        
        if (adminsError) {
            console.log(`   ❌ Query failed: ${adminsError.message}`);
            console.log(`   Error code: ${adminsError.code}`);
        } else {
            console.log(`   ✅ Query successful! Found ${admins?.length || 0} admins (showing first 5)`);
            if (admins && admins.length > 0) {
                admins.forEach((a, i) => {
                    console.log(`      ${i + 1}. Admin ID: ${a.id}, Username: ${a.username}`);
                });
            }
        }
    } catch (err: any) {
        console.log(`   ❌ Query error: ${err.message}`);
    }
    console.log('');

    // Test 5: Test querying vendors table
    console.log('5. Testing vendors table query:');
    try {
        const { data: vendors, error: vendorsError } = await supabase
            .from('vendors')
            .select('id, email')
            .not('email', 'is', null)
            .limit(5);
        
        if (vendorsError) {
            console.log(`   ❌ Query failed: ${vendorsError.message}`);
            console.log(`   Error code: ${vendorsError.code}`);
        } else {
            console.log(`   ✅ Query successful! Found ${vendors?.length || 0} vendors with emails (showing first 5)`);
            if (vendors && vendors.length > 0) {
                vendors.forEach((v, i) => {
                    console.log(`      ${i + 1}. Vendor ID: ${v.id}, Email: ${v.email}`);
                });
            }
        }
    } catch (err: any) {
        console.log(`   ❌ Query error: ${err.message}`);
    }
    console.log('');

    // Test 6: Test querying navigators table
    console.log('6. Testing navigators table query:');
    try {
        const { data: navigators, error: navigatorsError } = await supabase
            .from('navigators')
            .select('id, email')
            .not('email', 'is', null)
            .limit(5);
        
        if (navigatorsError) {
            console.log(`   ❌ Query failed: ${navigatorsError.message}`);
            console.log(`   Error code: ${navigatorsError.code}`);
        } else {
            console.log(`   ✅ Query successful! Found ${navigators?.length || 0} navigators with emails (showing first 5)`);
            if (navigators && navigators.length > 0) {
                navigators.forEach((n, i) => {
                    console.log(`      ${i + 1}. Navigator ID: ${n.id}, Email: ${n.email}`);
                });
            }
        }
    } catch (err: any) {
        console.log(`   ❌ Query error: ${err.message}`);
    }
    console.log('');

    console.log('✅ Database connection test complete!');
}

testConnection().catch(console.error);
