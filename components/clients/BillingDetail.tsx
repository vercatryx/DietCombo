'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CreditCard, Download, ExternalLink, ChevronDown, ChevronUp, Package, ShoppingCart } from 'lucide-react';
import { getBillingHistory, getClient } from '@/lib/actions';
import { ClientProfile } from '@/lib/types';
import styles from './BillingDetail.module.css';

interface Props {
    clientId: string;
}

export function BillingDetail({ clientId }: Props) {
    const router = useRouter();
    const [client, setClient] = useState<ClientProfile | null>(null);
    const [history, setHistory] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

    useEffect(() => {
        async function loadData() {
            const [c, h] = await Promise.all([
                getClient(clientId),
                getBillingHistory(clientId)
            ]);
            if (c) setClient(c);
            setHistory(h);
            setLoading(false);
        }
        loadData();
    }, [clientId]);

    if (loading) return <div className={styles.container}>Loading billing data...</div>;
    if (!client) return <div className={styles.container}>Client not found.</div>;

    const totalOutstanding = history
        .filter(i => i.status === 'pending' || i.status === 'request sent')
        .reduce((sum, i) => sum + i.amount, 0);

    const toggleRow = (id: string) => {
        const newExpanded = new Set(expandedRows);
        if (newExpanded.has(id)) {
            newExpanded.delete(id);
        } else {
            newExpanded.add(id);
        }
        setExpandedRows(newExpanded);
    };

    const renderOrderDetails = (orderDetails: any) => {
        if (!orderDetails) return null;

        if (orderDetails.serviceType === 'Food' && orderDetails.vendorSelections) {
            return (
                <div className={styles.orderDetails}>
                    <div className={styles.orderDetailsHeader}>
                        <ShoppingCart size={16} />
                        <span>Order Items</span>
                    </div>
                    {orderDetails.vendorSelections.map((vs: any, idx: number) => (
                        <div key={idx} className={styles.vendorSection}>
                            <div className={styles.vendorName}>
                                <strong>Vendor:</strong> {vs.vendorName}
                            </div>
                            <table className={styles.itemsTable}>
                                <thead>
                                    <tr>
                                        <th>Item</th>
                                        <th>Quantity</th>
                                        <th>Unit Value</th>
                                        <th>Total</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {vs.items.map((item: any, itemIdx: number) => (
                                        <tr key={itemIdx}>
                                            <td>{item.menuItemName}</td>
                                            <td>{item.quantity}</td>
                                            <td>${item.unitValue.toFixed(2)}</td>
                                            <td>${item.totalValue.toFixed(2)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ))}
                    <div className={styles.orderSummary}>
                        <div><strong>Total Items:</strong> {orderDetails.totalItems || 0}</div>
                        <div><strong>Total Value:</strong> ${orderDetails.totalValue.toFixed(2)}</div>
                    </div>
                </div>
            );
        } else if (orderDetails.serviceType === 'Boxes') {
            return (
                <div className={styles.orderDetails}>
                    <div className={styles.orderDetailsHeader}>
                        <Package size={16} />
                        <span>Box Order Details</span>
                    </div>
                    <div className={styles.boxDetails}>
                        <div><strong>Vendor:</strong> {orderDetails.vendorName}</div>
                        <div><strong>Box Type:</strong> {orderDetails.boxTypeName}</div>
                        <div><strong>Quantity:</strong> {orderDetails.boxQuantity}</div>
                        <div><strong>Total Value:</strong> ${orderDetails.totalValue.toFixed(2)}</div>
                    </div>
                </div>
            );
        } else {
            return (
                <div className={styles.orderDetails}>
                    <div className={styles.orderDetailsHeader}>
                        <span>Order Details</span>
                    </div>
                    <div className={styles.boxDetails}>
                        <div><strong>Service Type:</strong> {orderDetails.serviceType}</div>
                        {orderDetails.totalValue && (
                            <div><strong>Total Value:</strong> ${orderDetails.totalValue.toFixed(2)}</div>
                        )}
                        {orderDetails.notes && (
                            <div><strong>Notes:</strong> {orderDetails.notes}</div>
                        )}
                    </div>
                </div>
            );
        }
    };

    return (
        <div className={styles.container}>
            <button className={styles.backBtn} onClick={() => router.push(`/clients/${clientId}`)}>
                <ArrowLeft size={20} /> Back to Profile
            </button>

            <header className={styles.header}>
                <h1 className={styles.title}>Billing: {client.fullName}</h1>
                <button className="btn btn-primary">
                    <Download size={16} /> Export Statement
                </button>
            </header>

            <div className={styles.summary}>
                <div className={styles.summaryCard}>
                    <div className={styles.label}>Outstanding Balance</div>
                    <div className={styles.value}>${totalOutstanding.toFixed(2)}</div>
                </div>
                <div className={styles.summaryCard}>
                    <div className={styles.label}>Last Payment</div>
                    <div className={styles.value}>$150.00</div>
                </div>
                <div className={styles.summaryCard}>
                    <div className={styles.label}>Billing Cycle</div>
                    <div className={styles.value}>Monthly</div>
                </div>
            </div>

            <div className={styles.tableContainer}>
                <div className={styles.tableTitle}>Billing History</div>
                <table className={styles.table}>
                    <thead>
                        <tr>
                            <th className={styles.th}>Date</th>
                            <th className={styles.th}>Amount</th>
                            <th className={styles.th}>Method</th>
                            <th className={styles.th}>Status</th>
                            <th className={styles.th}>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {history.map(item => {
                            const isExpanded = expandedRows.has(item.id);
                            const hasOrderDetails = !!item.orderDetails;
                            const date = item.date || (item.createdAt ? new Date(item.createdAt).toLocaleDateString('en-US', { timeZone: 'UTC' }) : 'N/A');

                            return (
                                <>
                                    <tr key={item.id} className={hasOrderDetails ? styles.expandableRow : ''}>
                                        <td className={styles.td}>{date}</td>
                                        <td className={styles.td}>${item.amount.toFixed(2)}</td>
                                        <td className={styles.td}>{item.method || 'N/A'}</td>
                                        <td className={styles.td}>
                                            <span className={
                                                item.status === 'success' ? styles.statusPaid :
                                                    item.status === 'failed' ? styles.statusUnpaid :
                                                        styles.statusPending
                                            }>
                                                {item.status === 'request sent' ? 'REQUEST SENT' : item.status.toUpperCase()}
                                            </span>
                                        </td>
                                        <td className={styles.td}>
                                            {hasOrderDetails ? (
                                                <button
                                                    className={styles.iconBtn}
                                                    onClick={() => toggleRow(item.id)}
                                                    title={isExpanded ? 'Hide order details' : 'Show order details'}
                                                >
                                                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                                    {isExpanded ? ' Hide' : ' View'} Details
                                                </button>
                                            ) : (
                                                <span className={styles.noDetails}>No order details</span>
                                            )}
                                        </td>
                                    </tr>
                                    {isExpanded && hasOrderDetails && (
                                        <tr key={`${item.id}-details`}>
                                            <td colSpan={5} className={styles.detailsCell}>
                                                {renderOrderDetails(item.orderDetails)}
                                            </td>
                                        </tr>
                                    )}
                                </>
                            );
                        })}
                    </tbody>
                </table>
                {history.length === 0 && <div className={styles.empty}>No billing records found.</div>}
            </div>
        </div>
    );
}
