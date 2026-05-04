/**
 * Find why a UUID may not appear on the Routes page (/routes), which loads
 * /api/route/routes with light=1, exclude_produce=1 and get_routes_for_date.
 *
 * Default entity matches the reported case (override with ENTITY_ID).
 *
 * Run from project root:
 *   npx ts-node --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' scripts/diagnose-id-in-routes.ts
 *
 * With date (YYYY-MM-DD) required when the ID is an order or client without a stop row:
 *   DELIVERY_DATE=2026-05-04 npx ts-node --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' scripts/diagnose-id-in-routes.ts
 *
 * Env:
 *   ENTITY_ID   — client, stop, order, or driver id (default: 27871bdd-2c1f-4d95-8719-54815e44cfc6)
 *   DELIVERY_DATE — filters stops / RPC (if omitted, uses latest stop row for this id when found)
 *   DAY — default "all" (must match Routes UI: often "all")
 */

import { createClient } from '@supabase/supabase-js';
import * as path from 'path';
import * as fs from 'fs';

const DEFAULT_ENTITY = '27871bdd-2c1f-4d95-8719-54815e44cfc6';

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

type RpcPayload = { routes: any[]; unrouted: any[] };

function collectStopsFromRpc(payload: RpcPayload): { stop: any; where: string }[] {
    const out: { stop: any; where: string }[] = [];
    const routes = Array.isArray(payload?.routes) ? payload.routes : [];
    routes.forEach((r: any, ri: number) => {
        const stops = Array.isArray(r?.stops) ? r.stops : [];
        stops.forEach((s: any) => {
            out.push({ stop: s, where: `routes[${ri}] ${r?.driverName || r?.name || ''}` });
        });
    });
    const unrouted = Array.isArray(payload?.unrouted) ? payload.unrouted : [];
    unrouted.forEach((s: any) => {
        out.push({ stop: s, where: 'unrouted' });
    });
    return out;
}

function matchesEntity(s: any, entityId: string, clientId: string | null): boolean {
    const id = String(s?.id ?? '');
    const cid = String(s?.client_id ?? s?.userId ?? '');
    const oid = String(s?.order_id ?? s?.orderId ?? '');
    return (
        id === entityId ||
        cid === entityId ||
        oid === entityId ||
        (clientId != null && cid === clientId)
    );
}

async function main() {
    const env = loadEnv();
    const url = env['NEXT_PUBLIC_SUPABASE_URL'];
    const serviceKey = env['SUPABASE_SERVICE_ROLE_KEY'];
    if (!url || !serviceKey) {
        console.error('Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local');
        process.exit(1);
    }

    const entityId = process.env.ENTITY_ID || DEFAULT_ENTITY;
    const day = (process.env.DAY || 'all').toLowerCase();
    const excludeProduce = true;

    const supabase = createClient(url, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
    });

    console.log('=== Diagnose: why is this id missing from Routes? ===\n');
    console.log('ENTITY_ID:', entityId);
    console.log('DAY (p_day):', day);
    console.log('exclude_produce:', excludeProduce, '(same as /routes?light=1&exclude_produce=1)\n');

    // --- Resolve entity type ---
    const clientRes = await supabase.from('clients').select('*').eq('id', entityId).maybeSingle();
    if (clientRes.error) {
        console.error('Supabase REST error (queries will not work):', clientRes.error.message);
        console.error(
            'If you see "Legacy API keys are disabled", the service key in .env.local must be the new publishable/secret format, or run: npm run diagnose-id-in-routes-prisma'
        );
        process.exit(1);
    }
    const asClient = clientRes.data;
    const { data: asStop, error: stopErr } = await supabase.from('stops').select('*').eq('id', entityId).maybeSingle();
    const { data: asOrder, error: orderErr } = await supabase.from('orders').select('*').eq('id', entityId).maybeSingle();
    const { data: asDriver, error: driverErr } = await supabase.from('drivers').select('*').eq('id', entityId).maybeSingle();
    if (stopErr || orderErr || driverErr) {
        console.error('Supabase error:', stopErr?.message || orderErr?.message || driverErr?.message);
        process.exit(1);
    }
    let asRouteTable: any = null;
    const r1 = await supabase.from('routes').select('*').eq('id', entityId).maybeSingle();
    if (r1.error) {
        console.error('Supabase error (routes table):', r1.error.message);
        process.exit(1);
    }
    asRouteTable = r1.data;

    let deliveryDate = process.env.DELIVERY_DATE?.trim() || null;
    let clientId: string | null = null;
    let stopRow: any = asStop;

    if (asClient) {
        console.log('--- Resolved: ENTITY_ID is a clients.id ---');
        console.log('  Name:', (asClient as any).full_name);
        clientId = entityId;
        if (!deliveryDate) {
            const { data: stops } = await supabase
                .from('stops')
                .select('id, delivery_date, day, assigned_driver_id, client_id')
                .eq('client_id', entityId)
                .order('delivery_date', { ascending: false })
                .limit(5);
            if (stops?.length) {
                const latest = stops[0] as any;
                deliveryDate = latest.delivery_date?.split?.('T')?.[0] ?? String(latest.delivery_date);
                console.log('  DELIVERY_DATE not set; using latest stop for client:', deliveryDate);
                if (!stopRow) {
                    const full = await supabase.from('stops').select('*').eq('id', latest.id).maybeSingle();
                    stopRow = full.data;
                }
            } else {
                console.log('  No stops rows for this client — set DELIVERY_DATE to test RPC.');
            }
        }
    } else if (asStop) {
        console.log('--- Resolved: ENTITY_ID is a stops.id ---');
        clientId = asStop.client_id ?? null;
        deliveryDate =
            deliveryDate ||
            (asStop.delivery_date ? String(asStop.delivery_date).split('T')[0] : null);
        console.log('  client_id:', clientId);
        console.log('  delivery_date:', deliveryDate, 'day:', asStop.day);
    } else if (asOrder) {
        console.log('--- Resolved: ENTITY_ID is an orders.id ---');
        clientId = (asOrder as any).client_id ?? null;
        deliveryDate =
            deliveryDate ||
            ((asOrder as any).scheduled_delivery_date
                ? String((asOrder as any).scheduled_delivery_date).split('T')[0]
                : null);
        console.log('  client_id:', clientId);
        if (!(asOrder as any).scheduled_delivery_date && !process.env.DELIVERY_DATE) {
            console.log('  Order has no scheduled_delivery_date — set DELIVERY_DATE.');
        }
        const { data: byOrderStop } = await supabase
            .from('stops')
            .select('*')
            .eq('order_id', entityId)
            .maybeSingle();
        if (byOrderStop) stopRow = byOrderStop;
    } else if (asDriver || asRouteTable) {
        console.log('--- Resolved: ENTITY_ID is a driver / legacy routes row ---');
        console.log(
            '  Routes UI lists stops under drivers from drivers ∪ routes tables.',
            'This id is not a stop/client/order — check driver assignment on the client/stop instead.'
        );
        if (asDriver) console.log('  Driver:', (asDriver as any).name, 'day:', (asDriver as any).day);
        if (asRouteTable) console.log('  Legacy route name:', (asRouteTable as any).name);
        process.exit(0);
    } else {
        console.log('--- ENTITY_ID not found as client, stop, order, or driver id ---');
        console.log('  Try searching manually in Supabase Table Editor, or confirm the id.');
        process.exit(1);
    }

    if (!deliveryDate) {
        console.log('\nCannot run get_routes_for_date without DELIVERY_DATE.');
        process.exit(1);
    }

    // --- Client-side filter chain (mirrors get_routes_for_date) ---
    if (clientId) {
        const { data: client } = await supabase.from('clients').select('*').eq('id', clientId).maybeSingle();
        if (!client) {
            console.log('\n❌ Client row missing for client_id — stop would fail joins.');
        } else {
            const c = client as any;
            let statusAllows = true;
            if (c.status_id) {
                const { data: st } = await supabase
                    .from('client_statuses')
                    .select('id, deliveries_allowed')
                    .eq('id', c.status_id)
                    .maybeSingle();
                statusAllows = st?.deliveries_allowed !== false;
            }
            const serviceType = String(c.service_type || '').toLowerCase();
            console.log('\n--- Client filters (stops_filtered) ---');
            console.log('  paused:', c.paused, c.paused === true ? '→ EXCLUDED' : '');
            console.log('  delivery:', c.delivery, c.delivery === false ? '→ EXCLUDED' : '');
            console.log('  service_type:', c.service_type, excludeProduce && serviceType === 'produce' ? '→ EXCLUDED (exclude_produce)' : '');
            console.log('  status deliveries_allowed:', statusAllows, !statusAllows ? '→ EXCLUDED' : '');

            if (stopRow) {
                const d = String(stopRow.day || '').toLowerCase();
                const dayOk = day === 'all' || d === day;
                console.log('\n--- Stop row ---');
                console.log('  stop.id:', stopRow.id);
                console.log('  stop.day:', stopRow.day, !dayOk ? '→ EXCLUDED for p_day=' + day : '');
                console.log('  stop.delivery_date:', stopRow.delivery_date);
                const dateNorm = String(stopRow.delivery_date || '').split('T')[0];
                const dateOk = dateNorm === deliveryDate;
                console.log('  matches DELIVERY_DATE:', dateOk, !dateOk ? '→ stop not on this date' : '');
            }
        }
    }

    // --- Driver exists for assigned_driver_id ---
    let clientForAssign: any = asClient;
    if (!clientForAssign && clientId) {
        const { data: c2 } = await supabase
            .from('clients')
            .select('assigned_driver_id, full_name')
            .eq('id', clientId)
            .maybeSingle();
        clientForAssign = c2;
    }
    const assigned = stopRow?.assigned_driver_id ?? clientForAssign?.assigned_driver_id;
    if (assigned) {
        const [d1, d2] = await Promise.all([
            supabase.from('drivers').select('id, name, day').eq('id', assigned).maybeSingle(),
            supabase.from('routes').select('id, name').eq('id', assigned).maybeSingle(),
        ]);
        const inDrivers = !!d1.data;
        const inRoutesTable = !!d2.data;
        console.log('\n--- Assigned driver id on stop/client ---');
        console.log('  assigned_driver_id:', assigned);
        console.log('  in public.drivers:', inDrivers, d1.data?.name);
        console.log('  in public.routes (legacy):', inRoutesTable, d2.data?.name);
        if (!inDrivers && !inRoutesTable) {
            console.log(
                '  ⚠ ORPHAN DRIVER: get_routes_for_date builds route JSON only for ids in drivers ∪ routes.',
                'Stops tied to this id can be omitted from both routes and unrouted (see sql/get_routes_for_date_fast.sql).'
            );
        }
    }

    // --- driver_route_order ---
    if (clientId && deliveryDate) {
        const { data: dro } = await supabase
            .from('driver_route_order')
            .select('driver_id, position, client_id')
            .eq('client_id', clientId);
        console.log('\n--- driver_route_order for this client ---');
        if (dro?.length) {
            dro.forEach((row: any) => console.log(' ', row));
        } else {
            console.log('  (no rows — ordering falls back to tail_stops if assigned_driver_id is set)');
        }
    }

    // --- RPC: actual API path ---
    console.log('\n--- RPC get_routes_for_date ---');
    const { data: rpcData, error: rpcErr } = await supabase.rpc('get_routes_for_date', {
        p_delivery_date: deliveryDate,
        p_day: day,
        p_exclude_produce: excludeProduce,
    });

    if (rpcErr) {
        console.error('RPC error:', rpcErr.message);
        process.exit(1);
    }

    const payload = rpcData as RpcPayload;
    const flat = collectStopsFromRpc(payload);
    const hits = flat.filter(({ stop }) => matchesEntity(stop, entityId, clientId));

    if (hits.length) {
        console.log('✅ Found in API-shaped payload:');
        hits.forEach(({ stop, where }) => {
            console.log(' ', where, '| stop.id:', stop?.id, '| client:', stop?.client_id ?? stop?.userId);
        });
    } else {
        console.log('❌ Not present in routes[] or unrouted[] for this RPC call.');
        const hint =
            'Check: wrong DELIVERY_DATE, stop.day vs DAY, client paused/delivery/status/produce, orphan assigned_driver_id.';
        console.log(' ', hint);
    }

    process.exit(0);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
