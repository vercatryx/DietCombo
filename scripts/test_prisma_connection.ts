import { PrismaClient } from '../lib/generated/prisma';
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
    console.error('❌ No .env.local file found!');
    console.error('   Please create a .env.local file with your DATABASE_URL');
    process.exit(1);
}

async function testConnection() {
    const prisma = new PrismaClient();
    
    try {
        console.log('Testing Prisma database connection...');
        await prisma.$connect();
        console.log('✅ Successfully connected to database!');
        
        // Try a simple query
        const result = await prisma.$queryRaw`SELECT 1 as test`;
        console.log('✅ Database query test passed:', result);
        
    } catch (error: any) {
        console.error('❌ Connection failed:', error.message);
        
        if (error.message.includes('P1001') || error.message.includes('Can\'t reach database server')) {
            console.error('\nThis usually means:');
            console.error('  1. DATABASE_URL is missing or incorrect');
            console.error('  2. Missing sslmode=require in connection string');
            console.error('  3. Wrong database password');
            console.error('  4. Supabase project is paused or deleted');
        } else if (error.message.includes('could not find host') || error.message.includes('getaddrinfo')) {
            console.error('\nThis means the hostname cannot be resolved:');
            console.error('  1. Check if your Supabase project is active');
            console.error('  2. Verify the project reference in DATABASE_URL matches your Supabase URL');
            console.error('  3. The project might have been deleted or paused');
        }
        
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

testConnection();
