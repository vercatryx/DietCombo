'use client';

import { ClientProfileDetail, type ClientProfileDetailHandle } from './ClientProfile';
import { ClientInfoShelf } from './ClientInfoShelf';
import { DependantInfoShelf } from './DependantInfoShelf';

import { useState, useEffect, useRef, useMemo, ReactElement, type CSSProperties, type ReactNode } from 'react';
import { ClientProfile, ClientStatus, Navigator, Vendor, BoxType, ClientFullDetails, MenuItem, AppSettings, ItemCategory, ServiceType, ProduceVendor } from '@/lib/types';
import {
    getClientsPaginated,
    getClientFullDetails,
    getStatuses,
    getNavigators,
    addClient,
    addDependent,
    getRegularClients,
    getClients,
    getVendors,
    getBoxTypes,
    getMenuItems,
    getClientNamesByIds,
    updateClient,
    getUpcomingOrderForClient as serverGetUpcomingOrderForClient,
    getCompletedOrdersWithDeliveryProof as serverGetCompletedOrdersWithDeliveryProof,
    getBatchClientDetails,
    getSettings,
    getCategories
} from '@/lib/actions';
import { invalidateClientData, getProduceVendors as getCachedProduceVendors } from '@/lib/cached-data';
import { hasNonDefaultFlags, getNonDefaultFlagLabels, clientMatchesFlagFilter, FLAGS_FILTER_OPTIONS, type FlagsFilterValue } from '@/lib/client-flags';
import { Plus, Search, ChevronRight, CheckSquare, Square, StickyNote, Package, ArrowUpDown, ArrowUp, ArrowDown, Filter, Eye, EyeOff, Loader2, AlertCircle, X, PenTool, Copy, Check, ExternalLink, Flag, Download, Table2 } from 'lucide-react';
import * as XLSX from 'xlsx';
import styles from './ClientList.module.css';
import {
    clientListColumnLayoutStorageKey,
    clientListDefaultColumnWidths,
    type ClientListColumnLayoutView,
} from './clientListColumnWidths';
import { useRouter, useSearchParams } from 'next/navigation';

interface ClientListProps {
    currentUser?: { role: string; id: string } | null;
}

type ExpandedBoolFilter = '' | 'yes' | 'no';

const EMPTY_EXPANDED_COLUMN_FILTERS = {
    dob: '',
    created: '',
    apt: '',
    city: '',
    state: '',
    zip: '',
    county: '',
    uniteCase: '',
    uniteAccount: '',
    voucher: '',
    history: '',
    authorized: '',
    expiration: '',
    paused: '' as ExpandedBoolFilter,
    complex: '' as ExpandedBoolFilter,
    bill: '' as ExpandedBoolFilter,
    delivery: '' as ExpandedBoolFilter,
    doNotText: '' as ExpandedBoolFilter,
};

type ExpandedColumnFilters = typeof EMPTY_EXPANDED_COLUMN_FILTERS;

type ExpandedTextFilterKey =
    | 'dob' | 'created' | 'apt' | 'city' | 'state' | 'zip' | 'county'
    | 'uniteCase' | 'uniteAccount' | 'voucher' | 'history' | 'authorized' | 'expiration';

export function ClientList({ currentUser }: ClientListProps = {}) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [clients, setClients] = useState<ClientProfile[]>([]);
    const [statuses, setStatuses] = useState<ClientStatus[]>([]);
    const [navigators, setNavigators] = useState<Navigator[]>([]);
    const [vendors, setVendors] = useState<Vendor[]>([]);
    const [boxTypes, setBoxTypes] = useState<BoxType[]>([]);
    const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
    const [parentNamesMap, setParentNamesMap] = useState<Record<string, string>>({});
    const [search, setSearch] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);

    // Pagination State
    const [page, setPage] = useState(1);
    const [totalClients, setTotalClients] = useState(0);
    const [isFetchingMore, setIsFetchingMore] = useState(false);
    const CLIENT_FETCH_LIMIT = 2000; // Single request loads all clients (avoids many round-trips)

    // Prefetching State
    const [detailsCache, setDetailsCache] = useState<Record<string, ClientFullDetails>>({});
    const pendingPrefetches = useRef<Set<string>>(new Set());

    // Track which clients have already logged missing vendor ID warnings (to avoid spam)
    const loggedMissingVendorIds = useRef<Set<string>>(new Set());

    // Views
    const [currentView, setCurrentView] = useState<'all' | 'brooklyn' | 'eligible' | 'ineligible' | 'billing' | 'needs-attention'>(
        currentUser?.role === 'brooklyn_admin' ? 'brooklyn' : 'all'
    );

    // Sorting State
    const [sortColumn, setSortColumn] = useState<string | null>(null);
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

    // Filtering State
    const [statusFilter, setStatusFilter] = useState<string | null>(null);
    const [navigatorFilter, setNavigatorFilter] = useState<string | null>(null);
    const [screeningFilter, setScreeningFilter] = useState<string | null>(null);
    const [serviceTypeFilter, setServiceTypeFilter] = useState<string | null>(null);
    const [needsVendorFilter, setNeedsVendorFilter] = useState<boolean>(false);
    const [flagsFilter, setFlagsFilter] = useState<FlagsFilterValue>('all');
    const [openFilterMenu, setOpenFilterMenu] = useState<string | null>(null);

    // Preloaded for profile dialog (avoids loadAuxiliaryData round-trip when opening profile)
    const [allClientsForProfile, setAllClientsForProfile] = useState<ClientProfile[]>([]);
    const [settingsForProfile, setSettingsForProfile] = useState<AppSettings | null>(null);
    const [categoriesForProfile, setCategoriesForProfile] = useState<ItemCategory[]>([]);
    const [produceVendors, setProduceVendors] = useState<ProduceVendor[]>([]);

    // Add Dependent Modal state
    const [isAddingDependent, setIsAddingDependent] = useState(false);
    const [dependentName, setDependentName] = useState('');
    const [dependentDob, setDependentDob] = useState('');
    const [dependentCin, setDependentCin] = useState('');
    const [dependentServiceType, setDependentServiceType] = useState<'Food' | 'Produce'>('Food');
    const [selectedParentClientId, setSelectedParentClientId] = useState<string>('');
    const [regularClients, setRegularClients] = useState<ClientProfile[]>([]);
    const [parentClientSearch, setParentClientSearch] = useState('');
    const [editingDependentId, setEditingDependentId] = useState<string | null>(null);

    // Show/Hide Dependents Toggle
    const [showDependents, setShowDependents] = useState(false);

    // Selected Client for Modal
    const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
    const [profileServiceConfigOnly, setProfileServiceConfigOnly] = useState(false);
    const profileDetailRef = useRef<ClientProfileDetailHandle>(null);

    // Info Shelf State (primary client sidebar)
    const [infoShelfClientId, setInfoShelfClientId] = useState<string | null>(null);
    // Dependant sidebar (different UI: address, notes, order details only)
    const [infoShelfDependantId, setInfoShelfDependantId] = useState<string | null>(null);

    // Order Details Visibility Toggle
    const [showOrderDetails, setShowOrderDetails] = useState(false);

    /** Extra columns mirroring ClientInfoShelf fields (not geocoding / change log). */
    const [showExpandedTable, setShowExpandedTable] = useState(false);
    const [expandedColumnFilters, setExpandedColumnFilters] = useState<ExpandedColumnFilters>(() => ({ ...EMPTY_EXPANDED_COLUMN_FILTERS }));

    useEffect(() => {
        if (!showExpandedTable) {
            setExpandedColumnFilters({ ...EMPTY_EXPANDED_COLUMN_FILTERS });
        }
    }, [showExpandedTable]);

    const columnDefaults = useMemo(
        () => clientListDefaultColumnWidths(currentView as ClientListColumnLayoutView, showExpandedTable),
        [currentView, showExpandedTable],
    );
    const columnStorageKey = useMemo(
        () => clientListColumnLayoutStorageKey(currentView as ClientListColumnLayoutView, showExpandedTable),
        [currentView, showExpandedTable],
    );

    const [colWidths, setColWidths] = useState<number[]>(columnDefaults);
    const colWidthsRef = useRef(colWidths);
    /** Header row only — during column drag we update this via DOM so body rows don’t re-render every mousemove. */
    const listHeaderRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        colWidthsRef.current = colWidths;
    }, [colWidths]);

    useEffect(() => {
        try {
            const raw = localStorage.getItem(columnStorageKey);
            if (raw) {
                const parsed = JSON.parse(raw) as number[];
                if (Array.isArray(parsed) && parsed.length === columnDefaults.length) {
                    setColWidths(parsed.map((w, i) => Math.max(48, Number(w) || columnDefaults[i])));
                    return;
                }
            }
        } catch {
            /* ignore */
        }
        setColWidths(columnDefaults);
    }, [columnStorageKey, columnDefaults]);

    const expandColumnStartIndex = useMemo(
        () => 7 + (currentView === 'needs-attention' ? 3 : 7),
        [currentView],
    );

    function beginColumnResize(columnIndex: number, clientX: number) {
        const startX = clientX;
        const startWidths = [...colWidthsRef.current];
        let rafId = 0;

        function applyHeaderPreview(widths: number[]) {
            const el = listHeaderRef.current;
            if (!el) return;
            const tpl = widths.map((w) => `${Math.max(48, w)}px`).join(' ');
            el.style.gridTemplateColumns = tpl;
            el.style.minWidth = `${widths.reduce((a, b) => a + Math.max(48, b), 0)}px`;
        }

        function onMove(ev: MouseEvent) {
            const nw = Math.max(48, startWidths[columnIndex] + (ev.clientX - startX));
            const draft = [...startWidths];
            draft[columnIndex] = nw;
            cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(() => {
                applyHeaderPreview(draft);
            });
        }

        function onUp(ev: MouseEvent) {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            cancelAnimationFrame(rafId);

            const nw = Math.max(48, startWidths[columnIndex] + (ev.clientX - startX));
            const finalWidths = [...startWidths];
            finalWidths[columnIndex] = nw;

            const hdr = listHeaderRef.current;
            if (hdr) {
                hdr.style.removeProperty('grid-template-columns');
                hdr.style.removeProperty('min-width');
            }

            document.body.style.cursor = '';
            document.body.style.userSelect = '';

            colWidthsRef.current = finalWidths;
            setColWidths(finalWidths);
            try {
                localStorage.setItem(columnStorageKey, JSON.stringify(finalWidths));
            } catch {
                /* ignore */
            }
        }

        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    }

    const gridTemplateColumns = useMemo(
        () => colWidths.map((w) => `${Math.max(48, w)}px`).join(' '),
        [colWidths],
    );

    const gridRowStyle: CSSProperties = useMemo(
        () => ({
            display: 'grid',
            gridTemplateColumns,
            gap: 0,
            alignItems: 'center',
            minWidth: colWidths.reduce((a, b) => a + Math.max(48, b), 0),
        }),
        [colWidths, gridTemplateColumns],
    );

    const TableCell = ({
        index,
        children,
        title,
        style,
        className,
    }: {
        index: number;
        children?: ReactNode;
        title?: string;
        style?: CSSProperties;
        className?: string;
    }) => (
        <span
            title={title}
            className={`${styles.tableGridCell} ${className ?? ''}`}
            style={{ minWidth: 0, position: 'relative', ...style }}
        >
            {children}
            {index < colWidths.length - 1 ? (
                <div
                    className={styles.columnResizeHandle}
                    aria-hidden
                    onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        beginColumnResize(index, e.clientX);
                    }}
                />
            ) : null}
        </span>
    );

    // Signature state (matching dietfantasy pattern)
    const [signatureCounts, setSignatureCounts] = useState<Record<string, number>>({});
    const [signatureCopied, setSignatureCopied] = useState<Record<string, boolean>>({});
    const [signatureLoading, setSignatureLoading] = useState<Record<string, boolean>>({});
    const [tokenCache, setTokenCache] = useState<Record<string, string>>({});

    useEffect(() => {
        loadInitialData();
        loadSignatureCounts();
    }, []);

    // Sync currentView from URL (e.g. /clients?view=needs-attention)
    useEffect(() => {
        const view = searchParams.get('view');
        if (view === 'needs-attention' || view === 'eligible' || view === 'ineligible' || view === 'all' || view === 'billing' || view === 'brooklyn') {
            setCurrentView(view);
        }
    }, [searchParams]);

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
            .slice(0, 5); // Batch size - prefetch fewer to reduce initial load

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

    // Preload profile auxiliary data (allClients, regularClients, settings, categories) so the profile
    // dialog can open without calling loadAuxiliaryData (getClients/getRegularClients are heavy).
    useEffect(() => {
        if (isLoading || clients.length === 0) return;
        let cancelled = false;
        Promise.all([getClients(), getRegularClients(), getSettings(), getCategories()])
            .then(([allClientsData, regularClientsData, settingsData, categoriesData]) => {
                if (cancelled) return;
                setAllClientsForProfile(Array.isArray(allClientsData) ? allClientsData.filter((c): c is ClientProfile => c != null) : []);
                setRegularClients(Array.isArray(regularClientsData) ? regularClientsData.filter((c): c is ClientProfile => c != null) : []);
                setSettingsForProfile(settingsData ?? null);
                setCategoriesForProfile(Array.isArray(categoriesData) ? categoriesData : []);
            })
            .catch(err => console.error('[ClientList] Preload profile auxiliary failed:', err));
        return () => { cancelled = true; };
    }, [isLoading, clients.length]);

    // Load client details when info shelf opens
    useEffect(() => {
        if (infoShelfClientId && !detailsCache[infoShelfClientId] && !pendingPrefetches.current.has(infoShelfClientId)) {
            prefetchClient(infoShelfClientId);
        }
    }, [infoShelfClientId, detailsCache]);

    // Load client details when dependant shelf opens
    useEffect(() => {
        if (infoShelfDependantId && !detailsCache[infoShelfDependantId] && !pendingPrefetches.current.has(infoShelfDependantId)) {
            prefetchClient(infoShelfDependantId);
        }
    }, [infoShelfDependantId, detailsCache]);

    // Fetch parent names when clients list grows (e.g. from progressive loading)
    useEffect(() => {
        const parentIds = [...new Set(clients.map(c => c.parentClientId).filter(Boolean))] as string[];
        const missing = parentIds.filter(id => !parentNamesMap[id]);
        if (missing.length === 0) return;
        getClientNamesByIds(missing).then(map =>
            setParentNamesMap(prev => ({ ...prev, ...map }))
        );
    }, [clients, parentNamesMap]);

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
            const brooklynOnly = currentUser?.role === 'brooklyn_admin';
            const [sData, nData, vData, bData, mData, cRes, pvData] = await Promise.all([
                getStatuses(),
                getNavigators(),
                getVendors(),
                getBoxTypes(),
                getMenuItems(),
                getClientsPaginated(1, CLIENT_FETCH_LIMIT, '', undefined, brooklynOnly ? { brooklynOnly: true } : undefined),
                getCachedProduceVendors()
            ]);

            setStatuses(sData);
            setNavigators(nData);
            setVendors(vData);
            setBoxTypes(bData);
            setMenuItems(mData);
            setProduceVendors(pvData);
            const clientList = cRes.clients.filter((c): c is NonNullable<typeof c> => c !== null);
            setClients(clientList);
            setTotalClients(cRes.total);
            setPage(1);

            // Fetch parent names only for dependents on this page (lightweight query)
            const parentIds = [...new Set(clientList.map(c => c.parentClientId).filter(Boolean))] as string[];
            if (parentIds.length > 0) {
                getClientNamesByIds(parentIds).then(map => setParentNamesMap(prev => ({ ...prev, ...map })));
            }
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

            // Fetch fresh data (single request for all clients)
            const brooklynOnly = currentUser?.role === 'brooklyn_admin';
            const [sData, nData, vData, bData, mData, cRes] = await Promise.all([
                getStatuses(),
                getNavigators(),
                getVendors(),
                getBoxTypes(),
                getMenuItems(),
                getClientsPaginated(1, CLIENT_FETCH_LIMIT, '', undefined, brooklynOnly ? { brooklynOnly: true } : undefined)
            ]);

            // Update all data
            setStatuses(sData);
            setNavigators(nData);
            setVendors(vData);
            setBoxTypes(bData);
            setMenuItems(mData);
            const clientList = cRes.clients.filter((c): c is NonNullable<typeof c> => c !== null);
            setClients(clientList);
            setTotalClients(cRes.total);
            setPage(1);
            // Refresh parent names for visible dependents
            const parentIds = [...new Set(clientList.map(c => c.parentClientId).filter(Boolean))] as string[];
            if (parentIds.length > 0) {
                getClientNamesByIds(parentIds).then(map =>
                    setParentNamesMap(prev => ({ ...prev, ...map }))
                );
            }
            
            // Refresh signature counts
            loadSignatureCounts();
        } catch (error) {
            console.error("Error refreshing data:", error);
        } finally {
            setIsRefreshing(false);
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

    function formatClientDobCell(c: ClientProfile): string {
        if (!c.dob) return '—';
        try {
            const d = new Date(c.dob);
            if (isNaN(d.getTime())) return c.dob;
            return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'America/New_York' });
        } catch {
            return c.dob || '—';
        }
    }

    function formatClientExpirationCell(c: ClientProfile): string {
        if (!c.expirationDate) return '—';
        try {
            return new Date(c.expirationDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'America/New_York' });
        } catch {
            return '—';
        }
    }

    function formatCreatedAtCell(c: ClientProfile): string {
        if (!c.createdAt) return '—';
        try {
            return new Date(c.createdAt).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'America/New_York' });
        } catch {
            return '—';
        }
    }

    function boolTriMatches(want: ExpandedBoolFilter, val: boolean | undefined): boolean {
        if (!want) return true;
        const v = !!val;
        if (want === 'yes') return v;
        if (want === 'no') return !v;
        return true;
    }

    function clientMatchesExpandedColumnFilters(c: ClientProfile): boolean {
        if (!showExpandedTable) return true;
        const f = expandedColumnFilters;
        const inc = (needle: string, hay: string | null | undefined) =>
            !needle.trim() || (hay ?? '').toLowerCase().includes(needle.trim().toLowerCase());

        if (!inc(f.dob, formatClientDobCell(c)) && !inc(f.dob, c.dob ?? '')) return false;
        if (!inc(f.created, formatCreatedAtCell(c)) && !inc(f.created, c.createdAt ?? '')) return false;
        if (!inc(f.apt, c.apt ?? '')) return false;
        if (!inc(f.city, c.city ?? '')) return false;
        if (!inc(f.state, c.state ?? '')) return false;
        if (!inc(f.zip, c.zip ?? '')) return false;
        if (!inc(f.county, c.county ?? '')) return false;
        if (!inc(f.uniteCase, c.caseIdExternal ?? '')) return false;
        if (!inc(f.uniteAccount, c.uniteAccount ?? '')) return false;
        if (!inc(f.voucher, c.voucherAmount ?? '')) return false;
        if (!inc(f.history, c.history ?? '')) return false;

        const authStr =
            c.authorizedAmount != null && c.authorizedAmount !== undefined
                ? `$${Number(c.authorizedAmount).toFixed(2)}`
                : '';
        if (!inc(f.authorized, authStr) && !inc(f.authorized, c.authorizedAmount != null ? String(c.authorizedAmount) : '')) return false;

        const expStr = c.expirationDate ? formatClientExpirationCell(c) : '';
        if (!inc(f.expiration, expStr) && !inc(f.expiration, String(c.expirationDate ?? ''))) return false;

        if (!boolTriMatches(f.paused, c.paused)) return false;
        if (!boolTriMatches(f.complex, c.complex)) return false;
        if (!boolTriMatches(f.bill, c.bill)) return false;
        if (!boolTriMatches(f.delivery, c.delivery)) return false;
        if (!boolTriMatches(f.doNotText, c.doNotText)) return false;

        return true;
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
        if (currentView === 'brooklyn') {
            matchesView = (c.uniteAccount || '').trim() === 'Brooklyn';
        } else if (currentView === 'eligible') {
            const status = statuses.find(s => s.id === c.statusId);
            // Show clients whose status allows deliveries
            matchesView = status ? status.deliveriesAllowed : false;
        } else if (currentView === 'ineligible') {
            const status = statuses.find(s => s.id === c.statusId);
            // Show clients whose status does NOT allow deliveries
            matchesView = status ? !status.deliveriesAllowed : false;
        } else if (currentView === 'needs-attention') {
            // Show ALL clients that need attention (no eligibility gate):
            // 1. Client expires within one month from today (anytime on or before that date)
            // 2. Authorized amount is less than $2000 (or missing) — any service type

            const now = new Date();
            const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const oneMonthFromToday = new Date(today);
            oneMonthFromToday.setMonth(oneMonthFromToday.getMonth() + 1);

            // 1. Expiration on or before one month from today
            let expiresWithinMonth = false;
            if (c.expirationDate) {
                const expDate = new Date(String(c.expirationDate).trim());
                if (!isNaN(expDate.getTime())) {
                    expDate.setHours(0, 0, 0, 0);
                    const cutoff = new Date(oneMonthFromToday);
                    cutoff.setHours(23, 59, 59, 999);
                    expiresWithinMonth = expDate <= cutoff;
                }
            }

            // 2. Auth amount < 2000 or null/undefined (coerce to number for string API values)
            const rawAuth = c.authorizedAmount;
            const amount = rawAuth != null && String(rawAuth).trim() !== '' ? Number(rawAuth) : NaN;
            const authLowOrMissing = (amount !== amount) || amount < 2000; // NaN or < 2000

            matchesView = expiresWithinMonth || authLowOrMissing;
        }
        // 'billing' might just show all clients but with different columns?

        // Filter by Status
        const matchesStatusFilter = !statusFilter || c.statusId === statusFilter;

        // Filter by Navigator
        const matchesNavigatorFilter = !navigatorFilter || c.navigatorId === navigatorFilter;

        // Filter by Screening Status
        const matchesScreeningFilter = !screeningFilter || (c.screeningStatus || 'not_started') === screeningFilter;

        // Filter by Service Type: "Food" = non-Produce, "Produce" = all Produce, "Produce:<id>" = specific vendor
        let matchesServiceTypeFilter = true;
        if (serviceTypeFilter) {
            if (serviceTypeFilter.startsWith('Produce:')) {
                const pvId = serviceTypeFilter.slice('Produce:'.length);
                matchesServiceTypeFilter = c.serviceType === 'Produce' && c.produceVendorId === pvId;
            } else if (serviceTypeFilter === 'Produce') {
                matchesServiceTypeFilter = c.serviceType === 'Produce';
            } else {
                matchesServiceTypeFilter = c.serviceType !== 'Produce';
            }
        }

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

        // Filter by Flags (all, non-default only, or specific flag)
        const matchesFlagsFilter = clientMatchesFlagFilter(c, flagsFilter);

        return matchesSearch && matchesView && matchesStatusFilter && matchesNavigatorFilter && matchesScreeningFilter && matchesServiceTypeFilter && matchesNeedsVendorFilter && matchesDependentsFilter && matchesFlagsFilter && clientMatchesExpandedColumnFilters(c);
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
            case 'dislikes':
                const dislikesA = a.dislikes || '';
                const dislikesB = b.dislikes || '';
                comparison = dislikesA.localeCompare(dislikesB);
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
            case 'clientType':
                const pvNameA = a.serviceType === 'Produce' ? (produceVendors.find(pv => pv.id === a.produceVendorId)?.name ?? 'Produce') : 'Food';
                const pvNameB = b.serviceType === 'Produce' ? (produceVendors.find(pv => pv.id === b.produceVendorId)?.name ?? 'Produce') : 'Food';
                comparison = pvNameA.localeCompare(pvNameB);
                break;
            case 'flags':
                const nonDefaultA = hasNonDefaultFlags(a) ? 1 : 0;
                const nonDefaultB = hasNonDefaultFlags(b) ? 1 : 0;
                if (nonDefaultA !== nonDefaultB) {
                    comparison = nonDefaultB - nonDefaultA; // Non-default first
                } else {
                    comparison = (getNonDefaultFlagLabels(a).join(', ') || '').localeCompare(getNonDefaultFlagLabels(b).join(', ') || '');
                }
                break;
            case 'dob':
                const dobTa = a.dob ? new Date(a.dob).getTime() : 0;
                const dobTb = b.dob ? new Date(b.dob).getTime() : 0;
                const dobNa = !a.dob || isNaN(dobTa) ? 0 : dobTa;
                const dobNb = !b.dob || isNaN(dobTb) ? 0 : dobTb;
                comparison = (dobNa || Infinity) - (dobNb || Infinity); // missing last
                break;
            case 'apt':
                comparison = (a.apt || '').localeCompare(b.apt || '');
                break;
            case 'city':
                comparison = (a.city || '').localeCompare(b.city || '');
                break;
            case 'state':
                comparison = (a.state || '').localeCompare(b.state || '');
                break;
            case 'zip':
                comparison = (a.zip || '').localeCompare(b.zip || '');
                break;
            case 'county':
                comparison = (a.county || '').localeCompare(b.county || '');
                break;
            case 'uniteCase':
                comparison = (a.caseIdExternal || '').localeCompare(b.caseIdExternal || '');
                break;
            case 'uniteAccount':
                comparison = (a.uniteAccount || '').localeCompare(b.uniteAccount || '');
                break;
            case 'voucherAmount':
                comparison = (a.voucherAmount || '').localeCompare(b.voucherAmount || '');
                break;
            case 'createdAt':
                const createdA = a.createdAt ? new Date(a.createdAt).getTime() : 0;
                const createdB = b.createdAt ? new Date(b.createdAt).getTime() : 0;
                comparison = (isNaN(createdA) ? 0 : createdA) - (isNaN(createdB) ? 0 : createdB);
                break;
            case 'paused':
                comparison = (a.paused ? 1 : 0) - (b.paused ? 1 : 0);
                break;
            case 'complex':
                comparison = (a.complex ? 1 : 0) - (b.complex ? 1 : 0);
                break;
            case 'bill':
                comparison = (a.bill !== false ? 1 : 0) - (b.bill !== false ? 1 : 0);
                break;
            case 'delivery':
                comparison = (a.delivery !== false ? 1 : 0) - (b.delivery !== false ? 1 : 0);
                break;
            case 'doNotText':
                comparison = (a.doNotText ? 1 : 0) - (b.doNotText ? 1 : 0);
                break;
            case 'history':
                comparison = (a.history || '').localeCompare(b.history || '');
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
        setProfileServiceConfigOnly(false);
        setSelectedClientId('new');
    }

    async function handleAddDependent() {
        if (!dependentName.trim() || !selectedParentClientId) return;

        try {
            const dobValue = dependentDob.trim() || null;
            const cinValue = dependentCin.trim() ? parseFloat(dependentCin.trim()) : null;
            
            if (editingDependentId) {
                // Update existing dependent
                const updatePayload: Parameters<typeof updateClient>[1] = {
                    fullName: dependentName.trim(),
                    parentClientId: selectedParentClientId,
                    dob: dobValue,
                    cin: cinValue,
                    serviceType: dependentServiceType as ServiceType
                };
                if (dependentServiceType === 'Produce') {
                    updatePayload.approvedMealsPerWeek = null;
                }
                await updateClient(editingDependentId, updatePayload);
            } else {
                // Create new dependent
                const newDependent = await addDependent(dependentName.trim(), selectedParentClientId, dobValue, cinValue, dependentServiceType);
                if (!newDependent) return;
            }

            invalidateClientData(); // Invalidate cache
            setIsAddingDependent(false);
            setDependentName('');
            setDependentDob('');
            setDependentCin('');
            setDependentServiceType('Food');
            setSelectedParentClientId('');
            setParentClientSearch('');
            setEditingDependentId(null);
            // Refresh list so the new dependent appears; show dependents so it's visible
            setShowDependents(true);
            await refreshDataInBackground();
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
        return parentNamesMap[client.parentClientId] ?? '...';
    }

    function handleExportExcel() {
        if (filteredClients.length === 0) {
            alert('No clients to export. Adjust filters or search to include clients.');
            return;
        }
        // Map client id -> expiration date so dependents can use their parent's expiration
        const expirationByClientId: Record<string, string> = {};
        clients.forEach(c => { expirationByClientId[c.id] = c.expirationDate ?? ''; });
        const getExportExpirationDate = (client: ClientProfile) =>
            client.parentClientId ? (expirationByClientId[client.parentClientId] ?? '') : (client.expirationDate ?? '');

        const uniteAccountByClientId: Record<string, string> = {};
        clients.forEach(c => { uniteAccountByClientId[c.id] = c.uniteAccount ?? ''; });
        const getExportUniteAccount = (client: ClientProfile) =>
            client.parentClientId ? (uniteAccountByClientId[client.parentClientId] ?? '') : (client.uniteAccount ?? '');

        const headers = ['Name', 'Email', 'Phone', 'Secondary Phone', 'Address', 'City', 'State', 'Zip', 'Dislikes', 'Status', 'Navigator', 'Service Type', 'Parent Client', 'Expiration Date', 'Authorized Amount', 'Voucher Amount', 'Unite Account', 'History'];
        const rows = filteredClients.map(client => [
            client.fullName || '',
            client.email ?? '',
            client.phoneNumber ?? '',
            client.secondaryPhoneNumber ?? '',
            client.address ?? '',
            client.city ?? '',
            client.state ?? '',
            client.zip ?? '',
            client.dislikes ?? '',
            getStatusName(client.statusId),
            client.parentClientId ? '' : getNavigatorName(client.navigatorId),
            (() => {
                if (client.serviceType !== 'Produce') return 'Food';
                const pv = produceVendors.find(v => v.id === client.produceVendorId);
                return pv ? `produce-${pv.name.toLowerCase().replace(/\s+/g, '-')}` : 'Produce';
            })(),
            client.parentClientId ? (getParentClientName(client) ?? '') : '',
            getExportExpirationDate(client),
            client.authorizedAmount != null ? Number(client.authorizedAmount) : '',
            client.serviceType === 'Produce' ? (client.voucherAmount ?? '') : '',
            getExportUniteAccount(client),
            client.history ?? '',
        ]);
        const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Clients');
        const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `clients_export_${new Date().toISOString().slice(0, 10)}.xlsx`;
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(link.href);
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

    /** Sidebar-equivalent columns for expanded dashboard table (no geocoding / change log). */
    function renderExpandedShelfHeaders(): ReactNode {
        if (!showExpandedTable) return null;
        const isNeedsAttentionView = currentView === 'needs-attention';
        const inps: CSSProperties = { fontSize: '0.72rem', padding: '3px 5px', width: '100%' };

        const txtFilter = (field: ExpandedTextFilterKey) => (
            <input
                className="input"
                style={inps}
                placeholder="Filter…"
                value={expandedColumnFilters[field]}
                onChange={e => setExpandedColumnFilters(p => ({ ...p, [field]: e.target.value }))}
                onClick={e => e.stopPropagation()}
            />
        );

        const boolSel = (field: 'paused' | 'complex' | 'bill' | 'delivery' | 'doNotText') => (
            <select
                className="input"
                style={{ ...inps, padding: '2px 4px' }}
                value={expandedColumnFilters[field]}
                onChange={e => setExpandedColumnFilters(p => ({ ...p, [field]: e.target.value as ExpandedBoolFilter }))}
                onClick={e => e.stopPropagation()}
            >
                <option value="">All</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
            </select>
        );

        const hdr = (sortKey: string, label: string, filter: ReactNode, colIdx: number): ReactNode => (
            <TableCell index={colIdx}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', width: '100%', minWidth: 0 }}>
                    <span style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }} onClick={() => handleSort(sortKey)}>
                        {label} {getSortIcon(sortKey)}
                    </span>
                    {filter}
                </div>
            </TableCell>
        );

        let ci = expandColumnStartIndex;
        return (
            <>
                {hdr('dob', 'DOB', txtFilter('dob'), ci++)}
                {hdr('createdAt', 'Created', txtFilter('created'), ci++)}
                {hdr('apt', 'Unit', txtFilter('apt'), ci++)}
                {hdr('city', 'City', txtFilter('city'), ci++)}
                {hdr('state', 'State', txtFilter('state'), ci++)}
                {hdr('zip', 'Zip', txtFilter('zip'), ci++)}
                {hdr('county', 'County', txtFilter('county'), ci++)}
                {hdr('uniteCase', 'Unite Us', txtFilter('uniteCase'), ci++)}
                {hdr('uniteAccount', 'Unite Acct', txtFilter('uniteAccount'), ci++)}
                {!isNeedsAttentionView ? (
                    <>
                        {hdr('authorizedAmount', 'Authorized', txtFilter('authorized'), ci++)}
                        {hdr('expirationDate', 'Expiration', txtFilter('expiration'), ci++)}
                    </>
                ) : null}
                {hdr('voucherAmount', 'Voucher', txtFilter('voucher'), ci++)}
                {hdr('paused', 'Paused', boolSel('paused'), ci++)}
                {hdr('complex', 'Complex', boolSel('complex'), ci++)}
                {hdr('bill', 'Bill', boolSel('bill'), ci++)}
                {hdr('delivery', 'Delivery', boolSel('delivery'), ci++)}
                {hdr('doNotText', 'Do not text', boolSel('doNotText'), ci++)}
                {hdr('history', 'History', txtFilter('history'), ci++)}
            </>
        );
    }

    function renderExpandedShelfCells(client: ClientProfile): ReactNode {
        if (!showExpandedTable) return null;
        const isNeedsAttentionView = currentView === 'needs-attention';
        const cellText: CSSProperties = {
            fontSize: '0.82rem',
            color: 'var(--text-secondary)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            width: '100%',
        };
        const yn = (v: boolean | undefined) => (v ? 'Yes' : '—');
        const uniteRaw = (client.caseIdExternal || '').trim();
        const uniteHref = uniteRaw
            ? uniteRaw.startsWith('http')
                ? uniteRaw
                : `https://${uniteRaw}`
            : '';

        let ci = expandColumnStartIndex;
        return (
            <>
                <TableCell index={ci++} title={client.dob || undefined} style={cellText}>{formatClientDobCell(client)}</TableCell>
                <TableCell index={ci++} title={client.createdAt || undefined} style={cellText}>{formatCreatedAtCell(client)}</TableCell>
                <TableCell index={ci++} title={client.apt || undefined} style={cellText}>{client.apt?.trim() || '—'}</TableCell>
                <TableCell index={ci++} title={client.city || undefined} style={cellText}>{client.city?.trim() || '—'}</TableCell>
                <TableCell index={ci++} title={client.state || undefined} style={cellText}>{client.state?.trim() || '—'}</TableCell>
                <TableCell index={ci++} title={client.zip || undefined} style={cellText}>{client.zip?.trim() || '—'}</TableCell>
                <TableCell index={ci++} title={client.county || undefined} style={cellText}>{client.county?.trim() || '—'}</TableCell>
                <TableCell index={ci++} style={{ ...cellText, overflow: 'visible' }}>
                    {uniteHref ? (
                        <button
                            type="button"
                            className="btn btn-secondary"
                            style={{ fontSize: '0.75rem', padding: '4px 10px', whiteSpace: 'nowrap' }}
                            title={uniteRaw}
                            onClick={e => {
                                e.stopPropagation();
                                window.open(uniteHref, '_blank', 'noopener,noreferrer');
                            }}
                        >
                            Open in Unite
                        </button>
                    ) : (
                        '—'
                    )}
                </TableCell>
                <TableCell index={ci++} title={client.uniteAccount || undefined} style={cellText}>{client.uniteAccount?.trim() || '—'}</TableCell>
                {!isNeedsAttentionView ? (
                    <>
                        <TableCell index={ci++} style={cellText}>
                            {client.authorizedAmount !== null && client.authorizedAmount !== undefined
                                ? `$${Number(client.authorizedAmount).toFixed(2)}`
                                : '—'}
                        </TableCell>
                        <TableCell index={ci++} style={cellText}>{formatClientExpirationCell(client)}</TableCell>
                    </>
                ) : null}
                <TableCell
                    index={ci++}
                    title={client.serviceType === 'Produce' ? (client.voucherAmount || undefined) : undefined}
                    style={cellText}
                >
                    {client.serviceType === 'Produce' ? (client.voucherAmount?.trim() || '—') : '—'}
                </TableCell>
                <TableCell index={ci++} style={cellText}>{yn(client.paused)}</TableCell>
                <TableCell index={ci++} style={cellText}>{yn(client.complex)}</TableCell>
                <TableCell index={ci++} style={cellText}>{client.bill !== false ? 'Yes' : 'No'}</TableCell>
                <TableCell index={ci++} style={cellText}>{client.delivery !== false ? 'Yes' : 'No'}</TableCell>
                <TableCell index={ci++} style={cellText}>{yn(client.doNotText)}</TableCell>
                <TableCell index={ci++} title={client.history || undefined} style={cellText}>
                    {client.history?.trim() ? (client.history.trim().length > 40 ? `${client.history.trim().slice(0, 37)}…` : client.history.trim()) : '—'}
                </TableCell>
            </>
        );
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
            // Use same source as getOrderSummary / client detail: prefer deliveryDayOrders when present
            const isMultiDay = conf.deliveryDayOrders && typeof conf.deliveryDayOrders === 'object';
            const vendorToCount = new Map<string, number>();

            if (isMultiDay) {
                Object.values(conf.deliveryDayOrders || {}).forEach((dayOrder: any) => {
                    if (!dayOrder?.vendorSelections) return;
                    dayOrder.vendorSelections.forEach((v: any) => {
                        const vendorName = vendors.find(ven => ven.id === v.vendorId)?.name || 'Unknown';
                        const itemCount = Object.values(v.items || {}).reduce((a: number, b: any) => a + Number(b), 0);
                        if (itemCount > 0) {
                            vendorToCount.set(vendorName, (vendorToCount.get(vendorName) || 0) + itemCount);
                        }
                    });
                });
            }
            if (vendorToCount.size === 0 && (conf.vendorSelections || []).length > 0) {
                (conf.vendorSelections || []).forEach(v => {
                    const vendorName = vendors.find(ven => ven.id === v.vendorId)?.name || 'Unknown';
                    const itemCount = Object.values(v.items || {}).reduce((a: number, b: any) => a + Number(b), 0);
                    if (itemCount > 0) {
                        vendorToCount.set(vendorName, (vendorToCount.get(vendorName) || 0) + itemCount);
                    }
                });
            }
            const vendorsSummary = Array.from(vendorToCount.entries())
                .map(([name, count]) => `${name} (${count})`)
                .join(', ');

            if (!vendorsSummary) return '';
            content = `: ${vendorsSummary} [Max ${limit}]`;
        } else if (st === 'Boxes') {
            // Check vendorId from order config first, then fall back to boxType
            const box = boxTypes.find(b => b.id === conf.boxTypeId);
            const vendorId = conf.vendorId || box?.vendorId;
            const vendorName = vendors.find(v => v.id === vendorId)?.name || '-';

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
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const oneMonthFromToday = new Date(today);
        oneMonthFromToday.setMonth(oneMonthFromToday.getMonth() + 1);

        // 1. Expiration on or before one month from today
        if (client.expirationDate) {
            const expDate = new Date(client.expirationDate);
            expDate.setHours(0, 0, 0, 0);
            const cutoff = new Date(oneMonthFromToday);
            cutoff.setHours(23, 59, 59, 999);
            if (expDate <= cutoff) {
                reasons.push('Expires within one month');
            }
        }

        // 2. Auth amount < $2000 or missing (coerce to number)
        const rawAuth = client.authorizedAmount;
        const amount = rawAuth != null && String(rawAuth).trim() !== '' ? Number(rawAuth) : NaN;
        if (amount !== amount) {
            reasons.push('No authorized amount');
        } else if (amount < 2000) {
            reasons.push(`Auth amount $${amount} < $2,000`);
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
                    {isLoading && (
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Loading…</span>
                    )}
                    {isRefreshing && (
                        <div className={styles.refreshIndicator}>
                            <Loader2 size={14} className="animate-spin" />
                            <span>Refreshing...</span>
                        </div>
                    )}
                </div>
                <div className={styles.headerActions}>
                    {currentUser?.role !== 'brooklyn_admin' && (
                    <div className={styles.viewToggle}>
                        <button
                            className={`${styles.viewBtn} ${currentView === 'all' ? styles.viewBtnActive : ''}`}
                            onClick={() => setCurrentView('all')}
                        >
                            All Clients
                        </button>
                        <button
                            className={`${styles.viewBtn} ${currentView === 'brooklyn' ? styles.viewBtnActive : ''}`}
                            onClick={() => setCurrentView('brooklyn')}
                        >
                            Brooklyn
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
                    )}

                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button className="btn btn-secondary" onClick={handleExportExcel} title="Download current client list as Excel">
                            <Download size={16} /> Export Excel
                        </button>
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
                    className={`btn ${showExpandedTable ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setShowExpandedTable(v => !v)}
                    style={{ fontSize: '0.9rem' }}
                    title="Show address parts, eligibility, Unite Us, per-flag columns, history, CIN, and filters"
                >
                    <Table2 size={16} /> {showExpandedTable ? 'Compact' : 'Expand'} table
                </button>
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
                {(statusFilter || navigatorFilter || screeningFilter || serviceTypeFilter || needsVendorFilter ||
                    Object.values(expandedColumnFilters).some(v => v !== '')) && (
                    <button
                        className="btn btn-secondary"
                        onClick={() => {
                            setStatusFilter(null);
                            setNavigatorFilter(null);
                            setScreeningFilter(null);
                            setServiceTypeFilter(null);
                            setNeedsVendorFilter(false);
                            setExpandedColumnFilters({ ...EMPTY_EXPANDED_COLUMN_FILTERS });
                        }}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.9rem' }}
                    >
                        Clear All Filters
                    </button>
                )}
            </div>

            {isLoading ? (
                <div className={styles.loadingContainer}>
                    <Loader2 size={32} className="animate-spin" />
                    <p>Loading clients...</p>
                </div>
            ) : null}

            {!isLoading && (
            <>

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
                            <label className="label">Client type</label>
                            <select
                                className="input"
                                value={dependentServiceType}
                                onChange={e => setDependentServiceType(e.target.value as 'Food' | 'Produce')}
                            >
                                <option value="Food">Food</option>
                                <option value="Produce">Produce</option>
                            </select>
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
                                setDependentServiceType('Food');
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
                        setDependentServiceType('Food');
                        setSelectedParentClientId('');
                        setParentClientSearch('');
                        setEditingDependentId(null);
                    }}></div>
                </div>
            )}

            <div className={styles.list}>
                <div ref={listHeaderRef} className={`${styles.listHeader} ${styles.tableGridRow}`} style={gridRowStyle}>
                    <TableCell index={0}>#</TableCell>
                    <TableCell index={1}>
                        <span style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                            onClick={() => handleSort('name')}>
                            Name {getSortIcon('name')}
                        </span>
                    </TableCell>
                    <TableCell index={2}>
                        <span style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                            onClick={() => handleSort('signatures')}>
                            SIGN {getSortIcon('signatures')}
                        </span>
                    </TableCell>

                    {/* Type (Food / Produce) column - sortable + filter */}
                    <TableCell index={3}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px', position: 'relative', width: '100%', minWidth: 0 }} data-filter-dropdown>
                        <span style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }} onClick={() => handleSort('clientType')}>
                            Type {getSortIcon('clientType')}
                        </span>
                        <Filter
                            size={14}
                            style={{ cursor: 'pointer', opacity: serviceTypeFilter ? 1 : 0.5, color: serviceTypeFilter ? 'var(--color-primary)' : 'inherit', filter: serviceTypeFilter ? 'drop-shadow(0 0 3px var(--color-primary))' : 'none' }}
                            onClick={(e) => { e.stopPropagation(); setOpenFilterMenu(openFilterMenu === 'clientType' ? null : 'clientType'); }}
                        />
                        {openFilterMenu === 'clientType' && (
                            <div style={{
                                position: 'absolute', top: '100%', left: 0, marginTop: '4px',
                                backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)',
                                borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)',
                                zIndex: 1000, minWidth: '140px'
                            }}>
                                <div onClick={() => { setServiceTypeFilter(null); setOpenFilterMenu(null); }}
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
                                <div onClick={() => { setServiceTypeFilter('Produce'); setOpenFilterMenu(null); }}
                                    style={{
                                        padding: '8px 12px', cursor: 'pointer',
                                        backgroundColor: serviceTypeFilter === 'Produce' ? 'var(--bg-surface-hover)' : 'transparent',
                                        fontWeight: serviceTypeFilter === 'Produce' ? 600 : 400
                                    }}>
                                    All Produce
                                </div>
                                {produceVendors.filter(pv => pv.isActive).map(pv => (
                                    <div key={pv.id} onClick={() => { setServiceTypeFilter(`Produce:${pv.id}`); setOpenFilterMenu(null); }}
                                        style={{
                                            padding: '8px 12px', paddingLeft: '24px', cursor: 'pointer', fontSize: '0.9em',
                                            backgroundColor: serviceTypeFilter === `Produce:${pv.id}` ? 'var(--bg-surface-hover)' : 'transparent',
                                            fontWeight: serviceTypeFilter === `Produce:${pv.id}` ? 600 : 400
                                        }}>
                                        {pv.name}
                                    </div>
                                ))}
                            </div>
                        )}
                    </span>
                    </TableCell>

                    {/* Flags (non-default) column - sortable + filter */}
                    <TableCell index={4}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px', position: 'relative', width: '100%', minWidth: 0 }} data-filter-dropdown>
                        <span style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }} onClick={() => handleSort('flags')}>
                            <Flag size={14} /> Flags {getSortIcon('flags')}
                        </span>
                        <Filter
                            size={14}
                            style={{ cursor: 'pointer', opacity: flagsFilter !== 'all' ? 1 : 0.5, color: flagsFilter !== 'all' ? 'var(--color-primary)' : 'inherit', filter: flagsFilter !== 'all' ? 'drop-shadow(0 0 3px var(--color-primary))' : 'none' }}
                            onClick={(e) => { e.stopPropagation(); setOpenFilterMenu(openFilterMenu === 'flags' ? null : 'flags'); }}
                        />
                        {openFilterMenu === 'flags' && (
                            <div style={{
                                position: 'absolute', top: '100%', left: 0, marginTop: '4px',
                                backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border-color)',
                                borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)',
                                zIndex: 1000, minWidth: '180px', maxHeight: '320px', overflowY: 'auto'
                            }}>
                                {FLAGS_FILTER_OPTIONS.map(({ value, label }) => (
                                    <div key={value} onClick={() => { setFlagsFilter(value); setOpenFilterMenu(null); }}
                                        style={{
                                            padding: '8px 12px', cursor: 'pointer',
                                            backgroundColor: flagsFilter === value ? 'var(--bg-surface-hover)' : 'transparent',
                                            fontWeight: flagsFilter === value ? 600 : 400
                                        }}>
                                        {label}
                                    </div>
                                ))}
                            </div>
                        )}
                    </span>
                    </TableCell>

                    {/* Status column with filter */}
                    <TableCell index={5}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px', position: 'relative', width: '100%', minWidth: 0 }} data-filter-dropdown>
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
                    </TableCell>

                    {/* Navigator column (all views, including needs-attention) */}
                    <TableCell index={6}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px', position: 'relative', width: '100%', minWidth: 0 }} data-filter-dropdown>
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
                    </TableCell>

                    {currentView !== 'needs-attention' && (
                        <>
                            {/* Screening column with filter */}
                            <TableCell index={7}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', position: 'relative', width: '100%', minWidth: 0 }} data-filter-dropdown>
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
                            </TableCell>

                            <TableCell index={8}>
                            <span style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                                onClick={() => handleSort('dislikes')}>
                                Notes {getSortIcon('dislikes')}
                            </span>
                            </TableCell>
                        </>
                    )}

                    {currentView === 'needs-attention' ? (
                        <>
                            <TableCell index={7}>
                            <span style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                Reason
                            </span>
                            </TableCell>
                            <TableCell index={8}>
                            <span style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                                onClick={() => handleSort('authorizedAmount')}>
                                Authorized Amount {getSortIcon('authorizedAmount')}
                            </span>
                            </TableCell>
                            <TableCell index={9}>
                            <span style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                                onClick={() => handleSort('expirationDate')}>
                                Expiration Date {getSortIcon('expirationDate')}
                            </span>
                            </TableCell>
                        </>
                    ) : (
                        <>
                            <TableCell index={9}>
                            <span style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                                onClick={() => handleSort('email')}>
                                Email {getSortIcon('email')}
                            </span>
                            </TableCell>
                            <TableCell index={10}>
                            <span style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                                onClick={() => handleSort('phone')}>
                                Phone {getSortIcon('phone')}
                            </span>
                            </TableCell>
                            <TableCell index={11}>
                            <span style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                                onClick={() => handleSort('secondaryPhone')}>
                                Secondary Phone {getSortIcon('secondaryPhone')}
                            </span>
                            </TableCell>
                            <TableCell index={12}>
                            <span style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                                onClick={() => handleSort('address')}>
                                Address {getSortIcon('address')}
                            </span>
                            </TableCell>
                            <TableCell index={13}>
                            <span style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                                onClick={() => handleSort('notes')}>
                                Notes {getSortIcon('notes')}
                            </span>
                            </TableCell>
                        </>
                    )}
                    {renderExpandedShelfHeaders()}
                    <TableCell index={colWidths.length - 1} />
                </div>
                {filteredClients.map((client, index) => {
                    const status = statuses.find(s => s.id === client.statusId);
                    const isNotAllowed = status ? status.deliveriesAllowed === false : false;
                    const isDependent = !!client.parentClientId;

                    return (
                        <div
                            key={client.id}
                            onMouseEnter={() => {
                                if (!isDependent && !detailsCache[client.id] && !pendingPrefetches.current.has(client.id)) {
                                    prefetchClient(client.id);
                                }
                            }}
                            onClick={() => {
                                if (isDependent) {
                                    setInfoShelfDependantId(client.id);
                                    setInfoShelfClientId(null);
                                    if (!detailsCache[client.id]) {
                                        prefetchClient(client.id);
                                    }
                                } else {
                                    setInfoShelfClientId(client.id);
                                    setInfoShelfDependantId(null);
                                    if (!detailsCache[client.id]) {
                                        prefetchClient(client.id);
                                    }
                                }
                            }}
                            className={`${styles.clientRow} ${isDependent ? styles.clientRowDependent : ''} ${styles.tableGridRow}`}
                            style={{ cursor: 'pointer', ...gridRowStyle }}
                        >
                            <TableCell index={0} style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                                {index + 1}
                            </TableCell>
                            <TableCell index={1} title={client.fullName}>
                                <span style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '8px', width: '100%', minWidth: 0 }}>
                                    {isNotAllowed && <span className={styles.redTab}></span>}
                                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>{client.fullName}</span>
                                </span>
                            </TableCell>
                            <TableCell index={2} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                {isDependent ? '-' : <SignCell client={client} />}
                            </TableCell>
                            <TableCell index={3} title={client.serviceType === 'Produce' ? `Produce${(() => { const pv = produceVendors.find(v => v.id === client.produceVendorId); return pv ? ` - ${pv.name}` : ''; })()}` : client.serviceType} style={{ fontSize: '0.9rem' }}>
                                {client.serviceType === 'Produce' ? (() => { const pv = produceVendors.find(v => v.id === client.produceVendorId); return pv ? pv.name : 'Produce'; })() : 'Food'}
                            </TableCell>
                            <TableCell index={4} title={isDependent ? '' : (hasNonDefaultFlags(client) ? getNonDefaultFlagLabels(client).join(', ') : 'All default')} style={{ fontSize: '0.85rem', color: hasNonDefaultFlags(client) ? 'var(--color-primary)' : 'var(--text-tertiary)' }}>
                                {isDependent ? '-' : (hasNonDefaultFlags(client) ? getNonDefaultFlagLabels(client).join(', ') : '—')}
                            </TableCell>
                            <TableCell index={5} title={client.parentClientId ? `Parent: ${getParentClientName(client)}` : getStatusName(client.statusId)}>
                                {client.parentClientId ? (
                                    <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
                                        Parent: {getParentClientName(client)}
                                    </span>
                                ) : (
                                    <span className={`badge ${getStatusName(client.statusId) === 'Active' ? 'badge-success' : ''}`}>
                                        {getStatusName(client.statusId)}
                                    </span>
                                )}
                            </TableCell>
                            <TableCell index={6} title={isDependent ? '' : getNavigatorName(client.navigatorId)}>
                                {isDependent ? '-' : getNavigatorName(client.navigatorId)}
                            </TableCell>
                            {currentView !== 'needs-attention' && (
                                <>
                                    <TableCell index={7}>{isDependent ? '-' : getScreeningStatus(client)}</TableCell>
                                    <TableCell index={8} title={isDependent ? undefined : (client.dislikes || undefined)} style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                        {isDependent ? '-' : (client.dislikes || '-')}
                                    </TableCell>
                                </>
                            )}
                            {currentView === 'needs-attention' ? (
                                <>
                                    <TableCell index={7} title={getNeedsAttentionReason(client)} style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                        {getNeedsAttentionReason(client)}
                                    </TableCell>
                                    <TableCell index={8} style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                        {client.authorizedAmount !== null && client.authorizedAmount !== undefined
                                            ? `$${client.authorizedAmount.toFixed(2)}`
                                            : '-'}
                                    </TableCell>
                                    <TableCell index={9} style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                        {client.expirationDate
                                            ? new Date(client.expirationDate).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'America/New_York' })
                                            : '-'}
                                    </TableCell>
                                </>
                            ) : (
                                <>
                                    <TableCell index={9} title={isDependent ? undefined : (client.email || undefined)} style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                        {isDependent ? '-' : (client.email || '-')}
                                    </TableCell>
                                    <TableCell index={10} title={client.phoneNumber || undefined} style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                        {client.phoneNumber || '-'}
                                    </TableCell>
                                    <TableCell index={11} title={client.secondaryPhoneNumber || undefined} style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                        {client.secondaryPhoneNumber || '-'}
                                    </TableCell>
                                    <TableCell index={12} title={isDependent ? undefined : client.address} style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                        {isDependent ? '-' : (client.address || '-')}
                                    </TableCell>
                                    <TableCell index={13} title={isDependent ? undefined : client.notes} style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
                                        {isDependent ? '-' : (client.notes || '-')}
                                    </TableCell>
                                </>
                            )}
                            {renderExpandedShelfCells(client)}
                            <TableCell index={colWidths.length - 1} style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                <ChevronRight size={16} />
                            </TableCell>
                        </div>
                    );
                })}
                {filteredClients.length === 0 && !isLoading && (
                    <div className={styles.empty}>
                        {flagsFilter !== 'all' ? `No clients with "${FLAGS_FILTER_OPTIONS.find(o => o.value === flagsFilter)?.label ?? flagsFilter}".` :
                            serviceTypeFilter ? `No clients with type "${serviceTypeFilter}".` :
                            needsVendorFilter ? 'No clients with box orders needing vendor assignment.' :
                                currentView === 'ineligible' ? 'No ineligible clients found.' :
                                    currentView === 'eligible' ? 'No eligible clients found.' :
                                        currentView === 'brooklyn' ? 'No Brooklyn clients found.' :
                                            currentView === 'needs-attention' ? 'No clients need attention.' :
                                                'No clients found.'}
                    </div>
                )}
            </div>

            {selectedClientId && (
                <div className={styles.profileModal}>
                    <div className={styles.profileCard}>
                        <ClientProfileDetail
                            ref={profileDetailRef}
                            clientId={selectedClientId}
                            serviceConfigOnly={profileServiceConfigOnly}
                            saveDetailsOnly={false}
                            initialData={detailsCache[selectedClientId]}
                            statuses={statuses}
                            navigators={navigators}
                            vendors={vendors}
                            menuItems={menuItems}
                            boxTypes={boxTypes}
                            currentUser={currentUser}
                            initialSettings={settingsForProfile}
                            initialCategories={categoriesForProfile}
                            initialAllClients={allClientsForProfile}
                            initialRegularClients={regularClients}
                            onClose={() => {
                                const closedClientId = selectedClientId;
                                setProfileServiceConfigOnly(false);
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
                        // When clicking off: if in edit mode (unsaved changes), save then close; otherwise just close
                        const ref = profileDetailRef.current;
                        if (ref?.hasUnsavedChanges?.()) {
                            ref.saveAndClose?.();
                        } else {
                            ref?.close?.() ?? (() => {
                                const closedClientId = selectedClientId;
                                setProfileServiceConfigOnly(false);
                                setSelectedClientId(null);
                                setDetailsCache(prev => {
                                    const next = { ...prev };
                                    delete next[closedClientId];
                                    return next;
                                });
                                refreshDataInBackground();
                            })();
                        }
                    }}></div>
                </div>
            )}

            {infoShelfClientId && clients.find(c => c.id === infoShelfClientId) && (
                <ClientInfoShelf
                    client={detailsCache[infoShelfClientId]?.client || clients.find(c => c.id === infoShelfClientId)!}
                    statuses={statuses}
                    navigators={navigators}
                    submissions={detailsCache[infoShelfClientId]?.submissions || []}
                    allClients={clients}
                    currentUserRole={currentUser?.role}
                    onClose={() => setInfoShelfClientId(null)}
                    onOpenProfile={(clientId) => {
                        setInfoShelfClientId(null);
                        setProfileServiceConfigOnly(true);
                        setSelectedClientId(clientId);
                    }}
                    onOpenDependantShelf={(clientId) => {
                        setInfoShelfClientId(null);
                        setInfoShelfDependantId(clientId);
                        if (!detailsCache[clientId]) prefetchClient(clientId);
                    }}
                    onClientUpdated={(updatedClient) => {
                        const id = infoShelfClientId;
                        if (updatedClient && id && updatedClient.id === id) {
                            // Update only this client in the list and cache (no full reload)
                            setClients(prev => prev.map(c => (c.id === id ? updatedClient : c)));
                            setDetailsCache(prev => ({
                                ...prev,
                                [id]: { ...(prev[id] || {}), client: updatedClient } as any,
                            }));
                        } else if (id) {
                            // No updated client (e.g. dependent added): clear cache and refresh
                            setDetailsCache(prev => {
                                const next = { ...prev };
                                delete next[id];
                                return next;
                            });
                            refreshDataInBackground();
                        }
                    }}
                    onClientDeleted={() => {
                        setInfoShelfClientId(null);
                        refreshDataInBackground();
                    }}
                />
            )}

            {infoShelfDependantId && clients.find(c => c.id === infoShelfDependantId) && (
                <DependantInfoShelf
                    client={detailsCache[infoShelfDependantId]?.client || clients.find(c => c.id === infoShelfDependantId)!}
                    currentUserRole={currentUser?.role}
                    onClose={() => setInfoShelfDependantId(null)}
                    onOpenProfile={(clientId) => {
                        setInfoShelfDependantId(null);
                        setProfileServiceConfigOnly(true);
                        setSelectedClientId(clientId);
                    }}
                    onClientUpdated={(updatedClient) => {
                        const id = infoShelfDependantId;
                        if (updatedClient && id && updatedClient.id === id) {
                            setClients(prev => prev.map(c => (c.id === id ? updatedClient : c)));
                            setDetailsCache(prev => ({
                                ...prev,
                                [id]: { ...(prev[id] || {}), client: updatedClient } as any,
                            }));
                        } else if (id) {
                            setDetailsCache(prev => {
                                const next = { ...prev };
                                delete next[id];
                                return next;
                            });
                            refreshDataInBackground();
                        }
                    }}
                    onClientDeleted={() => {
                        setInfoShelfDependantId(null);
                        refreshDataInBackground();
                    }}
                />
            )}
            </>
            )}
        </div>
    );
}



