import * as fs from 'fs';
import * as path from 'path';

// Load .env.local
const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf-8');
    envConfig.split('\n').forEach(line => {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
            const key = match[1].trim();
            const value = match[2].trim().replace(/^['"]|['"]$/g, '');
            process.env[key] = value;
        }
    });
} else {
    console.error('No .env.local file found!');
    process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
    console.error('DATABASE_URL is not set in .env.local');
    process.exit(1);
}

// Extract hostname from DATABASE_URL
const urlMatch = databaseUrl.match(/@([^:]+):/);
if (urlMatch) {
    const hostname = urlMatch[1];
    console.log('Current DATABASE_URL hostname:', hostname);
    
    // Check if it's a Supabase URL
    if (hostname.includes('supabase.co')) {
        const projectRef = hostname.split('.')[0] === 'db' 
            ? hostname.split('.')[1] 
            : hostname.split('.')[0];
        console.log('Project reference:', projectRef);
        console.log('\n⚠️  If this hostname cannot be found, it means:');
        console.log('  1. The Supabase project may have been deleted or paused');
        console.log('  2. The project reference is incorrect');
        console.log('  3. The connection string is outdated');
        console.log('\nTo fix this:');
        console.log('  1. Go to https://app.supabase.com');
        console.log('  2. Select your active project');
        console.log('  3. Go to Settings → Database');
        console.log('  4. Copy the Direct connection string');
        console.log('  5. Update DATABASE_URL in .env.local');
        console.log('  6. Make sure it includes &sslmode=require');
    }
} else {
    console.log('Could not parse hostname from DATABASE_URL');
}

// Check if sslmode is present
if (!databaseUrl.includes('sslmode=require')) {
    console.warn('\n⚠️  WARNING: DATABASE_URL does not include sslmode=require');
    console.warn('   Supabase requires SSL connections. Add &sslmode=require to your connection string');
}

console.log('\nCurrent DATABASE_URL format (password hidden):');
const maskedUrl = databaseUrl.replace(/:([^:@]+)@/, ':***@');
console.log(maskedUrl);
