/**
 * Diagnose Supabase Connection Issues
 * Run with: node diagnose-supabase-connection.js
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { promises as dns } from 'dns';
import https from 'https';

console.log('🔍 Diagnosing Supabase Connection...\n');

// Load environment variables
let supabaseUrl = null;
let supabaseAnonKey = null;
let supabaseServiceKey = null;

const envFiles = ['.env.local', '.env'];
for (const envFile of envFiles) {
    try {
        const envPath = join(process.cwd(), envFile);
        const envContent = readFileSync(envPath, 'utf8');
        
        const lines = envContent.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) continue;
            
            const equalIndex = trimmed.indexOf('=');
            if (equalIndex === -1) continue;
            
            const key = trimmed.substring(0, equalIndex).trim();
            let value = trimmed.substring(equalIndex + 1).trim();
            
            // Remove quotes if present
            if ((value.startsWith('"') && value.endsWith('"')) || 
                (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            
            if (key === 'NEXT_PUBLIC_SUPABASE_URL') supabaseUrl = value;
            if (key === 'NEXT_PUBLIC_SUPABASE_ANON_KEY') supabaseAnonKey = value;
            if (key === 'SUPABASE_SERVICE_ROLE_KEY') supabaseServiceKey = value;
        }
        break;
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error(`Error reading ${envFile}:`, error.message);
        }
    }
}

if (!supabaseUrl) {
    console.log('❌ NEXT_PUBLIC_SUPABASE_URL not found in environment variables');
    process.exit(1);
}

console.log('📋 Configuration:');
console.log(`   Supabase URL: ${supabaseUrl}`);
console.log(`   Anon Key: ${supabaseAnonKey ? '✅ Set' : '❌ Missing'}`);
console.log(`   Service Key: ${supabaseServiceKey ? '✅ Set' : '❌ Missing'}`);
console.log('');

// Extract hostname from URL
let hostname;
try {
    const url = new URL(supabaseUrl);
    hostname = url.hostname;
    console.log(`   Hostname: ${hostname}`);
} catch (error) {
    console.log(`❌ Invalid URL format: ${supabaseUrl}`);
    console.log(`   Error: ${error.message}`);
    process.exit(1);
}

console.log('\n🔍 Testing DNS Resolution...');
try {
    const addresses = await dns.resolve4(hostname);
    console.log(`✅ DNS Resolution successful!`);
    console.log(`   IP Addresses: ${addresses.join(', ')}`);
} catch (error) {
    console.log(`❌ DNS Resolution FAILED!`);
    console.log(`   Error: ${error.message}`);
    console.log(`   Code: ${error.code}`);
    console.log('');
    console.log('💡 Possible causes:');
    console.log('   1. Supabase project has been paused or deleted');
    console.log('   2. Incorrect project URL in .env.local');
    console.log('   3. Network/DNS issue');
    console.log('   4. Project reference ID is wrong');
    console.log('');
    console.log('🔧 Solutions:');
    console.log('   1. Check your Supabase dashboard: https://app.supabase.com');
    console.log('   2. Verify the project is active (not paused)');
    console.log('   3. Copy the correct Project URL from Settings → API');
    console.log('   4. Update NEXT_PUBLIC_SUPABASE_URL in .env.local');
    process.exit(1);
}

console.log('\n🔍 Testing HTTPS Connection...');
try {
    await new Promise((resolve, reject) => {
        const req = https.request({
            hostname: hostname,
            port: 443,
            path: '/rest/v1/',
            method: 'GET',
            headers: {
                'apikey': supabaseAnonKey || 'test',
                'Authorization': `Bearer ${supabaseAnonKey || 'test'}`
            },
            timeout: 5000
        }, (res) => {
            console.log(`✅ HTTPS Connection successful!`);
            console.log(`   Status: ${res.statusCode}`);
            console.log(`   Headers: ${JSON.stringify(res.headers, null, 2)}`);
            resolve();
        });
        
        req.on('error', (error) => {
            reject(error);
        });
        
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Connection timeout'));
        });
        
        req.end();
    });
} catch (error) {
    console.log(`❌ HTTPS Connection FAILED!`);
    console.log(`   Error: ${error.message}`);
    console.log('');
    console.log('💡 This could indicate:');
    console.log('   - Network connectivity issues');
    console.log('   - Firewall blocking the connection');
    console.log('   - Supabase service is down');
}

console.log('\n✅ Diagnosis complete!');
