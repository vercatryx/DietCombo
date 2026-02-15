'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ClientProfile, MenuItem, BoxType } from '@/lib/types';
import { getClients, getMenuItems, getBoxTypes } from '@/lib/cached-data';
import { Package, FileText, Search, User } from 'lucide-react';
import { generateLabelsPDF } from '@/lib/label-utils';
import { formatFullAddress } from '@/lib/addressHelpers';
import styles from './VendorDetail.module.css';

export function ProduceDetail() {
    const router = useRouter();
    const [produceClients, setProduceClients] = useState<ClientProfile[]>([]);
    const [allClients, setAllClients] = useState<ClientProfile[]>([]);
    const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
    const [boxTypes, setBoxTypes] = useState<BoxType[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [search, setSearch] = useState('');

    useEffect(() => {
        loadData();
    }, []);

    async function loadData() {
        setIsLoading(true);
        try {
            const [clientsData, menuItemsData, boxTypesData] = await Promise.all([
                getClients(),
                getMenuItems(),
                getBoxTypes()
            ]);

            // Filter clients with serviceType = 'Produce'
            const produceClientsList = clientsData.filter(client => client.serviceType === 'Produce');

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
        const full = formatFullAddress({ address: client.address, apt: client.apt, city: client.city, state: client.state, zip: client.zip });
        return full || client.address || '-';
    }

    function getClientPhone(clientId: string) {
        const client = allClients.find(c => c.id === clientId);
        return client?.phoneNumber || '-';
    }

    // Filter clients based on search
    const filteredClients = produceClients.filter(client => {
        const matchesSearch = client.fullName.toLowerCase().includes(search.toLowerCase()) ||
            (client.email && client.email.toLowerCase().includes(search.toLowerCase())) ||
            (client.phoneNumber && client.phoneNumber.includes(search)) ||
            (client.address && client.address.toLowerCase().includes(search.toLowerCase()));
        return matchesSearch;
    });

    async function exportLabelsPDF() {
        if (filteredClients.length === 0) {
            alert('No clients to export');
            return;
        }

        // Convert clients to order-like format for label generation
        const clientOrders = filteredClients.map(client => ({
            id: client.id,
            client_id: client.id,
            orderNumber: client.id.slice(0, 8), // Use first 8 chars of client ID as order number
            service_type: 'Produce'
        }));

        await generateLabelsPDF({
            orders: clientOrders,
            getClientName: (clientId: string) => {
                const client = allClients.find(c => c.id === clientId);
                return client?.fullName || 'Unknown Client';
            },
            getClientAddress: (clientId: string) => {
                const client = allClients.find(c => c.id === clientId);
                if (!client) return '-';
                const full = formatFullAddress({ address: client.address, apt: client.apt, city: client.city, state: client.state, zip: client.zip });
                return full || client.address || '-';
            },
            formatOrderedItemsForCSV: () => 'Produce Client',
            formatDate: () => '',
            vendorName: 'Produce'
        });
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

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flex: 1 }}>
                    <h1 className={styles.title}>
                        <Package size={24} style={{ marginRight: '12px', verticalAlign: 'middle' }} />
                        Produce Clients
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
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--spacing-lg)' }}>
                    <h2 className={styles.sectionTitle}>Clients with Service Type: Produce</h2>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
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
                            <span style={{ flex: '1 1 100px', minWidth: 0 }}>Service Type</span>
                        </div>

                        {filteredClients.map(client => (
                            <div
                                key={client.id}
                                className={styles.orderRow}
                                onClick={() => router.push(`/clients/${client.id}`)}
                                style={{ cursor: 'pointer' }}
                            >
                                <span style={{ flex: '2 1 200px', minWidth: 0, fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <User size={16} style={{ color: 'var(--color-primary)' }} />
                                    {client.fullName}
                                </span>
                                <span style={{ flex: '1.5 1 150px', minWidth: 0, fontSize: '0.9rem' }}>
                                    {client.email || '-'}
                                </span>
                                <span style={{ flex: '1 1 120px', minWidth: 0, fontSize: '0.9rem' }}>
                                    {client.phoneNumber || '-'}
                                </span>
                                <span style={{ flex: '2 1 250px', minWidth: 0, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                    {client.address || '-'}
                                </span>
                                <span style={{ flex: '1 1 100px', minWidth: 0 }}>
                                    <span className="badge badge-info">{client.serviceType}</span>
                                </span>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
