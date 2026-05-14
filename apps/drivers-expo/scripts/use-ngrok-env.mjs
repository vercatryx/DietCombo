/**
 * Reads the active HTTPS tunnel from ngrok's local API (http://127.0.0.1:4040)
 * and sets EXPO_PUBLIC_API_BASE_URL in apps/drivers-expo/.env
 *
 * Requires: `ngrok http 3000` (or your port) running in another terminal.
 */
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(__dirname, '..', '.env');

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        http
            .get(url, (res) => {
                let data = '';
                res.on('data', (c) => (data += c));
                res.on('end', () => {
                    try {
                        resolve(JSON.parse(data));
                    } catch (e) {
                        reject(e);
                    }
                });
            })
            .on('error', reject);
    });
}

async function main() {
    const api = await fetchJson('http://127.0.0.1:4040/api/tunnels').catch(() => null);
    if (!api?.tunnels?.length) {
        console.error('No ngrok tunnels found. Start ngrok first, e.g.: ngrok http 3000');
        process.exit(1);
    }
    const httpsTunnel = api.tunnels.find((t) => t.public_url?.startsWith('https://'));
    const url = (httpsTunnel || api.tunnels[0]).public_url.replace(/\/$/, '');
    if (!url) {
        console.error('Could not parse tunnel URL');
        process.exit(1);
    }

    let body = '';
    if (fs.existsSync(envPath)) {
        body = fs.readFileSync(envPath, 'utf8');
        const lines = body.split('\n');
        let found = false;
        const next = lines.map((line) => {
            if (/^\s*EXPO_PUBLIC_API_BASE_URL=/.test(line)) {
                found = true;
                return `EXPO_PUBLIC_API_BASE_URL=${url}`;
            }
            return line;
        });
        if (!found) {
            next.unshift(`EXPO_PUBLIC_API_BASE_URL=${url}`);
        }
        body = next.join('\n');
    } else {
        body = `# From ngrok — npm run use-ngrok\nEXPO_PUBLIC_API_BASE_URL=${url}\nEXPO_PUBLIC_APP_TIMEZONE=America/New_York\n`;
    }

    fs.writeFileSync(envPath, body.endsWith('\n') ? body : body + '\n', 'utf8');
    console.log(`EXPO_PUBLIC_API_BASE_URL=${url}`);
    console.log(`Updated ${envPath}`);
    console.log('Restart Expo (npx expo start) so the new URL loads.');
}

main();
