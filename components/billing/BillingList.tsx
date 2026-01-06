'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Search, ChevronRight, FileText, Download } from 'lucide-react';
import { getBillingOrders } from '@/lib/actions';
import styles from './BillingList.module.css';

export function BillingList() {
    const router = useRouter();
    const [orders, setOrders] = useState<any[]>([]);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<'all' | 'billing_pending' | 'billing_successful'>('all');
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        setIsLoading(true);
        const data = await getBillingOrders();
        setOrders(data);
        setIsLoading(false);
    }

    const filteredOrders = orders.filter(o => {
        const matchesSearch = (o.clientName || '').toLowerCase().includes(search.toLowerCase()) ||
            (o.order_number || '').toString().includes(search);
        const matchesStatus = statusFilter === 'all' || o.billingStatus === statusFilter;
        return matchesSearch && matchesStatus;
    });

    if (isLoading) {
        return (
            <div className={styles.container}>
                <div className={styles.header}>
                    <h1 className={styles.title}>Billing Records</h1>
                </div>
                <div className={styles.loadingContainer}>
                    <div className="spinner"></div>
                    <p>Loading billing records...</p>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h1 className={styles.title}>Billing Records</h1>
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
                            onClick={() => router.push('/clients?view=needs-attention')}
                        >
                            Needs Attention
                        </button>
                        <button
                            className={`${styles.viewBtn} ${styles.viewBtnActive}`}
                            onClick={() => router.push('/billing')}
                        >
                            Billing
                        </button>
                        <button
                            className={styles.viewBtn}
                            onClick={() => router.push('/orders')}
                        >
                            Orders
                        </button>
                    </div>
                    <button className="btn btn-secondary">
                        <Download size={16} /> Export CSV
                    </button>
                </div>
            </div>

            <div className={styles.filters}>
                <div className={styles.searchBox}>
                    <Search size={18} className={styles.searchIcon} />
                    <input
                        className="input"
                        placeholder="Search by client or order #..."
                        style={{ paddingLeft: '2.5rem', width: '400px' }}
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <label className="label" style={{ marginBottom: 0, whiteSpace: 'nowrap' }}>Filter Status:</label>
                    <select
                        className="input"
                        style={{ width: '180px' }}
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value as any)}
                    >
                        <option value="all">All Statuses</option>
                        <option value="billing_pending">Billing Pending</option>
                        <option value="billing_successful">Billing Successful</option>
                    </select>
                </div>
            </div>

            <div className={styles.list}>
                <div className={styles.listHeader}>
                    <span style={{ width: '100px' }}>Order #</span>
                    <span style={{ flex: 2 }}>Client Name</span>
                    <span style={{ flex: 1 }}>Service</span>
                    <span style={{ flex: 1 }}>Amount</span>
                    <span style={{ flex: 1.5 }}>Status</span>
                    <span style={{ flex: 1.5 }}>Delivery Date</span>
                    <span style={{ width: '40px' }}></span>
                </div>
                {filteredOrders.map(order => {
                    const billingStatus = order.billingStatus || 'billing_pending';
                    const statusLabel = billingStatus === 'billing_successful' ? 'Billing Successful' : 'Billing Pending';
                    const statusClass = billingStatus === 'billing_successful' ? styles.statusSuccess : styles.statusPending;

                    return (
                        <Link key={order.id} href={`/orders/${order.id}`} className={styles.row}>
                            <span style={{ width: '100px', fontWeight: 600 }}>{order.order_number || 'N/A'}</span>
                            <span style={{ flex: 2, fontWeight: 600 }}>{order.clientName || 'Unknown'}</span>
                            <span style={{ flex: 1 }}>{order.service_type}</span>
                            <span style={{ flex: 1 }}>${(order.amount || 0).toFixed(2)}</span>
                            <span style={{ flex: 1.5 }}>
                                <span className={statusClass}>
                                    {statusLabel.toUpperCase()}
                                </span>
                            </span>
                            <span style={{ flex: 1.5, fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                {order.actual_delivery_date
                                    ? new Date(order.actual_delivery_date).toLocaleDateString('en-US', { timeZone: 'UTC' })
                                    : order.scheduled_delivery_date
                                        ? new Date(order.scheduled_delivery_date).toLocaleDateString('en-US', { timeZone: 'UTC' })
                                        : '-'}
                            </span>
                            <span style={{ width: '40px' }}><ChevronRight size={16} /></span>
                        </Link>
                    );
                })}
                {filteredOrders.length === 0 && (
                    <div className={styles.empty}>No billing orders found.</div>
                )}
            </div>
        </div>
    );
}
