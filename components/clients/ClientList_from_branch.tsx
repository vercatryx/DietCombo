'use client';

import { ClientProfileDetail } from './ClientProfile';

import { useState, useEffect, useRef } from 'react';
import { ClientProfile, ClientStatus, Navigator, Vendor, BoxType, ClientFullDetails, MenuItem } from '@/lib/types';
import { getClientsPaginated, getClientFullDetails, getStatuses, getNavigators, addClient, getVendors, getBoxTypes, getMenuItems } from '@/lib/actions';
import { invalidateClientData } from '@/lib/cached-data';
import { Plus, Search, ChevronRight, CheckSquare, Square, StickyNote, Package } from 'lucide-react';
import styles from './ClientList.module.css';
import { useRouter } from 'next/navigation';

export function ClientList() {
    const router = useRouter();
    const [clients, setClients] = useState<ClientProfile[]>([]);
    const [statuses, setStatuses] = useState<ClientStatus[]>([]);
    const [navigators, setNavigators] = useState<Navigator[]>([]);
    const [vendors, setVendors] = useState<Vendor[]>([]);
    const [boxTypes, setBoxTypes] = useState<BoxType[]>([]);
    const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
    const [search, setSearch] = useState('');
    const [isLoading, setIsLoading] = useState(true);

    // Pagination State
    const [page, setPage] = useState(1);
    const [totalClients, setTotalClients] = useState(0);
    const [isFetchingMore, setIsFetchingMore] = useState(false);
    const PAGE_SIZE = 20;

    // Prefetching State
    const [detailsCache, setDetailsCache] = useState<Record<string, ClientFullDetails>>({});
    const pendingPrefetches = useRef<Set<string>>(new Set());

    // Views
    const [currentView, setCurrentView] = useState<'all' | 'eligible' | 'ineligible' | 'billing'>('all');

    // New Client Modal state
    const [isCreating, setIsCreating] = useState(false);
    const [newClientName, setNewClientName] = useState('');

    // Selected Client for Modal
    const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

    useEffect(() => {
        loadInitialData();
    }, []);

    // Progressive Loading Effect
    useEffect(() => {
        if (!isLoading && clients.length < totalClients && !isFetchingMore) {
            // Fetch next page
            const nextPage = page + 1;
            fetchMoreClients(nextPage);
        }
    }, [clients.length, totalClients, isLoading, isFetchingMore, page]);

    // Background Prefetching Effect
    useEffect(() => {
        if (isLoading) return;

        // Find clients that need prefetching (not in cache, not currently pending)
        // Prioritize visible clients? For now, just top to bottom of current list.
        const candidates = clients.filter(c => !detailsCache[c.id] && !pendingPrefetches.current.has(c.id));

        if (candidates.length > 0) {
            // Take the first few
            const batch = candidates.slice(0, 3);
            batch.forEach(c => prefetchClient(c.id));
        }
    }, [clients, detailsCache, isLoading]);

    async function loadInitialData() {
        setIsLoading(true);
        try {
            const [sData, nData, vData, bData, mData, cRes] = await Promise.all([
                getStatuses(),
                getNavigators(),
                getVendors(),
                getBoxTypes(),
                getMenuItems(),
                getClientsPaginated(1, PAGE_SIZE)
            ]);

            setStatuses(sData);
            setNavigators(nData);
            setVendors(vData);
            setBoxTypes(bData);
            setMenuItems(mData);
            setClients(cRes.clients.filter((c): c is NonNullable<typeof c> => c !== null));
            setTotalClients(cRes.total);
            setPage(1);
        } catch (error) {
            console.error("Error loading initial data:", error);
        } finally {
            setIsLoading(false);
        }
    }

    async function fetchMoreClients(nextPage: number) {
        setIsFetchingMore(true);
        try {
            const res = await getClientsPaginated(nextPage, PAGE_SIZE);
            setClients(prev => {
                // Deduplicate just in case
                const existingIds = new Set(prev.map(c => c.id));
                const newClients = res.clients.filter((c): c is NonNullable<typeof c> => c !== null && !existingIds.has(c.id));
                return [...prev, ...newClients];
            });
            setPage(nextPage);
            // Update total just in case it changed
            setTotalClients(res.total);
        } catch (error) {
            console.error(`Error fetching page ${nextPage}:`, error);
        } finally {
            setIsFetchingMore(false);
        }
    }

    async function prefetchClient(clientId: string) {
        if (detailsCache[clientId] || pendingPrefetches.current.has(clientId)) return;

        pendingPrefetches.current.add(clientId);
        try {
            const details = await getClientFullDetails(clientId);
            if (details) {
                setDetailsCache(prev => ({ ...prev, [clientId]: details as any }));
            }
        } catch (error) {
            console.error(`Error prefetching client ${clientId}:`, error);
        } finally {
            pendingPrefetches.current.delete(clientId);
        }
    }

    const filteredClients = clients.filter(c => {
        const matchesSearch = c.fullName.toLowerCase().includes(search.toLowerCase());

        // Filter by View
        let matchesView = true;
        if (currentView === 'eligible') {
            const status = statuses.find(s => s.id === c.statusId);
            // Show clients whose status allows deliveries
            matchesView = status ? status.deliveriesAllowed : false;
        } else if (currentView === 'ineligible') {
            const status = statuses.find(s => s.id === c.statusId);
            // Show clients whose status does NOT allow deliveries
            matchesView = status ? !status.deliveriesAllowed : false;
        }

        return matchesSearch && matchesView;
    });

    async function handleCreate() {
        if (!newClientName.trim()) return;

        // Default initial status (first one or specific ID if known)
        const initialStatusId = statuses[0]?.id || '';

        const newClient = await addClient({
            fullName: newClientName,
            email: '',
            address: '',
            phoneNumber: '',
            navigatorId: navigators.find(n => n.isActive)?.id || '',
            endDate: '',
            screeningTookPlace: false,
            screeningSigned: false,
            notes: '',
            statusId: initialStatusId,
            serviceType: 'Food', // Default
            approvedMealsPerWeek: 21 // Default per user request
        });

        if (newClient) {
            invalidateClientData(); // Invalidate cache
            setIsCreating(false);
            setNewClientName(''); // Reset
            // Refresh logic: for simplicity, confirm and maybe add to top? 
            // Or just reload all. Reloading all is safest.
            window.location.reload(); // Simplest way to reset pagination state correctly
        }
    }

    function getStatusName(id: string) {
        return statuses.find(s => s.id === id)?.name || 'Unknown';
    }

    function getNavigatorName(id: string) {
        return navigators.find(n => n.id === id)?.name || 'Unassigned';
    }

    function getOrderSummaryText(client: ClientProfile) {
        if (!client.activeOrder) return '-';
        const st = client.serviceType;
        const conf = client.activeOrder;

        let content = '';

        if (st === 'Food') {
            const limit = client.approvedMealsPerWeek || 0;
            const vendorsSummary = (conf.vendorSelections || [])
                .map(v => {
                    const vendorName = vendors.find(ven => ven.id === v.vendorId)?.name || 'Unknown';
                    const itemCount = Object.values(v.items || {}).reduce((a: number, b: any) => a + Number(b), 0);
                    return itemCount > 0 ? `${vendorName} (${itemCount})` : '';
                }).filter(Boolean).join(', ');

            if (!vendorsSummary) return '';
            content = `: ${vendorsSummary} [Max ${limit}]`;
        } else if (st === 'Boxes') {
            const box = boxTypes.find(b => b.id === conf.boxTypeId);
            const vendorName = vendors.find(v => v.id === box?.vendorId)?.name || '-';

            const itemDetails = Object.entries(conf.items || {}).map(([id, qty]) => {
                const item = menuItems.find(i => i.id === id);
                return item ? `${item.name} x${qty}` : null;
            }).filter(Boolean).join(', ');

            const itemSuffix = itemDetails ? ` (${itemDetails})` : '';
            content = `: ${vendorName}${itemSuffix}`;
        }

        return `${st}${content}`;
    }

    function getOrderSummary(client: ClientProfile) {
        if (!client.activeOrder) return '-';
        const st = client.serviceType;
        const conf = client.activeOrder;

        if (st === 'Food') {
            const limit = client.approvedMealsPerWeek || 0;
            const vendorSelections = (conf.vendorSelections || []).filter((v: any) => {
                const itemCount = Object.values(v.items || {}).reduce((a: number, b: any) => a + Number(b), 0);
                return itemCount > 0;
            });

            if (vendorSelections.length === 0) return null;

            // Build detailed summary showing vendors and their items
            const vendorDetails = vendorSelections.map((v: any) => {
                const vendorName = vendors.find(ven => ven.id === v.vendorId)?.name || 'Unknown';
                const items = Object.entries(v.items || {})
                    .filter(([_, qty]) => Number(qty) > 0)
                    .map(([itemId, qty]) => {
                        const item = menuItems.find(i => i.id === itemId);
                        return item ? `${item.name} x${qty}` : null;
                    })
                    .filter(Boolean)
                    .join(', ');

                return { vendorName, items };
            });

            // Create tooltip with full details
            const tooltipText = vendorDetails.map(v => 
                `${v.vendorName}: ${v.items || 'No items'}`
            ).join('\n') + `\n[Max ${limit}]`;

            // Display: Show vendors first, then items in a compact format
            const displayText = vendorDetails.map(v => 
                `${v.vendorName}: ${v.items || 'No items'}`
            ).join(' | ');

            return (
                <span title={tooltipText} style={{ display: 'block', lineHeight: '1.4' }}>
                    <strong style={{ fontWeight: 600, color: 'var(--color-primary)' }}>{st}</strong>
                    <span style={{ fontSize: '0.85rem', marginLeft: '4px' }}>
                        {displayText}
                    </span>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginLeft: '4px' }}>
                        [Max {limit}]
                    </span>
                </span>
            );
        } else if (st === 'Boxes') {
            const box = boxTypes.find(b => b.id === conf.boxTypeId);
            const vendorName = vendors.find(v => v.id === box?.vendorId)?.name || 'Unknown Vendor';
            const boxName = box?.name || 'Unknown Box';
            const items = Object.entries(conf.items || {})
                .filter(([_, qty]) => Number(qty) > 0)
                .map(([itemId, qty]) => {
                    const item = menuItems.find(i => i.id === itemId);
                    return item ? `${item.name} x${qty}` : null;
                })
                .filter(Boolean);

            if (items.length === 0) {
                return (
                    <span>
                        <strong style={{ fontWeight: 600, color: 'var(--color-primary)' }}>{st}</strong>
                        <span style={{ fontSize: '0.85rem', marginLeft: '4px' }}>
                            : {vendorName} - {boxName} × {conf.boxQuantity || 1}
                        </span>
                    </span>
                );
            }

            const itemsText = items.join(', ');
            const tooltipText = `${vendorName} - ${boxName} × ${conf.boxQuantity || 1}\nItems: ${itemsText}`;

            return (
                <span title={tooltipText} style={{ display: 'block', lineHeight: '1.4' }}>
                    <strong style={{ fontWeight: 600, color: 'var(--color-primary)' }}>{st}</strong>
                    <span style={{ fontSize: '0.85rem', marginLeft: '4px' }}>
                        : {vendorName} - {boxName} × {conf.boxQuantity || 1}
                    </span>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '2px', marginLeft: '0' }}>
                        {itemsText}
                    </div>
                </span>
            );
        }

        return null;
    }

    function getScreeningStatus(client: ClientProfile) {
        return (
            <div style={{ display: 'flex', gap: '8px' }}>
                <span title="Took Place" style={{ color: client.screeningTookPlace ? 'var(--color-success)' : 'var(--text-tertiary)' }}>
                    {client.screeningTookPlace ? <CheckSquare size={16} /> : <Square size={16} />}
                </span>
                <span title="Signed" style={{ color: client.screeningSigned ? 'var(--color-success)' : 'var(--text-tertiary)' }}>
                    {client.screeningSigned ? <StickyNote size={16} /> : <Square size={16} />}
                </span>
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className={styles.container}>
                <div className={styles.header}>
                    <h1 className={styles.title}>Clients</h1>
                </div>
                <div className={styles.loadingContainer}>
                    <div className="spinner"></div>
                    <p>Loading clients...</p>
                </div>
            </div>
        );
    }

    return (
        <div className={styles.container}>
            <div className={styles.header}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}>
                    <h1 className={styles.title}>Clients</h1>
                    {!isLoading && (
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                            {clients.length} / {totalClients} loaded
                        </span>
                    )}
                </div>
                <div className={styles.headerActions}>
                    <div className={styles.viewToggle}>
                        <button
                            className={`${styles.viewBtn} ${currentView === 'all' ? styles.viewBtnActive : ''}`}
                            onClick={() => setCurrentView('all')}
                        >
                            All Clients
                        </button>
                        <button
                            className={`${styles.viewBtn} ${currentView === 'eligible' ? styles.viewBtnActive : ''}`}
                            onClick={() => setCurrentView('eligible')}
                        >
                            Eligible
                        </button>
                        <button
                            className={`${styles.viewBtn} ${currentView === 'ineligible' ? styles.viewBtnActive : ''}`}
                            onClick={() => setCurrentView('ineligible')}
                        >
                            Ineligible
                        </button>
                        <button
                            className={`${styles.viewBtn} ${currentView === 'billing' ? styles.viewBtnActive : ''}`}
                            onClick={() => router.push('/billing')}
                        >
                            Billing
                        </button>
                    </div>

                    <button className="btn btn-primary" onClick={() => setIsCreating(true)}>
                        <Plus size={16} /> New Client
                    </button>
                </div>
            </div>

            <div className={styles.filters}>
                <div className={styles.searchBox}>
                    <Search size={18} className={styles.searchIcon} />
                    <input
                        className="input"
                        placeholder="Search clients..."
                        style={{ paddingLeft: '2.5rem', width: '300px' }}
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                </div>
            </div>

            {isCreating && (
                <div className={styles.createModal}>
                    <div className={styles.createCard}>
                        <h3>Create New Client</h3>
                        <div className={styles.formGroup}>
                            <label className="label">Client Name</label>
                            <input
                                className="input"
                                placeholder="Full Name"
                                value={newClientName}
                                onChange={e => setNewClientName(e.target.value)}
                                autoFocus
                            />
                        </div>
                        <div className={styles.modalActions}>
                            <button className="btn btn-primary" onClick={handleCreate}>Create & Edit</button>
                            <button className="btn btn-secondary" onClick={() => setIsCreating(false)}>Cancel</button>
                        </div>
                    </div>
                    <div className={styles.overlay} onClick={() => setIsCreating(false)}></div>
                </div>
            )}

            <div className={styles.list}>
                <div className={styles.listHeader}>
                    <span style={{ minWidth: '200px', flex: 2, paddingRight: '16px' }}>Name</span>
                    <span style={{ minWidth: '140px', flex: 1, paddingRight: '16px' }}>Status</span>
                    <span style={{ minWidth: '160px', flex: 1, paddingRight: '16px' }}>Navigator</span>
                    <span style={{ minWidth: '100px', flex: 0.8, paddingRight: '16px' }}>Screening</span>
                    <span style={{ minWidth: '350px', flex: 3, paddingRight: '16px' }}>Active Order</span>
                    <span style={{ minWidth: '180px', flex: 1.2, paddingRight: '16px' }}>Email</span>
                    <span style={{ minWidth: '140px', flex: 1, paddingRight: '16px' }}>Phone</span>
                    <span style={{ minWidth: '250px', flex: 2, paddingRight: '16px' }}>Address</span>
                    <span style={{ minWidth: '200px', flex: 2 }}>Notes</span>
                    <span style={{ width: '40px' }}></span>
                </div>
                {filteredClients.map(client => {
                    const status = statuses.find(s => s.id === client.statusId);
                    const isNotAllowed = status ? status.deliveriesAllowed === false : false;

                    return (
                        <div
                            key={client.id}
                            onClick={() => setSelectedClientId(client.id)}
                            className={`${styles.clientRow} ${isNotAllowed ? styles.clientRowNotAllowed : ''}`}
                            style={{ cursor: 'pointer' }}
                        >
                            <span title={client.fullName} style={{ minWidth: '200px', flex: 2, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}>{client.fullName}</span>
                            <span title={getStatusName(client.statusId)} style={{ minWidth: '140px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}>
                                <span className={`badge ${getStatusName(client.statusId) === 'Active' ? 'badge-success' : ''}`}>
                                    {getStatusName(client.statusId)}
                                </span>
                            </span>
                            <span title={getNavigatorName(client.navigatorId)} style={{ minWidth: '160px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}>{getNavigatorName(client.navigatorId)}</span>
                            <span style={{ minWidth: '100px', flex: 0.8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}>{getScreeningStatus(client)}</span>
                            <span style={{ minWidth: '350px', flex: 3, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}>
                                {getOrderSummary(client)}
                            </span>
                            <span title={client.email || undefined} style={{ minWidth: '180px', flex: 1.2, fontSize: '0.85rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}>
                                {client.email || '-'}
                            </span>
                            <span title={client.phoneNumber} style={{ minWidth: '140px', flex: 1, fontSize: '0.85rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}>
                                {client.phoneNumber || '-'}
                            </span>
                            <span title={client.address} style={{ minWidth: '250px', flex: 2, fontSize: '0.85rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}>
                                {client.address || '-'}
                            </span>
                            <span title={client.notes} style={{ minWidth: '200px', flex: 2, fontSize: '0.85rem', color: 'var(--text-tertiary)', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}>
                                {client.notes || '-'}
                            </span>
                            <span style={{ width: '40px' }}><ChevronRight size={16} /></span>
                        </div>
                    );
                })}
                {filteredClients.length === 0 && !isLoading && (
                    <div className={styles.empty}>
                        {currentView === 'ineligible' ? 'No ineligible clients found.' :
                            currentView === 'eligible' ? 'No eligible clients found.' :
                                'No clients found.'}
                    </div>
                )}
            </div>

            {selectedClientId && (
                <div className={styles.profileModal}>
                    <div className={styles.profileCard}>
                        <ClientProfileDetail
                            clientId={selectedClientId}
                            initialData={detailsCache[selectedClientId]}
                            onClose={() => {
                                setSelectedClientId(null);
                                // Clear the cached details for this client
                                setDetailsCache(prev => {
                                    const next = { ...prev };
                                    delete next[selectedClientId];
                                    return next;
                                });
                                // Invalidate cache and refresh data on close in case of changes
                                invalidateClientData();
                                loadInitialData();
                            }}
                        />
                    </div>
                    <div className={styles.overlay} onClick={() => setSelectedClientId(null)}></div>
                </div>
            )}
        </div>
    );
}
