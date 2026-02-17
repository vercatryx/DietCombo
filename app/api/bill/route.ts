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

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function GET(request: NextRequest) {
    try {
        // 1. Fetch ALL clients (id, full_name, parent_client_id, service_type for Produce vs non-Produce)
        const { data: clients, error: clientsError } = await supabase
            .from('clients')
            .select('id, full_name, parent_client_id, service_type')
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
            clientMap[c.id] = c;
        });

        // 2. Households = all parents (clients with no parent_client_id)
        const billableClientIds = (clients as any[])
            .filter((c) => c.parent_client_id == null)
            .map((c) => c.id);

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

        const parentIdSet = new Set(billableClientIds.map((id) => String(id)));
        const dependentsByParent: Record<string, any[]> = {};
        (dependents || []).forEach((dep: any) => {
            const pid = dep.parent_client_id != null ? String(dep.parent_client_id) : null;
            if (pid && parentIdSet.has(pid)) {
                if (!dependentsByParent[pid]) dependentsByParent[pid] = [];
                dependentsByParent[pid].push(dep);
            }
        });

        // 4. All client ids (parents + dependents) for order lookup
        const allClientIds = new Set(billableClientIds);
        (dependents || []).forEach((d: any) => allClientIds.add(d.id));

        // 5. Fetch orders (any status) for all these clients – use one per household for url/orderNumber/date/proofURL
        const { data: orders } = await supabase
            .from('orders')
            .select(
                'id, order_number, case_id, actual_delivery_date, scheduled_delivery_date, proof_of_delivery_url, client_id'
            )
            .in('client_id', [...allClientIds])
            .order('scheduled_delivery_date', { ascending: false });

        const ordersList = (orders || []) as any[];
        const clientToHousehold: Record<string, string> = {};
        billableClientIds.forEach((pid) => {
            clientToHousehold[pid] = pid;
            (dependentsByParent[pid] || []).forEach((d: any) => {
                clientToHousehold[d.id] = pid;
            });
        });

        const firstOrderByHousehold: Record<string, any> = {};
        for (const order of ordersList) {
            const cid = order.client_id;
            const householdId = cid ? clientToHousehold[cid] : null;
            if (householdId && !firstOrderByHousehold[householdId]) {
                firstOrderByHousehold[householdId] = order;
            }
        }

        // 6. One entry per client (household/parent). Amount by parent service_type only: Produce => 146/person, else 336/person
        const result = billableClientIds.map((parentId) => {
            const pid = String(parentId);
            const firstOrder = firstOrderByHousehold[parentId];
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

            const dateStr =
                firstOrder?.actual_delivery_date || firstOrder?.scheduled_delivery_date || '';
            const proofURL = firstOrder?.proof_of_delivery_url || '';

            return {
                name: parent.full_name || 'Unknown Client',
                url: firstOrder?.case_id ?? '',
                orderNumber: firstOrder?.order_number ?? '',
                date: dateStr,
                amount: Number(amount),
                proofURL,
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
