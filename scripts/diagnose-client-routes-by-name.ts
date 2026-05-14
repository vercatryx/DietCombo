/**
 * Find why a client (including dependants) may not appear on Routes or driver stops.
 *
 * Stops are created from active/upcoming orders tied to `clients.id` (see app/api/route/routes/route.ts).
 * This script loads the client row, parent if dependant, eligibility flags, orders, stops,
 * driver_route_order, and optionally checks get_routes_for_date like the Routes UI.
 *
 * Usage (from project root):
 *   npx ts-node --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' scripts/diagnose-client-routes-by-name.ts --name "LIEBER COHN"
 *
 * Optional:
 *   --date YYYY-MM-DD   Focus orders/stops/RPC on this delivery date (recommended).
 *
 * Env: same as other scripts — NEXT_PUBLIC_SUPABASE_URL plus SUPABASE_SECRET_KEY,
 * NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY, or SUPABASE_SERVICE_ROLE_KEY.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import * as path from 'path';
import * as fs from 'fs';

import { isProduceServiceType } from '../lib/isProduceServiceType';
import { fetchStatusDeliveriesAllowedMap, isExcludedFromDeliveries } from '../lib/deliveryEligibility';

function loadEnv(): Record<string, string> {
    const envPath = path.resolve(process.cwd(), '.env.local');
    try {
        const envFile = fs.readFileSync(envPath, 'utf8');
        const env: Record<string, string> = {};
        envFile.split('\n').forEach((line) => {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('#')) return;
            const eq = trimmed.indexOf('=');
            if (eq === -1) return;
            const key = trimmed.slice(0, eq).trim();
            let val = trimmed.slice(eq + 1).trim();
            if (
                (val.startsWith('"') && val.endsWith('"')) ||
                (val.startsWith("'") && val.endsWith("'"))
            ) {
                val = val.slice(1, -1);
            }
            env[key] = val;
        });
        return env;
    } catch (e) {
        console.error('Failed to load .env.local:', e);
        process.exit(1);
    }
}

function getDbKey(env: Record<string, string>): string | undefined {
    return (
        env['SUPABASE_SECRET_KEY'] ||
        env['NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY'] ||
        env['SUPABASE_SERVICE_ROLE_KEY'] ||
        env['NEXT_PUBLIC_SUPABASE_ANON_KEY']
    );
}

function parseArgs() {
    const args = process.argv.slice(2);
    let name = 'LIEBER COHN';
    let deliveryDate: string | null = null;
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a === '--name' && args[i + 1]) {
            name = String(args[i + 1]);
            i++;
        } else if (a === '--date' && args[i + 1]) {
            deliveryDate = String(args[i + 1]).split('T')[0].split(' ')[0];
            i++;
        }
    }
    return { name: name.trim(), deliveryDate };
}

const ACTIVE_ORDER_STATUSES = ['pending', 'scheduled', 'confirmed'] as const;

async function diagnoseOneClient(
    supabase: SupabaseClient,
    statusAllowMap: Map<string, boolean>,
    c: Record<string, unknown>,
    deliveryDate: string | null
) {
    const id = String(c.id);
    const fullName = String(c.full_name ?? '').trim();
    const parentId = c.parent_client_id != null ? String(c.parent_client_id) : null;

    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('Client id:', id);
    console.log('full_name:', fullName || '(empty)');
    console.log('first_name / last_name:', c.first_name, '/', c.last_name);
    console.log('parent_client_id:', parentId ?? '(null — primary account)');
    console.log('service_type:', c.service_type);
    console.log('paused:', c.paused);
    console.log('delivery (profile):', c.delivery);
    console.log('assigned_driver_id:', c.assigned_driver_id ?? '(null)');
    console.log('status_id:', c.status_id ?? '(null)');
    console.log('archived_at:', c.archived_at ?? '(null)');

    const produce = isProduceServiceType(c.service_type as string | null);
    console.log('\n--- Route / driver app filters (same ideas as /api/route/routes) ---');
    console.log(
        '  Treat as Produce (hidden when exclude_produce=1 / drivers app):',
        produce,
        produce ? '→ may be omitted from driver-facing lists' : ''
    );
    if (c.archived_at) {
        console.log('  → archived: client row should not receive new routing attention');
    }
    const statusExcluded = isExcludedFromDeliveries(
        c.paused as boolean | null,
        c.status_id as string | null,
        statusAllowMap
    );
    console.log('  Excluded (paused or status deliveries_allowed=false):', statusExcluded);
    const deliverOff = c.delivery === false;
    console.log('  delivery === false (profile):', deliverOff);

    const wouldShowOnRoutes =
        !c.archived_at &&
        !produce &&
        !statusExcluded &&
        !deliverOff;
    console.log(
        '\n  ▶ Would hydrate/show stops on Routes (shouldShowStop-style):',
        wouldShowOnRoutes,
        !wouldShowOnRoutes
            ? '← existing stop rows can still exist but are FILTERED OUT of routes + driver lists'
            : ''
    );

    if (parentId) {
        const { data: parent } = await supabase
            .from('clients')
            .select('id, full_name, service_type, paused, delivery, assigned_driver_id, status_id')
            .eq('id', parentId)
            .maybeSingle();
        console.log('\n--- Household parent ---');
        if (parent) {
            console.log('  id:', parent.id, '|', parent.full_name);
            console.log('  parent service_type:', parent.service_type);
            console.log('  parent assigned_driver_id:', parent.assigned_driver_id ?? '(null)');
            console.log(
                '  Note: routing uses THIS client id for orders/stops; parent settings do not substitute.'
            );
        } else {
            console.log('  ⚠ parent_client_id set but parent row not found:', parentId);
        }
    }

    console.log('\n--- Orders (routes logic uses client_id on orders / upcoming_orders) ---');
    const { data: activeOrders, error: oErr } = await supabase
        .from('orders')
        .select('id, status, scheduled_delivery_date, delivery_day, case_id')
        .eq('client_id', id)
        .in('status', [...ACTIVE_ORDER_STATUSES])
        .not('scheduled_delivery_date', 'is', null)
        .order('scheduled_delivery_date', { ascending: false })
        .limit(25);

    if (oErr) console.error('orders query error:', oErr.message);
    else if (!activeOrders?.length) {
        console.log(
            '  No rows: pending|scheduled|confirmed orders with scheduled_delivery_date for this client_id.'
        );
        console.log(
            '  → Without an order row for this dependant, stop creation will skip them (see route/routes step 9).'
        );
    } else {
        console.log(`  Found ${activeOrders.length} active-order row(s) (showing up to 25):`);
        for (const o of activeOrders) {
            const d = o.scheduled_delivery_date ? String(o.scheduled_delivery_date).split('T')[0] : '';
            const mark = deliveryDate && d === deliveryDate ? '  ← matches --date' : '';
            console.log(`    order ${o.id} | ${o.status} | scheduled_delivery_date=${d} ${mark}`);
        }
    }

    const { data: upcoming, error: uErr } = await supabase
        .from('upcoming_orders')
        .select('id, status, scheduled_delivery_date, delivery_day, service_type, case_id')
        .eq('client_id', id)
        .eq('status', 'scheduled')
        .or('delivery_day.not.is.null,scheduled_delivery_date.not.is.null')
        .order('scheduled_delivery_date', { ascending: false })
        .limit(25);

    if (uErr) console.error('upcoming_orders query error:', uErr.message);
    else if (!upcoming?.length) {
        console.log('  upcoming_orders (scheduled, with day or scheduled date): none');
    } else {
        console.log(`  upcoming_orders: ${upcoming.length} row(s)`);
        for (const u of upcoming) {
            const sd = u.scheduled_delivery_date ? String(u.scheduled_delivery_date).split('T')[0] : '';
            const mark =
                deliveryDate && sd && sd === deliveryDate ? '  ← matches --date' : '';
            console.log(
                `    upcoming ${u.id} | ${u.service_type ?? '?'} | scheduled_delivery_date=${sd || 'null'} | delivery_day=${u.delivery_day ?? 'null'}${mark}`
            );
        }
    }

    console.log('\n--- Stops ---');
    let stopsQuery = supabase
        .from('stops')
        .select('id, delivery_date, day, order_id, assigned_driver_id, name, created_at')
        .eq('client_id', id)
        .order('delivery_date', { ascending: false })
        .limit(30);
    if (deliveryDate) {
        stopsQuery = supabase
            .from('stops')
            .select('id, delivery_date, day, order_id, assigned_driver_id, name, created_at')
            .eq('client_id', id)
            .eq('delivery_date', deliveryDate);
    }
    const { data: stops, error: sErr } = await stopsQuery;

    if (sErr) console.error('stops query error:', sErr.message);
    else if (!stops?.length) {
        console.log(
            deliveryDate
                ? `  No stop rows for client_id on delivery_date=${deliveryDate}`
                : '  No stop rows for this client_id (recent 30)'
        );
    } else {
        console.log(`  ${stops.length} stop row(s):`);
        for (const s of stops) {
            console.log(
                `    ${s.id} | delivery_date=${s.delivery_date} | day=${s.day} | order_id=${s.order_id} | assigned_driver_id=${s.assigned_driver_id}`
            );
        }
    }

    console.log('\n--- driver_route_order (route ordering / driver stops) ---');
    const { data: dro } = await supabase
        .from('driver_route_order')
        .select('driver_id, position, client_id')
        .eq('client_id', id)
        .order('position', { ascending: true });
    if (dro?.length) {
        dro.forEach((row: { driver_id: string; position: number }) =>
            console.log(' ', row)
        );
    } else {
        console.log('  (no rows — client not in route order table)');
    }

    if (deliveryDate) {
        console.log('\n--- RPC get_routes_for_date (same as Routes page with light=1) ---');
        const { data: rpcData, error: rpcErr } = await supabase.rpc('get_routes_for_date', {
            p_delivery_date: deliveryDate,
            p_day: 'all',
            p_exclude_produce: true,
        });
        if (rpcErr) {
            console.log('  RPC error:', rpcErr.message);
        } else {
            const payload = rpcData as { routes?: unknown[]; unrouted?: unknown[] } | null;
            const routes = Array.isArray(payload?.routes) ? payload.routes : [];
            const unrouted = Array.isArray(payload?.unrouted) ? payload.unrouted : [];
            const flat: { stop: any; where: string }[] = [];
            routes.forEach((r: any, ri: number) => {
                const stopsArr = Array.isArray(r?.stops) ? r.stops : [];
                stopsArr.forEach((s: any) =>
                    flat.push({ stop: s, where: `routes[${ri}] ${r?.name ?? ''}` })
                );
            });
            unrouted.forEach((s: any) => flat.push({ stop: s, where: 'unrouted' }));
            const hits = flat.filter(
                ({ stop }) =>
                    String(stop?.client_id ?? stop?.userId ?? '') === id ||
                    String(stop?.id ?? '') === id
            );
            if (hits.length) {
                console.log('  ✅ Present in RPC payload:');
                hits.forEach(({ stop, where }) =>
                    console.log('   ', where, '| stop.id:', stop?.id)
                );
            } else {
                console.log('  ❌ Not in routes[] or unrouted[] for this date (exclude_produce=true)');
            }
        }
    }

    console.log('\n--- Likely causes (check sections above) ---');
    const reasons: string[] = [];
    if (produce) reasons.push('service_type counts as Produce → excluded when exclude_produce is on');
    if (statusExcluded) reasons.push('paused or client status blocks deliveries');
    if (deliverOff) reasons.push('client delivery flag is false');
    if (c.archived_at) reasons.push('client is archived');
    if (!activeOrders?.length && !upcoming?.length) {
        reasons.push('no qualifying orders for this client_id — dependants need their own order rows to get stops');
    }
    if (!reasons.length) {
        reasons.push('if orders exist but no stop: compare scheduled_delivery_date with the date you expect; run with --date');
        reasons.push('orphan assigned_driver_id or missing driver_route_order can hide stops from a driver sheet');
    }
    reasons.forEach((r) => console.log(' •', r));
}

async function main() {
    const env = loadEnv();
    const url = env['NEXT_PUBLIC_SUPABASE_URL'];
    const key = getDbKey(env);
    if (!url || !key) {
        console.error('Need NEXT_PUBLIC_SUPABASE_URL and a DB key in .env.local');
        process.exit(1);
    }

    const { name, deliveryDate } = parseArgs();
    const supabase = createClient(url, key, {
        auth: { autoRefreshToken: false, persistSession: false },
    });

    const statusAllowMap = await fetchStatusDeliveriesAllowedMap(supabase);

    console.log('=== diagnose-client-routes-by-name ===');
    console.log('Search name:', JSON.stringify(name));
    if (deliveryDate) console.log('Delivery date:', deliveryDate);
    else console.log('Delivery date: (omit — pass --date YYYY-MM-DD for RPC + focused stops query)');

    const { data: matches, error } = await supabase
        .from('clients')
        .select(
            'id, full_name, first_name, last_name, parent_client_id, service_type, paused, delivery, assigned_driver_id, status_id, archived_at'
        )
        .ilike('full_name', `%${name}%`)
        .order('id', { ascending: true });

    if (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }

    if (!matches?.length) {
        console.log('\nNo clients matched full_name ILIKE. Try a shorter substring or check spelling.');
        process.exit(0);
    }

    console.log(`\nMatched ${matches.length} client row(s).`);

    for (const c of matches as Record<string, unknown>[]) {
        await diagnoseOneClient(supabase, statusAllowMap, c, deliveryDate);
    }

    console.log('\nDone.\n');
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
