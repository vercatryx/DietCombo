'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { ClientProfile, Vendor, MenuItem, BoxType, ClientStatus, Navigator } from '@/lib/types';
import { getClient, getVendors, getMenuItems, getBoxTypes, getStatuses, getNavigators, invalidateClientData } from '@/lib/cached-data';
import { updateClient } from '@/lib/actions';
import { buildGeocodeQuery } from '@/lib/addressHelpers';
import { geocodeOneClient } from '@/lib/geocodeOneClient';
import { hasNonDefaultFlags, getNonDefaultFlagLabels } from '@/lib/client-flags';
import { Package, Utensils, MapPin, Phone, Mail, ExternalLink, User, MapPinned, Loader2, StickyNote, Flag } from 'lucide-react';
import styles from './Sidebar.module.css';

export function SidebarActiveOrderSummary() {
    const pathname = usePathname();
    const [client, setClient] = useState<ClientProfile | null>(null);
    const [vendors, setVendors] = useState<Vendor[]>([]);
    const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
    const [boxTypes, setBoxTypes] = useState<BoxType[]>([]);
    const [statuses, setStatuses] = useState<ClientStatus[]>([]);
    const [navigators, setNavigators] = useState<Navigator[]>([]);
    const [loading, setLoading] = useState(false);
    const [geoBusy, setGeoBusy] = useState(false);
    const [geoErr, setGeoErr] = useState('');

    // Extract client ID from pathname (only for /clients/[id] since sidebar is hidden on client-portal)
    const clientIdMatch = pathname.match(/\/clients\/([^\/]+)/);
    const clientId = clientIdMatch ? clientIdMatch[1] : null;

    const refreshClient = useCallback(async () => {
        if (!clientId) return;
        invalidateClientData(clientId);
        const data = await getClient(clientId);
        if (data) setClient(data);
    }, [clientId]);

    useEffect(() => {
        if (!clientId) {
            setClient(null);
            return;
        }

        async function loadData() {
            if (!clientId) return;
            
            setLoading(true);
            try {
                const [clientData, vendorsData, menuItemsData, boxTypesData, statusesData, navigatorsData] = await Promise.all([
                    getClient(clientId),
                    getVendors(),
                    getMenuItems(),
                    getBoxTypes(),
                    getStatuses(),
                    getNavigators()
                ]);

                if (clientData) {
                    setClient(clientData);
                }
                setVendors(vendorsData || []);
                setMenuItems(menuItemsData || []);
                setBoxTypes(boxTypesData || []);
                setStatuses(statusesData || []);
                setNavigators(navigatorsData || []);
            } catch (error) {
                console.error('Error loading client order summary:', error);
            } finally {
                setLoading(false);
            }
        }

        loadData();
    }, [clientId]);

    // useMemo must run unconditionally (before any early returns) - Rules of Hooks
    const orderSummary = useMemo(
        () => client ? getOrderSummary(client, vendors, menuItems, boxTypes) : null,
        [client, vendors, menuItems, boxTypes]
    );
    const hasDislikes = client != null && client.dislikes != null && String(client.dislikes).trim() !== '';

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

    const status = statuses.find(s => s.id === client.statusId);
    const navigator = navigators.find(n => n.id === client.navigatorId);
    const hasGeocode = client.lat != null && client.lng != null && Number.isFinite(Number(client.lat)) && Number.isFinite(Number(client.lng));

    async function handleAutoGeocode() {
        if (!clientId || !client || geoBusy) return;
        const q = buildGeocodeQuery({
            address: client.address || '',
            city: client.city || '',
            state: client.state || '',
            zip: client.zip || '',
        });
        if (!q?.trim()) {
            setGeoErr('Add address / city / state to geocode');
            return;
        }
        setGeoBusy(true);
        setGeoErr('');
        try {
            const a = await geocodeOneClient(q);
            await updateClient(clientId, {
                lat: a.lat,
                lng: a.lng,
            });
            await refreshClient();
        } catch {
            setGeoErr('Address not found');
        } finally {
            setGeoBusy(false);
        }
    }

    return (
        <div className={styles.orderSummaryContainer}>
            <div className={styles.orderSummaryClientInfo}>
                <div className={styles.orderSummaryHeader}>
                    <h3 className={styles.orderSummaryTitle}>Client Info</h3>
                </div>
                <div className={styles.orderSummaryContent}>
                    {(client.address?.trim() || client.apt?.trim()) && (
                        <div className={styles.orderSummaryInfoRow}>
                            <MapPin size={12} className={styles.orderSummaryInfoIcon} />
                            <span>
                                {client.address?.trim()}
                                {client.apt?.trim() ? (client.address?.trim() ? `, Unit: ${client.apt.trim()}` : `Unit: ${client.apt.trim()}`) : ''}
                            </span>
                        </div>
                    )}
                    {(client.city?.trim() || client.state?.trim() || client.zip?.trim() || client.county?.trim()) && (
                        <div className={styles.orderSummaryInfoRow}>
                            <MapPin size={12} className={styles.orderSummaryInfoIcon} />
                            <span>
                                {[client.city?.trim(), client.state?.trim(), client.zip?.trim(), client.county?.trim() && `County: ${client.county.trim()}`].filter(Boolean).join(', ')}
                            </span>
                        </div>
                    )}
                    {client.phoneNumber?.trim() && (
                        <div className={styles.orderSummaryInfoRow}>
                            <Phone size={12} className={styles.orderSummaryInfoIcon} />
                            <a href={`tel:${client.phoneNumber.replace(/\s/g, '')}`} className={styles.orderSummaryLink}>
                                {client.phoneNumber}
                            </a>
                        </div>
                    )}
                    {client.secondaryPhoneNumber?.trim() && (
                        <div className={styles.orderSummaryInfoRow}>
                            <Phone size={12} className={styles.orderSummaryInfoIcon} />
                            <a href={`tel:${client.secondaryPhoneNumber.replace(/\s/g, '')}`} className={styles.orderSummaryLink}>
                                {client.secondaryPhoneNumber} (alt)
                            </a>
                        </div>
                    )}
                    {client.email?.trim() && (
                        <div className={styles.orderSummaryInfoRow}>
                            <Mail size={12} className={styles.orderSummaryInfoIcon} />
                            <a href={`mailto:${client.email}`} className={styles.orderSummaryLink} title={client.email}>
                                {client.email.length > 28 ? client.email.slice(0, 25) + '…' : client.email}
                            </a>
                        </div>
                    )}
                    <div className={styles.orderSummaryInfoRow}>
                        <Flag size={12} className={styles.orderSummaryInfoIcon} />
                        <span>{status?.name ?? '—'}</span>
                    </div>
                    <div className={styles.orderSummaryInfoRow}>
                        <User size={12} className={styles.orderSummaryInfoIcon} />
                        <span>{navigator?.name ?? '—'}</span>
                    </div>
                    {client.notes?.trim() && (
                        <div className={styles.orderSummaryInfoRow}>
                            <StickyNote size={12} className={styles.orderSummaryInfoIcon} />
                            <span className={styles.orderSummaryNotes} title={client.notes}>
                                {client.notes.length > 60 ? client.notes.slice(0, 57) + '…' : client.notes}
                            </span>
                        </div>
                    )}
                    {hasNonDefaultFlags(client) && (
                        <div className={styles.orderSummaryFlags}>
                            <span className={styles.orderSummaryFlagLabel}>Flags:</span>
                            {getNonDefaultFlagLabels(client).map((label) => (
                                <span key={label} className={styles.orderSummaryFlag}>{label}</span>
                            ))}
                        </div>
                    )}
                    {client.caseIdExternal?.trim() && (
                        <div className={styles.orderSummaryInfoRow}>
                            <ExternalLink size={12} className={styles.orderSummaryInfoIcon} />
                            <a
                                href={client.caseIdExternal.startsWith('http') ? client.caseIdExternal : `https://${client.caseIdExternal}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={styles.orderSummaryLink}
                            >
                                Unite Us
                            </a>
                        </div>
                    )}
                    <div className={styles.orderSummaryGeocode}>
                        {hasGeocode ? (
                            <span className={styles.orderSummaryGeocodeOk}>
                                ✓ {Number(client.lat).toFixed(4)}, {Number(client.lng).toFixed(4)}
                            </span>
                        ) : (
                            <>
                                <button
                                    type="button"
                                    className={styles.orderSummaryGeocodeBtn}
                                    onClick={handleAutoGeocode}
                                    disabled={geoBusy}
                                >
                                    {geoBusy ? <Loader2 size={12} className="spin" /> : <MapPinned size={12} />}
                                    {geoBusy ? ' Geocoding…' : ' Auto Geocode'}
                                </button>
                                {geoErr && <span className={styles.orderSummaryGeoErr}>{geoErr}</span>}
                            </>
                        )}
                    </div>
                </div>
            </div>
            {orderSummary ? (
                <>
                    <div className={styles.orderSummaryHeader}>
                        <h3 className={styles.orderSummaryTitle}>Active Order</h3>
                    </div>
                    <div className={styles.orderSummaryContent}>
                        {orderSummary}
                    </div>
                </>
            ) : null}
            {hasDislikes && (
                <div style={{ marginTop: (orderSummary || !!client) ? '12px' : 0, padding: '10px 12px', backgroundColor: 'var(--bg-surface-hover)', borderRadius: 'var(--radius-md)', borderLeft: '3px solid var(--color-primary)' }}>
                    <div style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-tertiary)', marginBottom: '6px', fontWeight: 600 }}>Dislikes / Dietary</div>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{client.dislikes}</div>
                </div>
            )}
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
        // Check if it's multi-day format
        const isMultiDay = conf.deliveryDayOrders && typeof conf.deliveryDayOrders === 'object';

        if (isMultiDay) {
            // Group by day of week
            const dayOrderMap = new Map<string, { vendors: Set<string>, items: Map<string, number> }>();
            
            // Day order for sorting (Monday first)
            const dayOrderArray = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
            
            Object.entries(conf.deliveryDayOrders || {}).forEach(([day, dayOrderData]: [string, any]) => {
                if (!dayOrderData?.vendorSelections || dayOrderData.vendorSelections.length === 0) {
                    return;
                }

                const dayVendors = new Set<string>();
                const dayItems = new Map<string, number>();

                dayOrderData.vendorSelections.forEach((v: any) => {
                    const vName = vendors.find(ven => ven.id === v.vendorId)?.name;
                    if (vName) {
                        dayVendors.add(vName);
                    }

                    // Collect items for this day
                    if (v.items) {
                        Object.entries(v.items).forEach(([itemId, qty]: [string, any]) => {
                            const quantity = typeof qty === 'number' ? qty : (typeof qty === 'object' && 'quantity' in qty ? Number(qty.quantity) : Number(qty) || 0);
                            if (quantity > 0) {
                                const item = menuItems.find(i => i.id === itemId);
                                if (item) {
                                    const currentQty = dayItems.get(item.name) || 0;
                                    dayItems.set(item.name, currentQty + quantity);
                                }
                            }
                        });
                    }
                });

                if (dayVendors.size > 0 || dayItems.size > 0) {
                    dayOrderMap.set(day, { vendors: dayVendors, items: dayItems });
                }
            });

            if (dayOrderMap.size === 0) {
                return (
                    <div className={styles.orderSummaryEmpty}>
                        <Utensils size={14} />
                        <span>Food - Vendor: Not Set</span>
                    </div>
                );
            }

            // Sort days by dayOrderArray
            const sortedDays = Array.from(dayOrderMap.keys()).sort((a, b) => {
                const aIndex = dayOrderArray.indexOf(a);
                const bIndex = dayOrderArray.indexOf(b);
                if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
                if (aIndex === -1) return 1;
                if (bIndex === -1) return -1;
                return aIndex - bIndex;
            });

            const limit = client.approvedMealsPerWeek || 0;

            return (
                <div className={styles.orderSummaryFood}>
                    <div className={styles.orderSummaryServiceType}>
                        <Utensils size={14} />
                        <strong>Food</strong>
                    </div>
                    <div className={styles.orderSummaryDays}>
                        {sortedDays.map(day => {
                            const dayData = dayOrderMap.get(day)!;
                            const vendorList = Array.from(dayData.vendors).join(', ') || 'Not Set';
                            const itemsList = Array.from(dayData.items.entries())
                                .map(([itemName, qty]) => `${itemName} x${qty}`)
                                .join(', ');

                            return (
                                <div key={day} className={styles.orderSummaryDay}>
                                    <div className={styles.orderSummaryDayHeader}>
                                        <strong>{day}</strong>
                                    </div>
                                    <div className={styles.orderSummaryDayVendors}>
                                        {vendorList}
                                    </div>
                                    {itemsList && (
                                        <div className={styles.orderSummaryDayItems}>
                                            {itemsList}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                    {limit > 0 && (
                        <div className={styles.orderSummaryLimit}>
                            Max {limit} meals/week
                        </div>
                    )}
                </div>
            );
        } else if (conf.vendorSelections) {
            // Legacy single-day format
            const uniqueVendors = new Set<string>();
            const vendorItemCounts = new Map<string, number>();
            const itemDetails = new Map<string, number>();

            conf.vendorSelections.forEach(v => {
                const vName = vendors.find(ven => ven.id === v.vendorId)?.name;
                if (vName) {
                    uniqueVendors.add(vName);
                    const itemCount = Object.values(v.items || {}).reduce((a: number, b: any) => a + Number(b), 0);
                    vendorItemCounts.set(vName, itemCount);
                }

                // Collect items
                if (v.items) {
                    Object.entries(v.items).forEach(([itemId, qty]: [string, any]) => {
                        const quantity = typeof qty === 'number' ? qty : (typeof qty === 'object' && 'quantity' in qty ? Number(qty.quantity) : Number(qty) || 0);
                        if (quantity > 0) {
                            const item = menuItems.find(i => i.id === itemId);
                            if (item) {
                                const currentQty = itemDetails.get(item.name) || 0;
                                itemDetails.set(item.name, currentQty + quantity);
                            }
                        }
                    });
                }
            });

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
            const itemsList = Array.from(itemDetails.entries())
                .map(([itemName, qty]) => `${itemName} x${qty}`)
                .join(', ');

            return (
                <div className={styles.orderSummaryFood}>
                    <div className={styles.orderSummaryServiceType}>
                        <Utensils size={14} />
                        <strong>Food</strong>
                    </div>
                    <div className={styles.orderSummaryDetails}>
                        {vendorList}
                    </div>
                    {itemsList && (
                        <div className={styles.orderSummaryItems}>
                            {itemsList}
                        </div>
                    )}
                    {limit > 0 && (
                        <div className={styles.orderSummaryLimit}>
                            Max {limit} meals/week
                        </div>
                    )}
                </div>
            );
        } else {
            return (
                <div className={styles.orderSummaryEmpty}>
                    <Utensils size={14} />
                    <span>Food - Vendor: Not Set</span>
                </div>
            );
        }
    } else if (st === 'Boxes') {
        const confAny = conf as any;
        
        // Check if boxes are organized by delivery day (multi-day format)
        const isMultiDayBoxes = confAny.deliveryDayOrders && typeof confAny.deliveryDayOrders === 'object';
        
        if (isMultiDayBoxes) {
            // Group boxes by day of week
            const dayOrderMap = new Map<string, { vendors: Set<string>, boxes: Array<{ boxTypeName: string, items: Map<string, number> }> }>();
            
            // Day order for sorting (Monday first)
            const dayOrderArray = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
            
            Object.entries(confAny.deliveryDayOrders || {}).forEach(([day, dayOrderData]: [string, any]) => {
                if (!dayOrderData) return;
                
                const dayVendors = new Set<string>();
                const dayBoxes: Array<{ boxTypeName: string, items: Map<string, number> }> = [];
                
                // Check if this day has boxOrders
                if (dayOrderData.boxOrders && Array.isArray(dayOrderData.boxOrders) && dayOrderData.boxOrders.length > 0) {
                    dayOrderData.boxOrders.forEach((box: any) => {
                        const boxDef = boxTypes.find(b => b.id === box.boxTypeId);
                        const vId = box.vendorId || boxDef?.vendorId;
                        if (vId) {
                            const vName = vendors.find(v => v.id === vId)?.name;
                            if (vName) dayVendors.add(vName);
                        }
                        
                        // Collect items for this box
                        const boxItems = new Map<string, number>();
                        if (box.items) {
                            let itemsObj = box.items;
                            if (typeof box.items === 'string') {
                                try {
                                    itemsObj = JSON.parse(box.items);
                                } catch (e) {
                                    console.error('Error parsing box.items:', e);
                                    itemsObj = {};
                                }
                            }
                            
                            Object.entries(itemsObj).forEach(([itemId, qtyOrObj]: [string, any]) => {
                                let q = 0;
                                if (typeof qtyOrObj === 'number') {
                                    q = qtyOrObj;
                                } else if (qtyOrObj && typeof qtyOrObj === 'object' && 'quantity' in qtyOrObj) {
                                    const qtyObj = qtyOrObj as { quantity: number | string };
                                    q = typeof qtyObj.quantity === 'number' ? qtyObj.quantity : parseInt(String(qtyObj.quantity)) || 0;
                                } else {
                                    q = parseInt(String(qtyOrObj)) || 0;
                                }
                                
                                if (q > 0) {
                                    const item = menuItems.find(i => i.id === itemId);
                                    if (item) {
                                        const currentQty = boxItems.get(item.name) || 0;
                                        boxItems.set(item.name, currentQty + q);
                                    }
                                }
                            });
                        }
                        
                        const boxTypeName = boxDef?.name || 'Unknown Box';
                        dayBoxes.push({ boxTypeName, items: boxItems });
                    });
                }
                
                // Also check legacy format for this day (items, vendorId, boxTypeId)
                if (dayBoxes.length === 0 && dayOrderData.items) {
                    const boxDef = boxTypes.find(b => b.id === dayOrderData.boxTypeId);
                    const vId = dayOrderData.vendorId || boxDef?.vendorId;
                    if (vId) {
                        const vName = vendors.find(v => v.id === vId)?.name;
                        if (vName) dayVendors.add(vName);
                    }
                    
                    const boxItems = new Map<string, number>();
                    let itemsObj: any = dayOrderData.items;
                    if (typeof dayOrderData.items === 'string') {
                        try {
                            itemsObj = JSON.parse(dayOrderData.items);
                        } catch (e) {
                            console.error('Error parsing dayOrderData.items:', e);
                            itemsObj = {};
                        }
                    }
                    
                    Object.entries(itemsObj).forEach(([itemId, qtyOrObj]: [string, any]) => {
                        let q = 0;
                        if (typeof qtyOrObj === 'number') {
                            q = qtyOrObj;
                        } else if (qtyOrObj && typeof qtyOrObj === 'object' && 'quantity' in qtyOrObj) {
                            const qtyObj = qtyOrObj as { quantity: number | string };
                            q = typeof qtyObj.quantity === 'number' ? qtyObj.quantity : parseInt(String(qtyObj.quantity)) || 0;
                        } else {
                            q = parseInt(String(qtyOrObj)) || 0;
                        }
                        
                        if (q > 0) {
                            const item = menuItems.find(i => i.id === itemId);
                            if (item) {
                                const currentQty = boxItems.get(item.name) || 0;
                                boxItems.set(item.name, currentQty + q);
                            }
                        }
                    });
                    
                    const boxTypeName = boxDef?.name || 'Unknown Box';
                    dayBoxes.push({ boxTypeName, items: boxItems });
                }
                
                if (dayVendors.size > 0 || dayBoxes.length > 0) {
                    dayOrderMap.set(day, { vendors: dayVendors, boxes: dayBoxes });
                }
            });
            
            if (dayOrderMap.size === 0) {
                return (
                    <div className={styles.orderSummaryEmpty}>
                        <Package size={14} />
                        <span>Boxes - No boxes configured</span>
                    </div>
                );
            }
            
            // Sort days by dayOrderArray
            const sortedDays = Array.from(dayOrderMap.keys()).sort((a, b) => {
                const aIndex = dayOrderArray.indexOf(a);
                const bIndex = dayOrderArray.indexOf(b);
                if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
                if (aIndex === -1) return 1;
                if (bIndex === -1) return -1;
                return aIndex - bIndex;
            });
            
            return (
                <div className={styles.orderSummaryBoxes}>
                    <div className={styles.orderSummaryServiceType}>
                        <Package size={14} />
                        <strong>Boxes</strong>
                    </div>
                    <div className={styles.orderSummaryDays}>
                        {sortedDays.map(day => {
                            const dayData = dayOrderMap.get(day)!;
                            const vendorList = Array.from(dayData.vendors).join(', ') || 'Not Set';
                            
                            return (
                                <div key={day} className={styles.orderSummaryDay}>
                                    <div className={styles.orderSummaryDayHeader}>
                                        <strong>{day}</strong>
                                    </div>
                                    <div className={styles.orderSummaryDayVendors}>
                                        {vendorList}
                                    </div>
                                    {dayData.boxes.map((box, idx) => {
                                        const itemsList = Array.from(box.items.entries())
                                            .map(([itemName, qty]) => `${itemName} x${qty}`)
                                            .join(', ');
                                        
                                        return (
                                            <div key={idx} className={styles.orderSummaryDayBox}>
                                                <div className={styles.orderSummaryDayBoxType}>
                                                    {box.boxTypeName}
                                                </div>
                                                {itemsList && (
                                                    <div className={styles.orderSummaryDayItems}>
                                                        {itemsList}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })}
                    </div>
                </div>
            );
        }
        
        // Legacy single-day format: Handle flat boxOrders array
        let computedVendorId = conf.vendorId;
        const uniqueVendors = new Set<string>();
        const itemDetails: string[] = [];

        // NEW: Handle boxOrders array format first (legacy format, may exist in JSON)
        if (confAny.boxOrders && Array.isArray(confAny.boxOrders) && confAny.boxOrders.length > 0) {
            confAny.boxOrders.forEach((box: any) => {
                const boxDef = boxTypes.find(b => b.id === box.boxTypeId);
                const vId = box.vendorId || boxDef?.vendorId;
                if (vId) {
                    const vName = vendors.find(v => v.id === vId)?.name;
                    if (vName) uniqueVendors.add(vName);
                    // Also set computedVendorId from first box if not already set
                    if (!computedVendorId) {
                        computedVendorId = vId;
                    }
                }

                // Collect items from this box
                if (box.items) {
                    // Handle items that might be stored as JSON string
                    let itemsObj = box.items;
                    if (typeof box.items === 'string') {
                        try {
                            itemsObj = JSON.parse(box.items);
                        } catch (e) {
                            console.error('Error parsing box.items:', e);
                            itemsObj = {};
                        }
                    }
                    
                    Object.entries(itemsObj).forEach(([itemId, qtyOrObj]) => {
                        // Handle both formats: { itemId: number } or { itemId: { quantity: number, price: number } }
                        let q = 0;
                        if (typeof qtyOrObj === 'number') {
                            q = qtyOrObj;
                        } else if (qtyOrObj && typeof qtyOrObj === 'object' && 'quantity' in qtyOrObj) {
                            const qtyObj = qtyOrObj as { quantity: number | string };
                            q = typeof qtyObj.quantity === 'number' ? qtyObj.quantity : parseInt(String(qtyObj.quantity)) || 0;
                        } else {
                            q = parseInt(String(qtyOrObj)) || 0;
                        }
                        
                        if (q > 0) {
                            const item = menuItems.find(i => i.id === itemId);
                            if (item) {
                                // Check if item already in list (aggregate quantities)
                                const existingIndex = itemDetails.findIndex(d => d.startsWith(item.name));
                                if (existingIndex >= 0) {
                                    // Extract existing quantity and add to it
                                    const match = itemDetails[existingIndex].match(/x(\d+)$/);
                                    if (match) {
                                        const existingQty = parseInt(match[1]) || 0;
                                        itemDetails[existingIndex] = `${item.name} x${existingQty + q}`;
                                    }
                                } else {
                                    itemDetails.push(`${item.name} x${q}`);
                                }
                            }
                        }
                    });
                }
            });
        }

        // LEGACY: Fall back to legacy format if boxOrders array is empty or doesn't exist
        if (uniqueVendors.size === 0 && !computedVendorId && !conf.boxTypeId && typeof conf === 'object') {
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

        // Fallback to boxType vendor if still no vendor found
        if (uniqueVendors.size === 0) {
            const box = boxTypes.find(b => b.id === conf.boxTypeId);
            const vendorId = computedVendorId || box?.vendorId;
            const vendorName = vendors.find(v => v.id === vendorId)?.name;
            if (vendorName) {
                uniqueVendors.add(vendorName);
            }
        }

        // LEGACY: Also check conf.items if itemDetails is still empty
        if (itemDetails.length === 0 && conf.items) {
            // Handle items that might be stored as JSON string
            let itemsObj: any = conf.items;
            if (typeof conf.items === 'string') {
                try {
                    itemsObj = JSON.parse(conf.items);
                } catch (e) {
                    console.error('Error parsing conf.items:', e);
                    itemsObj = {};
                }
            }
            
            Object.entries(itemsObj).forEach(([id, qtyOrObj]: [string, any]) => {
                // Handle both formats: { itemId: number } or { itemId: { quantity: number, price: number } }
                let q = 0;
                if (typeof qtyOrObj === 'number') {
                    q = qtyOrObj;
                } else if (qtyOrObj && typeof qtyOrObj === 'object' && 'quantity' in qtyOrObj) {
                    const qtyObj = qtyOrObj as { quantity: number | string };
                    q = typeof qtyObj.quantity === 'number' ? qtyObj.quantity : parseInt(String(qtyObj.quantity)) || 0;
                } else {
                    q = parseInt(String(qtyOrObj)) || 0;
                }
                
                if (q > 0) {
                    const item = menuItems.find(i => i.id === id);
                    if (item) {
                        itemDetails.push(`${item.name} x${q}`);
                    }
                }
            });
        }

        const vendorName = Array.from(uniqueVendors).join(', ') || 'Not Set';
        const itemsList = itemDetails.length > 0 ? itemDetails.join(', ') : '';

        return (
            <div className={styles.orderSummaryBoxes}>
                <div className={styles.orderSummaryServiceType}>
                    <Package size={14} />
                    <strong>Boxes</strong>
                </div>
                <div className={styles.orderSummaryDetails}>
                    {vendorName}
                </div>
                {itemsList && (
                    <div className={styles.orderSummaryItems}>
                        {itemsList}
                    </div>
                )}
            </div>
        );
    }

    return null;
}
