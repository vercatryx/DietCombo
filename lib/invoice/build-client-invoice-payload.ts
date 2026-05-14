/**
 * Builds a printable invoice JSON payload for a client household and date range.
 * Data comes from orders + line structure in this app (not shared with external invoice systems).
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { APP_DATE_FORMAT_OPTIONS, toCalendarDateKeyInAppTz } from '@/lib/timezone';

export type ClientInvoiceLineItem = {
    row: number;
    description: string;
    unitPriceUsd: number;
    quantity: number;
    lineTotalUsd: number;
};

export type ClientInvoiceOrderSummary = {
    id: string;
    orderNumber: number | null;
    deliveryDate: string | null;
    serviceType: string | null;
    lineTotalUsd: number;
};

export type ClientInvoiceApiPayload = {
    clientId: string;
    clientName: string;
    clientEmail: string | null;
    clientAddress: string;
    clientPhone: string | null;
    overseeingNavigator: string | null;
    periodFrom: string;
    periodTo: string;
    periodLabel: string;
    /** First calendar day of the billing period (YYYY-MM-DD); same as `periodFrom`. */
    deliveryDate: string;
    /** Same as `deliveryDate`, formatted for display in app timezone. */
    deliveryDateFormatted: string;
    /**
     * When true, the printable invoice/PDF uses the produce voucher line (qty = household members, unit $146)
     * instead of home delivery (qty = members × 21, unit $16).
     */
    produceInvoice: boolean;
    /** Parent plus dependents in the household (same scope as order queries). */
    householdMemberCount: number;
    /** The single line shown on the printable invoice and vector PDF. */
    invoiceFixedLine: ClientInvoiceFixedLine;
    lineItems: ClientInvoiceLineItem[];
    orders: ClientInvoiceOrderSummary[];
    invoiceTotalUsd: number;
    warnings: string[];
    generatedAt: string;
};

/** Single display line for the fixed-layout client invoice (PDF + receipt). */
export type ClientInvoiceFixedLine = {
    description: string;
    unitPriceUsd: number;
    quantity: number;
    lineTotalUsd: number;
};

type RefData = {
    menuItems: any[];
    vendors: any[];
    boxTypes: any[];
    mealItems: any[];
    equipment: any[];
};

function money(n: number): number {
    return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Printable invoice row: home delivery scales by household size (×21 meals each); produce scales by members × $146. */
export function getClientInvoiceFixedLine(produceInvoice: boolean, householdMemberCount: number): ClientInvoiceFixedLine {
    const people = Math.max(1, Math.floor(Number(householdMemberCount)) || 1);
    if (produceInvoice) {
        const unitPriceUsd = 146;
        const quantity = people;
        return {
            description: 'Produce Prescription/Voucher',
            unitPriceUsd,
            quantity,
            lineTotalUsd: money(unitPriceUsd * quantity),
        };
    }
    const unitPriceUsd = 16;
    const quantity = people * 21;
    return {
        description: 'Home delivery meal',
        unitPriceUsd,
        quantity,
        lineTotalUsd: money(unitPriceUsd * quantity),
    };
}

function formatUsd(n: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(money(n));
}

async function loadRef(db: SupabaseClient): Promise<RefData> {
    const [menuRes, vendorsRes, boxRes, mealRes, eqRes] = await Promise.all([
        db.from('menu_items').select('*'),
        db.from('vendors').select('*'),
        db.from('box_types').select('*'),
        db.from('breakfast_items').select('*'),
        db.from('equipment').select('*'),
    ]);
    const mealItems = (mealRes.data || []).map((row: any) => ({
        id: row.id,
        name: row.name,
        price_each: row.price_each,
    }));
    return {
        menuItems: menuRes.data || [],
        vendors: vendorsRes.data || [],
        boxTypes: boxRes.data || [],
        mealItems,
        equipment: eqRes.data || [],
    };
}

async function resolveHousehold(
    db: SupabaseClient,
    clientId: string,
): Promise<{ rootId: string; memberIds: string[] } | null> {
    const { data: row, error } = await db.from('clients').select('id, parent_client_id').eq('id', clientId).maybeSingle();
    if (error || !row) return null;
    const rootId = row.parent_client_id != null ? String(row.parent_client_id) : String(row.id);
    const { data: members } = await db
        .from('clients')
        .select('id')
        .or(`id.eq.${rootId},parent_client_id.eq.${rootId}`);
    const ids = [...new Set((members || []).map((m: { id: string }) => String(m.id)))];
    const memberIds = ids.length ? ids : [String(row.id)];
    return { rootId, memberIds };
}

function orderSortKey(o: any): string {
    const dk =
        toCalendarDateKeyInAppTz(o.actual_delivery_date || o.scheduled_delivery_date || o.created_at) || '0000-00-00';
    const num = o.order_number != null ? String(o.order_number).padStart(8, '0') : o.id;
    return `${dk}#${num}`;
}

async function expandOrderToLines(
    db: SupabaseClient,
    ref: RefData,
    order: any,
): Promise<{ lines: Omit<ClientInvoiceLineItem, 'row'>[]; orderTotal: number }> {
    const orderId = order.id;
    const st = order.service_type;
    const lines: Omit<ClientInvoiceLineItem, 'row'>[] = [];

    if (st === 'Food' || st === 'Meal') {
        const { data: vendorSelections } = await db.from('order_vendor_selections').select('*').eq('order_id', orderId);
        if (!vendorSelections?.length) {
            const tv = parseFloat(order.total_value || '0') || 0;
            lines.push({
                description: `Food order #${order.order_number ?? orderId.slice(0, 8)} (no line items on file)`,
                unitPriceUsd: money(tv),
                quantity: 1,
                lineTotalUsd: money(tv),
            });
            return { lines, orderTotal: money(tv) };
        }
        let sum = 0;
        for (const vs of vendorSelections) {
            const vendor = ref.vendors.find((v: any) => v.id === vs.vendor_id);
            const vname = vendor?.name || 'Vendor';
            const { data: items } = await db.from('order_items').select('*').eq('vendor_selection_id', vs.id);
            for (const item of items || []) {
                let menuItem = ref.menuItems.find((mi: any) => mi.id === item.menu_item_id);
                if (!menuItem && item.meal_item_id) menuItem = ref.mealItems.find((mi: any) => mi.id === item.meal_item_id);
                const itemPrice =
                    item.custom_price != null
                        ? parseFloat(item.custom_price)
                        : menuItem?.price_each ?? (item.unit_value != null ? parseFloat(item.unit_value) : 0);
                const safePrice = Number.isFinite(itemPrice) ? itemPrice : 0;
                const qty = item.quantity ?? 1;
                const name = item.custom_name || menuItem?.name || item.notes || 'Item';
                const total = money(safePrice * qty);
                sum += total;
                lines.push({
                    description: `${name} (${vname})`,
                    unitPriceUsd: money(safePrice),
                    quantity: qty,
                    lineTotalUsd: total,
                });
            }
        }
        const dbTotal = parseFloat(order.total_value || '0') || 0;
        const orderTotal = sum > 0 ? money(sum) : money(dbTotal);
        if (lines.length === 0 && dbTotal > 0) {
            lines.push({
                description: `Food order #${order.order_number ?? orderId.slice(0, 8)}`,
                unitPriceUsd: money(dbTotal),
                quantity: 1,
                lineTotalUsd: money(dbTotal),
            });
        }
        return { lines, orderTotal };
    }

    if (st === 'Custom') {
        const { data: vendorSelections } = await db.from('order_vendor_selections').select('*').eq('order_id', orderId);
        if (!vendorSelections?.length) {
            const tv = parseFloat(order.total_value || '0') || 0;
            lines.push({
                description: `Custom order #${order.order_number ?? orderId.slice(0, 8)}`,
                unitPriceUsd: money(tv),
                quantity: 1,
                lineTotalUsd: money(tv),
            });
            return { lines, orderTotal: money(tv) };
        }
        let sum = 0;
        for (const vs of vendorSelections) {
            const vendor = ref.vendors.find((v: any) => v.id === vs.vendor_id);
            const vname = vendor?.name || 'Vendor';
            const { data: items } = await db.from('order_items').select('*').eq('vendor_selection_id', vs.id);
            for (const item of items || []) {
                const unit = parseFloat(item.custom_price || '0') || 0;
                const qty = item.quantity ?? 1;
                const total = money(unit * qty);
                sum += total;
                lines.push({
                    description: `${item.custom_name || 'Custom item'} (${vname})`,
                    unitPriceUsd: money(unit),
                    quantity: qty,
                    lineTotalUsd: total,
                });
            }
        }
        const dbTotal = parseFloat(order.total_value || '0') || 0;
        return { lines, orderTotal: sum > 0 ? money(sum) : money(dbTotal) };
    }

    if (st === 'Boxes') {
        const { data: boxSelection } = await db.from('order_box_selections').select('*').eq('order_id', orderId).maybeSingle();
        const vendor = boxSelection ? ref.vendors.find((v: any) => v.id === boxSelection.vendor_id) : null;
        const boxType = boxSelection ? ref.boxTypes.find((bt: any) => bt.id === boxSelection.box_type_id) : null;
        const qty = boxSelection?.quantity ?? 1;
        const tv = boxSelection?.total_value
            ? parseFloat(boxSelection.total_value)
            : parseFloat(order.total_value || '0') || 0;
        lines.push({
            description: `Box: ${boxType?.name || 'Box'} — ${vendor?.name || 'Vendor'} × ${qty}`,
            unitPriceUsd: money(qty ? tv / qty : tv),
            quantity: qty,
            lineTotalUsd: money(tv),
        });
        return { lines, orderTotal: money(tv) };
    }

    if (st === 'Equipment') {
        let label = `Equipment order #${order.order_number ?? ''}`.trim();
        let tv = parseFloat(order.total_value || '0') || 0;
        try {
            const notes = order.notes ? JSON.parse(order.notes) : null;
            if (notes?.equipmentName) label = String(notes.equipmentName);
            else if (notes?.equipmentId) {
                const eq = ref.equipment.find((e: any) => e.id === notes.equipmentId);
                if (eq?.name) label = eq.name;
            }
        } catch {
            /* ignore */
        }
        lines.push({
            description: label,
            unitPriceUsd: money(tv),
            quantity: 1,
            lineTotalUsd: money(tv),
        });
        return { lines, orderTotal: money(tv) };
    }

    const tv = parseFloat(order.total_value || '0') || 0;
    lines.push({
        description: `${st || 'Order'} #${order.order_number ?? orderId.slice(0, 8)}`,
        unitPriceUsd: money(tv),
        quantity: 1,
        lineTotalUsd: money(tv),
    });
    return { lines, orderTotal: money(tv) };
}

function periodLabel(from: string, to: string): string {
    const a = new Date(`${from}T12:00:00`);
    const b = new Date(`${to}T12:00:00`);
    const fb = b.toLocaleDateString('en-US', { ...APP_DATE_FORMAT_OPTIONS, month: 'short', day: 'numeric', year: 'numeric' });
    if (from === to) return fb;
    const ya = a.getFullYear();
    const yb = b.getFullYear();
    const fa2 = a.toLocaleDateString('en-US', { ...APP_DATE_FORMAT_OPTIONS, month: 'short', day: 'numeric', year: ya !== yb ? 'numeric' : undefined });
    return `${fa2} – ${fb}`;
}

export async function buildClientInvoicePayload(
    db: SupabaseClient,
    params: { clientId: string; from: string; to: string; produceInvoice?: boolean },
): Promise<{ ok: true; payload: ClientInvoiceApiPayload } | { ok: false; error: string; status: number }> {
    const { clientId, from, to, produceInvoice = false } = params;
    if (!clientId?.trim()) return { ok: false, error: 'Missing clientId', status: 400 };
    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRe.test(from) || !dateRe.test(to)) return { ok: false, error: 'from and to must be YYYY-MM-DD', status: 400 };
    if (from > to) return { ok: false, error: 'from must be on or before to', status: 400 };

    const household = await resolveHousehold(db, clientId);
    if (!household) return { ok: false, error: 'Client not found', status: 404 };
    const { rootId: rootIdStr, memberIds } = household;

    const { data: displayClient, error: dcErr } = await db
        .from('clients')
        .select('id, full_name, email, address, phone_number, navigator_id, unite_account')
        .eq('id', rootIdStr)
        .maybeSingle();
    if (dcErr || !displayClient) return { ok: false, error: 'Client not found', status: 404 };

    let navigatorName: string | null = null;
    if (displayClient.navigator_id) {
        const { data: nav } = await db.from('navigators').select('name').eq('id', displayClient.navigator_id).maybeSingle();
        navigatorName = nav?.name ?? null;
    }

    const { data: ordersRaw, error: ordErr } = await db
        .from('orders')
        .select('*')
        .in('client_id', memberIds)
        .neq('status', 'cancelled')
        .order('created_at', { ascending: false });
    if (ordErr) {
        console.error('[buildClientInvoicePayload] orders', ordErr);
        return { ok: false, error: 'Failed to load orders', status: 500 };
    }

    const inRange: any[] = [];
    for (const o of ordersRaw || []) {
        const key = toCalendarDateKeyInAppTz(o.actual_delivery_date || o.scheduled_delivery_date || o.created_at);
        if (!key) continue;
        if (key >= from && key <= to) inRange.push(o);
    }
    inRange.sort((a, b) => orderSortKey(a).localeCompare(orderSortKey(b)));

    const ref = await loadRef(db);
    const allLines: Omit<ClientInvoiceLineItem, 'row'>[] = [];
    const orderSummaries: ClientInvoiceOrderSummary[] = [];

    for (const o of inRange) {
        const dk = toCalendarDateKeyInAppTz(o.actual_delivery_date || o.scheduled_delivery_date || o.created_at);
        const { lines, orderTotal } = await expandOrderToLines(db, ref, o);
        allLines.push(...lines);
        orderSummaries.push({
            id: o.id,
            orderNumber: o.order_number ?? null,
            deliveryDate: dk,
            serviceType: o.service_type ?? null,
            lineTotalUsd: orderTotal,
        });
    }

    const lineItems: ClientInvoiceLineItem[] = allLines.map((L, i) => ({
        row: i + 1,
        ...L,
    }));

    const householdMemberCount = Math.max(1, memberIds.length);
    const invoiceFixedLine = getClientInvoiceFixedLine(!!produceInvoice, householdMemberCount);
    const invoiceTotalUsd = invoiceFixedLine.lineTotalUsd;

    const deliveryDateFormatted = new Date(`${from}T12:00:00`).toLocaleDateString('en-US', APP_DATE_FORMAT_OPTIONS);

    const warnings: string[] = [];

    const payload: ClientInvoiceApiPayload = {
        clientId: rootIdStr,
        clientName: displayClient.full_name || 'Client',
        clientEmail: displayClient.email ?? null,
        clientAddress: (displayClient.address as string) || '',
        clientPhone: displayClient.phone_number ?? null,
        overseeingNavigator: navigatorName,
        periodFrom: from,
        periodTo: to,
        periodLabel: periodLabel(from, to),
        deliveryDate: from,
        deliveryDateFormatted,
        produceInvoice,
        householdMemberCount,
        invoiceFixedLine,
        lineItems,
        orders: orderSummaries,
        invoiceTotalUsd,
        warnings,
        generatedAt: new Date().toISOString(),
    };

    return { ok: true, payload };
}

export function formatInvoiceMoney(n: number): string {
    return formatUsd(n);
}
