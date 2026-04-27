/**
 * Billing by client: one entry per client (parent + all dependents).
 * Amount = 336 × people (non-Produce) or 146 × people (Produce). Based on parent service_type only.
 * Same JSON format as /api/extension/billing-requests.
 *
 * - Order list: only orders NOT already marked billing_successful.
 * - Proof URLs: from ALL orders for the household, the 2 most recent that have proof_of_delivery_url
 *   (or 1 if only one); if none, uses sign_token signature PDF.
 * - Unite Us `url`: parent client's case_id_external / client_id_external only (not copied from orders).
 *
 * GET /api/bill
 * Query params:
 *   ?date=YYYY-MM-DD   – billing window start (default 2026-02-23)
 *   ?account=regular|brooklyn|both  – filter by unite_account (default: both)
 * No auth required.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseServiceOrAnonKey } from '@/lib/supabase-env';

const AMOUNT_PER_PERSON = 336;

/** Orders with this status are excluded from the order list (already billed). */
const BILLING_SUCCESSFUL = 'billing_successful';

/** Max number of proof URLs to return per household (most recent orders with proof). */
const MAX_PROOF_URLS = 2;

/** Get sortable date for an order (most recent first). */
function orderDate(o: { actual_delivery_date?: string | null; scheduled_delivery_date?: string | null }): string {
    const d = o.actual_delivery_date || o.scheduled_delivery_date || '';
    return d;
}

/** Default date for billing (YYYY-MM-DD) when no query param is provided. */
const BILL_DATE_DEFAULT = '2026-02-23';

/** Parse YYYY-MM-DD from query; returns null if missing or invalid. */
function parseBillDateFromRequest(request: NextRequest): string | null {
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

/** Parse ?account= query param. Returns 'both' if missing/invalid. */
function parseAccountFilter(request: NextRequest): AccountFilter {
    const url = request.nextUrl ?? new URL(request.url);
    const raw = (url.searchParams.get('account') || '').trim().toLowerCase();
    if (raw === 'regular' || raw === 'brooklyn') return raw;
    return 'both';
}

/** End date for 7-day billing window (start through end inclusive: start + 6 days). */
function billDateEnd(startISO: string): string {
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

/**
 * Supabase REST has a default row limit (often 1000). For endpoints like /api/bill
 * we must paginate or we silently drop clients that sort beyond the first page.
 */
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

export async function GET(request: NextRequest) {
    try {
        const billDate = parseBillDateFromRequest(request) ?? BILL_DATE_DEFAULT;
        const accountFilter = parseAccountFilter(request);

        // 1. Fetch ALL clients (incl. UniteUs fields and sign_token for signature proof fallback)
        const selectClients =
            'id, full_name, parent_client_id, service_type, case_id_external, client_id_external, sign_token, unite_account';
        const clients = await fetchAllRows<any>(
            (from, to) => {
                let q = supabase.from('clients').select(selectClients).order('id', { ascending: true }).range(from, to);
                if (accountFilter === 'brooklyn') {
                    q = q.eq('unite_account', 'Brooklyn');
                } else if (accountFilter === 'regular') {
                    q = q.or('unite_account.eq.Regular,unite_account.is.null');
                }
                return q;
            },
            1000
        );

        if (!clients || clients.length === 0) {
            return NextResponse.json([]);
        }

        const clientMap: Record<string, any> = {};
        (clients as any[]).forEach((c: any) => {
            clientMap[String(c.id)] = c;
        });

        // 2. Households = all parents (clients with no parent_client_id); use string ids for consistent lookups
        const billableClientIds = (clients as any[])
            .filter((c) => c.parent_client_id == null)
            .map((c) => String(c.id));

        if (billableClientIds.length === 0) {
            return NextResponse.json([]);
        }

        const parentMap: Record<string, any> = {};
        billableClientIds.forEach((id) => {
            if (clientMap[id]) parentMap[id] = clientMap[id];
        });

        // 3. Fetch dependents for these households (match on parent_client_id).
        // We do NOT filter dependents by unite_account — a dependent belongs to the same
        // account as their parent. The parentIdSet check below is the correct filter.
        let dependents: any[] = [];
        try {
            dependents = await fetchAllRows<any>(
                (from, to) =>
                    supabase
                        .from('clients')
                        .select('id, full_name, dob, cin, parent_client_id, unite_account')
                        .not('parent_client_id', 'is', null)
                        .order('id', { ascending: true })
                        .range(from, to),
                1000
            );
        } catch (dependentsError: any) {
            console.error('[api/bill] Error fetching dependents:', dependentsError);
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

        // 4. All client ids (parents + their dependants only) for order lookup – string ids for .in()
        const allClientIds = new Set<string>(billableClientIds);
        billableClientIds.forEach((pid) => {
            (dependentsByParent[pid] || []).forEach((d: any) => {
                if (d?.id != null && d.id !== '') allClientIds.add(String(d.id));
            });
        });
        const allClientIdsArray = [...allClientIds].filter(
            (id) => id && id !== 'null' && id !== 'undefined' && id.length > 0
        );

        // 5. Fetch orders (parent + dependants) for these clients; batch .in() to avoid URL/param limits
        const COLS = 'id, order_number, actual_delivery_date, scheduled_delivery_date, proof_of_delivery_url, client_id, status';
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
                    console.error('[api/bill] Error fetching orders:', ordersError);
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

        // Per household:
        // - Order list: only orders NOT billing_successful (already billed are excluded).
        // - Proof URLs: from ALL orders (any status), sort by most recent, take up to MAX_PROOF_URLS that have proof.
        const orderNumbersByHousehold: Record<string, string[]> = {};
        const proofURLsByHousehold: Record<string, string[]> = {};
        for (const householdId of Object.keys(ordersByHousehold)) {
            const list = ordersByHousehold[householdId] as any[];
            // Orders for the list: exclude billing_successful
            const ordersForList = list.filter((o: any) => String(o.status || '').toLowerCase() !== BILLING_SUCCESSFUL);
            orderNumbersByHousehold[householdId] = ordersForList.map((o: any) => String(o.order_number ?? ''));

            // Proof URLs: all orders sorted by date (most recent first), then take those with proof, up to MAX_PROOF_URLS
            const sortedByDate = [...list].sort((a: any, b: any) => {
                const da = orderDate(a);
                const db = orderDate(b);
                return db.localeCompare(da);
            });
            const withProof = sortedByDate.filter(
                (o: any) => o.proof_of_delivery_url != null && String(o.proof_of_delivery_url).trim() !== ''
            );
            const urls = withProof
                .slice(0, MAX_PROOF_URLS)
                .map((o: any) => String(o.proof_of_delivery_url).trim());
            proofURLsByHousehold[householdId] = urls;
        }

        // 6. One entry per household (parent). Orders include parent + dependants. Amount by parent service_type: Produce => 146/person, else 336/person
        const result = billableClientIds.map((parentId) => {
            const pid = parentId;
            const parent = parentMap[parentId] || {};
            const deps = dependentsByParent[pid] || [];
            const totalPeople = 1 + deps.length;
            const amount = AMOUNT_PER_PERSON * totalPeople;

            let orderNumbers = orderNumbersByHousehold[pid] ?? [];
            let proofURLs = proofURLsByHousehold[pid] ?? [];
            if (proofURLs.length === 0 && parent.sign_token) {
                const endDate = billDateEnd(billDate);
                proofURLs = [
                    `${baseUrl}/api/signatures/${encodeURIComponent(String(parent.sign_token))}/pdf?start=${billDate}&end=${endDate}&delivery=${billDate}`,
                ];
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
                url,
                orderNumbers,
                proofURLs,
                date: billDate,
                endDate: billDateEnd(billDate),
                amount: Number(amount),
                dependants: deps.map((d: any) => ({
                    name: d.full_name ?? '',
                    Birthday: formatDate(d.dob),
                    CIN: d.cin != null ? String(d.cin) : '',
                })),
            };
        });

        return NextResponse.json(result);
    } catch (error: any) {
        console.error('[api/bill] Error:', error);
        return NextResponse.json(
            { success: false, error: error.message || 'Internal Server Error' },
            { status: 500 }
        );
    }
}

function formatDate(dob: string | Date | null | undefined): string {
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
