'use server';

import { promises as fs } from 'fs';
import path from 'path';
import { supabase } from './supabase';
import { getMenuItems, getVendors, getBoxTypes } from './actions';

interface LocalOrdersDB {
    orders: any[];
    upcomingOrders: any[];
    orderVendorSelections: any[];
    orderItems: any[];
    orderBoxSelections: any[];
    upcomingOrderVendorSelections: any[];
    upcomingOrderItems: any[];
    upcomingOrderBoxSelections: any[];
    lastSynced: string;
}

const DB_PATH = path.join(process.cwd(), 'data', 'local-orders-db.json');

// Ensure data directory exists and initialize DB file if it doesn't exist
async function ensureDBFile(): Promise<boolean> {
    const dataDir = path.join(process.cwd(), 'data');
    try {
        await fs.access(dataDir);
    } catch {
        try {
            await fs.mkdir(dataDir, { recursive: true });
        } catch (error: any) {
            // If we can't create the directory (e.g., read-only filesystem in serverless), skip file operations
            if (error.code === 'EROFS' || error.code === 'EACCES') {
                return false;
            }
            throw error;
        }
    }

    try {
        await fs.access(DB_PATH);
    } catch {
        // Initialize empty database
        const initialDB: LocalOrdersDB = {
            orders: [],
            upcomingOrders: [],
            orderVendorSelections: [],
            orderItems: [],
            orderBoxSelections: [],
            upcomingOrderVendorSelections: [],
            upcomingOrderItems: [],
            upcomingOrderBoxSelections: [],
            lastSynced: new Date().toISOString()
        };
        try {
            await fs.writeFile(DB_PATH, JSON.stringify(initialDB, null, 2));
        } catch (error: any) {
            // If we can't write (e.g., read-only filesystem in serverless), skip file operations
            if (error.code === 'EROFS' || error.code === 'EACCES') {
                return false;
            }
            throw error;
        }
    }
    return true;
}

// Read local database
export async function readLocalDB(): Promise<LocalOrdersDB> {
    const canWrite = await ensureDBFile();
    if (!canWrite) {
        // Return empty DB if filesystem is read-only (e.g., in serverless environment)
        return {
            orders: [],
            upcomingOrders: [],
            orderVendorSelections: [],
            orderItems: [],
            orderBoxSelections: [],
            upcomingOrderVendorSelections: [],
            upcomingOrderItems: [],
            upcomingOrderBoxSelections: [],
            lastSynced: new Date().toISOString()
        };
    }
    try {
        const content = await fs.readFile(DB_PATH, 'utf-8');
        return JSON.parse(content);
    } catch (error) {
        // Return empty DB if read fails
        return {
            orders: [],
            upcomingOrders: [],
            orderVendorSelections: [],
            orderItems: [],
            orderBoxSelections: [],
            upcomingOrderVendorSelections: [],
            upcomingOrderItems: [],
            upcomingOrderBoxSelections: [],
            lastSynced: new Date().toISOString()
        };
    }
}

// Write to local database
async function writeLocalDB(db: LocalOrdersDB): Promise<void> {
    const canWrite = await ensureDBFile();
    if (!canWrite) {
        // Silently skip write if filesystem is read-only (e.g., in serverless environment)
        // The local DB is just a cache, so this is fine
        return;
    }
    try {
        db.lastSynced = new Date().toISOString();
        await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2));
    } catch (error: any) {
        // Silently skip write errors (e.g., read-only filesystem in serverless)
        // The local DB is just a cache, so this is fine
        if (error.code !== 'EROFS' && error.code !== 'EACCES') {
            // Only log non-permission errors for debugging
            console.warn('Error writing local DB (non-permission error):', error);
        }
    }
}

// Check if local DB needs sync (if it's empty or stale > 2 minutes)
async function needsSync(): Promise<boolean> {
    try {
        const db = await readLocalDB();
        // Always sync if DB is completely empty
        if (db.orders.length === 0 && db.upcomingOrders.length === 0) {
            return true; // Empty DB needs sync
        }
        // Check if last sync was more than 2 minutes ago
        const lastSynced = new Date(db.lastSynced);
        const now = new Date();
        const diffMinutes = (now.getTime() - lastSynced.getTime()) / (1000 * 60);
        return diffMinutes > 2; // Sync if older than 2 minutes for better freshness
    } catch {
        return true; // Error reading DB, needs sync
    }
}

// Trigger sync in background (non-blocking)
export async function triggerSyncInBackground(): Promise<void> {
    // Use setImmediate or setTimeout to run in background
    // This function returns immediately, sync runs asynchronously
    if (typeof setImmediate !== 'undefined') {
        setImmediate(() => {
            syncLocalDBFromMySQL().catch(err => {
                console.error('Background sync error:', err);
            });
        });
    } else {
        setTimeout(() => {
            syncLocalDBFromMySQL().catch(err => {
                console.error('Background sync error:', err);
            });
        }, 0);
    }
}

// Sync all orders and upcoming orders from MySQL to local DB
export async function syncLocalDBFromMySQL(): Promise<void> {
    // Keep the old function name for backward compatibility
    return syncLocalDBFromSupabase();
}

// Sync all orders and upcoming orders from Supabase to local DB
export async function syncLocalDBFromSupabase(): Promise<void> {
    try {
        // console.log('Starting local DB sync from Supabase...');

        // Fetch all orders with status pending, confirmed, or processing
        const { data: orders, error: ordersError } = await supabase
            .from('orders')
            .select('*')
            .in('status', ['pending', 'confirmed', 'processing']);

        if (ordersError) {
            console.error('[syncLocalDBFromSupabase] Error fetching orders:', ordersError);
            throw ordersError;
        }

        // Fetch all scheduled upcoming orders
        const { data: upcomingOrders, error: upcomingOrdersError } = await supabase
            .from('upcoming_orders')
            .select('*')
            .eq('status', 'scheduled');

        if (upcomingOrdersError) {
            console.error('[syncLocalDBFromSupabase] Error fetching upcoming orders:', upcomingOrdersError);
            throw upcomingOrdersError;
        }

        // Fetch related data for orders
        const orderIds = (orders || []).map(o => o.id);
        let orderVendorSelections: any[] = [];
        let orderItems: any[] = [];
        let orderBoxSelections: any[] = [];

        if (orderIds.length > 0) {
            // Fetch vendor selections
            const { data: vsData, error: vsError } = await supabase
                .from('order_vendor_selections')
                .select('*')
                .in('order_id', orderIds);

            if (vsError) {
                console.error('[syncLocalDBFromSupabase] Error fetching vendor selections:', vsError);
                throw vsError;
            }

            orderVendorSelections = vsData || [];

            // Fetch items for these vendor selections
            const vsIds = orderVendorSelections.map(vs => vs.id);
            if (vsIds.length > 0) {
                const { data: itemsData, error: itemsError } = await supabase
                    .from('order_items')
                    .select('*')
                    .in('vendor_selection_id', vsIds);

                if (itemsError) {
                    console.error('[syncLocalDBFromSupabase] Error fetching order items:', itemsError);
                    throw itemsError;
                }

                orderItems = itemsData || [];
            }

            // Fetch box selections
            const { data: boxData, error: boxError } = await supabase
                .from('order_box_selections')
                .select('*')
                .in('order_id', orderIds);

            if (boxError) {
                console.error('[syncLocalDBFromSupabase] Error fetching box selections:', boxError);
                throw boxError;
            }

            orderBoxSelections = boxData || [];
        }

        // Fetch related data for upcoming orders
        const upcomingOrderIds = (upcomingOrders || []).map(o => o.id);
        let upcomingOrderVendorSelections: any[] = [];
        let upcomingOrderItems: any[] = [];
        let upcomingOrderBoxSelections: any[] = [];

        if (upcomingOrderIds.length > 0) {
            // Fetch vendor selections
            const { data: uvsData, error: uvsError } = await supabase
                .from('upcoming_order_vendor_selections')
                .select('*')
                .in('upcoming_order_id', upcomingOrderIds);

            if (uvsError) {
                console.error('[syncLocalDBFromSupabase] Error fetching upcoming vendor selections:', uvsError);
                throw uvsError;
            }

            upcomingOrderVendorSelections = uvsData || [];

            // Fetch items for these vendor selections (Food orders)
            const uvsIds = upcomingOrderVendorSelections.map(vs => vs.id);
            if (uvsIds.length > 0) {
                const { data: uitemsData, error: uitemsError } = await supabase
                    .from('upcoming_order_items')
                    .select('*')
                    .in('upcoming_vendor_selection_id', uvsIds);

                if (uitemsError) {
                    console.error('[syncLocalDBFromSupabase] Error fetching upcoming order items:', uitemsError);
                    throw uitemsError;
                }

                upcomingOrderItems = uitemsData || [];
            }

            // Fetch box items (items linked directly to upcoming_order_id without vendor_selection_id)
            // These are items for Boxes orders
            const { data: boxItemsData, error: boxItemsError } = await supabase
                .from('upcoming_order_items')
                .select('*')
                .in('upcoming_order_id', upcomingOrderIds)
                .is('upcoming_vendor_selection_id', null)
                .is('vendor_selection_id', null);

            if (boxItemsError) {
                console.error('[syncLocalDBFromSupabase] Error fetching upcoming box items:', boxItemsError);
                throw boxItemsError;
            }

            // Merge box items with other items
            if (boxItemsData && boxItemsData.length > 0) {
                upcomingOrderItems = [...(upcomingOrderItems || []), ...boxItemsData];
            }

            // Fetch box selections
            const { data: uboxData, error: uboxError } = await supabase
                .from('upcoming_order_box_selections')
                .select('*')
                .in('upcoming_order_id', upcomingOrderIds);

            if (uboxError) {
                console.error('[syncLocalDBFromSupabase] Error fetching upcoming box selections:', uboxError);
                throw uboxError;
            }

            upcomingOrderBoxSelections = uboxData || [];
        }

        // Update local database
        const localDB: LocalOrdersDB = {
            orders: orders || [],
            upcomingOrders: upcomingOrders || [],
            orderVendorSelections,
            orderItems,
            orderBoxSelections,
            upcomingOrderVendorSelections,
            upcomingOrderItems,
            upcomingOrderBoxSelections,
            lastSynced: new Date().toISOString()
        };


        await writeLocalDB(localDB);
        // console.log(`Local DB synced successfully. Orders: ${orders?.length || 0}, Upcoming Orders: ${upcomingOrders?.length || 0}`);
    } catch (error: any) {
        // Don't throw errors - local DB is just a cache
        // File system errors (read-only filesystem in serverless) can be silently ignored
        if (error.code === 'EROFS' || error.code === 'EACCES') {
            // Silently ignore read-only filesystem errors in serverless environments
            return;
        }
        // Log other errors (e.g., Supabase query errors) but don't fail the operation
        console.warn('Error syncing local DB:', error);
    }
}

// Get active order for client from local DB
export async function getActiveOrderForClientLocal(clientId: string) {
    if (!clientId) return null;

    try {
        // Check if sync is needed and trigger background sync
        if (await needsSync()) {
            triggerSyncInBackground();
        }

        const db = await readLocalDB();

        // Calculate current week range (Sunday to Saturday)
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const day = today.getDay();
        const startOfWeek = new Date(today);
        startOfWeek.setDate(today.getDate() - day);
        startOfWeek.setHours(0, 0, 0, 0);
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        endOfWeek.setHours(23, 59, 59, 999);

        const startOfWeekStr = startOfWeek.toISOString().split('T')[0];
        const endOfWeekStr = endOfWeek.toISOString().split('T')[0];
        const startOfWeekISO = startOfWeek.toISOString();
        const endOfWeekISO = endOfWeek.toISOString();

        // Try to get all orders with scheduled_delivery_date in current week
        // Now supports multiple orders per client (one per delivery day)
        let orders = db.orders.filter(o =>
            o.client_id === clientId &&
            ['pending', 'confirmed', 'processing'].includes(o.status) &&
            o.scheduled_delivery_date >= startOfWeekStr &&
            o.scheduled_delivery_date <= endOfWeekStr
        );

        // If no orders found, try by created_at or last_updated
        if (orders.length === 0) {
            orders = db.orders.filter(o => {
                if (o.client_id !== clientId || !['pending', 'confirmed', 'processing'].includes(o.status)) {
                    return false;
                }
                const createdAt = new Date(o.created_at);
                const lastUpdated = new Date(o.last_updated);
                return (createdAt >= startOfWeek && createdAt <= endOfWeek) ||
                    (lastUpdated >= startOfWeek && lastUpdated <= endOfWeek);
            });
        }

        // If no orders found in orders table, check upcoming_orders as fallback
        // This handles cases where orders haven't been processed yet
        if (orders.length === 0) {
            const upcomingOrders = db.upcomingOrders.filter(o =>
                o.client_id === clientId &&
                o.status === 'scheduled'
            );

            if (upcomingOrders.length > 0) {
                // Convert upcoming orders to order format for display
                orders = upcomingOrders.map((uo: any) => ({
                    id: uo.id,
                    client_id: uo.client_id,
                    service_type: uo.service_type,
                    case_id: uo.case_id,
                    status: 'scheduled', // Use 'scheduled' status for upcoming orders
                    last_updated: uo.last_updated,
                    updated_by: uo.updated_by,
                    scheduled_delivery_date: uo.scheduled_delivery_date,
                    created_at: uo.created_at,
                    delivery_distribution: uo.delivery_distribution,
                    total_value: uo.total_value,
                    total_items: uo.total_items,
                    notes: uo.notes,
                    delivery_day: uo.delivery_day, // Include delivery_day if present
                    is_upcoming: true // Flag to indicate this is from upcoming_orders
                }));
            }
        }

        if (orders.length === 0) {
            return null;
        }

        // Sort by created_at descending
        orders.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

        // Fetch reference data (these should already be cached)
        const menuItems = await getMenuItems();
        const vendors = await getVendors();
        const boxTypes = await getBoxTypes();

        // Process all orders
        const processOrder = (order: any) => {
            // Build order configuration object
            const orderConfig: any = {
                id: order.id,
                serviceType: order.service_type,
                caseId: order.case_id,
                status: order.status,
                lastUpdated: order.last_updated,
                updatedBy: order.updated_by,
                scheduledDeliveryDate: order.scheduled_delivery_date,
                createdAt: order.created_at,
                deliveryDistribution: order.delivery_distribution,
                totalValue: order.total_value,
                totalItems: order.total_items,
                notes: order.notes,
                deliveryDay: order.delivery_day, // Include delivery_day if present
                isUpcoming: order.is_upcoming || false // Flag for upcoming orders
            };

            // Determine which tables to query based on whether this is an upcoming order
            const vendorSelections = order.is_upcoming
                ? db.upcomingOrderVendorSelections.filter(vs => vs.upcoming_order_id === order.id)
                : db.orderVendorSelections.filter(vs => vs.order_id === order.id);

            if (order.service_type === 'Food') {
                // Get vendor selections for this order

                if (vendorSelections.length > 0) {
                    orderConfig.vendorSelections = [];
                    for (const vs of vendorSelections) {
                        // Get items for this vendor selection
                        const items = order.is_upcoming
                            ? db.upcomingOrderItems.filter(item => item.upcoming_vendor_selection_id === vs.id)
                            : db.orderItems.filter(item => item.vendor_selection_id === vs.id);
                        const itemsMap: any = {};
                        for (const item of items) {
                            itemsMap[item.menu_item_id] = item.quantity;
                        }

                        orderConfig.vendorSelections.push({
                            vendorId: vs.vendor_id,
                            items: itemsMap
                        });
                    }
                } else {
                    orderConfig.vendorSelections = [];
                }
            } else if (order.service_type === 'Boxes') {
                // Get box selection for this order
                const boxSelection = order.is_upcoming
                    ? db.upcomingOrderBoxSelections.find(bs => bs.upcoming_order_id === order.id)
                    : db.orderBoxSelections.find(bs => bs.order_id === order.id);
                if (boxSelection) {
                    orderConfig.vendorId = boxSelection.vendor_id;
                    orderConfig.boxTypeId = boxSelection.box_type_id;
                    orderConfig.boxQuantity = boxSelection.quantity;

                    // Load items from upcoming_order_items/order_items table (same as food orders)
                    // This follows the same pattern as Food orders: load items directly from items table
                    const boxItems = order.is_upcoming
                        ? db.upcomingOrderItems.filter(
                            item => item.upcoming_order_id === order.id && 
                            !item.upcoming_vendor_selection_id // Box items don't have vendor selections
                          )
                        : db.orderItems.filter(
                            item => item.order_id === order.id && 
                            !item.vendor_selection_id // Box items don't have vendor selections
                          );

                    if (boxItems && boxItems.length > 0) {
                        const items: any = {};
                        const itemPrices: any = {};
                        for (const item of boxItems) {
                            if (item.menu_item_id) {
                                items[item.menu_item_id] = item.quantity;
                                // Store price if available (from custom_price or calculated)
                                if (item.custom_price) {
                                    itemPrices[item.menu_item_id] = parseFloat(item.custom_price.toString());
                                }
                            }
                        }
                        orderConfig.items = items;
                        if (Object.keys(itemPrices).length > 0) {
                            orderConfig.itemPrices = itemPrices;
                        }
                    }
                }
            }

            return orderConfig;
        };

        const processedOrders = orders.map(processOrder);

        // If only one order, return it in the old format for backward compatibility
        if (processedOrders.length === 1) {
            return processedOrders[0];
        }

        // If multiple orders, return them as an object with multiple flag
        return {
            multiple: true,
            orders: processedOrders
        };
    } catch (error) {
        console.error('Error in getActiveOrderForClientLocal:', error);
        return null;
    }
}

// Get upcoming order for client from local DB
export async function getUpcomingOrderForClientLocal(clientId: string, caseId?: string | null) {
    if (!clientId) return null;

    try {
        // Check if sync is needed and trigger background sync
        if (await needsSync()) {
            triggerSyncInBackground();
        }

        const db = await readLocalDB();

        // Get all scheduled upcoming orders for this client
        // If caseId is provided, filter by both client_id and case_id (for Boxes service type)
        let upcomingOrders = db.upcomingOrders
            .filter(o => {
                const matchesClient = o.client_id === clientId;
                const matchesStatus = o.status === 'scheduled';
                const matchesCaseId = caseId ? o.case_id === caseId : true;
                return matchesClient && matchesStatus && matchesCaseId;
            })
            .sort((a, b) => {
                // Sort by scheduled_delivery_date first (if available), then by created_at
                const dateA = a.scheduled_delivery_date ? new Date(a.scheduled_delivery_date).getTime() : 0;
                const dateB = b.scheduled_delivery_date ? new Date(b.scheduled_delivery_date).getTime() : 0;
                if (dateA !== dateB) {
                    return dateB - dateA; // Most recent first
                }
                return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
            });

        if (upcomingOrders.length === 0) {
            return null;
        }

        // Fetch reference data (these should already be cached)
        const menuItems = await getMenuItems();
        const vendors = await getVendors();
        const boxTypes = await getBoxTypes();

        // For Boxes service type, always return the latest single order (first in sorted array)
        // regardless of how many orders exist, as Boxes don't use delivery_day grouping
        const firstOrder = upcomingOrders.length > 0 ? upcomingOrders[0] : null;
        if (firstOrder && firstOrder.service_type === 'Boxes') {
            const data = firstOrder;
            const orderConfig: any = {
                id: data.id,
                serviceType: data.service_type,
                caseId: data.case_id,
                status: data.status,
                lastUpdated: data.last_updated,
                updatedBy: data.updated_by,
                scheduledDeliveryDate: data.scheduled_delivery_date,
                takeEffectDate: data.take_effect_date,
                deliveryDistribution: data.delivery_distribution,
                totalValue: data.total_value,
                totalItems: data.total_items,
                notes: data.notes
            };

            const boxSelection = db.upcomingOrderBoxSelections.find(bs => bs.upcoming_order_id === data.id);
            if (boxSelection) {
                orderConfig.vendorId = boxSelection.vendor_id;
                orderConfig.boxTypeId = boxSelection.box_type_id;
                orderConfig.boxQuantity = boxSelection.quantity;

                // Load items from upcoming_order_items table (same as food orders)
                // This follows the same pattern as Food orders: load items directly from items table
                const boxItems = db.upcomingOrderItems.filter(
                    item => item.upcoming_order_id === data.id && 
                    (item.upcoming_vendor_selection_id === null || item.upcoming_vendor_selection_id === undefined || item.upcoming_vendor_selection_id === '') && // Box items don't have upcoming vendor selections
                    (item.vendor_selection_id === null || item.vendor_selection_id === undefined || item.vendor_selection_id === '') // Box items don't have vendor selections (check both for safety)
                );

                if (boxItems && boxItems.length > 0) {
                    const items: any = {};
                    const itemPrices: any = {};
                    for (const item of boxItems) {
                        if (item.menu_item_id) {
                            items[item.menu_item_id] = item.quantity;
                            // Store price if available (from custom_price or calculated)
                            if (item.custom_price) {
                                itemPrices[item.menu_item_id] = parseFloat(item.custom_price.toString());
                            }
                        }
                    }
                    orderConfig.items = items;
                    if (Object.keys(itemPrices).length > 0) {
                        orderConfig.itemPrices = itemPrices;
                    }
                }
            }
            return orderConfig;
        }

        // If there's only one order and it doesn't have a delivery_day, return it in the old format for backward compatibility
        if (upcomingOrders.length === 1 && !upcomingOrders[0].delivery_day) {
            const data = upcomingOrders[0];
            const orderConfig: any = {
                id: data.id,
                serviceType: data.service_type,
                caseId: data.case_id,
                status: data.status,
                lastUpdated: data.last_updated,
                updatedBy: data.updated_by,
                scheduledDeliveryDate: data.scheduled_delivery_date,
                takeEffectDate: data.take_effect_date,
                deliveryDistribution: data.delivery_distribution,
                totalValue: data.total_value,
                totalItems: data.total_items,
                notes: data.notes
            };

            if (data.service_type === 'Food') {
                const vendorSelections = db.upcomingOrderVendorSelections.filter(vs => vs.upcoming_order_id === data.id);
                if (vendorSelections.length > 0) {
                    orderConfig.vendorSelections = [];
                    for (const vs of vendorSelections) {
                        const items = db.upcomingOrderItems.filter(item => item.upcoming_vendor_selection_id === vs.id);
                        const itemsMap: any = {};
                        for (const item of items) {
                            itemsMap[item.menu_item_id] = item.quantity;
                        }
                        orderConfig.vendorSelections.push({
                            vendorId: vs.vendor_id,
                            items: itemsMap
                        });
                    }
                }
            } else if (data.service_type === 'Boxes') {
                const boxSelection = db.upcomingOrderBoxSelections.find(bs => bs.upcoming_order_id === data.id);
                if (boxSelection) {
                    orderConfig.vendorId = boxSelection.vendor_id;
                    orderConfig.boxTypeId = boxSelection.box_type_id;
                    orderConfig.boxQuantity = boxSelection.quantity;

                    // Load items from upcoming_order_items table (same as food orders)
                    // This follows the same pattern as Food orders: load items directly from items table
                    const boxItems = db.upcomingOrderItems.filter(
                        item => item.upcoming_order_id === data.id && 
                        (item.upcoming_vendor_selection_id === null || item.upcoming_vendor_selection_id === undefined || item.upcoming_vendor_selection_id === '') && // Box items don't have upcoming vendor selections
                        (item.vendor_selection_id === null || item.vendor_selection_id === undefined || item.vendor_selection_id === '') // Box items don't have vendor selections (check both for safety)
                    );

                    if (boxItems && boxItems.length > 0) {
                        const items: any = {};
                        const itemPrices: any = {};
                        for (const item of boxItems) {
                            if (item.menu_item_id) {
                                items[item.menu_item_id] = item.quantity;
                                // Store price if available (from custom_price or calculated)
                                if (item.custom_price) {
                                    itemPrices[item.menu_item_id] = parseFloat(item.custom_price.toString());
                                }
                            }
                        }
                        orderConfig.items = items;
                        if (Object.keys(itemPrices).length > 0) {
                            orderConfig.itemPrices = itemPrices;
                        }
                    }
                }
            }
            return orderConfig;
        }

        // New format: return orders grouped by delivery day
        // Structure: { [deliveryDay]: OrderConfiguration }
        const ordersByDeliveryDay: any = {};

        for (const data of upcomingOrders) {
            const deliveryDay = data.delivery_day || 'default';

            const orderConfig: any = {
                id: data.id,
                serviceType: data.service_type,
                caseId: data.case_id,
                status: data.status,
                lastUpdated: data.last_updated,
                updatedBy: data.updated_by,
                scheduledDeliveryDate: data.scheduled_delivery_date,
                takeEffectDate: data.take_effect_date,
                deliveryDistribution: data.delivery_distribution,
                totalValue: data.total_value,
                totalItems: data.total_items,
                notes: data.notes,
                deliveryDay: deliveryDay
            };

            if (data.service_type === 'Food') {
                const vendorSelections = db.upcomingOrderVendorSelections.filter(vs => vs.upcoming_order_id === data.id);
                if (vendorSelections.length > 0) {
                    orderConfig.vendorSelections = [];
                    for (const vs of vendorSelections) {
                        const items = db.upcomingOrderItems.filter(item => item.upcoming_vendor_selection_id === vs.id);
                        const itemsMap: any = {};
                        for (const item of items) {
                            itemsMap[item.menu_item_id] = item.quantity;
                        }
                        orderConfig.vendorSelections.push({
                            vendorId: vs.vendor_id,
                            items: itemsMap
                        });
                    }
                }
            } else if (data.service_type === 'Boxes') {
                const boxSelection = db.upcomingOrderBoxSelections.find(bs => bs.upcoming_order_id === data.id);
                // console.log('[getUpcomingOrderForClientLocal] Loading Boxes order:', {
                //     upcomingOrderId: data.id,
                //     foundBoxSelection: !!boxSelection,
                //     boxSelectionItems: boxSelection?.items,
                //     boxSelectionItemsType: typeof boxSelection?.items,
                //     boxSelectionItemsKeys: boxSelection?.items ? Object.keys(boxSelection.items) : []
                // });
                if (boxSelection) {
                    orderConfig.vendorId = boxSelection.vendor_id;
                    orderConfig.boxTypeId = boxSelection.box_type_id;
                    orderConfig.boxQuantity = boxSelection.quantity;

                    // Load items from upcoming_order_items table (same as food orders)
                    // This follows the same pattern as Food orders: load items directly from items table
                    const boxItems = db.upcomingOrderItems.filter(
                        item => item.upcoming_order_id === data.id && 
                        (item.upcoming_vendor_selection_id === null || item.upcoming_vendor_selection_id === undefined || item.upcoming_vendor_selection_id === '') && // Box items don't have upcoming vendor selections
                        (item.vendor_selection_id === null || item.vendor_selection_id === undefined || item.vendor_selection_id === '') // Box items don't have vendor selections (check both for safety)
                    );

                    if (boxItems && boxItems.length > 0) {
                        const items: any = {};
                        const itemPrices: any = {};
                        for (const item of boxItems) {
                            if (item.menu_item_id) {
                                items[item.menu_item_id] = item.quantity;
                                // Store price if available (from custom_price or calculated)
                                if (item.custom_price) {
                                    itemPrices[item.menu_item_id] = parseFloat(item.custom_price.toString());
                                }
                            }
                        }
                        orderConfig.items = items;
                        if (Object.keys(itemPrices).length > 0) {
                            orderConfig.itemPrices = itemPrices;
                        }
                    }
                } else {
                    console.warn('[getUpcomingOrderForClientLocal] No box selection found for upcoming order:', data.id);
                }
            }

            ordersByDeliveryDay[deliveryDay] = orderConfig;
        }

        // If only one delivery day, return it directly for backward compatibility
        const deliveryDays = Object.keys(ordersByDeliveryDay);
        if (deliveryDays.length === 1 && deliveryDays[0] === 'default') {
            return ordersByDeliveryDay['default'];
        }

        return ordersByDeliveryDay;
    } catch (error) {
        console.error('Error in getUpcomingOrderForClientLocal:', error);
        return null;
    }
}

