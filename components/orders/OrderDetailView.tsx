'use client';

import { useRouter } from 'next/navigation';
import { ArrowLeft, Package, ShoppingCart, User, Calendar, CreditCard, FileText } from 'lucide-react';
import styles from './OrderDetailView.module.css';

interface OrderDetailViewProps {
    order: {
        id: string;
        orderNumber: number | null;
        clientId: string;
        clientName: string;
        clientAddress: string;
        clientEmail: string;
        clientPhone: string;
        serviceType: string;
        caseId: string | null;
        status: string;
        scheduledDeliveryDate: string | null;
        actualDeliveryDate: string | null;
        deliveryProofUrl: string;
        totalValue: number;
        totalItems: number | null;
        notes: string | null;
        createdAt: string;
        lastUpdated: string;
        updatedBy: string | null;
        orderDetails?: any;
    };
}

export function OrderDetailView({ order }: OrderDetailViewProps) {
    const router = useRouter();

    const formatStatus = (status: string) => {
        if (!status) return 'UNKNOWN';
        return status.replace(/_/g, ' ').toUpperCase();
    };

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

    const renderOrderItems = () => {
        if (!order.orderDetails) return null;

        if (order.orderDetails.serviceType === 'Food' && order.orderDetails.vendorSelections) {
            return (
                <div className={styles.orderItemsSection}>
                    <div className={styles.sectionHeader}>
                        <ShoppingCart size={20} />
                        <h2>Order Items</h2>
                    </div>
                    {order.orderDetails.vendorSelections.map((vs: any, idx: number) => (
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
                        <div><strong>Total Items:</strong> {order.orderDetails.totalItems || 0}</div>
                        <div><strong>Total Value:</strong> ${order.orderDetails.totalValue.toFixed(2)}</div>
                    </div>
                </div>
            );
        } else if (order.orderDetails.serviceType === 'Boxes') {
            const itemsByCategory = order.orderDetails.itemsByCategory || {};
            const hasItems = Object.keys(itemsByCategory).length > 0;

            return (
                <div className={styles.orderItemsSection}>
                    <div className={styles.sectionHeader}>
                        <Package size={20} />
                        <h2>Box Order Details</h2>
                    </div>
                    <div className={styles.boxDetails}>
                        <div><strong>Vendor:</strong> {order.orderDetails.vendorName}</div>
                        <div><strong>Total Value:</strong> ${order.orderDetails.totalValue.toFixed(2)}</div>
                    </div>
                    {hasItems && (
                        <div className={styles.boxContents}>
                            <h3 style={{ marginTop: '1.5rem', marginBottom: '1rem', fontSize: '1rem', fontWeight: 600 }}>Box Contents</h3>
                            {Object.entries(itemsByCategory).map(([categoryId, categoryData]: [string, any]) => (
                                <div key={categoryId} className={styles.categorySection}>
                                    <div className={styles.categoryHeader}>
                                        <strong>{categoryData.categoryName}</strong>
                                    </div>
                                    <table className={styles.itemsTable}>
                                        <thead>
                                            <tr>
                                                <th>Item</th>
                                                <th>Quantity</th>
                                                <th>Quota Value</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {categoryData.items.map((item: any, itemIdx: number) => (
                                                <tr key={itemIdx}>
                                                    <td>{item.itemName}</td>
                                                    <td>{item.quantity}</td>
                                                    <td>{item.quotaValue}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            );
        } else if (order.orderDetails.serviceType === 'Equipment') {
            return (
                <div className={styles.orderItemsSection}>
                    <div className={styles.sectionHeader}>
                        <Package size={20} />
                        <h2>Equipment Order Details</h2>
                    </div>
                    <div className={styles.boxDetails}>
                        {order.orderDetails.vendorName && (
                            <div><strong>Vendor:</strong> {order.orderDetails.vendorName}</div>
                        )}
                        {order.orderDetails.equipmentName && (
                            <div><strong>Equipment:</strong> {order.orderDetails.equipmentName}</div>
                        )}
                        {order.orderDetails.price !== undefined && (
                            <div><strong>Price:</strong> ${order.orderDetails.price.toFixed(2)}</div>
                        )}
                        <div><strong>Total Value:</strong> ${order.orderDetails.totalValue.toFixed(2)}</div>
                    </div>
                </div>
            );
        }

        return null;
    };

    return (
        <div className={styles.container}>
            <button className={styles.backBtn} onClick={() => router.push('/orders')}>
                <ArrowLeft size={20} /> Back to Orders
            </button>

            <div className={styles.header}>
                <div>
                    <h1 className={styles.title}>
                        Order #{order.orderNumber || 'N/A'}
                    </h1>
                    <div className={styles.statusBadge}>
                        <span className={getStatusStyle(order.status)}>
                            {formatStatus(order.status)}
                        </span>
                    </div>
                </div>
            </div>

            <div className={styles.content}>
                <div className={styles.sections}>
                    {/* Client Information */}
                    <div className={styles.section}>
                        <div className={styles.sectionHeader}>
                            <User size={20} />
                            <h2>Client Information</h2>
                        </div>
                        <div className={styles.sectionContent}>
                            <div className={styles.infoRow}>
                                <strong>Name:</strong>
                                <span>{order.clientName}</span>
                            </div>
                            {order.clientAddress && (
                                <div className={styles.infoRow}>
                                    <strong>Address:</strong>
                                    <span>{order.clientAddress}</span>
                                </div>
                            )}
                            {order.clientEmail && (
                                <div className={styles.infoRow}>
                                    <strong>Email:</strong>
                                    <span>{order.clientEmail}</span>
                                </div>
                            )}
                            {order.clientPhone && (
                                <div className={styles.infoRow}>
                                    <strong>Phone:</strong>
                                    <span>{order.clientPhone}</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Order Information */}
                    <div className={styles.section}>
                        <div className={styles.sectionHeader}>
                            <CreditCard size={20} />
                            <h2>Order Information</h2>
                        </div>
                        <div className={styles.sectionContent}>
                            <div className={styles.infoRow}>
                                <strong>Service Type:</strong>
                                <span>{order.serviceType}</span>
                            </div>
                            {order.caseId && (
                                <div className={styles.infoRow}>
                                    <strong>Case ID:</strong>
                                    <span>{order.caseId}</span>
                                </div>
                            )}
                            {order.scheduledDeliveryDate && (
                                <div className={styles.infoRow}>
                                    <strong>Scheduled Delivery:</strong>
                                    <span>{new Date(order.scheduledDeliveryDate).toLocaleDateString('en-US', { timeZone: 'UTC' })}</span>
                                </div>
                            )}
                            {order.actualDeliveryDate && (
                                <div className={styles.infoRow}>
                                    <strong>Actual Delivery:</strong>
                                    <span>{new Date(order.actualDeliveryDate).toLocaleDateString('en-US', { timeZone: 'UTC' })}</span>
                                </div>
                            )}
                            <div className={styles.infoRow}>
                                <strong>Total Value:</strong>
                                <span>${order.totalValue.toFixed(2)}</span>
                            </div>
                            {order.notes && (
                                <div className={styles.infoRow}>
                                    <strong>Notes:</strong>
                                    <span>{order.notes}</span>
                                </div>
                            )}
                            {order.deliveryProofUrl && (
                                <div className={styles.infoRow}>
                                    <strong>Delivery Proof:</strong>
                                    <a href={order.deliveryProofUrl} target="_blank" rel="noopener noreferrer" className={styles.link}>
                                        View Image
                                    </a>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Order Items */}
                    {renderOrderItems()}

                    {/* Metadata */}
                    <div className={styles.section}>
                        <div className={styles.sectionHeader}>
                            <FileText size={20} />
                            <h2>Metadata</h2>
                        </div>
                        <div className={styles.sectionContent}>
                            <div className={styles.infoRow}>
                                <strong>Created:</strong>
                                <span>{new Date(order.createdAt).toLocaleString()}</span>
                            </div>
                            <div className={styles.infoRow}>
                                <strong>Last Updated:</strong>
                                <span>{new Date(order.lastUpdated).toLocaleString()}</span>
                            </div>
                            {order.updatedBy && (
                                <div className={styles.infoRow}>
                                    <strong>Updated By:</strong>
                                    <span>{order.updatedBy}</span>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

