/**
 * Lists parent client IDs that appear on the regular billing list ONLY via the
 * "supplement" path (order-in-window discovery), not from the initial active-clients query.
 *
 * Usage:
 *   npx tsx scripts/list-billing-supplement-parents.ts [--date=YYYY-MM-DD]
 *
 * Matches GET /api/bill: archived clients never contribute (no supplement from archived rows).
 * Default date matches lib/api/bill-household-rows.ts BILL_DATE_DEFAULT.
 */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const BILL_DATE_DEFAULT = '2026-02-23';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing Supabase URL/key in .env.local');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { autoRefreshToken: false, persistSession: false },
});

function orderDate(o: { actual_delivery_date?: string | null; scheduled_delivery_date?: string | null }): string {
    return o.actual_delivery_date || o.scheduled_delivery_date || '';
}

function orderISODate(o: { actual_delivery_date?: string | null; scheduled_delivery_date?: string | null }): string {
    const raw = orderDate(o);
    if (!raw) return '';
    const s = String(raw).trim();
    if (s.length >= 10) return s.slice(0, 10);
    return '';
}

function isISODateInRangeInclusive(isoDate: string, startISO: string, endISO: string): boolean {
    if (!isoDate || isoDate.length < 10) return false;
    return isoDate >= startISO && isoDate <= endISO;
}

function billDateEnd(startISO: string): string {
    const d = new Date(startISO + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 6);
    return d.toISOString().slice(0, 10);
}

async function fetchAllRows<T = unknown>(build: (from: number, to: number) => any, pageSize = 1000): Promise<T[]> {
    const all: T[] = [];
    let from = 0;
    while (true) {
        const to = from + pageSize - 1;
        const { data, error } = await build(from, to);
        if (error) throw error;
        const chunk = (data || []) as T[];
        if (chunk.length === 0) break;
        all.push(...chunk);
        if (chunk.length < pageSize) break;
        from += pageSize;
    }
    return all;
}

function clientMatchesRegular(clientRow: { unite_account?: string | null }): boolean {
    const ua = clientRow?.unite_account;
    return ua === 'Regular' || ua == null || String(ua).trim() === '';
}

async function fetchClientsGraphFromIds(seedIds: string[], select: string): Promise<Map<string, Record<string, unknown>>> {
    const map = new Map<string, Record<string, unknown>>();
    const pending = new Set(
        seedIds.map((id) => String(id).trim()).filter((id) => id.length > 0 && id !== 'null' && id !== 'undefined'),
    );
    while (pending.size > 0) {
        const batch = [...pending].slice(0, 100);
        for (const id of batch) pending.delete(id);
        const { data, error } = await supabase.from('clients').select(select).in('id', batch);
        if (error) {
            console.error('fetch clients by id', error);
            continue;
        }
        for (const row of data || []) {
            const r = row as Record<string, unknown>;
            const id = String(r.id);
            if (map.has(id)) continue;
            map.set(id, r);
            const pid = r.parent_client_id;
            if (pid != null && pid !== '' && !map.has(String(pid))) {
                pending.add(String(pid));
            }
        }
    }
    return map;
}

function parseDateArg(): string {
    const arg = process.argv.find((a) => a.startsWith('--date='));
    if (arg) {
        const d = arg.slice('--date='.length).trim();
        if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    }
    return BILL_DATE_DEFAULT;
}

function rowHasArchivedAt(parent: Record<string, unknown> | undefined): boolean {
    const a = parent?.archived_at;
    if (a == null) return false;
    return String(a).trim().length > 0;
}

function classifyReason(parent: Record<string, unknown>): string {
    const ua = parent.unite_account;
    const uaStr = ua == null ? '' : String(ua);

    if (rowHasArchivedAt(parent)) {
        return 'Unexpected: archived parent in supplement list; billing code should skip.';
    }
    if (uaStr.trim() === '' || (uaStr !== 'Regular' && ua != null)) {
        return (
            'Active parent omitted from initial Supabase query ' +
            '`unite_account.eq.Regular OR unite_account.is.null` (e.g. empty string), then included via order-in-window discovery.'
        );
    }
    return 'Active Regular/null parent not in first page batch edge case, or logic drift — verify.';
}

async function main() {
    const billDate = parseDateArg();
    const billEndDate = billDateEnd(billDate);
    const selectClients =
        'id, full_name, parent_client_id, unite_account, created_at, bill, archived_at';

    const clients = await fetchAllRows<Record<string, unknown>>(
        (from, to) =>
            supabase
                .from('clients')
                .select(selectClients)
                .is('archived_at', null)
                .or('unite_account.eq.Regular,unite_account.is.null')
                .order('id', { ascending: true })
                .range(from, to),
        1000,
    );

    const clientMap: Record<string, Record<string, unknown>> = {};
    for (const c of clients) {
        clientMap[String(c.id)] = c;
    }

    const activeBillableParentIds = clients
        .filter((c) => c.parent_client_id == null && c.bill !== false)
        .map((c) => String(c.id));
    const activeBillableSet = new Set(activeBillableParentIds);

    const COLS = 'id, order_number, actual_delivery_date, scheduled_delivery_date, client_id, status';
    const orClause = `and(actual_delivery_date.gte.${billDate},actual_delivery_date.lte.${billEndDate}),and(scheduled_delivery_date.gte.${billDate},scheduled_delivery_date.lte.${billEndDate})`;

    const approxWindowOrders = await fetchAllRows<Record<string, unknown>>(
        (from, to) =>
            supabase.from('orders').select(COLS).or(orClause).order('id', { ascending: true }).range(from, to),
        1000,
    );

    const inWindowDiscoveryOrders = approxWindowOrders.filter((o) => {
        const iso = orderISODate(o);
        return iso.length >= 10 && isISODateInRangeInclusive(iso, billDate, billEndDate);
    });

    const orderClientIds = [
        ...new Set(inWindowDiscoveryOrders.map((o) => String(o.client_id)).filter((id) => id && id !== 'null')),
    ];

    const supplementBillableParentIds = new Set<string>();

    if (orderClientIds.length > 0) {
        const discoveryMap = await fetchClientsGraphFromIds(orderClientIds, selectClients);
        for (const [id, row] of discoveryMap) {
            clientMap[id] = row;
        }

        for (const o of inWindowDiscoveryOrders) {
            const cid = String(o.client_id);
            const row = clientMap[cid];
            if (!row) continue;
            if (rowHasArchivedAt(row as Record<string, unknown>)) continue;
            const root =
                row.parent_client_id != null && row.parent_client_id !== ''
                    ? String(row.parent_client_id)
                    : String(row.id);
            const parentRow = clientMap[root];
            if (!parentRow || parentRow.parent_client_id != null) continue;
            if (parentRow.bill === false) continue;
            if (rowHasArchivedAt(parentRow as Record<string, unknown>)) continue;
            if (!clientMatchesRegular(parentRow)) continue;
            if (activeBillableSet.has(root)) continue;
            supplementBillableParentIds.add(root);
        }
    }

    console.log('=== Billing supplement parents (account=regular) ===');
    console.log('Billing window:', billDate, 'through', billEndDate, '(inclusive)');
    console.log('Supplement-only parent count:', supplementBillableParentIds.size);
    console.log('');

    const sorted = [...supplementBillableParentIds].sort();
    for (const id of sorted) {
        const p = clientMap[id];
        const name = p?.full_name != null ? String(p.full_name) : '';
        const ua = p?.unite_account;
        const arch = p?.archived_at != null ? String(p.archived_at) : '';
        console.log('---');
        console.log('clientId:', id);
        console.log('full_name:', name);
        console.log('unite_account:', ua === null || ua === undefined ? '(null)' : JSON.stringify(ua));
        console.log('archived_at:', arch ? arch : '(null)');
        console.log('reason:', classifyReason(p || {}));
    }

    if (sorted.length === 0) {
        console.log('No supplement-only parents for this date window.');
    }
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
