'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ClientProfile, MenuItem, BoxType, ProduceVendor } from '@/lib/types';
import { getClients, getMenuItems, getBoxTypes, getProduceVendors } from '@/lib/cached-data';
import { Package, FileText, Search, User, AlertTriangle } from 'lucide-react';
import { generateLabelsPDF } from '@/lib/label-utils';
import { formatFullAddress } from '@/lib/addressHelpers';
import styles from './VendorDetail.module.css';

export function ProduceDetail() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const token = searchParams.get('token');

    const [produceClients, setProduceClients] = useState<ClientProfile[]>([]);
    const [allClients, setAllClients] = useState<ClientProfile[]>([]);
    const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
    const [boxTypes, setBoxTypes] = useState<BoxType[]>([]);
    const [produceVendors, setProduceVendors] = useState<ProduceVendor[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [search, setSearch] = useState('');
    const [vendorFilter, setVendorFilter] = useState<string>('all');
    const [tokenVendor, setTokenVendor] = useState<ProduceVendor | null>(null);
    const [invalidToken, setInvalidToken] = useState(false);

    function getLastName(name: string): string {
        const trimmed = (name || '').trim();
        if (!trimmed) return '';
        const parts = trimmed.split(/\s+/);
        return parts[parts.length - 1] || '';
    }

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        setIsLoading(true);
        try {
            const [clientsData, menuItemsData, boxTypesData, pvData] = await Promise.all([
                getClients(),
                getMenuItems(),
                getBoxTypes(),
                getProduceVendors()
            ]);

            setProduceVendors(pvData);

            let resolvedTokenVendor: ProduceVendor | null = null;
            if (token) {
                resolvedTokenVendor = pvData.find(pv => pv.token === token) || null;
                setTokenVendor(resolvedTokenVendor);
                if (!resolvedTokenVendor) {
                    setInvalidToken(true);
                    setIsLoading(false);
                    return;
                }
            }

            const produceClientsList = clientsData
                .filter(client => {
                    if (client.serviceType !== 'Produce' || client.paused) return false;
                    if (resolvedTokenVendor) {
                        return client.produceVendorId === resolvedTokenVendor.id;
                    }
                    return true;
                })
                .sort((a, b) => {
                    const byLast = getLastName(a.fullName || '').localeCompare(getLastName(b.fullName || ''), undefined, { sensitivity: 'base' });
                    if (byLast !== 0) return byLast;
                    return (a.fullName || '').localeCompare(b.fullName || '', undefined, { sensitivity: 'base' });
                });

            setProduceClients(produceClientsList);
            setAllClients(clientsData);
            setMenuItems(menuItemsData);
            setBoxTypes(boxTypesData);
        } catch (error) {
            console.error('Error loading produce clients:', error);
        } finally {
            setIsLoading(false);
        }
    }

    function getClientName(clientId: string) {
        const client = allClients.find(c => c.id === clientId);
        return client?.fullName || 'Unknown Client';
    }

    function getClientAddress(clientId: string) {
        const client = allClients.find(c => c.id === clientId);
        if (!client) return '-';
        const useClient = client.parentClientId && !(client.address?.trim()) && !client.apt && !client.city && !client.zip
            ? allClients.find(c => c.id === client.parentClientId) || client
            : client;
        const full = formatFullAddress({ address: useClient.address, apt: useClient.apt, city: useClient.city, state: useClient.state, zip: useClient.zip });
        return full || useClient.address || '-';
    }

    function getClientPhone(clientId: string) {
        const client = allClients.find(c => c.id === clientId);
        return client?.phoneNumber || '-';
    }

    function getProduceVendorName(client: ClientProfile): string {
        if (!client.produceVendorId) return '—';
        const pv = produceVendors.find(v => v.id === client.produceVendorId);
        return pv?.name || '—';
    }

    const isExternalView = !!token && !!tokenVendor;
    const showVendorColumn = !isExternalView && produceVendors.length > 0;

    const filteredClients = produceClients.filter(client => {
        const parent = client.parentClientId ? allClients.find(c => c.id === client.parentClientId) : null;
        const parentName = parent?.fullName?.toLowerCase() ?? '';
        const matchesSearch = client.fullName.toLowerCase().includes(search.toLowerCase()) ||
            (client.email && client.email.toLowerCase().includes(search.toLowerCase())) ||
            (client.phoneNumber && client.phoneNumber.includes(search)) ||
            (client.address && client.address.toLowerCase().includes(search.toLowerCase())) ||
            (parentName && parentName.includes(search.toLowerCase()));

        let matchesVendorFilter = true;
        if (!isExternalView && vendorFilter !== 'all') {
            if (vendorFilter === 'unassigned') {
                matchesVendorFilter = !client.produceVendorId;
            } else {
                matchesVendorFilter = client.produceVendorId === vendorFilter;
            }
        }

        return matchesSearch && matchesVendorFilter;
    });

    async function exportLabelsPDF() {
        if (filteredClients.length === 0) {
            alert('No clients to export');
            return;
        }

        const clientOrders = filteredClients.map(client => ({
            id: client.id,
            client_id: client.id,
            orderNumber: client.id.slice(0, 8),
            service_type: 'Produce'
        }));

        const vendorLabel = isExternalView ? `Produce - ${tokenVendor!.name}` : 'Produce';

        await generateLabelsPDF({
            orders: clientOrders,
            getClientName: (clientId: string) => getClientName(clientId),
            getClientAddress: (clientId: string) => getClientAddress(clientId),
            formatOrderedItemsForCSV: () => 'Produce Client',
            formatDate: () => '',
            vendorName: vendorLabel
        });
    }

    if (invalidToken) {
        return (
            <div className={styles.container}>
                <div className={styles.loadingContainer}>
                    <AlertTriangle size={48} style={{ color: '#ef4444', marginBottom: '1rem' }} />
                    <p style={{ fontSize: '1.2rem', fontWeight: 600 }}>Invalid or expired link</p>
                    <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem' }}>The produce vendor link you followed is not valid. Please check the URL or contact the administrator.</p>
                </div>
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className={styles.container}>
                <div className={styles.loadingContainer}>
                    <div className="spinner"></div>
                    <p>Loading produce clients...</p>
                </div>
            </div>
        );
    }

    const pageTitle = isExternalView ? `Produce - ${tokenVendor!.name}` : 'Produce Clients';
    const subtitle = isExternalView
        ? `Clients assigned to ${tokenVendor!.name}`
        : 'Clients and dependants with Service Type: Produce';

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flex: 1 }}>
                    <h1 className={styles.title}>
                        <Package size={24} style={{ marginRight: '12px', verticalAlign: 'middle' }} />
                        {pageTitle}
                    </h1>
                    <div style={{ display: 'flex', gap: '1rem' }}>
                        <button
                            className="btn btn-secondary"
                            onClick={exportLabelsPDF}
                            style={{ padding: '0.75rem 1.5rem', fontSize: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
                        >
                            <FileText size={20} /> Download Labels
                        </button>
                    </div>
                </div>
            </div>

            {/* Clients Section */}
            <div className={styles.ordersSection}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--spacing-lg)', flexWrap: 'wrap', gap: '0.75rem' }}>
                    <h2 className={styles.sectionTitle}>{subtitle}</h2>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        {!isExternalView && produceVendors.length > 0 && (
                            <select
                                className="input"
                                style={{ width: '200px' }}
                                value={vendorFilter}
                                onChange={e => setVendorFilter(e.target.value)}
                            >
                                <option value="all">All Vendors</option>
                                {produceVendors.filter(pv => pv.isActive).map(pv => (
                                    <option key={pv.id} value={pv.id}>{pv.name}</option>
                                ))}
                                <option value="unassigned">Unassigned</option>
                            </select>
                        )}
                        <div style={{ position: 'relative' }}>
                            <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
                            <input
                                className="input"
                                placeholder="Search clients..."
                                style={{ paddingLeft: '2.5rem', width: '300px' }}
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                            />
                        </div>
                    </div>
                </div>

                {filteredClients.length === 0 ? (
                    <div className={styles.emptyState}>
                        <User size={48} style={{ color: 'var(--text-tertiary)', marginBottom: '1rem' }} />
                        <p>{search ? 'No clients found matching your search.' : 'No produce clients found.'}</p>
                    </div>
                ) : (
                    <div className={styles.ordersList}>
                        <div className={styles.ordersHeader}>
                            <span style={{ flex: '2 1 200px', minWidth: 0 }}>Client Name</span>
                            <span style={{ flex: '1.5 1 150px', minWidth: 0 }}>Email</span>
                            <span style={{ flex: '1 1 120px', minWidth: 0 }}>Phone</span>
                            <span style={{ flex: '2 1 250px', minWidth: 0 }}>Address</span>
                            {showVendorColumn && (
                                <span style={{ flex: '1 1 120px', minWidth: 0 }}>Vendor</span>
                            )}
                        </div>

                        {filteredClients.map(client => {
                            const parent = client.parentClientId ? allClients.find(c => c.id === client.parentClientId) : null;
                            const isDependent = !!client.parentClientId;
                            return (
                                <div
                                    key={client.id}
                                    className={styles.orderRow}
                                    onClick={() => !isExternalView ? router.push(`/clients/${client.id}`) : undefined}
                                    style={{ cursor: isExternalView ? 'default' : 'pointer' }}
                                >
                                    <span style={{ flex: '2 1 200px', minWidth: 0, fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                        <User size={16} style={{ color: 'var(--color-primary)', flexShrink: 0 }} />
                                        {client.fullName}
                                        {isDependent && (
                                            <span className="badge" style={{ backgroundColor: 'var(--text-tertiary)', color: 'var(--bg-panel)', fontWeight: 500 }}>
                                                Dependent{parent ? ` of ${parent.fullName}` : ''}
                                            </span>
                                        )}
                                    </span>
                                    <span style={{ flex: '1.5 1 150px', minWidth: 0, fontSize: '0.9rem' }}>
                                        {client.email || '-'}
                                    </span>
                                    <span style={{ flex: '1 1 120px', minWidth: 0, fontSize: '0.9rem' }}>
                                        {client.phoneNumber || '-'}
                                    </span>
                                    <span style={{ flex: '2 1 250px', minWidth: 0, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                        {getClientAddress(client.id)}
                                    </span>
                                    {showVendorColumn && (
                                        <span style={{ flex: '1 1 120px', minWidth: 0 }}>
                                            <span className="badge badge-info">{getProduceVendorName(client)}</span>
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}
