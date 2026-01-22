'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Search, ChevronRight, Package, ArrowLeft, Loader2 } from 'lucide-react';
import { getOrdersPaginated } from '@/lib/actions';
import styles from './OrdersList.module.css';

export function OrdersList() {
    const router = useRouter();
    const [orders, setOrders] = useState<any[]>([]);
    const [search, setSearch] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(0);
    const PAGE_SIZE = 20;

    useEffect(() => {
        loadData();
    }, [page]);

    async function loadData() {
        setIsLoading(true);
        try {
            console.log('[OrdersList] Loading orders, page:', page);
            const { orders, total } = await getOrdersPaginated(page, PAGE_SIZE);
            console.log('[OrdersList] Received orders:', orders.length, 'total:', total);
            setOrders(orders);
            setTotal(total);
        } catch (error) {
            console.error('[OrdersList] Failed to load orders:', error);
            setOrders([]);
            setTotal(0);
        } finally {
            setIsLoading(false);
        }
    }

    const filteredOrders = orders.filter(o => {
        const matchesSearch =
            (o.clientName || '').toLowerCase().includes(search.toLowerCase()) ||
            (o.order_number || '').toString().includes(search);
        return matchesSearch;
    });

    const getStatusStyle = (status: string) => {
        switch (status) {
            case 'pending': return styles.statusPending;
            case 'confirmed': return styles.statusConfirmed;
            case 'completed': return styles.statusCompleted;
            case 'waiting_for_proof': return styles.statusWaitProof;
            case 'billing_pending': return styles.statusBilling;
            case 'cancelled': return styles.statusCancelled;
            case 'scheduled': return styles.statusConfirmed;
            default: return '';
        }
    };

    const formatStatus = (status: string) => {
        if (!status) return 'UNKNOWN';
        return status.replace(/_/g, ' ').toUpperCase();
    };

    if (isLoading && page === 1) {
        return (
            <div className={styles.container}>
                <div className={styles.header}>
                    <h1 className={styles.title}>All Orders</h1>
                </div>
                <div className={styles.loadingContainer}>
                    <Loader2 className="animate-spin" size={32} />
                    <p>Loading orders...</p>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h1 className={styles.title}>All Orders</h1>
                <div className={styles.headerActions}>
                    <div className={styles.viewToggle}>
                        <button
                            className={styles.viewBtn}
                            onClick={() => router.push('/clients')}
                        >
                            All Clients
                        </button>
                        <button
                            className={styles.viewBtn}
                            onClick={() => router.push('/clients?view=eligible')}
                        >
                            Eligible
                        </button>
                        <button
                            className={styles.viewBtn}
                            onClick={() => router.push('/clients?view=ineligible')}
                        >
                            Ineligible
                        </button>
                        <button
                            className={styles.viewBtn}
                            onClick={() => router.push('/billing')}
                        >
                            Billing
                        </button>
                        <button
                            className={`${styles.viewBtn} ${styles.viewBtnActive}`}
                            onClick={() => router.push('/orders')}
                        >
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
                        placeholder="Search by client or order #..."
                        style={{ paddingLeft: '2.5rem', width: '300px' }}
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                </div>
            </div>

            <div className={styles.list}>
                <div className={styles.listHeader}>
                    <span style={{ width: '100px' }}>Order #</span>
                    <span style={{ flex: 2 }}>Client</span>
                    <span style={{ flex: 1 }}>Service</span>
                    <span style={{ flex: 1 }}>Items</span>
                    <span style={{ flex: 1.5 }}>Status</span>
                    <span style={{ flex: 1.5 }}>Delivery Date</span>
                    <span style={{ width: '40px' }}></span>
                </div>
                {filteredOrders.map(order => (
                    <Link key={order.id} href={`/orders/${order.id}`} className={styles.row}>
                        <span style={{ width: '100px', fontWeight: 600 }}>{order.order_number || 'N/A'}</span>
                        <span style={{ flex: 2 }}>{order.clientName}</span>
                        <span style={{ flex: 1 }}>{order.service_type}</span>
                        <span style={{ flex: 1, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                            {order.total_items !== null && order.total_items !== undefined ? `${order.total_items} item${order.total_items !== 1 ? 's' : ''}` : '-'}
                        </span>
                        <span style={{ flex: 1.5 }}>
                            <span className={getStatusStyle(order.status)}>
                                {formatStatus(order.status)}
                            </span>
                        </span>
                        <span style={{ flex: 1.5, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                            {order.scheduled_delivery_date ? new Date(order.scheduled_delivery_date).toLocaleDateString('en-US', { timeZone: 'UTC' }) : '-'}
                        </span>
                        <span style={{ width: '40px' }}><ChevronRight size={16} /></span>
                    </Link>
                ))}
                {filteredOrders.length === 0 && (
                    <div className={styles.empty}>No orders found.</div>
                )}
            </div>

            {total > PAGE_SIZE && (
                <div style={{ display: 'flex', justifyContent: 'center', gap: '1rem', marginTop: '2rem' }}>
                    <button
                        className="btn btn-secondary"
                        disabled={page === 1}
                        onClick={() => setPage(p => p - 1)}
                    >
                        Previous
                    </button>
                    <span style={{ alignSelf: 'center', fontSize: '0.9rem' }}>Page {page} of {Math.ceil(total / PAGE_SIZE)}</span>
                    <button
                        className="btn btn-secondary"
                        disabled={page * PAGE_SIZE >= total}
                        onClick={() => setPage(p => p + 1)}
                    >
                        Next
                    </button>
                </div>
            )}
        </div>
    );
}
