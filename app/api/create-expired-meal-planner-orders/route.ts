import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { getCurrentTime } from '@/lib/time';
import { getTodayInAppTz } from '@/lib/timezone';
import {
    getClients,
    getDefaultOrderTemplate,
    getMenuItems,
    getDefaultVendorId,
    generateBatchOrderNumbers,
    ensureMealPlannerOrdersForDateFromDefaultTemplate
} from '@/lib/actions';

/**
 * API Route: Create Orders for Expired Meal Planner Items (Optimized)
 *
 * POST /api/create-expired-meal-planner-orders
 *
 * CONTRACT:
 * - Defaults (single source of truth, not per-client):
 *   - Default food menu: settings.default_order_template (Food).
 *   - Default meal planner: meal_planner_custom_items where client_id IS NULL (per calendar_date).
 * - Client overrides (only when we want to change from default):
 *   - Stored in clients.upcoming_order (JSON). If present and non-empty, use it for food; else use default.
 *   - Meal planner overrides: meal_planner_custom_items where client_id = client.id (merged with default by name).
 * - When creating orders by expiration date:
 *   - Scan all Food clients. For each client: if no upcoming_order (or empty) → use default food template; if they have one → use that client's profile. Meal planner = default template + client overrides merged (client wins by name).
 *   - Always default to defaults when client has nothing.
 * - Created orders are immutable snapshots: we write into orders + order_vendor_selections + order_items the exact items and quantities at creation time. They do not change when defaults or clients.upcoming_order change later.
 * - All dates are in EST (America/New_York). The ?date= param is a calendar date (YYYY-MM-DD) in EST; when omitted, "today" is taken in EST.
 *
 * Logic:
 * 1. Check if today is the expiration date for any meals in the meal planner (default template only).
 * 2. Batch fetch defaults and client overrides.
 * 3. Per client: food from clients.upcoming_order or default; meal plan from default + client overrides.
 * 4. Insert snapshot rows into orders / order_vendor_selections / order_items (no references to templates).
 */
export async function POST(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const dateParam = searchParams.get('date');

        let expirationDateStr: string;
        if (dateParam) {
            const dateMatch = dateParam.match(/^\d{4}-\d{2}-\d{2}$/);
            if (!dateMatch) {
                return NextResponse.json({
                    success: false,
                    error: 'Invalid date format. Use YYYY-MM-DD format.'
                }, { status: 400 });
            }
            expirationDateStr = dateParam;
        } else {
            const currentTime = await getCurrentTime();
            expirationDateStr = getTodayInAppTz(currentTime);
        }

        const currentTime = await getCurrentTime();
        const currentTimeISO = currentTime.toISOString();

        console.log(`[Create Expired Meal Planner Orders] Starting for expiration date: ${expirationDateStr}`);

        const supabaseAdmin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!
        );

        // 1. Fetch expired meal planner items (default template only - identifies which dates have expired items)
        const { data: expiredItems, error: expiredError } = await supabaseAdmin
            .from('meal_planner_custom_items')
            .select('calendar_date, expiration_date, name, quantity, price')
            .is('client_id', null)
            .eq('expiration_date', expirationDateStr)
            .order('calendar_date', { ascending: true });

        if (expiredError) {
            return NextResponse.json({
                success: false,
                error: `Failed to fetch expired meal planner items: ${expiredError.message}`
            }, { status: 500 });
        }

        if (!expiredItems || expiredItems.length === 0) {
            const { data: allExpirationDates } = await supabaseAdmin
                .from('meal_planner_custom_items')
                .select('expiration_date')
                .is('client_id', null)
                .not('expiration_date', 'is', null)
                .order('expiration_date', { ascending: true });
            const uniqueExpirationDates = [...new Set((allExpirationDates || []).map((item: any) => item.expiration_date))];
            return NextResponse.json({
                success: true,
                message: `No meal planner items expire on ${expirationDateStr}`,
                ordersCreated: 0,
                clientsProcessed: 0,
                expirationDate: expirationDateStr,
                availableExpirationDates: uniqueExpirationDates.length > 0 ? uniqueExpirationDates : undefined
            });
        }

        // Normalize to YYYY-MM-DD (EST calendar date) in case DB returns timestamps
        const expiredDates = [...new Set(expiredItems.map((item: any) => String(item.calendar_date).slice(0, 10)))];
        console.log(`[Create Expired Meal Planner Orders] Found ${expiredItems.length} expired items across ${expiredDates.length} date(s)`);

        // Ensure meal_planner_orders exist for these dates (default template is no longer synced to all clients on save)
        for (const dateOnly of expiredDates) {
            await ensureMealPlannerOrdersForDateFromDefaultTemplate(String(dateOnly).slice(0, 10));
        }

        // 2. Pre-fetch all reference data in parallel
        const [allClients, defaultTemplate, menuItems, defaultVendorId] = await Promise.all([
            getClients(),
            getDefaultOrderTemplate('Food'),
            getMenuItems(),
            getDefaultVendorId()
        ]);

        const foodClientsAll = allClients.filter(
            (c: any) => c.serviceType === 'Food' || (c.serviceType && String(c.serviceType).includes('Food'))
        );
        // Only run for clients who are not paused and have delivery enabled
        const pausedDefault = false;
        const deliveryDefault = true;
        const foodClients = foodClientsAll.filter(
            (c: any) => !(c.paused ?? pausedDefault) && (c.delivery ?? deliveryDefault)
        );
        const foodClientIds = foodClients.map((c: any) => c.id);

        if (foodClientIds.length === 0) {
            return NextResponse.json({
                success: true,
                message: 'No Food service clients found',
                ordersCreated: 0,
                clientsProcessed: 0,
                expirationDate: expirationDateStr
            });
        }

        // 3. Batch fetch meal planner custom items (default + per-client)
        const [defaultMealItems, clientMealItems] = await Promise.all([
            supabaseAdmin
                .from('meal_planner_custom_items')
                .select('calendar_date, client_id, name, quantity, price')
                .is('client_id', null)
                .in('calendar_date', expiredDates)
                .order('sort_order', { ascending: true }),
            supabaseAdmin
                .from('meal_planner_custom_items')
                .select('calendar_date, client_id, name, quantity, price')
                .in('client_id', foodClientIds)
                .in('calendar_date', expiredDates)
                .order('sort_order', { ascending: true })
        ]);

        const defaultByDate = new Map<string, { name: string; quantity: number; price: number | null }[]>();
        for (const row of defaultMealItems.data || []) {
            const d = String(row.calendar_date).slice(0, 10);
            if (!defaultByDate.has(d)) defaultByDate.set(d, []);
            defaultByDate.get(d)!.push({
                name: row.name,
                quantity: row.quantity ?? 1,
                price: row.price != null ? Number(row.price) : null
            });
        }

        const clientByDate = new Map<string, Map<string, { name: string; quantity: number; price: number | null }[]>>();
        for (const row of clientMealItems.data || []) {
            const d = String(row.calendar_date).slice(0, 10);
            const cid = row.client_id;
            if (!clientByDate.has(cid)) clientByDate.set(cid, new Map());
            const m = clientByDate.get(cid)!;
            if (!m.has(d)) m.set(d, []);
            m.get(d)!.push({
                name: row.name,
                quantity: row.quantity ?? 1,
                price: row.price != null ? Number(row.price) : null
            });
        }

        // 4. Batch fetch meal planner orders, existing orders, upcoming orders (for case_id)
        const [mealPlannerOrdersRes, existingOrdersRes, upcomingOrdersRes] = await Promise.all([
            supabaseAdmin
                .from('meal_planner_orders')
                .select('client_id, scheduled_delivery_date, delivery_day')
                .in('client_id', foodClientIds)
                .in('scheduled_delivery_date', expiredDates)
                .eq('status', 'scheduled'),
            supabaseAdmin
                .from('orders')
                .select('client_id, scheduled_delivery_date')
                .in('client_id', foodClientIds)
                .in('scheduled_delivery_date', expiredDates)
                .eq('service_type', 'Food'),
            supabaseAdmin
                .from('upcoming_orders')
                .select('client_id, case_id, last_updated')
                .in('client_id', foodClientIds)
                .eq('service_type', 'Food')
                .order('last_updated', { ascending: false })
        ]);

        const mpoMap = new Map<string, { scheduled_delivery_date: string; delivery_day: string | null }>();
        for (const r of mealPlannerOrdersRes.data || []) {
            mpoMap.set(`${r.client_id}:${r.scheduled_delivery_date}`, {
                scheduled_delivery_date: r.scheduled_delivery_date,
                delivery_day: r.delivery_day ?? null
            });
        }

        const existingSet = new Set<string>();
        for (const r of existingOrdersRes.data || []) {
            existingSet.add(`${r.client_id}:${r.scheduled_delivery_date}`);
        }

        const caseIdByClient = new Map<string, string | null>();
        for (const r of upcomingOrdersRes.data || []) {
            if (!caseIdByClient.has(r.client_id)) {
                const cid = r.case_id != null && String(r.case_id).trim() !== '' ? String(r.case_id).trim() : null;
                caseIdByClient.set(r.client_id, cid);
            }
        }
        // Fallback: case_id from client's UniteUs link (caseIdExternal) when upcoming_orders has none
        for (const client of foodClients) {
            if (!client) continue;
            if (!caseIdByClient.has(client.id) || !caseIdByClient.get(client.id)) {
                const ext = (client as any).caseIdExternal;
                const cid = ext != null && String(ext).trim() !== '' ? String(ext).trim() : null;
                if (cid) caseIdByClient.set(client.id, cid);
            }
        }

        const errors: string[] = [];
        const skippedReasons: string[] = [];
        const ordersToInsert: any[] = [];
        const vendorSelectionsToInsert: { id: string; order_id: string; vendor_id: string }[] = [];
        const menuItemsToInsert: { id: string; vendor_selection_id: string; menu_item_id: string; quantity: number }[] = [];
        const customItemsToInsert: { id: string; vendor_selection_id: string; menu_item_id: null; quantity: number; custom_name: string; custom_price: number }[] = [];
        const orderIdToFirstVsId = new Map<string, string>();

        let clientsProcessed = 0;
        let orderCount = 0;

        for (const client of foodClients) {
            if (!client) continue;
            clientsProcessed++;
            // Always default to defaults: use client's upcoming_order (clients.upcoming_order) only if present and non-empty; else use default food template from settings.
            const hasClientFoodOverride =
                client.activeOrder &&
                ((client.activeOrder.vendorSelections && client.activeOrder.vendorSelections.length > 0) ||
                    (client.activeOrder.deliveryDayOrders && Object.keys(client.activeOrder.deliveryDayOrders).length > 0));
            const clientFoodOrder = hasClientFoodOverride ? client.activeOrder : defaultTemplate;
            if (
                !clientFoodOrder ||
                ((!clientFoodOrder.vendorSelections || clientFoodOrder.vendorSelections.length === 0) &&
                    (!clientFoodOrder.deliveryDayOrders || Object.keys(clientFoodOrder.deliveryDayOrders).length === 0))
            ) {
                skippedReasons.push(`Client ${client.id} (${client.fullName}): No food order template available`);
                continue;
            }

            for (const expiredDateStr of expiredDates) {
                const mpo = mpoMap.get(`${client.id}:${expiredDateStr}`);
                // Only create order if client has a scheduled delivery on this date (meal_planner_order exists)
                if (!mpo) {
                    skippedReasons.push(`Client ${client.id} (${client.fullName}): No delivery scheduled for ${expiredDateStr}`);
                    continue;
                }
                const scheduledDeliveryDate = mpo.scheduled_delivery_date;
                const deliveryDay = mpo.delivery_day ?? null;

                if (existingSet.has(`${client.id}:${scheduledDeliveryDate}`)) {
                    skippedReasons.push(`Client ${client.id} (${client.fullName}): Order already exists for ${scheduledDeliveryDate}`);
                    continue;
                }

                let vendorSelections: any[] = [];
                if (clientFoodOrder.deliveryDayOrders) {
                    if (deliveryDay && clientFoodOrder.deliveryDayOrders[deliveryDay]) {
                        vendorSelections = clientFoodOrder.deliveryDayOrders[deliveryDay].vendorSelections || [];
                    } else {
                        const firstDay = Object.keys(clientFoodOrder.deliveryDayOrders)[0];
                        if (firstDay) {
                            vendorSelections = clientFoodOrder.deliveryDayOrders[firstDay].vendorSelections || [];
                        }
                    }
                } else if (clientFoodOrder.vendorSelections) {
                    vendorSelections = clientFoodOrder.vendorSelections;
                }

                if (!vendorSelections || vendorSelections.length === 0) {
                    skippedReasons.push(`Client ${client.id} (${client.fullName}): No vendor selections found`);
                    continue;
                }

                // Meal planner: default template (defaultByDate) + client overrides (clientByDate); client wins by name. Always start from default.
                const defaultItems = defaultByDate.get(expiredDateStr) || [];
                const clientItems = clientByDate.get(client.id)?.get(expiredDateStr) || [];
                const mealPlanMap = new Map<string, { name: string; quantity: number; price: number | null }>();
                for (const i of defaultItems) mealPlanMap.set(i.name, i);
                for (const i of clientItems) mealPlanMap.set(i.name, i);
                const mealPlanItems = Array.from(mealPlanMap.values());

                let totalValue = 0;
                let totalItems = 0;

                for (const vs of vendorSelections) {
                    if (!vs.items) continue;
                    for (const [itemId, quantity] of Object.entries(vs.items)) {
                        const menuItem = menuItems.find((mi: any) => mi.id === itemId);
                        if (menuItem) {
                            const qty = Number(quantity) || 0;
                            const price = menuItem.priceEach || menuItem.value || 0;
                            totalValue += price * qty;
                            totalItems += qty;
                        }
                    }
                }
                for (const item of mealPlanItems) {
                    totalValue += (item.price || 0) * item.quantity;
                    totalItems += item.quantity;
                }

                orderCount++;
                const orderId = randomUUID();
                // Snapshot only: copy current vendorSelections and mealPlanItems into the order payload. Once written to orders/order_items, these never change (immutable, today-independent).
                ordersToInsert.push({
                    id: orderId,
                    client_id: client.id,
                    service_type: 'Food',
                    case_id: caseIdByClient.get(client.id) ?? null,
                    status: 'scheduled',
                    scheduled_delivery_date: scheduledDeliveryDate,
                    delivery_day: deliveryDay,
                    total_value: totalValue,
                    total_items: totalItems,
                    notes: 'Created via API',
                    created_at: currentTimeISO,
                    last_updated: currentTimeISO,
                    updated_by: 'System',
                    vendor_id: defaultVendorId,
                    _vendorSelections: vendorSelections,
                    _mealPlanItems: mealPlanItems,
                    _orderId: orderId
                });
            }
        }

        if (ordersToInsert.length === 0) {
            return NextResponse.json({
                success: true,
                message: `Processed ${clientsProcessed} clients. No orders to create.`,
                ordersCreated: 0,
                clientsProcessed,
                expirationDate: expirationDateStr,
                expiredDates,
                expiredItemsCount: expiredItems.length,
                errors: errors.length > 0 ? errors : undefined,
                skippedReasons: skippedReasons.length > 0 ? skippedReasons : undefined
            });
        }

        const orderNumbers = await generateBatchOrderNumbers(supabaseAdmin, ordersToInsert.length);
        for (let i = 0; i < ordersToInsert.length; i++) {
            ordersToInsert[i].order_number = orderNumbers[i];
        }

        // Write immutable order rows (no references to templates or upcoming_order; values are fixed at creation).
        const ordersPayload = ordersToInsert.map((o) => ({
            id: o.id,
            client_id: o.client_id,
            service_type: o.service_type,
            case_id: o.case_id,
            status: o.status,
            scheduled_delivery_date: o.scheduled_delivery_date,
            delivery_day: o.delivery_day,
            total_value: o.total_value,
            total_items: o.total_items,
            notes: o.notes,
            order_number: o.order_number,
            created_at: o.created_at,
            last_updated: o.last_updated,
            updated_by: o.updated_by,
            vendor_id: o.vendor_id
        }));

        const BATCH_SIZE = 100;
        for (let i = 0; i < ordersPayload.length; i += BATCH_SIZE) {
            const chunk = ordersPayload.slice(i, i + BATCH_SIZE);
            const { error: ordErr } = await supabaseAdmin.from('orders').insert(chunk);
            if (ordErr) {
                errors.push(`Failed to insert orders batch: ${ordErr.message}`);
                return NextResponse.json({
                    success: false,
                    error: `Failed to insert orders: ${ordErr.message}`,
                    ordersCreated: 0,
                    clientsProcessed
                }, { status: 500 });
            }
        }

        for (const o of ordersToInsert) {
            let firstVsId: string | null = null;
            for (const vs of o._vendorSelections || []) {
                const vid = vs.vendorId || vs.vendor_id;
                if (!vid || !vs.items) continue;
                const vsId = randomUUID();
                vendorSelectionsToInsert.push({
                    id: vsId,
                    order_id: o.id,
                    vendor_id: vid
                });
                if (!firstVsId) firstVsId = vsId;
                orderIdToFirstVsId.set(o.id, firstVsId);

                for (const [itemId, quantity] of Object.entries(vs.items)) {
                    const menuItem = menuItems.find((mi: any) => mi.id === itemId);
                    if (!menuItem) continue;
                    const qty = Number(quantity) || 0;
                    if (qty <= 0) continue;
                    menuItemsToInsert.push({
                        id: randomUUID(),
                        vendor_selection_id: vsId,
                        menu_item_id: itemId,
                        quantity: qty
                    });
                }
            }
            const fid = orderIdToFirstVsId.get(o.id);
            if (fid && o._mealPlanItems?.length) {
                for (const item of o._mealPlanItems) {
                    const price = item.price || 0;
                    customItemsToInsert.push({
                        id: randomUUID(),
                        vendor_selection_id: fid,
                        menu_item_id: null,
                        quantity: item.quantity,
                        custom_name: item.name,
                        custom_price: price
                    });
                }
            }
        }

        for (let i = 0; i < vendorSelectionsToInsert.length; i += BATCH_SIZE) {
            const chunk = vendorSelectionsToInsert.slice(i, i + BATCH_SIZE);
            const { error: vsErr } = await supabaseAdmin.from('order_vendor_selections').insert(chunk);
            if (vsErr) {
                errors.push(`Failed to insert vendor selections: ${vsErr.message}`);
            }
        }

        for (let i = 0; i < menuItemsToInsert.length; i += BATCH_SIZE) {
            const chunk = menuItemsToInsert.slice(i, i + BATCH_SIZE);
            const { error: itemErr } = await supabaseAdmin.from('order_items').insert(chunk);
            if (itemErr) {
                errors.push(`Failed to insert menu order items: ${itemErr.message}`);
            }
        }
        if (customItemsToInsert.length > 0) {
            for (let i = 0; i < customItemsToInsert.length; i += BATCH_SIZE) {
                const chunk = customItemsToInsert.slice(i, i + BATCH_SIZE);
                const { error: customErr } = await supabaseAdmin.from('order_items').insert(chunk);
                if (customErr) {
                    errors.push(`Failed to insert custom order items (meal planner): ${customErr.message}`);
                }
            }
        }

        const ordersCreated = ordersToInsert.length;
        console.log(`[Create Expired Meal Planner Orders] Created ${ordersCreated} orders in batch`);

        return NextResponse.json({
            success: true,
            message: `Processed ${clientsProcessed} clients. Created ${ordersCreated} order(s) for expired meal planner items (expired: ${expirationDateStr}).`,
            ordersCreated,
            clientsProcessed,
            expirationDate: expirationDateStr,
            expiredDates,
            expiredItemsCount: expiredItems.length,
            errors: errors.length > 0 ? errors : undefined,
            skippedReasons: skippedReasons.length > 0 ? skippedReasons : undefined
        }, {
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error: any) {
        console.error('[Create Expired Meal Planner Orders] Unexpected error:', error);
        return NextResponse.json({
            success: false,
            error: error.message || 'Failed to create expired meal planner orders',
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        }, {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
