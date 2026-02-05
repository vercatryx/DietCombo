'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Search, Image, ExternalLink } from 'lucide-react';
import { getAllCompletedOrWithProofOrders, type CompletedOrProofOrderRow } from '@/lib/actions';
import styles from './CompletedDeliveriesList.module.css';

function formatDate(d: string | null): string {
    if (!d) return '—';
    try {
        return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'America/New_York' });
    } catch {
        return '—';
    }
}

function getStatusClass(status: string): string {
    if (status === 'completed') return styles.statusCompleted;
    if (status === 'billing_pending') return styles.statusBillingPending;
    return styles.statusOther;
}

export function CompletedDeliveriesList() {
    const router = useRouter();
    const [orders, setOrders] = useState<CompletedOrProofOrderRow[]>([]);
    const [search, setSearch] = useState('');
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setIsLoading(true);
            try {
                const data = await getAllCompletedOrWithProofOrders();
                if (!cancelled) setOrders(data);
            } catch (e) {
                console.error('Error loading completed deliveries:', e);
                if (!cancelled) setOrders([]);
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    const filteredOrders = orders.filter((o) =>
        (o.clientName || '').toLowerCase().includes(search.toLowerCase())
    );

    if (isLoading) {
        return (
            <div className={styles.container}>
                <div className={styles.header}><h1 className={styles.title}>Completed Deliveries</h1></div>
                <div className={styles.loadingContainer}><div className="spinner" /><p>Loading completed deliveries...</p></div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h1 className={styles.title}>Completed Deliveries</h1>
                <div className={styles.viewToggle}>
                    <button type="button" className={styles.viewBtn} onClick={() => router.push('/clients')}>All Clients</button>
                    <button type="button" className={styles.viewBtn} onClick={() => router.push('/clients?view=eligible')}>Eligible</button>
                    <button type="button" className={styles.viewBtn} onClick={() => router.push('/clients?view=ineligible')}>Ineligible</button>
                    <button type="button" className={styles.viewBtn} onClick={() => router.push('/billing')}>Billing</button>
                    <button type="button" className={`${styles.viewBtn} ${styles.viewBtnActive}`}>Completed Deliveries</button>
                    <button type="button" className={styles.viewBtn} onClick={() => router.push('/orders')}>Orders</button>
                </div>
            </div>

            <div className={styles.filters}>
                <div className={styles.searchBox}>
                    <Search size={18} className={styles.searchIcon} />
                    <input
                        className="input"
                        placeholder="Search by client name..."
                        style={{ paddingLeft: '2.5rem', width: 320 }}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
            </div>

            <div className={styles.list}>
                <div className={styles.listHeader}>
                    <span style={{ flex: 2 }}>Client</span>
                    <span style={{ flex: 0.6 }}>Order #</span>
                    <span style={{ flex: 0.8 }}>Service</span>
                    <span style={{ flex: 1 }}>Status</span>
                    <span style={{ flex: 1.2 }}>Scheduled</span>
                    <span style={{ flex: 0.8 }}>Total</span>
                    <span style={{ flex: 1.2 }}>Proof</span>
                    <span style={{ width: 80 }} />
                </div>
                {filteredOrders.length === 0 && (
                    <div className={styles.empty}>
                        {orders.length === 0 ? 'No completed or proof-of-delivery orders found.' : 'No orders match your search.'}
                    </div>
                )}
                {filteredOrders.map((order) => (
                    <div key={order.id} className={styles.row}>
                        <span style={{ flex: 2, fontWeight: 500 }}>
                            <Link href={`/clients/${order.clientId}`} className={styles.proofLink} onClick={(e) => e.stopPropagation()}>
                                {order.clientName}
                            </Link>
                        </span>
                        <span style={{ flex: 0.6, fontVariantNumeric: 'tabular-nums' }}>{order.orderNumber ?? '—'}</span>
                        <span style={{ flex: 0.8 }}>{order.serviceType || '—'}</span>
                        <span style={{ flex: 1 }} className={getStatusClass(order.status)}>
                            {(order.status || '—').replace(/_/g, ' ')}
                        </span>
                        <span style={{ flex: 1.2, fontSize: '0.9rem' }}>{formatDate(order.scheduledDeliveryDate)}</span>
                        <span style={{ flex: 0.8, fontVariantNumeric: 'tabular-nums' }}>
                            {order.totalValue != null ? `$${Number(order.totalValue).toFixed(2)}` : '—'}
                        </span>
                        <span style={{ flex: 1.2 }}>
                            {order.proofOfDeliveryUrl ? (
                                <a href={order.proofOfDeliveryUrl} target="_blank" rel="noopener noreferrer" className={styles.proofLink}>
                                    <Image size={14} /> View proof
                                </a>
                            ) : (
                                '—'
                            )}
                        </span>
                        <span style={{ width: 80 }}>
                            <Link href={`/orders/${order.id}`} className={styles.proofLink} onClick={(e) => e.stopPropagation()}>
                                <ExternalLink size={14} /> Order
                            </Link>
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
}
