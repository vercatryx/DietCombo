import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { getCurrentTime } from '@/lib/time';
import { getTodayInAppTz } from '@/lib/timezone';
import {
    getClientsForAdmin,
    getDefaultOrderTemplate,
    getMenuItems,
    getDefaultVendorId,
    generateBatchOrderNumbers
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
 * - Client overrides (day-based): clients.meal_planner_data is the source for the client's order per date.
 *   - When client has meal_planner_data for the expired date, use that to build the order (items by name → menu_item_id or custom).
 *   - When client has no meal_planner_data for that date, fall back to clients.upcoming_order (or default) for migration period.
 *   - Always default to defaults when client has nothing.
 * - Created orders are immutable snapshots: we write into orders + order_vendor_selections + order_items the exact items and quantities at creation time. They do not change when defaults or clients.upcoming_order change later.
 * - All dates are in EST (America/New_York). The ?date= param is a calendar date (YYYY-MM-DD) in EST; when omitted, "today" is taken in EST.
 *
 * Logic:
 * 1. Check if today is the expiration date for any meals in the meal planner (default template only).
 * 2. Batch fetch defaults and client overrides.
 * 3. Per client and date: prefer clients.meal_planner_data for that date; else upcoming_order or default.
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
            .select('calendar_date, expiration_date, name, quantity')
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

        // 2. Pre-fetch all reference data in parallel
        // Use getClientsForAdmin to bypass Supabase's 1000-row limit - avoids "Unknown Client" on vendor sheets
        const [allClients, defaultTemplate, menuItems, defaultVendorId] = await Promise.all([
            getClientsForAdmin(supabaseAdmin),
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

        // 3. Default meal plan items from meal_planner_custom_items (admin template). Client meal plan from clients.meal_planner_data.
        const { data: defaultMealItems } = await supabaseAdmin
            .from('meal_planner_custom_items')
            .select('calendar_date, name, quantity')
            .is('client_id', null)
            .in('calendar_date', expiredDates)
            .order('sort_order', { ascending: true });

        const defaultByDate = new Map<string, { name: string; quantity: number }[]>();
        for (const row of defaultMealItems || []) {
            const d = String(row.calendar_date).slice(0, 10);
            if (!defaultByDate.has(d)) defaultByDate.set(d, []);
            defaultByDate.get(d)!.push({
                name: row.name,
                quantity: row.quantity ?? 1
            });
        }

        const clientByDate = new Map<string, Map<string, { name: string; quantity: number }[]>>();
        for (const client of foodClients) {
            if (!client) continue;
            const raw = (client as any).mealPlannerData;
            if (!raw || !Array.isArray(raw)) continue;
            for (const entry of raw) {
                const d = String(entry?.scheduledDeliveryDate ?? entry?.scheduled_delivery_date ?? '').slice(0, 10);
                if (!d || !expiredDates.includes(d)) continue;
                const items = Array.isArray(entry?.items) ? entry.items : [];
                if (items.length === 0) continue;
                if (!clientByDate.has(client.id)) clientByDate.set(client.id, new Map());
                const m = clientByDate.get(client.id)!;
                m.set(d, items.map((it: any) => ({
                    name: (it?.name ?? 'Item').trim() || 'Item',
                    quantity: Number(it?.quantity) ?? 1
                })));
            }
        }

        // 4. Batch fetch existing orders. Case ID from clients.upcoming_order or caseIdExternal.
        const [existingOrdersRes] = await Promise.all([
            supabaseAdmin
                .from('orders')
                .select('client_id, scheduled_delivery_date')
                .in('client_id', foodClientIds)
                .in('scheduled_delivery_date', expiredDates)
                .eq('service_type', 'Food')
        ]);

        const existingSet = new Set<string>();
        for (const r of existingOrdersRes.data || []) {
            existingSet.add(`${r.client_id}:${r.scheduled_delivery_date}`);
        }

        const caseIdByClient = new Map<string, string | null>();
        for (const client of foodClients) {
            if (!client) continue;
            const ao = (client as any).activeOrder;
            let cid: string | null = null;
            if (ao?.caseId && String(ao.caseId).trim()) cid = String(ao.caseId).trim();
            if (!cid && (client as any).caseIdExternal && String((client as any).caseIdExternal).trim()) {
                cid = String((client as any).caseIdExternal).trim();
            }
            caseIdByClient.set(client.id, cid);
        }

        const errors: string[] = [];
        const skippedReasons: string[] = [];
        const ordersToInsert: any[] = [];
        const vendorSelectionsToInsert: { id: string; order_id: string; vendor_id: string }[] = [];
        const menuItemsToInsert: { id: string; vendor_selection_id: string; menu_item_id: string; quantity: number }[] = [];
        const customItemsToInsert: { id: string; vendor_selection_id: string; menu_item_id: null; quantity: number; custom_name: string; custom_price: number | null }[] = [];
        const orderIdToFirstVsId = new Map<string, string>();

        let clientsProcessed = 0;
        let orderCount = 0;

        for (const client of foodClients) {
            if (!client) continue;
            clientsProcessed++;
            // Prefer day-based data: use client's meal_planner_data for each date when present; else fall back to upcoming_order or default.
            const hasClientFoodOverride =
                client.activeOrder &&
                ((client.activeOrder.vendorSelections && client.activeOrder.vendorSelections.length > 0) ||
                    (client.activeOrder.deliveryDayOrders && Object.keys(client.activeOrder.deliveryDayOrders).length > 0));
            const clientFoodOrderFallback = hasClientFoodOverride ? client.activeOrder : defaultTemplate;

            for (const expiredDateStr of expiredDates) {
                const defaultItems = defaultByDate.get(expiredDateStr) || [];
                const clientItems = clientByDate.get(client.id)?.get(expiredDateStr) || [];
                const mealPlanMap = new Map<string, { name: string; quantity: number }>();
                for (const i of defaultItems) mealPlanMap.set(i.name, i);
                for (const i of clientItems) mealPlanMap.set(i.name, i);
                const mealPlanItems = Array.from(mealPlanMap.values());

                const scheduledDeliveryDate = expiredDateStr;
                const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                const deliveryDay = dayNames[new Date(expiredDateStr + 'T12:00:00').getDay()];

                if (existingSet.has(`${client.id}:${scheduledDeliveryDate}`)) {
                    skippedReasons.push(`Client ${client.id} (${client.fullName}): Order already exists for ${scheduledDeliveryDate}`);
                    continue;
                }

                let vendorSelections: any[] = [];
                if (clientItems.length > 0) {
                    // Day-based source: build from meal_planner_data for this date. Match item names to menu items; rest as custom.
                    const itemsByMenuId: Record<string, number> = {};
                    const customItems: { name: string; quantity: number }[] = [];
                    const nameToMenu = new Map((menuItems as any[]).map((m: any) => [String(m.name || '').trim().toLowerCase(), m]));
                    for (const item of clientItems) {
                        const name = (item.name || '').trim();
                        const qty = Math.max(0, Number(item.quantity) ?? 0);
                        if (qty === 0) continue;
                        const menuItem = nameToMenu.get(name.toLowerCase());
                        if (menuItem) {
                            itemsByMenuId[menuItem.id] = (itemsByMenuId[menuItem.id] || 0) + qty;
                        } else {
                            customItems.push({ name: item.name || 'Item', quantity: qty });
                        }
                    }
                    for (const item of defaultItems) {
                        if (mealPlanMap.get(item.name) !== item) continue;
                        const name = (item.name || '').trim();
                        const qty = Math.max(0, Number(item.quantity) ?? 0);
                        if (qty === 0) continue;
                        const menuItem = nameToMenu.get(name.toLowerCase());
                        if (menuItem && !itemsByMenuId[menuItem.id]) {
                            itemsByMenuId[menuItem.id] = qty;
                        } else if (!menuItem) {
                            customItems.push({ name: item.name || 'Item', quantity: qty });
                        }
                    }
                    if (Object.keys(itemsByMenuId).length > 0 || customItems.length > 0) {
                        vendorSelections = [{ vendorId: defaultVendorId, items: itemsByMenuId }];
                        if (customItems.length > 0) {
                            for (const c of customItems) {
                                mealPlanMap.set(c.name, { name: c.name, quantity: c.quantity });
                            }
                        }
                    }
                }
                if (vendorSelections.length === 0 && clientFoodOrderFallback) {
                    if (clientFoodOrderFallback.deliveryDayOrders) {
                        if (deliveryDay && clientFoodOrderFallback.deliveryDayOrders[deliveryDay]) {
                            vendorSelections = clientFoodOrderFallback.deliveryDayOrders[deliveryDay].vendorSelections || [];
                        } else {
                            const firstDay = Object.keys(clientFoodOrderFallback.deliveryDayOrders)[0];
                            if (firstDay) {
                                vendorSelections = clientFoodOrderFallback.deliveryDayOrders[firstDay].vendorSelections || [];
                            }
                        }
                    } else if (clientFoodOrderFallback.vendorSelections) {
                        vendorSelections = clientFoodOrderFallback.vendorSelections;
                    }
                }

                const mealPlanItemsFinal = Array.from(mealPlanMap.values());
                if (!vendorSelections || vendorSelections.length === 0) {
                    skippedReasons.push(`Client ${client.id} (${client.fullName}): No vendor selections or meal plan items for ${expiredDateStr}`);
                    continue;
                }

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
                for (const item of mealPlanItemsFinal) {
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
                    _mealPlanItems: mealPlanItemsFinal,
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
                    customItemsToInsert.push({
                        id: randomUUID(),
                        vendor_selection_id: fid,
                        menu_item_id: null,
                        quantity: item.quantity,
                        custom_name: item.name,
                        custom_price: null
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
