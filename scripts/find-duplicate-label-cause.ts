/**
 * Definitively find why a client (e.g. GITTEL GRADSTEIN) appears twice on vendor labels.
 * Simulates getOrdersByVendor for the vendor+date and traces duplicate order ids or duplicate client_ids.
 *
 * Run: npx ts-node --compiler-options '{"module":"CommonJS","moduleResolution":"node"}' scripts/find-duplicate-label-cause.ts
 */

import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';

const VENDOR_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ROW_CHUNK = 500;

// Household: search for GRADSTEIN to find parent + dependants
const HOUSEHOLD_SEARCH = 'GRADSTEIN';
// Date to investigate (YYYY-MM-DD) — set to the date when duplicate label was seen
const DELIVERY_DATE = '2026-02-23';

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

function toCalendarDateKey(dateInput: string): string {
    const s = dateInput.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = new Date(dateInput);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

async function main() {
    const env = loadEnv();
    const url = env['NEXT_PUBLIC_SUPABASE_URL'];
    const serviceKey = env['SUPABASE_SERVICE_ROLE_KEY'];
    if (!url || !serviceKey) {
        console.error('Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local');
        process.exit(1);
    }

    const db = createClient(url, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
    });

    const dateKey = toCalendarDateKey(DELIVERY_DATE);
    console.log('=== Find duplicate label cause ===\n');
    console.log('Vendor ID:', VENDOR_ID);
    console.log('Delivery date:', DELIVERY_DATE, '(key:', dateKey + ')');
    console.log('Household search:', HOUSEHOLD_SEARCH);
    console.log('');

    // --- 1. Find household: parent + all dependants ---
    const { data: allGradstein } = await db
        .from('clients')
        .select('id, full_name, parent_client_id')
        .ilike('full_name', `%${HOUSEHOLD_SEARCH}%`);
    if (!allGradstein?.length) {
        console.error('No clients found for', HOUSEHOLD_SEARCH);
        process.exit(1);
    }
    const parentIds = new Set<string>();
    for (const c of allGradstein) {
        if (!c.parent_client_id) parentIds.add(c.id);
    }
    const dependantParentIds = [...new Set((allGradstein as any[]).map((c: any) => c.parent_client_id).filter(Boolean))];
    const householdParentId = dependantParentIds[0] || parentIds.values().next().value;
    const { data: dependants } = await db
        .from('clients')
        .select('id, full_name')
        .eq('parent_client_id', householdParentId);
    const parentRow = (allGradstein as any[]).find((c: any) => c.id === householdParentId);
    const householdIds = new Set<string>([householdParentId]);
    (dependants || []).forEach((d: any) => householdIds.add(d.id));
    if (parentRow) householdIds.add(parentRow.id);
    console.log('1. HOUSEHOLD (parent + dependants)');
    console.log('   Parent:', householdParentId, parentRow?.full_name ?? '');
    (dependants || []).forEach((d: any) => console.log('   Dependant:', d.id, d.full_name));
    console.log('   Household client_ids:', [...householdIds]);
    console.log('');

    // --- 2. Raw DB: how many orders per household member for this vendor+date? ---
    const { data: ordersRaw } = await db
        .from('orders')
        .select('id, order_number, client_id, scheduled_delivery_date, vendor_id, created_at')
        .eq('vendor_id', VENDOR_ID)
        .eq('scheduled_delivery_date', dateKey)
        .in('client_id', [...householdIds]);
    const ordersRawList = ordersRaw || [];
    const countByClient = new Map<string, number>();
    for (const o of ordersRawList) {
        countByClient.set(o.client_id, (countByClient.get(o.client_id) || 0) + 1);
    }
    console.log('2. RAW DB: orders for this vendor + date with client_id in household');
    console.log('   Total rows:', ordersRawList.length);
    for (const [cid, count] of countByClient) {
        const name = (allGradstein as any[]).find((c: any) => c.id === cid)?.full_name
            ?? (dependants as any[])?.find((d: any) => d.id === cid)?.full_name ?? cid;
        console.log('   ', name, '| client_id', cid, '| order count:', count);
        if (count > 1) console.log('   >>> DUPLICATE: this client has', count, 'orders in DB for this date');
    }
    if (ordersRawList.length > 0) {
        console.log('   Order ids for this vendor+date (household only):', ordersRawList.map((o: any) => o.id));
    }
    console.log('');

    // --- 3. Simulate getOrdersByVendor exactly (chunked direct + junction merge) ---
    const ordersFromTable: any[] = [];
    let offset = 0;
    let hasMore = true;
    while (hasMore) {
        const { data: chunk, error: directErr } = await db
            .from('orders')
            .select('id, order_number, client_id, scheduled_delivery_date, vendor_id, service_type, created_at')
            .eq('vendor_id', VENDOR_ID)
            .order('created_at', { ascending: false })
            .range(offset, offset + ROW_CHUNK - 1);
        if (directErr) {
            console.error('Direct query error:', directErr.message);
            break;
        }
        const rows = chunk || [];
        ordersFromTable.push(...rows);
        hasMore = rows.length === ROW_CHUNK;
        offset += ROW_CHUNK;
    }
    const foodOrderIds: string[] = [];
    let foodOffset = 0;
    while (true) {
        const { data: chunk } = await db
            .from('order_vendor_selections')
            .select('order_id')
            .eq('vendor_id', VENDOR_ID)
            .range(foodOffset, foodOffset + ROW_CHUNK - 1);
        const rows = chunk || [];
        foodOrderIds.push(...rows.map((o: { order_id: string }) => o.order_id));
        if (rows.length < ROW_CHUNK) break;
        foodOffset += ROW_CHUNK;
    }
    const boxOrderIds: string[] = [];
    let boxOffset = 0;
    while (true) {
        const { data: chunk } = await db
            .from('order_box_selections')
            .select('order_id')
            .eq('vendor_id', VENDOR_ID)
            .range(boxOffset, boxOffset + ROW_CHUNK - 1);
        const rows = chunk || [];
        boxOrderIds.push(...rows.map((o: { order_id: string }) => o.order_id));
        if (rows.length < ROW_CHUNK) break;
        boxOffset += ROW_CHUNK;
    }
    const junctionOrderIds = Array.from(new Set([...foodOrderIds, ...boxOrderIds]));
    const directIdSet = new Set(ordersFromTable.map((o: { id: string }) => o.id));
    let ordersData = [...ordersFromTable];
    const missingIds = junctionOrderIds.filter(id => !directIdSet.has(id));
    if (missingIds.length > 0) {
        for (let i = 0; i < missingIds.length; i += ROW_CHUNK) {
            const batch = missingIds.slice(i, i + ROW_CHUNK);
            const { data: extraOrders } = await db
                .from('orders')
                .select('id, order_number, client_id, scheduled_delivery_date, vendor_id, service_type, created_at')
                .in('id', batch)
                .order('created_at', { ascending: false });
            if (extraOrders?.length) ordersData = [...ordersData, ...extraOrders];
        }
        ordersData.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    }
    const filteredOrders = ordersData.filter((o: any) => {
        if (o.service_type === 'Produce') return false;
        if (!o.scheduled_delivery_date) return false;
        const orderDateKey = toCalendarDateKey(o.scheduled_delivery_date);
        return orderDateKey === dateKey;
    });

    console.log('3. SIMULATED getOrdersByVendor for this date');
    console.log('   ordersFromTable length:', ordersFromTable.length);
    console.log('   junctionOrderIds (unique) length:', junctionOrderIds.length);
    console.log('   missingIds length:', missingIds.length);
    console.log('   ordersData length (after merge):', ordersData.length);
    console.log('   filteredOrders length (after date filter):', filteredOrders.length);

    const orderIdCount = new Map<string, number>();
    const clientIdCount = new Map<string, number>();
    for (const o of filteredOrders) {
        orderIdCount.set(o.id, (orderIdCount.get(o.id) || 0) + 1);
        clientIdCount.set(o.client_id, (clientIdCount.get(o.client_id) || 0) + 1);
    }
    const duplicateOrderIds = [...orderIdCount.entries()].filter(([, n]) => n > 1);
    const duplicateClientIds = [...clientIdCount.entries()].filter(([, n]) => n > 1);
    if (duplicateOrderIds.length > 0) {
        console.log('   >>> DUPLICATE ORDER IDS in filtered list (same order appears twice):', duplicateOrderIds);
    }
    if (duplicateClientIds.length > 0) {
        console.log('   >>> DUPLICATE CLIENT_ID in filtered list (same client has multiple orders):');
        for (const [cid, n] of duplicateClientIds) {
            const name = (allGradstein as any[]).find((c: any) => c.id === cid)?.full_name
                ?? (dependants as any[])?.find((d: any) => d.id === cid)?.full_name ?? cid;
            console.log('      ', name, 'client_id', cid, 'appears', n, 'times (', n, 'order rows)');
        }
    }
    const householdInFiltered = filteredOrders.filter((o: any) => householdIds.has(o.client_id));
    console.log('   Household orders in filtered list:', householdInFiltered.length);
    householdInFiltered.forEach((o: any, i: number) => {
        const name = (allGradstein as any[]).find((c: any) => c.id === o.client_id)?.full_name
            ?? (dependants as any[])?.find((d: any) => d.id === o.client_id)?.full_name ?? o.client_id;
        console.log('      [' + i + '] order_id', o.id, '| order_number', o.order_number, '| client', name);
    });
    console.log('');

    // --- 4. Check: does same order_id appear twice in ordersFromTable? (pagination/ordering) ---
    const directOrderIdCount = new Map<string, number>();
    for (const o of ordersFromTable) {
        directOrderIdCount.set(o.id, (directOrderIdCount.get(o.id) || 0) + 1);
    }
    const duplicateInDirect = [...directOrderIdCount.entries()].filter(([, n]) => n > 1);
    console.log('4. PAGINATION CHECK: same order_id in ordersFromTable more than once?');
    if (duplicateInDirect.length > 0) {
        console.log('   >>> YES - duplicate order ids from direct query:', duplicateInDirect);
    } else {
        console.log('   No duplicate order ids in ordersFromTable.');
    }
    console.log('');

    // --- 5. Check: duplicate rows in order_vendor_selections for same order_id + vendor_id? ---
    const { data: ovsRows } = await db
        .from('order_vendor_selections')
        .select('order_id, vendor_id, id')
        .eq('vendor_id', VENDOR_ID);
    const ovsKeyCount = new Map<string, number>();
    for (const r of ovsRows || []) {
        const key = (r as any).order_id + '|' + (r as any).vendor_id;
        ovsKeyCount.set(key, (ovsKeyCount.get(key) || 0) + 1);
    }
    const duplicateOvs = [...ovsKeyCount.entries()].filter(([, n]) => n > 1);
    console.log('5. JUNCTION: duplicate (order_id, vendor_id) in order_vendor_selections?');
    if (duplicateOvs.length > 0) {
        console.log('   >>> YES - duplicate (order_id, vendor_id) rows:', duplicateOvs.length);
        duplicateOvs.slice(0, 5).forEach(([k]) => console.log('      ', k));
    } else {
        console.log('   No duplicate (order_id, vendor_id) rows.');
    }
    console.log('');

    // --- 6. DEFINITIVE CONCLUSION ---
    console.log('=== CONCLUSION ===');
    if (duplicateInDirect.length > 0) {
        console.log('CAUSE: Same order returned twice from direct orders query (pagination/ORDER BY created_at non-determinism).');
    } else if (duplicateClientIds.length > 0 && duplicateOrderIds.length === 0) {
        console.log('CAUSE: Multiple order rows in DB for the same client for this vendor+date (e.g. one from own upcoming_order + one from dependant creation).');
        console.log('       Affected client(s):', duplicateClientIds.map(([cid]) => {
            const name = (allGradstein as any[]).find((c: any) => c.id === cid)?.full_name ?? (dependants as any[])?.find((d: any) => d.id === cid)?.full_name ?? cid;
            return name + ' (' + cid + ')';
        }).join(', '));
    } else if (duplicateOrderIds.length > 0) {
        console.log('CAUSE: Same order_id appears multiple times in the merged list (bug in merge or duplicate in direct fetch).');
    } else {
        console.log('No duplicate order ids or duplicate client_ids in the simulated getOrdersByVendor result for this date.');
        console.log('If labels still show duplicate, the cause may be in the frontend (e.g. date grouping, or list built from a different source).');
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
