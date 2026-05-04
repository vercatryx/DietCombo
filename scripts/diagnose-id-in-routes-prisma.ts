/**
 * Same goal as diagnose-id-in-routes.ts but uses Prisma (DATABASE_URL) to avoid
 * Supabase REST "Legacy API keys are disabled" when that setting is on.
 */
import { PrismaClient } from '../lib/generated/prisma';
import * as fs from 'fs';
import * as path from 'path';

const id = process.env.ENTITY_ID || '27871bdd-2c1f-4d95-8719-54815e44cfc6';
const day = (process.env.DAY || 'all').toLowerCase();
const deliveryDateParam = process.env.DELIVERY_DATE?.trim() || null;
const excludeProduce = true;

function loadEnvLocal() {
    const envPath = path.resolve(process.cwd(), '.env.local');
    if (!fs.existsSync(envPath)) {
        console.error('Missing .env.local');
        process.exit(1);
    }
    const envConfig = fs.readFileSync(envPath, 'utf-8');
    envConfig.split('\n').forEach((line) => {
        const match = line.match(/^([^=]+)=(.*)$/);
        if (match) {
            const key = match[1].trim();
            const value = match[2].trim().replace(/^['"]|['"]$/g, '');
            process.env[key] = value;
        }
    });
}

async function rpcRoutes(
    prisma: PrismaClient,
    deliveryDate: string
): Promise<{ routes: any[]; unrouted: any[] } | null> {
    const rows = await prisma.$queryRawUnsafe<
        { get_routes_for_date: unknown }[]
    >(
        `select public.get_routes_for_date($1::date, $2::text, $3::boolean) as get_routes_for_date`,
        deliveryDate,
        day,
        excludeProduce
    );
    const raw = rows[0]?.get_routes_for_date;
    if (raw == null) return { routes: [], unrouted: [] };
    const j = typeof raw === 'string' ? JSON.parse(raw) : (raw as any);
    return {
        routes: Array.isArray(j?.routes) ? j.routes : [],
        unrouted: Array.isArray(j?.unrouted) ? j.unrouted : [],
    };
}

function findInPayload(
    payload: { routes: any[]; unrouted: any[] },
    entityId: string,
    clientId: string | null
) {
    const hits: string[] = [];
    payload.routes.forEach((r, ri) => {
        (r.stops || []).forEach((s: any) => {
            if (
                s?.id === entityId ||
                s?.client_id === entityId ||
                s?.userId === entityId ||
                s?.order_id === entityId ||
                s?.orderId === entityId ||
                (clientId && (s?.client_id === clientId || s?.userId === clientId))
            ) {
                hits.push(`routes[${ri}] ${r.driverName || ''} stop ${s.id}`);
            }
        });
    });
    (payload.unrouted || []).forEach((s: any) => {
        if (
            s?.id === entityId ||
            s?.client_id === entityId ||
            (clientId && s?.client_id === clientId)
        ) {
            hits.push(`unrouted stop ${s.id}`);
        }
    });
    return hits;
}

async function main() {
    loadEnvLocal();
    const prisma = new PrismaClient();
    try {
        console.log('=== diagnose-id-in-routes (Prisma / direct Postgres) ===\n');
        console.log('ENTITY_ID:', id);
        console.log('DAY:', day, 'exclude_produce:', excludeProduce, '\n');

        const client = await prisma.client.findUnique({ where: { id } });
        const stop = await prisma.stop.findUnique({ where: { id } });
        const order = await prisma.order.findUnique({ where: { id } });
        const driver = await prisma.driver.findUnique({ where: { id } });

        let clientId: string | null = null;
        let deliveryDate = deliveryDateParam;
        let stopRow = stop;

        if (client) {
            console.log('Resolved: clients.id');
            console.log('  full_name:', client.fullName);
            console.log('  paused:', client.paused, 'delivery:', client.delivery, 'service_type:', client.serviceType);
            clientId = id;
            if (!deliveryDate) {
                const latest = await prisma.stop.findFirst({
                    where: { clientId: id },
                    orderBy: { deliveryDate: 'desc' },
                });
                if (latest?.deliveryDate) {
                    deliveryDate = latest.deliveryDate.toISOString().slice(0, 10);
                    console.log('  Using latest stop delivery_date:', deliveryDate);
                    if (!stopRow) stopRow = latest;
                }
            }
        } else if (stop) {
            console.log('Resolved: stops.id');
            clientId = stop.clientId;
            deliveryDate =
                deliveryDate || (stop.deliveryDate ? stop.deliveryDate.toISOString().slice(0, 10) : null);
            console.log('  client_id:', clientId, 'day:', stop.day, 'delivery_date:', deliveryDate);
        } else if (order) {
            console.log('Resolved: orders.id');
            clientId = order.clientId;
            deliveryDate =
                deliveryDate ||
                (order.scheduledDeliveryDate
                    ? order.scheduledDeliveryDate.toISOString().slice(0, 10)
                    : null);
            if (!stopRow) {
                const byOrder = await prisma.stop.findFirst({ where: { orderId: id } });
                if (byOrder) stopRow = byOrder;
            }
        } else if (driver) {
            console.log('Resolved: drivers.id (not a stop — assign clients/stops to this driver to see them.)');
            console.log('  name:', driver.name, 'day:', driver.day);
            await prisma.$disconnect();
            return;
        } else {
            const legacyRoute = await prisma.$queryRawUnsafe<{ id: string; name: string }[]>(
                `select id, name from public.routes where id = $1 limit 1`,
                id
            );
            if (legacyRoute.length) {
                console.log('Resolved: public.routes (legacy) id:', legacyRoute[0].name);
                await prisma.$disconnect();
                return;
            }

            const dro = await prisma.$queryRawUnsafe<
                { client_id: string; driver_id: string; position: number | null }[]
            >(
                `select client_id, driver_id, position from public.driver_route_order where client_id = $1::uuid or driver_id = $1::uuid limit 20`,
                id
            );
            if (dro.length) {
                const asClientRow = dro.some((r) => r.client_id === id);
                const asDriverRow = dro.some((r) => r.driver_id === id);
                console.log('Found in driver_route_order:', JSON.stringify(dro, null, 2));
                if (asDriverRow && !asClientRow) {
                    console.log(
                        '\nThis UUID appears only as driver_id. The Routes UI lists stops (clients), not driver ids in the map list.'
                    );
                    await prisma.$disconnect();
                    return;
                }
                clientId = asClientRow ? id : dro[0].client_id;
                const latest = await prisma.stop.findFirst({
                    where: { clientId },
                    orderBy: { deliveryDate: 'desc' },
                });
                if (latest) {
                    stopRow = latest;
                    if (!deliveryDate && latest.deliveryDate) {
                        deliveryDate = latest.deliveryDate.toISOString().slice(0, 10);
                    }
                }
                console.log('  Following driver_route_order → client_id:', clientId);
            } else {
                console.log('NOT FOUND as client, stop, order, driver, driver_route_order row, or routes (legacy).');
                console.log('This UUID is not in the connected Postgres database (wrong env, Brooklyn vs parent, or typo).');
                await prisma.$disconnect();
                return;
            }
        }

        if (clientId) {
            const c = await prisma.client.findUnique({ where: { id: clientId } });
            let deliveriesAllowed = true;
            if (c?.statusId) {
                const stRow = await prisma.clientStatus.findUnique({ where: { id: c.statusId } });
                deliveriesAllowed = stRow?.deliveriesAllowed !== false;
            }
            if (c) {
                console.log('\n--- Client eligibility ---');
                console.log('  status deliveries_allowed:', deliveriesAllowed ? 'true' : 'false');
                const stype = String(c.serviceType || '').toLowerCase();
                if (c.paused) console.log('  ❌ paused → excluded from routes RPC');
                if (c.delivery === false) console.log('  ❌ delivery false → excluded');
                if (excludeProduce && stype === 'produce') console.log('  ❌ produce + exclude_produce → excluded');
                if (!deliveriesAllowed) console.log('  ❌ status deliveries_allowed false → excluded');
            }
        }

        if (stopRow && deliveryDate) {
            const dNorm = stopRow.deliveryDate
                ? stopRow.deliveryDate.toISOString().slice(0, 10)
                : null;
            if (dNorm !== deliveryDate) {
                console.log('\n  ⚠ Stop delivery_date', dNorm, '≠ DELIVERY_DATE', deliveryDate, '→ stop not on that date');
            }
            if (day !== 'all' && String(stopRow.day || '').toLowerCase() !== day) {
                console.log('  ⚠ stop.day', stopRow.day, '≠ p_day', day, '→ excluded for that day filter');
            }
        }

        if (clientId) {
            const ad = stopRow?.assignedDriverId || (await prisma.client.findUnique({ where: { id: clientId } }))?.assignedDriverId;
            if (ad) {
                const [dRow, rRow] = await Promise.all([
                    prisma.driver.findUnique({ where: { id: ad } }),
                    prisma.$queryRawUnsafe<{ id: string }[]>(
                        `select id from public.routes where id = $1 limit 1`,
                        ad
                    ),
                ]);
                console.log('\n--- assigned_driver_id ---');
                console.log(' ', ad);
                if (!dRow && !rRow.length) {
                    console.log(
                        '  ❌ ORPHAN: id not in drivers or legacy routes — stop can vanish from routes JSON (see get_routes_for_date).'
                    );
                } else {
                    console.log('  ✓ present in drivers or routes table');
                }
            }
        }

        if (!deliveryDate) {
            console.log('\nSet DELIVERY_DATE=YYYY-MM-DD to run get_routes_for_date.');
            await prisma.$disconnect();
            return;
        }

        console.log('\n--- RPC get_routes_for_date(' + deliveryDate + ') ---');
        const payload = await rpcRoutes(prisma, deliveryDate);
        if (!payload) {
            console.log('RPC returned null');
            await prisma.$disconnect();
            return;
        }
        const hits = findInPayload(payload, id, clientId);
        if (hits.length) {
            console.log('✅ Appears in get_routes_for_date payload for this date:');
            hits.forEach((h) => console.log(' ', h));
            if (clientId === id) {
                const inRoutes = (payload.routes || []).flatMap((r: any) => r.stops || []);
                const foundStop = inRoutes.find(
                    (s: any) => s?.client_id === id || s?.userId === id
                );
                if (foundStop && foundStop.id !== id) {
                    console.log(
                        '\nNote: ENTITY_ID is the clients.id. Each stop row uses stops.id in JSON (`id` field);',
                        'for this client it is:',
                        foundStop.id,
                        '(searching for the client UUID in stop id fields will not match).'
                    );
                }
            }
        } else {
            console.log('❌ Not in routes[] or unrouted[] for this date/day/exclude_produce.');
        }
    } finally {
        await prisma.$disconnect();
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
