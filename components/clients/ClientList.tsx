'use client';

import { ClientProfileDetail } from './ClientProfile';
import { ClientInfoShelf } from './ClientInfoShelf';

import { useState, useEffect, useRef, ReactElement } from 'react';
import { ClientProfile, ClientStatus, Navigator, Vendor, BoxType, ClientFullDetails, MenuItem } from '@/lib/types';
import {
    getClientsPaginated,
    getClientFullDetails,
    getStatuses,
    getNavigators,
    addClient,
    addDependent,
    getRegularClients,
    getVendors,
    getBoxTypes,
    getMenuItems,
    getClients,
    updateClient,
    getUpcomingOrderForClient as serverGetUpcomingOrderForClient,
    getCompletedOrdersWithDeliveryProof as serverGetCompletedOrdersWithDeliveryProof,
    getBatchClientDetails
} from '@/lib/actions';
import { invalidateClientData } from '@/lib/cached-data';
import { Plus, Search, ChevronRight, CheckSquare, Square, StickyNote, Package, ArrowUpDown, ArrowUp, ArrowDown, Filter, Eye, EyeOff, Loader2, AlertCircle, X, PenTool, Copy, Check, ExternalLink } from 'lucide-react';
import styles from './ClientList.module.css';
import { useRouter } from 'next/navigation';

interface ClientListProps {
    currentUser?: { role: string; id: string } | null;
}

export function ClientList({ currentUser }: ClientListProps = {}) {
    const router = useRouter();
    const [clients, setClients] = useState<ClientProfile[]>([]);
    const [statuses, setStatuses] = useState<ClientStatus[]>([]);
    const [navigators, setNavigators] = useState<Navigator[]>([]);
    const [vendors, setVendors] = useState<Vendor[]>([]);
    const [boxTypes, setBoxTypes] = useState<BoxType[]>([]);
    const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
    const [allClientsForLookup, setAllClientsForLookup] = useState<ClientProfile[]>([]);
    const [search, setSearch] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);

    // Pagination State
    const [page, setPage] = useState(1);
    const [totalClients, setTotalClients] = useState(0);
    const [isFetchingMore, setIsFetchingMore] = useState(false);
    const PAGE_SIZE = 20;

    // Prefetching State
    const [detailsCache, setDetailsCache] = useState<Record<string, ClientFullDetails>>({});
    const pendingPrefetches = useRef<Set<string>>(new Set());

    // Track which clients have already logged missing vendor ID warnings (to avoid spam)
    const loggedMissingVendorIds = useRef<Set<string>>(new Set());

    // Views
    const [currentView, setCurrentView] = useState<'all' | 'eligible' | 'ineligible' | 'billing' | 'needs-attention'>('all');

    // Sorting State
    const [sortColumn, setSortColumn] = useState<string | null>(null);
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

    // Filtering State
    const [statusFilter, setStatusFilter] = useState<string | null>(null);
    const [navigatorFilter, setNavigatorFilter] = useState<string | null>(null);
    const [screeningFilter, setScreeningFilter] = useState<string | null>(null);
    const [serviceTypeFilter, setServiceTypeFilter] = useState<string | null>(null);
    const [needsVendorFilter, setNeedsVendorFilter] = useState<boolean>(false);
    const [openFilterMenu, setOpenFilterMenu] = useState<string | null>(null);

    // Add Dependent Modal state
    const [isAddingDependent, setIsAddingDependent] = useState(false);
    const [dependentName, setDependentName] = useState('');
    const [dependentDob, setDependentDob] = useState('');
    const [dependentCin, setDependentCin] = useState('');
    const [selectedParentClientId, setSelectedParentClientId] = useState<string>('');
    const [regularClients, setRegularClients] = useState<ClientProfile[]>([]);
    const [parentClientSearch, setParentClientSearch] = useState('');
    const [editingDependentId, setEditingDependentId] = useState<string | null>(null);

    // Show/Hide Dependents Toggle
    const [showDependents, setShowDependents] = useState(false);

    // Selected Client for Modal
    const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

    // Info Shelf State
    const [infoShelfClientId, setInfoShelfClientId] = useState<string | null>(null);

    // Order Details Visibility Toggle
    const [showOrderDetails, setShowOrderDetails] = useState(false);

    // Signature state (matching dietfantasy pattern)
    const [signatureCounts, setSignatureCounts] = useState<Record<string, number>>({});
    const [signatureCopied, setSignatureCopied] = useState<Record<string, boolean>>({});
    const [signatureLoading, setSignatureLoading] = useState<Record<string, boolean>>({});
    const [tokenCache, setTokenCache] = useState<Record<string, string>>({});

    useEffect(() => {
        loadInitialData();
        loadSignatureCounts();
    }, []);

    // Load signature counts from API
    async function loadSignatureCounts() {
        try {
            const res = await fetch('/api/signatures/status', { cache: 'no-store' });
            if (!res.ok) return;
            const rows = await res.json();
            const counts: Record<string, number> = {};
            for (const row of rows) {
                counts[row.userId] = row.collected || row._count?.userId || 0;
            }
            setSignatureCounts(counts);
        } catch (error) {
            console.error('Error loading signature counts:', error);
        }
    }

    // Reload data when view changes
    useEffect(() => {
        if (!isLoading) {
            loadInitialData();
            loadSignatureCounts();
        }
    }, [currentView]);

    // Helper function to get signature count for a client
    const getSignatureCount = (clientId: string): number => {
        return signatureCounts[clientId] || 0;
    };

    // Helper function to ensure token exists and get it (matches dietfantasy exactly)
    const ensureSignatureToken = async (clientId: string): Promise<string | null> => {
        try {
            // Try legacy endpoint first (matches dietfantasy pattern)
            const legacy = await fetch(`/api/signatures/ensure-token/${clientId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: '{}',
            });
            if (legacy.ok) {
                const legacyData = await legacy.json();
                return legacyData.sign_token ?? null;
            }
            // Try alternative endpoint (dietfantasy fallback pattern)
            const body = await fetch(`/api/signatures/ensure-token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ userId: clientId }),
            });
            const data = await body.json();
            return data.sign_token ?? data.signToken ?? data.token ?? null;
        } catch {
            return null;
        }
    };

    // SignCell component matching dietfantasy exactly
    const SignCell = ({ client }: { client: ClientProfile }) => {
        const clientId = client.id;
        const collected = getSignatureCount(clientId);
        const done = collected >= 5;
        const isCopied = signatureCopied[clientId] || false;
        const isLoading = signatureLoading[clientId] || false;

        const handleSignClick = async (e: React.MouseEvent) => {
            e.stopPropagation(); // Prevent row click
            
            if (isLoading) return;
            
            setSignatureLoading(prev => ({ ...prev, [clientId]: true }));
            
            // Get token from multiple sources (matches dietfantasy token lookup order exactly)
            // Note: tokenPatch in dietfantasy is never set, so tokens are always fetched fresh
            // We use tokenCache here as equivalent to tokenPatch for potential future caching
            const token = tokenCache[clientId] ??
                         client.signToken ??
                         (client as any).sign_token ??
                         (client as any).token ??
                         (await ensureSignatureToken(clientId));
            
            setSignatureLoading(prev => ({ ...prev, [clientId]: false }));
            
            if (!token) {
                alert('Could not create a signature link. Try again.');
                return;
            }

            const base = `${window.location.origin}/sign/${token}`;
            
            if (done) {
                // Open signature view page (matches dietfantasy: checks with HEAD first)
                const viewerUrl = `${base}/view`;
                try {
                    const head = await fetch(viewerUrl, { method: 'HEAD' });
                    window.open(head.ok ? viewerUrl : base, '_blank', 'noopener,noreferrer');
                } catch {
                    window.open(base, '_blank', 'noopener,noreferrer');
                }
            } else {
                // Copy signature link to clipboard (matches dietfantasy exactly)
                try {
                    await navigator.clipboard.writeText(base);
                    setSignatureCopied(prev => ({ ...prev, [clientId]: true }));
                    setTimeout(() => {
                        setSignatureCopied(prev => ({ ...prev, [clientId]: false }));
                    }, 1800);
                } catch {
                    alert('Failed to copy link.');
                }
            }
        };

        // Match dietfantasy exactly: only show IconButton wrapped in tooltip, no count display
        return (
            <button
                onClick={handleSignClick}
                disabled={isLoading}
                style={{
                    background: 'none',
                    border: 'none',
                    cursor: isLoading ? 'not-allowed' : 'pointer',
                    padding: '4px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: isLoading ? 0.6 : 1,
                }}
                title={done ? 'View completed signatures' : isCopied ? 'Link Copied!' : 'Copy link'}
                aria-label="Sign link"
            >
                {isLoading ? (
                    <Loader2 size={18} className="animate-spin" style={{ color: 'var(--color-primary)' }} />
                ) : done || isCopied ? (
                    <Check size={18} style={{ color: '#4caf50' }} />
                ) : (
                    <Copy size={18} style={{ color: '#1976d2' }} />
                )}
            </button>
        );
    };

    // Progressive Loading Effect
    useEffect(() => {
        if (!isLoading && clients.length < totalClients && !isFetchingMore) {
            // Fetch next page
            const nextPage = page + 1;
            fetchMoreClients(nextPage);
        }
    }, [clients.length, totalClients, isLoading, isFetchingMore, page, currentView]);

    // Background Prefetching Effect - Re-enabled with Batch Fetching
    useEffect(() => {
        if (isLoading || clients.length === 0) return;

        // Prefetch visible clients (e.g., current page)
        // Since we have all clients loaded progressively, let's just grab the ones that are likely visible
        // based on scroll or just checking cache.
        // For simplicity and efficiency, let's check the first 20 clients that are missing form cache.
        // This is much better than one-by-one.

        const missingCache = clients
            .filter(c => !detailsCache[c.id] && !pendingPrefetches.current.has(c.id))
            .slice(0, 20); // Batch size of 20

        if (missingCache.length > 0) {
            const idsToFetch = missingCache.map(c => c.id);
            // Mark as pending
            idsToFetch.forEach(id => pendingPrefetches.current.add(id));

            console.log(`[Prefetch] Batch fetching ${idsToFetch.length} clients...`);

            getBatchClientDetails(idsToFetch).then(results => {
                setDetailsCache(prev => ({ ...prev, ...results }));
                // Cleanup pending
                idsToFetch.forEach(id => pendingPrefetches.current.delete(id));
            }).catch(err => {
                console.error('[Prefetch] Batch fetch failed:', err);
                idsToFetch.forEach(id => pendingPrefetches.current.delete(id));
            });
        }
    }, [clients, detailsCache, isLoading]);

    // Load client details when info shelf opens
    useEffect(() => {
        if (infoShelfClientId && !detailsCache[infoShelfClientId] && !pendingPrefetches.current.has(infoShelfClientId)) {
            prefetchClient(infoShelfClientId);
        }
    }, [infoShelfClientId, detailsCache]);

    // Click-outside-to-close filter menus
    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            const target = event.target as HTMLElement;
            const filterDropdown = target.closest('[data-filter-dropdown]');
            if (!filterDropdown) {
                setOpenFilterMenu(null);
            }
        }

        if (openFilterMenu) {
            document.addEventListener('click', handleClickOutside);
            return () => document.removeEventListener('click', handleClickOutside);
        }
    }, [openFilterMenu]);

    async function loadInitialData() {
        setIsLoading(true);
        try {
            const [sData, nData, vData, bData, mData, cRes, allClientsData] = await Promise.all([
                getStatuses(),
                getNavigators(),
                getVendors(),
                getBoxTypes(),
                getMenuItems(),
                getClientsPaginated(1, PAGE_SIZE, ''),
                getClients() // Load all clients for parent client lookup
            ]);

            setStatuses(sData);
            setNavigators(nData);
            setVendors(vData);
            setBoxTypes(bData);
            setMenuItems(mData);
            setClients(cRes.clients.filter((c): c is NonNullable<typeof c> => c !== null));
            setTotalClients(cRes.total);
            setAllClientsForLookup(allClientsData.filter((c): c is NonNullable<typeof c> => c !== null));
            setPage(1);
        } catch (error) {
            console.error("Error loading initial data:", error);
        } finally {
            setIsLoading(false);
        }
    }

    async function refreshDataInBackground() {
        setIsRefreshing(true);
        try {
            // Invalidate cache to ensure fresh data
            invalidateClientData();

            // Fetch fresh data
            const [sData, nData, vData, bData, mData, cRes] = await Promise.all([
                getStatuses(),
                getNavigators(),
                getVendors(),
                getBoxTypes(),
                getMenuItems(),
                getClientsPaginated(1, PAGE_SIZE, '')
            ]);

            // Update all data
            setStatuses(sData);
            setNavigators(nData);
            setVendors(vData);
            setBoxTypes(bData);
            setMenuItems(mData);
            setClients(cRes.clients.filter((c): c is NonNullable<typeof c> => c !== null));
            setTotalClients(cRes.total);
            // Refresh all clients lookup when refreshing
            const allClientsData = await getClients();
            setAllClientsForLookup(allClientsData.filter((c): c is NonNullable<typeof c> => c !== null));
            setPage(1);
            
            // Refresh signature counts
            loadSignatureCounts();
        } catch (error) {
            console.error("Error refreshing data:", error);
        } finally {
            setIsRefreshing(false);
        }
    }

    async function fetchMoreClients(nextPage: number) {
        setIsFetchingMore(true);
        try {
            const res = await getClientsPaginated(nextPage, PAGE_SIZE, '');
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

    const baseFilteredClients = clients.filter(c => {
        const searchLower = search.toLowerCase();
        const matchesSearch =
            c.fullName.toLowerCase().includes(searchLower) ||
            (c.phoneNumber && c.phoneNumber.includes(searchLower)) ||
            (c.secondaryPhoneNumber && c.secondaryPhoneNumber.includes(searchLower)) ||
            (c.address && c.address.toLowerCase().includes(searchLower)) ||
            (c.email && c.email.toLowerCase().includes(searchLower)) ||
            (c.notes && c.notes.toLowerCase().includes(searchLower));

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
        } else if (currentView === 'needs-attention') {
            // First, check if client is eligible (status allows deliveries)
            const status = statuses.find(s => s.id === c.statusId);
            const isEligible = status ? status.deliveriesAllowed : false;

            // Only show eligible clients that need attention
            if (!isEligible) {
                matchesView = false;
            } else {
                // Show clients that need attention based on specific criteria:
                // 1. Clients with boxes that do not have a vendor assigned
                // 2. Clients whose expiration date is within the current month
                // 3. Clients with boxes whose authorized amount is less than 584
                // 4. Clients with food whose authorized amount is less than 1344

                const now = new Date();
                const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
                const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

                // 1. Check if client with boxes doesn't have vendor assigned
                let boxesNeedsVendor = false;
                if (c.serviceType === 'Boxes') {
                    if (c.activeOrder && c.activeOrder.serviceType === 'Boxes') {
                        const box = boxTypes.find(b => b.id === c.activeOrder?.boxTypeId);
                        const vendorId = c.activeOrder.vendorId || box?.vendorId;
                        boxesNeedsVendor = !vendorId;
                    } else {
                        boxesNeedsVendor = true; // No active order means needs vendor
                    }
                }

                // 2. Check if expiration date is within current month
                let expirationInCurrentMonth = false;
                if (c.expirationDate) {
                    const expDate = new Date(c.expirationDate);
                    expirationInCurrentMonth = expDate >= firstDayOfMonth && expDate <= lastDayOfMonth;
                }

                // 3. Check if boxes client has authorized amount < 584 or is null/undefined
                const boxesLowOrNoAmount = c.serviceType === 'Boxes' && (c.authorizedAmount === null || c.authorizedAmount === undefined || c.authorizedAmount < 584);

                // 4. Check if food client has authorized amount < 1344 or is null/undefined
                const foodLowOrNoAmount = c.serviceType === 'Food' && (c.authorizedAmount === null || c.authorizedAmount === undefined || c.authorizedAmount < 1344);

                matchesView = boxesNeedsVendor || expirationInCurrentMonth || boxesLowOrNoAmount || foodLowOrNoAmount;
            }
        }
        // 'billing' might just show all clients but with different columns?

        // Filter by Status
        const matchesStatusFilter = !statusFilter || c.statusId === statusFilter;

        // Filter by Navigator
        const matchesNavigatorFilter = !navigatorFilter || c.navigatorId === navigatorFilter;

        // Filter by Screening Status
        const matchesScreeningFilter = !screeningFilter || (c.screeningStatus || 'not_started') === screeningFilter;

        // Filter by Service Type (Active Order)
        const matchesServiceTypeFilter = !serviceTypeFilter || c.serviceType === serviceTypeFilter;

        // Filter by Needs Vendor (for Boxes clients without vendor)
        let matchesNeedsVendorFilter = true;
        if (needsVendorFilter) {
            if (c.serviceType !== 'Boxes') {
                matchesNeedsVendorFilter = false;
            } else {
                // Check if client has vendor set in their active order (same logic as getOrderSummary)
                if (c.activeOrder && c.activeOrder.serviceType === 'Boxes') {
                    const box = boxTypes.find(b => b.id === c.activeOrder?.boxTypeId);
                    const vendorId = c.activeOrder.vendorId || box?.vendorId;
                    // If vendor is set, exclude from needs-vendor filter
                    matchesNeedsVendorFilter = !vendorId;
                } else {
                    // If no active order or not Boxes, they need vendor assignment
                    matchesNeedsVendorFilter = true;
                }
            }
        }

        // Filter by Dependents visibility
        const matchesDependentsFilter = showDependents || !c.parentClientId;

        return matchesSearch && matchesView && matchesStatusFilter && matchesNavigatorFilter && matchesScreeningFilter && matchesServiceTypeFilter && matchesNeedsVendorFilter && matchesDependentsFilter;
    });

    // Group dependents under their parent clients
    // First, separate parent clients and dependents
    const parentClients = baseFilteredClients.filter(c => !c.parentClientId);
    const dependents = baseFilteredClients.filter(c => c.parentClientId);

    // Helper function to compare clients based on sort column
    function compareClients(a: ClientProfile, b: ClientProfile): number {
        // Always sort clients needing vendor assignment to the top
        const aNeedsVendor = a.serviceType === 'Boxes' && (!a.activeOrder || (a.activeOrder.serviceType === 'Boxes' && !a.activeOrder.vendorId && !boxTypes.find(bt => bt.id === a.activeOrder?.boxTypeId)?.vendorId));
        const bNeedsVendor = b.serviceType === 'Boxes' && (!b.activeOrder || (b.activeOrder.serviceType === 'Boxes' && !b.activeOrder.vendorId && !boxTypes.find(bt => bt.id === b.activeOrder?.boxTypeId)?.vendorId));

        if (aNeedsVendor !== bNeedsVendor) {
            return aNeedsVendor ? -1 : 1; // Clients needing vendor come first
        }

        if (!sortColumn) {
            // Default to alphabetical by name
            return a.fullName.localeCompare(b.fullName);
        }

        let comparison = 0;

        switch (sortColumn) {
            case 'name':
                comparison = a.fullName.localeCompare(b.fullName);
                break;
            case 'status':
                const statusA = getStatusName(a.statusId);
                const statusB = getStatusName(b.statusId);
                comparison = statusA.localeCompare(statusB);
                break;
            case 'navigator':
                const navA = getNavigatorName(a.navigatorId);
                const navB = getNavigatorName(b.navigatorId);
                comparison = navA.localeCompare(navB);
                break;
            case 'screening':
                const screeningA = a.screeningStatus || 'not_started';
                const screeningB = b.screeningStatus || 'not_started';
                comparison = screeningA.localeCompare(screeningB);
                break;
            case 'email':
                const emailA = a.email || '';
                const emailB = b.email || '';
                comparison = emailA.localeCompare(emailB);
                break;
            case 'phone':
                const phoneA = a.phoneNumber || '';
                const phoneB = b.phoneNumber || '';
                comparison = phoneA.localeCompare(phoneB);
                break;
            case 'secondaryPhone':
                const secondaryPhoneA = a.secondaryPhoneNumber || '';
                const secondaryPhoneB = b.secondaryPhoneNumber || '';
                comparison = secondaryPhoneA.localeCompare(secondaryPhoneB);
                break;
            case 'address':
                const addressA = a.address || '';
                const addressB = b.address || '';
                comparison = addressA.localeCompare(addressB);
                break;
            case 'notes':
                const notesA = a.notes || '';
                const notesB = b.notes || '';
                comparison = notesA.localeCompare(notesB);
                break;
            case 'authorizedAmount':
                const amountA = a.authorizedAmount ?? 0;
                const amountB = b.authorizedAmount ?? 0;
                comparison = amountA - amountB;
                break;
            case 'expirationDate':
                const dateA = a.expirationDate ? new Date(a.expirationDate).getTime() : 0;
                const dateB = b.expirationDate ? new Date(b.expirationDate).getTime() : 0;
                comparison = dateA - dateB;
                break;
            case 'signatures':
                const sigCountA = getSignatureCount(a.id);
                const sigCountB = getSignatureCount(b.id);
                // Sort by: has signatures first, then by count, then by name
                const hasA = sigCountA > 0 ? 1 : 0;
                const hasB = sigCountB > 0 ? 1 : 0;
                if (hasA !== hasB) {
                    comparison = hasB - hasA; // Those with signatures first
                } else if (sigCountA !== sigCountB) {
                    comparison = sigCountB - sigCountA; // More signatures first
                } else {
                    // Same signature count, sort by name
                    const nameA = a.fullName || '';
                    const nameB = b.fullName || '';
                    comparison = nameA.localeCompare(nameB);
                }
                break;
            default:
                comparison = a.fullName.localeCompare(b.fullName);
        }

        return sortDirection === 'asc' ? comparison : -comparison;
    }

    // Sort parent clients (default to alphabetical by name)
    const sortedParentClients = [...parentClients].sort(compareClients);

    // Group dependents by parent ID and sort them alphabetically within each group
    const dependentsByParent = new Map<string, ClientProfile[]>();
    dependents.forEach(dep => {
        const parentId = dep.parentClientId!;
        if (!dependentsByParent.has(parentId)) {
            dependentsByParent.set(parentId, []);
        }
        dependentsByParent.get(parentId)!.push(dep);
    });

    // Sort dependents within each parent group (always alphabetically by name, ignoring other sort columns)
    dependentsByParent.forEach((deps, parentId) => {
        deps.sort((a, b) => a.fullName.localeCompare(b.fullName));
    });

    // Build final list: each parent followed by its dependents
    const groupedClients: ClientProfile[] = [];
    sortedParentClients.forEach(parent => {
        groupedClients.push(parent);
        // Add dependents for this parent (they're already filtered by showDependents in the base filter)
        const parentDependents = dependentsByParent.get(parent.id) || [];
        groupedClients.push(...parentDependents);
    });

    // Also include dependents whose parents are not in the filtered list (orphaned dependents)
    const orphanedDependents = dependents.filter(dep => {
        const parentId = dep.parentClientId!;
        return !sortedParentClients.some(p => p.id === parentId);
    });
    if (orphanedDependents.length > 0) {
        orphanedDependents.sort((a, b) => a.fullName.localeCompare(b.fullName));
        groupedClients.push(...orphanedDependents);
    }

    // Use the grouped clients as the final filtered list
    const filteredClients = groupedClients;

    function handleCreate() {
        // Open the modal immediately with "new" as a special clientId
        // The modal will handle creating the client when the user clicks save
        setSelectedClientId('new');
    }

    async function handleAddDependent() {
        if (!dependentName.trim() || !selectedParentClientId) return;

        try {
            const dobValue = dependentDob.trim() || null;
            const cinValue = dependentCin.trim() ? parseFloat(dependentCin.trim()) : null;
            
            if (editingDependentId) {
                // Update existing dependent
                await updateClient(editingDependentId, {
                    fullName: dependentName.trim(),
                    parentClientId: selectedParentClientId,
                    dob: dobValue,
                    cin: cinValue
                });
            } else {
                // Create new dependent
                const newDependent = await addDependent(dependentName.trim(), selectedParentClientId, dobValue, cinValue);
                if (!newDependent) return;
            }

            invalidateClientData(); // Invalidate cache
            setIsAddingDependent(false);
            setDependentName('');
            setDependentDob('');
            setDependentCin('');
            setSelectedParentClientId('');
            setParentClientSearch('');
            setEditingDependentId(null);
            window.location.reload(); // Reload to refresh the list
        } catch (error) {
            console.error('Error saving dependent:', error);
            alert(error instanceof Error ? error.message : 'Failed to save dependent');
        }
    }

    // Load regular clients when dependent modal opens
    useEffect(() => {
        if (isAddingDependent) {
            getRegularClients().then(setRegularClients).catch(console.error);
        }
    }, [isAddingDependent]);

    const filteredRegularClients = regularClients.filter(c =>
        c.fullName.toLowerCase().includes(parentClientSearch.toLowerCase())
    );

    // Calculate total clients (excluding dependents)
    const totalRegularClients = clients.filter(c => !c.parentClientId).length;

    function getStatusName(id: string) {
        return statuses.find(s => s.id === id)?.name || 'Unknown';
    }

    function getNavigatorName(id: string) {
        return navigators.find(n => n.id === id)?.name || 'Unassigned';
    }

    function getParentClientName(client: ClientProfile) {
        if (!client.parentClientId) return null;
        const parentClient = allClientsForLookup.find(c => c.id === client.parentClientId);
        return parentClient?.fullName || 'Unknown Parent';
    }

    function handleSort(column: string) {
        if (sortColumn === column) {
            // Toggle direction
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            // New column, default to ascending
            setSortColumn(column);
            setSortDirection('asc');
        }
    }

    function getSortIcon(column: string) {
        if (sortColumn !== column) {
            return <ArrowUpDown size={14} />;
        }
        return sortDirection === 'asc' ? <ArrowUp size={14} /> : <ArrowDown size={14} />;
    }

    function getScreeningStatusLabel(status: string) {
        switch (status) {
            case 'not_started':
                return 'Not Started';
            case 'waiting_approval':
                return 'Waiting for Approval';
            case 'approved':
                return 'Approved';
            case 'rejected':
                return 'Rejected';
            default:
                return status;
        }
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
            // Check vendorId from order config first, then fall back to boxType
            const box = boxTypes.find(b => b.id === conf.boxTypeId);
            const vendorId = conf.vendorId || box?.vendorId;
            const vendorName = vendors.find(v => v.id === vendorId)?.name || '-';

            console.log('[ClientList.getOrderSummaryText] Box order display:', {
                clientId: client.id,
                confVendorId: conf.vendorId,
                boxTypeId: conf.boxTypeId,
                boxVendorId: box?.vendorId,
                resolvedVendorId: vendorId,
                vendorName
            });

            const itemDetails = Object.entries(conf.items || {}).map(([id, qty]) => {
                const item = menuItems.find(i => i.id === id);
                return item ? `${item.name} x${qty}` : null;
            }).filter(Boolean).join(', ');

            const itemSuffix = itemDetails ? ` (${itemDetails})` : '';
            content = `: ${vendorName}${itemSuffix}`;
        }

        return `${st}${content}`;
    }

    function getOrderSummary(client: ClientProfile, forceDetails: boolean = false) {
        if (!client.activeOrder) return forceDetails ? <span style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}>No active order</span> : '-';
        const st = client.serviceType;
        const conf = client.activeOrder;

        if (!showOrderDetails && !forceDetails) {
            let vendorSummary = 'Not Set';

            if (st === 'Food') {
                const uniqueVendors = new Set<string>();

                // Check if it's multi-day format
                const isMultiDay = conf.deliveryDayOrders && typeof conf.deliveryDayOrders === 'object';

                if (isMultiDay) {
                    Object.values(conf.deliveryDayOrders || {}).forEach((dayOrder: any) => {
                        if (dayOrder?.vendorSelections) {
                            dayOrder.vendorSelections.forEach((v: any) => {
                                const vName = vendors.find(ven => ven.id === v.vendorId)?.name;
                                if (vName) uniqueVendors.add(vName);
                            });
                        }
                    });
                } else if (conf.vendorSelections) {
                    conf.vendorSelections.forEach(v => {
                        const vName = vendors.find(ven => ven.id === v.vendorId)?.name;
                        if (vName) uniqueVendors.add(vName);
                    });
                }

                if (uniqueVendors.size > 0) {
                    vendorSummary = Array.from(uniqueVendors).join(', ');
                }
            } else if (st === 'Boxes') {
                // Simplified vendor extraction - check all possible locations
                const vendorIdsToCheck = new Set<string>();
                const boxesArray = (conf as any).boxOrders || (conf as any).boxes;
                
                // Strategy 1: Check top-level vendorId
                if (conf.vendorId) {
                    const vId = String(conf.vendorId).trim();
                    if (vId) vendorIdsToCheck.add(vId);
                }
                
                // Strategy 2: Check boxOrders array - each box's vendorId
                if (boxesArray && Array.isArray(boxesArray)) {
                    boxesArray.forEach((box: any) => {
                        if (box.vendorId) {
                            const vId = String(box.vendorId).trim();
                            if (vId) vendorIdsToCheck.add(vId);
                        }
                    });
                }
                
                // Strategy 3: Get vendor from boxTypeId (top level)
                if (conf.boxTypeId && vendorIdsToCheck.size === 0) {
                    const boxType = boxTypes.find(b => b.id === conf.boxTypeId);
                    if (boxType?.vendorId) {
                        const vId = String(boxType.vendorId).trim();
                        if (vId) vendorIdsToCheck.add(vId);
                    }
                }
                
                // Strategy 4: Get vendor from boxOrders boxTypeId
                if (boxesArray && Array.isArray(boxesArray) && vendorIdsToCheck.size === 0) {
                    for (const box of boxesArray) {
                        if (box.boxTypeId) {
                            const boxType = boxTypes.find(b => b.id === box.boxTypeId);
                            if (boxType?.vendorId) {
                                const vId = String(boxType.vendorId).trim();
                                if (vId) {
                                    vendorIdsToCheck.add(vId);
                                    break; // Use first found
                                }
                            }
                        }
                    }
                }
                
                // Strategy 5: Check nested day-based structure (legacy)
                if (vendorIdsToCheck.size === 0 && typeof conf === 'object') {
                    const dayKeys = Object.keys(conf).filter(k =>
                        k !== 'id' && k !== 'serviceType' && k !== 'caseId' && 
                        typeof (conf as any)[k] === 'object' && (conf as any)[k]?.vendorId
                    );
                    if (dayKeys.length > 0) {
                        const dayVendorId = String((conf as any)[dayKeys[0]].vendorId).trim();
                        if (dayVendorId) vendorIdsToCheck.add(dayVendorId);
                    }
                }
                
                // Now find vendor names for all collected vendor IDs
                const foundVendors: string[] = [];
                vendorIdsToCheck.forEach(vId => {
                    // Try multiple lookup strategies to handle ID format differences
                    const vendor = vendors.find(v => {
                        const vendorIdStr = String(v.id).trim();
                        const checkIdStr = String(vId).trim();
                        return vendorIdStr === checkIdStr || 
                               vendorIdStr.toLowerCase() === checkIdStr.toLowerCase() ||
                               v.id === vId;
                    });
                    if (vendor?.name) {
                        foundVendors.push(vendor.name);
                    }
                });
                
                if (foundVendors.length > 0) {
                    vendorSummary = foundVendors.join(', ');
                } else if (vendorIdsToCheck.size > 0 && vendors.length > 0) {
                    // Debug: We found vendor IDs but couldn't match them
                    if (!loggedMissingVendorIds.current.has(client.id)) {
                        loggedMissingVendorIds.current.add(client.id);
                        console.warn('[ClientList] Found vendor IDs but could not match to vendors:', {
                            clientId: client.id,
                            vendorIdsFound: Array.from(vendorIdsToCheck),
                            vendorsAvailable: vendors.map(v => ({ id: v.id, name: v.name })),
                            activeOrderStructure: {
                                hasVendorId: !!conf.vendorId,
                                vendorId: conf.vendorId,
                                hasBoxTypeId: !!conf.boxTypeId,
                                boxTypeId: conf.boxTypeId,
                                hasBoxOrders: !!(boxesArray && Array.isArray(boxesArray)),
                                boxOrdersLength: boxesArray?.length || 0
                            }
                        });
                    }
                }
            }

            return (
                <div>
                    <strong style={{ fontWeight: 600, color: 'var(--color-primary)' }}>{st}</strong>
                    <span style={{ color: 'var(--text-primary)', marginLeft: '4px' }}>
                        - {vendorSummary}
                    </span>
                </div>
            );
        }

        // Full Details for ClientInfoShelf (forceDetails=true)
        // Group by day of week for both Food and Boxes
        const dayOrderArray = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        let vendorName: string = 'No Vendor';
        let itemsList: { name: string; quantity: number }[] = [];

        if (st === 'Food') {
            const isMultiDay = conf.deliveryDayOrders && typeof conf.deliveryDayOrders === 'object';

            if (isMultiDay) {
                // Group by day of week
                const dayOrderMap = new Map<string, { vendors: Set<string>, items: Map<string, number> }>();

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

                // Sort days
                const sortedDays = Array.from(dayOrderMap.keys()).sort((a, b) => {
                    const aIndex = dayOrderArray.indexOf(a);
                    const bIndex = dayOrderArray.indexOf(b);
                    if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
                    if (aIndex === -1) return 1;
                    if (bIndex === -1) return -1;
                    return aIndex - bIndex;
                });

                return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '4px' }}>
                            {st}
                        </div>
                        {sortedDays.map(day => {
                            const dayData = dayOrderMap.get(day)!;
                            const vendorList = Array.from(dayData.vendors).join(', ') || 'Not Set';
                            const itemsList = Array.from(dayData.items.entries())
                                .map(([itemName, qty]) => ({ name: itemName, quantity: qty }));

                            return (
                                <div key={day} style={{
                                    padding: '12px',
                                    backgroundColor: 'var(--bg-surface)',
                                    borderRadius: '8px',
                                    border: '1px solid var(--border-color)'
                                }}>
                                    <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--color-primary)', marginBottom: '6px' }}>
                                        {day}
                                    </div>
                                    <div style={{ fontSize: '0.85rem', marginBottom: '4px' }}>
                                        <strong>Vendor:</strong> {vendorList}
                                    </div>
                                    {itemsList.length > 0 ? (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '6px' }}>
                                            {itemsList.map((item, idx) => (
                                                <div key={idx} style={{ fontSize: '0.85rem', lineHeight: '1.4', paddingLeft: '8px', borderLeft: '2px solid var(--border-color)' }}>
                                                    <span style={{ fontWeight: 600 }}>{item.quantity}</span> × {item.name}
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <div style={{ fontStyle: 'italic', color: 'var(--text-tertiary)', fontSize: '0.8rem', marginTop: '4px' }}>No items</div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                );
            } else {
                // Legacy single-day format
                const itemsList: { name: string; quantity: number }[] = [];
                let vendorName = '';

                if (conf.vendorSelections) {
                    conf.vendorSelections.forEach(sel => {
                        const vName = vendors.find(v => v.id === sel.vendorId)?.name;
                        if (vName && !vendorName.includes(vName)) {
                            vendorName = vendorName ? `${vendorName}, ${vName}` : vName;
                        }
                        if (sel.items) {
                            Object.entries(sel.items).forEach(([itemId, qty]) => {
                                const q = Number(qty);
                                if (q > 0) {
                                    const item = menuItems.find(i => i.id === itemId);
                                    if (item) {
                                        const existing = itemsList.find(i => i.name === item.name);
                                        if (existing) existing.quantity += q;
                                        else itemsList.push({ name: item.name, quantity: q });
                                    }
                                }
                            });
                        }
                    });
                }

                return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                            {st} - <span style={{ fontWeight: 500 }}>{vendorName || 'Vendor Not Set'}</span>
                        </div>
                        {itemsList.length > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                {itemsList.map((item, idx) => (
                                    <div key={idx} style={{ fontSize: '0.9rem', lineHeight: '1.4' }}>
                                        <span style={{ fontWeight: 600 }}>{item.quantity}</span> * {item.name}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div style={{ fontStyle: 'italic', color: 'var(--text-tertiary)' }}>No items selected</div>
                        )}
                    </div>
                );
            }

        } else if (st === 'Boxes') {
            const confAny = conf as any;
            const isMultiDayBoxes = confAny.deliveryDayOrders && typeof confAny.deliveryDayOrders === 'object';

            if (isMultiDayBoxes) {
                // Group boxes by day of week
                const dayOrderMap = new Map<string, { vendors: Set<string>, boxes: Array<{ boxTypeName: string, items: Map<string, number> }> }>();

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

                    // Also check legacy format for this day
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

                // Sort days
                const sortedDays = Array.from(dayOrderMap.keys()).sort((a, b) => {
                    const aIndex = dayOrderArray.indexOf(a);
                    const bIndex = dayOrderArray.indexOf(b);
                    if (aIndex === -1 && bIndex === -1) return a.localeCompare(b);
                    if (aIndex === -1) return 1;
                    if (bIndex === -1) return -1;
                    return aIndex - bIndex;
                });

                return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <div style={{ fontWeight: 600, fontSize: '0.9rem', marginBottom: '4px' }}>
                            {st}
                        </div>
                        {sortedDays.map(day => {
                            const dayData = dayOrderMap.get(day)!;
                            const vendorList = Array.from(dayData.vendors).join(', ') || 'Not Set';

                            return (
                                <div key={day} style={{
                                    padding: '12px',
                                    backgroundColor: 'var(--bg-surface)',
                                    borderRadius: '8px',
                                    border: '1px solid var(--border-color)'
                                }}>
                                    <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--color-primary)', marginBottom: '6px' }}>
                                        {day}
                                    </div>
                                    <div style={{ fontSize: '0.85rem', marginBottom: '8px' }}>
                                        <strong>Vendor:</strong> {vendorList}
                                    </div>
                                    {dayData.boxes.map((box, idx) => {
                                        const itemsList = Array.from(box.items.entries())
                                            .map(([itemName, qty]) => ({ name: itemName, quantity: qty }));

                                        return (
                                            <div key={idx} style={{
                                                marginTop: idx > 0 ? '8px' : '0',
                                                padding: '8px',
                                                backgroundColor: 'var(--bg-panel)',
                                                borderRadius: '6px'
                                            }}>
                                                <div style={{ fontWeight: 600, fontSize: '0.8rem', marginBottom: '4px' }}>
                                                    {box.boxTypeName}
                                                </div>
                                                {itemsList.length > 0 ? (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '4px' }}>
                                                        {itemsList.map((item, itemIdx) => (
                                                            <div key={itemIdx} style={{ fontSize: '0.8rem', lineHeight: '1.4', paddingLeft: '8px', borderLeft: '2px solid var(--border-color)' }}>
                                                                <span style={{ fontWeight: 600 }}>{item.quantity}</span> × {item.name}
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <div style={{ fontStyle: 'italic', color: 'var(--text-tertiary)', fontSize: '0.75rem', marginTop: '4px' }}>No items</div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            );
                        })}
                    </div>
                );
            } else {
                // Legacy single-day format
            // Boxes Logic
            const boxOrders = (conf as any).boxOrders || [];
            const uniqueVendors = new Set<string>();
            const itemsList: { name: string; quantity: number }[] = [];

            if (boxOrders.length > 0) {
                boxOrders.forEach((box: any) => {
                    const boxDef = boxTypes.find(b => b.id === box.boxTypeId);
                    const vId = box.vendorId || boxDef?.vendorId;
                    if (vId) {
                        const vName = vendors.find(v => v.id === vId)?.name;
                        if (vName) uniqueVendors.add(vName);
                    }

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
                                q = typeof qtyOrObj.quantity === 'number' ? qtyOrObj.quantity : parseInt(String(qtyOrObj.quantity)) || 0;
                            } else {
                                q = parseInt(qtyOrObj as any) || 0;
                            }
                            
                            if (q > 0) {
                                const item = menuItems.find(i => i.id === itemId);
                                if (item) {
                                    const existing = itemsList.find(i => i.name === item.name);
                                    if (existing) existing.quantity += q;
                                    else itemsList.push({ name: item.name, quantity: q });
                                }
                            }
                        });
                    }
                });
                vendorName = Array.from(uniqueVendors).join(', ') || 'No Vendor';

                return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                            {st} - <span style={{ fontWeight: 500 }}>{vendorName || 'Vendor Not Set'}</span>
                        </div>
                        {itemsList.length > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                {itemsList.map((item, idx) => (
                                    <div key={idx} style={{ fontSize: '0.9rem', lineHeight: '1.4' }}>
                                        <span style={{ fontWeight: 600 }}>{item.quantity}</span> * {item.name}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div style={{ fontStyle: 'italic', color: 'var(--text-tertiary)' }}>No items selected</div>
                        )}
                    </div>
                );
            } else {
                // Legacy Fallback
                const itemsList: { name: string; quantity: number }[] = [];
                let computedVendorId = conf.vendorId;
                if (!computedVendorId && !conf.boxTypeId && typeof conf === 'object') {
                    const possibleDayKeys = Object.keys(conf).filter(k => k !== 'id' && k !== 'serviceType' && k !== 'caseId' && typeof (conf as any)[k] === 'object' && (conf as any)[k]?.vendorId);
                    if (possibleDayKeys.length > 0) computedVendorId = (conf as any)[possibleDayKeys[0]].vendorId;
                }
                const box = boxTypes.find(b => b.id === conf.boxTypeId);
                const vId = computedVendorId || box?.vendorId;
                const vendorName = vendors.find(v => v.id === vId)?.name || 'No Vendor';

                if (conf.items) {
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
                    
                    Object.entries(itemsObj).forEach(([itemId, qtyOrObj]: [string, any]) => {
                        // Handle both formats: { itemId: number } or { itemId: { quantity: number, price: number } }
                        let q = 0;
                        if (typeof qtyOrObj === 'number') {
                            q = qtyOrObj;
                        } else if (qtyOrObj && typeof qtyOrObj === 'object' && 'quantity' in qtyOrObj) {
                            q = typeof qtyOrObj.quantity === 'number' ? qtyOrObj.quantity : parseInt(String(qtyOrObj.quantity)) || 0;
                        } else {
                            q = parseInt(String(qtyOrObj)) || 0;
                        }
                        
                        if (q > 0) {
                            const item = menuItems.find(i => i.id === itemId);
                            if (item) itemsList.push({ name: item.name, quantity: q });
                        }
                    });
                }

                return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                            {st} - <span style={{ fontWeight: 500 }}>{vendorName || 'Vendor Not Set'}</span>
                        </div>
                        {itemsList.length > 0 ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                {itemsList.map((item, idx) => (
                                    <div key={idx} style={{ fontSize: '0.9rem', lineHeight: '1.4' }}>
                                        <span style={{ fontWeight: 600 }}>{item.quantity}</span> * {item.name}
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div style={{ fontStyle: 'italic', color: 'var(--text-tertiary)' }}>No items selected</div>
                        )}
                    </div>
                );
            }
            }
        } else if (st === 'Custom') {
            // Custom Order Logic
            const vId = conf.vendorId;
            vendorName = vendors.find(v => v.id === vId)?.name || 'No Vendor';

            const desc = (conf as any).custom_name || 'Custom Item';
            const price = (conf as any).custom_price || 0;

            itemsList = [];
            itemsList.push({
                name: `${desc} ($${Number(price).toFixed(2)})`,
                quantity: 1
            });
        }

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                    {st} - <span style={{ fontWeight: 500 }}>{vendorName || 'Vendor Not Set'}</span>
                </div>
                {itemsList.length > 0 ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        {itemsList.map((item, idx) => (
                            <div key={idx} style={{ fontSize: '0.9rem', lineHeight: '1.4' }}>
                                <span style={{ fontWeight: 600 }}>{item.quantity}</span> * {item.name}
                            </div>
                        ))}
                    </div>
                ) : (
                    <div style={{ fontStyle: 'italic', color: 'var(--text-tertiary)' }}>No items selected</div>
                )}

                {/* 
                   For Meal specific detailed display, we could reuse getMealOrderSummaryJSX logic 
                   but we just aggregated everything above for a cleaner list as requested.
                   "2 * Challah"
                  */}
            </div>
        );
    }

    function getScreeningStatus(client: ClientProfile) {
        const status = client.screeningStatus || 'not_started';

        const statusConfig: Record<string, { label: string; color: string; bgColor: string; icon: ReactElement }> = {
            not_started: {
                label: 'Not Started',
                color: 'var(--text-tertiary)',
                bgColor: 'var(--bg-surface-hover)',
                icon: <Square size={14} />
            },
            waiting_approval: {
                label: 'Pending',
                color: '#48be85',
                bgColor: 'rgba(72, 190, 133, 0.1)',
                icon: <CheckSquare size={14} />
            },
            approved: {
                label: 'Approved',
                color: 'var(--color-success)',
                bgColor: 'rgba(34, 197, 94, 0.1)',
                icon: <CheckSquare size={14} />
            },
            rejected: {
                label: 'Rejected',
                color: 'var(--color-danger)',
                bgColor: 'rgba(239, 68, 68, 0.1)',
                icon: <Square size={14} />
            }
        };

        const config = statusConfig[status] || statusConfig.not_started;

        return (
            <span
                title={`Screening Status: ${config.label}`}
                style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '4px',
                    padding: '4px 8px',
                    borderRadius: 'var(--radius-sm)',
                    fontSize: '0.85rem',
                    fontWeight: 500,
                    color: config.color,
                    backgroundColor: config.bgColor,
                    whiteSpace: 'nowrap'
                }}
            >
                {config.icon}
                {config.label}
            </span>
        );
    }

    function getNeedsAttentionReason(client: ClientProfile): string {
        const reasons: string[] = [];
        const now = new Date();
        const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

        // 1. Check if client with boxes doesn't have vendor assigned
        if (client.serviceType === 'Boxes') {
            if (client.activeOrder && client.activeOrder.serviceType === 'Boxes') {
                const box = boxTypes.find(b => b.id === client.activeOrder?.boxTypeId);
                const vendorId = client.activeOrder.vendorId || box?.vendorId;
                if (!vendorId) {
                    reasons.push('Boxes: No vendor assigned');
                }
            } else {
                reasons.push('Boxes: No vendor assigned');
            }
        }

        // 2. Check if expiration date is within current month
        if (client.expirationDate) {
            const expDate = new Date(client.expirationDate);
            if (expDate >= firstDayOfMonth && expDate <= lastDayOfMonth) {
                reasons.push('Expiration date this month');
            }
        }

        // 3. Check if boxes client has authorized amount < 584 or is null/undefined
        if (client.serviceType === 'Boxes') {
            if (client.authorizedAmount === null || client.authorizedAmount === undefined) {
                reasons.push('Boxes: No authorized amount');
            } else if (client.authorizedAmount < 584) {
                reasons.push(`Boxes: Auth amount $${client.authorizedAmount} < $584`);
            }
        }

        // 4. Check if food client has authorized amount < 1344 or is null/undefined
        if (client.serviceType === 'Food') {
            if (client.authorizedAmount === null || client.authorizedAmount === undefined) {
                reasons.push('Food: No authorized amount');
            } else if (client.authorizedAmount < 1344) {
                reasons.push(`Food: Auth amount $${client.authorizedAmount} < $1344`);
            }
        }

        return reasons.length > 0 ? reasons.join(', ') : 'No reason specified';
    }

    // Helper function to check if a date is in the current week
    function isInCurrentWeek(dateString: string): boolean {
        if (!dateString) return false;

        const date = new Date(dateString);
        const today = new Date();

        // Get the start of the week (Sunday)
        const startOfWeek = new Date(today);
        const day = startOfWeek.getDay();
        startOfWeek.setDate(today.getDate() - day);
        startOfWeek.setHours(0, 0, 0, 0);

        // Get the end of the week (Saturday)
        const endOfWeek = new Date(startOfWeek);
        endOfWeek.setDate(startOfWeek.getDate() + 6);
        endOfWeek.setHours(23, 59, 59, 999);

        return date >= startOfWeek && date <= endOfWeek;
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
                        <>
                            <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                                Total: {totalRegularClients} clients
                            </span>
                            <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                                ({clients.length} / {totalClients} loaded)
                            </span>
                        </>
                    )}
                    {isRefreshing && (
                        <div className={styles.refreshIndicator}>
                            <Loader2 size={14} className="animate-spin" />
                            <span>Refreshing...</span>
                        </div>
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
                            className={`${styles.viewBtn} ${currentView === 'needs-attention' ? styles.viewBtnActive : ''}`}
                            onClick={() => setCurrentView('needs-attention')}
                        >
                            Needs Attention
                        </button>
                        <button
                            className={`${styles.viewBtn} ${currentView === 'billing' ? styles.viewBtnActive : ''}`}
                            onClick={() => router.push('/billing')}
                        >
                            Billing
                        </button>
                        <button
                            className={styles.viewBtn}
                            onClick={() => router.push('/orders')}
                        >
                            Orders
                        </button>
                    </div>

                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button className="btn btn-primary" onClick={handleCreate}>
                            <Plus size={16} /> New Client
                        </button>
                        <button className="btn btn-secondary" onClick={() => setIsAddingDependent(true)}>
                            <Plus size={16} /> Add Dependent
                        </button>
                    </div>
                </div>
            </div>

            <div className={styles.filters}>
                <button
                    className={`btn ${showDependents ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setShowDependents(!showDependents)}
                    style={{ fontSize: '0.9rem' }}
                >
                    {showDependents ? <Eye size={16} /> : <EyeOff size={16} />} {showDependents ? 'Hide' : 'Show'} Dependents
                </button>
                <div className={styles.searchBox}>
                    <Search size={18} className={styles.searchIcon} />
                    <input
                        className="input"
                        placeholder="Search clients..."
                        style={{ paddingLeft: '2.5rem', paddingRight: search ? '2rem' : '0.75rem', width: '300px' }}
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                    {search && (
                        <button
                            className={styles.clearButton}
                            onClick={() => setSearch('')}
                            aria-label="Clear search"
                        >
                            <X size={16} />
                        </button>
                    )}
                </div>



                {/* Clear All Filters Button */}
                {(statusFilter || navigatorFilter || screeningFilter || serviceTypeFilter || needsVendorFilter) && (
                    <button
                        className="btn btn-secondary"
                        onClick={() => {
                            setStatusFilter(null);
                            setNavigatorFilter(null);
                            setScreeningFilter(null);
                            setServiceTypeFilter(null);
                            setNeedsVendorFilter(false);
                        }}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.9rem' }}
                    >
                        Clear All Filters
                    </button>
                )}
            </div>


            {isAddingDependent && (
                <div className={styles.createModal}>
                    <div className={styles.createCard} style={{ width: '500px' }}>
                        <h3>{editingDependentId ? 'Edit Dependent' : 'Add Dependent'}</h3>
                        <div className={styles.formGroup}>
                            <label className="label">Dependent Name</label>
                            <input
                                className="input"
                                placeholder="Full Name"
                                value={dependentName}
                                onChange={e => setDependentName(e.target.value)}
                                autoFocus
                            />
                        </div>
                        <div className={styles.formGroup}>
                            <label className="label">Date of Birth</label>
                            <input
                                type="date"
                                className="input"
                                value={dependentDob}
                                onChange={e => setDependentDob(e.target.value)}
                            />
                        </div>
                        <div className={styles.formGroup}>
                            <label className="label">CIN#</label>
                            <input
                                type="number"
                                className="input"
                                placeholder="CIN Number"
                                value={dependentCin}
                                onChange={e => setDependentCin(e.target.value)}
                            />
                        </div>
                        <div className={styles.formGroup}>
                            <label className="label">Parent Client</label>
                            <div style={{ position: 'relative' }}>
                                <input
                                    className="input"
                                    placeholder="Search for client..."
                                    value={parentClientSearch}
                                    onChange={e => setParentClientSearch(e.target.value)}
                                    style={{ marginBottom: '0.5rem' }}
                                />
                                <div style={{
                                    maxHeight: '300px',
                                    overflowY: 'auto',
                                    overflowX: 'hidden',
                                    border: '1px solid var(--border-color)',
                                    borderRadius: 'var(--radius-md)',
                                    backgroundColor: 'var(--bg-surface)'
                                }}>
                                    {filteredRegularClients.length === 0 ? (
                                        <div style={{ padding: '0.75rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
                                            No clients found
                                        </div>
                                    ) : (
                                        filteredRegularClients.map(client => (
                                            <div
                                                key={client.id}
                                                onClick={() => {
                                                    setSelectedParentClientId(client.id);
                                                    setParentClientSearch(client.fullName);
                                                }}
                                                style={{
                                                    padding: '0.75rem',
                                                    cursor: 'pointer',
                                                    backgroundColor: selectedParentClientId === client.id ? 'var(--bg-surface-hover)' : 'transparent',
                                                    borderBottom: '1px solid var(--border-color)',
                                                    transition: 'background-color 0.2s'
                                                }}
                                                onMouseEnter={(e) => {
                                                    if (selectedParentClientId !== client.id) {
                                                        e.currentTarget.style.backgroundColor = 'var(--bg-surface-hover)';
                                                    }
                                                }}
                                                onMouseLeave={(e) => {
                                                    if (selectedParentClientId !== client.id) {
                                                        e.currentTarget.style.backgroundColor = 'transparent';
                                                    }
                                                }}
                                            >
                                                {client.fullName}
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className={styles.modalActions}>
                            <button
                                className="btn btn-primary"
                                onClick={handleAddDependent}
                                disabled={!dependentName.trim() || !selectedParentClientId}
                            >
                                {editingDependentId ? 'Save Changes' : 'Create Dependent'}
                            </button>
                            <button className="btn btn-secondary" onClick={() => {
                                setIsAddingDependent(false);
                                setDependentName('');
                                setDependentDob('');
                                setDependentCin('');
                                setSelectedParentClientId('');
                                setParentClientSearch('');
                                setEditingDependentId(null);
                            }}>Cancel</button>
                        </div>
                    </div>
                    <div className={styles.overlay} onClick={() => {
                        setIsAddingDependent(false);
                        setDependentName('');
                        setDependentDob('');
                        setDependentCin('');
                        setSelectedParentClientId('');
                        setParentClientSearch('');
                        setEditingDependentId(null);
                    }}></div>
                </div>
            )}

            <div className={styles.list}>
                <div className={styles.listHeader}>
                    <span style={{ minWidth: '60px', flex: 0.3, paddingRight: '16px', display: 'flex', alignItems: 'center' }}>
                        #
                    </span>
                    <span style={{ minWidth: '200px', flex: 2, paddingRight: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                        onClick={() => handleSort('name')}>
                        Name {getSortIcon('name')}
                    </span>

                    {/* SIGN column */}
                    <span style={{ minWidth: '100px', flex: 0.8, paddingRight: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                        onClick={() => handleSort('signatures')}>
                        SIGN {getSortIcon('signatures')}
                    </span>

                    {/* Status column with filter */}
                    <span style={{ minWidth: '140px', flex: 1, paddingRight: '16px', display: 'flex', alignItems: 'center', gap: '4px', position: 'relative' }} data-filter-dropdown>
                        <span style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }} onClick={() => handleSort('status')}>
                            Status {getSortIcon('status')}
                        </span>
                        <Filter
                            size={14}
                            style={{ cursor: 'pointer', opacity: statusFilter ? 1 : 0.5, color: statusFilter ? 'var(--color-primary)' : 'inherit', filter: statusFilter ? 'drop-shadow(0 0 3px var(--color-primary))' : 'none' }}
                            onClick={(e) => { e.stopPropagation(); setOpenFilterMenu(openFilterMenu === 'status' ? null : 'status'); }}
                        />
                        {openFilterMenu === 'status' && (
                            <div style={{
                                position: 'absolute', top: '100%', left: 0, marginTop: '4px',
                                backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)',
                                borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)',
                                zIndex: 1000, minWidth: '200px', maxHeight: '300px', overflowY: 'auto'
                            }}>
                                <div onClick={() => { setStatusFilter(null); setOpenFilterMenu(null); }}
                                    style={{
                                        padding: '8px 12px', cursor: 'pointer',
                                        backgroundColor: !statusFilter ? 'var(--bg-surface-hover)' : 'transparent',
                                        fontWeight: !statusFilter ? 600 : 400
                                    }}>
                                    All Statuses
                                </div>
                                {statuses.map(status => (
                                    <div key={status.id}
                                        onClick={() => { setStatusFilter(status.id); setOpenFilterMenu(null); }}
                                        style={{
                                            padding: '8px 12px', cursor: 'pointer',
                                            backgroundColor: statusFilter === status.id ? 'var(--bg-surface-hover)' : 'transparent',
                                            fontWeight: statusFilter === status.id ? 600 : 400
                                        }}>
                                        {status.name}
                                    </div>
                                ))}
                            </div>
                        )}
                    </span>

                    {currentView !== 'needs-attention' && (
                        <>
                            {/* Navigator column with filter */}
                            <span style={{ minWidth: '160px', flex: 1, paddingRight: '16px', display: 'flex', alignItems: 'center', gap: '4px', position: 'relative' }} data-filter-dropdown>
                                <span style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }} onClick={() => handleSort('navigator')}>
                                    Navigator {getSortIcon('navigator')}
                                </span>
                                <Filter
                                    size={14}
                                    style={{ cursor: 'pointer', opacity: navigatorFilter ? 1 : 0.5, color: navigatorFilter ? 'var(--color-primary)' : 'inherit', filter: navigatorFilter ? 'drop-shadow(0 0 3px var(--color-primary))' : 'none' }}
                                    onClick={(e) => { e.stopPropagation(); setOpenFilterMenu(openFilterMenu === 'navigator' ? null : 'navigator'); }}
                                />
                                {openFilterMenu === 'navigator' && (
                                    <div style={{
                                        position: 'absolute', top: '100%', left: 0, marginTop: '4px',
                                        backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)',
                                        borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)',
                                        zIndex: 1000, minWidth: '200px', maxHeight: '300px', overflowY: 'auto'
                                    }}>
                                        <div onClick={() => { setNavigatorFilter(null); setOpenFilterMenu(null); }}
                                            style={{
                                                padding: '8px 12px', cursor: 'pointer',
                                                backgroundColor: !navigatorFilter ? 'var(--bg-surface-hover)' : 'transparent',
                                                fontWeight: !navigatorFilter ? 600 : 400
                                            }}>
                                            All Navigators
                                        </div>
                                        {navigators.map(navigator => (
                                            <div key={navigator.id}
                                                onClick={() => { setNavigatorFilter(navigator.id); setOpenFilterMenu(null); }}
                                                style={{
                                                    padding: '8px 12px', cursor: 'pointer',
                                                    backgroundColor: navigatorFilter === navigator.id ? 'var(--bg-surface-hover)' : 'transparent',
                                                    fontWeight: navigatorFilter === navigator.id ? 600 : 400
                                                }}>
                                                {navigator.name}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </span>

                            {/* Screening column with filter */}
                            <span style={{ minWidth: '140px', flex: 1, paddingRight: '16px', display: 'flex', alignItems: 'center', gap: '4px', position: 'relative' }} data-filter-dropdown>
                                <span style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }} onClick={() => handleSort('screening')}>
                                    Screening {getSortIcon('screening')}
                                </span>
                                <Filter
                                    size={14}
                                    style={{ cursor: 'pointer', opacity: screeningFilter ? 1 : 0.5, color: screeningFilter ? 'var(--color-primary)' : 'inherit', filter: screeningFilter ? 'drop-shadow(0 0 3px var(--color-primary))' : 'none' }}
                                    onClick={(e) => { e.stopPropagation(); setOpenFilterMenu(openFilterMenu === 'screening' ? null : 'screening'); }}
                                />
                                {openFilterMenu === 'screening' && (
                                    <div style={{
                                        position: 'absolute', top: '100%', left: 0, marginTop: '4px',
                                        backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)',
                                        borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)',
                                        zIndex: 1000, minWidth: '200px'
                                    }}>
                                        <div onClick={() => { setScreeningFilter(null); setOpenFilterMenu(null); }}
                                            style={{
                                                padding: '8px 12px', cursor: 'pointer',
                                                backgroundColor: !screeningFilter ? 'var(--bg-surface-hover)' : 'transparent',
                                                fontWeight: !screeningFilter ? 600 : 400
                                            }}>
                                            All Statuses
                                        </div>
                                        {['not_started', 'waiting_approval', 'approved', 'rejected'].map(status => (
                                            <div key={status}
                                                onClick={() => { setScreeningFilter(status); setOpenFilterMenu(null); }}
                                                style={{
                                                    padding: '8px 12px', cursor: 'pointer',
                                                    backgroundColor: screeningFilter === status ? 'var(--bg-surface-hover)' : 'transparent',
                                                    fontWeight: screeningFilter === status ? 600 : 400
                                                }}>
                                                {getScreeningStatusLabel(status)}
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </span>

                            {/* Active Order column with filter */}
                            <span style={{ minWidth: '350px', flex: 3, paddingRight: '16px', display: 'flex', alignItems: 'center', gap: '8px', position: 'relative' }} data-filter-dropdown>
                                Active Order
                                <span
                                    onClick={(e) => { e.stopPropagation(); setShowOrderDetails(!showOrderDetails); }}
                                    style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', color: 'var(--text-secondary)' }}
                                    title={showOrderDetails ? "Hide Details" : "Show Details"}
                                >
                                    {showOrderDetails ? <EyeOff size={14} /> : <Eye size={14} />}
                                </span>
                                <Filter
                                    size={14}
                                    style={{ cursor: 'pointer', opacity: (serviceTypeFilter || needsVendorFilter) ? 1 : 0.5, color: (serviceTypeFilter || needsVendorFilter) ? 'var(--color-primary)' : 'inherit', filter: (serviceTypeFilter || needsVendorFilter) ? 'drop-shadow(0 0 3px var(--color-primary))' : 'none' }}
                                    onClick={(e) => { e.stopPropagation(); setOpenFilterMenu(openFilterMenu === 'serviceType' ? null : 'serviceType'); }}
                                />
                                {openFilterMenu === 'serviceType' && (
                                    <div style={{
                                        position: 'absolute', top: '100%', left: 0, marginTop: '4px',
                                        backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)',
                                        borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)',
                                        zIndex: 1000, minWidth: '200px'
                                    }}>
                                        <div onClick={() => { setServiceTypeFilter(null); setNeedsVendorFilter(false); setOpenFilterMenu(null); }}
                                            style={{
                                                padding: '8px 12px', cursor: 'pointer',
                                                backgroundColor: !serviceTypeFilter ? 'var(--bg-surface-hover)' : 'transparent',
                                                fontWeight: !serviceTypeFilter ? 600 : 400
                                            }}>
                                            All Types
                                        </div>
                                        <div onClick={() => { setServiceTypeFilter('Food'); setOpenFilterMenu(null); }}
                                            style={{
                                                padding: '8px 12px', cursor: 'pointer',
                                                backgroundColor: serviceTypeFilter === 'Food' ? 'var(--bg-surface-hover)' : 'transparent',
                                                fontWeight: serviceTypeFilter === 'Food' ? 600 : 400
                                            }}>
                                            Food
                                        </div>
                                        <div onClick={() => { setServiceTypeFilter('Boxes'); setOpenFilterMenu(null); }}
                                            style={{
                                                padding: '8px 12px', cursor: 'pointer',
                                                backgroundColor: serviceTypeFilter === 'Boxes' ? 'var(--bg-surface-hover)' : 'transparent',
                                                fontWeight: serviceTypeFilter === 'Boxes' ? 600 : 400
                                            }}>
                                            Boxes
                                        </div>
                                        <div style={{ height: '1px', backgroundColor: 'var(--border-color)', margin: '4px 0' }}></div>
                                        <div onClick={() => { setNeedsVendorFilter(!needsVendorFilter); setOpenFilterMenu(null); }}
                                            style={{
                                                padding: '8px 12px', cursor: 'pointer',
                                                backgroundColor: needsVendorFilter ? 'var(--bg-surface-hover)' : 'transparent',
                                                fontWeight: needsVendorFilter ? 600 : 400,
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '8px'
                                            }}>
                                            <AlertCircle size={14} />
                                            Needs Vendor Assignment
                                        </div>
                                    </div>
                                )}
                            </span>
                        </>
                    )}

                    {currentView === 'needs-attention' ? (
                        <>
                            <span style={{ minWidth: '400px', flex: 4, paddingRight: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                Reason
                            </span>
                            <span style={{ minWidth: '150px', flex: 1.2, paddingRight: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                                onClick={() => handleSort('authorizedAmount')}>
                                Authorized Amount {getSortIcon('authorizedAmount')}
                            </span>
                            <span style={{ minWidth: '150px', flex: 1.2, paddingRight: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                                onClick={() => handleSort('expirationDate')}>
                                Expiration Date {getSortIcon('expirationDate')}
                            </span>
                        </>
                    ) : (
                        <>
                            <span style={{ minWidth: '180px', flex: 1.2, paddingRight: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                                onClick={() => handleSort('email')}>
                                Email {getSortIcon('email')}
                            </span>
                            <span style={{ minWidth: '140px', flex: 1, paddingRight: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                                onClick={() => handleSort('phone')}>
                                Phone {getSortIcon('phone')}
                            </span>
                            <span style={{ minWidth: '140px', flex: 1, paddingRight: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                                onClick={() => handleSort('secondaryPhone')}>
                                Secondary Phone {getSortIcon('secondaryPhone')}
                            </span>
                            <span style={{ minWidth: '250px', flex: 2, paddingRight: '16px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                                onClick={() => handleSort('address')}>
                                Address {getSortIcon('address')}
                            </span>
                            <span style={{ minWidth: '200px', flex: 2, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                                onClick={() => handleSort('notes')}>
                                Notes {getSortIcon('notes')}
                            </span>
                        </>
                    )}
                    <span style={{ width: '40px' }}></span>
                </div>
                {filteredClients.map((client, index) => {
                    const status = statuses.find(s => s.id === client.statusId);
                    const isNotAllowed = status ? status.deliveriesAllowed === false : false;
                    const isDependent = !!client.parentClientId;

                    return (
                        <div
                            key={client.id}
                            onClick={() => {
                                if (isDependent) {
                                    setEditingDependentId(client.id);
                                    setDependentName(client.fullName);
                                    setDependentDob(client.dob || '');
                                    setDependentCin(client.cin?.toString() || '');
                                    setSelectedParentClientId(client.parentClientId || '');
                                    const parentClient = allClientsForLookup.find(c => c.id === client.parentClientId);
                                    if (parentClient) {
                                        setParentClientSearch(parentClient.fullName);
                                    }
                                    setIsAddingDependent(true);
                                } else {
                                    // Open the info shelf instead of the full profile directly
                                    setInfoShelfClientId(client.id);
                                    // Prefetch client details if not already cached
                                    if (!detailsCache[client.id]) {
                                        prefetchClient(client.id);
                                    }
                                }
                            }}
                            className={`${styles.clientRow} ${isDependent ? styles.clientRowDependent : ''}`}
                            style={{ cursor: 'pointer' }}
                        >
                            <span style={{ minWidth: '60px', flex: 0.3, paddingRight: '16px', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                                {index + 1}
                            </span>
                            <span title={client.fullName} style={{ minWidth: '200px', flex: 2, fontWeight: 600, paddingRight: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                {isNotAllowed && <span className={styles.redTab}></span>}
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{client.fullName}</span>
                            </span>
                            <span style={{ minWidth: '100px', flex: 0.8, paddingRight: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                {isDependent ? '-' : <SignCell client={client} />}
                            </span>
                            <span title={client.parentClientId ? `Parent: ${getParentClientName(client)}` : getStatusName(client.statusId)} style={{ minWidth: '140px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}>
                                {client.parentClientId ? (
                                    <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                                        Parent: {getParentClientName(client)}
                                    </span>
                                ) : (
                                    <span className={`badge ${getStatusName(client.statusId) === 'Active' ? 'badge-success' : ''}`}>
                                        {getStatusName(client.statusId)}
                                    </span>
                                )}
                            </span>
                            {currentView !== 'needs-attention' && (
                                <>
                                    <span title={isDependent ? '' : getNavigatorName(client.navigatorId)} style={{ minWidth: '160px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}>{isDependent ? '-' : getNavigatorName(client.navigatorId)}</span>
                                    <span style={{ minWidth: '140px', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}>{isDependent ? '-' : getScreeningStatus(client)}</span>
                                    <span style={{ minWidth: '350px', flex: 3, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}>
                                        {isDependent ? '-' : getOrderSummary(client)}
                                    </span>
                                </>
                            )}
                            {currentView === 'needs-attention' ? (
                                <>
                                    <span title={getNeedsAttentionReason(client)} style={{ minWidth: '400px', flex: 4, fontSize: '0.85rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}>
                                        {getNeedsAttentionReason(client)}
                                    </span>
                                    <span style={{ minWidth: '150px', flex: 1.2, fontSize: '0.85rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}>
                                        {client.authorizedAmount !== null && client.authorizedAmount !== undefined
                                            ? `$${client.authorizedAmount.toFixed(2)}`
                                            : '-'}
                                    </span>
                                    <span style={{ minWidth: '150px', flex: 1.2, fontSize: '0.85rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}>
                                        {client.expirationDate
                                            ? new Date(client.expirationDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
                                            : '-'}
                                    </span>
                                </>
                            ) : (
                                <>
                                    <span title={isDependent ? undefined : (client.email || undefined)} style={{ minWidth: '180px', flex: 1.2, fontSize: '0.85rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}>
                                        {isDependent ? '-' : (client.email || '-')}
                                    </span>
                                    <span title={isDependent ? undefined : client.phoneNumber} style={{ minWidth: '140px', flex: 1, fontSize: '0.85rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}>
                                        {isDependent ? '-' : (client.phoneNumber || '-')}
                                    </span>
                                    <span title={isDependent ? undefined : (client.secondaryPhoneNumber || undefined)} style={{ minWidth: '140px', flex: 1, fontSize: '0.85rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}>
                                        {isDependent ? '-' : (client.secondaryPhoneNumber || '-')}
                                    </span>
                                    <span title={isDependent ? undefined : client.address} style={{ minWidth: '250px', flex: 2, fontSize: '0.85rem', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}>
                                        {isDependent ? '-' : (client.address || '-')}
                                    </span>
                                    <span title={isDependent ? undefined : client.notes} style={{ minWidth: '200px', flex: 2, fontSize: '0.85rem', color: 'var(--text-tertiary)', fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: '16px' }}>
                                        {isDependent ? '-' : (client.notes || '-')}
                                    </span>
                                </>
                            )}
                            <span style={{ width: '40px' }}><ChevronRight size={16} /></span>
                        </div>
                    );
                })}
                {filteredClients.length === 0 && !isLoading && (
                    <div className={styles.empty}>
                        {needsVendorFilter ? 'No clients with box orders needing vendor assignment.' :
                            currentView === 'ineligible' ? 'No ineligible clients found.' :
                                currentView === 'eligible' ? 'No eligible clients found.' :
                                    currentView === 'needs-attention' ? 'No clients need attention.' :
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
                            statuses={statuses}
                            navigators={navigators}
                            vendors={vendors}
                            menuItems={menuItems}
                            boxTypes={boxTypes}
                            currentUser={currentUser}
                            onClose={() => {
                                const closedClientId = selectedClientId;
                                setSelectedClientId(null);
                                // Clear the cache for this client
                                setDetailsCache(prev => {
                                    const next = { ...prev };
                                    delete next[closedClientId];
                                    return next;
                                });
                                // Trigger background refresh to update the list with any changes
                                refreshDataInBackground();
                            }}
                        />
                    </div>
                    <div className={styles.overlay} onClick={() => {
                        const closedClientId = selectedClientId;
                        setSelectedClientId(null);
                        // Clear the cache for this client
                        setDetailsCache(prev => {
                            const next = { ...prev };
                            delete next[closedClientId];
                            return next;
                        });
                        // Trigger background refresh to update the list with any changes
                        refreshDataInBackground();
                    }}></div>
                </div>
            )}

            {infoShelfClientId && clients.find(c => c.id === infoShelfClientId) && (
                <ClientInfoShelf
                    client={detailsCache[infoShelfClientId]?.client || clients.find(c => c.id === infoShelfClientId)!}
                    statuses={statuses}
                    navigators={navigators}
                    orderSummary={getOrderSummary(detailsCache[infoShelfClientId]?.client || clients.find(c => c.id === infoShelfClientId)!, true)}
                    submissions={detailsCache[infoShelfClientId]?.submissions || []}
                    allClients={allClientsForLookup}
                    onClose={() => setInfoShelfClientId(null)}
                    onOpenProfile={(clientId) => {
                        setInfoShelfClientId(null);
                        setSelectedClientId(clientId);
                    }}
                    onClientUpdated={() => {
                        // Clear cache for this client to force re-fetch
                        const updatedClientId = infoShelfClientId;
                        if (updatedClientId) {
                            setDetailsCache(prev => {
                                const newCache = { ...prev };
                                delete newCache[updatedClientId];
                                return newCache;
                            });
                        }
                        refreshDataInBackground();
                    }}
                    onClientDeleted={() => {
                        setInfoShelfClientId(null);
                        refreshDataInBackground();
                    }}
                />
            )}
        </div>
    );
}



