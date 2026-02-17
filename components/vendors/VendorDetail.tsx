'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Vendor, ClientProfile, MenuItem, BoxType, ItemCategory } from '@/lib/types';
import { getVendors, getClients, getMenuItems, getBoxTypes, getCategories } from '@/lib/cached-data';
import { getClientsUnlimited } from '@/lib/actions';
import { getOrdersByVendor, getDriversForDate, getStopNumbersForDeliveryDate, getMealItems, isOrderUnderVendor, updateOrderDeliveryProof, orderHasDeliveryProof, resolveOrderId } from '@/lib/actions';
import { ArrowLeft, Truck, Calendar, Package, CheckCircle, XCircle, Clock, User, DollarSign, ShoppingCart, Download, ChevronDown, ChevronUp, FileText, X, AlertCircle, LogOut, FileSpreadsheet, Loader2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import { generateLabelsPDF, generateLabelsPDFTwoPerCustomer, generateTablePDF } from '@/lib/label-utils';
import { formatFullAddress } from '@/lib/addressHelpers';
import { sortOrdersByDriver } from '@/lib/vendor-export-utils';
import { logout } from '@/lib/auth-actions';
import { getTodayInAppTz, toDateStringInAppTz, toCalendarDateKeyInAppTz } from '@/lib/timezone';
import { getDefaultOrderTemplateCachedSync, getCachedDefaultOrderTemplate } from '@/lib/default-order-template-cache';
import styles from './VendorDetail.module.css';

interface Props {
    vendorId: string;
    isVendorView?: boolean;
    vendor?: Vendor;
    initialOrders?: any[];
}

export function VendorDetail({ vendorId, isVendorView, vendor: initialVendor, initialOrders: serverOrders }: Props) {
    const router = useRouter();
    const [vendor, setVendor] = useState<Vendor | null>(initialVendor || null);
    const [orders, setOrders] = useState<any[]>(serverOrders ?? []);
    const [clients, setClients] = useState<ClientProfile[]>([]);
    const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
    const [boxTypes, setBoxTypes] = useState<BoxType[]>([]);
    const [categories, setCategories] = useState<ItemCategory[]>([]);
    const [mealItems, setMealItems] = useState<{ id: string; name: string; categoryId?: string }[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());

    const [isExporting, setIsExporting] = useState(false);

    // CSV Import Progress State
    const [importProgress, setImportProgress] = useState<{
        isImporting: boolean;
        currentRow: number;
        totalRows: number;
        successCount: number;
        errorCount: number;
        skippedCount: number;
        currentStatus: string;
        errors: string[];
        skipped: string[];
    }>({
        isImporting: false,
        currentRow: 0,
        totalRows: 0,
        successCount: 0,
        errorCount: 0,
        skippedCount: 0,
        currentStatus: '',
        errors: [],
        skipped: []
    });

    useEffect(() => {
        loadData();
    }, [vendorId]);

    async function loadData() {
        setIsLoading(true);
        try {
            const promises: Promise<any>[] = [
                getOrdersByVendor(vendorId),
                getClients(),
                getMenuItems(),
                getBoxTypes(),
                getCategories(),
                getMealItems(),
                getCachedDefaultOrderTemplate('Food')
            ];

            let vendorsResultIndex = -1;
            if (!initialVendor) {
                promises.push(getVendors());
                vendorsResultIndex = 7;
            }

            const results = await Promise.all(promises);
            const ordersData = results[0];
            const clientsData = results[1];
            const menuItemsData = results[2];
            const boxTypesData = results[3];
            const categoriesData = results[4];
            const mealItemsData = results[5];

            if (!initialVendor && vendorsResultIndex !== -1 && results[vendorsResultIndex]) {
                const vendorsData = results[vendorsResultIndex];
                const foundVendor = vendorsData.find((v: Vendor) => v.id === vendorId);
                setVendor(foundVendor || null);
            }
            // Prefer server-fetched orders: only replace if we got a non-empty array (avoid client action returning [] and wiping server data)
            if (Array.isArray(ordersData) && ordersData.length > 0) {
                setOrders(ordersData);
                // Debug: log raw dates from getOrdersByVendor to compare with Orders View
                const sample = ordersData.slice(0, 5).map((o: any) => ({
                    id: o.id,
                    raw: o.scheduled_delivery_date,
                    inEastern: o.scheduled_delivery_date ? toCalendarDateKeyInAppTz(o.scheduled_delivery_date) ?? null : null,
                }));
                console.log("[VendorDetail] loadData orders:", { count: ordersData.length, sample });
            } else if (Array.isArray(serverOrders) && serverOrders.length > 0) {
                setOrders(serverOrders);
            } else if (Array.isArray(ordersData)) {
                setOrders(ordersData);
            }
            setClients(clientsData);
            setMenuItems(menuItemsData);
            setBoxTypes(boxTypesData);
            setCategories(categoriesData ?? []);
            setMealItems(mealItemsData ?? []);
        } catch (error) {
            console.error('Error loading vendor data:', error);
        } finally {
            setIsLoading(false);
        }
    }

    function getClientName(clientId: string) {
        const client = clients.find(c => c.id === clientId);
        return client?.fullName || 'Unknown Client';
    }

    function getClientAddress(clientId: string) {
        const client = clients.find(c => c.id === clientId);
        if (!client) return '-';
        const full = formatFullAddress({ address: client.address, apt: client.apt, city: client.city, state: client.state, zip: client.zip });
        return full || client.address || '-';
    }

    function getClientPhone(clientId: string) {
        const client = clients.find(c => c.id === clientId);
        return client?.phoneNumber || '-';
    }

    function formatDate(dateString: string | null | undefined) {
        if (!dateString) return '-';
        try {
            // YYYY-MM-DD is parsed as UTC midnight by new Date(), shifting the day in Eastern.
            // Use noon UTC so the calendar day is correct in app timezone regardless of user's locale.
            const d = /^\d{4}-\d{2}-\d{2}$/.test(String(dateString).trim())
                ? new Date(dateString + 'T12:00:00.000Z')
                : new Date(dateString);
            return d.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                timeZone: 'America/New_York'
            });
        } catch {
            return dateString;
        }
    }

    function formatDateTime(dateString: string | null | undefined) {
        if (!dateString) return '-';
        try {
            return new Date(dateString).toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                timeZone: 'America/New_York'
            });
        } catch {
            return dateString;
        }
    }

    function toggleOrderExpansion(orderId: string) {
        const newExpanded = new Set(expandedOrders);
        if (newExpanded.has(orderId)) {
            newExpanded.delete(orderId);
        } else {
            newExpanded.add(orderId);
        }
        setExpandedOrders(newExpanded);
    }


    function groupOrdersByDeliveryDate(ordersList: any[]) {
        const grouped: { [key: string]: any[] } = {};
        const noDate: any[] = [];

        ordersList.forEach(order => {
            const deliveryDate = order.scheduled_delivery_date;
            if (deliveryDate) {
                // Date-only from DB must be used as-is; new Date("YYYY-MM-DD") is UTC midnight and shifts day in Eastern
                const dateKey = toCalendarDateKeyInAppTz(deliveryDate) ?? deliveryDate;
                if (!grouped[dateKey]) {
                    grouped[dateKey] = [];
                }
                grouped[dateKey].push(order);
            } else {
                noDate.push(order);
            }
        });

        // Sort dates in descending order (most recent first)
        const sortedDates = Object.keys(grouped).sort((a, b) => {
            return new Date(b).getTime() - new Date(a).getTime();
        });

        // Debug: log grouping so we can compare with Orders View date
        const sampleByDate = Object.fromEntries(
            sortedDates.slice(0, 5).map((k) => [k, grouped[k]?.slice(0, 2).map((o: any) => ({ id: o.id, raw: o.scheduled_delivery_date, dateKey: toCalendarDateKeyInAppTz(o.scheduled_delivery_date) })) ?? []])
        );
        console.log("[VendorDetail] groupOrdersByDeliveryDate:", {
            totalOrders: ordersList.length,
            sortedDates,
            countsByDate: Object.fromEntries(sortedDates.map((k) => [k, grouped[k]?.length ?? 0])),
            sampleRawDates: sampleByDate,
        });

        return { grouped, sortedDates, noDate };
    }

    function getMenuItemName(itemId: string) {
        const item = menuItems.find(mi => mi.id === itemId);
        return item?.name || 'Unknown Item';
    }

    function getBoxTypeName(boxTypeId: string) {
        const boxType = boxTypes.find(bt => bt.id === boxTypeId);
        return boxType?.name || 'Unknown Box Type';
    }

    function getCategoryName(categoryId: string | null | undefined): string {
        if (!categoryId) return '';
        const cat = categories.find(c => c.id === categoryId);
        return cat?.name ?? '';
    }

    /** Resolve Food order item name: custom_name, menu_item (menu_items), meal_item (breakfast_items), or fallback */
    function getFoodItemDisplayName(item: any): string {
        const custom = item?.custom_name && String(item.custom_name).trim();
        if (custom) return custom;
        if (item?.menu_item_id) {
            const menuItem = menuItems.find(mi => mi.id === item.menu_item_id);
            if (menuItem?.name) return menuItem.name;
        }
        if (item?.meal_item_id) {
            const mealItem = mealItems.find(m => m.id === item.meal_item_id);
            if (mealItem?.name) return mealItem.name;
        }
        return item?.menuItemName || 'Unknown Item';
    }

    /** Category for a Food order item (menu item or meal item) */
    function getFoodItemCategory(item: any): string {
        if (item?.menu_item_id) {
            const menuItem = menuItems.find(mi => mi.id === item.menu_item_id);
            return getCategoryName(menuItem?.categoryId ?? undefined);
        }
        if (item?.meal_item_id) {
            const mealItem = mealItems.find(m => m.id === item.meal_item_id);
            return getCategoryName(mealItem?.categoryId ?? undefined);
        }
        return '';
    }

    /** Line items for Client Breakdown and Cooking List: { itemName, quantity, category, notes } */
    function getOrderLineItems(order: any): { itemName: string; quantity: number; category: string; notes: string }[] {
        const rows: { itemName: string; quantity: number; category: string; notes: string }[] = [];
        if (order.service_type === 'Food') {
            const raw = order.items;
            // Support both array (from order_items/upcoming_order_items) and object (itemId -> quantity)
            if (Array.isArray(raw) && raw.length > 0) {
                raw.forEach((item: any) => {
                    const itemName = getFoodItemDisplayName(item);
                    const quantity = parseInt(item.quantity || 0);
                    const category = getFoodItemCategory(item);
                    const notes = (item.notes ?? '') || '';
                    rows.push({ itemName, quantity, category, notes });
                });
            } else if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
                const itemEntries = Object.entries(raw);
                for (const [itemId, qtyOrObj] of itemEntries) {
                    let qty = 0;
                    if (typeof qtyOrObj === 'number') qty = qtyOrObj;
                    else if (qtyOrObj != null && typeof qtyOrObj === 'object' && 'quantity' in (qtyOrObj as object)) qty = Number((qtyOrObj as any).quantity) || 0;
                    else qty = Number(qtyOrObj) || 0;
                    if (qty <= 0) continue;
                    const menuItem = menuItems.find(mi => mi.id === itemId);
                    const mealItem = mealItems.find(m => m.id === itemId);
                    const itemName = menuItem?.name ?? mealItem?.name ?? 'Unknown Item';
                    const category = getCategoryName(menuItem?.categoryId ?? mealItem?.categoryId ?? undefined);
                    rows.push({ itemName, quantity: qty, category, notes: '' });
                }
            }
        } else if (order.service_type === 'Boxes') {
            const boxSelection = order.boxSelection;
            if (!boxSelection) return rows;
            const items = boxSelection.items || {};
            const itemEntries = Object.entries(items);
            const boxTypeName = getBoxTypeName(boxSelection.box_type_id);
            for (const [itemId, quantityOrObj] of itemEntries) {
                let qty = 0;
                if (typeof quantityOrObj === 'number') qty = quantityOrObj;
                else if (quantityOrObj && typeof quantityOrObj === 'object' && 'quantity' in quantityOrObj) {
                    qty = typeof (quantityOrObj as any).quantity === 'number' ? (quantityOrObj as any).quantity : parseInt((quantityOrObj as any).quantity) || 0;
                } else qty = parseInt(String(quantityOrObj)) || 0;
                if (qty <= 0) continue;
                const menuItem = menuItems.find(mi => mi.id === itemId);
                const itemName = menuItem?.name || 'Unknown Item';
                rows.push({ itemName, quantity: qty, category: boxTypeName, notes: '' });
            }
        } else if (order.service_type === 'Equipment') {
            const eq = order.equipmentSelection;
            if (eq) {
                rows.push({
                    itemName: eq.equipmentName || 'Unknown Equipment',
                    quantity: 1,
                    category: 'Equipment',
                    notes: eq.price != null ? `$${Number(eq.price).toFixed(2)}` : ''
                });
            }
        }
        return rows;
    }

    function renderOrderItems(order: any) {
        if (order.service_type === 'Food') {
            // Food orders - items from order_items or upcoming_order_items
            const items = order.items || [];

            if (items.length === 0) {
                return <div className={styles.noItems}>No items found for this order</div>;
            }

            return (
                <div className={styles.itemsList}>
                    <div className={styles.itemsHeader}>
                        <span style={{ minWidth: '300px', flex: 3 }}>Item Name</span>
                        <span style={{ minWidth: '100px', flex: 1 }}>Quantity</span>
                    </div>
                    {items.map((item: any, index: number) => {
                        const quantity = parseInt(item.quantity || 0);
                        const itemKey = item.id || `${order.id}-item-${index}`;

                        return (
                            <div key={itemKey} className={styles.itemRow}>
                                <span style={{ minWidth: '300px', flex: 3 }}>
                                    {getFoodItemDisplayName(item)}
                                </span>
                                <span style={{ minWidth: '100px', flex: 1 }}>{quantity}</span>
                            </div>
                        );
                    })}
                </div>
            );
        } else if (order.service_type === 'Boxes') {
            // Box orders - items from box_selections.items JSONB
            const boxSelection = order.boxSelection;
            if (!boxSelection) {
                return <div className={styles.noItems}>No box selection found for this order</div>;
            }

            const items = boxSelection.items || {};
            const itemEntries = Object.entries(items);

            // Filter out entries with zero quantity to avoid showing empty items
            const validItemEntries = itemEntries.filter(([itemId, quantityOrObj]: [string, any]) => {
                let qty = 0;
                if (typeof quantityOrObj === 'number') {
                    qty = quantityOrObj;
                } else if (quantityOrObj && typeof quantityOrObj === 'object' && 'quantity' in quantityOrObj) {
                    qty = typeof quantityOrObj.quantity === 'number' ? quantityOrObj.quantity : parseInt(quantityOrObj.quantity) || 0;
                } else {
                    qty = parseInt(quantityOrObj) || 0;
                }
                return qty > 0;
            });

            if (validItemEntries.length === 0) {
                return (
                    <div className={styles.noItems}>
                        Box Type: {getBoxTypeName(boxSelection.box_type_id)} (Quantity: {boxSelection.quantity || 1})
                    </div>
                );
            }

            return (
                <div className={styles.itemsList}>
                    <div style={{ marginBottom: '0.5rem', padding: '0.5rem', background: 'var(--bg-app)', borderRadius: 'var(--radius-sm)' }}>
                        <strong>Box Type:</strong> {getBoxTypeName(boxSelection.box_type_id)} |
                        <strong style={{ marginLeft: '1rem' }}>Quantity:</strong> {boxSelection.quantity || 1}
                    </div>
                    <div className={styles.itemsHeader}>
                        <span style={{ minWidth: '300px', flex: 3 }}>Item Name</span>
                        <span style={{ minWidth: '100px', flex: 1 }}>Quantity</span>
                    </div>
                    {validItemEntries.map(([itemId, quantityOrObj]: [string, any]) => {
                        const menuItem = menuItems.find(mi => mi.id === itemId);

                        // Handle both formats: { itemId: quantity } or { itemId: { quantity: X, price: Y } }
                        let qty = 0;
                        if (typeof quantityOrObj === 'number') {
                            // Simple format: just a number
                            qty = quantityOrObj;
                        } else if (quantityOrObj && typeof quantityOrObj === 'object' && 'quantity' in quantityOrObj) {
                            // Complex format: { quantity: X, price?: Y }
                            qty = typeof quantityOrObj.quantity === 'number' ? quantityOrObj.quantity : parseInt(quantityOrObj.quantity) || 0;
                        } else {
                            // Try to parse as number string
                            qty = parseInt(quantityOrObj) || 0;
                        }

                        return (
                            <div key={itemId} className={styles.itemRow}>
                                <span style={{ minWidth: '300px', flex: 3 }}>
                                    {menuItem?.name || 'Unknown Item'}
                                </span>
                                <span style={{ minWidth: '100px', flex: 1 }}>{qty}</span>
                            </div>
                        );
                    })}
                </div>
            );
        } else if (order.service_type === 'Equipment') {
            // Equipment orders - details from equipmentSelection or notes
            let equipmentDetails = order.equipmentSelection;

            // If not in equipmentSelection, try to parse from notes
            if (!equipmentDetails && order.notes) {
                try {
                    const parsed = JSON.parse(order.notes);
                    if (parsed.equipmentName) {
                        equipmentDetails = parsed;
                    }
                } catch (e) {
                    console.error('Error parsing equipment order notes:', e);
                }
            }

            if (!equipmentDetails) {
                return <div className={styles.noItems}>No equipment details found for this order</div>;
            }

            return (
                <div className={styles.itemsList}>
                    <div className={styles.itemsHeader}>
                        <span style={{ minWidth: '300px', flex: 3 }}>Equipment Name</span>
                        <span style={{ minWidth: '100px', flex: 1 }}>Price</span>
                    </div>
                    <div className={styles.itemRow}>
                        <span style={{ minWidth: '300px', flex: 3 }}>
                            {equipmentDetails.equipmentName || 'Unknown Equipment'}
                        </span>
                        <span style={{ minWidth: '100px', flex: 1 }}>
                            ${(equipmentDetails.price || 0).toFixed(2)}
                        </span>
                    </div>
                </div>
            );
        }

        return <div className={styles.noItems}>No items available for service type: {order.service_type || 'Unknown'}</div>;
    }

    function escapeCSV(value: any): string {
        if (value === null || value === undefined) return '';
        const stringValue = String(value);
        // If value contains comma, newline, or quote, wrap in quotes and escape quotes
        if (stringValue.includes(',') || stringValue.includes('\n') || stringValue.includes('"')) {
            return `"${stringValue.replace(/"/g, '""')}"`;
        }
        return stringValue;
    }

    /** Format order items for CSV/labels. Only source of truth: order (order.items / boxSelection / equipmentSelection). */
    function formatOrderedItemsForCSVWithClient(order: any, client: ClientProfile | undefined): string {
        if (order.service_type === 'Food') {
            const items = order.items || [];
            if (items.length > 0) {
                return items.map((item: any) => {
                    const itemName = getFoodItemDisplayName(item);
                    const quantity = parseInt(item.quantity || 0);
                    return `${itemName} (Qty: ${quantity})`;
                }).join('; ');
            }
            return 'No items';
        } else if (order.service_type === 'Boxes') {
            // Box orders - items from box_selections.items JSONB
            const boxSelection = order.boxSelection;
            if (!boxSelection) {
                return 'No box selection';
            }
            const items = boxSelection.items || {};
            const itemEntries = Object.entries(items);

            // Filter out entries with zero quantity and handle both formats
            const validItemEntries = itemEntries.filter(([itemId, quantityOrObj]: [string, any]) => {
                let qty = 0;
                if (typeof quantityOrObj === 'number') {
                    qty = quantityOrObj;
                } else if (quantityOrObj && typeof quantityOrObj === 'object' && 'quantity' in quantityOrObj) {
                    qty = typeof quantityOrObj.quantity === 'number' ? quantityOrObj.quantity : parseInt(quantityOrObj.quantity) || 0;
                } else {
                    qty = parseInt(quantityOrObj) || 0;
                }
                return qty > 0;
            });

            if (validItemEntries.length === 0) {
                const boxTypeName = getBoxTypeName(boxSelection.box_type_id);
                return `Box Type: ${boxTypeName} (Quantity: ${boxSelection.quantity || 1})`;
            }
            const boxTypeName = getBoxTypeName(boxSelection.box_type_id);
            const itemStrings = validItemEntries.map(([itemId, quantityOrObj]: [string, any]) => {
                const menuItem = menuItems.find(mi => mi.id === itemId);
                const itemName = menuItem?.name || 'Unknown Item';

                // Handle both formats: { itemId: quantity } or { itemId: { quantity: X, price: Y } }
                let qty = 0;
                if (typeof quantityOrObj === 'number') {
                    qty = quantityOrObj;
                } else if (quantityOrObj && typeof quantityOrObj === 'object' && 'quantity' in quantityOrObj) {
                    qty = typeof quantityOrObj.quantity === 'number' ? quantityOrObj.quantity : parseInt(quantityOrObj.quantity) || 0;
                } else {
                    qty = parseInt(quantityOrObj) || 0;
                }

                return `${itemName} (Qty: ${qty})`;
            });
            return `Box Type: ${boxTypeName} (Box Qty: ${boxSelection.quantity || 1}); Items: ${itemStrings.join('; ')}`;
        } else if (order.service_type === 'Equipment') {
            // Equipment orders - details from equipmentSelection or notes
            let equipmentDetails = order.equipmentSelection;

            // If not in equipmentSelection, try to parse from notes
            if (!equipmentDetails && order.notes) {
                try {
                    const parsed = JSON.parse(order.notes);
                    if (parsed.equipmentName) {
                        equipmentDetails = parsed;
                    }
                } catch (e) {
                    console.error('Error parsing equipment order notes:', e);
                }
            }

            if (!equipmentDetails) {
                return 'No equipment details';
            }

            return `${equipmentDetails.equipmentName || 'Unknown Equipment'} - $${(equipmentDetails.price || 0).toFixed(2)}`;
        }
        return 'No items available';
    }

    function formatOrderedItemsForCSV(order: any): string {
        return formatOrderedItemsForCSVWithClient(order, clients.find(c => c.id === order.client_id));
    }

    async function exportOrdersToCSV() {
        if (orders.length === 0) {
            alert('No orders to export');
            return;
        }
        const clientsForExport = await getClientsUnlimited();
        const clientById = new Map(clientsForExport.map(c => [c.id, c]));
        const getClientNameForExport = (id: string) => clientById.get(id)?.fullName || 'Unknown Client';

        // Define CSV headers (standardized for all order types)
        const headers = [
            'Order Number',
            'Order ID',
            'Client ID',
            'Client Name',
            'Scheduled Delivery Date',
            'Total Items',
            'Ordered Items',
            'Delivery Proof URL'
        ];

        // Convert orders to CSV rows (use full client list for item fallbacks)
        const rows = orders.map(order => [
            order.orderNumber || '',
            order.id || '',
            order.client_id || '',
            getClientNameForExport(order.client_id),
            order.scheduled_delivery_date || '',
            order.total_items || 0,
            formatOrderedItemsForCSVWithClient(order, clientById.get(order.client_id)),
            order.delivery_proof_url || ''
        ]);

        // Combine headers and rows
        const csvContent = [
            headers.map(escapeCSV).join(','),
            ...rows.map(row => row.map(escapeCSV).join(','))
        ].join('\n');

        // Create blob and download
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `${vendor?.name || 'vendor'}_orders_${getTodayInAppTz()}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    async function exportOrdersByDateToCSV(dateKey: string, dateOrders: any[]) {
        if (dateOrders.length === 0) {
            alert('No orders to export for this date');
            return;
        }
        const clientsForExport = await getClientsUnlimited();
        const { sortedOrders, driverIdToNumber } = await getSortedOrdersForDate(dateKey, dateOrders, clientsForExport);
        const clientById = new Map(clientsForExport.map(c => [c.id, c]));
        const deliveryDateForStop = dateKey === 'no-date' ? null : dateKey;
        const clientIdToStopNumber = deliveryDateForStop ? await getStopNumbersForDeliveryDate(deliveryDateForStop) : {};
        const getDriverStop = (order: any) => {
            const client = clientById.get(order.client_id);
            const driverId = client?.assignedDriverId ? String(client.assignedDriverId) : null;
            const driverNum = driverId != null ? driverIdToNumber[driverId] : null;
            const stopNum = clientIdToStopNumber[order.client_id];
            if (driverNum != null && stopNum != null) return `${driverNum} - ${stopNum}`;
            if (driverNum != null) return String(driverNum);
            return '';
        };
        const getClientNameForExport = (id: string) => clientById.get(id)?.fullName || 'Unknown Client';

        const headers = [
            'Driver - Stop',
            'Order Number',
            'Order ID',
            'Client ID',
            'Client Name',
            'Scheduled Delivery Date',
            'Total Items',
            'Ordered Items',
            'Delivery Proof URL'
        ];

        const rows = sortedOrders.map(order => [
            getDriverStop(order),
            order.orderNumber || '',
            order.id || '',
            order.client_id || '',
            getClientNameForExport(order.client_id),
            order.scheduled_delivery_date || '',
            order.total_items || 0,
            formatOrderedItemsForCSVWithClient(order, clientById.get(order.client_id)),
            order.delivery_proof_url || ''
        ]);

        // Combine headers and rows
        const csvContent = [
            headers.map(escapeCSV).join(','),
            ...rows.map(row => row.map(escapeCSV).join(','))
        ].join('\n');

        // Create blob and download
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        const formattedDate = dateKey === 'no-date'
            ? 'no_delivery_date'
            : formatDate(dateKey).replace(/\s/g, '_');
        link.setAttribute('href', url);
        link.setAttribute('download', `${vendor?.name || 'vendor'}_orders_${formattedDate}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    function getDateSuffix(dateKey: string): string {
        return dateKey === 'no-date' ? 'no_delivery_date' : formatDate(dateKey).replace(/\s/g, '_');
    }

    /** Get orders sorted by driver then stop number (1.1, 1.2, …) for consistent exports. */
    async function getSortedOrdersForDate(dateKey: string, dateOrders: any[], clientsOverride?: ClientProfile[]) {
        if (dateOrders.length === 0) {
            return { sortedOrders: [], driverIdToNumber: {} as Record<string, number>, driverIdToColor: {} as Record<string, string> };
        }
        const deliveryDate = dateKey === 'no-date' ? null : dateKey;
        const drivers = await getDriversForDate(deliveryDate);
        const clientIdToStopNumber = deliveryDate ? await getStopNumbersForDeliveryDate(deliveryDate) : undefined;
        const clientsToUse = clientsOverride?.length ? clientsOverride : clients;
        const { sortedOrders, driverIdToNumber, driverIdToColor } = sortOrdersByDriver(dateOrders, clientsToUse, drivers, clientIdToStopNumber);
        return { sortedOrders, driverIdToNumber, driverIdToColor };
    }

    /** Client Breakdown - blocks per order with line items. Optional getDriverStop adds Driver - Stop as 2nd column (like labels). */
    const BREAKDOWN_CHECK = '☐';
    const BREAKDOWN_LINE = '---';
    function buildClientBreakdownSheet(
        dateOrders: any[],
        getClientNameFn?: (id: string) => string,
        getClientAddressFn?: (id: string) => string,
        getDriverStopFn?: (order: any) => string
    ): string[][] {
        const getName = getClientNameFn ?? getClientName;
        const getAddress = getClientAddressFn ?? getClientAddress;
        const hasDriverStop = typeof getDriverStopFn === 'function';
        const withDriverStop = (row: string[], driverStop: string) =>
            hasDriverStop ? [row[0], driverStop, ...row.slice(1)] : row;
        const rows: string[][] = [];
        dateOrders.forEach((order, idx) => {
            const driverStop = hasDriverStop ? (getDriverStopFn!(order) || '') : '';
            const clientName = getName(order.client_id);
            const address = getAddress(order.client_id);
            rows.push(withDriverStop(['', clientName, '', '', address], driverStop));
            rows.push(withDriverStop(['', '', '', '', ''], driverStop));
            rows.push(withDriverStop(['', 'Item Name', 'Quantity', 'Category', 'Notes'], driverStop));
            const lineItems = getOrderLineItems(order);
            lineItems.forEach(li => rows.push(withDriverStop([BREAKDOWN_CHECK, li.itemName, String(li.quantity), li.category, li.notes], driverStop)));
            if (idx < dateOrders.length - 1) {
                const lineRow = [BREAKDOWN_LINE, BREAKDOWN_LINE, BREAKDOWN_LINE, BREAKDOWN_LINE, BREAKDOWN_LINE];
                rows.push(withDriverStop(lineRow, BREAKDOWN_LINE));
            }
        });
        return rows;
    }

    /** Cooking List - Item Name, Total Quantity, Notes (grouped by name+notes) */
    function buildCookingListSheet(dateOrders: any[]): string[][] {
        const map = new Map<string, number>(); // key = itemName + \t + notes
        dateOrders.forEach(order => {
            getOrderLineItems(order).forEach(li => {
                const key = `${li.itemName}\t${li.notes}`;
                map.set(key, (map.get(key) ?? 0) + li.quantity);
            });
        });
        const headers = ['Item Name', 'Total Quantity', 'Notes'];
        const rows = Array.from(map.entries()).map(([key, total]) => {
            const [itemName, notes] = key.split('\t');
            return [itemName, String(total), notes ?? ''];
        }).sort((a, b) => (a[0] || '').localeCompare(b[0] || ''));
        return [headers, ...rows];
    }

    function downloadExcelWorkbook(wb: XLSX.WorkBook, filename: string) {
        const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = filename;
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
    }

    async function exportExcelForDate(dateKey: string, dateOrders: any[], which: 'breakdown' | 'cooking' | 'combined') {
        if (dateOrders.length === 0) {
            alert('No orders to export for this date');
            return;
        }
        setIsExporting(true);
        try {
        const clientsForExport = await getClientsUnlimited();
        const { sortedOrders, driverIdToNumber } = await getSortedOrdersForDate(dateKey, dateOrders, clientsForExport);
        const clientById = new Map(clientsForExport.map(c => [c.id, c]));
        const deliveryDateForStop = dateKey === 'no-date' ? null : dateKey;
        const clientIdToStopNumber = deliveryDateForStop ? await getStopNumbersForDeliveryDate(deliveryDateForStop) : {};
        const getDriverStop = (order: any) => {
            const client = clientById.get(order.client_id);
            const driverId = client?.assignedDriverId ? String(client.assignedDriverId) : null;
            const driverNum = driverId != null ? driverIdToNumber[driverId] : null;
            const stopNum = clientIdToStopNumber[order.client_id];
            if (driverNum != null && stopNum != null) return `${driverNum} - ${stopNum}`;
            if (driverNum != null) return String(driverNum);
            return '';
        };
        const getClientNameForExport = (id: string) => clientById.get(id)?.fullName || 'Unknown Client';
        const getClientAddressForExport = (id: string) => {
            const c = clientById.get(id);
            if (!c) return '-';
            const full = formatFullAddress({ address: c.address, apt: c.apt, city: c.city, state: c.state, zip: c.zip });
            return full || c.address || '-';
        };
        const suffix = getDateSuffix(dateKey);
        const baseName = `${vendor?.name || 'vendor'}_orders_${suffix}`;

        if (which === 'combined') {
            const wb = XLSX.utils.book_new();
            const ws2 = XLSX.utils.aoa_to_sheet(buildClientBreakdownSheet(sortedOrders, getClientNameForExport, getClientAddressForExport, getDriverStop));
            const ws3 = XLSX.utils.aoa_to_sheet(buildCookingListSheet(sortedOrders));
            XLSX.utils.book_append_sheet(wb, ws2, 'Client Breakdown');
            XLSX.utils.book_append_sheet(wb, ws3, 'Cooking List');
            downloadExcelWorkbook(wb, `${baseName}_combined.xlsx`);
            return;
        }

        if (which === 'breakdown') {
            const ws = XLSX.utils.aoa_to_sheet(buildClientBreakdownSheet(sortedOrders, getClientNameForExport, getClientAddressForExport, getDriverStop));
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Client Breakdown');
            downloadExcelWorkbook(wb, `${baseName}_breakdown.xlsx`);
        } else if (which === 'cooking') {
            const ws = XLSX.utils.aoa_to_sheet(buildCookingListSheet(sortedOrders));
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Cooking List');
            downloadExcelWorkbook(wb, `${baseName}_cooking.xlsx`);
        }
        } finally {
            setIsExporting(false);
        }
    }

    async function exportBreakdownPDFForDate(dateKey: string, dateOrders: any[]) {
        if (dateOrders.length === 0) {
            alert('No orders to export for this date');
            return;
        }
        setIsExporting(true);
        try {
        const clientsForExport = await getClientsUnlimited();
        const { sortedOrders, driverIdToNumber } = await getSortedOrdersForDate(dateKey, dateOrders, clientsForExport);
        const clientById = new Map(clientsForExport.map(c => [c.id, c]));
        const deliveryDateForStop = dateKey === 'no-date' ? null : dateKey;
        const clientIdToStopNumber = deliveryDateForStop ? await getStopNumbersForDeliveryDate(deliveryDateForStop) : {};
        const getDriverStop = (order: any) => {
            const client = clientById.get(order.client_id);
            const driverId = client?.assignedDriverId ? String(client.assignedDriverId) : null;
            const driverNum = driverId != null ? driverIdToNumber[driverId] : null;
            const stopNum = clientIdToStopNumber[order.client_id];
            if (driverNum != null && stopNum != null) return `${driverNum} - ${stopNum}`;
            if (driverNum != null) return String(driverNum);
            return '';
        };
        const getClientNameForExport = (id: string) => clientById.get(id)?.fullName || 'Unknown Client';
        const getClientAddressForExport = (id: string) => {
            const c = clientById.get(id);
            if (!c) return '-';
            const full = formatFullAddress({ address: c.address, apt: c.apt, city: c.city, state: c.state, zip: c.zip });
            return full || c.address || '-';
        };
        const suffix = getDateSuffix(dateKey);
        const baseName = `${vendor?.name || 'vendor'}_orders_${suffix}_breakdown`;
        generateTablePDF({
            title: `Client Breakdown – ${dateKey === 'no-date' ? 'No Delivery Date' : formatDate(dateKey)}`,
            rows: buildClientBreakdownSheet(sortedOrders, getClientNameForExport, getClientAddressForExport, getDriverStop),
            filename: `${baseName}.pdf`,
            columnWidths: [7, 9, 38, 14, 18, 14],
            lineRowMarker: BREAKDOWN_LINE,
            checkboxMarker: BREAKDOWN_CHECK
        });
        } finally {
            setIsExporting(false);
        }
    }

    async function exportCookingPDFForDate(dateKey: string, dateOrders: any[]) {
        if (dateOrders.length === 0) {
            alert('No orders to export for this date');
            return;
        }
        setIsExporting(true);
        try {
        const clientsForExport = await getClientsUnlimited();
        const { sortedOrders } = await getSortedOrdersForDate(dateKey, dateOrders, clientsForExport);
        const suffix = getDateSuffix(dateKey);
        const baseName = `${vendor?.name || 'vendor'}_orders_${suffix}_cooking`;
        generateTablePDF({
            title: `Cooking List – ${dateKey === 'no-date' ? 'No Delivery Date' : formatDate(dateKey)}`,
            rows: buildCookingListSheet(sortedOrders),
            filename: `${baseName}.pdf`,
            columnWidths: [50, 25, 25]
        });
        } finally {
            setIsExporting(false);
        }
    }

    async function exportLabelsPDFForDate(dateKey: string, dateOrders: any[]) {
        if (dateOrders.length === 0) {
            alert('No orders to export for this date');
            return;
        }
        setIsExporting(true);
        try {
        // Re-fetch full orders for this date so labels always have complete order data (items, boxSelection, etc.)
        // Use API route when we have a date to avoid server-action response size/serialization issues with items
        let freshOrders: any[];
        if (dateKey === 'no-date') {
            freshOrders = (await getOrdersByVendor(vendorId)).filter((o: any) => !o.scheduled_delivery_date);
        } else {
            const res = await fetch(`/api/vendors/${encodeURIComponent(vendorId)}/orders?date=${encodeURIComponent(dateKey)}`, { credentials: 'include' });
            if (!res.ok) throw new Error('Failed to fetch orders for export');
            freshOrders = await res.json();
        }
        if (freshOrders.length === 0) {
            alert('No orders to export for this date');
            return;
        }
        // Use getClientsUnlimited to bypass 1000-row limit and avoid "Unknown Client" on exports
        const clientsForExport = await getClientsUnlimited();
        const { sortedOrders, driverIdToNumber, driverIdToColor } = await getSortedOrdersForDate(dateKey, freshOrders, clientsForExport);
        const clientById = new Map(clientsForExport.map(c => [c.id, c]));
        const deliveryDateForStopNum = dateKey === 'no-date' ? null : dateKey;
        const clientIdToStopNumber = deliveryDateForStopNum ? await getStopNumbersForDeliveryDate(deliveryDateForStopNum) : {};
        const getClientNameForExport = (clientId: string) => clientById.get(clientId)?.fullName || 'Unknown Client';
        const getClientAddressForExport = (clientId: string) => {
            const c = clientById.get(clientId);
            if (!c) return '-';
            const full = formatFullAddress({ address: c.address, apt: c.apt, city: c.city, state: c.state, zip: c.zip });
            return full || c.address || '-';
        };
        await generateLabelsPDF({
            orders: sortedOrders,
            getClientName: getClientNameForExport,
            getClientAddress: getClientAddressForExport,
            formatOrderedItemsForCSV: (order) => formatOrderedItemsForCSVWithClient(order, clientById.get(order.client_id)),
            formatDate,
            vendorName: vendor?.name,
            deliveryDate: dateKey === 'no-date' ? undefined : dateKey,
            getDriverInfo: (order) => {
                const client = clientById.get(order.client_id);
                const driverId = client?.assignedDriverId ? String(client.assignedDriverId) : null;
                if (!driverId || driverIdToNumber[driverId] == null || !driverIdToColor[driverId]) return null;
                const stopNumber = clientIdToStopNumber[order.client_id];
                return {
                    driverNumber: driverIdToNumber[driverId],
                    driverColor: driverIdToColor[driverId],
                    ...(stopNumber != null && { stopNumber })
                };
            }
        });
        } finally {
            setIsExporting(false);
        }
    }

    /** Alternate Download Labels — separate code path for customization. Modify this function independently. */
    async function exportLabelsPDFForDateAlt(dateKey: string, dateOrders: any[]) {
        if (dateOrders.length === 0) {
            alert('No orders to export for this date');
            return;
        }
        setIsExporting(true);
        try {
            // Re-fetch full orders for this date (use API to avoid server-action serialization issues with items)
            let freshOrdersAlt: any[];
            if (dateKey === 'no-date') {
                freshOrdersAlt = (await getOrdersByVendor(vendorId)).filter((o: any) => !o.scheduled_delivery_date);
            } else {
                const res = await fetch(`/api/vendors/${encodeURIComponent(vendorId)}/orders?date=${encodeURIComponent(dateKey)}`, { credentials: 'include' });
                if (!res.ok) throw new Error('Failed to fetch orders for export');
                freshOrdersAlt = await res.json();
            }
            if (freshOrdersAlt.length === 0) {
                alert('No orders to export for this date');
                return;
            }
            const clientsForExport = await getClientsUnlimited();
            const { sortedOrders, driverIdToNumber, driverIdToColor } = await getSortedOrdersForDate(dateKey, freshOrdersAlt, clientsForExport);
            const clientById = new Map(clientsForExport.map(c => [c.id, c]));
            const deliveryDateForStopNum = dateKey === 'no-date' ? null : dateKey;
            const clientIdToStopNumber = deliveryDateForStopNum ? await getStopNumbersForDeliveryDate(deliveryDateForStopNum) : {};
            const getClientNameForExport = (clientId: string) => clientById.get(clientId)?.fullName || 'Unknown Client';
            const getClientAddressForExport = (clientId: string) => {
            const c = clientById.get(clientId);
            if (!c) return '-';
            const full = formatFullAddress({ address: c.address, apt: c.apt, city: c.city, state: c.state, zip: c.zip });
            return full || c.address || '-';
        };
            await generateLabelsPDFTwoPerCustomer({
                orders: sortedOrders,
                getClientName: getClientNameForExport,
                getClientAddress: getClientAddressForExport,
                formatOrderedItemsForCSV: (order) => formatOrderedItemsForCSVWithClient(order, clientById.get(order.client_id)),
                formatDate,
                vendorName: vendor?.name,
                deliveryDate: dateKey === 'no-date' ? undefined : dateKey,
                getDriverInfo: (order) => {
                    const client = clientById.get(order.client_id);
                    const driverId = client?.assignedDriverId ? String(client.assignedDriverId) : null;
                    if (!driverId || driverIdToNumber[driverId] == null || !driverIdToColor[driverId]) return null;
                    const stopNumber = clientIdToStopNumber[order.client_id];
                    return {
                        driverNumber: driverIdToNumber[driverId],
                        driverColor: driverIdToColor[driverId],
                        ...(stopNumber != null && { stopNumber })
                    };
                },
                getNotes: (clientId) => clientById.get(clientId)?.dislikes ?? ''
            });
        } finally {
            setIsExporting(false);
        }
    }

    async function handleCSVImportForDate(event: React.ChangeEvent<HTMLInputElement>, dateKey: string) {
        const file = event.target.files?.[0];
        if (!file) return;

        // Reset input
        event.target.value = '';

        if (!file.name.endsWith('.csv')) {
            alert('Please select a CSV file');
            return;
        }

        try {
            const text = await file.text();
            const lines = text.split(/\r?\n/).filter(line => line.trim());

            if (lines.length < 2) {
                alert('CSV file must have at least a header row and one data row');
                return;
            }

            // Parse header row
            const headers = parseCSVRow(lines[0]);
            // Normalize header names for flexible matching (case-insensitive, handle spaces/underscores)
            const normalizedHeaders = headers.map(h => h.toLowerCase().replace(/[_\s]/g, ''));
            const orderIdIndex = normalizedHeaders.findIndex(h => h === 'orderid' || h === 'ordernumber');
            const deliveryProofUrlIndex = normalizedHeaders.findIndex(h => h === 'deliveryproofurl');

            if (orderIdIndex === -1) {
                alert('CSV file must contain an "Order ID" or "Order Number" column');
                return;
            }

            if (deliveryProofUrlIndex === -1) {
                alert('CSV file must contain a "Delivery Proof URL" or "delivery_proof_url" column');
                return;
            }

            const totalRows = lines.length - 1; // Exclude header row

            // Initialize progress state
            setImportProgress({
                isImporting: true,
                currentRow: 0,
                totalRows: totalRows,
                successCount: 0,
                errorCount: 0,
                skippedCount: 0,
                currentStatus: 'Starting import...',
                errors: [],
                skipped: []
            });

            // Process each data row
            let successCount = 0;
            let errorCount = 0;
            let skippedCount = 0;
            const errors: string[] = [];
            const skipped: string[] = [];

            for (let i = 1; i < lines.length; i++) {
                const row = parseCSVRow(lines[i]);
                const orderIdentifier = row[orderIdIndex]?.trim();
                const deliveryProofUrl = row[deliveryProofUrlIndex]?.trim();

                // Update progress - current row
                setImportProgress(prev => ({
                    ...prev,
                    currentRow: i,
                    currentStatus: `Processing row ${i} of ${totalRows}...`
                }));

                if (!orderIdentifier) {
                    errorCount++;
                    const errorMsg = `Row ${i + 1}: Missing Order ID or Order Number`;
                    errors.push(errorMsg);
                    setImportProgress(prev => ({
                        ...prev,
                        errorCount,
                        errors: [...prev.errors, errorMsg]
                    }));
                    continue;
                }

                if (!deliveryProofUrl) {
                    errorCount++;
                    const errorMsg = `Row ${i + 1} (Order ${orderIdentifier}): Missing delivery_proof_url`;
                    errors.push(errorMsg);
                    setImportProgress(prev => ({
                        ...prev,
                        errorCount,
                        errors: [...prev.errors, errorMsg]
                    }));
                    continue;
                }

                // Resolve order ID from order number or UUID
                setImportProgress(prev => ({
                    ...prev,
                    currentStatus: `Row ${i}: Looking up order ${orderIdentifier}...`
                }));
                const orderId = await resolveOrderId(orderIdentifier);
                if (!orderId) {
                    errorCount++;
                    const errorMsg = `Row ${i + 1} (Order ${orderIdentifier}): Order not found`;
                    errors.push(errorMsg);
                    setImportProgress(prev => ({
                        ...prev,
                        errorCount,
                        errors: [...prev.errors, errorMsg]
                    }));
                    continue;
                }

                // Check if order belongs to this vendor
                setImportProgress(prev => ({
                    ...prev,
                    currentStatus: `Row ${i}: Verifying order ${orderId}...`
                }));
                const belongsToVendor = await isOrderUnderVendor(orderId, vendorId);
                if (!belongsToVendor) {
                    errorCount++;
                    const errorMsg = `Row ${i + 1} (Order ${orderIdentifier}): Order does not belong to this vendor`;
                    errors.push(errorMsg);
                    setImportProgress(prev => ({
                        ...prev,
                        errorCount,
                        errors: [...prev.errors, errorMsg]
                    }));
                    continue;
                }

                // Check if order matches the delivery date
                const order = orders.find(o => o.id === orderId);
                if (order) {
                    if (dateKey === 'no-date') {
                        // For 'no-date', check that order has no scheduled_delivery_date
                        if (order.scheduled_delivery_date) {
                            errorCount++;
                            const errorMsg = `Row ${i + 1} (Order ${orderIdentifier}): Order has a delivery date, but was imported for "No Delivery Date"`;
                            errors.push(errorMsg);
                            setImportProgress(prev => ({
                                ...prev,
                                errorCount,
                                errors: [...prev.errors, errorMsg]
                            }));
                            continue;
                        }
                    } else {
                        // For specific dates, check that order matches the date
                        const orderDateKey = order.scheduled_delivery_date
                            ? (toCalendarDateKeyInAppTz(order.scheduled_delivery_date) ?? null)
                            : null;
                        if (orderDateKey !== dateKey) {
                            errorCount++;
                            const errorMsg = `Row ${i + 1} (Order ${orderIdentifier}): Order does not match the selected delivery date`;
                            errors.push(errorMsg);
                            setImportProgress(prev => ({
                                ...prev,
                                errorCount,
                                errors: [...prev.errors, errorMsg]
                            }));
                            continue;
                        }
                    }
                }

                // Check if order already has a delivery proof URL (skip if it does)
                setImportProgress(prev => ({
                    ...prev,
                    currentStatus: `Row ${i}: Checking order ${orderId}...`
                }));
                const alreadyHasProof = await orderHasDeliveryProof(orderId);
                if (alreadyHasProof) {
                    skippedCount++;
                    const skippedMsg = `Row ${i + 1} (Order ${orderIdentifier}): Already has delivery proof URL, skipping`;
                    skipped.push(skippedMsg);
                    setImportProgress(prev => ({
                        ...prev,
                        skippedCount,
                        skipped: [...prev.skipped, skippedMsg]
                    }));
                    continue;
                }

                // Update order with delivery proof URL and set status to completed (delivered)
                setImportProgress(prev => ({
                    ...prev,
                    currentStatus: `Row ${i}: Updating order ${orderId}...`
                }));
                const result = await updateOrderDeliveryProof(orderId, deliveryProofUrl);
                if (result.success) {
                    successCount++;
                    setImportProgress(prev => ({
                        ...prev,
                        successCount
                    }));
                } else {
                    errorCount++;
                    const errorMsg = `Row ${i + 1} (Order ${orderIdentifier}): ${result.error || 'Failed to update order'}`;
                    errors.push(errorMsg);
                    setImportProgress(prev => ({
                        ...prev,
                        errorCount,
                        errors: [...prev.errors, errorMsg]
                    }));
                }
            }

            // Mark import as complete
            setImportProgress(prev => ({
                ...prev,
                isImporting: false,
                currentStatus: 'Import completed!'
            }));

            // Reload orders to reflect changes
            if (successCount > 0) {
                await loadData();
            }
        } catch (error: any) {
            console.error('Error importing CSV:', error);
            setImportProgress(prev => ({
                ...prev,
                isImporting: false,
                currentStatus: `Error: ${error.message || 'Unknown error'}`
            }));
        }
    }

    function parseCSVRow(row: string): string[] {
        const result: string[] = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < row.length; i++) {
            const char = row[i];
            const nextChar = row[i + 1];

            if (char === '"') {
                if (inQuotes && nextChar === '"') {
                    current += '"';
                    i++; // Skip next quote
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                result.push(current);
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current); // Push last field
        return result;
    }

    async function handleCSVImport(event: React.ChangeEvent<HTMLInputElement>) {
        const file = event.target.files?.[0];
        if (!file) return;

        // Reset input
        event.target.value = '';

        if (!file.name.endsWith('.csv')) {
            alert('Please select a CSV file');
            return;
        }

        try {
            const text = await file.text();
            const lines = text.split(/\r?\n/).filter(line => line.trim());

            if (lines.length < 2) {
                alert('CSV file must have at least a header row and one data row');
                return;
            }

            // Parse header row
            const headers = parseCSVRow(lines[0]);
            // Normalize header names for flexible matching (case-insensitive, handle spaces/underscores)
            const normalizedHeaders = headers.map(h => h.toLowerCase().replace(/[_\s]/g, ''));
            const orderIdIndex = normalizedHeaders.findIndex(h => h === 'orderid' || h === 'ordernumber');
            const deliveryProofUrlIndex = normalizedHeaders.findIndex(h => h === 'deliveryproofurl');

            if (orderIdIndex === -1) {
                alert('CSV file must contain an "Order ID" or "Order Number" column');
                return;
            }

            if (deliveryProofUrlIndex === -1) {
                alert('CSV file must contain a "Delivery Proof URL" or "delivery_proof_url" column');
                return;
            }

            const totalRows = lines.length - 1; // Exclude header row

            // Initialize progress state
            setImportProgress({
                isImporting: true,
                currentRow: 0,
                totalRows: totalRows,
                successCount: 0,
                errorCount: 0,
                skippedCount: 0,
                currentStatus: 'Starting import...',
                errors: [],
                skipped: []
            });

            // Process each data row
            let successCount = 0;
            let errorCount = 0;
            let skippedCount = 0;
            const errors: string[] = [];
            const skipped: string[] = [];

            for (let i = 1; i < lines.length; i++) {
                const row = parseCSVRow(lines[i]);
                const orderId = row[orderIdIndex]?.trim();
                const deliveryProofUrl = row[deliveryProofUrlIndex]?.trim();

                // Update progress - current row
                setImportProgress(prev => ({
                    ...prev,
                    currentRow: i,
                    currentStatus: `Processing row ${i} of ${totalRows}...`
                }));

                if (!orderId) {
                    errorCount++;
                    const errorMsg = `Row ${i + 1}: Missing Order ID`;
                    errors.push(errorMsg);
                    setImportProgress(prev => ({
                        ...prev,
                        errorCount,
                        errors: [...prev.errors, errorMsg]
                    }));
                    continue;
                }

                if (!deliveryProofUrl) {
                    errorCount++;
                    const errorMsg = `Row ${i + 1} (Order ${orderId}): Missing delivery_proof_url`;
                    errors.push(errorMsg);
                    setImportProgress(prev => ({
                        ...prev,
                        errorCount,
                        errors: [...prev.errors, errorMsg]
                    }));
                    continue;
                }

                // Check if order belongs to this vendor
                setImportProgress(prev => ({
                    ...prev,
                    currentStatus: `Row ${i}: Verifying order ${orderId}...`
                }));
                const belongsToVendor = await isOrderUnderVendor(orderId, vendorId);
                if (!belongsToVendor) {
                    errorCount++;
                    const errorMsg = `Row ${i + 1} (Order ${orderId}): Order does not belong to this vendor`;
                    errors.push(errorMsg);
                    setImportProgress(prev => ({
                        ...prev,
                        errorCount,
                        errors: [...prev.errors, errorMsg]
                    }));
                    continue;
                }

                // Check if order already has a delivery proof URL (skip if it does)
                setImportProgress(prev => ({
                    ...prev,
                    currentStatus: `Row ${i}: Checking order ${orderId}...`
                }));
                const alreadyHasProof = await orderHasDeliveryProof(orderId);
                if (alreadyHasProof) {
                    skippedCount++;
                    const skippedMsg = `Row ${i + 1} (Order ${orderId}): Already has delivery proof URL, skipping`;
                    skipped.push(skippedMsg);
                    setImportProgress(prev => ({
                        ...prev,
                        skippedCount,
                        skipped: [...prev.skipped, skippedMsg]
                    }));
                    continue;
                }

                // Update order with delivery proof URL and set status to completed (delivered)
                setImportProgress(prev => ({
                    ...prev,
                    currentStatus: `Row ${i}: Updating order ${orderId}...`
                }));
                const result = await updateOrderDeliveryProof(orderId, deliveryProofUrl);
                if (result.success) {
                    successCount++;
                    setImportProgress(prev => ({
                        ...prev,
                        successCount
                    }));
                } else {
                    errorCount++;
                    const errorMsg = `Row ${i + 1} (Order ${orderId}): ${result.error || 'Failed to update order'}`;
                    errors.push(errorMsg);
                    setImportProgress(prev => ({
                        ...prev,
                        errorCount,
                        errors: [...prev.errors, errorMsg]
                    }));
                }
            }

            // Mark import as complete
            setImportProgress(prev => ({
                ...prev,
                isImporting: false,
                currentStatus: 'Import completed!'
            }));

            // Reload orders to reflect changes
            if (successCount > 0) {
                await loadData();
            }
        } catch (error: any) {
            console.error('Error importing CSV:', error);
            setImportProgress(prev => ({
                ...prev,
                isImporting: false,
                currentStatus: `Error: ${error.message || 'Unknown error'}`
            }));
        }
    }

    function closeImportProgress() {
        setImportProgress({
            isImporting: false,
            currentRow: 0,
            totalRows: 0,
            successCount: 0,
            errorCount: 0,
            skippedCount: 0,
            currentStatus: '',
            errors: [],
            skipped: []
        });
    }

    if (isLoading) {
        return (
            <div className={styles.container}>
                {isVendorView && (
                    <div className={styles.header}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flex: 1 }}>
                            <button
                                onClick={() => logout()}
                                className={styles.logoutButton}
                            >
                                <LogOut size={18} />
                                <span>Log Out</span>
                            </button>
                        </div>
                    </div>
                )}
                <div className={styles.loadingContainer}>
                    <div className="spinner"></div>
                    <p>Loading Downloads...</p>
                </div>
            </div>
        );
    }

    if (!vendor) {
        return (
            <div className={styles.container}>
                <div className={styles.header}>
                    {/*{!isVendorView && (*/}
                    {/*    // <button className={styles.backButton} onClick={() => router.push('/vendors')}>*/}
                    {/*    //     <ArrowLeft size={16} /> Back to Vendors*/}
                    {/*    // </button>*/}
                    {/*)}*/}
                    {isVendorView && (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flex: 1 }}>
                            <button
                                onClick={() => logout()}
                                className={styles.logoutButton}
                            >
                                <LogOut size={18} />
                                <span>Log Out</span>
                            </button>
                        </div>
                    )}
                </div>
                <div className={styles.errorMessage}>
                    <p>Vendor not found</p>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                {/*{!isVendorView && (*/}
                {/*    <button className={styles.backButton} onClick={() => router.push('/vendors')}>*/}
                {/*        <ArrowLeft size={16} /> Back to Vendors*/}
                {/*    </button>*/}
                {/*)}*/}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flex: 1 }}>
                    {/*<h1 className={styles.title}>*/}
                    {/*    <Truck size={24} style={{ marginRight: '12px', verticalAlign: 'middle' }} />*/}
                    {/*    {vendor.name}*/}
                    {/*</h1>*/}
                    {isVendorView && (
                        <button
                            onClick={() => logout()}
                            className={styles.logoutButton}
                        >
                            <LogOut size={18} />
                            <span>Log Out</span>
                        </button>
                    )}
                </div>
            </div>

            {/* Orders Section */}
            <div className={styles.ordersSection}>
                {/*<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--spacing-lg)' }}>*/}
                {/*    /!*<h2 className={styles.sectionTitle}>Orders</h2>*!/*/}
                {/*</div>*/}

                {(() => {
                    if (orders.length === 0) {
                        return (
                            <div className={styles.emptyState}>
                                <Package size={48} style={{ color: 'var(--text-tertiary)', marginBottom: '1rem' }} />
                                <p>No orders found for this vendor</p>
                            </div>
                        );
                    }

                    const { grouped, sortedDates, noDate } = groupOrdersByDeliveryDate(orders);

                    return (
                        <div className={styles.ordersList}>
                            <div className={styles.ordersHeader}>
                                <span style={{ width: '40px', flexShrink: 0 }}></span>
                                <span style={{ flex: '2 1 150px', minWidth: 0 }}>Delivery Date</span>
                                <span style={{ flex: '1 1 100px', minWidth: 0 }}>Orders Count</span>
                                <span style={{ flex: '1.2 1 120px', minWidth: 0 }}>Total Items</span>
                                <span style={{ flex: '1.5 1 150px', minWidth: 0 }}>Actions</span>
                            </div>

                            {/* Orders grouped by delivery date */}
                            {sortedDates.map((dateKey) => {
                                const dateOrders = grouped[dateKey];
                                const dateTotalItems = dateOrders.reduce((sum, o) => sum + (o.total_items || 0), 0);

                                return (
                                    <div key={dateKey}>
                                        <div className={styles.orderRow}>
                                            <span style={{ width: '40px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                <Calendar size={16} style={{ color: 'var(--color-primary)' }} />
                                            </span>
                                            <span style={{ flex: '2 1 150px', minWidth: 0, fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                {formatDate(dateKey)}
                                            </span>
                                            <span style={{ flex: '1 1 100px', minWidth: 0 }}>
                                                <span className="badge badge-info">{dateOrders.length} order{dateOrders.length !== 1 ? 's' : ''}</span>
                                            </span>
                                            <span style={{ flex: '1.2 1 120px', minWidth: 0, fontSize: '0.9rem' }}>
                                                {dateTotalItems}
                                            </span>
                                            <span style={{ flex: '1.5 1 150px', minWidth: 0 }}>
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', width: '100%', maxWidth: 320 }}>
                                                    <button className="btn btn-secondary" style={{ width: '100%', fontSize: '0.75rem', padding: '0.35rem 0.5rem' }} disabled={isExporting} onClick={() => exportLabelsPDFForDate(dateKey, dateOrders)}>
                                                        <FileText size={14} /> Download Labels
                                                    </button>
                                                    <button className="btn btn-secondary" style={{ width: '100%', fontSize: '0.75rem', padding: '0.35rem 0.5rem' }} disabled={isExporting} onClick={() => exportLabelsPDFForDateAlt(dateKey, dateOrders)}>
                                                        <FileText size={14} /> Labels – address + order details (2 per customer)
                                                    </button>
                                                    <div style={{ display: 'flex', gap: '0.35rem' }}>
                                                        <button className="btn btn-secondary" style={{ flex: 1, fontSize: '0.75rem', padding: '0.35rem 0.5rem' }} disabled={isExporting} onClick={() => exportExcelForDate(dateKey, dateOrders, 'breakdown')}>
                                                            <FileSpreadsheet size={14} /> Breakdown Excel
                                                        </button>
                                                        <button className="btn btn-secondary" style={{ flex: 1, fontSize: '0.75rem', padding: '0.35rem 0.5rem' }} disabled={isExporting} onClick={() => exportBreakdownPDFForDate(dateKey, dateOrders)}>
                                                            <FileText size={14} /> Breakdown PDF
                                                        </button>
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '0.35rem' }}>
                                                        <button className="btn btn-secondary" style={{ flex: 1, fontSize: '0.75rem', padding: '0.35rem 0.5rem' }} disabled={isExporting} onClick={() => exportExcelForDate(dateKey, dateOrders, 'cooking')}>
                                                            <FileSpreadsheet size={14} /> Cooking Excel
                                                        </button>
                                                        <button className="btn btn-secondary" style={{ flex: 1, fontSize: '0.75rem', padding: '0.35rem 0.5rem' }} disabled={isExporting} onClick={() => exportCookingPDFForDate(dateKey, dateOrders)}>
                                                            <FileText size={14} /> Cooking PDF
                                                        </button>
                                                    </div>
                                                    <button className="btn btn-secondary" style={{ width: '100%', fontSize: '0.75rem', padding: '0.35rem 0.5rem' }} disabled={isExporting} onClick={() => exportExcelForDate(dateKey, dateOrders, 'combined')}>
                                                        <Download size={14} /> Combined Excel
                                                    </button>
                                                </div>
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}

                            {/* Orders without delivery dates */}
                            {noDate.length > 0 && (
                                <div>
                                    <div className={styles.orderRow}>
                                        <span style={{ width: '40px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <Calendar size={16} style={{ color: 'var(--text-tertiary)' }} />
                                        </span>
                                        <span style={{ flex: '2 1 150px', minWidth: 0, fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            No Delivery Date
                                        </span>
                                        <span style={{ flex: '1 1 100px', minWidth: 0 }}>
                                            <span className="badge">{noDate.length} order{noDate.length !== 1 ? 's' : ''}</span>
                                        </span>
                                        <span style={{ flex: '1.2 1 120px', minWidth: 0, fontSize: '0.9rem' }}>
                                            {noDate.reduce((sum, o) => sum + (o.total_items || 0), 0)}
                                        </span>
                                        <span style={{ flex: '1.5 1 150px', minWidth: 0 }}>
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', width: '100%', maxWidth: 320 }}>
                                                <button className="btn btn-secondary" style={{ width: '100%', fontSize: '0.75rem', padding: '0.35rem 0.5rem' }} disabled={isExporting} onClick={() => exportLabelsPDFForDate('no-date', noDate)}>
                                                    <FileText size={14} /> Download Labels
                                                </button>
                                                <button className="btn btn-secondary" style={{ width: '100%', fontSize: '0.75rem', padding: '0.35rem 0.5rem' }} disabled={isExporting} onClick={() => exportLabelsPDFForDateAlt('no-date', noDate)}>
                                                    <FileText size={14} /> Labels – address + order details (2 per customer)
                                                </button>
                                                <div style={{ display: 'flex', gap: '0.35rem' }}>
                                                    <button className="btn btn-secondary" style={{ flex: 1, fontSize: '0.75rem', padding: '0.35rem 0.5rem' }} disabled={isExporting} onClick={() => exportExcelForDate('no-date', noDate, 'breakdown')}>
                                                        <FileSpreadsheet size={14} /> Breakdown Excel
                                                    </button>
                                                    <button className="btn btn-secondary" style={{ flex: 1, fontSize: '0.75rem', padding: '0.35rem 0.5rem' }} disabled={isExporting} onClick={() => exportBreakdownPDFForDate('no-date', noDate)}>
                                                        <FileText size={14} /> Breakdown PDF
                                                    </button>
                                                </div>
                                                <div style={{ display: 'flex', gap: '0.35rem' }}>
                                                    <button className="btn btn-secondary" style={{ flex: 1, fontSize: '0.75rem', padding: '0.35rem 0.5rem' }} disabled={isExporting} onClick={() => exportExcelForDate('no-date', noDate, 'cooking')}>
                                                        <FileSpreadsheet size={14} /> Cooking Excel
                                                    </button>
                                                    <button className="btn btn-secondary" style={{ flex: 1, fontSize: '0.75rem', padding: '0.35rem 0.5rem' }} disabled={isExporting} onClick={() => exportCookingPDFForDate('no-date', noDate)}>
                                                        <FileText size={14} /> Cooking PDF
                                                    </button>
                                                </div>
                                                <button className="btn btn-secondary" style={{ width: '100%', fontSize: '0.75rem', padding: '0.35rem 0.5rem' }} disabled={isExporting} onClick={() => exportExcelForDate('no-date', noDate, 'combined')}>
                                                    <Download size={14} /> Combined Excel
                                                </button>
                                            </div>
                                        </span>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })()}
            </div>

            {/* Export Loading Overlay */}
            {isExporting && (
                <div className={styles.importModalOverlay} style={{ pointerEvents: 'auto' }}>
                    <div className={styles.importModal} style={{ maxWidth: 320 }}>
                        <div className={styles.importModalContent} style={{ alignItems: 'center', gap: '1rem' }}>
                            <Loader2 className="animate-spin" size={40} style={{ color: 'var(--color-primary)' }} />
                            <p style={{ margin: 0, fontWeight: 600, color: 'var(--text-primary)' }}>Generating file...</p>
                            <p style={{ margin: 0, fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Please wait</p>
                        </div>
                    </div>
                </div>
            )}

            {/* CSV Import Progress Modal */}
            {importProgress.isImporting || importProgress.totalRows > 0 ? (
                <div className={styles.importModalOverlay}>
                    <div className={styles.importModal}>
                        <div className={styles.importModalHeader}>
                            <h3>CSV Import Progress</h3>
                            {!importProgress.isImporting && (
                                <button
                                    className={styles.closeButton}
                                    onClick={closeImportProgress}
                                    aria-label="Close"
                                >
                                    <X size={20} />
                                </button>
                            )}
                        </div>

                        <div className={styles.importModalContent}>
                            {/* Progress Bar */}
                            <div className={styles.progressSection}>
                                <div className={styles.progressBarContainer}>
                                    <div
                                        className={styles.progressBar}
                                        style={{
                                            width: `${importProgress.totalRows > 0
                                                ? (importProgress.currentRow / importProgress.totalRows) * 100
                                                : 0}%`
                                        }}
                                    />
                                </div>
                                <div className={styles.progressText}>
                                    {importProgress.currentRow} of {importProgress.totalRows} rows processed
                                    {importProgress.totalRows > 0 && (
                                        <span className={styles.progressPercentage}>
                                            ({Math.round((importProgress.currentRow / importProgress.totalRows) * 100)}%)
                                        </span>
                                    )}
                                </div>
                            </div>

                            {/* Status Message */}
                            <div className={styles.statusMessage}>
                                {importProgress.isImporting ? (
                                    <div className={styles.statusLoading}>
                                        <div className="spinner" style={{ width: '16px', height: '16px', marginRight: '8px' }}></div>
                                        {importProgress.currentStatus}
                                    </div>
                                ) : (
                                    <div className={styles.statusComplete}>
                                        <CheckCircle size={16} style={{ marginRight: '8px', color: 'var(--color-success)' }} />
                                        {importProgress.currentStatus}
                                    </div>
                                )}
                            </div>

                            {/* Statistics */}
                            <div className={styles.importStats}>
                                <div className={styles.statItem}>
                                    <CheckCircle size={16} style={{ color: 'var(--color-success)', marginRight: '6px' }} />
                                    <span className={styles.statLabel}>Success:</span>
                                    <span className={styles.statValue}>{importProgress.successCount}</span>
                                </div>
                                <div className={styles.statItem}>
                                    <AlertCircle size={16} style={{ color: 'var(--color-warning)', marginRight: '6px' }} />
                                    <span className={styles.statLabel}>Skipped:</span>
                                    <span className={styles.statValue}>{importProgress.skippedCount}</span>
                                </div>
                                <div className={styles.statItem}>
                                    <XCircle size={16} style={{ color: 'var(--color-danger)', marginRight: '6px' }} />
                                    <span className={styles.statLabel}>Errors:</span>
                                    <span className={styles.statValue}>{importProgress.errorCount}</span>
                                </div>
                            </div>

                            {/* Errors List */}
                            {importProgress.errors.length > 0 && (
                                <div className={styles.errorsSection}>
                                    <h4 className={styles.errorsTitle}>
                                        <AlertCircle size={16} style={{ marginRight: '8px' }} />
                                        Errors ({importProgress.errors.length})
                                    </h4>
                                    <div className={styles.errorsList}>
                                        {importProgress.errors.slice(0, 10).map((error, idx) => (
                                            <div key={idx} className={styles.errorItem}>{error}</div>
                                        ))}
                                        {importProgress.errors.length > 10 && (
                                            <div className={styles.errorItem}>
                                                ... and {importProgress.errors.length - 10} more error(s)
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* Skipped List */}
                            {importProgress.skipped.length > 0 && (
                                <div className={styles.skippedSection}>
                                    <h4 className={styles.skippedTitle}>
                                        <Clock size={16} style={{ marginRight: '8px' }} />
                                        Skipped ({importProgress.skipped.length})
                                    </h4>
                                    <div className={styles.skippedList}>
                                        {importProgress.skipped.slice(0, 10).map((skip, idx) => (
                                            <div key={idx} className={styles.skippedItem}>{skip}</div>
                                        ))}
                                        {importProgress.skipped.length > 10 && (
                                            <div className={styles.skippedItem}>
                                                ... and {importProgress.skipped.length - 10} more skipped order(s)
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}

