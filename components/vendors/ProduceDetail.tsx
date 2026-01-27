'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ClientProfile, MenuItem, BoxType } from '@/lib/types';
import { getClients, getMenuItems, getBoxTypes } from '@/lib/cached-data';
import { getOrdersByServiceType, updateOrderDeliveryProof, orderHasDeliveryProof, resolveOrderId } from '@/lib/actions';
import { ArrowLeft, Calendar, Package, CheckCircle, XCircle, Clock, Download, ChevronDown, ChevronUp, FileText, Upload, X, AlertCircle } from 'lucide-react';
import { generateLabelsPDF } from '@/lib/label-utils';
import styles from './VendorDetail.module.css';

export function ProduceDetail() {
    const router = useRouter();
    const [orders, setOrders] = useState<any[]>([]);
    const [clients, setClients] = useState<ClientProfile[]>([]);
    const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
    const [boxTypes, setBoxTypes] = useState<BoxType[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());

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
    }, []);

    async function loadData() {
        setIsLoading(true);
        try {
            const promises: Promise<any>[] = [
                getOrdersByServiceType('Produce'),
                getClients(),
                getMenuItems(),
                getBoxTypes()
            ];

            const results = await Promise.all(promises);
            const ordersData = results[0];
            const clientsData = results[1];
            const menuItemsData = results[2];
            const boxTypesData = results[3];

            setOrders(ordersData);
            setClients(clientsData);
            setMenuItems(menuItemsData);
            setBoxTypes(boxTypesData);
        } catch (error) {
            console.error('Error loading produce data:', error);
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
                timeZone: 'UTC'
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

    function groupOrdersByDeliveryDate(ordersList: any[]) {
        const grouped: { [key: string]: any[] } = {};
        const noDate: any[] = [];

        ordersList.forEach(order => {
            const deliveryDate = order.scheduled_delivery_date;
            if (deliveryDate) {
                // Use date as key (YYYY-MM-DD format for consistent sorting)
                const dateKey = new Date(deliveryDate).toISOString().split('T')[0];
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

    function renderOrderItems(order: any) {
        if (order.service_type === 'Produce') {
            // Produce orders - show bill amount
            return (
                <div className={styles.itemsList}>
                    <div className={styles.itemsHeader}>
                        <span style={{ minWidth: '300px', flex: 3 }}>Bill Amount</span>
                    </div>
                    <div className={styles.itemRow}>
                        <span style={{ minWidth: '300px', flex: 3 }}>
                            ${(order.bill_amount || 0).toFixed(2)}
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
        link.setAttribute('href', url);
        link.setAttribute('download', `produce_orders_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    function exportOrdersByDateToCSV(dateKey: string, dateOrders: any[]) {
        if (dateOrders.length === 0) {
            alert('No orders to export for this date');
            return;
        }

        // Define CSV headers
        const headers = [
            'Order Number',
            'Order ID',
            'Client ID',
            'Client Name',
            'Scheduled Delivery Date',
            'Bill Amount',
            'Ordered Items',
            'Delivery Proof URL'
        ];

        // Convert orders to CSV rows
        const rows = dateOrders.map(order => [
            order.orderNumber || '',
            order.id || '',
            order.client_id || '',
            getClientName(order.client_id),
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
        const formattedDate = dateKey === 'no-date'
            ? 'no_delivery_date'
            : formatDate(dateKey).replace(/\s/g, '_');
        link.setAttribute('href', url);
        link.setAttribute('download', `produce_orders_${formattedDate}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    }

    async function exportLabelsPDFForDate(dateKey: string, dateOrders: any[]) {
        if (dateOrders.length === 0) {
            alert('No orders to export for this date');
            return;
        }

        await generateLabelsPDF({
            orders: dateOrders,
            getClientName,
            getClientAddress,
            formatOrderedItemsForCSV,
            formatDate,
            vendorName: 'Produce',
            deliveryDate: dateKey === 'no-date' ? undefined : dateKey
        });
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
                            ? new Date(order.scheduled_delivery_date).toISOString().split('T')[0]
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
                <div className={styles.loadingContainer}>
                    <div className="spinner"></div>
                    <p>Loading produce orders...</p>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <button className={styles.backButton} onClick={() => router.push('/vendors')}>
                    <ArrowLeft size={16} /> Back to Vendors
                </button>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flex: 1 }}>
                    <h1 className={styles.title}>
                        <Package size={24} style={{ marginRight: '12px', verticalAlign: 'middle' }} />
                        Produce Orders
                    </h1>
                </div>
            </div>

            {/* Orders Section */}
            <div className={styles.ordersSection}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--spacing-lg)' }}>
                    <h2 className={styles.sectionTitle}>Orders</h2>
                </div>

                {(() => {
                    if (orders.length === 0) {
                        return (
                            <div className={styles.emptyState}>
                                <Package size={48} style={{ color: 'var(--text-tertiary)', marginBottom: '1rem' }} />
                                <p>No produce orders found</p>
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
                                <span style={{ flex: '1.2 1 120px', minWidth: 0 }}>Total Bill Amount</span>
                                <span style={{ flex: '1.5 1 150px', minWidth: 0 }}>Actions</span>
                            </div>

                            {/* Orders grouped by delivery date */}
                            {sortedDates.map((dateKey) => {
                                const dateOrders = grouped[dateKey];
                                const dateTotalBillAmount = dateOrders.reduce((sum, o) => sum + (parseFloat(o.bill_amount) || 0), 0);

                                return (
                                    <div key={dateKey}>
                                        <div
                                            className={styles.orderRow}
                                            onClick={() => router.push(`/vendors/produce/delivery/${dateKey}`)}
                                            style={{ cursor: 'pointer' }}
                                        >
                                            <span style={{ width: '40px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                <ChevronDown size={16} />
                                            </span>
                                            <span style={{ flex: '2 1 150px', minWidth: 0, fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <Calendar size={16} style={{ color: 'var(--color-primary)' }} />
                                                {formatDate(dateKey)}
                                            </span>
                                            <span style={{ flex: '1 1 100px', minWidth: 0 }}>
                                                <span className="badge badge-info">{dateOrders.length} order{dateOrders.length !== 1 ? 's' : ''}</span>
                                            </span>
                                            <span style={{ flex: '1.2 1 120px', minWidth: 0, fontSize: '0.9rem' }}>
                                                ${dateTotalBillAmount.toFixed(2)}
                                            </span>
                                            <span
                                                style={{ flex: '1.5 1 150px', minWidth: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <button
                                                    className="btn btn-secondary"
                                                    style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        exportLabelsPDFForDate(dateKey, dateOrders);
                                                    }}
                                                >
                                                    <FileText size={14} /> Download Labels
                                                </button>
                                                <button
                                                    className="btn btn-secondary"
                                                    style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        exportOrdersByDateToCSV(dateKey, dateOrders);
                                                    }}
                                                >
                                                    <Download size={14} /> Download CSV
                                                </button>
                                                <label
                                                    className="btn btn-secondary"
                                                    style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', cursor: 'pointer', margin: 0 }}
                                                >
                                                    <Upload size={14} /> Import CSV
                                                    <input
                                                        type="file"
                                                        accept=".csv"
                                                        onChange={(e) => handleCSVImportForDate(e, dateKey)}
                                                        style={{ display: 'none' }}
                                                    />
                                                </label>
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}

                            {/* Orders without delivery dates */}
                            {noDate.length > 0 && (
                                <div>
                                    <div
                                        className={styles.orderRow}
                                        onClick={() => router.push(`/vendors/produce/delivery/no-date`)}
                                        style={{ cursor: 'pointer' }}
                                    >
                                        <span style={{ width: '40px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <ChevronDown size={16} />
                                        </span>
                                        <span style={{ flex: '2 1 150px', minWidth: 0, fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <Calendar size={16} style={{ color: 'var(--text-tertiary)' }} />
                                            No Delivery Date
                                        </span>
                                        <span style={{ flex: '1 1 100px', minWidth: 0 }}>
                                            <span className="badge">{noDate.length} order{noDate.length !== 1 ? 's' : ''}</span>
                                        </span>
                                        <span style={{ flex: '1.2 1 120px', minWidth: 0, fontSize: '0.9rem' }}>
                                            ${noDate.reduce((sum, o) => sum + (parseFloat(o.bill_amount) || 0), 0).toFixed(2)}
                                        </span>
                                        <span
                                            style={{ flex: '1.5 1 150px', minWidth: 0, display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}
                                            onClick={(e) => e.stopPropagation()}
                                        >
                                            <button
                                                className="btn btn-secondary"
                                                style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    exportLabelsPDFForDate('no-date', noDate);
                                                }}
                                            >
                                                <FileText size={14} /> Download Labels
                                            </button>
                                            <button
                                                className="btn btn-secondary"
                                                style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    exportOrdersByDateToCSV('no-date', noDate);
                                                }}
                                            >
                                                <Download size={14} /> Download CSV
                                            </button>
                                            <label
                                                className="btn btn-secondary"
                                                style={{ fontSize: '0.75rem', padding: '0.25rem 0.5rem', cursor: 'pointer', margin: 0 }}
                                            >
                                                <Upload size={14} /> Import CSV
                                                <input
                                                    type="file"
                                                    accept=".csv"
                                                    onChange={(e) => handleCSVImportForDate(e, 'no-date')}
                                                    style={{ display: 'none' }}
                                                />
                                            </label>
                                        </span>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })()}
            </div>

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
