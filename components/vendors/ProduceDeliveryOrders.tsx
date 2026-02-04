'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ClientProfile, MenuItem, BoxType, ItemCategory } from '@/lib/types';
import { getClients, getMenuItems, getBoxTypes, getCategories } from '@/lib/cached-data';
import { getOrdersByServiceType, saveDeliveryProofUrlAndProcessOrder, updateOrderDeliveryProof, orderHasDeliveryProof, resolveOrderId } from '@/lib/actions';
import { ArrowLeft, Calendar, Package, Clock, ShoppingCart, Upload, ChevronDown, ChevronUp, Save, X, CheckCircle, AlertCircle, Download, XCircle, FileText } from 'lucide-react';
import { generateLabelsPDF } from '@/lib/label-utils';
import styles from './VendorDetail.module.css';

interface Props {
    deliveryDate: string;
}

export function ProduceDeliveryOrders({ deliveryDate }: Props) {
    const router = useRouter();
    const [orders, setOrders] = useState<any[]>([]);
    const [clients, setClients] = useState<ClientProfile[]>([]);
    const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
    const [boxTypes, setBoxTypes] = useState<BoxType[]>([]);
    const [categories, setCategories] = useState<ItemCategory[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());
    const [proofUrls, setProofUrls] = useState<Record<string, string>>({});
    const [isSaving, setIsSaving] = useState(false);
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
    }, [deliveryDate]);

    async function loadData() {
        setIsLoading(true);
        try {
            const [ordersData, clientsData, menuItemsData, boxTypesData, categoriesData] = await Promise.all([
                getOrdersByServiceType('Produce'),
                getClients(),
                getMenuItems(),
                getBoxTypes(),
                getCategories()
            ]);

            // Filter orders by delivery date and exclude "upcoming" (scheduled but not placed) orders
            let filteredOrders: any[] = [];
            if (deliveryDate === 'no-date') {
                filteredOrders = ordersData.filter(order => !order.scheduled_delivery_date);
            } else {
                const dateKey = new Date(deliveryDate).toISOString().split('T')[0];
                filteredOrders = ordersData.filter(order => {
                    if (!order.scheduled_delivery_date) return false;

                    // Exclude upcoming orders
                    if (order.orderType === 'upcoming') return false;

                    const orderDateKey = new Date(order.scheduled_delivery_date).toISOString().split('T')[0];
                    return orderDateKey === dateKey;
                });
            }

            // Expand all orders by default so items are visible
            const allOrderKeys = new Set(filteredOrders.map(order => `${order.orderType}-${order.id}`));
            setExpandedOrders(allOrderKeys);

            setOrders(filteredOrders);
            setClients(clientsData);
            setMenuItems(menuItemsData);
            setBoxTypes(boxTypesData);
            setCategories(categoriesData);

            // Initialize proof URLs from orders
            const initialProofUrls: Record<string, string> = {};
            filteredOrders.forEach(order => {
                if (order.delivery_proof_url) {
                    initialProofUrls[order.id] = order.delivery_proof_url;
                }
            });
            setProofUrls(initialProofUrls);
        } catch (error) {
            console.error('Error loading produce delivery orders:', error);
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
        return client?.address || '-';
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

    function formatDateTime(dateString: string | null | undefined) {
        if (!dateString) return '-';
        try {
            return new Date(dateString).toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
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

    function formatOrderedItemsForCSV(order: any): string {
        if (order.service_type === 'Produce') {
            return `Bill Amount: $${(order.bill_amount || 0).toFixed(2)}`;
        }
        return 'No items available';
    }

    function exportOrdersToCSV() {
        if (orders.length === 0) {
            alert('No orders to export');
            return;
        }

        // Define CSV headers
        const headers = [
            'Order Number',
            'Order ID',
            'Client ID',
            'Client Name',
            'Address',
            'Phone',
            'Scheduled Delivery Date',
            'Bill Amount',
            'Ordered Items',
            'Delivery Proof URL'
        ];

        // Convert orders to CSV rows
        const rows = orders.map(order => [
            order.orderNumber || '',
            order.id || '',
            order.client_id || '',
            getClientName(order.client_id),
            getClientAddress(order.client_id),
            getClientPhone(order.client_id),
            order.scheduled_delivery_date || '',
            order.bill_amount || 0,
            formatOrderedItemsForCSV(order),
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
        link.setAttribute('download', `produce_orders_${formattedDate}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    async function exportLabelsPDF() {
        await generateLabelsPDF({
            orders,
            getClientName,
            getClientAddress,
            formatOrderedItemsForCSV,
            formatDate,
            vendorName: 'Produce',
            deliveryDate
        });
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

                // Check if order matches the delivery date
                const order = orders.find(o => o.id === orderId);
                if (order) {
                    if (deliveryDate === 'no-date') {
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
                            ? new Date(order.scheduled_delivery_date).toISOString().split('T')[0]
                            : null;
                        const pageDateKey = new Date(deliveryDate).toISOString().split('T')[0];

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

    function renderOrderItems(order: any) {
        if (order.service_type === 'Produce') {
            // Produce orders - show bill amount
            return (
                <div className={styles.vendorSection}>
                    <table className={styles.itemsTable}>
                        <thead>
                            <tr>
                                <th>Bill Amount</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr>
                                <td>${(order.bill_amount || 0).toFixed(2)}</td>
                            </tr>
                        </tbody>
                    </table>
                    <div className={styles.orderSummary}>
                        <div><strong>Bill Amount:</strong> ${(order.bill_amount || 0).toFixed(2)}</div>
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

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <button className={styles.backButton} onClick={() => router.push('/vendors/produce')}>
                    <ArrowLeft size={16} /> Back to Produce
                </button>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flex: 1 }}>
                    <h1 className={styles.title} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <Calendar size={24} style={{ color: 'var(--color-primary)' }} />
                        Produce Orders for {deliveryDate === 'no-date' ? 'No Delivery Date' : formatDate(deliveryDate)}
                    </h1>
                    {orders.length > 0 && (
                        <div style={{ display: 'flex', gap: '1rem' }}>
                            <button className="btn btn-secondary" onClick={exportLabelsPDF} style={{ padding: '0.75rem 1.5rem', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                <FileText size={20} /> Download Labels
                            </button>
                            <button className="btn btn-secondary" onClick={exportOrdersToCSV} style={{ padding: '0.75rem 1.5rem', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
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
                        <strong>Service Type:</strong> Produce
                    </div>
                    <div>
                        <strong>Delivery Date:</strong> {deliveryDate === 'no-date' ? 'No Delivery Date' : formatDate(deliveryDate)}
                    </div>
                    <div>
                        <strong>Total Orders:</strong> {orders.length}
                    </div>
                    <div>
                        <strong>Total Bill Amount:</strong> ${orders.reduce((sum, o) => sum + (parseFloat(o.bill_amount) || 0), 0).toFixed(2)}
                    </div>
                </div>
            </div>

            {orders.length === 0 ? (
                <div className={styles.emptyState}>
                    <Package size={48} style={{ color: 'var(--text-tertiary)', marginBottom: '1rem' }} />
                    <p>No produce orders found for this delivery date</p>
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
                        <span style={{ minWidth: '100px', flex: 1 }}>Bill Amount</span>
                        <span style={{ minWidth: '200px', flex: 1.5 }}>Delivery Proof URL</span>
                        <span style={{ minWidth: '150px', flex: 1.2 }}>Updated By</span>
                        <span style={{ minWidth: '150px', flex: 1.2 }}>Created</span>
                    </div>
                    {orders.map((order) => {
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
                                        ${(parseFloat(order.bill_amount) || 0).toFixed(2)}
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

            {/* Summary Modal - Same as VendorDeliveryOrders */}
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

            {/* CSV Import Progress Modal - Same as VendorDeliveryOrders */}
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
