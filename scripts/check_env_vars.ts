
import * as fs from 'fs';
import * as path from 'path';

const envPath = path.resolve(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    const envConfig = fs.readFileSync(envPath, 'utf-8');
    const keys: string[] = [];
    envConfig.split('\n').forEach(line => {
        const match = line.match(/^([^=]+)=/);
        if (match) {
            keys.push(match[1].trim());
        }
    });
    console.log('Keys found in .env.local:', keys);
    if (keys.includes('DATABASE_URL')) {
        console.log('DATABASE_URL is present.');
    } else {
        console.log('DATABASE_URL is MISSING.');
    }
} else {
    console.log('No .env.local found');
}
