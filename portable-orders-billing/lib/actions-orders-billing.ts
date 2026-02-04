'use server';

/**
 * Portable Orders & Billing – server actions.
 *
 * DEPENDENCIES (fix imports to match your app):
 * - supabase client: import { supabase } from '@/lib/supabase' (or your path)
 * - createClient from '@supabase/supabase-js' for service-role usage
 *
 * DB: orders, order_items, order_vendor_selections, order_box_selections,
 * billing_records, clients, vendors, menu_items, box_types, equipment,
 * item_categories, meal_items (same schema as source app).
 */

import { revalidatePath } from 'next/cache';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { BillingRequest, ClientProfileMinimal, OrderDetail } from './types-orders-billing';

// Re-export so components can do: import { getBillingRequestsByWeek, type BillingRequest } from '@/lib/actions-orders-billing'
export type { BillingRequest } from './types-orders-billing';
import { getWeekStart, getWeekEnd, getWeekRangeString, isDateInWeek } from './utils-week';

// ----- Supabase client: change this import to your app's supabase -----
import { supabase } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// REFERENCE DATA HELPERS (minimal – replace with your app's getMenuItems etc. if you prefer)
// These are used by getOrderById and getBillingHistory to resolve names/prices.
// ---------------------------------------------------------------------------

async function getMenuItems(supabaseClient: SupabaseClient) {
    const { data } = await supabaseClient.from('menu_items').select('*');
    return data || [];
}

async function getVendors(supabaseClient: SupabaseClient) {
    const { data } = await supabaseClient.from('vendors').select('*');
    return data || [];
}

async function getBoxTypes(supabaseClient: SupabaseClient) {
    const { data } = await supabaseClient.from('box_types').select('*');
    return data || [];
}

async function getEquipment(supabaseClient: SupabaseClient) {
    const { data } = await supabaseClient.from('equipment').select('*');
    return data || [];
}

async function getCategories(supabaseClient: SupabaseClient) {
    const { data } = await supabaseClient.from('item_categories').select('*');
    return data || [];
}

async function getMealItems(supabaseClient: SupabaseClient) {
    const { data } = await supabaseClient.from('meal_items').select('*');
    return data || [];
}

// ---------------------------------------------------------------------------
// ORDERS LIST: fetch all orders (excludes billing_pending; only scheduled)
// ---------------------------------------------------------------------------

/**
 * Returns all orders for the Orders list page.
 * Excludes status = 'billing_pending' and orders without scheduled_delivery_date.
 * Uses service role if SUPABASE_SERVICE_ROLE_KEY is set (recommended for admin views).
 */
export async function getAllOrders(): Promise<any[]> {
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const db = serviceRoleKey
        ? createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, { auth: { persistSession: false } })
        : supabase;

    const { data, error } = await db
        .from('orders')
        .select(`*, clients(full_name)`)
        .neq('status', 'billing_pending')
        .not('scheduled_delivery_date', 'is', null)
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error fetching all orders:', error);
        return [];
    }

    const orders = data || [];
    const orderIds = orders.map((o: any) => o.id);
    const vendorNamesByOrderId = new Map<string, string[]>();

    if (orderIds.length > 0) {
        const BATCH = 200;
        let ovsData: { order_id: string; vendor_id: string | null }[] = [];
        let obsData: { order_id: string; vendor_id: string | null }[] = [];
        for (let i = 0; i < orderIds.length; i += BATCH) {
            const batch = orderIds.slice(i, i + BATCH);
            const [ovsRes, obsRes] = await Promise.all([
                db.from('order_vendor_selections').select('order_id, vendor_id').in('order_id', batch),
                db.from('order_box_selections').select('order_id, vendor_id').in('order_id', batch),
            ]);
            ovsData = ovsData.concat(ovsRes.data || []);
            obsData = obsData.concat(obsRes.data || []);
        }

        const allVendorIds = new Set<string>();
        ovsData.forEach((r: any) => r.vendor_id && allVendorIds.add(r.vendor_id));
        obsData.forEach((r: any) => r.vendor_id && allVendorIds.add(r.vendor_id));
        orders.forEach((o: any) => {
            if (o.service_type === 'Equipment' && o.notes) {
                try {
                    const notes = typeof o.notes === 'string' ? JSON.parse(o.notes) : o.notes;
                    const vid = notes?.vendorId ?? notes?.vendor_id;
                    if (vid) allVendorIds.add(vid);
                } catch (_) {}
            }
        });

        const vendorById = new Map<string, string>();
        if (allVendorIds.size > 0) {
            const { data: vendors } = await db.from('vendors').select('id, name').in('id', Array.from(allVendorIds));
            (vendors || []).forEach((v: any) => vendorById.set(v.id, v.name));
        }

        const addVendor = (orderId: string, vendorId: string | null) => {
            if (!orderId) return;
            const name = vendorId ? vendorById.get(vendorId) ?? 'Unknown' : 'Unknown';
            const existing = vendorNamesByOrderId.get(orderId) || [];
            if (!existing.includes(name)) existing.push(name);
            vendorNamesByOrderId.set(orderId, existing);
        };
        ovsData.forEach((r: any) => addVendor(r.order_id, r.vendor_id));
        obsData.forEach((r: any) => addVendor(r.order_id, r.vendor_id));
        orders.forEach((o: any) => {
            if (o.service_type === 'Equipment' && o.notes) {
                try {
                    const notes = typeof o.notes === 'string' ? JSON.parse(o.notes) : o.notes;
                    addVendor(o.id, notes?.vendorId ?? notes?.vendor_id);
                } catch (_) {}
            }
        });
    }

    return orders.map((o: any) => ({
        ...o,
        clientName: o.clients?.full_name || 'Unknown',
        status: o.status || 'pending',
        scheduled_delivery_date: o.scheduled_delivery_date || null,
        vendorNames: (vendorNamesByOrderId.get(o.id) || ['Unknown']).sort(),
    }));
}

// ---------------------------------------------------------------------------
// ORDER BY ID: full detail for OrderDetailView (Food/Meal/Boxes/Equipment/Custom)
// ---------------------------------------------------------------------------

/**
 * Fetches one order by id and builds orderDetails (vendorSelections, box contents, equipment, etc.).
 * Used by the order detail page.
 */
export async function getOrderById(orderId: string): Promise<OrderDetail | null> {
    if (!orderId) return null;

    let supabaseClient = supabase;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (serviceRoleKey) {
        supabaseClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, {
            auth: { persistSession: false },
        });
    }

    const { data: orderData, error: orderError } = await supabaseClient
        .from('orders')
        .select('*')
        .eq('id', orderId)
        .single();

    if (orderError || !orderData) return null;

    const { data: clientData } = await supabaseClient
        .from('clients')
        .select('id, full_name, address, email, phone_number')
        .eq('id', orderData.client_id)
        .single();

    const [menuItems, vendors, boxTypes, equipmentList, categories, mealItems] = await Promise.all([
        getMenuItems(supabaseClient),
        getVendors(supabaseClient),
        getBoxTypes(supabaseClient),
        getEquipment(supabaseClient),
        getCategories(supabaseClient),
        getMealItems(supabaseClient),
    ]);

    let orderDetails: any = undefined;

    if (orderData.service_type === 'Food' || orderData.service_type === 'Meal') {
        const { data: vendorSelections } = await supabaseClient
            .from('order_vendor_selections')
            .select('*')
            .eq('order_id', orderId);

        if (vendorSelections?.length) {
            const vendorSelectionsWithItems = await Promise.all(
                vendorSelections.map(async (vs: any) => {
                    const { data: items } = await supabaseClient
                        .from('order_items')
                        .select('*')
                        .eq('vendor_selection_id', vs.id);
                    const vendor = vendors.find((v: any) => v.id === vs.vendor_id);
                    const itemsWithDetails = (items || []).map((item: any) => {
                        let menuItem = menuItems.find((mi: any) => mi.id === item.menu_item_id);
                        if (!menuItem && item.meal_item_id) menuItem = mealItems.find((mi: any) => mi.id === item.meal_item_id);
                        const itemPrice = item.custom_price ? parseFloat(item.custom_price) : (menuItem?.price_each ?? parseFloat(item.unit_value));
                        return {
                            id: item.id,
                            menuItemId: item.menu_item_id,
                            menuItemName: item.custom_name || menuItem?.name || 'Unknown Item',
                            quantity: item.quantity,
                            unitValue: itemPrice,
                            totalValue: itemPrice * item.quantity,
                            notes: item.notes || null,
                        };
                    });
                    return { vendorId: vs.vendor_id, vendorName: vendor?.name || 'Unknown Vendor', items: itemsWithDetails };
                })
            );
            orderDetails = {
                serviceType: orderData.service_type,
                vendorSelections: vendorSelectionsWithItems,
                totalItems: orderData.total_items,
                totalValue: parseFloat(orderData.total_value || 0),
            };
        }
    } else if (orderData.service_type === 'Custom') {
        const { data: vendorSelections } = await supabaseClient
            .from('order_vendor_selections')
            .select('*')
            .eq('order_id', orderId);
        if (vendorSelections?.length) {
            const vendorSelectionsWithItems = await Promise.all(
                vendorSelections.map(async (vs: any) => {
                    const { data: items } = await supabaseClient.from('order_items').select('*').eq('vendor_selection_id', vs.id);
                    const vendor = vendors.find((v: any) => v.id === vs.vendor_id);
                    const itemsWithDetails = (items || []).map((item: any) => ({
                        id: item.id,
                        menuItemName: item.custom_name || 'Custom Item',
                        quantity: item.quantity,
                        unitValue: parseFloat(item.custom_price || 0),
                        totalValue: parseFloat(item.custom_price || 0) * item.quantity,
                    }));
                    return { vendorId: vs.vendor_id, vendorName: vendor?.name || 'Unknown Vendor', items: itemsWithDetails };
                })
            );
            orderDetails = {
                serviceType: 'Custom',
                vendorSelections: vendorSelectionsWithItems,
                totalItems: orderData.total_items,
                totalValue: parseFloat(orderData.total_value || 0),
                notes: orderData.notes,
            };
        }
    } else if (orderData.service_type === 'Boxes') {
        const { data: boxSelection } = await supabaseClient
            .from('order_box_selections')
            .select('*')
            .eq('order_id', orderId)
            .maybeSingle();
        if (boxSelection) {
            const vendor = vendors.find((v: any) => v.id === boxSelection.vendor_id);
            const boxType = boxTypes.find((bt: any) => bt.id === boxSelection.box_type_id);
            const boxItems = boxSelection.items || {};
            const itemsByCategory: Record<string, { categoryName: string; items: Array<{ itemId: string; itemName: string; quantity: number; quotaValue: number }> }> = {};
            Object.entries(boxItems).forEach(([itemId, qty]: [string, any]) => {
                const menuItem = menuItems.find((mi: any) => mi.id === itemId);
                const quantity = typeof qty === 'object' && qty !== null ? (qty as any).quantity : Number(qty) || 0;
                const category = menuItem?.category_id ? categories.find((c: any) => c.id === menuItem.category_id) : null;
                const catId = category?.id || 'uncategorized';
                const catName = category?.name || 'Uncategorized';
                if (!itemsByCategory[catId]) itemsByCategory[catId] = { categoryName: catName, items: [] };
                itemsByCategory[catId].items.push({
                    itemId,
                    itemName: menuItem?.name || 'Unknown Item',
                    quantity,
                    quotaValue: menuItem?.quota_value ?? 1,
                });
            });
            orderDetails = {
                serviceType: 'Boxes',
                vendorId: boxSelection.vendor_id,
                vendorName: vendor?.name || 'Unknown Vendor',
                boxTypeId: boxSelection.box_type_id,
                boxTypeName: boxType?.name || 'Unknown Box Type',
                boxQuantity: boxSelection.quantity,
                items: boxItems,
                itemsByCategory,
                totalValue: boxSelection.total_value ? parseFloat(boxSelection.total_value) : parseFloat(orderData.total_value || 0),
            };
        } else {
            orderDetails = {
                serviceType: 'Boxes',
                vendorName: 'Unknown Vendor (Missing Selection Data)',
                itemsByCategory: {},
                totalValue: parseFloat(orderData.total_value || 0),
            };
        }
    } else if (orderData.service_type === 'Equipment') {
        try {
            const notes = orderData.notes ? JSON.parse(orderData.notes) : null;
            if (notes) {
                const vendor = vendors.find((v: any) => v.id === notes.vendorId);
                const equipment = equipmentList.find((e: any) => e.id === notes.equipmentId);
                orderDetails = {
                    serviceType: 'Equipment',
                    vendorName: vendor?.name || 'Unknown Vendor',
                    equipmentName: notes.equipmentName || equipment?.name || 'Unknown Equipment',
                    price: notes.price ?? equipment?.price ?? 0,
                    totalValue: parseFloat(orderData.total_value || 0),
                };
            }
        } catch (_) {
            const { data: vs } = await supabaseClient
                .from('order_vendor_selections')
                .select('*')
                .eq('order_id', orderId)
                .limit(1)
                .maybeSingle();
            if (vs) {
                const vendor = vendors.find((v: any) => v.id === vs.vendor_id);
                orderDetails = {
                    serviceType: 'Equipment',
                    vendorName: vendor?.name || 'Unknown Vendor',
                    totalValue: parseFloat(orderData.total_value || 0),
                };
            }
        }
    }

    return {
        id: orderData.id,
        orderNumber: orderData.order_number,
        clientId: orderData.client_id,
        clientName: clientData?.full_name || 'Unknown Client',
        clientAddress: clientData?.address || '',
        clientEmail: clientData?.email || '',
        clientPhone: clientData?.phone_number || '',
        serviceType: orderData.service_type,
        caseId: orderData.case_id,
        status: orderData.status,
        scheduledDeliveryDate: orderData.scheduled_delivery_date,
        actualDeliveryDate: orderData.actual_delivery_date,
        deliveryProofUrl: orderData.proof_of_delivery_image || orderData.delivery_proof_url || '',
        totalValue: parseFloat(orderData.total_value || 0),
        totalItems: orderData.total_items,
        notes: orderData.notes,
        createdAt: orderData.created_at,
        lastUpdated: orderData.updated_at,
        updatedBy: orderData.updated_by,
        orderDetails,
    };
}

// ---------------------------------------------------------------------------
// DELETE ORDER (and related rows: order_items, order_vendor_selections, order_box_selections)
// ---------------------------------------------------------------------------

/**
 * Deletes an order and its related records. Uses service role.
 * Does not delete billing_records (you may want to keep them for history).
 */
export async function deleteOrder(orderId: string): Promise<{ success: boolean; message?: string }> {
    if (!orderId) return { success: false, message: 'Order ID is required' };
    try {
        const supabaseAdmin = createClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            { auth: { persistSession: false } }
        );
        const { data: vendorSelections } = await supabaseAdmin
            .from('order_vendor_selections')
            .select('id')
            .eq('order_id', orderId);
        if (vendorSelections?.length) {
            const vsIds = vendorSelections.map((vs) => vs.id);
            await supabaseAdmin.from('order_items').delete().in('vendor_selection_id', vsIds);
            await supabaseAdmin.from('order_vendor_selections').delete().eq('order_id', orderId);
        }
        await supabaseAdmin.from('order_box_selections').delete().eq('order_id', orderId);
        await supabaseAdmin.from('orders').delete().eq('id', orderId);

        revalidatePath('/orders');
        revalidatePath(`/orders/${orderId}`);
        revalidatePath('/billing');
        return { success: true };
    } catch (error: any) {
        console.error('Error deleting order:', error);
        return { success: false, message: error.message || 'An unknown error occurred' };
    }
}

// ---------------------------------------------------------------------------
// BILLING HISTORY (per client) – for BillingDetail page
// ---------------------------------------------------------------------------

/**
 * Billing records for one client, with order details resolved for display.
 */
export async function getBillingHistory(clientId: string): Promise<any[]> {
    if (!clientId) return [];
    const { data, error } = await supabase
        .from('billing_records')
        .select('*')
        .eq('client_id', clientId)
        .order('created_at', { ascending: false });
    if (error) {
        console.error('Error fetching billing history:', error);
        return [];
    }
    const [menuItems, vendors, boxTypes] = await Promise.all([
        getMenuItems(supabase),
        getVendors(supabase),
        getBoxTypes(supabase),
    ]);
    const billingRecords = data || [];
    const recordsWithOrderData = await Promise.all(
        billingRecords.map(async (d: any) => {
            let orderDetails: any = undefined;
            if (d.order_id) {
                const { data: orderData, error: orderError } = await supabase
                    .from('orders')
                    .select('*')
                    .eq('id', d.order_id)
                    .single();
                if (!orderError && orderData) {
                    if (orderData.service_type === 'Food') {
                        const { data: vendorSelections } = await supabase
                            .from('order_vendor_selections')
                            .select('*')
                            .eq('order_id', d.order_id);
                        if (vendorSelections?.length) {
                            const vendorSelectionsWithItems = await Promise.all(
                                vendorSelections.map(async (vs: any) => {
                                    const { data: items } = await supabase
                                        .from('order_items')
                                        .select('*')
                                        .eq('vendor_selection_id', vs.id);
                                    const vendor = vendors.find((v: any) => v.id === vs.vendor_id);
                                    const itemsWithDetails = (items || [])
                                        .filter((item: any) => item.menu_item_id != null)
                                        .map((item: any) => {
                                            const menuItem = menuItems.find((mi: any) => mi.id === item.menu_item_id);
                                            const itemPrice = menuItem?.price_each ?? parseFloat(item.unit_value || '0');
                                            return {
                                                menuItemName: menuItem?.name || 'Unknown Item',
                                                quantity: item.quantity,
                                                unitValue: itemPrice,
                                                totalValue: itemPrice * item.quantity,
                                            };
                                        });
                                    return { vendorName: vendor?.name || 'Unknown Vendor', items: itemsWithDetails };
                                })
                            );
                            const totalValue = vendorSelectionsWithItems.reduce(
                                (sum, vs) => sum + (vs.items as any[]).reduce((s, i) => s + i.totalValue, 0),
                                0
                            );
                            orderDetails = { serviceType: 'Food', vendorSelections: vendorSelectionsWithItems, totalValue };
                        }
                    } else if (orderData.service_type === 'Boxes') {
                        const { data: boxSelection } = await supabase
                            .from('order_box_selections')
                            .select('*')
                            .eq('order_id', d.order_id)
                            .maybeSingle();
                        if (boxSelection) {
                            const vendor = vendors.find((v: any) => v.id === boxSelection.vendor_id);
                            const boxType = boxTypes.find((bt: any) => bt.id === boxSelection.box_type_id);
                            orderDetails = {
                                serviceType: 'Boxes',
                                vendorName: vendor?.name || 'Unknown Vendor',
                                boxTypeName: boxType?.name || 'Unknown Box Type',
                                boxQuantity: boxSelection.quantity,
                                totalValue: boxSelection.total_value ? parseFloat(boxSelection.total_value) : parseFloat(orderData.total_value || 0),
                            };
                        }
                    } else {
                        orderDetails = { serviceType: orderData.service_type, totalValue: parseFloat(orderData.total_value || 0), notes: orderData.notes };
                    }
                }
            }
            let amount = d.amount;
            if (orderDetails?.totalValue !== undefined) amount = orderDetails.totalValue;
            return {
                id: d.id,
                clientId: d.client_id,
                status: d.status,
                amount,
                createdAt: d.created_at,
                date: d.date || new Date(d.created_at).toLocaleDateString(),
                method: d.method || 'N/A',
                orderId: d.order_id,
                orderDetails,
            };
        })
    );
    return recordsWithOrderData;
}

// ---------------------------------------------------------------------------
// BILLING REQUESTS BY WEEK – for Billing list page (grouped by client + week)
// ---------------------------------------------------------------------------

/**
 * Returns billing “requests” (one per client per week) with orders and totals.
 * Used by the main Billing page. Uses service role if available.
 */
export async function getBillingRequestsByWeek(weekStartDate?: Date): Promise<BillingRequest[]> {
    let supabaseClient = supabase;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (serviceRoleKey) {
        supabaseClient = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, serviceRoleKey, {
            auth: { persistSession: false },
        });
    }

    const PAGE_SIZE = 1000;
    const allOrdersData: any[] = [];
    let ordersOffset = 0;
    let ordersHasMore = true;
    while (ordersHasMore) {
        const { data: page, error: ordersError } = await supabaseClient
            .from('orders')
            .select('*, clients(full_name)')
            .order('created_at', { ascending: false })
            .range(ordersOffset, ordersOffset + PAGE_SIZE - 1);
        if (ordersError) {
            console.error('Error fetching orders:', ordersError);
            return [];
        }
        const rows = page || [];
        allOrdersData.push(...rows);
        ordersHasMore = rows.length >= PAGE_SIZE;
        ordersOffset += PAGE_SIZE;
    }

    const allBillingRecords: any[] = [];
    let brOffset = 0;
    let brHasMore = true;
    while (brHasMore) {
        const { data: brPage, error: billingError } = await supabaseClient
            .from('billing_records')
            .select('order_id, status')
            .eq('status', 'success')
            .range(brOffset, brOffset + PAGE_SIZE - 1);
        if (billingError) console.error('Error fetching billing records:', billingError);
        const rows = brPage || [];
        allBillingRecords.push(...rows);
        brHasMore = rows.length >= PAGE_SIZE;
        brOffset += PAGE_SIZE;
    }
    const successfulOrderIds = new Set(allBillingRecords.map((br: any) => br.order_id).filter(Boolean));

    const allOrders = allOrdersData.map((o: any) => {
        const hasProof = !!(o.proof_of_delivery_image || o.delivery_proof_url);
        const isBilled = successfulOrderIds.has(o.id);
        return {
            ...o,
            clientName: o.clients?.full_name || 'Unknown',
            amount: o.total_value || 0,
            hasProof,
            isBilled,
        };
    });

    let filteredOrders = allOrders;
    if (weekStartDate) {
        filteredOrders = allOrders.filter((order) => {
            const deliveryDateStr = order.actual_delivery_date || order.scheduled_delivery_date;
            const dateToUse = deliveryDateStr ? new Date(deliveryDateStr) : order.created_at ? new Date(order.created_at) : null;
            if (!dateToUse) return false;
            return isDateInWeek(dateToUse, weekStartDate);
        });
    }

    const billingRequestsMap = new Map<string, BillingRequest>();
    for (const order of filteredOrders) {
        const deliveryDateStr = order.actual_delivery_date || order.scheduled_delivery_date;
        const deliveryDate = deliveryDateStr ? new Date(deliveryDateStr) : order.created_at ? new Date(order.created_at) : null;
        if (!deliveryDate) continue;
        deliveryDate.setHours(12, 0, 0, 0);
        const weekStart = getWeekStart(deliveryDate);
        weekStart.setHours(0, 0, 0, 0);
        const weekEnd = getWeekEnd(deliveryDate);
        const weekStartDateStr = weekStart.toISOString().split('T')[0];
        const weekKey = `${order.client_id}-${weekStartDateStr}`;
        const weekRange = getWeekRangeString(deliveryDate);

        if (!billingRequestsMap.has(weekKey)) {
            billingRequestsMap.set(weekKey, {
                clientId: order.client_id,
                clientName: order.clientName,
                weekStart: weekStart.toISOString(),
                weekEnd: weekEnd.toISOString(),
                weekRange,
                orders: [],
                equipmentOrders: [],
                totalAmount: 0,
                orderCount: 0,
                readyForBilling: true,
                billingCompleted: true,
                billingStatus: 'pending',
                equipmentTotalAmount: 0,
                equipmentOrderCount: 0,
                equipmentReadyForBilling: true,
                equipmentBillingCompleted: true,
                equipmentBillingStatus: 'pending',
            });
        }
        const request = billingRequestsMap.get(weekKey)!;
        const isEquipment = order.service_type === 'Equipment';
        if (isEquipment) {
            request.equipmentOrders.push(order);
            request.equipmentTotalAmount += order.amount || 0;
            request.equipmentOrderCount += 1;
        } else {
            request.orders.push(order);
            request.totalAmount += order.amount || 0;
        }
        request.orderCount = request.orders.length + request.equipmentOrders.length;
    }

    for (const request of billingRequestsMap.values()) {
        request.readyForBilling = request.orders.length === 0 || request.orders.every((o) => o.hasProof);
        request.billingCompleted = request.orders.length === 0 || request.orders.every((o) => o.isBilled);
        const allSuccessful = request.orders.length > 0 && request.orders.every((o) => o.status === 'billing_successful');
        const hasFailed = request.orders.some((o) => o.status === 'billing_failed');
        request.billingStatus = allSuccessful ? 'success' : hasFailed ? 'failed' : 'pending';
        request.totalAmount = request.orders.reduce((s, o) => s + (o.amount || 0), 0) + request.equipmentTotalAmount;

        request.equipmentReadyForBilling = request.equipmentOrders.length === 0 || request.equipmentOrders.every((o) => o.hasProof);
        request.equipmentBillingCompleted = request.equipmentOrders.length === 0 || request.equipmentOrders.every((o) => o.isBilled);
        const equipAllSuccessful = request.equipmentOrders.length > 0 && request.equipmentOrders.every((o) => o.status === 'billing_successful');
        const equipHasFailed = request.equipmentOrders.some((o) => o.status === 'billing_failed');
        request.equipmentBillingStatus = equipAllSuccessful ? 'success' : equipHasFailed ? 'failed' : 'pending';
    }

    let billingRequests = Array.from(billingRequestsMap.values()).sort((a, b) => {
        const dateA = new Date(a.weekStart).getTime();
        const dateB = new Date(b.weekStart).getTime();
        if (dateB !== dateA) return dateB - dateA;
        return a.clientName.localeCompare(b.clientName);
    });

    if (weekStartDate) {
        const selectedWeekStart = getWeekStart(weekStartDate);
        billingRequests = billingRequests.filter((req) => getWeekStart(new Date(req.weekStart)).getTime() === selectedWeekStart.getTime());
    }
    return billingRequests;
}

// ---------------------------------------------------------------------------
// CLIENT (minimal) – for BillingDetail header
// ---------------------------------------------------------------------------

/**
 * Fetches a single client for the billing detail page (id, fullName, etc.).
 * Replace with your app's getClient if you already have one.
 */
export async function getClient(clientId: string): Promise<ClientProfileMinimal | null> {
    if (!clientId) return null;
    const { data, error } = await supabase.from('clients').select('id, full_name, email, address, phone_number').eq('id', clientId).single();
    if (error || !data) return null;
    return {
        id: data.id,
        fullName: data.full_name,
        email: data.email ?? null,
        address: data.address ?? '',
        phoneNumber: data.phone_number ?? '',
    };
}
