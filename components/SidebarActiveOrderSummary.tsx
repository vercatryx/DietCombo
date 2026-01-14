'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { ClientProfile, Vendor, MenuItem, BoxType } from '@/lib/types';
import { getClient, getVendors, getMenuItems, getBoxTypes } from '@/lib/actions';
import { Package, Utensils } from 'lucide-react';
import styles from './Sidebar.module.css';

export function SidebarActiveOrderSummary() {
    const pathname = usePathname();
    const [client, setClient] = useState<ClientProfile | null>(null);
    const [vendors, setVendors] = useState<Vendor[]>([]);
    const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
    const [boxTypes, setBoxTypes] = useState<BoxType[]>([]);
    const [loading, setLoading] = useState(false);

    // Extract client ID from pathname (only for /clients/[id] since sidebar is hidden on client-portal)
    const clientIdMatch = pathname.match(/\/clients\/([^\/]+)/);
    const clientId = clientIdMatch ? clientIdMatch[1] : null;

    useEffect(() => {
        if (!clientId) {
            setClient(null);
            return;
        }

        async function loadData() {
            setLoading(true);
            try {
                const [clientData, vendorsData, menuItemsData, boxTypesData] = await Promise.all([
                    getClient(clientId),
                    getVendors(),
                    getMenuItems(),
                    getBoxTypes()
                ]);

                if (clientData) {
                    setClient(clientData);
                }
                setVendors(vendorsData || []);
                setMenuItems(menuItemsData || []);
                setBoxTypes(boxTypesData || []);
            } catch (error) {
                console.error('Error loading client order summary:', error);
            } finally {
                setLoading(false);
            }
        }

        loadData();
    }, [clientId]);

    if (!clientId || !client) {
        return null;
    }

    if (loading) {
        return (
            <div className={styles.orderSummaryContainer}>
                <div className={styles.orderSummaryLoading}>Loading...</div>
            </div>
        );
    }

    const orderSummary = getOrderSummary(client, vendors, menuItems, boxTypes);

    if (!orderSummary) {
        return null;
    }

    return (
        <div className={styles.orderSummaryContainer}>
            <div className={styles.orderSummaryHeader}>
                <h3 className={styles.orderSummaryTitle}>Active Order</h3>
            </div>
            <div className={styles.orderSummaryContent}>
                {orderSummary}
            </div>
        </div>
    );
}

function getOrderSummary(
    client: ClientProfile,
    vendors: Vendor[],
    menuItems: MenuItem[],
    boxTypes: BoxType[]
): React.ReactNode | null {
    if (!client.activeOrder) {
        return (
            <div className={styles.orderSummaryEmpty}>
                No active order
            </div>
        );
    }

    const st = client.serviceType;
    const conf = client.activeOrder;

    if (st === 'Food') {
        const uniqueVendors = new Set<string>();
        const vendorItemCounts = new Map<string, number>();

        // Check if it's multi-day format
        const isMultiDay = conf.deliveryDayOrders && typeof conf.deliveryDayOrders === 'object';

        if (isMultiDay) {
            Object.values(conf.deliveryDayOrders || {}).forEach((dayOrder: any) => {
                if (dayOrder?.vendorSelections) {
                    dayOrder.vendorSelections.forEach((v: any) => {
                        const vName = vendors.find(ven => ven.id === v.vendorId)?.name;
                        if (vName) {
                            uniqueVendors.add(vName);
                            const itemCount = Object.values(v.items || {}).reduce((a: number, b: any) => a + Number(b), 0);
                            const currentCount = vendorItemCounts.get(vName) || 0;
                            vendorItemCounts.set(vName, currentCount + itemCount);
                        }
                    });
                }
            });
        } else if (conf.vendorSelections) {
            conf.vendorSelections.forEach(v => {
                const vName = vendors.find(ven => ven.id === v.vendorId)?.name;
                if (vName) {
                    uniqueVendors.add(vName);
                    const itemCount = Object.values(v.items || {}).reduce((a: number, b: any) => a + Number(b), 0);
                    vendorItemCounts.set(vName, itemCount);
                }
            });
        }

        if (uniqueVendors.size === 0) {
            return (
                <div className={styles.orderSummaryEmpty}>
                    <Utensils size={14} />
                    <span>Food - Vendor: Not Set</span>
                </div>
            );
        }

        const limit = client.approvedMealsPerWeek || 0;
        const vendorList = Array.from(uniqueVendors).map(vName => {
            const count = vendorItemCounts.get(vName) || 0;
            return `${vName} (${count})`;
        }).join(', ');

        return (
            <div className={styles.orderSummaryFood}>
                <div className={styles.orderSummaryServiceType}>
                    <Utensils size={14} />
                    <strong>Food</strong>
                </div>
                <div className={styles.orderSummaryDetails}>
                    {vendorList}
                </div>
                {limit > 0 && (
                    <div className={styles.orderSummaryLimit}>
                        Max {limit} meals/week
                    </div>
                )}
            </div>
        );
    } else if (st === 'Boxes') {
        // Check vendorId from order config first, then fall back to boxType
        let computedVendorId = conf.vendorId;

        if (!computedVendorId && !conf.boxTypeId && typeof conf === 'object') {
            // Check if it's nested (e.g. { "Thursday": { vendorId: ... } })
            const possibleDayKeys = Object.keys(conf).filter(k =>
                k !== 'id' && k !== 'serviceType' && k !== 'caseId' && typeof (conf as any)[k] === 'object' && (conf as any)[k]?.vendorId
            );

            if (possibleDayKeys.length > 0) {
                computedVendorId = (conf as any)[possibleDayKeys[0]].vendorId;
                if (!conf.boxTypeId) {
                    conf.boxTypeId = (conf as any)[possibleDayKeys[0]].boxTypeId;
                }
            }
        }

        const box = boxTypes.find(b => b.id === conf.boxTypeId);
        const vendorId = computedVendorId || box?.vendorId;
        const vendorName = vendors.find(v => v.id === vendorId)?.name || 'Not Set';

        const itemDetails = Object.entries(conf.items || {})
            .filter(([_, qty]) => Number(qty) > 0)
            .map(([id, qty]) => {
                const item = menuItems.find(i => i.id === id);
                return item ? `${item.name} x${qty}` : null;
            })
            .filter(Boolean)
            .join(', ');

        return (
            <div className={styles.orderSummaryBoxes}>
                <div className={styles.orderSummaryServiceType}>
                    <Package size={14} />
                    <strong>Boxes</strong>
                </div>
                <div className={styles.orderSummaryDetails}>
                    {vendorName}
                </div>
                {itemDetails && (
                    <div className={styles.orderSummaryItems}>
                        {itemDetails}
                    </div>
                )}
            </div>
        );
    }

    return null;
}
