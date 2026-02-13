'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Search, ChevronRight, ArrowUpDown, Trash2, Loader2, ChevronLeft } from 'lucide-react';
import { getOrdersPaginatedBilling, deleteOrder } from '@/lib/actions-orders-billing';
import { LoadingIndicator } from '@/components/ui/LoadingIndicator';
import styles from './OrdersList.module.css';

const SEARCH_DEBOUNCE_MS = 350;

export function OrdersList() {
    const router = useRouter();
    const PAGE_SIZE_OPTIONS = [50, 100, 250, 500] as const;
    const [orders, setOrders] = useState<any[]>([]);
    const [total, setTotal] = useState(0);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(50);
    const [search, setSearch] = useState('');
    const [searchForFetch, setSearchForFetch] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [creationIdFilter, setCreationIdFilter] = useState('');
    const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedOrders, setSelectedOrders] = useState<Set<string>>(new Set());
    const [isDeleting, setIsDeleting] = useState(false);
    const [goToPageInput, setGoToPageInput] = useState('');
    const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
        searchDebounceRef.current = setTimeout(() => {
            setSearchForFetch(search);
            setPage(1);
            searchDebounceRef.current = null;
        }, SEARCH_DEBOUNCE_MS);
        return () => {
            if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
        };
    }, [search]);

    useEffect(() => {
        setPage(1);
    }, [statusFilter, creationIdFilter]);

    const loadData = useCallback(async (pageNum: number) => {
        setIsLoading(true);
        try {
            const { orders: data, total: totalCount } = await getOrdersPaginatedBilling(pageNum, pageSize, {
                search: searchForFetch || undefined,
                statusFilter: statusFilter !== 'all' ? statusFilter : undefined,
                creationIdFilter: creationIdFilter.trim() || undefined,
            });
            setOrders(data);
            setTotal(totalCount);
        } catch (error) {
            console.error('Failed to load orders:', error);
        } finally {
            setIsLoading(false);
        }
    }, [pageSize, searchForFetch, statusFilter, creationIdFilter]);

    useEffect(() => {
        loadData(page);
    }, [page, loadData]);

    const handleSort = (key: string) => {
        const direction = sortConfig?.key === key && sortConfig.direction === 'asc' ? 'desc' : 'asc';
        setSortConfig({ key, direction });
    };

    const sortedOrders = [...orders].sort((a, b) => {
        if (!sortConfig) return 0;
        let aVal: any = a[sortConfig.key];
        let bVal: any = b[sortConfig.key];
        if (sortConfig.key === 'items') {
            aVal = a.total_items ?? 0;
            bVal = b.total_items ?? 0;
        } else if (sortConfig.key === 'deliveryDate') {
            aVal = new Date(a.scheduled_delivery_date || 0).getTime();
            bVal = new Date(b.scheduled_delivery_date || 0).getTime();
        } else if (sortConfig.key === 'order_number') {
            aVal = Number(a.order_number ?? 0);
            bVal = Number(b.order_number ?? 0);
        } else if (sortConfig.key === 'vendors') {
            aVal = (a.vendorNames || []).join(', ') || '';
            bVal = (b.vendorNames || []).join(', ') || '';
        }
        if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
    });

    const filteredOrders = sortedOrders;

    const getStatusStyle = (status: string) => {
        switch (status) {
            case 'pending': return styles.statusPending;
            case 'confirmed': return styles.statusConfirmed;
            case 'completed': return styles.statusCompleted;
            case 'waiting_for_proof': return styles.statusWaitProof;
            case 'billing_pending': return styles.statusBilling;
            case 'cancelled': return styles.statusCancelled;
            default: return '';
        }
    };

    const formatStatus = (status: string) => (status ? status.replace(/_/g, ' ').toUpperCase() : 'UNKNOWN');

    const handleSelectOrder = (orderId: string) => {
        const next = new Set(selectedOrders);
        if (next.has(orderId)) next.delete(orderId);
        else next.add(orderId);
        setSelectedOrders(next);
    };

    const handleSelectAll = () => {
        setSelectedOrders(
            selectedOrders.size === filteredOrders.length ? new Set() : new Set(filteredOrders.map((o) => o.id))
        );
    };

    const handleDeleteSelected = async () => {
        if (selectedOrders.size === 0) return;
        if (!window.confirm(`Delete ${selectedOrders.size} order(s)? This cannot be undone.`)) return;
        setIsDeleting(true);
        try {
            const ids = Array.from(selectedOrders);
            let ok = 0,
                fail = 0;
            for (const id of ids) {
                const r = await deleteOrder(id);
                if (r.success) ok++;
                else fail++;
            }
            setSelectedOrders(new Set());
            await loadData(page);
            if (fail === 0) alert(`Deleted ${ok} order(s).`);
            else alert(`Deleted ${ok}. Failed: ${fail}.`);
        } catch (e) {
            console.error(e);
            alert('Error deleting orders.');
        } finally {
            setIsDeleting(false);
        }
    };

    if (isLoading) {
        return (
            <div className={styles.container}>
                <div className={styles.header}>
                    <h1 className={styles.title}>All Orders</h1>
                </div>
                <LoadingIndicator message="Loading orders..." />
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h1 className={styles.title}>All Orders</h1>
                <div className={styles.headerActions}>
                    <div className={styles.viewToggle}>
                        <button type="button" className={styles.viewBtn} onClick={() => router.push('/clients')}>
                            All Clients
                        </button>
                        <button type="button" className={styles.viewBtn} onClick={() => router.push('/clients?view=eligible')}>
                            Eligible
                        </button>
                        <button type="button" className={styles.viewBtn} onClick={() => router.push('/clients?view=ineligible')}>
                            Ineligible
                        </button>
                        <button type="button" className={styles.viewBtn} onClick={() => router.push('/clients?view=needs-attention')}>
                            Needs Attention
                        </button>
                        <button type="button" className={styles.viewBtn} onClick={() => router.push('/billing')}>
                            Billing
                        </button>
                        <button type="button" className={`${styles.viewBtn} ${styles.viewBtnActive}`} onClick={() => router.push('/orders')}>
                            Orders
                        </button>
                    </div>
                </div>
            </div>

            <div className={styles.filters}>
                <div className={styles.searchBox}>
                    <Search size={18} className={styles.searchIcon} />
                    <input
                        className="input"
                        placeholder="Search by client, order # or vendor..."
                        style={{ paddingLeft: '2.5rem', width: '300px' }}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
                <select className="input" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: '200px' }}>
                    <option value="all">All Statuses</option>
                    <option value="pending">Pending</option>
                    <option value="confirmed">Confirmed</option>
                    <option value="completed">Completed</option>
                    <option value="cancelled">Cancelled</option>
                </select>
                <input
                    className="input"
                    type="number"
                    placeholder="Creation ID"
                    style={{ width: '180px' }}
                    value={creationIdFilter}
                    onChange={(e) => setCreationIdFilter(e.target.value)}
                    min={1}
                />
                <label style={{ display: 'flex', alignItems: 'center', fontSize: '0.9rem', color: 'var(--text-secondary, #555)' }}>
                    Show
                    <select
                        className="input"
                        value={pageSize}
                        onChange={(e) => {
                            const val = Number(e.target.value);
                            setPageSize(val);
                            setPage(1);
                        }}
                        style={{ width: '72px', marginLeft: '6px', marginRight: '6px' }}
                        aria-label="Rows per page"
                    >
                        {PAGE_SIZE_OPTIONS.map((n) => (
                            <option key={n} value={n}>{n}</option>
                        ))}
                    </select>
                    per page
                </label>
                <button type="button" className="btn btn-secondary" onClick={handleSelectAll} style={{ marginLeft: 'auto' }}>
                    {selectedOrders.size === filteredOrders.length && filteredOrders.length > 0 ? 'Deselect All' : 'Select All'}
                </button>
                {selectedOrders.size > 0 && (
                    <button
                        type="button"
                        className="btn btn-danger"
                        onClick={handleDeleteSelected}
                        disabled={isDeleting}
                        style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                    >
                        <Trash2 size={16} />
                        {isDeleting ? 'Deleting...' : `Delete Selected (${selectedOrders.size})`}
                    </button>
                )}
            </div>

            <div className={styles.list}>
                <div className={styles.listHeader}>
                    <span style={{ width: '50px' }} />
                    <span style={{ width: '40px', fontWeight: 'bold' }}>#</span>
                    <span style={{ width: '100px', cursor: 'pointer', display: 'flex', alignItems: 'center', minWidth: 0 }} onClick={() => handleSort('order_number')}>
                        Order # <ArrowUpDown size={14} style={{ marginLeft: 4 }} />
                    </span>
                    <span style={{ flex: 2, cursor: 'pointer', display: 'flex', alignItems: 'center', minWidth: 0 }} onClick={() => handleSort('clientName')}>
                        Client <ArrowUpDown size={14} style={{ marginLeft: 4 }} />
                    </span>
                    <span style={{ flex: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', minWidth: 0 }} onClick={() => handleSort('service_type')}>
                        Service <ArrowUpDown size={14} style={{ marginLeft: 4 }} />
                    </span>
                    <span style={{ flex: 1.5, cursor: 'pointer', display: 'flex', alignItems: 'center', minWidth: 0 }} onClick={() => handleSort('vendors')}>
                        Vendors <ArrowUpDown size={14} style={{ marginLeft: 4 }} />
                    </span>
                    <span style={{ flex: 1, cursor: 'pointer', display: 'flex', alignItems: 'center', minWidth: 0 }} onClick={() => handleSort('items')}>
                        Items <ArrowUpDown size={14} style={{ marginLeft: 4 }} />
                    </span>
                    <span style={{ flex: 1.5, cursor: 'pointer', display: 'flex', alignItems: 'center', minWidth: 0 }} onClick={() => handleSort('status')}>
                        Status <ArrowUpDown size={14} style={{ marginLeft: 4 }} />
                    </span>
                    <span style={{ flex: 1.5, cursor: 'pointer', display: 'flex', alignItems: 'center', minWidth: 0 }} onClick={() => handleSort('deliveryDate')}>
                        Delivery Date <ArrowUpDown size={14} style={{ marginLeft: 4 }} />
                    </span>
                    <span style={{ width: '40px' }} />
                </div>
                {filteredOrders.map((order, index) => (
                    <div
                        key={order.id}
                        className={styles.row}
                        onClick={() => router.push(`/orders/${order.id}`)}
                        style={{ cursor: 'pointer' }}
                    >
                        <span
                            style={{ width: '50px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                            onClick={(e) => { e.stopPropagation(); handleSelectOrder(order.id); }}
                        >
                            <input
                                type="checkbox"
                                checked={selectedOrders.has(order.id)}
                                onChange={() => handleSelectOrder(order.id)}
                                onClick={(e) => e.stopPropagation()}
                                style={{ cursor: 'pointer', width: 18, height: 18 }}
                            />
                        </span>
                        <span style={{ width: '40px', fontWeight: 'bold', color: 'var(--text-secondary)' }}>{(page - 1) * pageSize + index + 1}</span>
                        <span style={{ width: '100px', fontWeight: 600 }}>{order.order_number ?? 'N/A'}</span>
                        <span style={{ flex: 2 }}>{order.clientName}</span>
                        <span style={{ flex: 1 }}>{order.service_type}</span>
                        <span style={{ flex: 1.5, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                            {(order.vendorNames || ['Unknown']).join(', ')}
                        </span>
                        <span style={{ flex: 1, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                            {order.total_items != null ? `${order.total_items} item(s)` : '-'}
                        </span>
                        <span style={{ flex: 1.5 }}>
                            <span className={getStatusStyle(order.status)}>{formatStatus(order.status)}</span>
                        </span>
                        <span style={{ flex: 1.5, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                            {order.scheduled_delivery_date ? new Date(order.scheduled_delivery_date).toLocaleDateString('en-US', { timeZone: 'America/New_York' }) : '-'}
                        </span>
                        <span style={{ width: '40px' }}><ChevronRight size={16} /></span>
                    </div>
                ))}
                {filteredOrders.length === 0 && <div className={styles.empty}>No orders found.</div>}
            </div>

            {total > 0 && (() => {
                const maxPage = Math.ceil(total / pageSize) || 1;
                const goToPage = () => {
                    const num = parseInt(goToPageInput, 10);
                    if (!Number.isNaN(num) && num >= 1 && num <= maxPage) {
                        setPage(num);
                        setGoToPageInput('');
                    }
                };
                return (
                    <div className={styles.pagination}>
                        <span className={styles.paginationInfo}>
                            Page {page} of {maxPage} ({total} total)
                        </span>
                        <div className={styles.paginationButtons}>
                            <button
                                type="button"
                                className="btn btn-secondary"
                                disabled={page <= 1 || isLoading}
                                onClick={() => setPage((p) => Math.max(1, p - 1))}
                                aria-label="Previous page"
                            >
                                <ChevronLeft size={18} />
                                Previous
                            </button>
                            <span className={styles.goToPage}>
                                <input
                                    type="number"
                                    className={`input ${styles.pageInput}`}
                                    min={1}
                                    max={maxPage}
                                    placeholder="Page"
                                    value={goToPageInput}
                                    onChange={(e) => setGoToPageInput(e.target.value)}
                                    onKeyDown={(e) => e.key === 'Enter' && goToPage()}
                                    aria-label="Go to page"
                                />
                                <button
                                    type="button"
                                    className="btn btn-secondary"
                                    onClick={goToPage}
                                    disabled={isLoading}
                                    aria-label="Go to page"
                                >
                                    Go
                                </button>
                            </span>
                            <button
                                type="button"
                                className="btn btn-primary"
                                disabled={page >= maxPage || isLoading}
                                onClick={() => setPage((p) => Math.min(maxPage, p + 1))}
                                aria-label="Next page"
                            >
                                Next
                                <ChevronRight size={18} />
                            </button>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}
