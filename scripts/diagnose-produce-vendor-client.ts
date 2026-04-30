/**
 * Explain why a client may not appear on /vendors/produce?token=...
 * Mirrors lib/actions.ts getProduceClientsForVendorToken filters:
 *   produce_vendor_id = vendor id for token, not paused / status allows deliveries, service_type includes Produce.
 *
 * Usage (from project root):
 *   npx ts-node --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' scripts/diagnose-produce-vendor-client.ts
 *
 * Optional env / args:
 *   CLIENT_ID=f47e82a2-... PRODUCE_VENDOR_TOKEN=9dacb9b5... npx ts-node ...
 *
 * Or pass as CLI args:
 *   ... scripts/diagnose-produce-vendor-client.ts <clientUuid> [vendorToken]
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as path from 'path';
import * as fs from 'fs';

function loadEnv(): Record<string, string> {
    const envPath = path.resolve(process.cwd(), '.env.local');
    try {
        const envFile = fs.readFileSync(envPath, 'utf8');
        const env: Record<string, string> = {};
        envFile.split('\n').forEach((line) => {
            const [key, ...values] = line.split('=');
            if (key && values.length > 0) {
                env[key.trim()] = values.join('=').trim().replace(/^["']|["']$/g, '');
            }
        });
        return env;
    } catch (e) {
        console.error('Failed to load .env.local:', e);
        process.exit(1);
    }
}

function isProduceServiceType(serviceType: string | null | undefined): boolean {
    if (serviceType == null || serviceType === '') return false;
    return String(serviceType)
        .split(',')
        .some((s) => s.trim().toLowerCase() === 'produce');
}

function parseArgs(): { clientId: string; token: string } {
    const argv = process.argv.slice(2).filter(Boolean);
    const fromEnv = {
        clientId: process.env.CLIENT_ID || '',
        token: process.env.PRODUCE_VENDOR_TOKEN || '',
    };
    if (argv[0]) fromEnv.clientId = argv[0];
    if (argv[1]) fromEnv.token = argv[1];
    if (!fromEnv.clientId) {
        console.error(
            'Missing client id. Set CLIENT_ID or pass UUID as first argument.\n' +
                'Example: CLIENT_ID=f47e82a2-bef9-4811-99ff-53c1d6a00aeb ...'
        );
        process.exit(1);
    }
    if (!fromEnv.token) {
        console.error(
            'Missing vendor token. Set PRODUCE_VENDOR_TOKEN or pass as second argument.\n' +
                'Example: PRODUCE_VENDOR_TOKEN=9dacb9b5a71702e401f970b844cb27e0 ...'
        );
        process.exit(1);
    }
    return { clientId: fromEnv.clientId.trim(), token: fromEnv.token.trim() };
}

async function fetchVendorByToken(admin: SupabaseClient, token: string) {
    const { data, error } = await admin
        .from('produce_vendors')
        .select('id, name, token, is_active')
        .eq('token', token)
        .maybeSingle();
    return { vendor: data, error };
}

async function fetchVendorById(admin: SupabaseClient, id: string | null) {
    if (!id) return { vendor: null, error: null as Error | null };
    const { data, error } = await admin
        .from('produce_vendors')
        .select('id, name, token, is_active')
        .eq('id', id)
        .maybeSingle();
    return { vendor: data, error };
}

async function run(admin: SupabaseClient, clientId: string, vendorToken: string) {
    console.log('=== Produce vendor client diagnosis ===\n');
    console.log('Client ID:', clientId);
    console.log('URL token:', vendorToken);
    console.log('');

    const { vendor: urlVendor, error: pvErr } = await fetchVendorByToken(admin, vendorToken);
    if (pvErr) {
        console.error('produce_vendors lookup by token failed:', pvErr.message);
        return;
    }
    if (!urlVendor) {
        console.log('❌ No produce_vendors row matches this token. Page will show nothing for any client.');
        return;
    }
    console.log('Vendor for this token:');
    console.log('  id:', urlVendor.id);
    console.log('  name:', urlVendor.name);
    console.log('  is_active:', urlVendor.is_active);
    if (urlVendor.is_active === false) {
        console.log('\n❌ Vendor is inactive — getProduceClientsForVendorToken returns [].');
    }
    console.log('');

    const { data: client, error: cErr } = await admin.from('clients').select('*').eq('id', clientId).maybeSingle();
    if (cErr) {
        console.error('clients lookup failed:', cErr.message);
        return;
    }
    if (!client) {
        console.log('❌ No client row with this id in this database.');
        return;
    }

    const assignedPvId = client.produce_vendor_id as string | null;
    const paused = Boolean(client.paused);
    const statusId = client.status_id as string | null | undefined;
    const serviceType = client.service_type as string | null;
    const produceOk = isProduceServiceType(serviceType);

    let deliveriesAllowed = true;
    if (statusId) {
        const { data: stRow } = await admin
            .from('client_statuses')
            .select('deliveries_allowed')
            .eq('id', statusId)
            .maybeSingle();
        deliveriesAllowed = stRow?.deliveries_allowed !== false;
    }

    console.log('Client row (relevant columns):');
    console.log('  full_name:', client.full_name);
    console.log('  produce_vendor_id:', assignedPvId ?? '(null)');
    console.log('  paused:', paused);
    console.log('  status_id:', statusId ?? '(null)');
    console.log('  status deliveries_allowed (effective):', deliveriesAllowed);
    console.log('  service_type:', JSON.stringify(serviceType));
    console.log('  includes Produce (isProduceServiceType):', produceOk);
    console.log('');

    const { vendor: assignedVendor } = await fetchVendorById(admin, assignedPvId);
    if (assignedPvId && assignedVendor) {
        console.log('Client is assigned to vendor:');
        console.log('  id:', assignedVendor.id);
        console.log('  name:', assignedVendor.name);
        console.log('  token prefix:', String(assignedVendor.token || '').slice(0, 12) + '...');
    } else if (assignedPvId && !assignedVendor) {
        console.log('⚠ produce_vendor_id is set but no matching produce_vendors row (orphan id):', assignedPvId);
    }
    console.log('');

    const reasons: string[] = [];
    if (assignedPvId !== urlVendor.id) {
        reasons.push(`produce_vendor_id (${assignedPvId ?? 'null'}) !== vendor id from URL token (${urlVendor.id})`);
    }
    if (paused) {
        reasons.push('client.paused is true');
    }
    if (!deliveriesAllowed) {
        reasons.push('client_status.deliveries_allowed is false (same net effect as paused for delivery flows)');
    }
    if (!produceOk) {
        reasons.push(`service_type "${serviceType}" does not include Produce (need comma-separated or single value matching "produce")`);
    }
    if (urlVendor.is_active === false) {
        reasons.push('produce vendor for token is inactive');
    }

    if (reasons.length === 0) {
        console.log('✅ All filters used by getProduceClientsForVendorToken pass for this client + token.');
        console.log('   If the UI still hides them, check caching, a different deployment/env, or UI-side filters.');
    } else {
        console.log('❌ Client would be EXCLUDED from this vendor link for:');
        reasons.forEach((r) => console.log('   -', r));
    }
}

function main() {
    const env = loadEnv();
    const url = env['NEXT_PUBLIC_SUPABASE_URL'];
    const serviceKey = env['SUPABASE_SERVICE_ROLE_KEY'];
    if (!url || !serviceKey) {
        console.error('Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local');
        process.exit(1);
    }

    const { clientId, token } = parseArgs();

    const admin = createClient(url, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
    });

    run(admin, clientId, token).then(
        () => process.exit(0),
        (err) => {
            console.error(err);
            process.exit(1);
        }
    );
}

main();
