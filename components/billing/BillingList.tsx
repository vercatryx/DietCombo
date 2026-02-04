'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Search, Download, ChevronDown, ChevronUp, ChevronRight, Image } from 'lucide-react';
import { getBillingRequestsByWeek, type BillingRequest } from '@/lib/actions-orders-billing';
import { getWeekStart, getWeekOptions, getWeekRangeString } from '@/lib/utils-week';
import styles from './BillingList.module.css';

function getProofUrl(order: any): string | null {
    return order.proof_of_delivery_url || order.proof_of_delivery_image || order.delivery_proof_url || null;
}

export function BillingList() {
    const router = useRouter();
    const [billingRequests, setBillingRequests] = useState<BillingRequest[]>([]);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | 'ready' | 'completed' | 'success' | 'failed'>('all');
    const [selectedWeek, setSelectedWeek] = useState<Date | 'all' | null>(null);
    const [expandedRequest, setExpandedRequest] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [weekOptions, setWeekOptions] = useState<Date[]>([]);
    const [statusDropdownOpen, setStatusDropdownOpen] = useState<string | null>(null);
    const selectedWeekRef = useRef<Date | 'all' | null>(null);

    useEffect(() => {
        selectedWeekRef.current = selectedWeek;
    }, [selectedWeek]);

    useEffect(() => {
        setWeekOptions(getWeekOptions(8, 2));
        setSelectedWeek(getWeekStart(new Date()));
    }, []);

    useEffect(() => {
        if (selectedWeek) loadData();
    }, [selectedWeek]);

    async function loadData() {
        if (!selectedWeek) return;
        const weekKey = selectedWeek === 'all' ? 'all' : selectedWeek.getTime();
        setIsLoading(true);
        try {
            const weekArg = selectedWeek === 'all' ? undefined : selectedWeek;
            const data = await getBillingRequestsByWeek(weekArg);
            if (selectedWeekRef.current === 'all' ? 'all' : selectedWeekRef.current?.getTime() === weekKey) {
                setBillingRequests(data);
            }
        } catch (e) {
            console.error('Error loading billing requests:', e);
        } finally {
            const current = selectedWeekRef.current;
            const currentKey = !current ? null : current === 'all' ? 'all' : current.getTime();
            if (currentKey === weekKey) setIsLoading(false);
        }
    }

    const filteredRequests = billingRequests.filter((req) => {
        const matchesSearch = (req.clientName || '').toLowerCase().includes(search.toLowerCase());
        let matchesStatus = true;
        if (statusFilter === 'ready') matchesStatus = req.readyForBilling && !req.billingCompleted;
        else if (statusFilter === 'completed') matchesStatus = req.billingCompleted;
        else if (statusFilter === 'success') matchesStatus = req.billingStatus === 'success';
        else if (statusFilter === 'failed') matchesStatus = req.billingStatus === 'failed';
        return matchesSearch && matchesStatus;
    });

    const getRequestKey = (req: BillingRequest) => `${req.clientId}-${req.weekStart}`;
    const getStatusLabel = (status: 'success' | 'failed' | 'pending', ready: boolean, completed: boolean) => {
        if (status === 'success') return { label: 'Billing Success', class: styles.statusSuccess };
        if (status === 'failed') return { label: 'Billing Failed', class: styles.statusFailed };
        if (completed) return { label: 'Billing Completed', class: styles.statusSuccess };
        if (ready) return { label: 'Ready for Billing', class: styles.statusReady };
        return { label: 'Waiting for Proof', class: styles.statusPending };
    };

    const updateStatus = async (orderIds: string[], status: string) => {
        try {
            const res = await fetch('/api/update-order-billing-status', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ orderIds, status }),
            });
            const result = await res.json();
            if (result.success) {
                setStatusDropdownOpen(null);
                if (selectedWeek) loadData();
            } else {
                alert(`Failed: ${result.error || 'Unknown error'}`);
            }
        } catch (err: any) {
            console.error(err);
            alert(err.message || 'Failed to update status');
        }
    };

    if (isLoading && !selectedWeek) {
        return (
            <div className={styles.container}>
                <div className={styles.header}><h1 className={styles.title}>Billing Records</h1></div>
                <div className={styles.loadingContainer}><div className="spinner" /><p>Loading billing records...</p></div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h1 className={styles.title}>Billing Records</h1>
                <div className={styles.headerActions}>
                    <div className={styles.viewToggle}>
                        <button type="button" className={styles.viewBtn} onClick={() => router.push('/clients')}>All Clients</button>
                        <button type="button" className={styles.viewBtn} onClick={() => router.push('/clients?view=eligible')}>Eligible</button>
                        <button type="button" className={styles.viewBtn} onClick={() => router.push('/clients?view=ineligible')}>Ineligible</button>
                        <button type="button" className={`${styles.viewBtn} ${styles.viewBtnActive}`} onClick={() => router.push('/billing')}>Billing</button>
                        <button type="button" className={styles.viewBtn} onClick={() => router.push('/orders')}>Orders</button>
                    </div>
                    <button type="button" className="btn btn-secondary"><Download size={16} /> Export CSV</button>
                </div>
            </div>

            <div className={styles.filters}>
                <div className={styles.searchBox}>
                    <Search size={18} className={styles.searchIcon} />
                    <input className="input" placeholder="Search by client name..." style={{ paddingLeft: '2.5rem', width: 400 }} value={search} onChange={(e) => setSearch(e.target.value)} />
                </div>
                <label className="label" style={{ marginBottom: 0, whiteSpace: 'nowrap' }}>Week:</label>
                <select
                    className="input"
                    style={{ width: 250 }}
                    value={selectedWeek === 'all' ? 'all' : selectedWeek?.toISOString() ?? ''}
                    onChange={(e) => { const v = e.target.value; if (v) setSelectedWeek(v === 'all' ? 'all' : new Date(v)); }}
                >
                    <option value="all">All weeks</option>
                    {weekOptions.map((week, idx) => (
                        <option key={idx} value={week.toISOString()}>
                            {getWeekRangeString(week)} {getWeekStart(new Date()).getTime() === week.getTime() ? '(Current)' : ''}
                        </option>
                    ))}
                </select>
                <label className="label" style={{ marginBottom: 0 }}>Filter Status:</label>
                <select className="input" style={{ width: 180 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as any)}>
                    <option value="all">All</option>
                    <option value="ready">Ready for Billing</option>
                    <option value="completed">Billing Completed</option>
                    <option value="success">Billing Success</option>
                    <option value="failed">Billing Failed</option>
                </select>
            </div>

            <div className={styles.list}>
                <div className={styles.listHeader}>
                    <span style={{ flex: 2 }}>Client Name</span>
                    <span style={{ flex: 1.5 }}>Week Range</span>
                    <span style={{ flex: 1 }}>Orders</span>
                    <span style={{ flex: 1 }}>Total Amount</span>
                    <span style={{ flex: 1.5 }}>Status</span>
                    <span style={{ width: 40 }} />
                </div>
                {filteredRequests.map((request) => {
                    const requestKey = getRequestKey(request);
                    const isExpanded = expandedRequest === requestKey;
                    const ordersStatus = getStatusLabel(request.billingStatus, request.readyForBilling, request.billingCompleted);
                    const equipmentStatus = getStatusLabel(request.equipmentBillingStatus, request.equipmentReadyForBilling, request.equipmentBillingCompleted);
                    const hasEquipment = (request.equipmentOrders?.length ?? 0) > 0;
                    const hasOrders = (request.orders?.length ?? 0) > 0;

                    return (
                        <div key={requestKey}>
                            <div className={styles.requestRow} onClick={() => setExpandedRequest(isExpanded ? null : requestKey)}>
                                <span style={{ flex: 2, fontWeight: 600 }}>{request.clientName || 'Unknown'}</span>
                                <span style={{ flex: 1.5, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>{request.weekRange}</span>
                                <span style={{ flex: 1 }}>{request.orderCount}</span>
                                <span style={{ flex: 1, fontWeight: 600 }}>${request.totalAmount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                <span style={{ flex: 1.5, position: 'relative', display: 'flex', flexDirection: 'column', gap: 2 }}>
                                    {hasOrders && (
                                        <span
                                            className={ordersStatus.class}
                                            style={{ cursor: hasEquipment ? 'default' : 'pointer', fontSize: '0.85rem' }}
                                            onClick={(e) => { if (!hasEquipment) { e.stopPropagation(); setStatusDropdownOpen(statusDropdownOpen === requestKey ? null : requestKey); } }}
                                        >
                                            {hasEquipment ? 'Food/Meal: ' : ''}{ordersStatus.label.toUpperCase()}
                                        </span>
                                    )}
                                    {hasEquipment && (
                                        <span className={equipmentStatus.class} style={{ cursor: 'pointer', fontSize: '0.85rem' }} onClick={(e) => { e.stopPropagation(); setStatusDropdownOpen(statusDropdownOpen === requestKey + '-equipment' ? null : requestKey + '-equipment'); }}>
                                            Equipment: {equipmentStatus.label.toUpperCase()}
                                        </span>
                                    )}
                                    {!hasOrders && !hasEquipment && <span className={styles.statusNeutral}>—</span>}
                                    {!hasEquipment && hasOrders && statusDropdownOpen === requestKey && (
                                        <div className={styles.statusDropdown} onClick={(e) => e.stopPropagation()}>
                                            <select className="input" style={{ width: '100%', marginBottom: '0.5rem' }} value={request.orders.every((o) => o.status === 'billing_successful') ? 'billing_successful' : request.orders.some((o) => o.status === 'billing_failed') ? 'billing_failed' : 'billing_pending'} onChange={(e) => updateStatus(request.orders.map((o) => o.id), e.target.value)}>
                                                <option value="billing_pending">Billing Pending</option>
                                                <option value="billing_successful">Billing Successful</option>
                                                <option value="billing_failed">Billing Failed</option>
                                            </select>
                                            <button type="button" className="btn btn-secondary" style={{ width: '100%', fontSize: '0.875rem' }} onClick={() => setStatusDropdownOpen(null)}>Close</button>
                                        </div>
                                    )}
                                    {hasEquipment && statusDropdownOpen === requestKey + '-equipment' && (
                                        <div className={styles.statusDropdown} onClick={(e) => e.stopPropagation()}>
                                            <select className="input" style={{ width: '100%', marginBottom: '0.5rem' }} value={(request.equipmentOrders ?? []).every((o: any) => o.status === 'billing_successful') ? 'billing_successful' : (request.equipmentOrders ?? []).some((o: any) => o.status === 'billing_failed') ? 'billing_failed' : 'billing_pending'} onChange={(e) => updateStatus((request.equipmentOrders ?? []).map((o: any) => o.id), e.target.value)}>
                                                <option value="billing_pending">Billing Pending</option>
                                                <option value="billing_successful">Billing Successful</option>
                                                <option value="billing_failed">Billing Failed</option>
                                            </select>
                                            <button type="button" className="btn btn-secondary" style={{ width: '100%', fontSize: '0.875rem' }} onClick={() => setStatusDropdownOpen(null)}>Close</button>
                                        </div>
                                    )}
                                </span>
                                <span style={{ width: 40 }}>{isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</span>
                            </div>
                            {isExpanded && (
                                <div className={styles.ordersDetail}>
                                    {hasOrders && (
                                        <>
                                            <div className={styles.ordersDetailHeader}>
                                                <h3>Food / Meal / Boxes orders</h3>
                                                <span className={styles.ordersCount}>{request.orders.length} order(s) · ${(request.totalAmount - (request.equipmentTotalAmount ?? 0)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                            </div>
                                            <div className={styles.ordersList}>
                                                <div className={styles.ordersListHeader}>
                                                    <span style={{ width: 100 }}>Order #</span><span style={{ flex: 1 }}>Service</span><span style={{ flex: 1 }}>Amount</span><span style={{ flex: 1.5 }}>Delivery Date</span><span style={{ flex: 1 }}>Status</span><span style={{ flex: 1 }}>Proof</span><span style={{ width: 40 }} />
                                                </div>
                                                {request.orders.map((order) => {
                                                    const deliveryDate = order.actual_delivery_date ? new Date(order.actual_delivery_date).toLocaleDateString('en-US', { timeZone: 'America/New_York' }) : order.scheduled_delivery_date ? new Date(order.scheduled_delivery_date).toLocaleDateString('en-US', { timeZone: 'America/New_York' }) : '-';
                                                    const proofUrl = getProofUrl(order);
                                                    const statusClass = order.status === 'billing_pending' || order.status === 'completed' ? styles.statusSuccess : order.status === 'waiting_for_proof' ? styles.statusPending : styles.statusNeutral;
                                                    return (
                                                        <div key={order.id} className={styles.orderRow}>
                                                            <Link href={`/orders/${order.id}`} style={{ width: 100, fontWeight: 600 }} onClick={(e) => e.stopPropagation()}>{order.order_number ?? 'N/A'}</Link>
                                                            <Link href={`/orders/${order.id}`} style={{ flex: 1 }} onClick={(e) => e.stopPropagation()}>{order.service_type}</Link>
                                                            <Link href={`/orders/${order.id}`} style={{ flex: 1 }} onClick={(e) => e.stopPropagation()}>${(order.amount ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Link>
                                                            <Link href={`/orders/${order.id}`} style={{ flex: 1.5, fontSize: '0.85rem', color: 'var(--text-secondary)' }} onClick={(e) => e.stopPropagation()}>{deliveryDate}</Link>
                                                            <span style={{ flex: 1 }}><span className={statusClass} style={{ fontSize: '0.85rem' }}>{(order.status ?? 'pending').toUpperCase()}</span></span>
                                                            <span style={{ flex: 1 }}>{proofUrl ? <a href={proofUrl} target="_blank" rel="noopener noreferrer" className={styles.proofLink} onClick={(e) => e.stopPropagation()}><Image size={14} /> View Proof</a> : <span style={{ color: 'var(--text-tertiary)' }}>No proof</span>}</span>
                                                            <Link href={`/orders/${order.id}`} style={{ width: 40 }} onClick={(e) => e.stopPropagation()}><ChevronRight size={14} /></Link>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </>
                                    )}
                                    {hasEquipment && (
                                        <>
                                            <div className={styles.ordersDetailHeader}>
                                                <h3>Equipment orders</h3>
                                                <span className={styles.ordersCount}>{(request.equipmentOrders ?? []).length} order(s) · ${(request.equipmentTotalAmount ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                            </div>
                                            <div className={styles.ordersList}>
                                                <div className={styles.ordersListHeader}>
                                                    <span style={{ width: 100 }}>Order #</span><span style={{ flex: 1 }}>Service</span><span style={{ flex: 1 }}>Amount</span><span style={{ flex: 1.5 }}>Delivery Date</span><span style={{ flex: 1 }}>Status</span><span style={{ flex: 1 }}>Proof</span><span style={{ width: 40 }} />
                                                </div>
                                                {(request.equipmentOrders ?? []).map((order: any) => {
                                                    const deliveryDate = order.actual_delivery_date ? new Date(order.actual_delivery_date).toLocaleDateString('en-US', { timeZone: 'America/New_York' }) : order.scheduled_delivery_date ? new Date(order.scheduled_delivery_date).toLocaleDateString('en-US', { timeZone: 'America/New_York' }) : '-';
                                                    const proofUrl = getProofUrl(order);
                                                    return (
                                                        <div key={order.id} className={styles.orderRow}>
                                                            <Link href={`/orders/${order.id}`} style={{ width: 100, fontWeight: 600 }} onClick={(e) => e.stopPropagation()}>{order.order_number ?? 'N/A'}</Link>
                                                            <Link href={`/orders/${order.id}`} style={{ flex: 1 }} onClick={(e) => e.stopPropagation()}>{order.service_type}</Link>
                                                            <Link href={`/orders/${order.id}`} style={{ flex: 1 }} onClick={(e) => e.stopPropagation()}>${(order.amount ?? order.total_value ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Link>
                                                            <Link href={`/orders/${order.id}`} style={{ flex: 1.5, fontSize: '0.85rem' }} onClick={(e) => e.stopPropagation()}>{deliveryDate}</Link>
                                                            <span style={{ flex: 1 }}><span className={styles.statusNeutral} style={{ fontSize: '0.85rem' }}>{(order.status ?? 'pending').toUpperCase()}</span></span>
                                                            <span style={{ flex: 1 }}>{proofUrl ? <a href={proofUrl} target="_blank" rel="noopener noreferrer" className={styles.proofLink} onClick={(e) => e.stopPropagation()}>View Proof</a> : 'No proof'}</span>
                                                            <Link href={`/orders/${order.id}`} style={{ width: 40 }} onClick={(e) => e.stopPropagation()}><ChevronRight size={14} /></Link>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
                {filteredRequests.length === 0 && !isLoading && (
                    <div className={styles.empty}>
                        {selectedWeek && selectedWeek !== 'all' ? `No billing requests for ${getWeekRangeString(selectedWeek)}.` : 'No billing requests found.'}
                    </div>
                )}
                {isLoading && selectedWeek && (
                    <div className={styles.loadingContainer}><div className="spinner" /><p>Loading...</p></div>
                )}
            </div>
        </div>
    );
}
