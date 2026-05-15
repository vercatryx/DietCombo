'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Package, ShoppingCart, User, CreditCard, FileText, Trash2, Loader2, X, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import styles from './OrderDetailView.module.css';
import { deleteOrder } from '@/lib/actions-orders-billing';
import type { OrderDetail } from '@/lib/types-orders-billing';
import { inlineProxyUrlForStorageImage } from '@/lib/storage-inline-proxy-url';
import { formatScheduledDeliveryDateForOrdersUi } from '@/lib/timezone';

const ORDER_DETAIL_TZ = 'America/New_York';

/** Plain calendar DATE strings (YYYY-MM-DD) stay date-only; timestamps show capture/upload time in NY. */
function formatActualDeliveryDisplay(value: string): string {
    const trimmed = value.trim();
    const dateOnly = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateOnly) {
        const [, y, m, d] = dateOnly;
        return `${Number(m)}/${Number(d)}/${y}`;
    }
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return value;
    return dt.toLocaleString('en-US', {
        timeZone: ORDER_DETAIL_TZ,
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    });
}

interface OrderDetailViewProps {
    order: OrderDetail;
    /** When false, hides delete (e.g. Brooklyn admins). */
    showDelete?: boolean;
}

export function OrderDetailView({ order, showDelete = true }: OrderDetailViewProps) {
    const router = useRouter();
    const [isDeleting, setIsDeleting] = useState(false);
    const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

    const proofUrls =
        order.deliveryProofUrls?.length > 0
            ? order.deliveryProofUrls
            : order.deliveryProofUrl
              ? [order.deliveryProofUrl]
              : [];

    useEffect(() => {
        if (lightboxIndex === null) return;
        const prev = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        return () => {
            document.body.style.overflow = prev;
        };
    }, [lightboxIndex]);

    useEffect(() => {
        if (lightboxIndex === null) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setLightboxIndex(null);
            if (proofUrls.length <= 1) return;
            if (e.key === 'ArrowLeft') {
                e.preventDefault();
                setLightboxIndex((i) => (i === null ? null : (i + proofUrls.length - 1) % proofUrls.length));
            }
            if (e.key === 'ArrowRight') {
                e.preventDefault();
                setLightboxIndex((i) => (i === null ? null : (i + 1) % proofUrls.length));
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [lightboxIndex, proofUrls.length]);

    const downloadProof = useCallback(
        async (url: string, index: number) => {
            const base = `order-${order.orderNumber ?? order.id}-proof-${index + 1}`;
            const proxyUrl = `/api/storage-proxy?url=${encodeURIComponent(url)}`;

            const saveBlob = async (blob: Blob) => {
                const ext = blob.type.includes('png')
                    ? 'png'
                    : blob.type.includes('webp')
                      ? 'webp'
                      : blob.type.includes('gif')
                        ? 'gif'
                        : 'jpeg';
                const objectUrl = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = objectUrl;
                a.download = `${base}.${ext}`;
                document.body.appendChild(a);
                a.click();
                a.remove();
                URL.revokeObjectURL(objectUrl);
            };

            try {
                const res = await fetch(proxyUrl);
                if (!res.ok) throw new Error('proxy failed');
                await saveBlob(await res.blob());
                return;
            } catch {
                /* try direct (works if storage sends CORS) */
            }
            try {
                const res = await fetch(url);
                if (!res.ok) throw new Error('direct failed');
                await saveBlob(await res.blob());
            } catch {
                window.open(url, '_blank', 'noopener,noreferrer');
            }
        },
        [order.orderNumber, order.id]
    );

    const handleDelete = async () => {
        if (!window.confirm('Delete this order? This cannot be undone.')) return;
        setIsDeleting(true);
        try {
            const result = await deleteOrder(order.id);
            if (result.success) router.push('/orders');
            else alert(`Failed: ${result.message}`);
        } catch (e) {
            console.error(e);
            alert('Error deleting order.');
        } finally {
            setIsDeleting(false);
        }
    };

    const formatStatus = (status: string) => (status ? status.replace(/_/g, ' ').toUpperCase() : 'UNKNOWN');
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

        if ((order.orderDetails.serviceType === 'Food' || order.orderDetails.serviceType === 'Meal' || order.orderDetails.serviceType === 'Custom') && order.orderDetails.vendorSelections) {
            return (
                <div className={styles.orderItemsSection}>
                    <div className={styles.sectionHeader}>
                        <ShoppingCart size={20} />
                        <h2>{order.orderDetails.serviceType === 'Custom' ? 'Custom Order Items' : 'Order Items'}</h2>
                    </div>
                    {order.orderDetails.vendorSelections.map((vs: any, idx: number) => (
                        <div key={idx} className={styles.vendorSection}>
                            <div className={styles.vendorName}><strong>Vendor:</strong> {vs.vendorName}</div>
                            <table className={styles.itemsTable}>
                                <thead>
                                    <tr><th>Item</th><th>Quantity</th><th>Unit Value</th><th>Total</th><th>Notes</th></tr>
                                </thead>
                                <tbody>
                                    {vs.items.map((item: any, itemIdx: number) => (
                                        <tr key={itemIdx}>
                                            <td>{item.menuItemName}</td>
                                            <td>{item.quantity}</td>
                                            <td>${(item.unitValue ?? 0).toFixed(2)}</td>
                                            <td>${(item.totalValue ?? 0).toFixed(2)}</td>
                                            <td style={{ maxWidth: 200, fontSize: '0.9rem', color: '#555' }}>{item.notes || '-'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ))}
                    <div className={styles.orderSummary}>
                        <div><strong>Total Items:</strong> {order.orderDetails.totalItems ?? 0}</div>
                        <div><strong>Total Value:</strong> ${(order.orderDetails.totalValue ?? 0).toFixed(2)}</div>
                    </div>
                </div>
            );
        }

        if (order.orderDetails.serviceType === 'Boxes') {
            const itemsByCategory = order.orderDetails.itemsByCategory || {};
            const hasItems = Object.keys(itemsByCategory).length > 0;
            return (
                <div className={styles.orderItemsSection}>
                    <div className={styles.sectionHeader}><Package size={20} /><h2>Box Order Details</h2></div>
                    <div className={styles.boxDetails}>
                        <div><strong>Vendor:</strong> {order.orderDetails.vendorName}</div>
                        <div><strong>Total Value:</strong> ${(order.orderDetails.totalValue ?? 0).toFixed(2)}</div>
                    </div>
                    {hasItems && (
                        <div className={styles.boxContents}>
                            <h3 style={{ marginTop: '1.5rem', marginBottom: '1rem', fontSize: '1rem', fontWeight: 600 }}>Box Contents</h3>
                            {Object.entries(itemsByCategory).map(([catId, catData]: [string, any]) => (
                                <div key={catId} className={styles.categorySection}>
                                    <div className={styles.categoryHeader}><strong>{catData.categoryName}</strong></div>
                                    <table className={styles.itemsTable}>
                                        <thead><tr><th>Item</th><th>Quantity</th><th>Quota Value</th></tr></thead>
                                        <tbody>
                                            {(catData.items || []).map((item: any, i: number) => (
                                                <tr key={i}><td>{item.itemName}</td><td>{item.quantity}</td><td>{item.quotaValue}</td></tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            );
        }

        if (order.orderDetails.serviceType === 'Equipment') {
            return (
                <div className={styles.orderItemsSection}>
                    <div className={styles.sectionHeader}><Package size={20} /><h2>Equipment Order Details</h2></div>
                    <div className={styles.boxDetails}>
                        {order.orderDetails.vendorName && <div><strong>Vendor:</strong> {order.orderDetails.vendorName}</div>}
                        {order.orderDetails.equipmentName && <div><strong>Equipment:</strong> {order.orderDetails.equipmentName}</div>}
                        {order.orderDetails.price != null && <div><strong>Price:</strong> ${Number(order.orderDetails.price).toFixed(2)}</div>}
                        <div><strong>Total Value:</strong> ${(order.orderDetails.totalValue ?? 0).toFixed(2)}</div>
                    </div>
                </div>
            );
        }

        return null;
    };

    return (
        <div className={styles.container}>
            <button type="button" className={styles.backBtn} onClick={() => router.push('/orders')}>
                <ArrowLeft size={20} /> Back to Orders
            </button>
            <div className={styles.header}>
                <div>
                    <h1 className={styles.title}>Order #{order.orderNumber ?? 'N/A'}</h1>
                    <div className={styles.statusBadge}>
                        <span className={getStatusStyle(order.status)}>{formatStatus(order.status)}</span>
                    </div>
                </div>
                {showDelete && (
                    <button type="button" className={styles.deleteBtn} onClick={handleDelete} disabled={isDeleting}>
                        {isDeleting ? <><Loader2 size={18} className="animate-spin" /> Deleting...</> : <><Trash2 size={18} /> Delete Order</>}
                    </button>
                )}
            </div>
            <div className={styles.content}>
                <div className={styles.sections}>
                    <div className={styles.section}>
                        <div className={styles.sectionHeader}><User size={20} /><h2>Client Information</h2></div>
                        <div className={styles.sectionContent}>
                            <div className={styles.infoRow}><strong>Name:</strong><span>{order.clientName}</span></div>
                            {order.clientAddress && <div className={styles.infoRow}><strong>Address:</strong><span>{order.clientAddress}</span></div>}
                            {order.clientEmail && <div className={styles.infoRow}><strong>Email:</strong><span>{order.clientEmail}</span></div>}
                            {order.clientPhone && <div className={styles.infoRow}><strong>Phone:</strong><span>{order.clientPhone}</span></div>}
                        </div>
                    </div>
                    <div className={styles.section}>
                        <div className={styles.sectionHeader}><CreditCard size={20} /><h2>Order Information</h2></div>
                        <div className={styles.sectionContent}>
                            <div className={styles.infoRow}><strong>Service Type:</strong><span>{order.serviceType}</span></div>
                            {order.caseId && <div className={styles.infoRow}><strong>Case ID:</strong><span>{order.caseId}</span></div>}
                            {order.scheduledDeliveryDate && (
                                <div className={styles.infoRow}>
                                    <strong>Scheduled Delivery:</strong>
                                    <span>{formatScheduledDeliveryDateForOrdersUi(order.scheduledDeliveryDate)}</span>
                                </div>
                            )}
                            {order.actualDeliveryDate && <div className={styles.infoRow}><strong>Actual Delivery:</strong><span>{formatActualDeliveryDisplay(order.actualDeliveryDate)}</span></div>}
                            <div className={styles.infoRow}><strong>Total Value:</strong><span>${order.totalValue.toFixed(2)}</span></div>
                            {order.notes && <div className={styles.infoRow}><strong>Notes:</strong><span>{order.notes}</span></div>}
                            <div className={styles.infoRow}>
                                <strong>Delivery Proof:</strong>
                                <span>
                                    {proofUrls.length > 0 ? (
                                        <div className={styles.proofThumbGrid}>
                                            {proofUrls.map((url, i) => (
                                                <button
                                                    key={`${url}-${i}`}
                                                    type="button"
                                                    className={styles.proofThumbBtn}
                                                    onClick={() => setLightboxIndex(i)}
                                                    aria-label={`View delivery proof ${i + 1} of ${proofUrls.length}`}
                                                >
                                                    <img
                                                        src={inlineProxyUrlForStorageImage(url)}
                                                        alt={`Delivery proof ${i + 1}`}
                                                        className={styles.thumbnailImage}
                                                        loading="lazy"
                                                    />
                                                </button>
                                            ))}
                                        </div>
                                    ) : (
                                        <span className={styles.muted}>No proof images attached yet</span>
                                    )}
                                </span>
                            </div>
                        </div>
                    </div>
                    {renderOrderItems()}
                    <div className={styles.section}>
                        <div className={styles.sectionHeader}><FileText size={20} /><h2>Metadata</h2></div>
                        <div className={styles.sectionContent}>
                            <div className={styles.infoRow}><strong>Created:</strong><span>{new Date(order.createdAt).toLocaleString('en-US', { timeZone: 'America/New_York' })}</span></div>
                            <div className={styles.infoRow}><strong>Last Updated:</strong><span>{new Date(order.lastUpdated).toLocaleString('en-US', { timeZone: 'America/New_York' })}</span></div>
                            {order.updatedBy && <div className={styles.infoRow}><strong>Updated By:</strong><span>{order.updatedBy}</span></div>}
                        </div>
                    </div>
                </div>
            </div>

            {lightboxIndex !== null && proofUrls[lightboxIndex] && (
                <div
                    className={styles.lightboxOverlay}
                    role="dialog"
                    aria-modal="true"
                    aria-label="Delivery proof"
                    onClick={() => setLightboxIndex(null)}
                >
                    <div className={styles.lightboxInner} onClick={(e) => e.stopPropagation()}>
                        <div className={styles.lightboxToolbar}>
                            <span>
                                Proof {lightboxIndex + 1} of {proofUrls.length}
                            </span>
                            <div className={styles.lightboxActions}>
                                <button
                                    type="button"
                                    className={styles.lightboxIconBtn}
                                    onClick={() => downloadProof(proofUrls[lightboxIndex], lightboxIndex)}
                                >
                                    <Download size={18} aria-hidden />
                                    Download
                                </button>
                                <button
                                    type="button"
                                    className={styles.lightboxCloseBtn}
                                    onClick={() => setLightboxIndex(null)}
                                    aria-label="Close"
                                >
                                    <X size={22} aria-hidden />
                                </button>
                            </div>
                        </div>
                        <div className={styles.lightboxImgWrap}>
                            {proofUrls.length > 1 && (
                                <>
                                    <button
                                        type="button"
                                        className={`${styles.lightboxNav} ${styles.lightboxNavPrev}`}
                                        onClick={() =>
                                            setLightboxIndex((lightboxIndex + proofUrls.length - 1) % proofUrls.length)
                                        }
                                        aria-label="Previous image"
                                    >
                                        <ChevronLeft size={28} />
                                    </button>
                                    <button
                                        type="button"
                                        className={`${styles.lightboxNav} ${styles.lightboxNavNext}`}
                                        onClick={() => setLightboxIndex((lightboxIndex + 1) % proofUrls.length)}
                                        aria-label="Next image"
                                    >
                                        <ChevronRight size={28} />
                                    </button>
                                </>
                            )}
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={inlineProxyUrlForStorageImage(proofUrls[lightboxIndex])}
                                alt=""
                                className={styles.lightboxImg}
                            />
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
