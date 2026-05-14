/**
 * Shared implementation for GET /api/bill and GET /api/bill/invoices.
 *
 * `orderNumbers` per household only includes orders whose effective delivery date (actual if set,
 * else scheduled) falls in the billing window [date, endDate], excluding billing_successful.
 * Photo proof selection still may use orders outside that window as a fallback when none in-window
 * have proofs.
 *
 * Optional `onlyreal=1` (or true/yes): return only households that have at least one order with an
 * effective delivery date in that window (any status). Default is all billable parents regardless
 * of in-window orders.
 *
 * Archived (“deleted”) clients: households are still included when the parent or a dependant has
 * an order whose effective delivery falls in the billing window, even if those client rows are
 * archived. Dependants are loaded for billing parents without excluding archived rows.
 */

import { NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseServiceOrAnonKey } from '@/lib/supabase-env';

const AMOUNT_PER_PERSON = 336;

/** Orders with this status are excluded from the order list (already billed). */
const BILLING_SUCCESSFUL = 'billing_successful';

/** Max number of proof URLs to return per household (most recent orders with proof). */
const MAX_PROOF_URLS = 2;

/** Default date for billing (YYYY-MM-DD) when no query param is provided. */
export const BILL_DATE_DEFAULT = '2026-02-23';

function orderDate(o: { actual_delivery_date?: string | null; scheduled_delivery_date?: string | null }): string {
    const d = o.actual_delivery_date || o.scheduled_delivery_date || '';
    return d;
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

/** Parse YYYY-MM-DD from query; returns null if missing or invalid. */
export function parseBillDateFromRequest(request: NextRequest): string | null {
    const url = request.nextUrl ?? new URL(request.url);
    const dateParam = url.searchParams.get('date');
    if (!dateParam || typeof dateParam !== 'string') return null;
    const trimmed = dateParam.trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null;
    const d = new Date(trimmed + 'T00:00:00Z');
    if (Number.isNaN(d.getTime())) return null;
    return trimmed;
}

type AccountFilter = 'regular' | 'brooklyn' | 'both';

export function parseAccountFilter(request: NextRequest): AccountFilter {
    const url = request.nextUrl ?? new URL(request.url);
    const raw = (url.searchParams.get('account') || '').trim().toLowerCase();
    if (raw === 'regular' || raw === 'brooklyn') return raw;
    return 'both';
}

/** When true, only households with ≥1 order whose effective delivery falls in [date, endDate]. */
export function parseOnlyRealFromRequest(request: NextRequest): boolean {
    const url = request.nextUrl ?? new URL(request.url);
    const raw = (url.searchParams.get('onlyreal') || '').trim().toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes';
}

function clientMatchesAccountFilter(clientRow: any, accountFilter: AccountFilter): boolean {
    const ua = clientRow?.unite_account;
    if (accountFilter === 'brooklyn') return ua === 'Brooklyn';
    if (accountFilter === 'regular') return ua === 'Regular' || ua == null || String(ua).trim() === '';
    return true;
}

/** Load clients by id (including archived) and chase parent_client_id until roots are in the map. */
async function fetchClientsGraphFromIds(
    seedIds: string[],
    select: string,
    logPrefix: string,
): Promise<Map<string, any>> {
    const map = new Map<string, any>();
    const pending = new Set(
        seedIds.map((id) => String(id).trim()).filter((id) => id.length > 0 && id !== 'null' && id !== 'undefined'),
    );
    while (pending.size > 0) {
        const batch = [...pending].slice(0, 100);
        for (const id of batch) pending.delete(id);
        const { data, error } = await supabase.from('clients').select(select).in('id', batch);
        if (error) {
            console.error(`${logPrefix} fetch clients by id`, error);
            continue;
        }
        for (const row of (data || []) as any[]) {
            const id = String(row.id);
            if (map.has(id)) continue;
            map.set(id, row);
            const pid = row.parent_client_id;
            if (pid != null && pid !== '' && !map.has(String(pid))) {
                pending.add(String(pid));
            }
        }
    }
    return map;
}

/** Orders that may fall in [billDate, billEndDate] on actual or scheduled (superset); filter with orderISODate. */
async function fetchOrderRowsNearBillingWindow(
    billDate: string,
    billEndDate: string,
    cols: string,
    logPrefix: string,
): Promise<any[]> {
    const orClause = `and(actual_delivery_date.gte.${billDate},actual_delivery_date.lte.${billEndDate}),and(scheduled_delivery_date.gte.${billDate},scheduled_delivery_date.lte.${billEndDate})`;
    try {
        return await fetchAllRows<any>(
            (from, to) =>
                supabase.from('orders').select(cols).or(orClause).order('id', { ascending: true }).range(from, to),
            1000,
        );
    } catch (e: any) {
        console.error(`${logPrefix} billing-window orders discovery`, e);
        return [];
    }
}

/** End date for 7-day billing window (start through end inclusive: start + 6 days). */
export function billDateEnd(startISO: string): string {
    const d = new Date(startISO + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + 6);
    return d.toISOString().slice(0, 10);
}

const UNITEUS_BASE = 'https://app.uniteus.io/dashboard/cases/open';
function isFullUniteUsUrl(s: string): boolean {
    const t = String(s).trim();
    return t.startsWith('http') && t.includes('uniteus.io') && t.includes('dashboard/cases/open');
}
function buildUniteUsUrl(caseId: string | null | undefined, contactClientId: string | null | undefined): string {
    if (!caseId) return '';
    const raw = String(caseId).trim();
    if (isFullUniteUsUrl(raw)) return raw;
    if (!contactClientId) return '';
    return `${UNITEUS_BASE}/${encodeURIComponent(raw)}/contact/${encodeURIComponent(String(contactClientId))}`;
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = getSupabaseServiceOrAnonKey()!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function fetchAllRows<T = any>(build: (from: number, to: number) => any, pageSize = 1000): Promise<T[]> {
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

export type BillProofStrategy = 'signatureOrOrderProofs' | 'customerInvoicePdf';

/** Same `from` / `to` as the billing row’s `date` / `endDate` (7-day window inclusive). */
function customerInvoicePdfProofUrl(parentId: string, billDate: string, billEndDate: string): string {
    const origin =
        process.env.NEXT_PUBLIC_CUSTOMER_APP_URL?.replace(/\/$/, '') ||
        process.env.NEXT_PUBLIC_CUSTOMER_URL?.replace(/\/$/, '') ||
        'http://customer.thedietfantasy.com';
    const u = new URL('/api/client-invoice-pdf', origin.endsWith('/') ? origin.slice(0, -1) : origin);
    u.searchParams.set('clientId', parentId);
    u.searchParams.set('from', billDate);
    u.searchParams.set('to', billEndDate);
    return u.toString();
}

export function formatBillDependantDob(dob: string | Date | null | undefined): string {
    if (dob == null) return '';
    try {
        const str = typeof dob === 'string' ? dob : dob instanceof Date ? dob.toISOString().slice(0, 10) : String(dob);
        const [year, month, day] = str.split('-');
        if (year && month && day) {
            return `${month}/${day}/${year}`;
        }
        return str;
    } catch {
        return '';
    }
}

export type BillHouseholdRow = {
    clientId: string;
    name: string;
    createdAt: string | null;
    url: string;
    orderNumbers: string[];
    proofURLs: string[];
    date: string;
    endDate: string;
    amount: number;
    dependants: Array<{
        name: string;
        Birthday: string;
        CIN: string;
        createdAt: string | null;
    }>;
};

export async function getBillHouseholdRows(
    request: NextRequest,
    proofStrategy: BillProofStrategy,
    logPrefix = '[api/bill]'
): Promise<BillHouseholdRow[]> {
    const billDate = parseBillDateFromRequest(request) ?? BILL_DATE_DEFAULT;
    const billEndDate = billDateEnd(billDate);
    const accountFilter = parseAccountFilter(request);
    const onlyReal = parseOnlyRealFromRequest(request);

    const COLS = 'id, order_number, actual_delivery_date, scheduled_delivery_date, proof_of_delivery_url, client_id, status';

    const selectClients =
        'id, full_name, parent_client_id, service_type, case_id_external, client_id_external, sign_token, unite_account, created_at, bill';
    const clients = await fetchAllRows<any>(
        (from, to) => {
            let q = supabase
                .from('clients')
                .select(selectClients)
                .is('archived_at', null)
                .order('id', { ascending: true })
                .range(from, to);
            if (accountFilter === 'brooklyn') {
                q = q.eq('unite_account', 'Brooklyn');
            } else if (accountFilter === 'regular') {
                q = q.or('unite_account.eq.Regular,unite_account.is.null');
            }
            return q;
        },
        1000
    );

    const clientMap: Record<string, any> = {};
    (clients as any[] || []).forEach((c: any) => {
        clientMap[String(c.id)] = c;
    });

    const activeBillableParentIds = (clients as any[])
        .filter((c) => c.parent_client_id == null && c.bill !== false)
        .map((c) => String(c.id));
    const activeBillableSet = new Set(activeBillableParentIds);

    const supplementBillableParentIds = new Set<string>();
    const approxWindowOrders = await fetchOrderRowsNearBillingWindow(billDate, billEndDate, COLS, logPrefix);
    const inWindowDiscoveryOrders = approxWindowOrders.filter((o: any) => {
        const iso = orderISODate(o);
        return iso.length >= 10 && isISODateInRangeInclusive(iso, billDate, billEndDate);
    });

    const orderClientIds = [
        ...new Set(inWindowDiscoveryOrders.map((o: any) => String(o.client_id)).filter((id) => id && id !== 'null')),
    ];
    if (orderClientIds.length > 0) {
        const discoveryMap = await fetchClientsGraphFromIds(orderClientIds, selectClients, logPrefix);
        for (const [id, row] of discoveryMap) {
            clientMap[id] = row;
        }

        for (const o of inWindowDiscoveryOrders) {
            const cid = String(o.client_id);
            const row = clientMap[cid];
            if (!row) continue;
            const root =
                row.parent_client_id != null && row.parent_client_id !== ''
                    ? String(row.parent_client_id)
                    : String(row.id);
            const parentRow = clientMap[root];
            if (!parentRow || parentRow.parent_client_id != null) continue;
            if (parentRow.bill === false) continue;
            if (!clientMatchesAccountFilter(parentRow, accountFilter)) continue;
            if (activeBillableSet.has(root)) continue;
            supplementBillableParentIds.add(root);
        }
    }

    const billableClientIds = [
        ...activeBillableParentIds,
        ...[...supplementBillableParentIds].filter((id) => !activeBillableSet.has(id)),
    ];

    if (billableClientIds.length === 0) {
        return [];
    }

    const parentMap: Record<string, any> = {};
    billableClientIds.forEach((id) => {
        if (clientMap[id]) parentMap[id] = clientMap[id];
    });

    let dependents: any[] = [];
    const PARENT_ID_BATCH = 80;
    try {
        for (let i = 0; i < billableClientIds.length; i += PARENT_ID_BATCH) {
            const pidChunk = billableClientIds.slice(i, i + PARENT_ID_BATCH);
            const { data: depChunk, error: depErr } = await supabase
                .from('clients')
                .select('id, full_name, dob, cin, parent_client_id, unite_account, created_at')
                .in('parent_client_id', pidChunk);
            if (depErr) {
                console.error(`${logPrefix} Error fetching dependents:`, depErr);
                continue;
            }
            dependents = dependents.concat(depChunk || []);
        }
    } catch (dependentsError: any) {
        console.error(`${logPrefix} Error fetching dependents:`, dependentsError);
        dependents = [];
    }

    const parentIdSet = new Set(billableClientIds);
    const dependentsByParent: Record<string, any[]> = {};
    (dependents || []).forEach((dep: any) => {
        const pid = dep.parent_client_id != null ? String(dep.parent_client_id) : null;
        if (pid && parentIdSet.has(pid)) {
            if (!dependentsByParent[pid]) dependentsByParent[pid] = [];
            dependentsByParent[pid].push(dep);
        }
    });

    const allClientIds = new Set<string>(billableClientIds);
    billableClientIds.forEach((pid) => {
        (dependentsByParent[pid] || []).forEach((d: any) => {
            if (d?.id != null && d.id !== '') allClientIds.add(String(d.id));
        });
    });
    const allClientIdsArray = [...allClientIds].filter(
        (id) => id && id !== 'null' && id !== 'undefined' && id.length > 0
    );

    let ordersList: any[] = [];
    if (allClientIdsArray.length > 0) {
        const BATCH = 80;
        for (let i = 0; i < allClientIdsArray.length; i += BATCH) {
            const chunk = allClientIdsArray.slice(i, i + BATCH);
            const { data: orders, error: ordersError } = await supabase
                .from('orders')
                .select(COLS)
                .in('client_id', chunk)
                .order('scheduled_delivery_date', { ascending: false });
            if (ordersError) {
                console.error(`${logPrefix} Error fetching orders:`, ordersError);
                throw new Error(ordersError.message || 'Failed to fetch orders');
            }
            ordersList = ordersList.concat(orders || []);
        }
    }
    const baseUrl =
        (typeof request?.url === 'string' ? new URL(request.url).origin : null) ||
        (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
        process.env.NEXT_PUBLIC_APP_URL ||
        'http://localhost:3000';

    const clientToHousehold: Record<string, string> = {};
    billableClientIds.forEach((pid) => {
        clientToHousehold[pid] = pid;
        (dependentsByParent[pid] || []).forEach((d: any) => {
            clientToHousehold[String(d.id)] = pid;
        });
    });

    const ordersByHousehold: Record<string, any[]> = {};
    for (const order of ordersList) {
        const cid = order.client_id;
        const householdId = cid ? clientToHousehold[String(cid)] : null;
        if (householdId) {
            if (!ordersByHousehold[householdId]) ordersByHousehold[householdId] = [];
            ordersByHousehold[householdId].push(order);
        }
    }

    const billableClientIdsForRows = onlyReal
        ? billableClientIds.filter((pid) => {
              const list = ordersByHousehold[pid] ?? [];
              return list.some((o: any) => {
                  const iso = orderISODate(o);
                  return iso.length >= 10 && isISODateInRangeInclusive(iso, billDate, billEndDate);
              });
          })
        : billableClientIds;

    const orderNumbersByHousehold: Record<string, string[]> = {};
    const proofURLsByHousehold: Record<string, string[]> = {};
    for (const householdId of Object.keys(ordersByHousehold)) {
        const list = ordersByHousehold[householdId] as any[];
        const ordersForList = list.filter((o: any) => {
            if (String(o.status || '').toLowerCase() === BILLING_SUCCESSFUL) return false;
            const iso = orderISODate(o);
            return iso.length >= 10 && isISODateInRangeInclusive(iso, billDate, billEndDate);
        });
        orderNumbersByHousehold[householdId] = ordersForList.map((o: any) => String(o.order_number ?? ''));

        const sortedByDate = [...list].sort((a: any, b: any) => {
            const da = orderDate(a);
            const db = orderDate(b);
            return db.localeCompare(da);
        });
        const withProof = sortedByDate.filter(
            (o: any) => o.proof_of_delivery_url != null && String(o.proof_of_delivery_url).trim() !== ''
        );
        const inWeek = withProof.filter((o: any) =>
            isISODateInRangeInclusive(orderISODate(o), billDate, billEndDate)
        );
        const preferred = inWeek.length > 0 ? inWeek : withProof;
        proofURLsByHousehold[householdId] = preferred
            .slice(0, MAX_PROOF_URLS)
            .map((o: any) => String(o.proof_of_delivery_url).trim());
    }

    return billableClientIdsForRows.map((parentId) => {
        const pid = parentId;
        const parent = parentMap[parentId] || {};
        const deps = dependentsByParent[pid] || [];
        const totalPeople = 1 + deps.length;
        const amount = AMOUNT_PER_PERSON * totalPeople;

        const orderNumbers = orderNumbersByHousehold[pid] ?? [];

        let proofURLs: string[];
        if (proofStrategy === 'customerInvoicePdf') {
            proofURLs = [customerInvoicePdfProofUrl(pid, billDate, billEndDate)];
        } else if (parent.sign_token) {
            proofURLs = [
                `${baseUrl}/api/signatures/${encodeURIComponent(String(parent.sign_token))}/pdf?start=${billDate}&end=${billEndDate}&delivery=${billDate}`,
            ];
        } else {
            proofURLs = proofURLsByHousehold[pid] ?? [];
        }

        const contactId = parent.client_id_external || pid;
        let url = '';
        if (parent.case_id_external) {
            const raw = String(parent.case_id_external).trim();
            url = raw.startsWith('http') ? raw : buildUniteUsUrl(raw, contactId);
        }

        return {
            clientId: pid,
            name: parent.full_name || 'Unknown Client',
            createdAt: parent.created_at != null ? String(parent.created_at) : null,
            url,
            orderNumbers,
            proofURLs,
            date: billDate,
            endDate: billEndDate,
            amount: Number(amount),
            dependants: deps.map((d: any) => ({
                name: d.full_name ?? '',
                Birthday: formatBillDependantDob(d.dob),
                CIN: d.cin != null ? String(d.cin) : '',
                createdAt: d.created_at != null ? String(d.created_at) : null,
            })),
        };
    });
}
