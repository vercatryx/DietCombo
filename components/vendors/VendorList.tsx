'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Vendor, ClientProfile, MenuItem, BoxType } from '@/lib/types';
import { getVendors } from '@/lib/cached-data';
import { getOrdersByServiceType } from '@/lib/actions';
import { getClients, getMenuItems, getBoxTypes } from '@/lib/cached-data';
import { Search, Truck, CheckCircle, XCircle, ChevronRight, LogOut, Package, Calendar, ChevronDown, ChevronUp } from 'lucide-react';
import { logout } from '@/lib/auth-actions';
import styles from './VendorList.module.css';

type TabType = 'vendors' | 'produce';

export function VendorList() {
    const router = useRouter();
    const [activeTab, setActiveTab] = useState<TabType>('vendors');
    const [vendors, setVendors] = useState<Vendor[]>([]);
    const [produceOrders, setProduceOrders] = useState<any[]>([]);
    const [clients, setClients] = useState<ClientProfile[]>([]);
    const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
    const [boxTypes, setBoxTypes] = useState<BoxType[]>([]);
    const [search, setSearch] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [expandedOrders, setExpandedOrders] = useState<Set<string>>(new Set());

    useEffect(() => {
        if (activeTab === 'vendors') {
            loadVendors();
        } else if (activeTab === 'produce') {
            loadProduceOrders();
        }
    }, [activeTab]);

    async function loadVendors() {
        setIsLoading(true);
        const data = await getVendors();
        setVendors(data);
        setIsLoading(false);
    }

    async function loadProduceOrders() {
        setIsLoading(true);
        try {
            const [ordersData, clientsData, menuItemsData, boxTypesData] = await Promise.all([
                getOrdersByServiceType('Produce'),
                getClients(),
                getMenuItems(),
                getBoxTypes()
            ]);
            setProduceOrders(ordersData);
            setClients(clientsData);
            setMenuItems(menuItemsData);
            setBoxTypes(boxTypesData);
        } catch (error) {
            console.error('Error loading produce orders:', error);
            setProduceOrders([]);
        } finally {
            setIsLoading(false);
        }
    }

    const filteredVendors = vendors.filter(v => {
        const matchesSearch = v.name.toLowerCase().includes(search.toLowerCase()) ||
            v.serviceTypes.some(t => t.toLowerCase().includes(search.toLowerCase())) ||
            v.deliveryDays.some(day => day.toLowerCase().includes(search.toLowerCase()));
        return matchesSearch;
    });

    function getClientName(clientId: string) {
        const client = clients.find(c => c.id === clientId);
        return client?.fullName || 'Unknown Client';
    }

    function formatDate(dateString: string | null | undefined) {
        if (!dateString) return '-';
        try {
            return new Date(dateString).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                timeZone: 'UTC'
            });
        } catch {
            return dateString;
        }
    }

    function toggleOrderExpansion(orderId: string) {
        const newExpanded = new Set(expandedOrders);
        if (newExpanded.has(orderId)) {
            newExpanded.delete(orderId);
        } else {
            newExpanded.add(orderId);
        }
        setExpandedOrders(newExpanded);
    }

    function groupOrdersByDeliveryDate(ordersList: any[]) {
        const grouped: { [key: string]: any[] } = {};
        const noDate: any[] = [];

        ordersList.forEach(order => {
            const deliveryDate = order.scheduled_delivery_date;
            if (deliveryDate) {
                const dateKey = new Date(deliveryDate).toISOString().split('T')[0];
                if (!grouped[dateKey]) {
                    grouped[dateKey] = [];
                }
                grouped[dateKey].push(order);
            } else {
                noDate.push(order);
            }
        });

        const sortedDates = Object.keys(grouped).sort((a, b) => {
            return new Date(b).getTime() - new Date(a).getTime();
        });

        return { grouped, sortedDates, noDate };
    }

    function getMenuItemName(itemId: string) {
        const item = menuItems.find(mi => mi.id === itemId);
        return item?.name || 'Unknown Item';
    }

    function renderOrderItems(order: any) {
        if (order.service_type === 'Produce') {
            const items = order.items || [];
            if (items.length === 0) {
                return <div className={styles.noItems}>No items found for this order</div>;
            }

            return (
                <div className={styles.itemsList}>
                    <div className={styles.itemsHeader}>
                        <span style={{ minWidth: '300px', flex: 3 }}>Item Name</span>
                        <span style={{ minWidth: '100px', flex: 1 }}>Quantity</span>
                    </div>
                    {items.map((item: any, index: number) => {
                        const menuItem = menuItems.find(mi => mi.id === item.menu_item_id);
                        const quantity = parseInt(item.quantity || 0);
                        const itemKey = item.id || `${order.id}-item-${index}`;

                        return (
                            <div key={itemKey} className={styles.itemRow}>
                                <span style={{ minWidth: '300px', flex: 3 }}>
                                    {menuItem?.name || item.menuItemName || 'Unknown Item'}
                                </span>
                                <span style={{ minWidth: '100px', flex: 1 }}>{quantity}</span>
                            </div>
                        );
                    })}
                </div>
            );
        }

        return <div className={styles.noItems}>No items available for service type: {order.service_type || 'Unknown'}</div>;
    }

    if (isLoading) {
        return (
            <div className={styles.container}>
                <div className={styles.header}>
                    <h1 className={styles.title}>Vendors</h1>
                    <button
                        onClick={() => logout()}
                        className={styles.logoutButton}
                    >
                        <LogOut size={18} />
                        <span>Log Out</span>
                    </button>
                </div>
                <div className={styles.loadingContainer}>
                    <div className="spinner"></div>
                    <p>Loading {activeTab === 'vendors' ? 'vendors' : 'produce orders'}...</p>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <h1 className={styles.title}>Vendors</h1>
                <button
                    onClick={() => logout()}
                    className={styles.logoutButton}
                >
                    <LogOut size={18} />
                    <span>Log Out</span>
                </button>
            </div>

            {/* Tabs */}
            <div className={styles.tabs}>
                <button
                    className={`${styles.tab} ${activeTab === 'vendors' ? styles.tabActive : ''}`}
                    onClick={() => setActiveTab('vendors')}
                >
                    <Truck size={18} />
                    <span>Vendors</span>
                </button>
                <button
                    className={`${styles.tab} ${activeTab === 'produce' ? styles.tabActive : ''}`}
                    onClick={() => setActiveTab('produce')}
                >
                    <Package size={18} />
                    <span>Produce Orders</span>
                </button>
            </div>

            {activeTab === 'vendors' ? (
                <>
                    <div className={styles.filters}>
                        <div className={styles.searchBox}>
                            <Search size={18} className={styles.searchIcon} />
                            <input
                                className="input"
                                placeholder="Search vendors..."
                                style={{ paddingLeft: '2.5rem', width: '300px' }}
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className={styles.list}>
                        <div className={styles.listHeader}>
                            <span style={{ minWidth: '250px', flex: 2, paddingRight: '16px' }}>Name</span>
                            <span style={{ minWidth: '120px', flex: 1, paddingRight: '16px' }}>Services</span>
                            <span style={{ minWidth: '200px', flex: 2, paddingRight: '16px' }}>Delivery Days</span>
                            <span style={{ minWidth: '150px', flex: 1, paddingRight: '16px' }}>Multiple Deliveries</span>
                            <span style={{ minWidth: '120px', flex: 1, paddingRight: '16px' }}>Minimum Order</span>
                            <span style={{ minWidth: '100px', flex: 0.8, paddingRight: '16px' }}>Status</span>
                        </div>
                        {filteredVendors.map(vendor => (
                            <div
                                key={vendor.id}
                                className={styles.vendorRow}
                                onClick={() => router.push(`/vendors/${vendor.id}`)}
                                style={{ cursor: 'pointer' }}
                            >
                                <span
                                    title={vendor.name}
                                    style={{ minWidth: '250px', flex: 2, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}
                                >
                                    <Truck size={16} style={{ marginRight: '8px', verticalAlign: 'middle' }} />
                                    {vendor.name}
                                </span>
                                <span
                                    title={vendor.serviceTypes.join(', ')}
                                    style={{ minWidth: '120px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}
                                >
                                    <div style={{ display: 'flex', gap: '4px' }}>
                                        {vendor.serviceTypes.map(t => (
                                            <span key={t} className="badge badge-info" style={{ fontSize: '0.7rem' }}>
                                                {t}
                                            </span>
                                        ))}
                                    </div>
                                </span>
                                <span
                                    title={vendor.deliveryDays.join(', ') || 'No delivery days'}
                                    style={{ minWidth: '200px', flex: 2, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}
                                >
                                    {vendor.deliveryDays.length > 0 ? vendor.deliveryDays.join(', ') : '-'}
                                </span>
                                <span
                                    title={vendor.allowsMultipleDeliveries ? 'Allows multiple deliveries' : 'Single delivery only'}
                                    style={{ minWidth: '150px', flex: 1, paddingRight: '16px' }}
                                >
                                    {vendor.allowsMultipleDeliveries ? (
                                        <span style={{ color: 'var(--color-success)' }}>
                                            <CheckCircle size={16} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                                            Yes
                                        </span>
                                    ) : (
                                        <span style={{ color: 'var(--text-tertiary)' }}>
                                            <XCircle size={16} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
                                            No
                                        </span>
                                    )}
                                </span>
                                <span
                                    title={`Minimum order: ${vendor.minimumMeals || 0}`}
                                    style={{ minWidth: '120px', flex: 1, fontSize: '0.9rem', color: 'var(--text-secondary)', paddingRight: '16px' }}
                                >
                                    {vendor.minimumMeals || 0}
                                </span>
                                <span
                                    title={vendor.isActive ? 'Active' : 'Inactive'}
                                    style={{ minWidth: '100px', flex: 0.8, paddingRight: '16px' }}
                                >
                                    {vendor.isActive ? (
                                        <span className="badge badge-success">Active</span>
                                    ) : (
                                        <span className="badge">Inactive</span>
                                    )}
                                </span>
                                <span style={{ width: '40px' }}><ChevronRight size={16} /></span>
                            </div>
                        ))}
                        {filteredVendors.length === 0 && !isLoading && (
                            <div className={styles.empty}>
                                {search ? 'No vendors found matching your search.' : 'No vendors found.'}
                            </div>
                        )}
                    </div>
                </>
            ) : (
                <>
                    <div className={styles.filters}>
                        <div className={styles.searchBox}>
                            <Search size={18} className={styles.searchIcon} />
                            <input
                                className="input"
                                placeholder="Search produce orders..."
                                style={{ paddingLeft: '2.5rem', width: '300px' }}
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                            />
                        </div>
                    </div>

                    {(() => {
                        const filteredOrders = produceOrders.filter(order => {
                            const clientName = getClientName(order.client_id).toLowerCase();
                            const orderNumber = (order.order_number || '').toString();
                            const matchesSearch = clientName.includes(search.toLowerCase()) ||
                                orderNumber.includes(search);
                            return matchesSearch;
                        });

                        if (filteredOrders.length === 0) {
                            return (
                                <div className={styles.emptyState}>
                                    <Package size={48} style={{ color: 'var(--text-tertiary)', marginBottom: '1rem' }} />
                                    <p>No produce orders found</p>
                                </div>
                            );
                        }

                        const { grouped, sortedDates, noDate } = groupOrdersByDeliveryDate(filteredOrders);

                        return (
                            <div className={styles.ordersList}>
                                <div className={styles.ordersHeader}>
                                    <span style={{ width: '40px', flexShrink: 0 }}></span>
                                    <span style={{ flex: '2 1 150px', minWidth: 0 }}>Delivery Date</span>
                                    <span style={{ flex: '1 1 100px', minWidth: 0 }}>Orders Count</span>
                                    <span style={{ flex: '1.2 1 120px', minWidth: 0 }}>Total Items</span>
                                </div>

                                {sortedDates.map((dateKey) => {
                                    const dateOrders = grouped[dateKey];
                                    const dateTotalItems = dateOrders.reduce((sum, o) => sum + (o.total_items || 0), 0);

                                    return (
                                        <div key={dateKey}>
                                            <div
                                                className={styles.orderRow}
                                                onClick={() => toggleOrderExpansion(dateKey)}
                                                style={{ cursor: 'pointer' }}
                                            >
                                                <span style={{ width: '40px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                    {expandedOrders.has(dateKey) ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                                </span>
                                                <span style={{ flex: '2 1 150px', minWidth: 0, fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <Calendar size={16} style={{ color: 'var(--color-primary)' }} />
                                                    {formatDate(dateKey)}
                                                </span>
                                                <span style={{ flex: '1 1 100px', minWidth: 0 }}>
                                                    <span className="badge badge-info">{dateOrders.length} order{dateOrders.length !== 1 ? 's' : ''}</span>
                                                </span>
                                                <span style={{ flex: '1.2 1 120px', minWidth: 0, fontSize: '0.9rem' }}>
                                                    {dateTotalItems}
                                                </span>
                                            </div>

                                            {expandedOrders.has(dateKey) && (
                                                <div className={styles.ordersExpanded}>
                                                    {dateOrders.map(order => (
                                                        <div key={order.id} className={styles.orderDetail}>
                                                            <div className={styles.orderDetailHeader}>
                                                                <div>
                                                                    <strong>Order #{order.orderNumber || order.id}</strong>
                                                                    <span style={{ marginLeft: '1rem', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                                                                        Client: {getClientName(order.client_id)}
                                                                    </span>
                                                                </div>
                                                            </div>
                                                            {renderOrderItems(order)}
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}

                                {noDate.length > 0 && (
                                    <div>
                                        <div
                                            className={styles.orderRow}
                                            onClick={() => toggleOrderExpansion('no-date')}
                                            style={{ cursor: 'pointer' }}
                                        >
                                            <span style={{ width: '40px', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                {expandedOrders.has('no-date') ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                            </span>
                                            <span style={{ flex: '2 1 150px', minWidth: 0, fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <Calendar size={16} style={{ color: 'var(--text-tertiary)' }} />
                                                No Delivery Date
                                            </span>
                                            <span style={{ flex: '1 1 100px', minWidth: 0 }}>
                                                <span className="badge">{noDate.length} order{noDate.length !== 1 ? 's' : ''}</span>
                                            </span>
                                            <span style={{ flex: '1.2 1 120px', minWidth: 0, fontSize: '0.9rem' }}>
                                                {noDate.reduce((sum, o) => sum + (o.total_items || 0), 0)}
                                            </span>
                                        </div>

                                        {expandedOrders.has('no-date') && (
                                            <div className={styles.ordersExpanded}>
                                                {noDate.map(order => (
                                                    <div key={order.id} className={styles.orderDetail}>
                                                        <div className={styles.orderDetailHeader}>
                                                            <div>
                                                                <strong>Order #{order.orderNumber || order.id}</strong>
                                                                <span style={{ marginLeft: '1rem', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                                                                    Client: {getClientName(order.client_id)}
                                                                </span>
                                                            </div>
                                                        </div>
                                                        {renderOrderItems(order)}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })()}
                </>
            )}
        </div>
    );
}

