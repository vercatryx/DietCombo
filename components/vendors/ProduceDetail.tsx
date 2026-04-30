'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ClientProfile, MenuItem, BoxType, ProduceVendor } from '@/lib/types';
import { getMenuItems, getBoxTypes, getProduceVendors } from '@/lib/cached-data';
import { Package, FileText, Search, User, AlertTriangle, PlusCircle, X, Download } from 'lucide-react';
import { generateLabelsPDF } from '@/lib/label-utils';
import { formatFullAddress } from '@/lib/addressHelpers';
import {
    bulkCreateProduceOrdersForVendor,
    bulkUpdateProduceProofsForVendor,
    getClientNamesByIds,
    getClientsUnlimited,
    getProduceClientsForVendorToken
} from '@/lib/actions';
import { isProduceServiceType } from '@/lib/isProduceServiceType';
import * as XLSX from 'xlsx';
import styles from './VendorDetail.module.css';

type CreatedProduceOrderRow = {
    clientId: string;
    clientName: string;
    address: string;
    city: string;
    state: string;
    zip: string;
    phone: string;
    orderNumber: number;
    deliveryDate: string;
};

export function ProduceDetail() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const token = searchParams.get('token');

    const [produceClients, setProduceClients] = useState<ClientProfile[]>([]);
    const [allClients, setAllClients] = useState<ClientProfile[]>([]);
    const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
    const [boxTypes, setBoxTypes] = useState<BoxType[]>([]);
    const [produceVendors, setProduceVendors] = useState<ProduceVendor[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [vendorFilter, setVendorFilter] = useState<string>('all');
    const [tokenVendor, setTokenVendor] = useState<ProduceVendor | null>(null);
    const [invalidToken, setInvalidToken] = useState(false);

    const [showCreateOrdersModal, setShowCreateOrdersModal] = useState(false);
    const [deliveryDate, setDeliveryDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
    const [isCreatingOrders, setIsCreatingOrders] = useState(false);
    const [createOrdersError, setCreateOrdersError] = useState<string>('');
    const [lastCreatedOrders, setLastCreatedOrders] = useState<CreatedProduceOrderRow[] | null>(null);

    const [showUploadExcelModal, setShowUploadExcelModal] = useState(false);
    const [uploadExcelError, setUploadExcelError] = useState<string>('');
    const [excelHeaders, setExcelHeaders] = useState<string[]>([]);
    const [excelRows, setExcelRows] = useState<any[][]>([]);
    const [orderNumberColumn, setOrderNumberColumn] = useState<string>('');
    const [proofUrlColumn, setProofUrlColumn] = useState<string>('');
    const [isProcessingExcel, setIsProcessingExcel] = useState(false);
    const [uploadResult, setUploadResult] = useState<{ updated: number; errors: string[] } | null>(null);
    /** Parent / guardian names not present in allClients (token view loads a subset only). */
    const [extraClientNames, setExtraClientNames] = useState<Record<string, string>>({});

    function getLastName(name: string): string {
        const trimmed = (name || '').trim();
        if (!trimmed) return '';
        const parts = trimmed.split(/\s+/);
        return parts[parts.length - 1] || '';
    }

    useEffect(() => {
        loadData();
        // Re-run when token becomes available (vendor link) so we don’t stick with an empty list.
    }, [token]);

    async function loadData() {
        setIsLoading(true);
        setInvalidToken(false);
        try {
            const tokenTrim = (token || '').trim();
            const [clientsData, menuItemsData, boxTypesData, pvData] = await Promise.all([
                tokenTrim
                    ? getProduceClientsForVendorToken(tokenTrim)
                    : getClientsUnlimited(),
                getMenuItems(),
                getBoxTypes(),
                getProduceVendors()
            ]);

            setProduceVendors(pvData);

            let resolvedTokenVendor: ProduceVendor | null = null;
            if (tokenTrim) {
                resolvedTokenVendor = pvData.find(pv => pv.token === tokenTrim) || null;
                setTokenVendor(resolvedTokenVendor);
                if (!resolvedTokenVendor) {
                    setInvalidToken(true);
                    setProduceClients([]);
                    setAllClients([]);
                    setExtraClientNames({});
                    setIsLoading(false);
                    return;
                }
            } else {
                setTokenVendor(null);
            }

            let produceClientsList: ClientProfile[];
            if (tokenTrim) {
                produceClientsList = [...clientsData].sort((a, b) => {
                    const byLast = getLastName(a.fullName || '').localeCompare(getLastName(b.fullName || ''), undefined, { sensitivity: 'base' });
                    if (byLast !== 0) return byLast;
                    return (a.fullName || '').localeCompare(b.fullName || '', undefined, { sensitivity: 'base' });
                });
                setAllClients(produceClientsList);
                const parentIds = [
                    ...new Set(
                        produceClientsList
                            .map(c => c.parentClientId)
                            .filter((id): id is string => !!id)
                    )
                ];
                const missingParentIds = parentIds.filter(pid => !produceClientsList.some(c => c.id === pid));
                if (missingParentIds.length > 0) {
                    const names = await getClientNamesByIds(missingParentIds);
                    setExtraClientNames(names);
                } else {
                    setExtraClientNames({});
                }
            } else {
                produceClientsList = clientsData
                    .filter(client => {
                        if (!isProduceServiceType(client.serviceType) || client.paused) return false;
                        return true;
                    })
                    .sort((a, b) => {
                        const byLast = getLastName(a.fullName || '').localeCompare(getLastName(b.fullName || ''), undefined, { sensitivity: 'base' });
                        if (byLast !== 0) return byLast;
                        return (a.fullName || '').localeCompare(b.fullName || '', undefined, { sensitivity: 'base' });
                    });
                setAllClients(clientsData);
                setExtraClientNames({});
            }

            setProduceClients(produceClientsList);
            setMenuItems(menuItemsData);
            setBoxTypes(boxTypesData);
        } catch (error) {
            console.error('Error loading produce clients:', error);
        } finally {
            setIsLoading(false);
        }
    }

    function getClientName(clientId: string) {
        const client = allClients.find(c => c.id === clientId);
        return client?.fullName || extraClientNames[clientId] || 'Unknown Client';
    }

    function getClientAddress(clientId: string) {
        const client = allClients.find(c => c.id === clientId);
        if (!client) return '-';
        const useClient = client.parentClientId && !(client.address?.trim()) && !client.apt && !client.city && !client.zip
            ? allClients.find(c => c.id === client.parentClientId) || client
            : client;
        const full = formatFullAddress({ address: useClient.address, apt: useClient.apt, city: useClient.city, state: useClient.state, zip: useClient.zip });
        return full || useClient.address || '-';
    }

    function getClientPhone(clientId: string) {
        const client = allClients.find(c => c.id === clientId);
        return client?.phoneNumber || '-';
    }

    function getProduceVendorName(client: ClientProfile): string {
        if (!client.produceVendorId) return '—';
        const pv = produceVendors.find(v => v.id === client.produceVendorId);
        return pv?.name || '—';
    }

    const isExternalView = !!token && !!tokenVendor;
    const showVendorColumn = !isExternalView && produceVendors.length > 0;

    const filteredClients = produceClients.filter(client => {
        const parent = client.parentClientId ? allClients.find(c => c.id === client.parentClientId) : null;
        const parentName =
            (parent?.fullName || (client.parentClientId ? extraClientNames[client.parentClientId] : '') || '').toLowerCase();
        const matchesSearch = client.fullName.toLowerCase().includes(search.toLowerCase()) ||
            (client.email && client.email.toLowerCase().includes(search.toLowerCase())) ||
            (client.phoneNumber && client.phoneNumber.includes(search)) ||
            (client.address && client.address.toLowerCase().includes(search.toLowerCase())) ||
            (parentName && parentName.includes(search.toLowerCase()));

        let matchesVendorFilter = true;
        if (!isExternalView && vendorFilter !== 'all') {
            if (vendorFilter === 'unassigned') {
                matchesVendorFilter = !client.produceVendorId;
            } else {
                matchesVendorFilter = client.produceVendorId === vendorFilter;
            }
        }

        return matchesSearch && matchesVendorFilter;
    });

    async function exportLabelsPDF() {
        if (filteredClients.length === 0) {
            alert('No clients to export');
            return;
        }

        const clientOrders = filteredClients.map(client => ({
            id: client.id,
            client_id: client.id,
            orderNumber: client.id.slice(0, 8),
            service_type: 'Produce'
        }));

        const vendorLabel = isExternalView ? `Produce - ${tokenVendor!.name}` : 'Produce';

        await generateLabelsPDF({
            orders: clientOrders,
            getClientName: (clientId: string) => getClientName(clientId),
            getClientAddress: (clientId: string) => getClientAddress(clientId),
            formatOrderedItemsForCSV: () => 'Produce Client',
            formatDate: () => '',
            vendorName: vendorLabel
        });
    }

    function downloadCreatedOrdersExcel(rows: CreatedProduceOrderRow[], exportDeliveryDate: string) {
        const sorted = [...rows].sort((a, b) => {
            const byLast = getLastName(a.clientName).localeCompare(getLastName(b.clientName), undefined, { sensitivity: 'base' });
            if (byLast !== 0) return byLast;
            return a.clientName.localeCompare(b.clientName, undefined, { sensitivity: 'base' });
        });

        const sheetRows = sorted.map(r => ({
            'Order Number': r.orderNumber,
            'Name': r.clientName,
            'Address': r.address,
            'City': r.city,
            'State': r.state,
            'Zip': r.zip,
            'Phone': r.phone,
            'Delivery Date': r.deliveryDate || exportDeliveryDate
        }));

        const ws = XLSX.utils.json_to_sheet(sheetRows, { header: ['Order Number', 'Name', 'Address', 'City', 'State', 'Zip', 'Phone', 'Delivery Date'] });
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Orders');
        XLSX.writeFile(wb, `produce-orders-${exportDeliveryDate}.xlsx`);
    }

    async function handleCreateOrders() {
        setCreateOrdersError('');
        if (!deliveryDate) {
            setCreateOrdersError('Delivery Date is required.');
            return;
        }
        if (!token) {
            setCreateOrdersError('Missing vendor token.');
            return;
        }
        if (filteredClients.length === 0) {
            setCreateOrdersError('No clients to create orders for.');
            return;
        }

        setIsCreatingOrders(true);
        try {
            const clientIds = filteredClients.map(c => c.id);
            const res = await bulkCreateProduceOrdersForVendor(clientIds, deliveryDate, token);
            if (!res.success) {
                setCreateOrdersError(res.error || 'Failed to create orders');
                return;
            }

            setLastCreatedOrders(res.orders || []);
            downloadCreatedOrdersExcel(res.orders || [], deliveryDate);
        } catch (e: any) {
            setCreateOrdersError(e?.message || 'Failed to create orders');
        } finally {
            setIsCreatingOrders(false);
        }
    }

    function normalizeHeader(h: string) {
        return (h || '').toLowerCase().replace(/[_\s]/g, '');
    }

    async function handleExcelSelected(file: File) {
        setUploadExcelError('');
        setUploadResult(null);
        try {
            const buf = await file.arrayBuffer();
            const wb = XLSX.read(buf, { type: 'array' });
            const sheetName = wb.SheetNames[0];
            if (!sheetName) {
                setUploadExcelError('Excel file has no sheets.');
                return;
            }
            const ws = wb.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false }) as any[][];
            if (!rows || rows.length < 2) {
                setUploadExcelError('Excel file must have a header row and at least one data row.');
                return;
            }
            const headers = (rows[0] || []).map((v: any) => String(v ?? '').trim()).filter(Boolean);
            if (headers.length === 0) {
                setUploadExcelError('Header row is empty.');
                return;
            }

            setExcelHeaders(headers);
            setExcelRows(rows.slice(1));

            // best-effort default mappings
            const normalized = headers.map(normalizeHeader);
            const orderIdx = normalized.findIndex(h => h === 'ordernumber' || h === 'orderid' || h === 'order');
            const urlIdx = normalized.findIndex(h => h === 'image' || h === 'imageurl' || h === 'proof' || h === 'proofurl' || h === 'deliveryproofurl');
            setOrderNumberColumn(orderIdx >= 0 ? headers[orderIdx] : headers[0]);
            setProofUrlColumn(urlIdx >= 0 ? headers[urlIdx] : (headers[1] || headers[0]));

            setShowUploadExcelModal(true);
        } catch (e: any) {
            setUploadExcelError(e?.message || 'Failed to read Excel file.');
        }
    }

    async function processExcelUpload() {
        setUploadExcelError('');
        setUploadResult(null);

        if (!token) {
            setUploadExcelError('Missing vendor token.');
            return;
        }
        if (!orderNumberColumn || !proofUrlColumn) {
            setUploadExcelError('Please select both columns.');
            return;
        }

        const orderIdx = excelHeaders.indexOf(orderNumberColumn);
        const urlIdx = excelHeaders.indexOf(proofUrlColumn);
        if (orderIdx < 0 || urlIdx < 0) {
            setUploadExcelError('Invalid column selection.');
            return;
        }

        const updates = excelRows
            .map((r, i) => {
                const orderNumber = String(r?.[orderIdx] ?? '').trim();
                const proofUrl = String(r?.[urlIdx] ?? '').trim();
                return { orderNumber, proofUrl, _row: i + 2 };
            })
            .filter(u => u.orderNumber && u.proofUrl);

        if (updates.length === 0) {
            setUploadExcelError('No valid rows found. Make sure the selected columns are filled in.');
            return;
        }

        setIsProcessingExcel(true);
        try {
            const res = await bulkUpdateProduceProofsForVendor(
                updates.map(u => ({ orderNumber: u.orderNumber, proofUrl: u.proofUrl })),
                token
            );
            if (!res.success) {
                setUploadExcelError(res.error || 'Failed to process Excel');
                return;
            }
            setUploadResult({ updated: res.updated, errors: res.errors || [] });
        } catch (e: any) {
            setUploadExcelError(e?.message || 'Failed to process Excel');
        } finally {
            setIsProcessingExcel(false);
        }
    }

    if (invalidToken) {
        return (
            <div className={styles.container}>
                <div className={styles.loadingContainer}>
                    <AlertTriangle size={48} style={{ color: '#ef4444', marginBottom: '1rem' }} />
                    <p style={{ fontSize: '1.2rem', fontWeight: 600 }}>Invalid or expired link</p>
                    <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem' }}>The produce vendor link you followed is not valid. Please check the URL or contact the administrator.</p>
                </div>
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className={styles.container}>
                <div className={styles.loadingContainer}>
                    <div className="spinner"></div>
                    <p>Loading produce clients...</p>
                </div>
            </div>
        );
    }

    const pageTitle = isExternalView ? `Produce - ${tokenVendor!.name}` : 'Produce Clients';
    const subtitle = isExternalView
        ? `Clients assigned to ${tokenVendor!.name}`
        : 'Clients and dependants with Service Type: Produce';

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flex: 1 }}>
                    <h1 className={styles.title}>
                        <Package size={24} style={{ marginRight: '12px', verticalAlign: 'middle' }} />
                        {pageTitle}
                    </h1>
                    <div style={{ display: 'flex', gap: '1rem' }}>
                        {isExternalView && (
                            <button
                                className="btn btn-primary"
                                onClick={() => {
                                    setCreateOrdersError('');
                                    setShowCreateOrdersModal(true);
                                }}
                                style={{ padding: '0.75rem 1.5rem', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                            >
                                <PlusCircle size={20} /> Create Orders
                            </button>
                        )}
                        {isExternalView && (
                            <>
                                <input
                                    type="file"
                                    accept=".xlsx,.xls"
                                    style={{ display: 'none' }}
                                    id="produce-upload-excel"
                                    onChange={async e => {
                                        const file = e.target.files?.[0];
                                        e.target.value = '';
                                        if (file) await handleExcelSelected(file);
                                    }}
                                />
                                <button
                                    className="btn btn-secondary"
                                    onClick={() => {
                                        setUploadExcelError('');
                                        setUploadResult(null);
                                        const el = document.getElementById('produce-upload-excel') as HTMLInputElement | null;
                                        el?.click();
                                    }}
                                    style={{ padding: '0.75rem 1.5rem', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                                >
                                    <Download size={20} /> Upload Excel
                                </button>
                            </>
                        )}
                        <button
                            className="btn btn-secondary"
                            onClick={exportLabelsPDF}
                            style={{ padding: '0.75rem 1.5rem', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                        >
                            <FileText size={20} /> Download Labels
                        </button>
                    </div>
                </div>
            </div>

            {showCreateOrdersModal && (
                <div className={styles.importModalOverlay} onClick={() => !isCreatingOrders && setShowCreateOrdersModal(false)}>
                    <div className={styles.importModal} onClick={e => e.stopPropagation()}>
                        <div className={styles.importModalHeader}>
                            <h3>Create Produce Orders</h3>
                            <button
                                className={styles.closeButton}
                                onClick={() => !isCreatingOrders && setShowCreateOrdersModal(false)}
                                aria-label="Close"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <div className={styles.importModalContent}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                <label style={{ fontWeight: 600 }}>Delivery Date</label>
                                <input
                                    className="input"
                                    type="date"
                                    value={deliveryDate}
                                    onChange={e => setDeliveryDate(e.target.value)}
                                    disabled={isCreatingOrders}
                                />
                                <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                                    This will create 1 Produce order per client in the current list ({filteredClients.length}).
                                </div>
                            </div>

                            {createOrdersError && (
                                <div style={{ color: '#ef4444', fontWeight: 600 }}>{createOrdersError}</div>
                            )}

                            {lastCreatedOrders && (
                                <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '0.75rem' }}>
                                    <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>
                                        Created {lastCreatedOrders.length} orders
                                    </div>
                                    <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                                        The Excel file should have downloaded automatically.
                                    </div>
                                    <button
                                        className="btn btn-secondary"
                                        style={{ marginTop: '0.75rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                                        onClick={() => downloadCreatedOrdersExcel(lastCreatedOrders, deliveryDate)}
                                    >
                                        <Download size={18} /> Re-download Excel
                                    </button>
                                </div>
                            )}

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                                <button
                                    className="btn btn-secondary"
                                    disabled={isCreatingOrders}
                                    onClick={() => setShowCreateOrdersModal(false)}
                                >
                                    Cancel
                                </button>
                                <button
                                    className="btn btn-primary"
                                    disabled={isCreatingOrders}
                                    onClick={handleCreateOrders}
                                >
                                    {isCreatingOrders ? 'Creating…' : 'Create Orders'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {showUploadExcelModal && (
                <div className={styles.importModalOverlay} onClick={() => !isProcessingExcel && setShowUploadExcelModal(false)}>
                    <div className={styles.importModal} onClick={e => e.stopPropagation()}>
                        <div className={styles.importModalHeader}>
                            <h3>Upload Excel (Proof of Delivery)</h3>
                            <button
                                className={styles.closeButton}
                                onClick={() => !isProcessingExcel && setShowUploadExcelModal(false)}
                                aria-label="Close"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <div className={styles.importModalContent}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                                    Select which columns contain the order numbers and the image/proof URLs. This will attach the URL as proof of delivery and mark orders delivered. No SMS will be sent.
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                        <label style={{ fontWeight: 600 }}>Order Number column</label>
                                        <select
                                            className="input"
                                            value={orderNumberColumn}
                                            disabled={isProcessingExcel}
                                            onChange={e => setOrderNumberColumn(e.target.value)}
                                        >
                                            {excelHeaders.map(h => (
                                                <option key={h} value={h}>{h}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                                        <label style={{ fontWeight: 600 }}>Image URL column</label>
                                        <select
                                            className="input"
                                            value={proofUrlColumn}
                                            disabled={isProcessingExcel}
                                            onChange={e => setProofUrlColumn(e.target.value)}
                                        >
                                            {excelHeaders.map(h => (
                                                <option key={h} value={h}>{h}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                                <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                                    Rows detected: {excelRows.length}
                                </div>
                            </div>

                            {uploadExcelError && (
                                <div style={{ color: '#ef4444', fontWeight: 600 }}>{uploadExcelError}</div>
                            )}

                            {uploadResult && (
                                <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', padding: '0.75rem' }}>
                                    <div style={{ fontWeight: 700, marginBottom: '0.25rem' }}>
                                        Updated {uploadResult.updated} orders
                                    </div>
                                    {uploadResult.errors.length > 0 ? (
                                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                                            {uploadResult.errors.length} errors. First 10 shown:
                                            <ul style={{ marginTop: '0.5rem', paddingLeft: '1.25rem' }}>
                                                {uploadResult.errors.slice(0, 10).map((err, idx) => (
                                                    <li key={idx} style={{ marginBottom: '0.25rem' }}>{err}</li>
                                                ))}
                                            </ul>
                                        </div>
                                    ) : (
                                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                                            No errors.
                                        </div>
                                    )}
                                </div>
                            )}

                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                                <button
                                    className="btn btn-secondary"
                                    disabled={isProcessingExcel}
                                    onClick={() => setShowUploadExcelModal(false)}
                                >
                                    Close
                                </button>
                                <button
                                    className="btn btn-primary"
                                    disabled={isProcessingExcel}
                                    onClick={processExcelUpload}
                                >
                                    {isProcessingExcel ? 'Processing…' : 'Process'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Clients Section */}
            <div className={styles.ordersSection}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--spacing-lg)', flexWrap: 'wrap', gap: '0.75rem' }}>
                    <h2 className={styles.sectionTitle}>{subtitle}</h2>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        {!isExternalView && produceVendors.length > 0 && (
                            <select
                                className="input"
                                style={{ width: '200px' }}
                                value={vendorFilter}
                                onChange={e => setVendorFilter(e.target.value)}
                            >
                                <option value="all">All Vendors</option>
                                {produceVendors.filter(pv => pv.isActive).map(pv => (
                                    <option key={pv.id} value={pv.id}>{pv.name}</option>
                                ))}
                                <option value="unassigned">Unassigned</option>
                            </select>
                        )}
                        <div style={{ position: 'relative' }}>
                            <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
                            <input
                                className="input"
                                placeholder="Search clients..."
                                style={{ paddingLeft: '2.5rem', width: '300px' }}
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                            />
                        </div>
                    </div>
                </div>

                {filteredClients.length === 0 ? (
                    <div className={styles.emptyState}>
                        <User size={48} style={{ color: 'var(--text-tertiary)', marginBottom: '1rem' }} />
                        <p>{search ? 'No clients found matching your search.' : 'No produce clients found.'}</p>
                    </div>
                ) : (
                    <div className={styles.ordersList}>
                        <div className={styles.ordersHeader}>
                            <span style={{ flex: '2 1 200px', minWidth: 0 }}>Client Name</span>
                            <span style={{ flex: '1.5 1 150px', minWidth: 0 }}>Email</span>
                            <span style={{ flex: '1 1 120px', minWidth: 0 }}>Phone</span>
                            <span style={{ flex: '2 1 250px', minWidth: 0 }}>Address</span>
                            {showVendorColumn && (
                                <span style={{ flex: '1 1 120px', minWidth: 0 }}>Vendor</span>
                            )}
                        </div>

                        {filteredClients.map(client => {
                            const parent = client.parentClientId ? allClients.find(c => c.id === client.parentClientId) : null;
                            const isDependent = !!client.parentClientId;
                            return (
                                <div
                                    key={client.id}
                                    className={styles.orderRow}
                                    onClick={() => !isExternalView ? router.push(`/clients/${client.id}`) : undefined}
                                    style={{ cursor: isExternalView ? 'default' : 'pointer' }}
                                >
                                    <span style={{ flex: '2 1 200px', minWidth: 0, fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                        <User size={16} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
                                        {client.fullName}
                                        {isDependent && (
                                            <span className="badge" style={{ backgroundColor: 'var(--text-tertiary)', color: 'var(--bg-panel)', fontWeight: 500 }}>
                                                Dependent{parent ? ` of ${parent.fullName}` : ''}
                                            </span>
                                        )}
                                    </span>
                                    <span style={{ flex: '1.5 1 150px', minWidth: 0, fontSize: '0.9rem' }}>
                                        {client.email || '-'}
                                    </span>
                                    <span style={{ flex: '1 1 120px', minWidth: 0, fontSize: '0.9rem' }}>
                                        {client.phoneNumber || '-'}
                                    </span>
                                    <span style={{ flex: '2 1 250px', minWidth: 0, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                        {getClientAddress(client.id)}
                                    </span>
                                    {showVendorColumn && (
                                        <span style={{ flex: '1 1 120px', minWidth: 0 }}>
                                            <span className="badge badge-info">{getProduceVendorName(client)}</span>
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
