'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Vendor, ClientProfile, MenuItem, BoxType, ItemCategory } from '@/lib/types';
import { getVendors, getClients, getMenuItems, getBoxTypes, getCategories } from '@/lib/cached-data';
import { getOrdersByVendor, getDriversForDate, getStopNumbersForDeliveryDate, getMealItems, saveDeliveryProofUrlAndProcessOrder, updateOrderDeliveryProof, isOrderUnderVendor, orderHasDeliveryProof, resolveOrderId, getClientsUnlimited } from '@/lib/actions';
import { getDefaultOrderTemplateCachedSync, getCachedDefaultOrderTemplate } from '@/lib/default-order-template-cache';
import { ArrowLeft, Calendar, Package, Clock, ShoppingCart, Upload, ChevronDown, ChevronUp, Save, X, CheckCircle, AlertCircle, Download, XCircle, FileText, Loader2 } from 'lucide-react';
import { generateLabelsPDF } from '@/lib/label-utils';
import { formatFullAddress } from '@/lib/addressHelpers';
import { sortOrdersByDriver } from '@/lib/vendor-export-utils';
import { toDateStringInAppTz } from '@/lib/timezone';
import styles from './VendorDetail.module.css';

interface Props {
    vendorId: string;
    deliveryDate: string;
    isVendorView?: boolean;
}

export function VendorDeliveryOrders({ vendorId, deliveryDate, isVendorView }: Props) {
    const router = useRouter();
    const [vendor, setVendor] = useState<Vendor | null>(null);
    const [orders, setOrders] = useState<any[]>([]);
    const [clients, setClients] = useState<ClientProfile[]>([]);
    const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
    const [mealItems, setMealItems] = useState<any[]>([]);
    const [boxTypes, setBoxTypes] = useState<BoxType[]>([]);
    const [categories, setCategories] = useState<ItemCategory[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
    const [proofUrls, setProofUrls] = useState<Record<string, string>>({});
    const [isSaving, setIsSaving] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [displayOrders, setDisplayOrders] = useState<any[]>([]); // Sorted by driver + stop (matches export)
    const [summaryModal, setSummaryModal] = useState<{
        show: boolean;
        results?: Array<{ success: boolean; orderId: string; error?: string; summary?: any }>;
        error?: string;
        summary?: {
            orderId?: string;
            caseId?: string;
            serviceType?: string;
            status?: string;
            wasProcessed?: boolean;
            hasErrors?: boolean;
            errors?: string[];
        };
    }>({ show: false });

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
    }, [vendorId, deliveryDate]);

    async function loadData() {
        setIsLoading(true);
        try {
            // Fetch orders via API when we have a date so items are returned (avoids server-action serialization issues)
            const ordersPromise = deliveryDate
                ? fetch(`/api/vendors/${encodeURIComponent(vendorId)}/orders?date=${encodeURIComponent(deliveryDate)}`, { credentials: 'include' }).then(r => r.ok ? r.json() : [])
                : getOrdersByVendor(vendorId, deliveryDate);
            const [vendorsData, ordersData, clientsData, menuItemsData, mealItemsData, boxTypesData, categoriesData, /* template preloaded */] = await Promise.all([
                getVendors(),
                ordersPromise,
                getClients(),
                getMenuItems(),
                getMealItems(),
                getBoxTypes(),
                getCategories(),
                getCachedDefaultOrderTemplate('Food')
            ]);

            const foundVendor = vendorsData.find(v => v.id === vendorId);
            setVendor(foundVendor || null);

            // Filter orders by delivery date. Match VendorDetail.groupOrdersByDeliveryDate logic:
            // dateKey from URL is already in YYYY-MM-DD (from that grouping); use toDateStringInAppTz for order dates
            const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(deliveryDate) ? deliveryDate : toDateStringInAppTz(new Date(deliveryDate));
            const filteredOrders = (ordersData || []).filter((order: { scheduled_delivery_date?: string | null; id: string }) => {
                if (!order.scheduled_delivery_date) return false;
                const orderDateKey = toDateStringInAppTz(new Date(order.scheduled_delivery_date));
                return orderDateKey === dateKey;
            });

            // Expand all orders by default so items are visible
            const allOrderKeys = new Set<string>(filteredOrders.map((order: { orderType?: string; id: string }) => `${order.orderType ?? ''}-${order.id}`));
            setExpandedOrders(allOrderKeys);

            setOrders(filteredOrders);
            setClients(clientsData);
            setMenuItems(menuItemsData);
            setMealItems(mealItemsData || []);
            setBoxTypes(boxTypesData);
            setCategories(categoriesData);

            // Initialize proof URLs from orders
            const initialProofUrls: Record<string, string> = {};
            filteredOrders.forEach((order: { id: string; delivery_proof_url?: string | null }) => {
                if (order.delivery_proof_url) {
                    initialProofUrls[order.id] = order.delivery_proof_url;
                }
            });
            setProofUrls(initialProofUrls);

            if (filteredOrders.length > 0 && clientsData?.length) {
                const drivers = await getDriversForDate(deliveryDate);
                const clientIdToStopNumber = deliveryDate ? await getStopNumbersForDeliveryDate(deliveryDate) : undefined;
                const { sortedOrders } = sortOrdersByDriver(filteredOrders, clientsData, drivers, clientIdToStopNumber);
                setDisplayOrders(sortedOrders);
            } else {
                setDisplayOrders(filteredOrders);
            }
        } catch (error) {
            console.error('Error loading vendor delivery orders:', error);
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
            return new Date(dateString).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                timeZone: 'America/New_York'
            });
        } catch {
            return dateString;
        }
    }

    /** Get orders sorted by driver then stop number (1.1, 1.2, …). Optional clientsOverride when state clients is empty. */
    async function getSortedOrders(clientsOverride?: ClientProfile[], ordersOverride?: any[]) {
        const ordersToUse = ordersOverride ?? orders;
        if (ordersToUse.length === 0) {
            return { sortedOrders: [], driverIdToNumber: {} as Record<string, number>, driverIdToColor: {} as Record<string, string> };
        }
        const drivers = await getDriversForDate(deliveryDate);
        const clientIdToStopNumber = deliveryDate ? await getStopNumbersForDeliveryDate(deliveryDate) : undefined;
        const clientsToUse = clientsOverride?.length ? clientsOverride : clients;
        const { sortedOrders, driverIdToNumber, driverIdToColor } = sortOrdersByDriver(ordersToUse, clientsToUse, drivers, clientIdToStopNumber);
        return { sortedOrders, driverIdToNumber, driverIdToColor };
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
                    const menuItem = menuItems.find(mi => mi.id === item.menu_item_id);
                    const mealItem = mealItems.find(m => m.id === item.meal_item_id);
                    const itemName = menuItem?.name ?? mealItem?.name ?? item.custom_name ?? item.menuItemName ?? 'Unknown Item';
                    const quantity = parseInt(item.quantity || 0);
                    return `${itemName} (Qty: ${quantity})`;
                }).join('; ');
            }
            return 'No items';
        } else if (order.service_type === 'Boxes') {
            const boxSelection = order.boxSelection;
            if (!boxSelection) {
                return 'No box selection';
            }
            const items = boxSelection.items || {};
            const itemEntries = Object.entries(items);

            // Process items and filter out zero-quantity items, group by category
            const itemsByCategory: { [categoryId: string]: string[] } = {};
            const uncategorizedItems: string[] = [];

            for (const [itemId, quantityOrObj] of itemEntries) {
                const menuItem = menuItems.find(mi => mi.id === itemId);
                const customName = quantityOrObj && typeof quantityOrObj === 'object' && (quantityOrObj as any).custom_name ? (quantityOrObj as any).custom_name : undefined;
                const itemName = menuItem?.name || customName || 'Unknown Item';

                // Handle both formats: { itemId: quantity } or { itemId: { quantity: X, price: Y } }
                let qty = 0;
                if (typeof quantityOrObj === 'number') {
                    qty = quantityOrObj;
                } else if (quantityOrObj && typeof quantityOrObj === 'object' && 'quantity' in quantityOrObj) {
                    qty = typeof quantityOrObj.quantity === 'number' ? quantityOrObj.quantity : parseInt(String(quantityOrObj.quantity)) || 0;
                } else {
                    qty = parseInt(String(quantityOrObj)) || 0;
                }

                if (qty > 0) {
                    const itemString = `${itemName} (Qty: ${qty})`;
                    const categoryId = menuItem?.categoryId || null;

                    if (categoryId) {
                        if (!itemsByCategory[categoryId]) {
                            itemsByCategory[categoryId] = [];
                        }
                        itemsByCategory[categoryId].push(itemString);
                    } else {
                        uncategorizedItems.push(itemString);
                    }
                }
            }

            const boxQuantity = boxSelection.quantity || 1;
            const parts: string[] = [];

            // Add items by category
            const sortedCategoryIds = Object.keys(itemsByCategory).sort((a, b) => {
                const catA = categories.find(c => c.id === a);
                const catB = categories.find(c => c.id === b);
                return (catA?.name || '').localeCompare(catB?.name || '');
            });

            for (const categoryId of sortedCategoryIds) {
                const category = categories.find(c => c.id === categoryId);
                const categoryName = category?.name || 'Unknown Category';
                parts.push(`${categoryName}: ${itemsByCategory[categoryId].join(', ')}`);
            }

            if (uncategorizedItems.length > 0) {
                parts.push(`Uncategorized: ${uncategorizedItems.join(', ')}`);
            }

            if (parts.length === 0) {
                return '(No items)';
            }

            return parts.join('; ');
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

            return equipmentDetails.equipmentName || 'Unknown Equipment';
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
        setIsExporting(true);
        try {
        const clientsForExport = await getClientsUnlimited();
        const { sortedOrders, driverIdToNumber } = await getSortedOrders(clientsForExport);
        const clientById = new Map(clientsForExport.map(c => [c.id, c]));
        const clientIdToStopNumber = deliveryDate ? await getStopNumbersForDeliveryDate(deliveryDate) : {};
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
        const getClientPhoneForExport = (id: string) => clientById.get(id)?.phoneNumber || '-';

        const headers = [
            'Driver - Stop',
            'Order Number',
            'Order ID',
            'Client ID',
            'Client Name',
            'Address',
            'Phone',
            'Scheduled Delivery Date',
            'Total Items',
            'Ordered Items',
            'Delivery Proof URL'
        ];

        const rows = sortedOrders.map((order: any) => [
            getDriverStop(order),
            order.orderNumber || '',
            order.id || '',
            order.client_id || '',
            getClientNameForExport(order.client_id),
            getClientAddressForExport(order.client_id),
            getClientPhoneForExport(order.client_id),
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
        const formattedDate = formatDate(deliveryDate).replace(/\s/g, '_');
        link.setAttribute('href', url);
        link.setAttribute('download', `${vendor?.name || 'vendor'}_orders_${formattedDate}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        } finally {
            setIsExporting(false);
        }
    }

    async function exportLabelsPDF() {
        if (orders.length === 0) {
            alert('No orders to export');
            return;
        }
        setIsExporting(true);
        try {
        // Re-fetch full orders via API so items are included (avoids server-action serialization issues)
        const res = await fetch(`/api/vendors/${encodeURIComponent(vendorId)}/orders?date=${encodeURIComponent(deliveryDate)}`, { credentials: 'include' });
        if (!res.ok) throw new Error('Failed to fetch orders for export');
        const freshOrders = await res.json();
        if (freshOrders.length === 0) {
            alert('No orders to export');
            return;
        }
        const clientsForExport = await getClientsUnlimited();
        const { sortedOrders, driverIdToNumber, driverIdToColor } = await getSortedOrders(clientsForExport, freshOrders);
        const clientById = new Map(clientsForExport.map(c => [c.id, c]));
        const clientIdToStopNumber = deliveryDate ? await getStopNumbersForDeliveryDate(deliveryDate) : {};
        const getClientNameForExport = (clientId: string) => clientById.get(clientId)?.fullName || 'Unknown Client';
        const getClientAddressForExport = (clientId: string) => {
            const c = clientById.get(clientId);
            if (!c) return '-';
            const full = formatFullAddress({ address: c.address, apt: c.apt, city: c.city, state: c.state, zip: c.zip });
            return full || c.address || '-';
        };
        const isComplex = (order: { client_id: string }) => !!(clientById.get(order.client_id)?.complex);
        const ordersNonComplex = sortedOrders.filter(o => !isComplex(o));
        const ordersComplex = sortedOrders.filter(o => isComplex(o));
        const commonOpts = {
            getClientName: getClientNameForExport,
            getClientAddress: getClientAddressForExport,
            formatOrderedItemsForCSV: (order: typeof sortedOrders[0]) => formatOrderedItemsForCSVWithClient(order, clientById.get(order.client_id)),
            formatDate,
            vendorName: vendor?.name,
            deliveryDate,
            getDriverInfo: (order: typeof sortedOrders[0]) => {
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
            getNotes: (clientId: string) => clientById.get(clientId)?.dislikes ?? ''
        };
        if (ordersNonComplex.length > 0) {
            await generateLabelsPDF({ ...commonOpts, orders: ordersNonComplex });
        }
        if (ordersComplex.length > 0) {
            await generateLabelsPDF({ ...commonOpts, orders: ordersComplex, filenameSuffix: '_complex' });
        }
        } finally {
            setIsExporting(false);
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
                // Note: In delivery view, we're strict about the date.
                const order = orders.find(o => o.id === orderId);
                // If it's not in the current orders list, it might be for another date but same vendor.
                // But for safety, we generally only want to update detailed proofs for what we see.
                // However, the user might have a massive CSV.
                // Let's rely on the fact that if it's not in 'orders', we might want to still process it if it's valid?
                // Actually, let's restrict to current view to match the export.
                // Or better, check the date if we can or just proceed if it's the vendor's order.
                // The implementation in VendorDetail checks date. Let's do the same.

                if (order) {
                    const orderDateKey = order.scheduled_delivery_date
                        ? toDateStringInAppTz(new Date(order.scheduled_delivery_date))
                        : null;
                    const pageDateKey = /^\d{4}-\d{2}-\d{2}$/.test(deliveryDate) ? deliveryDate : toDateStringInAppTz(new Date(deliveryDate));

                    if (orderDateKey !== pageDateKey) {
                        errorCount++;
                        const errorMsg = `Row ${i + 1} (Order ${orderIdentifier}): Order date ${orderDateKey} does not match page date ${pageDateKey}`;
                        errors.push(errorMsg);
                        setImportProgress(prev => ({
                            ...prev,
                            errorCount,
                            errors: [...prev.errors, errorMsg]
                        }));
                        continue;
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

    async function handleBulkSave() {
        // Get all orders with URLs entered
        const ordersToSave = orders.filter(order => {
            const url = proofUrls[order.id];
            return url && url.trim() && url.trim() !== (order.delivery_proof_url || '');
        });

        if (ordersToSave.length === 0) {
            alert('No delivery proof URLs to save. Please enter at least one URL.');
            return;
        }

        setIsSaving(true);
        const results: Array<{ success: boolean; orderId: string; orderType: string; error?: string; summary?: any }> = [];

        try {
            // Process all orders sequentially to avoid race conditions
            for (const order of ordersToSave) {
                try {
                    const url = proofUrls[order.id]?.trim() || '';
                    const res = await saveDeliveryProofUrlAndProcessOrder(
                        order.id,
                        order.orderType || 'completed',
                        url
                    );

                    results.push({
                        success: res.success,
                        orderId: order.id,
                        orderType: order.orderType || 'completed',
                        error: res.success ? undefined : (res.error || 'Unknown error'),
                        summary: res.summary
                    });
                } catch (error: any) {
                    results.push({
                        success: false,
                        orderId: order.id,
                        orderType: order.orderType || 'completed',
                        error: error?.message || 'Failed to save delivery proof URL'
                    });
                }
            }

            // Reload data after all saves
            await loadData();

            // Show summary modal with all results
            setSummaryModal({
                show: true,
                results: results
            });
        } catch (error: any) {
            console.error('Error during bulk save:', error);
            setSummaryModal({
                show: true,
                error: error?.message || 'Failed to save delivery proof URLs'
            });
        } finally {
            setIsSaving(false);
        }
    }

    function getCategoryName(categoryId: string | null | undefined) {
        if (!categoryId) return 'Uncategorized';
        const category = categories.find(c => c.id === categoryId);
        return category?.name || 'Uncategorized';
    }

    function renderOrderItems(order: any) {
        if (order.service_type === 'Food') {
            const items = order.items || [];

            if (!items || items.length === 0) {
                return (
                    <div className={styles.noItems} style={{
                        padding: 'var(--spacing-md)',
                        textAlign: 'center',
                        color: 'var(--text-tertiary)',
                        fontStyle: 'italic',
                        backgroundColor: 'var(--bg-app)',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border-color)'
                    }}>
                        No items found for this order. Order ID: {order.id}
                    </div>
                );
            }

            // Calculate totals
            let totalItems = 0;
            items.forEach((item: any) => {
                const qty = parseInt(item.quantity || 0);
                totalItems += qty;
            });

            return (
                <div className={styles.vendorSection}>
                    <table className={styles.itemsTable}>
                        <thead>
                            <tr>
                                <th>Item</th>
                                <th>Quantity</th>
                            </tr>
                        </thead>
                        <tbody>
                            {items.map((item: any, index: number) => {
                                const menuItem = menuItems.find(mi => mi.id === item.menu_item_id);
                                const quantity = parseInt(item.quantity || 0);
                                const itemKey = item.id || `${order.id}-item-${index}`;
                                const itemDisplayName = menuItem?.name || item.custom_name || item.menuItemName || 'Unknown Item';

                                return (
                                    <tr key={itemKey}>
                                        <td>{itemDisplayName}</td>
                                        <td>{quantity}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    <div className={styles.orderSummary}>
                        <div><strong>Total Items:</strong> {totalItems}</div>
                    </div>
                </div>
            );
        } else if (order.service_type === 'Boxes') {
            const boxSelection = order.boxSelection;

            if (!boxSelection) {
                return (
                    <div className={styles.noItems} style={{
                        padding: 'var(--spacing-md)',
                        textAlign: 'center',
                        color: 'var(--text-tertiary)',
                        fontStyle: 'italic',
                        backgroundColor: 'var(--bg-app)',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border-color)'
                    }}>
                        No box selection found for this order. Order ID: {order.id}
                    </div>
                );
            }

            // Handle items - could be object, JSON string, null, undefined, or array
            let items: any = boxSelection.items;
            if (!items) {
                items = {};
            } else if (typeof items === 'string') {
                // If items is a JSON string, parse it
                try {
                    items = JSON.parse(items);
                } catch (e) {
                    console.error('Failed to parse boxSelection.items as JSON:', e);
                    items = {};
                }
            } else if (Array.isArray(items)) {
                // If items is an array, convert to object format { itemId: quantity } or { itemId: { quantity, custom_name? } }
                const itemsObj: any = {};
                for (const item of items) {
                    if (item && typeof item === 'object' && 'menu_item_id' in item) {
                        const qty = item.quantity || 0;
                        if (item.custom_name) {
                            itemsObj[item.menu_item_id] = { quantity: qty, custom_name: item.custom_name };
                        } else {
                            itemsObj[item.menu_item_id] = qty;
                        }
                    } else if (item && typeof item === 'object' && 'id' in item) {
                        const qty = item.quantity || item.qty || 1;
                        if (item.custom_name) {
                            itemsObj[item.id] = { quantity: qty, custom_name: item.custom_name };
                        } else {
                            itemsObj[item.id] = qty;
                        }
                    }
                }
                items = itemsObj;
            }

            const itemEntries = Object.entries(items || {});

            const boxQuantity = boxSelection.quantity || 1;

            // Process items and filter out zero-quantity items, group by category
            const itemsByCategory: { [categoryId: string]: Array<{ itemId: string; menuItem: MenuItem | undefined; qty: number; customName?: string }> } = {};
            const uncategorizedItems: Array<{ itemId: string; menuItem: MenuItem | undefined; qty: number; customName?: string }> = [];
            let totalItems = 0;

            for (const [itemId, quantityOrObj] of itemEntries) {
                // Handle both formats: { itemId: quantity } or { itemId: { quantity: X, price?: Y, custom_name?: Z } }
                let qty = 0;
                const customName = quantityOrObj && typeof quantityOrObj === 'object' && (quantityOrObj as any).custom_name ? (quantityOrObj as any).custom_name : undefined;

                if (typeof quantityOrObj === 'number') {
                    // Simple format: just a number
                    qty = quantityOrObj;
                } else if (quantityOrObj && typeof quantityOrObj === 'object' && 'quantity' in quantityOrObj) {
                    // Complex format: { quantity: X, price?: Y }
                    qty = typeof quantityOrObj.quantity === 'number' ? quantityOrObj.quantity : parseInt(String(quantityOrObj.quantity)) || 0;
                } else if (quantityOrObj !== null && quantityOrObj !== undefined) {
                    // Try to parse as number string
                    qty = parseInt(String(quantityOrObj)) || 0;
                }

                if (qty > 0) {
                    const menuItem = menuItems.find(mi => mi.id === itemId);
                    const categoryId = menuItem?.categoryId || null;
                    const itemData = { itemId, menuItem, qty, customName };

                    if (categoryId) {
                        if (!itemsByCategory[categoryId]) {
                            itemsByCategory[categoryId] = [];
                        }
                        itemsByCategory[categoryId].push(itemData);
                    } else {
                        uncategorizedItems.push(itemData);
                    }

                    totalItems += qty;
                }
            }

            // Only show generic message if there are truly no items with quantity > 0
            if (totalItems === 0) {
                const hasItemsButAllZero = itemEntries.length > 0;
                return (
                    <div className={styles.boxDetails}>
                        {hasItemsButAllZero && (
                            <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
                                Note: Box items are configured but all quantities are zero
                            </div>
                        )}
                        {!hasItemsButAllZero && (
                            <div style={{ marginTop: '0.5rem', fontSize: '0.85rem', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
                                Note: No items configured for this box order
                            </div>
                        )}
                    </div>
                );
            }

            // Sort categories by name for display
            const sortedCategoryIds = Object.keys(itemsByCategory).sort((a, b) => {
                const catA = categories.find(c => c.id === a);
                const catB = categories.find(c => c.id === b);
                return (catA?.name || '').localeCompare(catB?.name || '');
            });

            return (
                <div className={styles.vendorSection}>
                    {/* Display items grouped by category */}
                    {sortedCategoryIds.map((categoryId) => {
                        const categoryItems = itemsByCategory[categoryId];
                        const category = categories.find(c => c.id === categoryId);

                        return (
                            <div key={categoryId} style={{ marginBottom: '1.5rem' }}>
                                <h4 style={{
                                    fontSize: '0.95rem',
                                    fontWeight: 600,
                                    color: 'var(--text-primary)',
                                    marginBottom: '0.5rem',
                                    paddingBottom: '0.25rem',
                                    borderBottom: '1px solid var(--border-color)'
                                }}>
                                    {category?.name || 'Unknown Category'}
                                </h4>
                                <table className={styles.itemsTable}>
                                    <thead>
                                        <tr>
                                            <th>Item</th>
                                            <th>Quantity</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {categoryItems.map(({ itemId, menuItem, qty, customName }) => (
                                            <tr key={itemId}>
                                                <td>{menuItem?.name || customName || 'Unknown Item'}</td>
                                                <td>{qty}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        );
                    })}

                    {/* Display uncategorized items if any */}
                    {uncategorizedItems.length > 0 && (
                        <div style={{ marginBottom: '1.5rem' }}>
                            <h4 style={{
                                fontSize: '0.95rem',
                                fontWeight: 600,
                                color: 'var(--text-primary)',
                                marginBottom: '0.5rem',
                                paddingBottom: '0.25rem',
                                borderBottom: '1px solid var(--border-color)'
                            }}>
                                Uncategorized
                            </h4>
                            <table className={styles.itemsTable}>
                                <thead>
                                    <tr>
                                        <th>Item</th>
                                        <th>Quantity</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {uncategorizedItems.map(({ itemId, menuItem, qty, customName }) => (
                                        <tr key={itemId}>
                                            <td>{menuItem?.name || customName || 'Unknown Item'}</td>
                                            <td>{qty}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    <div className={styles.orderSummary}>
                        <div><strong>Total Items:</strong> {totalItems}</div>
                    </div>
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
                return (
                    <div className={styles.noItems} style={{
                        padding: 'var(--spacing-md)',
                        textAlign: 'center',
                        color: 'var(--text-tertiary)',
                        fontStyle: 'italic',
                        backgroundColor: 'var(--bg-app)',
                        borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--border-color)'
                    }}>
                        No equipment details found for this order. Order ID: {order.id}
                    </div>
                );
            }

            return (
                <div className={styles.vendorSection}>
                    <table className={styles.itemsTable}>
                        <thead>
                            <tr>
                                <th>Equipment Name</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>{equipmentDetails.equipmentName || 'Unknown Equipment'}</td>
                            </tr>
                        </tbody>
                    </table>
                    <div className={styles.orderSummary}>
                        <div><strong>Total Items:</strong> 1</div>
                    </div>
                </div>
            );
        }

        return (
            <div className={styles.noItems} style={{
                padding: 'var(--spacing-md)',
                textAlign: 'center',
                color: 'var(--text-tertiary)',
                fontStyle: 'italic',
                backgroundColor: 'var(--bg-app)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--border-color)'
            }}>
                No items available for service type: {order.service_type || 'Unknown'}
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className={styles.container}>
                <div className={styles.loadingContainer}>
                    <div className="spinner"></div>
                    <p>Loading orders...</p>
                </div>
            </div>
        );
    }

    if (!vendor) {
        return (
            <div className={styles.container}>
                <div className={styles.header}>
                    <button className={styles.backButton} onClick={() => router.push(isVendorView ? '/vendor' : `/vendors/${vendorId}`)}>
                        <ArrowLeft size={16} /> Back to Vendor
                    </button>
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
                <button className={styles.backButton} onClick={() => router.push(isVendorView ? '/vendor' : `/vendors/${vendorId}`)}>
                    <ArrowLeft size={16} /> Back to Vendor
                </button>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flex: 1 }}>
                    <h1 className={styles.title} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <Calendar size={24} style={{ color: 'var(--color-primary)' }} />
                        Orders for {formatDate(deliveryDate)}
                    </h1>
                    {orders.length > 0 && (
                        <div style={{ display: 'flex', gap: '1rem' }}>
                            <button className="btn btn-secondary" disabled={isExporting} onClick={exportLabelsPDF} style={{ padding: '0.75rem 1.5rem', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <FileText size={20} /> Download Labels
                            </button>
                            <button className="btn btn-secondary" disabled={isExporting} onClick={exportOrdersToCSV} style={{ padding: '0.75rem 1.5rem', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <Download size={20} /> Download Excel
                            </button>
                            <label className="btn btn-secondary" style={{ cursor: 'pointer', padding: '0.75rem 1.5rem', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <Upload size={20} /> Upload Excel
                                <input
                                    type="file"
                                    accept=".csv"
                                    onChange={handleCSVImport}
                                    style={{ display: 'none' }}
                                />
                            </label>
                        </div>
                    )}
                </div>
            </div>

            <div style={{ marginBottom: '1rem', padding: '1rem', backgroundColor: 'var(--bg-app)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-color)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
                    <div>
                        <strong>Vendor:</strong> {vendor.name}
                    </div>
                    <div>
                        <strong>Delivery Date:</strong> {formatDate(deliveryDate)}
                    </div>
                    <div>
                        <strong>Total Orders:</strong> {orders.length}
                    </div>
                    <div>
                        <strong>Total Items:</strong> {orders.reduce((sum, o) => sum + (o.total_items || 0), 0)}
                    </div>
                </div>
            </div>

            {orders.length === 0 ? (
                <div className={styles.emptyState}>
                    <Package size={48} style={{ color: 'var(--text-tertiary)', marginBottom: '1rem' }} />
                    <p>No orders found for this delivery date</p>
                </div>
            ) : (
                <div className={styles.ordersList}>
                    <div className={styles.ordersHeader}>
                        <span style={{ width: '40px', flex: 'none' }}></span>
                        <span style={{ minWidth: '80px', flex: 0.6 }}>Order #</span>
                        <span style={{ minWidth: '120px', flex: 0.8 }}>Type</span>
                        <span style={{ minWidth: '200px', flex: 2 }}>Client</span>
                        <span style={{ minWidth: '200px', flex: 1.5 }}>Address</span>
                        <span style={{ minWidth: '150px', flex: 1.2 }}>Phone</span>
                        <span style={{ minWidth: '100px', flex: 1 }}>Items</span>
                        <span style={{ minWidth: '200px', flex: 1.5 }}>Delivery Proof URL</span>
                        <span style={{ minWidth: '150px', flex: 1.2 }}>Updated By</span>
                        <span style={{ minWidth: '150px', flex: 1.2 }}>Created</span>
                    </div>
                    {(displayOrders.length > 0 ? displayOrders : orders).map((order) => {
                        const orderKey = `${order.orderType}-${order.id}`;
                        const isExpanded = expandedOrders.has(orderKey);

                        return (
                            <div key={orderKey}>
                                <div
                                    className={styles.orderRow}
                                    onClick={() => toggleOrderExpansion(orderKey)}
                                    style={{ cursor: 'pointer', backgroundColor: isExpanded ? 'var(--bg-hover)' : undefined }}
                                >
                                    <span style={{ width: '40px', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                    </span>
                                    <span style={{ minWidth: '80px', flex: 0.6, fontSize: '0.9rem', fontFamily: 'monospace', fontWeight: 'bold' }}>
                                        #{order.orderNumber || '-'}
                                    </span>
                                    <span style={{ minWidth: '120px', flex: 0.8 }}>
                                        <span className="badge badge-info">{order.service_type}</span>
                                        {order.orderType === 'upcoming' && (
                                            <Clock size={14} style={{ marginLeft: '4px', verticalAlign: 'middle', color: 'var(--color-warning)' }} />
                                        )}
                                    </span>
                                    <span
                                        title={getClientName(order.client_id)}
                                        style={{ minWidth: '200px', flex: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                    >
                                        {getClientName(order.client_id)}
                                    </span>
                                    <span
                                        title={getClientAddress(order.client_id)}
                                        style={{ minWidth: '200px', flex: 1.5, fontSize: '0.9rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                    >
                                        {getClientAddress(order.client_id)}
                                    </span>
                                    <span style={{ minWidth: '150px', flex: 1.2, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                        {getClientPhone(order.client_id)}
                                    </span>
                                    <span style={{ minWidth: '100px', flex: 1, fontSize: '0.9rem' }}>
                                        {order.total_items || 0}
                                    </span>
                                    <span
                                        style={{ minWidth: '200px', flex: 1.5, fontSize: '0.85rem' }}
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <input
                                            type="text"
                                            placeholder="Enter proof URL"
                                            className="input"
                                            style={{
                                                width: '100%',
                                                fontSize: '0.85rem',
                                                padding: '0.375rem 0.5rem'
                                            }}
                                            value={proofUrls[order.id] || ''}
                                            onChange={(e) => {
                                                setProofUrls(prev => ({
                                                    ...prev,
                                                    [order.id]: e.target.value
                                                }));
                                            }}
                                            disabled={isSaving}
                                        />
                                    </span>
                                    <span style={{ minWidth: '150px', flex: 1.2, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                        {order.updated_by || '-'}
                                    </span>
                                    <span style={{ minWidth: '150px', flex: 1.2, fontSize: '0.85rem', color: 'var(--text-tertiary)' }}>
                                        {formatDateTime(order.created_at)}
                                    </span>
                                </div>
                                {/* Order Items - Always Visible */}
                                <div className={styles.orderDetails} style={{
                                    borderTop: '1px solid var(--border-color)',
                                    backgroundColor: 'var(--bg-surface-hover)',
                                    padding: 0,
                                    display: 'block'
                                }}>
                                    <div className={styles.itemsSection} style={{ marginTop: 0, padding: 'var(--spacing-lg)' }}>
                                        <div className={styles.orderDetailsHeader}>
                                            <ShoppingCart size={16} />
                                            <span>Order Items</span>
                                        </div>
                                        {renderOrderItems(order)}
                                    </div>
                                </div>
                                {/* Order Details - Expandable - Hidden for now */}
                                {false && isExpanded && (
                                    <div className={styles.orderDetails}>
                                        <div className={styles.orderDetailsGrid}>
                                            <div className={styles.detailItem}>
                                                <strong>Order Number:</strong> #{order.orderNumber || '-'}
                                            </div>
                                            <div className={styles.detailItem}>
                                                <strong>Database ID:</strong> <span style={{ fontFamily: 'monospace', fontSize: '0.8em' }}>{order.id}</span>
                                            </div>
                                            <div className={styles.detailItem}>
                                                <strong>Order Type:</strong> {order.orderType}
                                            </div>
                                            <div className={styles.detailItem}>
                                                <strong>Last Updated:</strong> {formatDateTime(order.last_updated)}
                                            </div>
                                            {order.updated_by && (
                                                <div className={styles.detailItem}>
                                                    <strong>Updated By:</strong> {order.updated_by}
                                                </div>
                                            )}
                                            {order.take_effect_date && (
                                                <div className={styles.detailItem}>
                                                    <strong>Take Effect Date:</strong> {formatDate(order.take_effect_date)}
                                                </div>
                                            )}
                                            {order.delivery_distribution && (
                                                <div className={styles.detailItem} style={{ gridColumn: '1 / -1' }}>
                                                    <strong>Delivery Distribution:</strong> {JSON.stringify(order.delivery_distribution)}
                                                </div>
                                            )}
                                            {order.notes && (
                                                <div className={styles.detailItem} style={{ gridColumn: '1 / -1' }}>
                                                    <strong>Notes:</strong> {order.notes}
                                                </div>
                                            )}

                                            {/* Proof Upload for Waiting Orders */}
                                            {order.status === 'waiting_for_proof' && (
                                                <div className={styles.detailItem} style={{ gridColumn: '1 / -1', marginTop: '1rem', padding: '1rem', backgroundColor: 'rgba(37, 99, 235, 0.1)', borderRadius: '6px', border: '1px solid rgba(37, 99, 235, 0.2)' }}>
                                                    <h4 style={{ marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.9rem', color: 'var(--color-primary)' }}>
                                                        <Upload size={16} /> Submit Proof of Delivery
                                                    </h4>
                                                    <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '0.5rem' }}>
                                                        Providing a proof URL will move this order to <strong>Billing Pending</strong> status.
                                                    </p>
                                                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                                                        <input
                                                            placeholder="Enter Proof URL (e.g. https://image-link.com)"
                                                            className="input"
                                                            style={{ flex: 1 }}
                                                            id={`proof-input-${order.id}`}
                                                        />
                                                        <button
                                                            className="btn btn-primary"
                                                            onClick={async () => {
                                                                const inputInfo = document.getElementById(`proof-input-${order.id}`) as HTMLInputElement;
                                                                if (!inputInfo || !inputInfo.value.trim()) {
                                                                    alert('Please enter a valid URL');
                                                                    return;
                                                                }

                                                                const res = await updateOrderDeliveryProof(order.id, inputInfo.value.trim());
                                                                if (res.success) {
                                                                    await loadData();
                                                                } else {
                                                                    alert('Failed: ' + res.error);
                                                                }
                                                            }}
                                                        >
                                                            Submit
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* Bulk Save Button */}
            {orders.length > 0 && (
                <div style={{
                    marginTop: '2rem',
                    padding: '1.5rem',
                    backgroundColor: 'var(--bg-app)',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-color)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '1rem'
                }}>
                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                        {(() => {
                            const ordersWithUrls = orders.filter(order => {
                                const url = proofUrls[order.id];
                                return url && url.trim() && url.trim() !== (order.delivery_proof_url || '');
                            }).length;
                            return ordersWithUrls > 0
                                ? `${ordersWithUrls} order${ordersWithUrls !== 1 ? 's' : ''} with delivery proof URL${ordersWithUrls !== 1 ? 's' : ''} ready to save`
                                : 'Enter delivery proof URLs in the table above to save';
                        })()}
                    </div>
                    <button
                        className="btn btn-primary"
                        style={{
                            padding: '0.75rem 1.5rem',
                            fontSize: '1rem',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '0.5rem',
                            whiteSpace: 'nowrap'
                        }}
                        onClick={handleBulkSave}
                        disabled={isSaving || orders.filter(order => {
                            const url = proofUrls[order.id];
                            return url && url.trim() && url.trim() !== (order.delivery_proof_url || '');
                        }).length === 0}
                    >
                        {isSaving ? (
                            <>Saving All...</>
                        ) : (
                            <>
                                <Save size={18} />
                                Save All Delivery Proof URLs
                            </>
                        )}
                    </button>
                </div>
            )}

            {/* Summary Modal */}
            {summaryModal.show && (
                <div
                    style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'rgba(0, 0, 0, 0.6)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 1000,
                        padding: 'var(--spacing-lg)'
                    }}
                    onClick={() => setSummaryModal({ show: false })}
                >
                    <div
                        style={{
                            backgroundColor: 'var(--bg-surface)',
                            border: '1px solid var(--border-color)',
                            borderRadius: 'var(--radius-lg)',
                            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.2)',
                            width: '100%',
                            maxWidth: summaryModal.results ? '700px' : '500px',
                            maxHeight: '90vh',
                            overflowY: 'auto',
                            padding: 'var(--spacing-xl)',
                            position: 'relative'
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            style={{
                                position: 'absolute',
                                top: 'var(--spacing-md)',
                                right: 'var(--spacing-md)',
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                color: 'var(--text-secondary)',
                                padding: 'var(--spacing-xs)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                borderRadius: 'var(--radius-sm)',
                                transition: 'all 0.2s'
                            }}
                            onClick={() => setSummaryModal({ show: false })}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.backgroundColor = 'var(--bg-app)';
                                e.currentTarget.style.color = 'var(--text-primary)';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = 'transparent';
                                e.currentTarget.style.color = 'var(--text-secondary)';
                            }}
                        >
                            <X size={20} />
                        </button>

                        {summaryModal.error ? (
                            <>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: 'var(--spacing-lg)' }}>
                                    <AlertCircle size={24} style={{ color: 'var(--color-danger)' }} />
                                    <h2 style={{ fontSize: '1.5rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                                        Error
                                    </h2>
                                </div>
                                <p style={{ color: 'var(--text-secondary)', marginBottom: 'var(--spacing-xl)' }}>
                                    {summaryModal.error}
                                </p>
                            </>
                        ) : summaryModal.results ? (
                            <>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: 'var(--spacing-lg)' }}>
                                    <CheckCircle size={24} style={{ color: 'var(--color-success)' }} />
                                    <h2 style={{ fontSize: '1.5rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                                        Bulk Save Results
                                    </h2>
                                </div>

                                <div style={{
                                    backgroundColor: 'var(--bg-app)',
                                    borderRadius: 'var(--radius-md)',
                                    padding: 'var(--spacing-lg)',
                                    marginBottom: 'var(--spacing-lg)',
                                    maxHeight: '400px',
                                    overflowY: 'auto'
                                }}>
                                    {(() => {
                                        const successful = summaryModal.results.filter(r => r.success);
                                        const failed = summaryModal.results.filter(r => !r.success);

                                        return (
                                            <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                                                <div style={{
                                                    padding: 'var(--spacing-sm)',
                                                    backgroundColor: 'rgba(34, 197, 94, 0.1)',
                                                    borderRadius: 'var(--radius-sm)',
                                                    border: '1px solid rgba(34, 197, 94, 0.2)',
                                                    color: 'var(--color-success)',
                                                    fontSize: '0.875rem',
                                                    fontWeight: 600
                                                }}>
                                                    ✓ {successful.length} order{successful.length !== 1 ? 's' : ''} saved successfully
                                                </div>

                                                {failed.length > 0 && (
                                                    <div style={{
                                                        padding: 'var(--spacing-sm)',
                                                        backgroundColor: 'rgba(239, 68, 68, 0.1)',
                                                        borderRadius: 'var(--radius-sm)',
                                                        border: '1px solid rgba(239, 68, 68, 0.2)',
                                                        color: 'var(--color-danger)',
                                                        fontSize: '0.875rem',
                                                        fontWeight: 600,
                                                        marginBottom: 'var(--spacing-sm)'
                                                    }}>
                                                        ✗ {failed.length} order{failed.length !== 1 ? 's' : ''} failed
                                                    </div>
                                                )}

                                                <div style={{ display: 'grid', gap: 'var(--spacing-sm)' }}>
                                                    {summaryModal.results.map((result, idx) => (
                                                        <div key={idx} style={{
                                                            padding: 'var(--spacing-sm)',
                                                            backgroundColor: result.success ? 'rgba(34, 197, 94, 0.05)' : 'rgba(239, 68, 68, 0.05)',
                                                            borderRadius: 'var(--radius-sm)',
                                                            border: `1px solid ${result.success ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`
                                                        }}>
                                                            <div style={{ fontSize: '0.875rem', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '0.25rem' }}>
                                                                Order ID: {result.orderId}
                                                            </div>
                                                            {result.success && result.summary && (
                                                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                                                                    {result.summary.wasProcessed && '✓ Processed from scheduled → '}
                                                                </div>
                                                            )}
                                                            {!result.success && result.error && (
                                                                <div style={{ fontSize: '0.75rem', color: 'var(--color-danger)', marginTop: '0.25rem' }}>
                                                                    Error: {result.error}
                                                                </div>
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    })()}
                                </div>
                            </>
                        ) : summaryModal.summary ? (
                            <>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: 'var(--spacing-lg)' }}>
                                    <CheckCircle size={24} style={{ color: 'var(--color-success)' }} />
                                    <h2 style={{ fontSize: '1.5rem', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                                        Delivery Proof Saved Successfully
                                    </h2>
                                </div>

                                <div style={{
                                    backgroundColor: 'var(--bg-app)',
                                    borderRadius: 'var(--radius-md)',
                                    padding: 'var(--spacing-lg)',
                                    marginBottom: 'var(--spacing-lg)'
                                }}>
                                    <div style={{ display: 'grid', gap: 'var(--spacing-md)' }}>
                                        <div>
                                            <strong style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Order ID:</strong>
                                            <div style={{ color: 'var(--text-primary)', fontSize: '1rem', marginTop: '0.25rem' }}>
                                                {summaryModal.summary.orderId}
                                            </div>
                                        </div>
                                        <div>
                                            <strong style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>Service Type:</strong>
                                            <div style={{ color: 'var(--text-primary)', fontSize: '1rem', marginTop: '0.25rem' }}>
                                                {summaryModal.summary.serviceType}
                                            </div>
                                        </div>
                                        {summaryModal.summary.wasProcessed && (
                                            <div style={{
                                                padding: 'var(--spacing-sm)',
                                                backgroundColor: 'rgba(37, 99, 235, 0.1)',
                                                borderRadius: 'var(--radius-sm)',
                                                border: '1px solid rgba(37, 99, 235, 0.2)',
                                                color: 'var(--color-primary)',
                                                fontSize: '0.875rem'
                                            }}>
                                                ✓ Order was processed from scheduled to delivery
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {summaryModal.summary.hasErrors && summaryModal.summary.errors && (
                                    <div style={{
                                        padding: 'var(--spacing-md)',
                                        backgroundColor: 'rgba(239, 68, 68, 0.1)',
                                        borderRadius: 'var(--radius-md)',
                                        border: '1px solid rgba(239, 68, 68, 0.2)',
                                        marginBottom: 'var(--spacing-lg)'
                                    }}>
                                        <div style={{
                                            color: 'var(--color-danger)',
                                            fontSize: '0.875rem',
                                            fontWeight: 600,
                                            marginBottom: '0.5rem'
                                        }}>
                                            Warnings:
                                        </div>
                                        <ul style={{
                                            margin: 0,
                                            paddingLeft: '1.25rem',
                                            color: 'var(--color-danger)',
                                            fontSize: '0.875rem'
                                        }}>
                                            {summaryModal.summary.errors.map((err: string, idx: number) => (
                                                <li key={idx} style={{ marginBottom: '0.25rem' }}>{err}</li>
                                            ))}
                                        </ul>
                                    </div>
                                )}
                            </>
                        ) : null}

                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <button
                                className="btn btn-primary"
                                onClick={() => setSummaryModal({ show: false })}
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* CSV Import Progress Modal */}
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

            {(importProgress.isImporting || importProgress.totalRows > 0) && (
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
            )}
        </div>
    );
}

