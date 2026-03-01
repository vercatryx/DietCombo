/**
 * Billing by client: one entry per client (parent + all dependents).
 * Amount = 336 × people (non-Produce) or 146 × people (Produce). Based on parent service_type only.
 * Same JSON format as /api/extension/billing-requests.
 *
 * GET /api/bill
 * No auth required.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const AMOUNT_PER_PERSON = 336;
const AMOUNT_PER_PERSON_PRODUCE = 146;

/** Default date for billing (YYYY-MM-DD). Delivery date and start of 7-day window. */
const BILL_DATE_DEFAULT = '2026-02-23';

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
const supabaseServiceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(request: NextRequest) {
    try {
        // 1. Fetch ALL clients (incl. UniteUs fields and sign_token for signature proof fallback)
        const { data: clients, error: clientsError } = await supabase
            .from('clients')
            .select('id, full_name, parent_client_id, service_type, case_id_external, client_id_external, sign_token')
            .order('id', { ascending: true });

        if (clientsError) {
            console.error('[api/bill] Error fetching clients:', clientsError);
            throw new Error(clientsError.message);
        }

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

        // 3. Fetch dependents for these households (match on parent_client_id)
        const { data: dependents, error: dependentsError } = await supabase
            .from('clients')
            .select('id, full_name, dob, cin, parent_client_id')
            .not('parent_client_id', 'is', null);

        if (dependentsError) {
            console.error('[api/bill] Error fetching dependents:', dependentsError);
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
        const COLS = 'id, order_number, case_id, actual_delivery_date, scheduled_delivery_date, proof_of_delivery_url, client_id, status';
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

        // All orders per household (parent + dependants). proofURLs: only non-blank URLs (never include "").
        const orderNumbersByHousehold: Record<string, string[]> = {};
        const proofURLsByHousehold: Record<string, string[]> = {};
        for (const householdId of Object.keys(ordersByHousehold)) {
            const list = ordersByHousehold[householdId] as any[];
            orderNumbersByHousehold[householdId] = list.map((o: any) => String(o.order_number ?? ''));
            const urls = list
                .map((o: any) => (o.proof_of_delivery_url != null ? String(o.proof_of_delivery_url).trim() : ''))
                .filter((u: string) => u !== '');
            proofURLsByHousehold[householdId] = urls;
        }

        const bestOrderByHousehold: Record<string, any> = {};
        for (const householdId of Object.keys(ordersByHousehold)) {
            const list = ordersByHousehold[householdId];
            const withCase = list.find((o: any) => o.case_id);
            const withProof = list.find((o: any) => o.proof_of_delivery_url);
            bestOrderByHousehold[householdId] = withCase ?? withProof ?? list[0];
        }

        // 6. One entry per household (parent). Orders include parent + dependants. Amount by parent service_type: Produce => 146/person, else 336/person
        const result = billableClientIds.map((parentId) => {
            const pid = parentId;
            const bestOrder = bestOrderByHousehold[parentId];
            const parent = parentMap[parentId] || {};
            const deps = dependentsByParent[pid] || [];
            const totalPeople = 1 + deps.length;
            const isProduce = (parent.service_type || '')
                .split(',')
                .map((s: string) => s.trim().toLowerCase())
                .includes('produce');
            const amount = isProduce
                ? AMOUNT_PER_PERSON_PRODUCE * totalPeople
                : AMOUNT_PER_PERSON * totalPeople;

            let orderNumbers = orderNumbersByHousehold[pid] ?? [];
            let proofURLs = proofURLsByHousehold[pid] ?? [];
            if (proofURLs.length === 0 && parent.sign_token) {
                const endDate = billDateEnd(BILL_DATE_DEFAULT);
                proofURLs = [
                    `${baseUrl}/api/signatures/${encodeURIComponent(String(parent.sign_token))}/pdf?start=${BILL_DATE_DEFAULT}&end=${endDate}&delivery=${BILL_DATE_DEFAULT}`,
                ];
            }

            let url = buildUniteUsUrl(bestOrder?.case_id, pid);
            if (!url && parent.case_id_external) {
                const raw = String(parent.case_id_external).trim();
                url = raw.startsWith('http') ? raw : buildUniteUsUrl(raw, parent.client_id_external || pid);
            }

            return {
                clientId: pid,
                name: parent.full_name || 'Unknown Client',
                url,
                orderNumbers,
                proofURLs,
                date: BILL_DATE_DEFAULT,
                endDate: billDateEnd(BILL_DATE_DEFAULT),
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
