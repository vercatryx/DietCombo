/**
 * Check Environment Variables for Supabase
 * Run with: node check-env.ts
 */

import { readFileSync } from 'fs';
import { join } from 'path';

console.log('🔍 Checking Environment Variables...\n');

// Try to load .env.local first, then .env
let envLoaded = false;
const envFiles = ['.env.local', '.env'];

for (const envFile of envFiles) {
    try {
        const envPath = join(process.cwd(), envFile);
        const envContent = readFileSync(envPath, 'utf8');
        
        console.log(`📄 Found ${envFile}:`);
        
        // Parse env file
        const lines = envContent.split('\n');
        const envVars: Record<string, string> = {};
        
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
            
            envVars[key] = value;
        }
        
        // Check required Supabase variables
        const requiredVars = [
            'NEXT_PUBLIC_SUPABASE_URL',
            'NEXT_PUBLIC_SUPABASE_ANON_KEY',
            'SUPABASE_SERVICE_ROLE_KEY'
        ];
        
        console.log('\n✅ Environment Variables Found:');
        for (const key of requiredVars) {
            const value = envVars[key];
            if (value) {
                // Mask sensitive values
                const masked = key.includes('KEY') || key.includes('PASSWORD') 
                    ? `${value.substring(0, 10)}...${value.substring(value.length - 4)}` 
                    : value;
                console.log(`   ${key}: ${masked}`);
            } else {
                console.log(`   ${key}: ❌ MISSING`);
            }
        }
        
        // Check admin variables
        console.log('\n👤 Admin Variables:');
        const adminVars = ['ADMIN_USERNAME', 'ADMIN_PASSWORD'];
        for (const key of adminVars) {
            const value = envVars[key];
            if (value) {
                const masked = key === 'ADMIN_PASSWORD' 
                    ? '***' 
                    : value;
                console.log(`   ${key}: ${masked}`);
            } else {
                console.log(`   ${key}: ⚠️  Not set (optional)`);
            }
        }
        
        envLoaded = true;
        break;
        
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            continue; // File doesn't exist, try next
        } else {
            console.error(`Error reading ${envFile}:`, error.message);
        }
    }
}

if (!envLoaded) {
    console.log('❌ No .env.local or .env file found!');
    console.log('\n📝 Create a .env.local file with:');
    console.log('   NEXT_PUBLIC_SUPABASE_URL=your_supabase_url');
    console.log('   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key');
    console.log('   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key');
    console.log('   ADMIN_USERNAME=admin');
    console.log('   ADMIN_PASSWORD=admin123');
}

// Also check process.env (what Next.js actually sees)
console.log('\n🔍 Process Environment (what Next.js sees):');
const requiredVars = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY'
];

let allPresent = true;
for (const key of requiredVars) {
    const value = process.env[key];
    if (value) {
        const masked = key.includes('KEY') 
            ? `${value.substring(0, 10)}...${value.substring(value.length - 4)}` 
            : value;
        console.log(`   ${key}: ✅ ${masked}`);
    } else {
        console.log(`   ${key}: ❌ NOT SET`);
        allPresent = false;
    }
}

if (!allPresent) {
    console.log('\n⚠️  WARNING: Some required environment variables are missing!');
    console.log('   Next.js loads .env.local automatically, but you may need to:');
    console.log('   1. Create .env.local file with the variables');
    console.log('   2. Restart your Next.js dev server');
    console.log('   3. Variables starting with NEXT_PUBLIC_ are available in browser');
    console.log('   4. Other variables are only available server-side');
} else {
    console.log('\n✅ All required environment variables are set!');
}
