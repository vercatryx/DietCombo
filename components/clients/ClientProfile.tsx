'use client';

import { useState, useEffect, Fragment, useMemo, useRef, ReactNode } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { ClientProfile, ClientStatus, Navigator, Vendor, MenuItem, BoxType, ServiceType, AppSettings, DeliveryRecord, ItemCategory, ClientFullDetails, BoxQuota } from '@/lib/types';
import { updateClient, addClient, deleteClient, updateDeliveryProof, recordClientChange, syncCurrentOrderToUpcoming, logNavigatorAction, getBoxQuotas, saveEquipmentOrder, getRegularClients, getDependentsByParentId, addDependent, saveClientFoodOrder, saveClientMealOrder, saveClientBoxOrder, saveClientCustomOrder, getClientBoxOrder } from '@/lib/actions';
import { getSingleForm, getClientSubmissions } from '@/lib/form-actions';
import { getClient, getStatuses, getNavigators, getVendors, getMenuItems, getBoxTypes, getSettings, getCategories, getEquipment, getClients, invalidateClientData, invalidateReferenceData, getActiveOrderForClient, getUpcomingOrderForClient, getOrderHistory, getClientHistory, getBillingHistory, invalidateOrderData, getRecentOrdersForClient } from '@/lib/cached-data';
import { areAnyDeliveriesLocked, getEarliestEffectiveDate, getLockedWeekDescription } from '@/lib/weekly-lock';
import {
    getNextDeliveryDate as getNextDeliveryDateUtil,
    getNextDeliveryDateForDay,
    getTakeEffectDate,
    getAllDeliveryDatesForOrder,
    formatDeliveryDate
} from '@/lib/order-dates';
import { Save, ArrowLeft, Truck, Package, AlertTriangle, Upload, Trash2, Plus, Check, ClipboardList, History, CreditCard, Calendar, ChevronDown, ChevronUp, ShoppingCart, Loader2, FileText, Square, CheckSquare, Wrench, Info, PenTool, Copy, ExternalLink } from 'lucide-react';
import FormFiller from '@/components/forms/FormFiller';
import { FormSchema } from '@/lib/form-types';
import TextareaAutosize from 'react-textarea-autosize';
import SubmissionsList from './SubmissionsList';
import styles from './ClientProfile.module.css';
import { geocodeOneClient } from '@/lib/geocodeOneClient';
import { buildGeocodeQuery } from '@/lib/addressHelpers';
import MapConfirmDialog from './MapConfirmDialog';
import { isValidUniteUsUrl, parseUniteUsUrl, formatUniteUsUrl, isMeetingExactTarget } from '@/lib/utils';


interface Props {
    clientId: string;
    onClose?: () => void;
    initialData?: ClientFullDetails | null;
    // Lookups passed from parent to avoid re-fetching
    statuses?: ClientStatus[];
    navigators?: Navigator[];
    vendors?: Vendor[];
    menuItems?: MenuItem[];
    boxTypes?: BoxType[];
    currentUser?: { role: string; id: string } | null;
}

const SERVICE_TYPES: ServiceType[] = ['Food', 'Boxes', 'Custom'];

// Min/Max validation for approved meals per week
const MIN_APPROVED_MEALS_PER_WEEK = 1;
const MAX_APPROVED_MEALS_PER_WEEK = 100;


function UnitsModal({
    isOpen,
    onClose,
    onConfirm,
    saving
}: {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: (units: number) => void;
    saving: boolean;
}) {
    const [units, setUnits] = useState<string>('0');



    if (!isOpen) return null;

    return (
        <div className={styles.modalOverlay} style={{ zIndex: 1000 }}>
            <div className={styles.modalContent} style={{ maxWidth: '400px', height: 'auto', padding: '24px' }}>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '16px' }}>Status Change Detected</h2>
                <p style={{ marginBottom: '16px', color: 'var(--text-secondary)' }}>
                    You are changing the client's status. How many units should be added?
                </p>
                <div style={{ marginBottom: '24px' }}>
                    <label className="label">Units Added</label>
                    <input
                        type="number"
                        className="input"
                        value={units}
                        onChange={e => setUnits(e.target.value)}
                        min="0"
                    />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                    <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
                    <button
                        className="btn btn-primary"
                        onClick={() => onConfirm(parseInt(units) || 0)}
                        disabled={saving}
                    >
                        {saving ? <Loader2 className="spin" size={16} /> : 'Confirm & Save'}
                    </button>
                </div>
            </div>
        </div>
    );
}

function DeleteConfirmationModal({
    isOpen,
    onClose,
    onConfirm,
    clientName,
    deleting
}: {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    clientName: string;
    deleting: boolean;
}) {
    if (!isOpen) return null;

    return (
        <div className={styles.modalOverlay} style={{ zIndex: 1000 }}>
            <div className={styles.modalContent} style={{ maxWidth: '400px', height: 'auto', padding: '24px' }}>
                <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '16px', color: '#dc2626' }}>Delete Client</h2>
                <p style={{ marginBottom: '24px', color: 'var(--text-secondary)' }}>
                    Are you sure you want to delete <strong>{clientName}</strong>? This action cannot be undone and will permanently remove all client data.
                </p>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                    <button className="btn" onClick={onClose} disabled={deleting}>Cancel</button>
                    <button
                        className={`btn ${styles.deleteButton}`}
                        onClick={onConfirm}
                        disabled={deleting}
                    >
                        {deleting ? <Loader2 className="spin" size={16} /> : <><Trash2 size={16} /> Delete Client</>}
                    </button>
                </div>
            </div>
        </div>
    );
}

export function ClientProfileDetail({ clientId: propClientId, onClose, initialData, statuses: initialStatuses, navigators: initialNavigators, vendors: initialVendors, menuItems: initialMenuItems, boxTypes: initialBoxTypes, currentUser }: Props): ReactNode {
    const router = useRouter();
    const params = useParams();
    const propClientIdValue = (params?.id as string) || propClientId;

    // Track the actual clientId (starts as prop, updates to real ID after creating new client)
    const [actualClientId, setActualClientId] = useState<string>(propClientIdValue);
    const clientId = actualClientId;
    const isNewClient = clientId === 'new';

    // Track if we just created a new client to prevent useEffect from overwriting orderConfig
    const justCreatedClientRef = useRef<boolean>(false);
    // Track if we've already set defaults to prevent infinite loops
    const defaultsSetRef = useRef<{ [key: string]: boolean; lastKey?: string }>({});

    const [client, setClient] = useState<ClientProfile | null>(null);
    const [statuses, setStatuses] = useState<ClientStatus[]>(initialStatuses || []);
    const [navigators, setNavigators] = useState<Navigator[]>(initialNavigators || []);
    const [vendors, setVendors] = useState<Vendor[]>(initialVendors || []);
    const [menuItems, setMenuItems] = useState<MenuItem[]>(initialMenuItems || []);
    const [boxTypes, setBoxTypes] = useState<BoxType[]>(initialBoxTypes || []);
    const [categories, setCategories] = useState<ItemCategory[]>([]);
    const [boxQuotas, setBoxQuotas] = useState<BoxQuota[]>([]);
    const [equipment, setEquipment] = useState<any[]>([]);
    const [showEquipmentOrder, setShowEquipmentOrder] = useState(false);
    const [equipmentOrder, setEquipmentOrder] = useState<{ vendorId: string; equipmentId: string } | null>(null);
    const [submittingEquipmentOrder, setSubmittingEquipmentOrder] = useState(false);

    // Refresh vendors and equipment when equipment order section is opened to ensure we have latest data
    useEffect(() => {
        if (showEquipmentOrder) {
            Promise.all([
                getVendors().then(v => setVendors(v)),
                getEquipment().then(e => setEquipment(e))
            ]);
        }
    }, [showEquipmentOrder]);
    const [settings, setSettings] = useState<AppSettings | null>(null);
    const [history, setHistory] = useState<DeliveryRecord[]>([]);
    const [orderHistory, setOrderHistory] = useState<any[]>([]);
    const [billingHistory, setBillingHistory] = useState<any[]>([]);
    const [activeHistoryTab, setActiveHistoryTab] = useState<'deliveries' | 'audit' | 'billing'>('deliveries');
    const [allClients, setAllClients] = useState<ClientProfile[]>([]);
    const [expandedBillingRows, setExpandedBillingRows] = useState<Set<string>>(new Set());
    const [regularClients, setRegularClients] = useState<ClientProfile[]>([]);
    const [parentClientSearch, setParentClientSearch] = useState('');
    const [dependents, setDependents] = useState<ClientProfile[]>([]);

    const [formData, setFormData] = useState<Partial<ClientProfile>>({});
    const [orderConfig, setOrderConfig] = useState<any>({}); // Current Order Request (from upcoming_orders)
    const [originalOrderConfig, setOriginalOrderConfig] = useState<any>({}); // Original Order Request for comparison
    const [activeOrder, setActiveOrder] = useState<any>(null); // Recent Orders (from orders table)
    const [allUpcomingOrders, setAllUpcomingOrders] = useState<any[]>([]); // All upcoming orders for display

    const [saving, setSaving] = useState(false);
    const [message, setMessage] = useState<string | null>(null);
    const [validationError, setValidationError] = useState<{ show: boolean, messages: string[] }>({ show: false, messages: [] });
    const [errorModal, setErrorModal] = useState<{ show: boolean, message: string }>({ show: false, message: '' });

    const [loading, setLoading] = useState(true);
    const [loadingOrderDetails, setLoadingOrderDetails] = useState(true);

    // Form Filler State
    const [isFillingForm, setIsFillingForm] = useState(false);
    const [formSchema, setFormSchema] = useState<FormSchema | null>(null);
    const [loadingForm, setLoadingForm] = useState(false);
    const [submissions, setSubmissions] = useState<any[]>([]);
    const [loadingSubmissions, setLoadingSubmissions] = useState(false);

    // Status Change Logic
    const [showUnitsModal, setShowUnitsModal] = useState(false);
    const [pendingStatusChange, setPendingStatusChange] = useState<{ oldStatus: string, newStatus: string } | null>(null);

    // Delete Confirmation Modal
    const [showDeleteModal, setShowDeleteModal] = useState(false);

    // Dependent Creation State
    const [showAddDependentForm, setShowAddDependentForm] = useState(false);
    const [dependentName, setDependentName] = useState('');
    const [dependentDob, setDependentDob] = useState('');
    const [dependentCin, setDependentCin] = useState('');
    const [creatingDependent, setCreatingDependent] = useState(false);

    // Geolocation State
    const [geoBusy, setGeoBusy] = useState(false);
    const [geoErr, setGeoErr] = useState('');
    const [caseIdExternalError, setCaseIdExternalError] = useState('');
    const [geoSuccess, setGeoSuccess] = useState(false);
    const [geoPersisting, setGeoPersisting] = useState(false);
    const [candsOpen, setCandsOpen] = useState(false);
    const [cands, setCands] = useState<any[]>([]);
    const [mapOpen, setMapOpen] = useState(false);
    const inflight = useRef(new Set<AbortController>());

    // Signature State
    const [signatureCollected, setSignatureCollected] = useState<number>(0);
    const [signatureLink, setSignatureLink] = useState<string | null>(null);
    const [isCopyingLink, setIsCopyingLink] = useState(false);

    // Abort all in-flight geocoding requests - must be defined before first useEffect
    const abortAllGeo = () => {
        for (const ctrl of inflight.current) ctrl.abort();
        inflight.current.clear();
        setGeoBusy(false);
        setGeoErr("");
    };

    useEffect(() => {
        // Reset geocoding state when dialog opens or client changes
        setGeoBusy(false);
        setGeoErr("");
        setCandsOpen(false);
        setCands([]);
        setGeoSuccess(false);
        setGeoPersisting(false);
        setCaseIdExternalError("");
        abortAllGeo();

        // Handle new client case - initialize with defaults
        if (isNewClient) {
            setLoading(true);
            // Load lookups but don't load client data
            loadLookups().then(() => {
                // Initialize with default values
                const initialStatusId = (initialStatuses || statuses)[0]?.id || '';
                const defaultNavigatorId = (initialNavigators || navigators).find(n => n.isActive)?.id || '';

                const defaultClient: Partial<ClientProfile> = {
                    fullName: '',
                    email: '',
                    address: '',
                    phoneNumber: '',
                    secondaryPhoneNumber: null,
                    navigatorId: defaultNavigatorId,
                    endDate: '',
                    screeningTookPlace: false,
                    screeningSigned: false,
                    notes: '',
                    statusId: initialStatusId,
                    serviceType: 'Food',
                    approvedMealsPerWeek: 21,
                    authorizedAmount: null,
                    expirationDate: null
                };

                setFormData(defaultClient);
                setClient(defaultClient as ClientProfile);
                setOrderConfig({ serviceType: 'Food', vendorSelections: [{ vendorId: '', items: {} }] });
                setOriginalOrderConfig({});
                setLoading(false);
                setLoadingOrderDetails(false);
            });
            return;
        }

        // If we just created this client, skip reloading to preserve the orderConfig we just set
        if (justCreatedClientRef.current) {

            justCreatedClientRef.current = false; // Reset the flag
            return;
        }



        // If we have initialData AND we have the necessary lookups (passed as props), we can hydrate instantly without loading state.
        // However, if we are missing critical lookups (e.g. somehow props weren't passed), we should still trigger loadLookups.
        // Generally, ClientList passes everything.

        if (initialData && initialData.client.id === clientId) {

            hydrateFromInitialData(initialData);
            // If props were passed, we don't need to fetch standard lookups, but we might still need settings/categories/allClients
            // For simplicity, let's just fetch everything missing in background but show content immediately if we have the basics.
            // If we don't have vendors/statuses props, we probably should show loader or fetch fast.

            if (!initialStatuses || !initialVendors || initialVendors.length === 0) {
                // Should hopefully not happen in ClientList usage, but handle it
                // Also check if vendors array is empty (not just undefined)
                setLoading(true);
                loadLookups().then(() => setLoading(false));
            } else {
                // Still fetch auxiliary data that might not be in props (settings, categories, allClients)
                // But do NOT block UI
                setLoading(false);
                loadAuxiliaryData(initialData.client);
            }
        } else {
            setLoading(true);
            loadData().then(() => setLoading(false));
        }
    }, [clientId, initialData, isNewClient]);

    // Sync vendors state when initialVendors prop changes
    useEffect(() => {
        if (initialVendors && initialVendors.length > 0) {
            setVendors(initialVendors);
            console.log(`[ClientProfile] Updated vendors from prop: ${initialVendors.length} vendors`);
        } else if (vendors.length === 0 && initialVendors !== undefined) {
            // If vendors are empty and we explicitly got an empty array from props, try to load
            console.warn('[ClientProfile] Vendors prop is empty, attempting to load vendors');
            getVendors().then(v => {
                if (v && v.length > 0) {
                    setVendors(v);
                    console.log(`[ClientProfile] Loaded ${v.length} vendors after empty prop`);
                } else {
                    console.error('[ClientProfile] Failed to load vendors - getVendors returned empty');
                }
            });
        }
    }, [initialVendors]);

    useEffect(() => {
        // Load submissions for this client
        if (clientId) {
            loadSubmissions();
            loadSignatureStatus();
        }
    }, [clientId]);

    // Effect: Initialize boxOrders when Boxes service is selected
    // Only initialize if boxOrders is empty AND there's no existing data (items, vendorId, boxTypeId)
    useEffect(() => {
        // If Boxes service is selected and no boxOrders, initialize it
        // BUT: Don't overwrite if we already have items, vendorId, or boxTypeId from loaded data
        if (formData.serviceType === 'Boxes' && (!orderConfig.boxOrders || orderConfig.boxOrders.length === 0)) {
            // Check if we have any existing data that suggests we're waiting for data to load
            const hasExistingData = orderConfig.vendorId || 
                                   orderConfig.boxTypeId || 
                                   (orderConfig.items && Object.keys(orderConfig.items).length > 0);
            
            // If we have existing data, don't initialize yet - let loadData handle it
            if (hasExistingData) {
                return;
            }
            
            const firstActiveBoxType = boxTypes.find(bt => bt.isActive);
            setOrderConfig((prev: any) => ({
                ...prev,
                boxOrders: [{
                    boxTypeId: firstActiveBoxType?.id || '',
                    vendorId: firstActiveBoxType?.vendorId || '',
                    quantity: 1,
                    items: {}
                }]
            }));
        }
    }, [formData.serviceType, boxTypes, orderConfig.vendorId, orderConfig.boxTypeId, orderConfig.items]);

    // Extract dependencies with defaults to ensure consistent array size
    const caseId = useMemo(() => orderConfig?.caseId ?? null, [orderConfig?.caseId]);
    const vendorSelections = useMemo(() => orderConfig?.vendorSelections ?? [], [orderConfig?.vendorSelections]);
    const vendorId = useMemo(() => orderConfig?.vendorId ?? null, [orderConfig?.vendorId]);
    const boxTypeId = useMemo(() => orderConfig?.boxTypeId ?? null, [orderConfig?.boxTypeId]);
    const boxQuantity = useMemo(() => orderConfig?.boxQuantity ?? null, [orderConfig?.boxQuantity]);
    const items = useMemo(() => (orderConfig as any)?.items ?? {}, [(orderConfig as any)?.items]);
    const itemPrices = useMemo(() => (orderConfig as any)?.itemPrices ?? {}, [(orderConfig as any)?.itemPrices]);
    const serviceType = useMemo(() => formData?.serviceType ?? null, [formData?.serviceType]);

    // Initialize parentClientSearch when formData changes (always call this hook before any conditional returns)
    useEffect(() => {
        if (client?.parentClientId && formData.parentClientId && !parentClientSearch) {
            const parent = regularClients.find(c => c.id === formData.parentClientId);
            if (parent) {
                setParentClientSearch(parent.fullName);
            }
        }
    }, [formData.parentClientId, client?.parentClientId, regularClients, parentClientSearch]);

    // Effect: Load quotas when boxOrders changes
    useEffect(() => {
        // Load box quotas if we have boxes
        if (formData.serviceType === 'Boxes' && orderConfig.boxOrders && orderConfig.boxOrders.length > 0) {
            // Loading quotas for the first box type for now, as UI usually shows one quota section
            const firstBoxTypeId = orderConfig.boxOrders[0].boxTypeId;
            if (firstBoxTypeId) {
                getBoxQuotas(firstBoxTypeId).then(quotas => {
                    setBoxQuotas(quotas);
                }).catch(err => {
                    console.error('Error loading box quotas:', err);
                    setBoxQuotas([]);
                });
            }
        } else {
            setBoxQuotas([]);
        }
    }, [formData.serviceType, orderConfig.boxOrders, boxTypes]);

    // Helper: Get default vendor for a service type
    // Prioritizes vendors with isDefault: true, then falls back to first active vendor
    function getDefaultVendor(serviceType: string): string | null {
        if (!vendors || vendors.length === 0) return null;
        
        // First, try to find a vendor with isDefault: true that matches the service type
        const defaultVendors = vendors.filter(v => {
            if (!v.isActive) return false;
            if (v.isDefault !== true) return false;
            
            if (serviceType === 'Food') {
                return v.serviceTypes && Array.isArray(v.serviceTypes) && v.serviceTypes.includes('Food');
            } else if (serviceType === 'Boxes') {
                return v.serviceTypes && Array.isArray(v.serviceTypes) && v.serviceTypes.includes('Boxes');
            }
            return false;
        });
        
        if (defaultVendors.length > 0) {
            return defaultVendors[0].id;
        }
        
        // Fallback: find first active vendor that matches the service type
        const filteredVendors = vendors.filter(v => {
            if (!v.isActive) return false;
            
            if (serviceType === 'Food') {
                return v.serviceTypes && Array.isArray(v.serviceTypes) && v.serviceTypes.includes('Food');
            } else if (serviceType === 'Boxes') {
                return v.serviceTypes && Array.isArray(v.serviceTypes) && v.serviceTypes.includes('Boxes');
            }
            return false;
        });
        
        if (filteredVendors.length > 0) {
            return filteredVendors[0].id;
        }
        
        // Final fallback: use first active vendor (regardless of service type)
        const activeVendors = vendors.filter(v => v.isActive !== undefined ? v.isActive : true);
        return activeVendors.length > 0 ? activeVendors[0].id : null;
    }

    // Helper: Ensure vendor selections have default vendors set
    function ensureDefaultVendors(selections: any[], serviceType: string): any[] {
        const defaultVendorId = getDefaultVendor(serviceType);
        if (!defaultVendorId) return selections;

        return selections.map((sel: any) => {
            if (!sel.vendorId || sel.vendorId.trim() === '') {
                return { ...sel, vendorId: defaultVendorId };
            }
            return sel;
        });
    }

    // Effect: Auto-set default vendor when caseId is set and vendor selections are empty
    useEffect(() => {
        if (!orderConfig.caseId || vendors.length === 0) {
            defaultsSetRef.current = {};
            return;
        }

        const configKey = `${formData.serviceType}-${orderConfig.caseId}`;
        // Reset ref if caseId or serviceType changed (new config)
        const lastConfigKey = defaultsSetRef.current.lastKey;
        if (lastConfigKey && lastConfigKey !== configKey) {
            defaultsSetRef.current = {};
        }
        defaultsSetRef.current.lastKey = configKey;
        
        // Skip if we've already set defaults for this config
        if (defaultsSetRef.current[configKey]) return;

        const defaultVendorId = formData.serviceType === 'Food' 
            ? getDefaultVendor('Food') 
            : formData.serviceType === 'Boxes' 
                ? getDefaultVendor('Boxes') 
                : null;

        if (!defaultVendorId) return;

        let needsUpdate = false;
        const newConfig = { ...orderConfig };

        if (formData.serviceType === 'Food') {
            // Check multi-day format
            if (newConfig.deliveryDayOrders) {
                const deliveryDayOrders = { ...newConfig.deliveryDayOrders };
                Object.keys(deliveryDayOrders).forEach(day => {
                    const daySelections = deliveryDayOrders[day].vendorSelections || [];
                    const hasEmpty = daySelections.some((sel: any) => !sel.vendorId || sel.vendorId.trim() === '');
                    if (hasEmpty || daySelections.length === 0) {
                        const updated = ensureDefaultVendors(
                            daySelections.length === 0 ? [{ vendorId: '', items: {} }] : daySelections,
                            'Food'
                        );
                        deliveryDayOrders[day] = { vendorSelections: updated };
                        needsUpdate = true;
                    }
                });
                if (needsUpdate) {
                    newConfig.deliveryDayOrders = deliveryDayOrders;
                }
            }
            // Check single-day format
            else {
                const vendorSelections = newConfig.vendorSelections || [];
                const hasEmpty = vendorSelections.length === 0 || vendorSelections.some((sel: any) => !sel.vendorId || sel.vendorId.trim() === '');
                if (hasEmpty) {
                    const updated = ensureDefaultVendors(
                        vendorSelections.length === 0 ? [{ vendorId: '', items: {} }] : vendorSelections,
                        'Food'
                    );
                    newConfig.vendorSelections = updated;
                    needsUpdate = true;
                }
            }
        } else if (formData.serviceType === 'Boxes') {
            const boxOrders = newConfig.boxOrders || [];
            const hasEmpty = boxOrders.length === 0 || boxOrders.some((box: any) => !box.vendorId || box.vendorId.trim() === '');
            if (hasEmpty) {
                const updated = boxOrders.length === 0
                    ? [{ vendorId: defaultVendorId, boxTypeId: '', quantity: 1, items: {}, itemNotes: {} }]
                    : ensureDefaultVendors(boxOrders, 'Boxes').map((box: any) => ({
                        ...box,
                        vendorId: !box.vendorId || box.vendorId.trim() === '' ? defaultVendorId : box.vendorId
                    }));
                newConfig.boxOrders = updated;
                if (updated.length > 0 && updated[0].vendorId) {
                    newConfig.vendorId = updated[0].vendorId;
                }
                needsUpdate = true;
            }
        }

        if (needsUpdate) {
            defaultsSetRef.current[configKey] = true;
            setOrderConfig(newConfig);
        } else {
            // Mark as checked even if no update needed
            defaultsSetRef.current[configKey] = true;
        }
    }, [orderConfig.caseId, vendors.length, formData.serviceType]);

    // Don't show anything until all data is loaded
    if (loading || loadingOrderDetails || !client) {
        return (
            <div className={styles.loadingContainer} style={{ minHeight: '400px' }}>
                <div className={styles.spinner}></div>
                <p className={styles.loadingText}>Loading client profile...</p>
            </div>
        );
    }

    // Render Form Filler if active
    if (isFillingForm && formSchema) {
        return (
            <div className={`${styles.container} ${onClose ? styles.inModal : ''}`} style={{ padding: 0 }}>
                <FormFiller schema={formSchema} onBack={handleCloseScreeningForm} clientId={clientId} />
            </div>
        );
    }



    async function loadSubmissions() {
        setLoadingSubmissions(true);
        try {
            const result = await getClientSubmissions(clientId);
            if (result.success && result.data) {
                setSubmissions(result.data);
            }
        } catch (error) {
            console.error('Failed to load submissions:', error);
        } finally {
            setLoadingSubmissions(false);
        }
    }

    async function loadSignatureStatus() {
        if (!clientId || clientId === 'new') return;
        try {
            // Get signature status
            const statusRes = await fetch('/api/signatures/status', { cache: 'no-store' });
            if (statusRes.ok) {
                const statusData = await statusRes.json();
                const clientStatus = statusData.find((s: any) => s.userId === clientId);
                if (clientStatus) {
                    setSignatureCollected(clientStatus.collected || 0);
                }
            }

            // Get or create signature token
            const tokenRes = await fetch(`/api/signatures/ensure-token/${clientId}`, {
                method: 'POST',
            });
            if (tokenRes.ok) {
                const tokenData = await tokenRes.json();
                if (tokenData.sign_token) {
                    const baseUrl = window.location.origin;
                    setSignatureLink(`${baseUrl}/sign/${tokenData.sign_token}`);
                }
            }
        } catch (error) {
            console.error('Failed to load signature status:', error);
        }
    }

    async function handleCopySignatureLink() {
        if (!signatureLink) {
            // Ensure token exists
            if (!clientId || clientId === 'new') return;
            try {
                const tokenRes = await fetch(`/api/signatures/ensure-token/${clientId}`, {
                    method: 'POST',
                });
                if (tokenRes.ok) {
                    const tokenData = await tokenRes.json();
                    if (tokenData.sign_token) {
                        const baseUrl = window.location.origin;
                        const link = `${baseUrl}/sign/${tokenData.sign_token}`;
                        setSignatureLink(link);
                        await navigator.clipboard.writeText(link);
                        setIsCopyingLink(true);
                        setTimeout(() => setIsCopyingLink(false), 2000);
                    }
                }
            } catch (error) {
                console.error('Failed to get signature link:', error);
            }
        } else {
            await navigator.clipboard.writeText(signatureLink);
            setIsCopyingLink(true);
            setTimeout(() => setIsCopyingLink(false), 2000);
        }
    }


    async function loadAuxiliaryData(clientToCheck?: ClientProfile) {
        const [appSettings, catData, allClientsData, regularClientsData] = await Promise.all([
            getSettings(),
            getCategories(),
            getClients(),
            getRegularClients()
        ]);
        setSettings(appSettings);
        setCategories(catData);
        setAllClients(allClientsData);
        setRegularClients(regularClientsData);

        // Load dependents if this is a regular client (not a dependent)
        const clientForDependents = clientToCheck || client;
        if (clientForDependents && !clientForDependents.parentClientId) {
            const dependentsData = await getDependentsByParentId(clientForDependents.id);
            setDependents(dependentsData);
        }
    }

    function hydrateFromInitialData(data: ClientFullDetails) {
        setClient(data.client);
        setFormData(data.client);

        // Set active order, history, order history, and billing history if available
        setActiveOrder(data.activeOrder || null);
        setHistory(data.history || []);
        setOrderHistory(data.orderHistory || []);
        setBillingHistory(data.billingHistory || []);
        setLoadingOrderDetails(false);

        // Handle upcoming order logic (reused from loadData)
        const upcomingOrderData = data.upcomingOrder;
        console.log('[ClientProfile] hydrateFromInitialData - Debugging Boxes Vendor', {
            upcomingOrderData: JSON.stringify(upcomingOrderData, null, 2),
            clientActiveOrder: JSON.stringify(data.client.activeOrder, null, 2)
        });
        if (upcomingOrderData) {
            // Check if it's the multi-day format (object keyed by delivery day, not deliveryDayOrders)
            const isMultiDayFormat = upcomingOrderData && typeof upcomingOrderData === 'object' &&
                !upcomingOrderData.serviceType &&
                !upcomingOrderData.deliveryDayOrders &&
                Object.keys(upcomingOrderData).some(key => {
                    const val = (upcomingOrderData as any)[key];
                    return val && val.serviceType;
                });

            if (isMultiDayFormat) {
                // Convert to deliveryDayOrders format
                const deliveryDayOrders: any = {};
                for (const day of Object.keys(upcomingOrderData)) {
                    const dayOrder = (upcomingOrderData as any)[day];
                    if (dayOrder && dayOrder.serviceType) {
                        deliveryDayOrders[day] = {
                            vendorSelections: dayOrder.vendorSelections || []
                        };
                    }
                }
                // Check if it's Boxes - if so, flatten it to single order config
                const firstDayKey = Object.keys(upcomingOrderData)[0];
                const firstDayOrder = (upcomingOrderData as any)[firstDayKey];

                if (firstDayOrder?.serviceType === 'Boxes') {
                    let configToSet = firstDayOrder;
                    // Merge activeOrder items into orderConfig
                    if (data.activeOrder) {
                        configToSet = mergeActiveOrderIntoOrderConfig(configToSet, data.activeOrder);
                    }
                    setOrderConfig(configToSet);
                } else {
                    let configToSet = {
                        serviceType: firstDayOrder?.serviceType || data.client.serviceType,
                        caseId: firstDayOrder?.caseId,
                        deliveryDayOrders
                    };
                    // Merge activeOrder items into orderConfig
                    if (data.activeOrder) {
                        configToSet = mergeActiveOrderIntoOrderConfig(configToSet, data.activeOrder);
                    }
                    setOrderConfig(configToSet);
                }
            } else if (upcomingOrderData.serviceType === 'Food' && !upcomingOrderData.vendorSelections && !upcomingOrderData.deliveryDayOrders) {
                if (upcomingOrderData.vendorId) {
                    upcomingOrderData.vendorSelections = [{ vendorId: upcomingOrderData.vendorId, items: upcomingOrderData.menuSelections || {} }];
                } else {
                    upcomingOrderData.vendorSelections = [{ vendorId: '', items: {} }];
                }
                let configToSet = upcomingOrderData;
                // Merge activeOrder items into orderConfig
                if (data.activeOrder) {
                    configToSet = mergeActiveOrderIntoOrderConfig(configToSet, data.activeOrder);
                }
                setOrderConfig(configToSet);
            } else {
                let configToSet = upcomingOrderData;
                // Merge activeOrder items into orderConfig
                if (data.activeOrder) {
                    configToSet = mergeActiveOrderIntoOrderConfig(configToSet, data.activeOrder);
                }
                setOrderConfig(configToSet);
            }
        } else if (data.client.activeOrder) {
            // No upcoming order, but we have active_order from clients table - use that
            // This ensures vendorId, items, and other Boxes data are preserved even if sync to upcoming_orders failed
            const activeOrderConfig = { ...data.client.activeOrder };
            // Ensure serviceType matches client's service type
            if (!activeOrderConfig.serviceType) {
                activeOrderConfig.serviceType = data.client.serviceType;
            }

            let configToSet = activeOrderConfig;
            // Merge activeOrder items into orderConfig
            if (data.activeOrder) {
                configToSet = mergeActiveOrderIntoOrderConfig(configToSet, data.activeOrder);
            }
            setOrderConfig(configToSet);
        } else {
            const defaultOrder: any = { serviceType: data.client.serviceType };
            if (data.client.serviceType === 'Food') {
                defaultOrder.vendorSelections = [{ vendorId: '', items: {} }];
            } else if (data.client.serviceType === 'Custom') {
                defaultOrder.vendorId = '';
                defaultOrder.customItems = [];
            }
            let configToSet = defaultOrder;
            // Merge activeOrder items into orderConfig
            if (data.activeOrder) {
                configToSet = mergeActiveOrderIntoOrderConfig(configToSet, data.activeOrder);
            }
            setOrderConfig(configToSet);
        }

        // Fix for Boxes: Handle boxOrders array and migrate legacy fields if needed
        if (data.client.serviceType === 'Boxes') {
            setOrderConfig((prev: any) => {
                const conf = { ...prev };
                
                // First, check if client.activeOrder has boxOrders and use that if conf doesn't have it
                if (!conf.boxOrders || !Array.isArray(conf.boxOrders) || conf.boxOrders.length === 0) {
                    if (data.client.activeOrder && data.client.activeOrder.boxOrders && Array.isArray(data.client.activeOrder.boxOrders) && data.client.activeOrder.boxOrders.length > 0) {
                        console.log('[ClientProfile] hydrateFromInitialData - Using boxOrders from client.activeOrder', {
                            boxOrdersCount: data.client.activeOrder.boxOrders.length
                        });
                        conf.boxOrders = [...data.client.activeOrder.boxOrders];
                    }
                }
                
                // If we have boxOrders, ensure legacy fields are synced
                if (conf.boxOrders && Array.isArray(conf.boxOrders) && conf.boxOrders.length > 0) {
                    const firstBox = conf.boxOrders[0];
                    if (firstBox.vendorId && !conf.vendorId) {
                        conf.vendorId = firstBox.vendorId;
                    }
                    if (firstBox.boxTypeId && !conf.boxTypeId) {
                        conf.boxTypeId = firstBox.boxTypeId;
                    }
                    if (firstBox.quantity && !conf.boxQuantity) {
                        conf.boxQuantity = firstBox.quantity;
                    }
                    if (firstBox.items && Object.keys(firstBox.items).length > 0 && (!conf.items || Object.keys(conf.items).length === 0)) {
                        conf.items = firstBox.items;
                    }
                }
                // Fallback: migrate legacy fields to boxOrders array if array is missing
                else if (!conf.boxOrders || conf.boxOrders.length === 0) {
                    if (conf.boxTypeId || conf.vendorId || (conf.items && Object.keys(conf.items).length > 0)) {
                        const legacyBox = {
                            boxTypeId: conf.boxTypeId || '',
                            vendorId: conf.vendorId || '',
                            quantity: conf.boxQuantity || 1,
                            items: conf.items || {},
                            itemNotes: conf.itemNotes || {}
                        };
                        conf.boxOrders = [legacyBox];
                    } else {
                        // Default empty box
                        const firstActiveBoxType = boxTypes?.find((bt: any) => bt.isActive);
                        conf.boxOrders = [{
                            boxTypeId: firstActiveBoxType?.id || '',
                            vendorId: firstActiveBoxType?.vendorId || '',
                            quantity: 1,
                            items: {}
                        }];
                    }
                }
                
                // Use boxTypes from component state (passed as prop)
                if (!conf.vendorId && conf.boxTypeId && boxTypes && boxTypes.length > 0) {
                    const boxType = boxTypes.find((bt: any) => bt.id === conf.boxTypeId);
                    if (boxType && boxType.vendorId) {
                        console.log('[ClientProfile] hydrateFromInitialData - Recovered missing vendorId from boxType', {
                            boxTypeId: conf.boxTypeId,
                            recoveredVendorId: boxType.vendorId
                        });
                        conf.vendorId = boxType.vendorId;
                        // Also update the first box in boxOrders if it exists
                        if (conf.boxOrders && conf.boxOrders.length > 0) {
                            conf.boxOrders[0].vendorId = boxType.vendorId;
                        }
                    }
                }
                
                return conf;
            });
        }
    }

    async function loadLookups() {
        const [s, n, v, m, b, appSettings, catData, eData, allClientsData, regularClientsData] = await Promise.all([
            getStatuses(),
            getNavigators(),
            getVendors(),
            getMenuItems(),
            getBoxTypes(),
            getSettings(),
            getCategories(),
            getEquipment(),
            getClients(),
            getRegularClients()
        ]);
        setStatuses(s);
        setNavigators(n);
        // Ensure vendors array is set (even if empty, to avoid undefined issues)
        const vendorsArray = v || [];
        setVendors(vendorsArray);
        if (vendorsArray && vendorsArray.length > 0) {
            console.log(`[ClientProfile] Loaded ${vendorsArray.length} vendors:`, vendorsArray.map(v => ({ id: v.id, name: v.name, serviceTypes: v.serviceTypes, isActive: v.isActive })));
            // Log Food vendors specifically
            const foodVendors = vendorsArray.filter(v => v.serviceTypes && Array.isArray(v.serviceTypes) && v.serviceTypes.includes('Food') && v.isActive);
            console.log(`[ClientProfile] Active Food vendors: ${foodVendors.length}`, foodVendors.map(v => v.name));
            // Log vendors with empty serviceTypes for debugging
            const vendorsWithEmptyServiceTypes = vendorsArray.filter(v => !v.serviceTypes || !Array.isArray(v.serviceTypes) || v.serviceTypes.length === 0);
            if (vendorsWithEmptyServiceTypes.length > 0) {
                console.warn(`[ClientProfile] Found ${vendorsWithEmptyServiceTypes.length} vendors with empty/invalid serviceTypes:`, vendorsWithEmptyServiceTypes.map(v => ({ id: v.id, name: v.name, serviceTypes: v.serviceTypes })));
            }
        } else {
            console.warn('[ClientProfile] No vendors loaded - vendor dropdowns will be empty');
        }
        setMenuItems(m);
        setBoxTypes(b);
        setSettings(appSettings);
        setCategories(catData);
        setEquipment(eData);
        setAllClients(allClientsData);
        setRegularClients(regularClientsData);
    }

    async function loadData() {
        setLoadingOrderDetails(true);
        
        // Get client first to determine if we need to filter by case_id for Boxes
        // For Boxes service type, use case_id from orderConfig or client's activeOrder
        const client = await getClient(clientId);
        const caseId = client?.serviceType === 'Boxes' 
            ? (orderConfig?.caseId || client?.activeOrder?.caseId || null)
            : null;
        
        const [c, s, n, v, m, b, appSettings, catData, eData, allClientsData, regularClientsData, upcomingOrderData, activeOrderData, historyData, orderHistoryData, billingHistoryData] = await Promise.all([
            Promise.resolve(client),
            getStatuses(),
            getNavigators(),
            getVendors(),
            getMenuItems(),
            getBoxTypes(),
            getSettings(),
            getCategories(),
            getEquipment(),
            getClients(),
            getRegularClients(),
            // For Boxes service type, filter by case_id to get the latest upcoming order for the selected client
            getUpcomingOrderForClient(clientId, caseId),
            getRecentOrdersForClient(clientId),
            getClientHistory(clientId),
            // For Boxes service type, filter order history by case_id
            getOrderHistory(clientId, caseId),
            getBillingHistory(clientId)
        ]);

        if (c) {
            setClient(c);
        }
        setStatuses(s);
        setNavigators(n);
        // Ensure vendors array is set (even if empty, to avoid undefined issues)
        const vendorsArray = v || [];
        setVendors(vendorsArray);
        if (vendorsArray && vendorsArray.length > 0) {
            console.log(`[ClientProfile] Loaded ${vendorsArray.length} vendors:`, vendorsArray.map(v => ({ id: v.id, name: v.name, serviceTypes: v.serviceTypes, isActive: v.isActive })));
            // Log Food vendors specifically
            const foodVendors = vendorsArray.filter(v => v.serviceTypes && Array.isArray(v.serviceTypes) && v.serviceTypes.includes('Food') && v.isActive);
            console.log(`[ClientProfile] Active Food vendors: ${foodVendors.length}`, foodVendors.map(v => v.name));
            // Log vendors with empty serviceTypes for debugging
            const vendorsWithEmptyServiceTypes = vendorsArray.filter(v => !v.serviceTypes || !Array.isArray(v.serviceTypes) || v.serviceTypes.length === 0);
            if (vendorsWithEmptyServiceTypes.length > 0) {
                console.warn(`[ClientProfile] Found ${vendorsWithEmptyServiceTypes.length} vendors with empty/invalid serviceTypes:`, vendorsWithEmptyServiceTypes.map(v => ({ id: v.id, name: v.name, serviceTypes: v.serviceTypes })));
            }
        } else {
            console.warn('[ClientProfile] No vendors loaded - vendor dropdowns will be empty');
        }
        setMenuItems(m);
        setBoxTypes(b);
        setSettings(appSettings);
        setCategories(catData);
        setEquipment(eData);
        setAllClients(allClientsData);
        setRegularClients(regularClientsData);
        setActiveOrder(activeOrderData);
        setHistory(historyData || []);
        setOrderHistory(orderHistoryData || []);
        setBillingHistory(billingHistoryData || []);
        setLoadingOrderDetails(false);

        // Load dependents if this is a regular client (not a dependent)
        if (c && !c.parentClientId) {
            const dependentsData = await getDependentsByParentId(c.id);
            setDependents(dependentsData);
        }

        // Set order config from upcoming_orders table (Current Order Request)
        // If no upcoming order exists, fall back to active_order from clients table
        // If no active_order exists, initialize with default based on service type
        if (c) {
            console.log('[ClientProfile] loadData - Debugging Boxes Vendor', {
                clientId: c.id,
                serviceType: c.serviceType,
                upcomingOrderData: JSON.stringify(upcomingOrderData, null, 2),
                activeOrderData: JSON.stringify(activeOrderData, null, 2),
                clientActiveOrder: JSON.stringify(c.activeOrder, null, 2)
            });
            let configToSet: any = null;
            
            // If there's a case ID, prioritize loading from upcoming orders
            const hasCaseId = orderConfig?.caseId || c.activeOrder?.caseId || upcomingOrderData?.caseId;
            
            if (upcomingOrderData) {
                // Check if it's the multi-day format (object keyed by delivery day, not deliveryDayOrders)
                const isMultiDayFormat = upcomingOrderData && typeof upcomingOrderData === 'object' &&
                    !upcomingOrderData.serviceType &&
                    !upcomingOrderData.deliveryDayOrders &&
                    Object.keys(upcomingOrderData).some(key => {
                        const val = (upcomingOrderData as any)[key];
                        return val && (val.serviceType || val.id);
                    });

                if (isMultiDayFormat) {
                    // Convert to deliveryDayOrders format
                    const deliveryDayOrders: any = {};
                    for (const day of Object.keys(upcomingOrderData)) {
                        const dayOrder = (upcomingOrderData as any)[day];
                        if (dayOrder && (dayOrder.serviceType || dayOrder.id)) {
                            deliveryDayOrders[day] = {
                                vendorSelections: dayOrder.vendorSelections || []
                            };
                        }
                    }
                    // Check if it's Boxes - if so, flatten it to single order config
                    const firstDayKey = Object.keys(upcomingOrderData)[0];
                    const firstDayOrder = (upcomingOrderData as any)[firstDayKey];

                    if (firstDayOrder?.serviceType === 'Boxes' || c.serviceType === 'Boxes') {
                        configToSet = firstDayOrder;
                        if (!configToSet.serviceType) configToSet.serviceType = 'Boxes';
                    } else {
                        configToSet = {
                            serviceType: firstDayOrder?.serviceType || c.serviceType,
                            caseId: firstDayOrder?.caseId || hasCaseId,
                            deliveryDayOrders
                        };
                    }
                } else if (upcomingOrderData.deliveryDayOrders && typeof upcomingOrderData.deliveryDayOrders === 'object') {
                    // Already in deliveryDayOrders format - use it directly
                    configToSet = {
                        serviceType: upcomingOrderData.serviceType || c.serviceType,
                        caseId: upcomingOrderData.caseId || hasCaseId,
                        deliveryDayOrders: upcomingOrderData.deliveryDayOrders
                    };
                } else if (upcomingOrderData.serviceType === 'Food' && !upcomingOrderData.vendorSelections && !upcomingOrderData.deliveryDayOrders) {
                    // Migration/Safety: Ensure vendorSelections exists for Food
                    if (upcomingOrderData.vendorId) {
                        // Migrate old format
                        upcomingOrderData.vendorSelections = [{ vendorId: upcomingOrderData.vendorId, items: upcomingOrderData.menuSelections || {} }];
                    } else {
                        upcomingOrderData.vendorSelections = [{ vendorId: '', items: {} }];
                    }
                    configToSet = {
                        ...upcomingOrderData,
                        caseId: upcomingOrderData.caseId || hasCaseId
                    };
                } else {
                    // Single order format - ensure caseId is set
                    configToSet = {
                        ...upcomingOrderData,
                        caseId: upcomingOrderData.caseId || hasCaseId
                    };
                }
            }

            // Validate Config: If Boxes and missing critical fields, reject it
            if (configToSet && c.serviceType === 'Boxes' && !configToSet.vendorId && !configToSet.boxTypeId) {
                console.log('[ClientProfile] loadData - Discarding invalid upcoming order config for Boxes', configToSet);
                configToSet = null;
            }

            if (!configToSet && c.activeOrder) {
                // No upcoming order, but we have active_order from clients table - use that
                // This ensures vendorId, items, and other Boxes data are preserved even if sync to upcoming_orders failed
                configToSet = { ...c.activeOrder };
                // Ensure serviceType matches client's service type
                if (!configToSet.serviceType) {
                    configToSet.serviceType = c.serviceType;
                }
                // Ensure caseId is set if it exists in activeOrder
                if (!configToSet.caseId && c.activeOrder.caseId) {
                    configToSet.caseId = c.activeOrder.caseId;
                }
            }

            if (!configToSet) {
                // No upcoming order and no active_order, initialize with default
                const defaultOrder: any = { serviceType: c.serviceType };
                if (c.serviceType === 'Food') {
                    defaultOrder.vendorSelections = [{ vendorId: '', items: {} }];
                } else if (c.serviceType === 'Custom') {
                    defaultOrder.vendorId = '';
                    defaultOrder.customItems = [];
                }
                configToSet = defaultOrder;
            }
            
            // Ensure caseId is preserved if it exists in orderConfig (from form input)
            if (orderConfig?.caseId && !configToSet.caseId) {
                configToSet.caseId = orderConfig.caseId;
            }

            // Fix for Boxes: Handle boxOrders array and migrate legacy fields if needed
            if (c.serviceType === 'Boxes') {
                // NEW: Handle boxOrders array from backend
                // First, check if client.activeOrder has boxOrders and use that if configToSet doesn't have it
                if (!configToSet.boxOrders || !Array.isArray(configToSet.boxOrders) || configToSet.boxOrders.length === 0) {
                    if (c.activeOrder && c.activeOrder.boxOrders && Array.isArray(c.activeOrder.boxOrders) && c.activeOrder.boxOrders.length > 0) {
                        console.log('[ClientProfile] loadData - Using boxOrders from client.activeOrder', {
                            boxOrdersCount: c.activeOrder.boxOrders.length
                        });
                        configToSet.boxOrders = [...c.activeOrder.boxOrders];
                    }
                }
                
                // If we have boxOrders from the backend, use that
                if (configToSet.boxOrders && Array.isArray(configToSet.boxOrders) && configToSet.boxOrders.length > 0) {
                    // Ensure vendorId and items are synced from boxOrders to legacy fields for backward compat
                    const firstBox = configToSet.boxOrders[0];
                    if (firstBox.vendorId && !configToSet.vendorId) {
                        configToSet.vendorId = firstBox.vendorId;
                    }
                    if (firstBox.items && Object.keys(firstBox.items).length > 0 && (!configToSet.items || Object.keys(configToSet.items).length === 0)) {
                        configToSet.items = firstBox.items;
                    }
                }
                // Fallback: migrate legacy fields to boxOrders array if array is missing
                else if (!configToSet.boxOrders || configToSet.boxOrders.length === 0) {
                    // Use items from configToSet first, fallback to upcomingOrderData.items
                    const itemsSource = (configToSet.items && Object.keys(configToSet.items).length > 0) 
                        ? configToSet.items 
                        : (upcomingOrderData && upcomingOrderData.items ? upcomingOrderData.items : {});

                    const legacyBox = {
                        boxTypeId: configToSet.boxTypeId || '',
                        vendorId: configToSet.vendorId || '',
                        quantity: configToSet.boxQuantity || 1,
                        items: itemsSource || {},
                        itemNotes: configToSet.itemNotes || {}
                    };

                    console.log('[ClientProfile] loadData - Creating boxOrders from legacy fields', {
                        hasItems: !!(legacyBox.items && Object.keys(legacyBox.items).length > 0),
                        itemsCount: legacyBox.items ? Object.keys(legacyBox.items).length : 0,
                        items: legacyBox.items,
                        vendorId: legacyBox.vendorId,
                        boxTypeId: legacyBox.boxTypeId,
                        itemsSource: itemsSource === configToSet.items ? 'configToSet.items' : 'upcomingOrderData.items'
                    });

                    // Only add if there is actual data
                    if (legacyBox.boxTypeId || legacyBox.vendorId || (legacyBox.items && Object.keys(legacyBox.items).length > 0)) {
                        configToSet.boxOrders = [legacyBox];
                    } else {
                        // Default empty box
                        const firstActiveBoxType = b?.find((bt: any) => bt.isActive);
                        configToSet.boxOrders = [{
                            boxTypeId: firstActiveBoxType?.id || '',
                            vendorId: firstActiveBoxType?.vendorId || '',
                            quantity: 1,
                            items: {}
                        }];
                    }
                }

                // If vendorId is missing but boxTypeId exists, try to find vendor from boxType
                if (!configToSet.vendorId && configToSet.boxTypeId) {
                    const boxType = b.find((bt: any) => bt.id === configToSet.boxTypeId);
                    if (boxType && boxType.vendorId) {
                        console.log('[ClientProfile] loadData - Recovered missing vendorId from boxType', {
                            boxTypeId: configToSet.boxTypeId,
                            recoveredVendorId: boxType.vendorId
                        });
                        configToSet.vendorId = boxType.vendorId;
                        // Also update the first box in boxOrders if it exists
                        if (configToSet.boxOrders && configToSet.boxOrders.length > 0) {
                            configToSet.boxOrders[0].vendorId = boxType.vendorId;
                        }
                    }
                }

                // Auto-populate items from upcoming orders if they exist (check both upcomingOrderData and configToSet)
                const itemsToPopulate = (upcomingOrderData && upcomingOrderData.serviceType === 'Boxes' && upcomingOrderData.items) 
                    ? upcomingOrderData.items 
                    : (configToSet.items && Object.keys(configToSet.items).length > 0 ? configToSet.items : null);

                console.log('[ClientProfile] loadData - Items population check', {
                    hasUpcomingOrderItems: !!(upcomingOrderData && upcomingOrderData.items),
                    hasConfigToSetItems: !!(configToSet.items && Object.keys(configToSet.items).length > 0),
                    itemsToPopulateCount: itemsToPopulate ? Object.keys(itemsToPopulate).length : 0,
                    hasBoxOrders: !!(configToSet.boxOrders && configToSet.boxOrders.length > 0),
                    firstBoxItemsCount: configToSet.boxOrders && configToSet.boxOrders.length > 0 ? Object.keys(configToSet.boxOrders[0].items || {}).length : 0
                });

                if (itemsToPopulate && configToSet.boxOrders && configToSet.boxOrders.length > 0) {
                    const firstBox = configToSet.boxOrders[0];
                    // Only populate if vendorId matches (or if no vendorId is set yet, or if items are already in configToSet)
                    const shouldPopulate = !firstBox.vendorId || 
                                          !upcomingOrderData?.vendorId || 
                                          firstBox.vendorId === upcomingOrderData?.vendorId ||
                                          (configToSet.items && Object.keys(configToSet.items).length > 0);

                    if (shouldPopulate) {
                        const populatedItems: any = {};
                        // Extract items and populate them
                        if (typeof itemsToPopulate === 'object' && !Array.isArray(itemsToPopulate)) {
                            for (const [itemId, qty] of Object.entries(itemsToPopulate)) {
                                const upcomingQty = typeof qty === 'number' ? qty : (typeof qty === 'object' && qty && 'quantity' in qty ? (qty as any).quantity : 0);
                                // Populate quantity from upcoming order
                                if (upcomingQty > 0) {
                                    populatedItems[itemId] = upcomingQty;
                                }
                            }
                        }
                        // Only update if there are items to populate and current box doesn't have items
                        if (Object.keys(populatedItems).length > 0) {
                            // Merge with existing items if any, otherwise use populated items
                            const existingItems = firstBox.items || {};
                            if (Object.keys(existingItems).length === 0) {
                                firstBox.items = populatedItems;
                            } else {
                                // Merge: prioritize existing items but add any missing from populated
                                firstBox.items = { ...populatedItems, ...existingItems };
                            }
                            // Update legacy fields
                            configToSet.items = firstBox.items;
                        }
                    }
                }

                // Ensure legacy fields are synced for backward compat/other logic (do this AFTER populating items)
                if (configToSet.boxOrders && configToSet.boxOrders.length > 0) {
                    const firstBox = configToSet.boxOrders[0];
                    configToSet.vendorId = firstBox.vendorId;
                    configToSet.boxTypeId = firstBox.boxTypeId;
                    configToSet.boxQuantity = firstBox.quantity;
                    // Only update configToSet.items if box has items (don't overwrite with empty)
                    if (firstBox.items && Object.keys(firstBox.items).length > 0) {
                        configToSet.items = firstBox.items;
                    }
                }
            }

            // Merge activeOrder items into orderConfig's deliveryDayOrders
            if (activeOrderData && configToSet) {
                configToSet = mergeActiveOrderIntoOrderConfig(configToSet, activeOrderData);
            }

            // Ensure caseId is set in orderConfig if it exists in any source
            if (!configToSet.caseId) {
                if (orderConfig?.caseId) {
                    configToSet.caseId = orderConfig.caseId;
                } else if (c.activeOrder?.caseId) {
                    configToSet.caseId = c.activeOrder.caseId;
                }
            }

            // Final safety check: If Boxes and we have items in configToSet.items but not in boxOrders[0].items, migrate them
            if (c.serviceType === 'Boxes' && configToSet.items && Object.keys(configToSet.items).length > 0) {
                if (configToSet.boxOrders && configToSet.boxOrders.length > 0) {
                    const firstBox = configToSet.boxOrders[0];
                    // If box has no items or empty items, populate from configToSet.items
                    if (!firstBox.items || Object.keys(firstBox.items).length === 0) {
                        console.log('[ClientProfile] loadData - Final safety: Migrating items to boxOrders[0].items', {
                            itemsCount: Object.keys(configToSet.items).length,
                            items: configToSet.items
                        });
                        firstBox.items = { ...configToSet.items };
                    }
                } else {
                    // If boxOrders doesn't exist, create it with items
                    console.log('[ClientProfile] loadData - Final safety: Creating boxOrders with items', {
                        itemsCount: Object.keys(configToSet.items).length
                    });
                    configToSet.boxOrders = [{
                        boxTypeId: configToSet.boxTypeId || '',
                        vendorId: configToSet.vendorId || '',
                        quantity: configToSet.boxQuantity || 1,
                        items: { ...configToSet.items },
                        itemNotes: configToSet.itemNotes || {}
                    }];
                }
            }

            // Fallback: Load box orders from client_box_orders table if no box orders found
            if (c.serviceType === 'Boxes' && (!configToSet.boxOrders || configToSet.boxOrders.length === 0 || 
                (configToSet.boxOrders.length > 0 && !configToSet.boxOrders[0].boxTypeId && !configToSet.boxOrders[0].vendorId && 
                 (!configToSet.boxOrders[0].items || Object.keys(configToSet.boxOrders[0].items).length === 0)))) {
                try {
                    const boxOrdersFromDb = await getClientBoxOrder(clientId);
                    if (boxOrdersFromDb && boxOrdersFromDb.length > 0) {
                        console.log('[ClientProfile] loadData - Loading box orders from client_box_orders table (fallback)', {
                            boxOrdersCount: boxOrdersFromDb.length
                        });
                        
                        // Convert ClientBoxOrder[] to boxOrders format
                        const boxOrders = boxOrdersFromDb.map(bo => ({
                            boxTypeId: bo.boxTypeId || '',
                            vendorId: bo.vendorId || '',
                            quantity: bo.quantity || 1,
                            items: bo.items || {},
                            itemNotes: bo.itemNotes || {},
                            caseId: bo.caseId
                        }));
                        
                        // Merge into configToSet
                        configToSet.boxOrders = boxOrders;
                        
                        // Also sync to legacy fields for backward compat
                        if (boxOrders.length > 0) {
                            const firstBox = boxOrders[0];
                            if (firstBox.vendorId) configToSet.vendorId = firstBox.vendorId;
                            if (firstBox.boxTypeId) configToSet.boxTypeId = firstBox.boxTypeId;
                            if (firstBox.quantity) configToSet.boxQuantity = firstBox.quantity;
                            if (firstBox.items && Object.keys(firstBox.items).length > 0) {
                                configToSet.items = firstBox.items;
                            }
                            if (firstBox.caseId && !configToSet.caseId) {
                                configToSet.caseId = firstBox.caseId;
                            }
                        }
                        
                        console.log('[ClientProfile] loadData - Successfully loaded box orders from database', {
                            boxOrdersCount: boxOrders.length,
                            firstBox: boxOrders[0]
                        });
                    }
                } catch (boxOrderError) {
                    console.error('[ClientProfile] loadData - Error loading box orders from database (fallback):', boxOrderError);
                    // Don't fail the whole load if box orders fail to load
                }
            }

            // Final verification log before setting orderConfig
            if (c.serviceType === 'Boxes' && configToSet.boxOrders && configToSet.boxOrders.length > 0) {
                const firstBox = configToSet.boxOrders[0];
                console.log('[ClientProfile] loadData - Final orderConfig state before setOrderConfig', {
                    hasBoxOrders: true,
                    firstBoxVendorId: firstBox.vendorId,
                    firstBoxBoxTypeId: firstBox.boxTypeId,
                    firstBoxItemsCount: firstBox.items ? Object.keys(firstBox.items).length : 0,
                    firstBoxItems: firstBox.items,
                    configToSetItemsCount: configToSet.items ? Object.keys(configToSet.items).length : 0
                });
            }
            
            setOrderConfig(configToSet);
            setOriginalOrderConfig(JSON.parse(JSON.stringify(configToSet))); // Deep copy for comparison

            // Extract all upcoming orders for display
            const extractedOrders: any[] = [];
            if (upcomingOrderData) {
                // Check if it's the multi-day format (object keyed by delivery day, not deliveryDayOrders)
                const isMultiDayFormat = upcomingOrderData && typeof upcomingOrderData === 'object' &&
                    !upcomingOrderData.serviceType &&
                    !upcomingOrderData.deliveryDayOrders &&
                    Object.keys(upcomingOrderData).some(key => {
                        const val = (upcomingOrderData as any)[key];
                        return val && (val.serviceType || val.id);
                    });

                if (isMultiDayFormat) {
                    // Extract each day's order
                    for (const day of Object.keys(upcomingOrderData)) {
                        const dayOrder = (upcomingOrderData as any)[day];
                        if (dayOrder && (dayOrder.serviceType || dayOrder.id)) {
                            const extractedOrder: any = {
                                ...dayOrder,
                                deliveryDay: day
                            };
                            // For Boxes orders, ensure items are preserved
                            if (dayOrder.serviceType === 'Boxes') {
                                if (dayOrder.items && !extractedOrder.items) {
                                    extractedOrder.items = dayOrder.items;
                                }
                                if (dayOrder.boxOrders && !extractedOrder.boxOrders) {
                                    extractedOrder.boxOrders = dayOrder.boxOrders;
                                }
                                if (dayOrder.vendorId && !extractedOrder.vendorId) {
                                    extractedOrder.vendorId = dayOrder.vendorId;
                                }
                            }
                            extractedOrders.push(extractedOrder);
                        }
                    }
                } else if (upcomingOrderData.deliveryDayOrders && typeof upcomingOrderData.deliveryDayOrders === 'object') {
                    // deliveryDayOrders format - extract orders from each day
                    for (const day of Object.keys(upcomingOrderData.deliveryDayOrders)) {
                        const dayOrder = (upcomingOrderData.deliveryDayOrders as any)[day];
                        if (dayOrder && dayOrder.vendorSelections) {
                            extractedOrders.push({
                                serviceType: upcomingOrderData.serviceType || configToSet?.serviceType,
                                caseId: upcomingOrderData.caseId || configToSet?.caseId,
                                vendorSelections: dayOrder.vendorSelections,
                                deliveryDay: day,
                                id: upcomingOrderData.id
                            });
                        }
                    }
                } else if (upcomingOrderData.serviceType) {
                    // Single order format - ensure items are preserved for Boxes orders
                    const extractedOrder = { ...upcomingOrderData };
                    // For Boxes orders, ensure items are included if they exist
                    if (upcomingOrderData.serviceType === 'Boxes') {
                        // Preserve items from the order
                        if (upcomingOrderData.items && !extractedOrder.items) {
                            extractedOrder.items = upcomingOrderData.items;
                        }
                        // Preserve boxOrders if they exist
                        if (upcomingOrderData.boxOrders && !extractedOrder.boxOrders) {
                            extractedOrder.boxOrders = upcomingOrderData.boxOrders;
                        }
                        // Preserve vendorId if it exists
                        if (upcomingOrderData.vendorId && !extractedOrder.vendorId) {
                            extractedOrder.vendorId = upcomingOrderData.vendorId;
                        }
                    }
                    extractedOrders.push(extractedOrder);
                }
            }
            setAllUpcomingOrders(extractedOrders);
        }
    }


    // -- Logic Helpers --

    /**
     * Merge activeOrder items into orderConfig's deliveryDayOrders
     * This projects updated order items from activeOrder (orders table) into the current order request (orderConfig)
     */
    function mergeActiveOrderIntoOrderConfig(orderConfig: any, activeOrder: any): any {
        if (!activeOrder || !activeOrder.vendorSelections || !Array.isArray(activeOrder.vendorSelections)) {
            return orderConfig;
        }

        // Only merge if orderConfig has deliveryDayOrders structure
        if (!orderConfig.deliveryDayOrders || typeof orderConfig.deliveryDayOrders !== 'object') {
            return orderConfig;
        }

        const mergedConfig = { ...orderConfig };
        mergedConfig.deliveryDayOrders = { ...orderConfig.deliveryDayOrders };

        // For each day in deliveryDayOrders, merge items from activeOrder
        for (const day of Object.keys(mergedConfig.deliveryDayOrders)) {
            const dayOrder = mergedConfig.deliveryDayOrders[day];
            const dayVendorSelections = [...(dayOrder.vendorSelections || [])];

            // For each vendor selection in activeOrder, merge items into the day's vendor selections
            for (const activeVs of activeOrder.vendorSelections) {
                if (!activeVs.vendorId || !activeVs.items) continue;

                // Find matching vendor selection in this day
                const existingVsIndex = dayVendorSelections.findIndex(vs => vs.vendorId === activeVs.vendorId);
                
                if (existingVsIndex >= 0) {
                    // Merge items: combine quantities
                    const existingVs = dayVendorSelections[existingVsIndex];
                    const mergedItems = { ...(existingVs.items || {}) };
                    
                    // Add items from activeOrder, combining quantities
                    for (const [itemId, qty] of Object.entries(activeVs.items)) {
                        const existingQty = mergedItems[itemId] || 0;
                        mergedItems[itemId] = (existingQty as number) + (qty as number);
                    }
                    
                    dayVendorSelections[existingVsIndex] = {
                        ...existingVs,
                        items: mergedItems
                    };
                } else {
                    // Vendor not found in this day, add it
                    dayVendorSelections.push({
                        vendorId: activeVs.vendorId,
                        items: { ...activeVs.items }
                    });
                }
            }

            mergedConfig.deliveryDayOrders[day] = {
                ...dayOrder,
                vendorSelections: dayVendorSelections
            };
        }

        return mergedConfig;
    }

    function getVendorMenuItems(vendorId: string) {
        return menuItems.filter(i => i.vendorId === vendorId && i.isActive);
    }

    /**
     * Parse and normalize box.items - handles JSON strings and object quantity formats
     * Similar logic to SidebarActiveOrderSummary.tsx
     */
    function parseBoxItems(items: any): Record<string, number> {
        if (!items) {
            return {};
        }

        // Handle JSON string format
        let itemsObj = items;
        if (typeof items === 'string') {
            try {
                itemsObj = JSON.parse(items);
            } catch (e) {
                console.error('[ClientProfile] Error parsing box.items as JSON:', e);
                return {};
            }
        }

        // Handle array format
        if (Array.isArray(itemsObj)) {
            const itemsObjFromArray: Record<string, number> = {};
            for (const item of itemsObj) {
                if (item && typeof item === 'object' && 'menu_item_id' in item) {
                    itemsObjFromArray[item.menu_item_id] = item.quantity || 0;
                } else if (item && typeof item === 'object' && 'id' in item) {
                    itemsObjFromArray[item.id] = item.quantity || item.qty || 1;
                }
            }
            itemsObj = itemsObjFromArray;
        }

        // Normalize to Record<string, number> format
        const normalized: Record<string, number> = {};
        if (typeof itemsObj === 'object' && !Array.isArray(itemsObj)) {
            Object.entries(itemsObj).forEach(([itemId, qtyOrObj]) => {
                let q = 0;
                if (typeof qtyOrObj === 'number') {
                    q = qtyOrObj;
                } else if (qtyOrObj && typeof qtyOrObj === 'object' && 'quantity' in qtyOrObj) {
                    q = typeof qtyOrObj.quantity === 'number' ? qtyOrObj.quantity : parseInt(qtyOrObj.quantity) || 0;
                } else {
                    q = parseInt(qtyOrObj as any) || 0;
                }
                if (q > 0) {
                    normalized[itemId] = q;
                }
            });
        }

        return normalized;
    }

    /**
     * Get the total quantity of a menu item from all upcoming orders for a specific vendor
     * This reads from the allUpcomingOrders state which contains orders from upcoming_orders table
     */
    function getUpcomingOrderQuantityForItem(itemId: string, vendorId: string): number {
        let totalQuantity = 0;
        
        if (!allUpcomingOrders || allUpcomingOrders.length === 0 || !vendorId) {
            return 0;
        }

        for (const order of allUpcomingOrders) {
            if (order.serviceType === 'Food' && order.vendorSelections && Array.isArray(order.vendorSelections)) {
                // Find vendor selection for this vendor
                const vendorSelection = order.vendorSelections.find((vs: any) => vs.vendorId === vendorId);
                if (vendorSelection && vendorSelection.items) {
                    // Handle both object format {itemId: quantity} and array format
                    if (typeof vendorSelection.items === 'object' && !Array.isArray(vendorSelection.items)) {
                        const quantity = Number(vendorSelection.items[itemId] || 0);
                        totalQuantity += quantity;
                    }
                }
            } else if (order.serviceType === 'Boxes' && order.vendorId === vendorId) {
                // For boxes, check if the vendor matches and sum items
                // Handle new format: boxOrders array
                if (order.boxOrders && Array.isArray(order.boxOrders)) {
                    for (const box of order.boxOrders) {
                        if (box.vendorId === vendorId && box.items && typeof box.items === 'object' && !Array.isArray(box.items)) {
                            const quantity = Number(box.items[itemId] || 0);
                            totalQuantity += quantity;
                        }
                    }
                }
                // Handle legacy format: items directly on order
                else if (order.items && typeof order.items === 'object' && !Array.isArray(order.items)) {
                    const quantity = Number(order.items[itemId] || 0);
                    totalQuantity += quantity;
                }
            }
        }

        return totalQuantity;
    }

    /**
     * Get the total quantity of a menu item from all upcoming Boxes orders
     * This reads from the allUpcomingOrders state and sums quantities across all Boxes orders
     * Used for Boxes service type where items are vendor-agnostic
     */
    function getUpcomingOrderQuantityForBoxItem(itemId: string, boxVendorId?: string): number {
        let totalQuantity = 0;
        
        if (!allUpcomingOrders || allUpcomingOrders.length === 0) {
            return 0;
        }

        for (const order of allUpcomingOrders) {
            if (order.serviceType === 'Boxes') {
                // Check if boxVendorId filter matches (if provided)
                const orderVendorId = order.vendorId;
                if (boxVendorId && orderVendorId !== boxVendorId) {
                    continue; // Skip if vendor doesn't match
                }

                // Handle new format: boxOrders array
                if (order.boxOrders && Array.isArray(order.boxOrders)) {
                    for (const box of order.boxOrders) {
                        // If boxVendorId is provided, only count items from boxes with matching vendorId
                        if (!boxVendorId || box.vendorId === boxVendorId) {
                            if (box.items && typeof box.items === 'object' && !Array.isArray(box.items)) {
                                const quantity = Number(box.items[itemId] || 0);
                                totalQuantity += quantity;
                            }
                        }
                    }
                }
                // Handle legacy format: items directly on order
                else if (order.items) {
                    if (typeof order.items === 'object' && !Array.isArray(order.items)) {
                        const quantity = Number(order.items[itemId] || 0);
                        totalQuantity += quantity;
                    }
                }
            }
        }

        return totalQuantity;
    }

    function getCurrentOrderTotalValue(day: string | null = null) {
        const selections = getVendorSelectionsForDay(day);
        if (!selections) return 0;
        let total = 0;
        for (const selection of selections) {
            // Handle per-vendor delivery days (itemsByDay)
            if (selection.itemsByDay && selection.selectedDeliveryDays) {
                for (const deliveryDay of selection.selectedDeliveryDays) {
                    const dayItems = selection.itemsByDay[deliveryDay] || {};
                    for (const [itemId, qty] of Object.entries(dayItems)) {
                        const item = menuItems.find(i => i.id === itemId);
                        const itemPrice = item ? item.value : 0;
                        total += itemPrice * (qty as number);
                    }
                }
            } else if (selection.items) {
                // Normal items structure
                for (const [itemId, qty] of Object.entries(selection.items)) {
                    const item = menuItems.find(i => i.id === itemId);
                    const itemPrice = item ? item.value : 0;
                    total += itemPrice * (qty as number);
                }
            }
        }
        return total;
    }

    // Calculate total meals (quantity) for a specific vendor
    function getVendorMealCount(vendorId: string, selection: any): number {
        if (!selection) return 0;

        // Handle per-vendor delivery days (itemsByDay)
        if (selection.itemsByDay && selection.selectedDeliveryDays) {
            let total = 0;
            for (const deliveryDay of selection.selectedDeliveryDays) {
                const dayItems = selection.itemsByDay[deliveryDay] || {};
                total += Object.values(dayItems).reduce((sum: number, qty: any) => sum + (Number(qty) || 0), 0);
            }
            return total;
        }

        // Normal items structure
        if (!selection.items) return 0;
        let total = 0;
        for (const [itemId, qty] of Object.entries(selection.items)) {
            total += (qty as number) || 0;
        }
        return total;
    }

    // Calculate total meals across all vendors (for a specific day or all days)
    function getTotalMealCount(day: string | null = null): number {
        const selections = getVendorSelectionsForDay(day);
        if (!selections) return 0;
        let total = 0;
        for (const selection of selections) {
            // Handle per-vendor delivery days (itemsByDay)
            if (selection.itemsByDay && selection.selectedDeliveryDays) {
                for (const deliveryDay of selection.selectedDeliveryDays) {
                    const dayItems = selection.itemsByDay[deliveryDay] || {};
                    total += Object.values(dayItems).reduce((sum: number, qty: any) => sum + (Number(qty) || 0), 0);
                }
            } else {
                total += getVendorMealCount(selection.vendorId, selection);
            }
        }
        return total;
    }

    // Get total meals across all delivery days (handles both formats)
    function getTotalMealCountAllDays(): number {
        // Check for per-vendor delivery days format
        const currentSelections = getVendorSelectionsForDay(null);
        let total = 0;

        for (const selection of currentSelections || []) {
            if (selection.itemsByDay && selection.selectedDeliveryDays) {
                // Per-vendor delivery days format
                for (const day of selection.selectedDeliveryDays) {
                    const dayItems = selection.itemsByDay[day] || {};
                    total += Object.values(dayItems).reduce((sum: number, qty: any) => sum + (Number(qty) || 0), 0);
                }
            } else if (selection.items) {
                // Normal single-day format
                total += getVendorMealCount(selection.vendorId, selection);
            }
        }

        // Also check deliveryDayOrders format (for saved data)
        if (orderConfig.deliveryDayOrders) {
            for (const day of Object.keys(orderConfig.deliveryDayOrders)) {
                total += getTotalMealCount(day);
            }
        }

        return total;
    }

    // Get total value across all delivery days (handles both formats)
    function getCurrentOrderTotalValueAllDays(): number {
        // Check for per-vendor delivery days format
        const currentSelections = getVendorSelectionsForDay(null);
        let total = 0;

        for (const selection of currentSelections || []) {
            if (selection.itemsByDay && selection.selectedDeliveryDays) {
                // Per-vendor delivery days format
                for (const day of selection.selectedDeliveryDays) {
                    const dayItems = selection.itemsByDay[day] || {};
                    for (const [itemId, qty] of Object.entries(dayItems)) {
                        const item = menuItems.find(i => i.id === itemId);
                        const itemPrice = item ? item.value : 0;
                        total += itemPrice * (qty as number);
                    }
                }
            } else if (selection.items) {
                // Normal single-day format
                for (const [itemId, qty] of Object.entries(selection.items)) {
                    const item = menuItems.find(i => i.id === itemId);
                    const itemPrice = item ? item.value : 0;
                    total += itemPrice * (qty as number);
                }
            }
        }

        // Also check deliveryDayOrders format (for saved data)
        if (orderConfig.deliveryDayOrders) {
            for (const day of Object.keys(orderConfig.deliveryDayOrders)) {
                total += getCurrentOrderTotalValue(day);
            }
        }

        return total;
    }

    /**
     * Get the next delivery date for a vendor (wrapper for centralized function)
     */
    function getNextDeliveryDateObject(vendorId: string): Date | null {
        return getNextDeliveryDateUtil(vendorId, vendors);
    }

    /**
     * Get all delivery dates for the order (for weekly locking validation)
     * Uses centralized function from order-dates.ts
     */
    function getAllDeliveryDatesForOrderLocal(): Date[] {
        if (!orderConfig || !orderConfig.caseId || !formData.serviceType) return [];
        return getAllDeliveryDatesForOrder(orderConfig, vendors, formData.serviceType as "Food" | "Boxes");
    }

    /**
     * Get the earliest delivery date across all vendors in the order
     */
    function getEarliestDeliveryDateForOrder(): Date | null {
        const deliveryDates = getAllDeliveryDatesForOrderLocal();
        if (deliveryDates.length === 0) return null;
        return new Date(Math.min(...deliveryDates.map(d => d.getTime())));
    }

    /**
     * Get the earliest effective date for order changes.
     * Uses weekly locking logic - always returns a Sunday.
     */
    function getEarliestTakeEffectDateForOrder(): Date | null {
        if (!orderConfig || !orderConfig.caseId) return null;
        if (!settings) return null;

        // Use centralized function from order-dates.ts which uses weekly locking logic
        return getTakeEffectDate(settings);
    }

    /**
     * Check if any deliveries in the order are locked due to weekly cutoff.
     * Uses weekly locking logic: if any delivery in a week is locked, all deliveries in that week are locked.
     */
    function isCutoffPassed(): boolean {
        if (!settings) return false;
        if (!orderConfig || !orderConfig.caseId) return false;

        const deliveryDates = getAllDeliveryDatesForOrderLocal();
        if (deliveryDates.length === 0) return false;

        // Use weekly locking logic to check if any deliveries are locked
        return areAnyDeliveriesLocked(deliveryDates, settings);
    }

    function getBoxItemsTotal(): number {
        if (!orderConfig.items) return 0;
        let total = 0;
        for (const [itemId, qty] of Object.entries(orderConfig.items)) {
            const item = menuItems.find(i => i.id === itemId);
            const itemPrice = item ? (item.priceEach ?? item.value) : 0;
            total += itemPrice * (qty as number);
        }
        return total;
    }

    // Helper functions for displaying order info
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

            const itemDetails = Object.entries(conf.items || {}).map(([id, qty]) => {
                const item = menuItems.find(i => i.id === id);
                return item ? `${item.name} x${qty}` : null;
            }).filter(Boolean).join(', ');

            const itemSuffix = itemDetails ? ` (${itemDetails})` : '';
            content = `: ${vendorName}${itemSuffix}`;
        }

        return `${st}${content}`;
    }

    function getStatusName(id: string) {
        return statuses.find(s => s.id === id)?.name || 'Unknown';
    }

    function getNavigatorName(id: string) {
        return navigators.find(n => n.id === id)?.name || 'Unassigned';
    }

    // Get the next delivery date for a vendor (first occurrence)
    // Function that returns formatted delivery date (for display)
    function getNextDeliveryDate(vendorId: string): { dayOfWeek: string; date: string } | null {
        const deliveryDate = getNextDeliveryDateUtil(vendorId, vendors);
        if (!deliveryDate) return null;

        return {
            dayOfWeek: deliveryDate.toLocaleDateString('en-US', { weekday: 'long' }),
            date: deliveryDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
        };
    }

    function getNextDeliveryDateForVendor(vendorId: string): string | null {
        const deliveryDate = getNextDeliveryDateUtil(vendorId, vendors);
        if (!deliveryDate) return null;

        // Return formatted as full date string
        return formatDeliveryDate(deliveryDate);
    }

    // Box Logic Helpers
    function getBoxValidationSummary() {
        // No quota validation needed - removed box types
        // Users can select any items they want without quota requirements
        return { isValid: true, messages: [] };
    }

    function validateOrder(): { isValid: boolean, messages: string[] } {
        if (formData.serviceType === 'Food') {
            const messages: string[] = [];

            // Check total order value against approved meals per week
            const totalValue = getCurrentOrderTotalValueAllDays();
            const approvedMeals = formData.approvedMealsPerWeek || 0;
            if (approvedMeals > 0 && totalValue > approvedMeals) {
                messages.push(`Total order value (${totalValue}) exceeds approved meals per week (${approvedMeals}).`);
            }

            // Check each vendor meets their minimum requirement (across all delivery days)
            if (orderConfig.deliveryDayOrders) {
                // Multi-day format
                for (const day of Object.keys(orderConfig.deliveryDayOrders)) {
                    const daySelections = orderConfig.deliveryDayOrders[day].vendorSelections || [];
                    for (const selection of daySelections) {
                        if (!selection.vendorId) continue;

                        const vendor = vendors.find(v => v.id === selection.vendorId);
                        if (!vendor) continue;

                        const vendorMinimum = vendor.minimumMeals || 0;
                        if (vendorMinimum > 0) {
                            const vendorMealCount = getVendorMealCount(selection.vendorId, selection);
                            if (vendorMealCount < vendorMinimum) {
                                messages.push(`${vendor.name} (${day}): ${vendorMealCount} meals selected, but minimum is ${vendorMinimum}.`);
                            }
                        }
                    }
                }
            } else if (orderConfig.vendorSelections) {
                // Single day format
                for (const selection of orderConfig.vendorSelections) {
                    if (!selection.vendorId) continue;

                    const vendor = vendors.find(v => v.id === selection.vendorId);
                    if (!vendor) continue;

                    const vendorMinimum = vendor.minimumMeals || 0;
                    if (vendorMinimum > 0) {
                        const vendorMealCount = getVendorMealCount(selection.vendorId, selection);
                        if (vendorMealCount < vendorMinimum) {
                            messages.push(`${vendor.name}: ${vendorMealCount} meals selected, but minimum is ${vendorMinimum}.`);
                        }
                    }
                }
            }

            if (messages.length > 0) {
                return { isValid: false, messages };
            }
        }

        if (formData.serviceType === 'Boxes') {
            const messages: string[] = [];

            // Validate each box has a vendorId
            if (orderConfig.boxOrders && Array.isArray(orderConfig.boxOrders) && orderConfig.boxOrders.length > 0) {
                orderConfig.boxOrders.forEach((box: any, index: number) => {
                    const boxVendorId = box.vendorId;
                    const boxType = boxTypes.find(bt => bt.id === box.boxTypeId);
                    const computedVendorId = boxVendorId || boxType?.vendorId;

                    if (!computedVendorId || computedVendorId.trim() === '') {
                        messages.push(`Box #${index + 1}: Vendor is required. Please select a vendor for this box.`);
                    }
                });
            } else if (orderConfig.vendorId) {
                // Legacy format: validate top-level vendorId
                if (!orderConfig.vendorId || orderConfig.vendorId.trim() === '') {
                    const boxType = boxTypes.find(bt => bt.id === orderConfig.boxTypeId);
                    if (!boxType?.vendorId) {
                        messages.push('Vendor is required. Please select a vendor for the box order.');
                    }
                }
            } else {
                // No boxOrders and no vendorId - check if boxType has vendorId
                const boxType = boxTypes.find(bt => bt.id === orderConfig.boxTypeId);
                if (!boxType?.vendorId) {
                    messages.push('Vendor is required. Please select a vendor for the box order.');
                }
            }

            // Get items from either boxOrders array or legacy items field
            // Priority: boxOrders (new format) > items (legacy format)
            let itemsToValidate: { [itemId: string]: number } = {};
            let boxTypeIdToValidate: string | undefined;
            let boxQuantityToValidate: number = 1;

            if (orderConfig.boxOrders && Array.isArray(orderConfig.boxOrders) && orderConfig.boxOrders.length > 0) {
                // New format: aggregate items from all boxes in boxOrders array
                const firstBox = orderConfig.boxOrders[0];
                boxTypeIdToValidate = firstBox.boxTypeId;
                // Calculate total number of boxes by summing quantities from all boxes
                boxQuantityToValidate = orderConfig.boxOrders.reduce((total: number, box: any) => {
                    return total + (box.quantity || 1);
                }, 0);
                
                // Merge items from all boxes
                orderConfig.boxOrders.forEach((box: any) => {
                    const boxItems = box.items || {};
                    Object.entries(boxItems).forEach(([itemId, qty]) => {
                        itemsToValidate[itemId] = (itemsToValidate[itemId] || 0) + (qty as number);
                    });
                });
            } else if (orderConfig.items) {
                // Legacy format: use items and boxTypeId from top level
                itemsToValidate = orderConfig.items || {};
                boxTypeIdToValidate = orderConfig.boxTypeId;
                boxQuantityToValidate = orderConfig.boxQuantity || 1;
            }

            // Validate box category quotas - each category must have exactly the required quota value
            if (boxTypeIdToValidate && boxQuotas.length > 0 && Object.keys(itemsToValidate).length > 0) {
                // Check each quota requirement
                for (const quota of boxQuotas) {
                    // Calculate total quota value for this category
                    let categoryQuotaValue = 0;

                    // Sum up (item quantity * item quotaValue) for all items in this category
                    for (const [itemId, qty] of Object.entries(itemsToValidate)) {
                        const item = menuItems.find(i => i.id === itemId);
                        if (item && item.categoryId === quota.categoryId) {
                            const itemQuotaValue = item.quotaValue || 1;
                            categoryQuotaValue += (qty as number) * itemQuotaValue;
                        }
                    }

                    // Calculate required quota value (targetValue * boxQuantity)
                    const requiredQuotaValue = quota.targetValue * boxQuantityToValidate;

                    // Check if it matches exactly
                    if (categoryQuotaValue !== requiredQuotaValue) {
                        const category = categories.find(c => c.id === quota.categoryId);
                        const categoryName = category?.name || 'Unknown Category';
                        messages.push(
                            `Category "${categoryName}" requires exactly ${requiredQuotaValue} quota value, but you have ${categoryQuotaValue}. ` +
                            `Please adjust items in this category to match exactly.`
                        );
                    }
                }
            }

            // Validate category set values - categories with setValue must have exactly that quota value
            // For Boxes serviceType, setValue must be multiplied by the number of boxes
            if (Object.keys(itemsToValidate).length > 0) {
                // Check each category that has a setValue
                for (const category of categories) {
                    if (category.setValue !== undefined && category.setValue !== null) {
                        // Calculate total quota value for this category
                        let categoryQuotaValue = 0;

                        // Sum up (item quantity * item quotaValue) for all items in this category
                        for (const [itemId, qty] of Object.entries(itemsToValidate)) {
                            const item = menuItems.find(i => i.id === itemId);
                            if (item && item.categoryId === category.id) {
                                const itemQuotaValue = item.quotaValue || 1;
                                categoryQuotaValue += (qty as number) * itemQuotaValue;
                            }
                        }

                        // For Boxes serviceType, multiply setValue by the number of boxes
                        // This supports multiple boxes where each box needs to meet the setValue requirement
                        const requiredSetValue = formData.serviceType === 'Boxes' 
                            ? category.setValue * boxQuantityToValidate 
                            : category.setValue;

                        // Check if it matches exactly the required setValue
                        if (categoryQuotaValue !== requiredSetValue) {
                            messages.push(
                                `You must have a total of ${requiredSetValue} ${category.name} points, but you have ${categoryQuotaValue}. ` +
                                `Please adjust items in this category to match exactly.`
                            );
                        }
                    }
                }
            }

            if (messages.length > 0) {
                return { isValid: false, messages };
            }

            return { isValid: true, messages: [] };
        }

        if (formData.serviceType === 'Boxes') {
            const messages: string[] = [];
            const boxOrders = orderConfig.boxOrders || [];

            // Validate each box has a vendorId
            boxOrders.forEach((box: any, index: number) => {
                const boxVendorId = box.vendorId;
                const boxType = boxTypes.find(bt => bt.id === box.boxTypeId);
                const computedVendorId = boxVendorId || boxType?.vendorId;

                if (!computedVendorId || computedVendorId.trim() === '') {
                    messages.push(`Box #${index + 1}: Vendor is required. Please select a vendor for this box.`);
                }
            });

            if (messages.length > 0) {
                return { isValid: false, messages };
            }
        }

        if (formData.serviceType === 'Custom') {
            const messages: string[] = [];

            // Validate vendor is selected
            if (!orderConfig.vendorId || orderConfig.vendorId.trim() === '') {
                messages.push('Please select a vendor for the custom order.');
            }

            // Validate custom items exist
            const customItems = orderConfig.customItems || [];
            if (customItems.length === 0) {
                messages.push('Please add at least one custom item to the order.');
            } else {
                // Validate each custom item has name, price, and quantity
                customItems.forEach((item: any, index: number) => {
                    if (!item.name || item.name.trim() === '') {
                        messages.push(`Custom item ${index + 1}: Item name is required.`);
                    }
                    const price = parseFloat(item.price);
                    if (isNaN(price) || price <= 0) {
                        messages.push(`Custom item ${index + 1}: Valid price greater than 0 is required.`);
                    }
                    const quantity = parseInt(item.quantity);
                    if (isNaN(quantity) || quantity < 1) {
                        messages.push(`Custom item ${index + 1}: Valid quantity of at least 1 is required.`);
                    }
                });
            }

            if (messages.length > 0) {
                return { isValid: false, messages };
            }
        }

        return { isValid: true, messages: [] };
    }

    // --- Box Order Helpers (Multi-Box Support) ---

    function handleAddBox() {
        const currentBoxes = orderConfig.boxOrders || [];
        const limit = formData.authorizedAmount;
        if (limit && currentBoxes.length >= limit) return;

        const firstActiveBoxType = boxTypes.find(bt => bt.isActive);
        // Get default vendor for Boxes service if boxType doesn't have one
        const defaultVendorId = getDefaultVendor('Boxes');
        const newBox = {
            boxTypeId: firstActiveBoxType?.id || '',
            vendorId: firstActiveBoxType?.vendorId || defaultVendorId || '',
            quantity: 1,
            items: {}
        };
        const updatedBoxes = [...currentBoxes, newBox];
        // CRITICAL FIX: Always sync top-level vendorId from the first box's vendorId
        // If this is the first box, use its vendorId; otherwise keep existing first box's vendorId
        const updatedVendorId = currentBoxes.length === 0 ? newBox.vendorId : (currentBoxes[0]?.vendorId || orderConfig.vendorId || defaultVendorId || '');
        setOrderConfig({
            ...orderConfig,
            boxOrders: updatedBoxes,
            vendorId: updatedVendorId
        });
    }

    function handleRemoveBox(index: number) {
        const currentBoxes = [...(orderConfig.boxOrders || [])];
        if (currentBoxes.length <= 1) {
            // If removing the last one, just reset it to empty/default instead of removing
            const firstActiveBoxType = boxTypes.find(bt => bt.isActive);
            // Get default vendor for Boxes service if boxType doesn't have one
            const defaultVendorId = getDefaultVendor('Boxes');
            const resetBox = {
                boxTypeId: firstActiveBoxType?.id || '',
                vendorId: firstActiveBoxType?.vendorId || defaultVendorId || '',
                quantity: 1,
                items: {}
            };
            setOrderConfig({
                ...orderConfig,
                boxOrders: [resetBox],
                vendorId: resetBox.vendorId // CRITICAL FIX: Sync top-level vendorId
            });
            return;
        }
        currentBoxes.splice(index, 1);
        // CRITICAL FIX: Always sync top-level vendorId from the first box's vendorId
        const updatedVendorId = currentBoxes.length > 0 && currentBoxes[0].vendorId ? currentBoxes[0].vendorId : orderConfig.vendorId;
        setOrderConfig({ ...orderConfig, boxOrders: currentBoxes, vendorId: updatedVendorId });
    }

    function handleBoxUpdate(index: number, field: string, value: any) {
        const currentBoxes = [...(orderConfig.boxOrders || [])];
        if (!currentBoxes[index]) return;

        // If updating vendorId and value is empty, set default vendor
        if (field === 'vendorId') {
            if (!value || value.trim() === '') {
                const defaultVendorId = getDefaultVendor('Boxes');
                if (defaultVendorId) {
                    value = defaultVendorId;
                }
            }
        }

        currentBoxes[index] = { ...currentBoxes[index], [field]: value };

        // Logic to sync vendor/boxType dependencies
        if (field === 'vendorId') {
            // When vendor changes, try to find a box type for this vendor
            const validBoxType = boxTypes.find(bt => bt.isActive && bt.vendorId === value);
            if (validBoxType) {
                currentBoxes[index].boxTypeId = validBoxType.id;
            }
            
            // CRITICAL FIX: Always sync top-level vendorId from the first box's vendorId
            // This ensures vendor ID is always available for saving to upcoming_orders
            if (currentBoxes.length > 0 && currentBoxes[0].vendorId) {
                const updatedConfig = { ...orderConfig, boxOrders: currentBoxes, vendorId: currentBoxes[0].vendorId };
                setOrderConfig(updatedConfig);
                return;
            }
        }

        setOrderConfig({ ...orderConfig, boxOrders: currentBoxes });
    }

    function handleBoxItemUpdate(boxIndex: number, itemId: string, quantity: number, note?: string) {
        const currentBoxes = [...(orderConfig.boxOrders || [])];
        if (!currentBoxes[boxIndex]) return;

        const currentItems = { ...(currentBoxes[boxIndex].items || {}) };
        const currentNotes = { ...(currentBoxes[boxIndex].itemNotes || {}) };

        if (quantity > 0) {
            currentItems[itemId] = quantity;
            if (note !== undefined) {
                if (note) {
                    currentNotes[itemId] = note;
                } else {
                    delete currentNotes[itemId];
                }
            }
        } else {
            delete currentItems[itemId];
            delete currentNotes[itemId];
        }
        currentBoxes[boxIndex].items = currentItems;
        currentBoxes[boxIndex].itemNotes = currentNotes;
        setOrderConfig({ ...orderConfig, boxOrders: currentBoxes });
    }

    // Legacy function for backward compatibility
    function handleBoxItemChange(itemId: string, qty: number) {
        // If boxOrders exists, update the first box
        if (orderConfig.boxOrders && orderConfig.boxOrders.length > 0) {
            handleBoxItemUpdate(0, itemId, qty);
        } else {
            // Fallback to legacy items structure
            const currentItems = { ...(orderConfig.items || {}) };
            if (qty > 0) {
                currentItems[itemId] = qty;
            } else {
                delete currentItems[itemId];
            }
            setOrderConfig({ ...orderConfig, items: currentItems });
        }
    }

    async function handleDelete() {
        setSaving(true);
        await deleteClient(clientId);
        setSaving(false);
        setShowDeleteModal(false);

        if (onClose) {
            onClose();
        } else {
            router.push('/clients');
        }
    }

    // Old handleSave removed


    async function handleBack() {
        // If used as a page (not modal), we want to try to save before leaving.
        // If validation fails, handleSave will return false and show the error modal.
        // The user effectively stays on the page.
        if (onClose) {
            await handleSaveAndClose();
        } else {
            const saved = await handleSave();
            if (saved) {
                router.push('/clients');
            }
        }
    }

    function handleDiscardChanges() {
        setValidationError({ show: false, messages: [] });
        // Discarding means we just exit without saving
        if (onClose) {
            onClose();
        } else {
            router.push('/clients');
        }
    }

    // -- Event Handlers --

    function handleServiceChange(type: ServiceType) {
        if (formData.serviceType === type) return;

        // Check if there is existing configuration to warn about
        const hasConfig = orderConfig.caseId ||
            orderConfig.vendorSelections?.some((s: any) => s.vendorId) ||
            orderConfig.vendorId;

        if (hasConfig) {
            const confirmSwitch = window.confirm(
                'Switching service types will erase the current service configuration. Are you sure you want to proceed?'
            );
            if (!confirmSwitch) return;
        }

        setFormData({ ...formData, serviceType: type });
        // Reset order config for new type completely, ensuring caseId is reset too
        // The user must enter a NEW case ID for the new service type.
        if (type === 'Food') {
            const defaultVendorId = getDefaultVendor('Food');
            setOrderConfig({ serviceType: type, vendorSelections: [{ vendorId: defaultVendorId || '', items: {} }] });
        } else if (type === 'Custom') {
            setOrderConfig({ serviceType: type, vendorId: '', customItems: [] });
        } else {
            setOrderConfig({ serviceType: type, items: {} });
        }
    }

    // Helper: Get all delivery days from selected vendors
    function getAllDeliveryDaysFromVendors(vendorSelections: any[]): string[] {
        const allDays = new Set<string>();
        for (const selection of vendorSelections || []) {
            if (selection.vendorId) {
                const vendor = vendors.find(v => v.id === selection.vendorId);
                if (vendor && vendor.deliveryDays) {
                    vendor.deliveryDays.forEach(day => allDays.add(day));
                }
            }
        }
        return Array.from(allDays).sort();
    }

    // Helper: Check if we need multi-day format (any vendor has multiple delivery days)
    function needsMultiDayFormat(vendorSelections: any[]): boolean {
        for (const selection of vendorSelections || []) {
            if (selection.vendorId) {
                const vendor = vendors.find(v => v.id === selection.vendorId);
                if (vendor && vendor.deliveryDays && vendor.deliveryDays.length > 1) {
                    return true;
                }
            }
        }
        return false;
    }

    // Helper: Get vendor selections for a specific delivery day (or all if single day)
    function getVendorSelectionsForDay(day: string | null): any[] {
        if (!orderConfig.deliveryDayOrders) {
            const selections = orderConfig.vendorSelections || [];

            return selections;
        }
        if (day && orderConfig.deliveryDayOrders[day]) {
            return orderConfig.deliveryDayOrders[day].vendorSelections || [];
        }
        return [];
    }

    // Helper: Update vendor selections for a specific delivery day
    function setVendorSelectionsForDay(day: string | null, vendorSelections: any[]) {
        // Ensure empty vendor selections get default vendor set
        const defaultVendorId = getDefaultVendor('Food');
        const ensuredSelections = vendorSelections.map(sel => {
            if (!sel.vendorId || sel.vendorId.trim() === '') {
                return { ...sel, vendorId: defaultVendorId || '' };
            }
            return sel;
        });

        // Check if we're already in multi-day format
        if (orderConfig.deliveryDayOrders) {
            // Multi-day format - update specific day
            const deliveryDayOrders = { ...orderConfig.deliveryDayOrders };
            if (day) {
                deliveryDayOrders[day] = { vendorSelections: ensuredSelections };
            } else {
                // Updating consolidated view (null day)
                // Reconstruct deliveryDayOrders from the consolidated list
                const allDays = Object.keys(deliveryDayOrders);
                // Initialize empty to rebuild
                allDays.forEach(d => deliveryDayOrders[d] = { vendorSelections: [] });

                // Distribute consolidated selections back to days
                ensuredSelections.forEach(vSel => {
                    const daysToPopulate = (vSel.selectedDeliveryDays && vSel.selectedDeliveryDays.length > 0)
                        ? vSel.selectedDeliveryDays
                        : (allDays.length > 0 ? [allDays[0]] : []);

                    daysToPopulate.forEach((d: string) => {
                        if (!deliveryDayOrders[d]) deliveryDayOrders[d] = { vendorSelections: [] };

                        const items = vSel.itemsByDay ? (vSel.itemsByDay[d] || {}) : (vSel.items || {});

                        deliveryDayOrders[d].vendorSelections.push({
                            vendorId: vSel.vendorId,
                            items: items
                        });
                    });
                });
            }
            setOrderConfig({ ...orderConfig, deliveryDayOrders });
        } else if (day && needsMultiDayFormat(ensuredSelections)) {
            // Need to switch to multi-day format
            const allDays = getAllDeliveryDaysFromVendors(ensuredSelections);
            const deliveryDayOrders: any = {};
            for (const deliveryDay of allDays) {
                deliveryDayOrders[deliveryDay] = {
                    vendorSelections: ensuredSelections
                        .filter(sel => {
                            if (!sel.vendorId) return true; // Keep empty slots
                            const vendor = vendors.find(v => v.id === sel.vendorId);
                            return vendor && vendor.deliveryDays && vendor.deliveryDays.includes(deliveryDay);
                        })
                        .map(sel => ({ ...sel }))
                };
            }
            setOrderConfig({ ...orderConfig, deliveryDayOrders, vendorSelections: undefined });
        } else {
            // Single day format
            setOrderConfig({ ...orderConfig, vendorSelections: ensuredSelections });
        }
    }

    // Handler for caseIdExternal (UniteUs URL) changes
    function handleCaseIdExternalChange(e: React.ChangeEvent<HTMLInputElement>) {
        const url = e.target.value;
        setFormData({ ...formData, caseIdExternal: url });
        
        if (!url || !url.trim()) {
            setCaseIdExternalError("");
            return;
        }
        
        const parsed = parseUniteUsUrl(url);
        if (!parsed) {
            setCaseIdExternalError("Must match /cases/open/{caseId}/contact/{clientId}");
            return;
        }
        
        setCaseIdExternalError("");
    }

    function addVendorBlock(day: string | null = null) {
        // Get default vendor for Food service
        const defaultVendorId = formData.serviceType === 'Food' ? getDefaultVendor('Food') : null;
        
        // Handling for multi-day format when adding to "consolidated" list (day is null)
        if (day === null && orderConfig.deliveryDayOrders) {
            const days = Object.keys(orderConfig.deliveryDayOrders).sort();
            if (days.length > 0) {
                // Add blank entry to the first available day so it gets picked up by the consolidated view
                const firstDay = days[0];
                const currentDaySelections = orderConfig.deliveryDayOrders[firstDay].vendorSelections || [];
                // Only add if there isn't already a blank one (to prevent duplicates in consolidated view)
                const hasBlank = currentDaySelections.some((s: any) => !s.vendorId);
                if (!hasBlank) {
                    const newVendorSelection = defaultVendorId 
                        ? { vendorId: defaultVendorId, items: {} }
                        : { vendorId: '', items: {} };
                    const newDaySelections = [...currentDaySelections, newVendorSelection];
                    setVendorSelectionsForDay(firstDay, newDaySelections);
                }
                return;
            }
        }

        const currentSelections = getVendorSelectionsForDay(day);
        const newVendorSelection = defaultVendorId 
            ? { vendorId: defaultVendorId, items: {} }
            : { vendorId: '', items: {} };
        const newSelections = [...currentSelections, newVendorSelection];
        setVendorSelectionsForDay(day, newSelections);
    }

    function removeVendorBlock(index: number, day: string | null = null) {
        const current = [...getVendorSelectionsForDay(day)];
        current.splice(index, 1);
        setVendorSelectionsForDay(day, current);
    }

    function updateVendorSelection(index: number, field: string, value: any, day: string | null = null) {
        const current = [...getVendorSelectionsForDay(day)];
        
        // If changing vendor and value is empty, set default vendor
        if (field === 'vendorId') {
            if (!value || value.trim() === '') {
                const defaultVendorId = getDefaultVendor('Food');
                if (defaultVendorId) {
                    value = defaultVendorId;
                }
            }
            current[index] = { ...current[index], [field]: value, items: {} };

            // If we're in single-day format and the vendor has multiple delivery days,
            // we'll show the selection UI (handled in render), but don't auto-switch format
            // The user will select which days they want, then we'll create orders for those days
        } else {
            current[index] = { ...current[index], [field]: value };
        }

        // Normal update
        setVendorSelectionsForDay(day, current);
    }

    function updateItemQuantity(blockIndex: number, itemId: string, qty: number, day: string | null = null) {
        const current = [...getVendorSelectionsForDay(day)];
        const items = { ...(current[blockIndex].items || {}) };
        if (qty > 0) {
            items[itemId] = qty;
        } else {
            delete items[itemId];
        }
        current[blockIndex].items = items;
        setVendorSelectionsForDay(day, current);
    }

    // -- Form Filler Handlers --
    async function handleOpenScreeningForm() {
        setLoadingForm(true);
        try {
            const response = await getSingleForm();
            if (response.success && response.data) {
                setFormSchema(response.data);
                setIsFillingForm(true);
            } else {
                alert('No Screening Form configured.');
            }
        } catch (error) {
            console.error('Failed to load form:', error);
            alert('Failed to load form. Please try again.');
        } finally {
            setLoadingForm(false);
        }
    }

    function handleCloseScreeningForm() {
        setIsFillingForm(false);
        setFormSchema(null);
    }

    async function handleSaveAndClose() {
        const saved = await handleSave();
        if (saved && onClose) {
            onClose();
        }
    }

    async function handleCreateDependent() {
        if (!dependentName.trim() || !client?.id) return;

        setCreatingDependent(true);
        try {
            const dobValue = dependentDob.trim() || null;
            const cinValue = dependentCin.trim() ? parseFloat(dependentCin.trim()) : null;
            const newDependent = await addDependent(dependentName.trim(), client.id, dobValue, cinValue);
            if (newDependent) {
                // Refresh dependents list
                const dependentsData = await getDependentsByParentId(client.id);
                setDependents(dependentsData);
                // Reset form
                setDependentName('');
                setDependentDob('');
                setDependentCin('');
                setShowAddDependentForm(false);
                // Invalidate cache to refresh list in parent component
                invalidateClientData();
            }
        } catch (error) {
            console.error('Error creating dependent:', error);
            alert(error instanceof Error ? error.message : 'Failed to create dependent');
        } finally {
            setCreatingDependent(false);
        }
    }

    const isDependent = !!client?.parentClientId;
    const filteredRegularClients = regularClients.filter(c =>
        c.fullName.toLowerCase().includes(parentClientSearch.toLowerCase()) && c.id !== clientId
    );
    const selectedParentClient = formData.parentClientId ? regularClients.find(c => c.id === formData.parentClientId) : null;

    function getContent() {
        return (
            <div className={`${styles.container} ${onClose ? styles.inModal : ''}`}>
                <header className={styles.header}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            {onClose ? (
                                <button className="btn btn-secondary" onClick={handleDiscardChanges} style={{ marginRight: '8px' }}>
                                    <ArrowLeft size={16} /> Back
                                </button>
                            ) : (
                                <button className="btn btn-secondary" onClick={handleDiscardChanges} style={{ marginRight: '8px' }}>
                                    <ArrowLeft size={16} /> Back
                                </button>
                            )}
                            <h1 className={styles.title}>{formData.fullName || (isDependent ? 'Dependent Profile' : 'Client Profile')}</h1>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            {!isDependent && (
                                <>
                                    <button
                                        className="btn btn-secondary"
                                        onClick={handleCopySignatureLink}
                                        title={`Signature Link (${signatureCollected}/5 collected)`}
                                        style={{ marginRight: '8px' }}
                                    >
                                        {isCopyingLink ? (
                                            <>
                                                <Check size={16} /> Copied!
                                            </>
                                        ) : (
                                            <>
                                                <PenTool size={16} /> Signature {signatureCollected > 0 && `(${signatureCollected}/5)`}
                                            </>
                                        )}
                                    </button>
                                    {signatureLink && (
                                        <a
                                            href={signatureLink + '/view'}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="btn btn-secondary"
                                            style={{ marginRight: '8px' }}
                                            title="View collected signatures"
                                        >
                                            <ExternalLink size={16} /> View
                                        </a>
                                    )}
                                </>
                            )}
                            <button
                                className={`btn ${styles.deleteButton}`}
                                onClick={() => setShowDeleteModal(true)}
                                style={{ marginRight: '8px' }}
                            >
                                <Trash2 size={16} /> Delete {isDependent ? 'Dependent' : 'Client'}
                            </button>
                            {!onClose && (
                                <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
                                    <Save size={16} /> Save Changes
                                </button>
                            )}
                        </div>
                    </div>
                </header>

                {isDependent ? (
                    // Simplified view for dependents
                    <div className={styles.grid}>
                        <div className={styles.column}>
                            <section className={styles.card}>
                                <h3 className={styles.sectionTitle}>Dependent Details</h3>

                                <div className={styles.formGroup}>
                                    <label className="label">Dependent Name</label>
                                    <input className="input" value={formData.fullName || ''} onChange={e => setFormData({ ...formData, fullName: e.target.value })} />
                                </div>

                                <div className={styles.formGroup}>
                                    <label className="label">Date of Birth</label>
                                    <input 
                                        type="date" 
                                        className="input" 
                                        value={formData.dob || ''} 
                                        onChange={e => setFormData({ ...formData, dob: e.target.value || null })} 
                                    />
                                </div>

                                <div className={styles.formGroup}>
                                    <label className="label">CIN#</label>
                                    <input 
                                        type="number" 
                                        className="input" 
                                        placeholder="CIN Number"
                                        value={formData.cin || ''} 
                                        onChange={e => setFormData({ ...formData, cin: e.target.value ? parseFloat(e.target.value) : null })} 
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
                                                filteredRegularClients.map(c => (
                                                    <div
                                                        key={c.id}
                                                        onClick={() => {
                                                            setFormData({ ...formData, parentClientId: c.id });
                                                            setParentClientSearch(c.fullName);
                                                        }}
                                                        style={{
                                                            padding: '0.75rem',
                                                            cursor: 'pointer',
                                                            backgroundColor: formData.parentClientId === c.id ? 'var(--bg-surface-hover)' : 'transparent',
                                                            borderBottom: '1px solid var(--border-color)',
                                                            transition: 'background-color 0.2s'
                                                        }}
                                                        onMouseEnter={(e) => {
                                                            if (formData.parentClientId !== c.id) {
                                                                e.currentTarget.style.backgroundColor = 'var(--bg-surface-hover)';
                                                            }
                                                        }}
                                                        onMouseLeave={(e) => {
                                                            if (formData.parentClientId !== c.id) {
                                                                e.currentTarget.style.backgroundColor = 'transparent';
                                                            }
                                                        }}
                                                    >
                                                        {c.fullName}
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                        {selectedParentClient && (
                                            <div style={{ marginTop: '0.5rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                                Selected: {selectedParentClient.fullName}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </section>
                        </div>
                    </div>
                ) : (
                    // Regular client view
                    <div className={styles.grid}>
                        <div className={styles.column}>
                            <section className={styles.card}>
                                <h3 className={styles.sectionTitle}>Client Details</h3>

                                <div className={styles.formGroup}>
                                    <label className="label">Full Name</label>
                                    <input className="input" value={formData.fullName || ''} onChange={e => setFormData({ ...formData, fullName: e.target.value })} />
                                </div>

                                <div className={styles.formGroup}>
                                    <label className="label">Status</label>
                                    <select className="input" value={formData.statusId} onChange={e => setFormData({ ...formData, statusId: e.target.value })}>
                                        {statuses.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                    </select>
                                </div>

                                <div className={styles.formGroup}>
                                    <label className="label">Assigned Navigator</label>
                                    <select className="input" value={formData.navigatorId} onChange={e => setFormData({ ...formData, navigatorId: e.target.value })}>
                                        <option value="">Unassigned</option>
                                        {navigators.map(n => <option key={n.id} value={n.id}>{n.name}</option>)}
                                    </select>
                                </div>

                                <div className={styles.formGroup}>
                                    <label className="label">Address</label>
                                    <input className="input" value={formData.address || ''} onChange={e => setFormData({ ...formData, address: e.target.value })} />
                                </div>

                                {/* Address Components from dietfantasy */}
                                <div className={styles.formGroup}>
                                    <label className="label">Apt/Unit</label>
                                    <input className="input" value={formData.apt || ''} onChange={e => setFormData({ ...formData, apt: e.target.value })} />
                                    <div style={{ height: '1rem' }} /> {/* Spacer */}
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                        <div>
                                            <label className="label">City</label>
                                            <input className="input" value={formData.city || ''} onChange={e => setFormData({ ...formData, city: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className="label">State</label>
                                            <input className="input" value={formData.state || ''} onChange={e => setFormData({ ...formData, state: e.target.value })} maxLength={2} style={{ textTransform: 'uppercase' }} />
                                        </div>
                                    </div>
                                    <div style={{ height: '1rem' }} /> {/* Spacer */}
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                                        <div>
                                            <label className="label">ZIP Code</label>
                                            <input className="input" value={formData.zip || ''} onChange={e => setFormData({ ...formData, zip: e.target.value })} />
                                        </div>
                                        <div>
                                            <label className="label">County</label>
                                            <input className="input" value={formData.county || ''} onChange={e => setFormData({ ...formData, county: e.target.value })} />
                                        </div>
                                    </div>
                                </div>

                                {/* Geolocation Panel */}
                                <div className={styles.formGroup}>
                                    <div style={{ 
                                        padding: '1rem', 
                                        border: '1px solid var(--border-color)', 
                                        borderRadius: 'var(--radius-md)', 
                                        backgroundColor: 'var(--bg-surface-hover)',
                                        opacity: saving ? 0.7 : 1 
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
                                            <label className="label" style={{ margin: 0 }}>Location</label>
                                            {(geoBusy || geoPersisting) && (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                    <Loader2 size={16} className="spin" />
                                                    <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                                                        {geoBusy ? 'Geocoding...' : 'Saving...'}
                                                    </span>
                                                </div>
                                            )}
                                            <div style={{ flex: 1 }} />
                                            <button
                                                className="btn btn-secondary"
                                                onClick={tryAutoGeocode}
                                                disabled={geoBusy || saving}
                                                style={{ fontSize: '0.875rem', padding: '0.375rem 0.75rem' }}
                                            >
                                                Auto Geocode
                                            </button>
                                            <button
                                                className="btn btn-secondary"
                                                onClick={openSuggestions}
                                                disabled={geoBusy || saving}
                                                style={{ fontSize: '0.875rem', padding: '0.375rem 0.75rem' }}
                                            >
                                                See Suggestions
                                            </button>
                                            <button
                                                className="btn btn-secondary"
                                                onClick={() => setMapOpen(true)}
                                                disabled={geoBusy || saving}
                                                style={{ fontSize: '0.875rem', padding: '0.375rem 0.75rem' }}
                                            >
                                                Select on Map
                                            </button>
                                        </div>

                                        {geoSuccess && (
                                            <div style={{ 
                                                display: 'flex', 
                                                alignItems: 'center', 
                                                gap: '0.5rem', 
                                                marginTop: '0.5rem', 
                                                color: 'var(--color-success)',
                                                fontSize: '0.875rem'
                                            }}>
                                                <Check size={16} />
                                                <span>Geocoded Successfully! 🎉</span>
                                            </div>
                                        )}

                                        {typeof formData.lat === "number" && typeof formData.lng === "number" && !geoSuccess ? (
                                            <div style={{ 
                                                marginTop: '0.5rem', 
                                                fontSize: '0.875rem', 
                                                color: 'var(--color-success)' 
                                            }}>
                                                ✓ Geocoded: {formData.lat.toFixed(6)}, {formData.lng.toFixed(6)}{geoPersisting ? " (saving…)" : ""}
                                            </div>
                                        ) : !geoSuccess ? (
                                            <div style={{ 
                                                marginTop: '0.5rem', 
                                                fontSize: '0.875rem', 
                                                color: 'var(--text-secondary)' 
                                            }}>
                                                Not geocoded yet.
                                            </div>
                                        ) : null}

                                        {geoErr && (
                                            <div style={{ 
                                                marginTop: '0.75rem', 
                                                padding: '0.75rem', 
                                                backgroundColor: 'rgba(239, 68, 68, 0.1)', 
                                                border: '1px solid rgba(239, 68, 68, 0.3)', 
                                                borderRadius: 'var(--radius-sm)', 
                                                color: 'var(--color-danger)',
                                                fontSize: '0.875rem'
                                            }}>
                                                {geoErr}
                                            </div>
                                        )}

                                        {candsOpen && (
                                            <div style={{ 
                                                marginTop: '0.75rem', 
                                                border: '1px dashed var(--border-color)', 
                                                borderRadius: 'var(--radius-sm)', 
                                                maxHeight: '220px', 
                                                overflow: 'auto' 
                                            }}>
                                                {cands.length ? (
                                                    <div>
                                                        {cands.map((c, idx) => (
                                                            <div
                                                                key={idx}
                                                                onClick={() => pickCandidate(c)}
                                                                style={{
                                                                    padding: '0.75rem',
                                                                    cursor: saving ? 'not-allowed' : 'pointer',
                                                                    borderBottom: idx < cands.length - 1 ? '1px solid var(--border-color)' : 'none',
                                                                    backgroundColor: 'transparent',
                                                                    transition: 'background-color 0.2s',
                                                                    opacity: saving ? 0.5 : 1
                                                                }}
                                                                onMouseEnter={(e) => {
                                                                    if (!saving) {
                                                                        e.currentTarget.style.backgroundColor = 'var(--bg-surface)';
                                                                    }
                                                                }}
                                                                onMouseLeave={(e) => {
                                                                    e.currentTarget.style.backgroundColor = 'transparent';
                                                                }}
                                                            >
                                                                <div style={{ fontWeight: 500 }}>{c.label}</div>
                                                                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                                                    {Number(c.lat).toFixed(5)}, {Number(c.lng).toFixed(5)} — {c.provider}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : (
                                                    <div style={{ 
                                                        padding: '0.75rem', 
                                                        fontSize: '0.875rem', 
                                                        color: 'var(--text-secondary)', 
                                                        textAlign: 'center' 
                                                    }}>
                                                        No suggestions yet.
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                <div className={styles.formGroup}>
                                    <label className="label">Phone</label>
                                    <input className="input" value={formData.phoneNumber || ''} onChange={e => setFormData({ ...formData, phoneNumber: e.target.value })} />
                                    <div style={{ height: '1rem' }} /> {/* Spacer */}
                                    <label className="label">Secondary Phone</label>
                                    <input className="input" value={formData.secondaryPhoneNumber || ''} onChange={e => setFormData({ ...formData, secondaryPhoneNumber: e.target.value })} />
                                    <div style={{ height: '1rem' }} /> {/* Spacer */}
                                    <label className="label">Email</label>
                                    <input className="input" value={formData.email || ''} onChange={e => setFormData({ ...formData, email: e.target.value })} />
                                </div>

                                {/* External IDs from dietfantasy */}
                                <div className={styles.formGroup}>
                                    <label className="label">Client ID (External)</label>
                                    <input className="input" value={formData.clientIdExternal || ''} onChange={e => setFormData({ ...formData, clientIdExternal: e.target.value })} />
                                    <div style={{ height: '1rem' }} /> {/* Spacer */}
                                    <label className="label">UniteUs Case URL</label>
                                    <input 
                                        className="input"
                                        style={{
                                            borderColor: caseIdExternalError || (formData.caseIdExternal && !isValidUniteUsUrl(formData.caseIdExternal)) 
                                                ? 'var(--color-danger, #dc2626)' 
                                                : undefined
                                        }}
                                        value={formData.caseIdExternal || ''} 
                                        onChange={handleCaseIdExternalChange}
                                        placeholder="https://app.uniteus.io/dashboard/cases/open/{CASE_ID}/contact/{CLIENT_ID}"
                                    />
                                    {caseIdExternalError && (
                                        <div style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: 'var(--color-danger)' }}>
                                            {caseIdExternalError}
                                        </div>
                                    )}
                                    {formData.caseIdExternal && isValidUniteUsUrl(formData.caseIdExternal) && (() => {
                                        const parsed = parseUniteUsUrl(formData.caseIdExternal);
                                        return parsed ? (
                                            <div style={{ marginTop: '0.5rem', fontSize: '0.875rem', color: 'var(--color-success)' }}>
                                                Parsed ✓ Case ID: <strong>{parsed.caseId}</strong> | Client ID: <strong>{parsed.clientId}</strong>
                                            </div>
                                        ) : null;
                                    })()}
                                    {formData.caseIdExternal && isValidUniteUsUrl(formData.caseIdExternal) && (
                                        <div style={{ marginTop: '0.5rem' }}>
                                            <a 
                                                href={formData.caseIdExternal} 
                                                target="_blank" 
                                                rel="noopener noreferrer" 
                                                style={{ 
                                                    display: 'inline-flex', 
                                                    alignItems: 'center', 
                                                    gap: '0.5rem',
                                                    color: 'var(--color-primary)',
                                                    textDecoration: 'underline',
                                                    fontSize: '0.875rem'
                                                }}
                                            >
                                                Open in UniteUs
                                                <ExternalLink size={14} />
                                            </a>
                                        </div>
                                    )}
                                </div>

                                {/* Status Flags from dietfantasy */}
                                <div className={styles.formGroup}>
                                    <label className="label">Status Flags</label>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginTop: '0.5rem' }}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                            <input
                                                type="checkbox"
                                                checked={formData.medicaid ?? false}
                                                onChange={e => setFormData({ ...formData, medicaid: e.target.checked })}
                                            />
                                            <span>Medicaid</span>
                                        </label>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                            <input
                                                type="checkbox"
                                                checked={formData.paused ?? false}
                                                onChange={e => setFormData({ ...formData, paused: e.target.checked })}
                                            />
                                            <span>Paused</span>
                                        </label>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                            <input
                                                type="checkbox"
                                                checked={formData.complex ?? false}
                                                onChange={e => setFormData({ ...formData, complex: e.target.checked })}
                                            />
                                            <span>Complex</span>
                                        </label>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                            <input
                                                type="checkbox"
                                                checked={formData.bill ?? true}
                                                onChange={e => setFormData({ ...formData, bill: e.target.checked })}
                                            />
                                            <span>Bill</span>
                                        </label>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                                            <input
                                                type="checkbox"
                                                checked={formData.delivery ?? true}
                                                onChange={e => setFormData({ ...formData, delivery: e.target.checked })}
                                            />
                                            <span>Delivery</span>
                                        </label>
                                    </div>
                                </div>

                                {/* Dietary Preferences from dietfantasy */}
                                <div className={styles.formGroup}>
                                    <label className="label">Dislikes / Dietary Restrictions</label>
                                    <textarea className="input" style={{ height: '80px' }} value={formData.dislikes || ''} onChange={e => setFormData({ ...formData, dislikes: e.target.value })} placeholder="Enter any food dislikes or dietary restrictions" />
                                </div>

                                <div className={styles.formGroup}>
                                    <label className="label">Authorized Amount</label>
                                    <input
                                        type="number"
                                        step="0.01"
                                        className="input"
                                        value={formData.authorizedAmount ?? ''}
                                        onChange={e => setFormData({ ...formData, authorizedAmount: e.target.value ? parseFloat(e.target.value) : null })}
                                        placeholder="0.00"
                                    />
                                    <div style={{ height: '1rem' }} /> {/* Spacer */}
                                    <label className="label">Expiration Date</label>
                                    <input
                                        type="date"
                                        className="input"
                                        value={(() => {
                                            const date = formData.expirationDate;
                                            if (!date) return '';
                                            if (typeof date === 'string') {
                                                return date.includes('T') ? date.split('T')[0] : date;
                                            }
                                            // Handle Date object case
                                            try {
                                                const dateObj = date instanceof Date ? date : new Date(date);
                                                return dateObj.toISOString().split('T')[0];
                                            } catch {
                                                return '';
                                            }
                                        })()}
                                        onChange={e => setFormData({ ...formData, expirationDate: e.target.value || null })}
                                    />
                                </div>

                                <div className={styles.formGroup}>
                                    <label className="label">General Notes</label>
                                    <textarea className="input" style={{ height: '100px' }} value={formData.notes || ''} onChange={e => setFormData({ ...formData, notes: e.target.value })} />
                                </div>

                                <div className={styles.formGroup}>
                                    <label className="label">Screening Status</label>
                                    <div style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        padding: '12px 16px',
                                        borderRadius: 'var(--radius-md)',
                                        fontSize: '1rem',
                                        fontWeight: 500,
                                        backgroundColor: (() => {
                                            const status = client?.screeningStatus || 'not_started';
                                            switch (status) {
                                                case 'waiting_approval': return 'rgba(72, 190, 133, 0.1)';
                                                case 'approved': return 'rgba(34, 197, 94, 0.1)';
                                                case 'rejected': return 'rgba(239, 68, 68, 0.1)';
                                                default: return 'var(--bg-surface-hover)';
                                            }
                                        })(),
                                        color: (() => {
                                            const status = client?.screeningStatus || 'not_started';
                                            switch (status) {
                                                case 'waiting_approval': return '#48be85';
                                                case 'approved': return 'var(--color-success)';
                                                case 'rejected': return 'var(--color-danger)';
                                                default: return 'var(--text-tertiary)';
                                            }
                                        })(),
                                        border: '1px solid var(--border-color)'
                                    }}>
                                        {(() => {
                                            const status = client?.screeningStatus || 'not_started';
                                            switch (status) {
                                                case 'not_started': return <><Square size={18} /> Not Started</>;
                                                case 'waiting_approval': return <><CheckSquare size={18} /> Pending Approval</>;
                                                case 'approved': return <><CheckSquare size={18} /> Approved</>;
                                                case 'rejected': return <><Square size={18} /> Rejected</>;
                                                default: return <><Square size={18} /> Not Started</>;
                                            }
                                        })()}
                                    </div>
                                    <p style={{
                                        fontSize: '0.85rem',
                                        color: 'var(--text-tertiary)',
                                        marginTop: '8px',
                                        fontStyle: 'italic'
                                    }}>
                                        Status updates automatically when screening forms are submitted and reviewed.
                                    </p>
                                </div>

                            </section>

                            {!isDependent && (
                                <section className={styles.card}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                        <h3 className={styles.sectionTitle} style={{ margin: 0 }}>Dependents {dependents.length > 0 && `(${dependents.length})`}</h3>
                                        <button
                                            className="btn btn-secondary"
                                            onClick={() => setShowAddDependentForm(!showAddDependentForm)}
                                            style={{ fontSize: '0.875rem', padding: '0.375rem 0.75rem' }}
                                        >
                                            <Plus size={14} /> {showAddDependentForm ? 'Cancel' : 'Add Dependent'}
                                        </button>
                                    </div>

                                    {showAddDependentForm && (
                                        <div style={{
                                            padding: '1rem',
                                            border: '1px solid var(--border-color)',
                                            borderRadius: 'var(--radius-md)',
                                            backgroundColor: 'var(--bg-surface-hover)',
                                            marginBottom: '0.75rem'
                                        }}>
                                            <label className="label" style={{ marginBottom: '0.5rem' }}>Dependent Name</label>
                                            <input
                                                className="input"
                                                placeholder="Enter dependent name"
                                                value={dependentName}
                                                onChange={e => setDependentName(e.target.value)}
                                                onKeyDown={e => {
                                                    if (e.key === 'Enter' && dependentName.trim()) {
                                                        handleCreateDependent();
                                                    }
                                                }}
                                                style={{ marginBottom: '0.75rem' }}
                                                autoFocus
                                            />
                                            <label className="label" style={{ marginBottom: '0.5rem' }}>Date of Birth</label>
                                            <input
                                                type="date"
                                                className="input"
                                                value={dependentDob}
                                                onChange={e => setDependentDob(e.target.value)}
                                                style={{ marginBottom: '0.75rem' }}
                                            />
                                            <label className="label" style={{ marginBottom: '0.5rem' }}>CIN#</label>
                                            <input
                                                type="number"
                                                className="input"
                                                placeholder="CIN Number"
                                                value={dependentCin}
                                                onChange={e => setDependentCin(e.target.value)}
                                                style={{ marginBottom: '0.75rem' }}
                                            />
                                            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
                                                <button
                                                    className="btn btn-secondary"
                                                    onClick={() => {
                                                        setShowAddDependentForm(false);
                                                        setDependentName('');
                                                        setDependentDob('');
                                                        setDependentCin('');
                                                    }}
                                                    disabled={creatingDependent}
                                                >
                                                    Cancel
                                                </button>
                                                <button
                                                    className="btn btn-primary"
                                                    onClick={handleCreateDependent}
                                                    disabled={!dependentName.trim() || creatingDependent}
                                                >
                                                    {creatingDependent ? <Loader2 className="spin" size={14} /> : <Plus size={14} />} Create Dependent
                                                </button>
                                            </div>
                                        </div>
                                    )}

                                    {dependents.length > 0 ? (
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                            {dependents.map(dependent => (
                                                <div
                                                    key={dependent.id}
                                                    onClick={() => {
                                                        if (onClose) {
                                                            onClose();
                                                        } else {
                                                            router.push(`/clients/${dependent.id}`);
                                                        }
                                                    }}
                                                    style={{
                                                        padding: '0.75rem',
                                                        border: '1px solid var(--border-color)',
                                                        borderRadius: 'var(--radius-md)',
                                                        backgroundColor: 'var(--bg-surface)',
                                                        cursor: 'pointer',
                                                        transition: 'background-color 0.2s'
                                                    }}
                                                    onMouseEnter={(e) => {
                                                        e.currentTarget.style.backgroundColor = 'var(--bg-surface-hover)';
                                                    }}
                                                    onMouseLeave={(e) => {
                                                        e.currentTarget.style.backgroundColor = 'var(--bg-surface)';
                                                    }}
                                                >
                                                    <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                                                        {dependent.fullName}
                                                    </div>
                                                    {(dependent.dob || dependent.cin) && (
                                                        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                                                            {dependent.dob && <span>DOB: {new Date(dependent.dob).toLocaleDateString()}</span>}
                                                            {dependent.dob && dependent.cin && <span> • </span>}
                                                            {dependent.cin && <span>CIN#: {dependent.cin}</span>}
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    ) : (
                                        <p style={{ color: 'var(--text-secondary)', fontStyle: 'italic', margin: 0 }}>
                                            No dependents yet. Click "Add Dependent" to create one.
                                        </p>
                                    )}
                                </section>
                            )}

                            {/* Screening Form Submissions */}
                            <section className={styles.card}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                                    <h3 className={styles.sectionTitle} style={{ margin: 0 }}>Screening Form Submissions</h3>
                                    <button
                                        className="btn btn-primary"
                                        onClick={handleOpenScreeningForm}
                                        disabled={loadingForm}
                                        style={{ fontSize: '14px' }}
                                    >
                                        {loadingForm ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
                                        Fill Screening Form
                                    </button>
                                </div>
                                {loadingSubmissions ? (
                                    <div style={{ textAlign: 'center', padding: '20px' }}>
                                        <Loader2 size={24} className="animate-spin" />
                                    </div>
                                ) : (
                                    <SubmissionsList submissions={submissions} />
                                )}
                            </section>

                        </div>

                        <div className={styles.column}>
                            <section className={styles.card}>
                                <h3 className={styles.sectionTitle}>Service Configuration</h3>

                                <div className={styles.formGroup}>
                                    <label className="label">Service Type</label>
                                    <div className={styles.serviceTypes}>
                                        {SERVICE_TYPES.map(type => (
                                            <button
                                                key={type}
                                                className={`${styles.serviceBtn} ${formData.serviceType === type ? styles.activeService : ''}`}
                                                onClick={() => handleServiceChange(type)}
                                            >
                                                {type}
                                            </button>
                                        ))}
                                    </div>
                                </div>



                                <div className={styles.formGroup}>
                                    <label className="label">Case ID (Required)</label>
                                    <input
                                        className="input"
                                        value={orderConfig.caseId || ''}
                                        placeholder="Enter Case ID to enable configuration..."
                                        onChange={e => setOrderConfig({ ...orderConfig, caseId: e.target.value })}
                                    />
                                </div>

                                {!orderConfig.caseId && (
                                    <div className={styles.alert} style={{ marginTop: '16px', backgroundColor: 'var(--bg-surface-hover)' }}>
                                        <AlertTriangle size={16} />
                                        Please enter a Case ID to configure the service.
                                    </div>
                                )}

                                {orderConfig.caseId && (
                                    <>
                                        {formData.serviceType === 'Food' && (
                                            <div className="animate-fade-in">
                                                <div className={styles.formGroup}>
                                                    <label className="label">Approved Meals Per Week</label>
                                                    <input
                                                        type="number"
                                                        className="input"
                                                        value={formData.approvedMealsPerWeek || 0}
                                                        onChange={e => setFormData({ ...formData, approvedMealsPerWeek: Number(e.target.value) })}
                                                    />
                                                </div>

                                                <div className={styles.divider} />

                                                <div className={styles.orderHeader}>
                                                    <h4>Current Order Request</h4>
                                                    <div style={{ display: 'flex', gap: '0.5rem', flexDirection: 'column', alignItems: 'flex-end' }}>
                                                        <div className={styles.budget} style={{
                                                            color: getCurrentOrderTotalValueAllDays() > (formData.approvedMealsPerWeek || 0) ? 'var(--color-danger)' : 'inherit',
                                                            backgroundColor: getCurrentOrderTotalValueAllDays() > (formData.approvedMealsPerWeek || 0) ? 'rgba(239, 68, 68, 0.1)' : 'var(--bg-surface-hover)'
                                                        }}>
                                                            Value: {getCurrentOrderTotalValueAllDays()} / {formData.approvedMealsPerWeek || 0}
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* Display items from all existing upcoming orders */}
                                                {allUpcomingOrders.length > 0 && (() => {
                                                    // Helper function to extract items from an order
                                                    const extractItemsFromOrder = (order: any): Array<{ itemId: string; itemName: string; quantity: number; vendorName: string; deliveryDay?: string }> => {
                                                        const items: Array<{ itemId: string; itemName: string; quantity: number; vendorName: string; deliveryDay?: string }> = [];
                                                        
                                                        if (order.serviceType === 'Food' && order.vendorSelections) {
                                                            order.vendorSelections.forEach((vs: any) => {
                                                                const vendor = vendors.find(v => v.id === vs.vendorId);
                                                                const vendorName = vendor?.name || 'Unknown Vendor';
                                                                
                                                                if (vs.items) {
                                                                    Object.entries(vs.items).forEach(([itemId, qty]: [string, any]) => {
                                                                        const menuItem = menuItems.find(mi => mi.id === itemId);
                                                                        const itemName = menuItem?.name || 'Unknown Item';
                                                                        const quantity = Number(qty) || 0;
                                                                        
                                                                        if (quantity > 0) {
                                                                            items.push({
                                                                                itemId,
                                                                                itemName,
                                                                                quantity,
                                                                                vendorName,
                                                                                deliveryDay: order.deliveryDay
                                                                            });
                                                                        }
                                                                    });
                                                                }
                                                            });
                                                        } else if (order.serviceType === 'Boxes' && order.items) {
                                                            const vendor = vendors.find(v => v.id === order.vendorId);
                                                            const vendorName = vendor?.name || 'Unknown Vendor';
                                                            
                                                            Object.entries(order.items).forEach(([itemId, qty]: [string, any]) => {
                                                                const menuItem = menuItems.find(mi => mi.id === itemId);
                                                                const itemName = menuItem?.name || 'Unknown Item';
                                                                const quantity = Number(qty) || 0;
                                                                
                                                                if (quantity > 0) {
                                                                    items.push({
                                                                        itemId,
                                                                        itemName,
                                                                        quantity,
                                                                        vendorName,
                                                                        deliveryDay: order.deliveryDay
                                                                    });
                                                                }
                                                            });
                                                        }
                                                        
                                                        return items;
                                                    };

                                                    // Filter orders by selected profile (caseId) if present
                                                    const currentCaseId = orderConfig?.caseId;
                                                    const filteredOrders = currentCaseId 
                                                        ? allUpcomingOrders.filter((order: any) => order.caseId === currentCaseId)
                                                        : allUpcomingOrders;

                                                    // Collect all items from filtered upcoming orders
                                                    const allItems: Array<{ itemId: string; itemName: string; quantity: number; vendorName: string; deliveryDay?: string; orderId?: string }> = [];
                                                    filteredOrders.forEach((order) => {
                                                        const orderItems = extractItemsFromOrder(order);
                                                        orderItems.forEach(item => {
                                                            allItems.push({
                                                                ...item,
                                                                orderId: order.id
                                                            });
                                                        });
                                                    });

                                                    // Group items by itemId and vendor, summing quantities
                                                    const itemMap = new Map<string, { itemId: string; itemName: string; quantity: number; vendorName: string; deliveryDays: Set<string> }>();
                                                    allItems.forEach(item => {
                                                        const key = `${item.itemId}-${item.vendorName}`;
                                                        if (itemMap.has(key)) {
                                                            const existing = itemMap.get(key)!;
                                                            existing.quantity += item.quantity;
                                                            if (item.deliveryDay) {
                                                                existing.deliveryDays.add(item.deliveryDay);
                                                            }
                                                        } else {
                                                            itemMap.set(key, {
                                                                itemId: item.itemId,
                                                                itemName: item.itemName,
                                                                quantity: item.quantity,
                                                                vendorName: item.vendorName,
                                                                deliveryDays: new Set(item.deliveryDay ? [item.deliveryDay] : [])
                                                            });
                                                        }
                                                    });

                                                    const groupedItems = Array.from(itemMap.values());

                                                    if (groupedItems.length > 0) {
                                                        return (
                                                            <div style={{
                                                                marginBottom: 'var(--spacing-md)',
                                                                padding: 'var(--spacing-md)',
                                                                backgroundColor: 'var(--bg-surface-hover)',
                                                                borderRadius: 'var(--radius-md)',
                                                                border: '1px solid var(--border-color)'
                                                            }}>
                                                                <div style={{
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '0.5rem',
                                                                    marginBottom: 'var(--spacing-sm)',
                                                                    fontSize: '0.9rem',
                                                                    fontWeight: 600,
                                                                    color: 'var(--text-secondary)'
                                                                }}>
                                                                    <ShoppingCart size={16} />
                                                                    <span>Existing Upcoming Orders Items</span>
                                                                </div>
                                                                <div style={{
                                                                    display: 'flex',
                                                                    flexDirection: 'column',
                                                                    gap: '0.5rem'
                                                                }}>
                                                                    {groupedItems.map((item, idx) => (
                                                                        <div key={`${item.itemId}-${item.vendorName}-${idx}`} style={{
                                                                            display: 'flex',
                                                                            justifyContent: 'space-between',
                                                                            alignItems: 'center',
                                                                            padding: '0.5rem',
                                                                            backgroundColor: 'var(--bg-app)',
                                                                            borderRadius: 'var(--radius-sm)',
                                                                            fontSize: '0.85rem'
                                                                        }}>
                                                                            <div style={{ flex: 1 }}>
                                                                                <div style={{ fontWeight: 500 }}>
                                                                                    {item.itemName}
                                                                                </div>
                                                                                <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: '0.25rem' }}>
                                                                                    {item.vendorName}
                                                                                    {item.deliveryDays.size > 0 && (
                                                                                        <span style={{ marginLeft: '0.5rem' }}>
                                                                                            ({Array.from(item.deliveryDays).join(', ')})
                                                                                        </span>
                                                                                    )}
                                                                                </div>
                                                                            </div>
                                                                            <div style={{
                                                                                fontWeight: 600,
                                                                                color: 'var(--color-primary)',
                                                                                minWidth: '40px',
                                                                                textAlign: 'right'
                                                                            }}>
                                                                                {item.quantity}
                                                                            </div>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        );
                                                    }
                                                    return null;
                                                })()}

                                                {(() => {
                                                    // Unified Warning / Rule Display

                                                    if (client?.serviceType === 'Boxes') {
                                                        return (
                                                            <div className={styles.alert} style={{ marginBottom: 'var(--spacing-md)' }}>
                                                                <Info size={18} style={{ flexShrink: 0 }} />
                                                                <div style={{ fontSize: '0.9rem', fontWeight: 500 }}>
                                                                    Your changes may not take effect until next week.
                                                                </div>
                                                            </div>
                                                        );
                                                    }

                                                    if (client?.serviceType === 'Food' || formData.serviceType === 'Food') {
                                                        const uniqueVendorIds = new Set<string>();

                                                        if (orderConfig.deliveryDayOrders) {
                                                            Object.values(orderConfig.deliveryDayOrders).forEach((dayOrder: any) => {
                                                                if (dayOrder.vendorSelections) {
                                                                    dayOrder.vendorSelections.forEach((s: any) => s.vendorId && uniqueVendorIds.add(s.vendorId));
                                                                }
                                                            });
                                                        } else if (orderConfig.vendorSelections) {
                                                            orderConfig.vendorSelections.forEach((s: any) => s.vendorId && uniqueVendorIds.add(s.vendorId));
                                                        }

                                                        const messages: string[] = [];
                                                        uniqueVendorIds.forEach(vId => {
                                                            const v = vendors.find(vend => vend.id === vId);
                                                            if (v) {
                                                                const cutoff = v.cutoffHours || 0;
                                                                messages.push(`Orders for ${v.name} must be placed ${cutoff} hours before delivery.`);
                                                            }
                                                        });

                                                        if (messages.length > 0) {
                                                            return (
                                                                <div className={styles.alert} style={{ marginBottom: 'var(--spacing-md)' }}>
                                                                    <Info size={18} style={{ flexShrink: 0 }} />
                                                                    <div>
                                                                        {messages.map((msg, i) => (
                                                                            <div key={i} style={{ fontSize: '0.9rem', fontWeight: 500 }}>
                                                                                {msg}
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            );
                                                        }
                                                    }

                                                    return null;
                                                })()}


                                                {/* Vendor list with per-vendor delivery day selection */}
                                                {(() => {
                                                    // Check if we're already in multi-day format (from saved data)
                                                    const isAlreadyMultiDay = orderConfig.deliveryDayOrders && typeof orderConfig.deliveryDayOrders === 'object';

                                                    if (isAlreadyMultiDay) {
                                                        // Convert saved deliveryDayOrders back to per-vendor format for editing
                                                        const deliveryDays = Object.keys(orderConfig.deliveryDayOrders).sort();
                                                        const vendorMap = new Map<string, any>();

                                                        // Group by vendor across all days
                                                        for (const day of deliveryDays) {
                                                            const daySelections = orderConfig.deliveryDayOrders[day].vendorSelections || [];
                                                            for (const sel of daySelections) {
                                                                // Use a temporary key for blank rows to group them, but only one per day
                                                                const vId = sel.vendorId || "__blank__";

                                                                if (!vendorMap.has(vId)) {
                                                                    vendorMap.set(vId, {
                                                                        vendorId: sel.vendorId, // original (might be "")
                                                                        selectedDeliveryDays: [],
                                                                        itemsByDay: {}
                                                                    });
                                                                }

                                                                const vendorSel = vendorMap.get(vId);
                                                                if (!vendorSel.selectedDeliveryDays.includes(day)) {
                                                                    vendorSel.selectedDeliveryDays.push(day);
                                                                }
                                                                vendorSel.itemsByDay[day] = sel.items || {};
                                                            }
                                                        }

                                                        const currentSelections = Array.from(vendorMap.values());
                                                        // Ensure there is at least one selection if we're in this mode
                                                        if (currentSelections.length === 0) {
                                                            const fallback = getVendorSelectionsForDay(null);
                                                            if (fallback && fallback.length > 0) {
                                                                fallback.forEach(s => currentSelections.push(s));
                                                            } else {
                                                                currentSelections.push({ vendorId: '', items: {} });
                                                            }
                                                        }

                                                        return (
                                                            <div className={styles.vendorsList}>
                                                                {(currentSelections || []).map((selection: any, index: number) => {
                                                                    const vendor = selection.vendorId ? vendors.find(v => v.id === selection.vendorId) : null;
                                                                    const vendorHasMultipleDays = vendor && vendor.deliveryDays && vendor.deliveryDays.length > 1;
                                                                    const vendorDeliveryDays = vendor?.deliveryDays || [];
                                                                    const vendorSelectedDays = (selection.selectedDeliveryDays || []) as string[];

                                                                    return (
                                                                        <div key={index} className={styles.vendorBlock}>
                                                                            <div className={styles.vendorHeader}>
                                                                                <select
                                                                                    className="input"
                                                                                    value={selection.vendorId}
                                                                                    onChange={e => updateVendorSelection(index, 'vendorId', e.target.value, null)}
                                                                                >
                                                                                    <option value="">Select Vendor...</option>
                                                                                    {vendors && vendors.length > 0 ? (() => {
                                                                                        // Debug logging for vendor filtering
                                                                                        console.log(`[ClientProfile] Food dropdown - Total vendors: ${vendors.length}`);
                                                                                        const filteredVendors = vendors.filter(v => {
                                                                                            // Check if vendor has Food service type
                                                                                            const hasFoodService = v.serviceTypes && Array.isArray(v.serviceTypes) && v.serviceTypes.includes('Food');
                                                                                            const isActive = v.isActive !== undefined ? v.isActive : true;
                                                                                            return hasFoodService && isActive;
                                                                                        });
                                                                                        console.log(`[ClientProfile] Food dropdown - Filtered vendors: ${filteredVendors.length}`, filteredVendors.map(v => ({ id: v.id, name: v.name, serviceTypes: v.serviceTypes, isActive: v.isActive })));
                                                                                        
                                                                                        // Fallback: if no vendors have Food service type, show all active vendors
                                                                                        const vendorsToShow = filteredVendors.length > 0 
                                                                                            ? filteredVendors 
                                                                                            : vendors.filter(v => v.isActive !== undefined ? v.isActive : true);
                                                                                        
                                                                                        if (filteredVendors.length === 0 && vendors.length > 0) {
                                                                                            console.warn('[ClientProfile] Food dropdown - No vendors with Food service type found. Showing all active vendors instead. All vendors:', vendors.map(v => ({ id: v.id, name: v.name, serviceTypes: v.serviceTypes, isActive: v.isActive })));
                                                                                        }
                                                                                        return vendorsToShow.map(v => (
                                                                                            <option key={v.id} value={v.id} disabled={currentSelections.some((s: any, i: number) => i !== index && s.vendorId === v.id)}>
                                                                                                {v.name}
                                                                                            </option>
                                                                                        ));
                                                                                    })() : <option value="" disabled>Loading vendors...</option>}
                                                                                </select>
                                                                                <button className={`${styles.iconBtn} ${styles.danger}`} onClick={() => removeVendorBlock(index, null)} title="Remove Vendor">
                                                                                    <Trash2 size={16} />
                                                                                </button>
                                                                            </div>

                                                                            {selection.vendorId && vendorHasMultipleDays && (
                                                                                <div style={{
                                                                                    marginBottom: '1rem',
                                                                                    padding: '0.75rem',
                                                                                    backgroundColor: 'var(--bg-surface-hover)',
                                                                                    borderRadius: 'var(--radius-sm)',
                                                                                    border: '1px solid var(--border-color)'
                                                                                }}>
                                                                                    <div style={{
                                                                                        display: 'flex',
                                                                                        alignItems: 'center',
                                                                                        gap: '0.5rem',
                                                                                        marginBottom: '0.75rem',
                                                                                        fontSize: '0.9rem',
                                                                                        fontWeight: 500
                                                                                    }}>
                                                                                        <Calendar size={16} />
                                                                                        <span>Select delivery days for {vendor?.name}:</span>
                                                                                    </div>
                                                                                    <div style={{
                                                                                        display: 'flex',
                                                                                        flexWrap: 'wrap',
                                                                                        gap: '0.5rem'
                                                                                    }}>
                                                                                        {vendorDeliveryDays.map((day: string) => {
                                                                                            const isSelected = vendorSelectedDays.includes(day);
                                                                                            return (
                                                                                                <button
                                                                                                    key={day}
                                                                                                    type="button"
                                                                                                    onClick={() => {
                                                                                                        const newSelected = isSelected
                                                                                                            ? vendorSelectedDays.filter((d: string) => d !== day)
                                                                                                            : [...vendorSelectedDays, day];

                                                                                                        // Update selection with new delivery days
                                                                                                        const updated = [...currentSelections];
                                                                                                        updated[index] = {
                                                                                                            ...updated[index],
                                                                                                            selectedDeliveryDays: newSelected,
                                                                                                            // Initialize items for each selected day
                                                                                                            itemsByDay: (() => {
                                                                                                                const itemsByDay = { ...(updated[index].itemsByDay || {}) };
                                                                                                                if (!isSelected) {
                                                                                                                    // Adding a day - initialize empty items
                                                                                                                    itemsByDay[day] = {};
                                                                                                                } else {
                                                                                                                    // Removing a day - clean up
                                                                                                                    delete itemsByDay[day];
                                                                                                                }
                                                                                                                return itemsByDay;
                                                                                                            })()
                                                                                                        };
                                                                                                        setOrderConfig({
                                                                                                            ...orderConfig,
                                                                                                            vendorSelections: updated,
                                                                                                            deliveryDayOrders: undefined // Clear old format
                                                                                                        });
                                                                                                    }}
                                                                                                    style={{
                                                                                                        padding: '0.5rem 1rem',
                                                                                                        borderRadius: 'var(--radius-sm)',
                                                                                                        border: `2px solid ${isSelected ? 'var(--color-primary)' : 'var(--border-color)'}`,
                                                                                                        backgroundColor: isSelected ? 'var(--color-primary)' : 'var(--bg-app)',
                                                                                                        color: isSelected ? 'white' : 'var(--text-primary)',
                                                                                                        cursor: 'pointer',
                                                                                                        fontSize: '0.85rem',
                                                                                                        fontWeight: isSelected ? 600 : 400,
                                                                                                        transition: 'all 0.2s'
                                                                                                    }}
                                                                                                >
                                                                                                    {day}
                                                                                                    {isSelected && <Check size={14} style={{ marginLeft: '0.25rem', display: 'inline', verticalAlign: 'middle' }} />}
                                                                                                </button>
                                                                                            );
                                                                                        })}
                                                                                    </div>
                                                                                </div>
                                                                            )}

                                                                            {selection.vendorId && (() => {
                                                                                const vendorMinimum = vendor?.minimumMeals || 0;

                                                                                // If vendor has multiple days but no days are selected, don't show menu items
                                                                                if (vendorHasMultipleDays && vendorSelectedDays.length === 0) {
                                                                                    return null;
                                                                                }

                                                                                // If vendor has multiple days and days are selected, show forms for each day
                                                                                if (vendorHasMultipleDays && vendorSelectedDays.length > 0) {
                                                                                    return (
                                                                                        <>
                                                                                            {vendorSelectedDays.map((day: string) => {
                                                                                                const dayItems = (selection.itemsByDay || {})[day] || {};
                                                                                                const dayMealCount = Object.values(dayItems).reduce((sum: number, qty: any) => sum + (Number(qty) || 0), 0);
                                                                                                const meetsMinimum = vendorMinimum === 0 || dayMealCount >= vendorMinimum;

                                                                                                return (
                                                                                                    <div key={day} style={{
                                                                                                        marginBottom: '1.5rem',
                                                                                                        padding: '1rem',
                                                                                                        border: '1px solid var(--border-color)',
                                                                                                        borderRadius: 'var(--radius-md)',
                                                                                                        backgroundColor: 'var(--bg-surface-hover)'
                                                                                                    }}>
                                                                                                        <div style={{
                                                                                                            display: 'flex',
                                                                                                            alignItems: 'center',
                                                                                                            justifyContent: 'space-between',
                                                                                                            marginBottom: '0.75rem',
                                                                                                            paddingBottom: '0.75rem',
                                                                                                            borderBottom: '1px solid var(--border-color)'
                                                                                                        }}>
                                                                                                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                                                                <Calendar size={16} />
                                                                                                                <strong>{day}</strong>
                                                                                                            </div>
                                                                                                            {vendorMinimum > 0 && (
                                                                                                                <div style={{
                                                                                                                    fontSize: '0.85rem',
                                                                                                                    color: meetsMinimum ? 'var(--text-primary)' : 'var(--color-danger)',
                                                                                                                    fontWeight: 500
                                                                                                                }}>
                                                                                                                    Meals: {dayMealCount} / {vendorMinimum} min
                                                                                                                </div>
                                                                                                            )}
                                                                                                        </div>

                                                                                                        {vendorMinimum > 0 && !meetsMinimum && (
                                                                                                            <div style={{
                                                                                                                marginBottom: '0.75rem',
                                                                                                                padding: '0.5rem',
                                                                                                                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                                                                                                                borderRadius: 'var(--radius-sm)',
                                                                                                                border: '1px solid var(--color-danger)',
                                                                                                                fontSize: '0.8rem',
                                                                                                                color: 'var(--color-danger)'
                                                                                                            }}>
                                                                                                                <AlertTriangle size={14} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'middle' }} />
                                                                                                                Minimum {vendorMinimum} meals required for {day}
                                                                                                            </div>
                                                                                                        )}

                                                                                                        <div className={styles.menuItems}>
                                                                                                            {getVendorMenuItems(selection.vendorId).map((item) => {
                                                                                                                const qty = Number(dayItems[item.id] || 0);
                                                                                                                const upcomingQty = getUpcomingOrderQuantityForItem(item.id, selection.vendorId);
                                                                                                                return (
                                                                                                                    <div key={item.id} className={styles.menuItem}>
                                                                                                                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                                                                                                            <span>
                                                                                                                                {item.name}
                                                                                                                                {(item.quotaValue || 1) > 1 && (
                                                                                                                                    <span style={{ color: 'var(--text-tertiary)', fontSize: '0.9em', marginLeft: '4px' }}>
                                                                                                                                        (counts as {item.quotaValue || 1} meals)
                                                                                                                                    </span>
                                                                                                                                )}
                                                                                                                                {upcomingQty > 0 && (
                                                                                                                                    <span style={{ 
                                                                                                                                        color: 'var(--color-primary)', 
                                                                                                                                        fontSize: '0.85em', 
                                                                                                                                        marginLeft: '6px',
                                                                                                                                        fontWeight: 500,
                                                                                                                                        backgroundColor: 'var(--bg-surface-hover)',
                                                                                                                                        padding: '2px 6px',
                                                                                                                                        borderRadius: 'var(--radius-sm)'
                                                                                                                                    }}>
                                                                                                                                        ({upcomingQty} in upcoming orders)
                                                                                                                                    </span>
                                                                                                                                )}
                                                                                                                            </span>
                                                                                                                            <div className={styles.quantityControl} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                                                                                <button onClick={() => {
                                                                                                                                    const updated = [...currentSelections];
                                                                                                                                    const itemsByDay = { ...(updated[index].itemsByDay || {}) };
                                                                                                                                    if (!itemsByDay[day]) itemsByDay[day] = {};
                                                                                                                                    const newQty = Math.max(0, qty - 1);
                                                                                                                                    if (newQty > 0) {
                                                                                                                                        itemsByDay[day][item.id] = newQty;
                                                                                                                                    } else {
                                                                                                                                        delete itemsByDay[day][item.id];
                                                                                                                                    }
                                                                                                                                    updated[index] = {
                                                                                                                                        ...updated[index],
                                                                                                                                        itemsByDay
                                                                                                                                    };
                                                                                                                                    setVendorSelectionsForDay(null, updated);
                                                                                                                                }} className="btn btn-secondary" style={{ padding: '2px 8px' }}>-</button>
                                                                                                                                <span style={{ width: '20px', textAlign: 'center' }}>{qty}</span>
                                                                                                                                <button onClick={() => {
                                                                                                                                    const updated = [...currentSelections];
                                                                                                                                    const itemsByDay = { ...(updated[index].itemsByDay || {}) };
                                                                                                                                    if (!itemsByDay[day]) itemsByDay[day] = {};
                                                                                                                                    itemsByDay[day][item.id] = qty + 1;
                                                                                                                                    updated[index] = {
                                                                                                                                        ...updated[index],
                                                                                                                                        itemsByDay
                                                                                                                                    };
                                                                                                                                    setVendorSelectionsForDay(null, updated);
                                                                                                                                }} className="btn btn-secondary" style={{ padding: '2px 8px' }}>+</button>
                                                                                                                            </div>
                                                                                                                        </label>
                                                                                                                    </div>
                                                                                                                );
                                                                                                            })}
                                                                                                            {getVendorMenuItems(selection.vendorId).length === 0 && <span className={styles.hint}>No active menu items.</span>}
                                                                                                        </div>
                                                                                                    </div>
                                                                                                );
                                                                                            })}
                                                                                        </>
                                                                                    );
                                                                                }

                                                                                // Single delivery day or no multiple days - show normal item selection
                                                                                const vendorMealCount = getVendorMealCount(selection.vendorId, selection);
                                                                                const meetsMinimum = vendorMinimum === 0 || vendorMealCount >= vendorMinimum;

                                                                                return (
                                                                                    <>
                                                                                        {vendorMinimum > 0 && (
                                                                                            <div style={{
                                                                                                marginBottom: '0.75rem',
                                                                                                padding: '0.5rem 0.75rem',
                                                                                                backgroundColor: meetsMinimum ? 'var(--bg-surface-hover)' : 'rgba(239, 68, 68, 0.1)',
                                                                                                borderRadius: 'var(--radius-sm)',
                                                                                                border: `1px solid ${meetsMinimum ? 'var(--border-color)' : 'var(--color-danger)'}`,
                                                                                                fontSize: '0.85rem'
                                                                                            }}>
                                                                                                <div style={{
                                                                                                    display: 'flex',
                                                                                                    justifyContent: 'space-between',
                                                                                                    alignItems: 'center',
                                                                                                    color: meetsMinimum ? 'var(--text-primary)' : 'var(--color-danger)',
                                                                                                    fontWeight: 500
                                                                                                }}>
                                                                                                    <span>Minimum meals required: {vendorMinimum}</span>
                                                                                                    <span>
                                                                                                        Meals selected: <strong>{vendorMealCount}</strong>
                                                                                                    </span>
                                                                                                </div>
                                                                                                {!meetsMinimum && (
                                                                                                    <div style={{
                                                                                                        marginTop: '0.25rem',
                                                                                                        fontSize: '0.8rem',
                                                                                                        color: 'var(--color-danger)'
                                                                                                    }}>
                                                                                                        <AlertTriangle size={14} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'middle' }} />
                                                                                                        You must order at least {vendorMinimum} meals from {vendor?.name}
                                                                                                    </div>
                                                                                                )}
                                                                                            </div>
                                                                                        )}
                                                                                        <div className={styles.menuItems}>
                                                                                            {getVendorMenuItems(selection.vendorId).map((item) => {
                                                                                                // Get quantity from itemsByDay if it exists, otherwise from items
                                                                                                let qty = 0;
                                                                                                if (selection.itemsByDay && selection.selectedDeliveryDays) {
                                                                                                    // Sum up quantities across all selected delivery days
                                                                                                    for (const day of selection.selectedDeliveryDays) {
                                                                                                        const dayItems = selection.itemsByDay[day] || {};
                                                                                                        qty += Number(dayItems[item.id] || 0);
                                                                                                    }

                                                                                                } else {
                                                                                                    qty = Number(selection.items?.[item.id] || 0);
                                                                                                }
                                                                                                const upcomingQty = getUpcomingOrderQuantityForItem(item.id, selection.vendorId);
                                                                                                return (
                                                                                                    <div key={item.id} className={styles.menuItem}>
                                                                                                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                                                                                            <span>
                                                                                                                {item.name}
                                                                                                                {(item.quotaValue || 1) > 1 && (
                                                                                                                    <span style={{ color: 'var(--text-tertiary)', fontSize: '0.9em', marginLeft: '4px' }}>
                                                                                                                        (counts as {item.quotaValue || 1} meals)
                                                                                                                    </span>
                                                                                                                )}
                                                                                                                {upcomingQty > 0 && (
                                                                                                                    <span style={{ 
                                                                                                                        color: 'var(--color-primary)', 
                                                                                                                        fontSize: '0.85em', 
                                                                                                                        marginLeft: '6px',
                                                                                                                        fontWeight: 500,
                                                                                                                        backgroundColor: 'var(--bg-surface-hover)',
                                                                                                                        padding: '2px 6px',
                                                                                                                        borderRadius: 'var(--radius-sm)'
                                                                                                                    }}>
                                                                                                                        ({upcomingQty} in upcoming orders)
                                                                                                                    </span>
                                                                                                                )}
                                                                                                            </span>
                                                                                                            <div className={styles.quantityControl} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                                                                <button onClick={() => updateItemQuantity(index, item.id, Math.max(0, qty - 1), null)} className="btn btn-secondary" style={{ padding: '2px 8px' }}>-</button>
                                                                                                                <span style={{ width: '20px', textAlign: 'center' }}>{qty}</span>
                                                                                                                <button onClick={() => updateItemQuantity(index, item.id, qty + 1, null)} className="btn btn-secondary" style={{ padding: '2px 8px' }}>+</button>
                                                                                                            </div>
                                                                                                        </label>
                                                                                                    </div>
                                                                                                );
                                                                                            })}
                                                                                            {getVendorMenuItems(selection.vendorId).length === 0 && <span className={styles.hint}>No active menu items.</span>}
                                                                                        </div>
                                                                                    </>
                                                                                );
                                                                            })()}
                                                                        </div>
                                                                    );
                                                                })}
                                                                <button className="btn btn-secondary" onClick={() => addVendorBlock(null)} style={{ marginTop: '0.5rem' }}>
                                                                    <Plus size={16} /> Add Vendor
                                                                </button>
                                                            </div>
                                                        );
                                                    }
                                                    // Single form - show vendors with per-vendor delivery day selection
                                                    const currentSelections = getVendorSelectionsForDay(null);
                                                    return (
                                                        <div className={styles.vendorsList}>
                                                            {(currentSelections || []).map((selection: any, index: number) => {
                                                                const vendor = selection.vendorId ? vendors.find(v => v.id === selection.vendorId) : null;
                                                                const vendorHasMultipleDays = vendor && vendor.deliveryDays && vendor.deliveryDays.length > 1;
                                                                const vendorDeliveryDays = vendor?.deliveryDays || [];

                                                                // Get selected delivery days for this vendor
                                                                const vendorSelectedDays = (selection.selectedDeliveryDays || []) as string[];

                                                                return (
                                                                    <div key={index} className={styles.vendorBlock}>
                                                                        <div className={styles.vendorHeader}>
                                                                            <select
                                                                                className="input"
                                                                                value={selection.vendorId}
                                                                                onChange={e => updateVendorSelection(index, 'vendorId', e.target.value, null)}
                                                                            >
                                                                                <option value="">Select Vendor...</option>
                                                                                {vendors && vendors.length > 0 ? (() => {
                                                                                    // Debug logging for vendor filtering
                                                                                    console.log(`[ClientProfile] Food dropdown (single form) - Total vendors: ${vendors.length}`);
                                                                                    const filteredVendors = vendors.filter(v => {
                                                                                        // Check if vendor has Food service type
                                                                                        const hasFoodService = v.serviceTypes && Array.isArray(v.serviceTypes) && v.serviceTypes.includes('Food');
                                                                                        const isActive = v.isActive !== undefined ? v.isActive : true;
                                                                                        return hasFoodService && isActive;
                                                                                    });
                                                                                    console.log(`[ClientProfile] Food dropdown (single form) - Filtered vendors: ${filteredVendors.length}`, filteredVendors.map(v => ({ id: v.id, name: v.name, serviceTypes: v.serviceTypes, isActive: v.isActive })));
                                                                                    
                                                                                    // Fallback: if no vendors have Food service type, show all active vendors
                                                                                    const vendorsToShow = filteredVendors.length > 0 
                                                                                        ? filteredVendors 
                                                                                        : vendors.filter(v => v.isActive !== undefined ? v.isActive : true);
                                                                                    
                                                                                    if (filteredVendors.length === 0 && vendors.length > 0) {
                                                                                        console.warn('[ClientProfile] Food dropdown (single form) - No vendors with Food service type found. Showing all active vendors instead. All vendors:', vendors.map(v => ({ id: v.id, name: v.name, serviceTypes: v.serviceTypes, isActive: v.isActive })));
                                                                                    }
                                                                                    return vendorsToShow.map(v => (
                                                                                        <option key={v.id} value={v.id} disabled={currentSelections.some((s: any, i: number) => i !== index && s.vendorId === v.id)}>
                                                                                            {v.name}
                                                                                        </option>
                                                                                    ));
                                                                                })() : <option value="" disabled>Loading vendors...</option>}
                                                                            </select>
                                                                            <button className={`${styles.iconBtn} ${styles.danger}`} onClick={() => removeVendorBlock(index, null)} title="Remove Vendor">
                                                                                <Trash2 size={16} />
                                                                            </button>
                                                                        </div>

                                                                        {selection.vendorId && vendorHasMultipleDays && (
                                                                            <div style={{
                                                                                marginBottom: '1rem',
                                                                                padding: '0.75rem',
                                                                                backgroundColor: 'var(--bg-surface-hover)',
                                                                                borderRadius: 'var(--radius-sm)',
                                                                                border: '1px solid var(--border-color)'
                                                                            }}>
                                                                                <div style={{
                                                                                    display: 'flex',
                                                                                    alignItems: 'center',
                                                                                    gap: '0.5rem',
                                                                                    marginBottom: '0.75rem',
                                                                                    fontSize: '0.9rem',
                                                                                    fontWeight: 500
                                                                                }}>
                                                                                    <Calendar size={16} />
                                                                                    <span>Select delivery days for {vendor?.name}:</span>
                                                                                </div>
                                                                                <div style={{
                                                                                    display: 'flex',
                                                                                    flexWrap: 'wrap',
                                                                                    gap: '0.5rem'
                                                                                }}>
                                                                                    {vendorDeliveryDays.map((day: string) => {
                                                                                        const isSelected = vendorSelectedDays.includes(day);
                                                                                        return (
                                                                                            <button
                                                                                                key={day}
                                                                                                type="button"
                                                                                                onClick={() => {
                                                                                                    const newSelected = isSelected
                                                                                                        ? vendorSelectedDays.filter((d: string) => d !== day)
                                                                                                        : [...vendorSelectedDays, day];

                                                                                                    // Update selection with new delivery days
                                                                                                    const updated = [...currentSelections];
                                                                                                    updated[index] = {
                                                                                                        ...updated[index],
                                                                                                        selectedDeliveryDays: newSelected,
                                                                                                        // Initialize items for each selected day
                                                                                                        itemsByDay: (() => {
                                                                                                            const itemsByDay = { ...(updated[index].itemsByDay || {}) };
                                                                                                            if (!isSelected) {
                                                                                                                // Adding a day - initialize empty items
                                                                                                                itemsByDay[day] = {};
                                                                                                            } else {
                                                                                                                // Removing a day - clean up
                                                                                                                delete itemsByDay[day];
                                                                                                            }
                                                                                                            return itemsByDay;
                                                                                                        })()
                                                                                                    };
                                                                                                    setOrderConfig({
                                                                                                        ...orderConfig,
                                                                                                        vendorSelections: updated
                                                                                                    });
                                                                                                }}
                                                                                                style={{
                                                                                                    padding: '0.5rem 1rem',
                                                                                                    borderRadius: 'var(--radius-sm)',
                                                                                                    border: `2px solid ${isSelected ? 'var(--color-primary)' : 'var(--border-color)'}`,
                                                                                                    backgroundColor: isSelected ? 'var(--color-primary)' : 'var(--bg-app)',
                                                                                                    color: isSelected ? 'white' : 'var(--text-primary)',
                                                                                                    cursor: 'pointer',
                                                                                                    fontSize: '0.85rem',
                                                                                                    fontWeight: isSelected ? 600 : 400,
                                                                                                    transition: 'all 0.2s'
                                                                                                }}
                                                                                            >
                                                                                                {day}
                                                                                                {isSelected && <Check size={14} style={{ marginLeft: '0.25rem', display: 'inline', verticalAlign: 'middle' }} />}
                                                                                            </button>
                                                                                        );
                                                                                    })}
                                                                                </div>
                                                                            </div>
                                                                        )}

                                                                        {selection.vendorId && (() => {
                                                                            const vendorMinimum = vendor?.minimumMeals || 0;

                                                                            // If vendor has multiple days but no days are selected, don't show menu items
                                                                            if (vendorHasMultipleDays && vendorSelectedDays.length === 0) {
                                                                                return null;
                                                                            }

                                                                            // If vendor has multiple days and days are selected, show forms for each day
                                                                            if (vendorHasMultipleDays && vendorSelectedDays.length > 0) {
                                                                                return (
                                                                                    <>
                                                                                        {vendorSelectedDays.map((day: string) => {
                                                                                            const dayItems = (selection.itemsByDay || {})[day] || {};
                                                                                            const dayMealCount = Object.values(dayItems).reduce((sum: number, qty: any) => sum + (Number(qty) || 0), 0);
                                                                                            const meetsMinimum = vendorMinimum === 0 || dayMealCount >= vendorMinimum;

                                                                                            return (
                                                                                                <div key={day} style={{
                                                                                                    marginBottom: '1.5rem',
                                                                                                    padding: '1rem',
                                                                                                    border: '1px solid var(--border-color)',
                                                                                                    borderRadius: 'var(--radius-md)',
                                                                                                    backgroundColor: 'var(--bg-surface-hover)'
                                                                                                }}>
                                                                                                    <div style={{
                                                                                                        display: 'flex',
                                                                                                        alignItems: 'center',
                                                                                                        justifyContent: 'space-between',
                                                                                                        marginBottom: '0.75rem',
                                                                                                        paddingBottom: '0.75rem',
                                                                                                        borderBottom: '1px solid var(--border-color)'
                                                                                                    }}>
                                                                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                                                            <Calendar size={16} />
                                                                                                            <strong>{day}</strong>
                                                                                                        </div>
                                                                                                        {vendorMinimum > 0 && (
                                                                                                            <div style={{
                                                                                                                fontSize: '0.85rem',
                                                                                                                color: meetsMinimum ? 'var(--text-primary)' : 'var(--color-danger)',
                                                                                                                fontWeight: 500
                                                                                                            }}>
                                                                                                                Meals: {dayMealCount} / {vendorMinimum} min
                                                                                                            </div>
                                                                                                        )}
                                                                                                    </div>

                                                                                                    {vendorMinimum > 0 && !meetsMinimum && (
                                                                                                        <div style={{
                                                                                                            marginBottom: '0.75rem',
                                                                                                            padding: '0.5rem',
                                                                                                            backgroundColor: 'rgba(239, 68, 68, 0.1)',
                                                                                                            borderRadius: 'var(--radius-sm)',
                                                                                                            border: '1px solid var(--color-danger)',
                                                                                                            fontSize: '0.8rem',
                                                                                                            color: 'var(--color-danger)'
                                                                                                        }}>
                                                                                                            <AlertTriangle size={14} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'middle' }} />
                                                                                                            Minimum {vendorMinimum} meals required for {day}
                                                                                                        </div>
                                                                                                    )}

                                                                                                    <div className={styles.menuItems}>
                                                                                                        {getVendorMenuItems(selection.vendorId).map((item) => {
                                                                                                            const qty = Number(dayItems[item.id] || 0);
                                                                                                            const upcomingQty = getUpcomingOrderQuantityForItem(item.id, selection.vendorId);
                                                                                                            return (
                                                                                                                <div key={item.id} className={styles.menuItem}>
                                                                                                                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                                                                                                        <span>
                                                                                                                            {item.name}
                                                                                                                            {(item.quotaValue || 1) > 1 && (
                                                                                                                                <span style={{ color: 'var(--text-tertiary)', fontSize: '0.9em', marginLeft: '4px' }}>
                                                                                                                                    (counts as {item.quotaValue || 1} meals)
                                                                                                                                </span>
                                                                                                                            )}
                                                                                                                            {upcomingQty > 0 && (
                                                                                                                                <span style={{ 
                                                                                                                                    color: 'var(--color-primary)', 
                                                                                                                                    fontSize: '0.85em', 
                                                                                                                                    marginLeft: '6px',
                                                                                                                                    fontWeight: 500,
                                                                                                                                    backgroundColor: 'var(--bg-surface-hover)',
                                                                                                                                    padding: '2px 6px',
                                                                                                                                    borderRadius: 'var(--radius-sm)'
                                                                                                                                }}>
                                                                                                                                    ({upcomingQty} in upcoming orders)
                                                                                                                                </span>
                                                                                                                            )}
                                                                                                                        </span>
                                                                                                                        <div className={styles.quantityControl} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                                                                            <button onClick={() => {
                                                                                                                                const updated = [...currentSelections];
                                                                                                                                const itemsByDay = { ...(updated[index].itemsByDay || {}) };
                                                                                                                                if (!itemsByDay[day]) itemsByDay[day] = {};
                                                                                                                                const newQty = Math.max(0, qty - 1);
                                                                                                                                if (newQty > 0) {
                                                                                                                                    itemsByDay[day][item.id] = newQty;
                                                                                                                                } else {
                                                                                                                                    delete itemsByDay[day][item.id];
                                                                                                                                }
                                                                                                                                updated[index] = {
                                                                                                                                    ...updated[index],
                                                                                                                                    itemsByDay
                                                                                                                                };
                                                                                                                                setOrderConfig({
                                                                                                                                    ...orderConfig,
                                                                                                                                    vendorSelections: updated
                                                                                                                                });
                                                                                                                            }} className="btn btn-secondary" style={{ padding: '2px 8px' }}>-</button>
                                                                                                                            <span style={{ width: '20px', textAlign: 'center' }}>{qty}</span>
                                                                                                                            <button onClick={() => {
                                                                                                                                const updated = [...currentSelections];
                                                                                                                                const itemsByDay = { ...(updated[index].itemsByDay || {}) };
                                                                                                                                if (!itemsByDay[day]) itemsByDay[day] = {};
                                                                                                                                itemsByDay[day][item.id] = qty + 1;
                                                                                                                                updated[index] = {
                                                                                                                                    ...updated[index],
                                                                                                                                    itemsByDay
                                                                                                                                };
                                                                                                                                setOrderConfig({
                                                                                                                                    ...orderConfig,
                                                                                                                                    vendorSelections: updated
                                                                                                                                });
                                                                                                                            }} className="btn btn-secondary" style={{ padding: '2px 8px' }}>+</button>
                                                                                                                        </div>
                                                                                                                    </label>
                                                                                                                </div>
                                                                                                            );
                                                                                                        })}
                                                                                                        {getVendorMenuItems(selection.vendorId).length === 0 && <span className={styles.hint}>No active menu items.</span>}
                                                                                                    </div>
                                                                                                </div>
                                                                                            );
                                                                                        })}
                                                                                    </>
                                                                                );
                                                                            }

                                                                            // Single delivery day or no multiple days - show normal item selection
                                                                            const vendorMealCount = getVendorMealCount(selection.vendorId, selection);
                                                                            const meetsMinimum = vendorMinimum === 0 || vendorMealCount >= vendorMinimum;

                                                                            return (
                                                                                <>
                                                                                    {vendorMinimum > 0 && (
                                                                                        <div style={{
                                                                                            marginBottom: '0.75rem',
                                                                                            padding: '0.5rem 0.75rem',
                                                                                            backgroundColor: meetsMinimum ? 'var(--bg-surface-hover)' : 'rgba(239, 68, 68, 0.1)',
                                                                                            borderRadius: 'var(--radius-sm)',
                                                                                            border: `1px solid ${meetsMinimum ? 'var(--border-color)' : 'var(--color-danger)'}`,
                                                                                            fontSize: '0.85rem'
                                                                                        }}>
                                                                                            <div style={{
                                                                                                display: 'flex',
                                                                                                justifyContent: 'space-between',
                                                                                                alignItems: 'center',
                                                                                                color: meetsMinimum ? 'var(--text-primary)' : 'var(--color-danger)',
                                                                                                fontWeight: 500
                                                                                            }}>
                                                                                                <span>Minimum meals required: {vendorMinimum}</span>
                                                                                                <span>
                                                                                                    Meals selected: <strong>{vendorMealCount}</strong>
                                                                                                </span>
                                                                                            </div>
                                                                                            {!meetsMinimum && (
                                                                                                <div style={{
                                                                                                    marginTop: '0.25rem',
                                                                                                    fontSize: '0.8rem',
                                                                                                    color: 'var(--color-danger)'
                                                                                                }}>
                                                                                                    <AlertTriangle size={14} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'middle' }} />
                                                                                                    You must order at least {vendorMinimum} meals from {vendor?.name}
                                                                                                </div>
                                                                                            )}
                                                                                        </div>
                                                                                    )}
                                                                                    <div className={styles.menuItems}>
                                                                                        {getVendorMenuItems(selection.vendorId).map((item) => {
                                                                                            // Get quantity from itemsByDay if it exists, otherwise from items
                                                                                            let qty = 0;
                                                                                            if (selection.itemsByDay && selection.selectedDeliveryDays) {
                                                                                                // Sum up quantities across all selected delivery days
                                                                                                for (const day of selection.selectedDeliveryDays) {
                                                                                                    const dayItems = selection.itemsByDay[day] || {};
                                                                                                    qty += Number(dayItems[item.id] || 0);
                                                                                                }

                                                                                            } else {
                                                                                                qty = Number(selection.items?.[item.id] || 0);
                                                                                            }
                                                                                            const upcomingQty = getUpcomingOrderQuantityForItem(item.id, selection.vendorId);
                                                                                            return (
                                                                                                <div key={item.id} className={styles.menuItem}>
                                                                                                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                                                                                                        <span>
                                                                                                            {item.name}
                                                                                                            {(item.quotaValue || 1) > 1 && (
                                                                                                                <span style={{ color: 'var(--text-tertiary)', fontSize: '0.9em', marginLeft: '4px' }}>
                                                                                                                    (counts as {item.quotaValue || 1} meals)
                                                                                                                </span>
                                                                                                            )}
                                                                                                            {upcomingQty > 0 && (
                                                                                                                <span style={{ 
                                                                                                                    color: 'var(--color-primary)', 
                                                                                                                    fontSize: '0.85em', 
                                                                                                                    marginLeft: '6px',
                                                                                                                    fontWeight: 500,
                                                                                                                    backgroundColor: 'var(--bg-surface-hover)',
                                                                                                                    padding: '2px 6px',
                                                                                                                    borderRadius: 'var(--radius-sm)'
                                                                                                                }}>
                                                                                                                    ({upcomingQty} in upcoming orders)
                                                                                                                </span>
                                                                                                            )}
                                                                                                        </span>
                                                                                                        <div className={styles.quantityControl} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                                                            <button onClick={() => updateItemQuantity(index, item.id, Math.max(0, qty - 1), null)} className="btn btn-secondary" style={{ padding: '2px 8px' }}>-</button>
                                                                                                            <span style={{ width: '20px', textAlign: 'center' }}>{qty}</span>
                                                                                                            <button onClick={() => updateItemQuantity(index, item.id, qty + 1, null)} className="btn btn-secondary" style={{ padding: '2px 8px' }}>+</button>
                                                                                                        </div>
                                                                                                    </label>
                                                                                                </div>
                                                                                            );
                                                                                        })}
                                                                                        {getVendorMenuItems(selection.vendorId).length === 0 && <span className={styles.hint}>No active menu items.</span>}
                                                                                    </div>
                                                                                </>
                                                                            );
                                                                        })()}
                                                                    </div>
                                                                );
                                                            })}
                                                            <button className="btn btn-secondary" onClick={() => addVendorBlock(null)} style={{ marginTop: '0.5rem' }}>
                                                                <Plus size={16} /> Add Vendor
                                                            </button>
                                                        </div>
                                                    );
                                                })()}
                                            </div>
                                        )}

                                        {formData.serviceType === 'Boxes' && (() => {
                                            const currentBoxes = orderConfig.boxOrders || [];

                                            return (
                                                <div className="animate-fade-in">
                                                    {/* Display items from all existing upcoming Boxes orders */}
                                                    {allUpcomingOrders.length > 0 && (() => {
                                                        // Helper function to extract items from Boxes orders
                                                        const extractItemsFromBoxOrder = (order: any): Array<{ itemId: string; itemName: string; quantity: number; vendorName: string; orderId?: string }> => {
                                                            const items: Array<{ itemId: string; itemName: string; quantity: number; vendorName: string; orderId?: string }> = [];
                                                            
                                                            if (order.serviceType === 'Boxes') {
                                                                // Handle boxOrders array structure (new format) - prioritize this
                                                                if (order.boxOrders && Array.isArray(order.boxOrders) && order.boxOrders.length > 0) {
                                                                    order.boxOrders.forEach((box: any) => {
                                                                        const boxVendorId = box.vendorId || order.vendorId;
                                                                        const vendor = vendors.find(v => v.id === boxVendorId);
                                                                        const vendorName = vendor?.name || 'Unknown Vendor';
                                                                        
                                                                        if (box.items && typeof box.items === 'object' && !Array.isArray(box.items)) {
                                                                            Object.entries(box.items).forEach(([itemId, qty]: [string, any]) => {
                                                                                const menuItem = menuItems.find(mi => mi.id === itemId);
                                                                                const itemName = menuItem?.name || 'Unknown Item';
                                                                                // Handle both number and object with quantity property
                                                                                const quantity = typeof qty === 'number' 
                                                                                    ? Number(qty) 
                                                                                    : (typeof qty === 'object' && qty && 'quantity' in qty ? Number((qty as any).quantity) : 0);
                                                                                
                                                                                if (quantity > 0) {
                                                                                    items.push({
                                                                                        itemId,
                                                                                        itemName,
                                                                                        quantity,
                                                                                        vendorName,
                                                                                        orderId: order.id
                                                                                    });
                                                                                }
                                                                            });
                                                                        }
                                                                    });
                                                                }
                                                                // Handle legacy items structure (flat format on order object)
                                                                else if (order.items) {
                                                                    const orderVendorId = order.vendorId;
                                                                    const vendor = vendors.find(v => v.id === orderVendorId);
                                                                    const vendorName = vendor?.name || 'Unknown Vendor';
                                                                    
                                                                    if (typeof order.items === 'object' && !Array.isArray(order.items)) {
                                                                        Object.entries(order.items).forEach(([itemId, qty]: [string, any]) => {
                                                                            const menuItem = menuItems.find(mi => mi.id === itemId);
                                                                            const itemName = menuItem?.name || 'Unknown Item';
                                                                            // Handle both number and object with quantity property
                                                                            const quantity = typeof qty === 'number' 
                                                                                ? Number(qty) 
                                                                                : (typeof qty === 'object' && qty && 'quantity' in qty ? Number((qty as any).quantity) : 0);
                                                                            
                                                                            if (quantity > 0) {
                                                                                items.push({
                                                                                    itemId,
                                                                                    itemName,
                                                                                    quantity,
                                                                                    vendorName,
                                                                                    orderId: order.id
                                                                                });
                                                                            }
                                                                        });
                                                                    }
                                                                }
                                                            }
                                                            
                                                            return items;
                                                        };

                                                        // Filter orders by selected profile (caseId) if present
                                                        const currentCaseId = orderConfig?.caseId;
                                                        const filteredOrders = currentCaseId 
                                                            ? allUpcomingOrders.filter((order: any) => order.caseId === currentCaseId)
                                                            : allUpcomingOrders;

                                                        // Collect all items from filtered upcoming Boxes orders
                                                        const allBoxItems: Array<{ itemId: string; itemName: string; quantity: number; vendorName: string; orderId?: string }> = [];
                                                        filteredOrders.forEach((order) => {
                                                            if (order.serviceType === 'Boxes') {
                                                                const orderItems = extractItemsFromBoxOrder(order);
                                                                orderItems.forEach(item => {
                                                                    allBoxItems.push(item);
                                                                });
                                                            }
                                                        });

                                                        // Group items by itemId and vendor, summing quantities
                                                        const itemMap = new Map<string, { itemId: string; itemName: string; quantity: number; vendorName: string; orderIds: Set<string> }>();
                                                        allBoxItems.forEach(item => {
                                                            const key = `${item.itemId}-${item.vendorName}`;
                                                            if (itemMap.has(key)) {
                                                                const existing = itemMap.get(key)!;
                                                                existing.quantity += item.quantity;
                                                                if (item.orderId) {
                                                                    existing.orderIds.add(item.orderId);
                                                                }
                                                            } else {
                                                                itemMap.set(key, {
                                                                    itemId: item.itemId,
                                                                    itemName: item.itemName,
                                                                    quantity: item.quantity,
                                                                    vendorName: item.vendorName,
                                                                    orderIds: new Set(item.orderId ? [item.orderId] : [])
                                                                });
                                                            }
                                                        });

                                                        const groupedItems = Array.from(itemMap.values());

                                                        if (groupedItems.length > 0) {
                                                            return (
                                                                <div style={{
                                                                    marginBottom: 'var(--spacing-md)',
                                                                    padding: 'var(--spacing-md)',
                                                                    backgroundColor: 'var(--bg-surface-hover)',
                                                                    borderRadius: 'var(--radius-md)',
                                                                    border: '1px solid var(--border-color)'
                                                                }}>
                                                                    <div style={{
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        gap: '0.5rem',
                                                                        marginBottom: 'var(--spacing-sm)',
                                                                        fontSize: '0.9rem',
                                                                        fontWeight: 600,
                                                                        color: 'var(--text-secondary)'
                                                                    }}>
                                                                        <ShoppingCart size={16} />
                                                                        <span>Selected Upcoming Box Orders Items</span>
                                                                    </div>
                                                                    <div style={{
                                                                        display: 'flex',
                                                                        flexDirection: 'column',
                                                                        gap: '0.5rem'
                                                                    }}>
                                                                        {groupedItems.map((item, idx) => (
                                                                            <div key={`${item.itemId}-${item.vendorName}-${idx}`} style={{
                                                                                display: 'flex',
                                                                                justifyContent: 'space-between',
                                                                                alignItems: 'center',
                                                                                padding: '0.5rem',
                                                                                backgroundColor: 'var(--bg-app)',
                                                                                borderRadius: 'var(--radius-sm)',
                                                                                fontSize: '0.85rem'
                                                                            }}>
                                                                                <div style={{ flex: 1 }}>
                                                                                    <div style={{ fontWeight: 500 }}>
                                                                                        {item.itemName}
                                                                                    </div>
                                                                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: '0.25rem' }}>
                                                                                        {item.vendorName}
                                                                                        {item.orderIds.size > 0 && (
                                                                                            <span style={{ marginLeft: '0.5rem' }}>
                                                                                                ({item.orderIds.size} order{item.orderIds.size > 1 ? 's' : ''})
                                                                                            </span>
                                                                                        )}
                                                                                    </div>
                                                                                </div>
                                                                                <div style={{
                                                                                    fontWeight: 600,
                                                                                    color: 'var(--color-primary)',
                                                                                    minWidth: '40px',
                                                                                    textAlign: 'right'
                                                                                }}>
                                                                                    {item.quantity}
                                                                                </div>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            );
                                                        }
                                                        return null;
                                                    })()}

                                                    {currentBoxes.map((box: any, index: number) => {
                                                        // Compute vendorId (similar to sidebar logic: check box.vendorId, fallback to boxType.vendorId)
                                                        const boxDef = boxTypes.find(b => b.id === box.boxTypeId);
                                                        const computedVendorId = box.vendorId || boxDef?.vendorId;
                                                        
                                                        return (
                                                        <div key={index} style={{
                                                            marginBottom: '2rem',
                                                            padding: '1.5rem',
                                                            backgroundColor: 'var(--bg-surface)',
                                                            border: '1px solid var(--border-color)',
                                                            borderRadius: 'var(--radius-md)',
                                                            position: 'relative'
                                                        }}>
                                                            <div style={{
                                                                display: 'flex',
                                                                justifyContent: 'space-between',
                                                                alignItems: 'center',
                                                                marginBottom: '1rem',
                                                                borderBottom: '1px solid var(--border-color)',
                                                                paddingBottom: '0.5rem'
                                                            }}>
                                                                <h4 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                    <Package size={16} /> Box #{index + 1}
                                                                </h4>
                                                                {currentBoxes.length > 1 && (
                                                                    <button
                                                                        type="button"
                                                                        className="btn btn-ghost btn-sm"
                                                                        onClick={() => handleRemoveBox(index)}
                                                                        style={{ color: 'var(--color-danger)', fontSize: '0.8rem', padding: '4px 8px' }}
                                                                    >
                                                                        <Trash2 size={14} style={{ marginRight: '4px' }} /> Remove
                                                                    </button>
                                                                )}
                                                            </div>

                                                            <div className={styles.formGroup}>
                                                                <label className="label">Vendor <span style={{ color: 'var(--color-danger)' }}>*</span></label>
                                                                {/* Display selected vendor name (similar to sidebar logic) */}
                                                                {computedVendorId && (() => {
                                                                    // Get vendor name from vendors array (similar to sidebar)
                                                                    const vendorName = vendors.find(v => v.id === computedVendorId)?.name || 'Unknown Vendor';
                                                                    return (
                                                                        <div style={{
                                                                            marginBottom: '0.5rem',
                                                                            padding: '0.5rem',
                                                                            backgroundColor: 'var(--bg-surface-hover)',
                                                                            borderRadius: 'var(--radius-sm)',
                                                                            border: '1px solid var(--border-color)',
                                                                            fontSize: '0.9rem',
                                                                            fontWeight: 500,
                                                                            color: 'var(--text-primary)'
                                                                        }}>
                                                                            Selected: <strong>{vendorName}</strong>
                                                                        </div>
                                                                    );
                                                                })()}
                                                                <select
                                                                    className="input"
                                                                    value={box.vendorId || ''}
                                                                    onChange={e => handleBoxUpdate(index, 'vendorId', e.target.value)}
                                                                    required
                                                                >
                                                                    <option value="">Select Vendor...</option>
                                                                    {vendors.filter(v => v.serviceTypes.includes('Boxes') && v.isActive).map(v => (
                                                                        <option key={v.id} value={v.id}>{v.name}</option>
                                                                    ))}
                                                                </select>
                                                            </div>

                                                            {/* Take Effect Date for this vendor */}
                                                            {computedVendorId && settings && (() => {
                                                                const nextDate = getNextDeliveryDateForVendor(computedVendorId);

                                                                if (nextDate) {
                                                                    const takeEffect = getTakeEffectDate(settings, new Date(nextDate));
                                                                    return (
                                                                        <div style={{
                                                                            marginTop: 'var(--spacing-md)',
                                                                            padding: '0.75rem',
                                                                            backgroundColor: 'var(--bg-surface-hover)',
                                                                            borderRadius: 'var(--radius-sm)',
                                                                            border: '1px solid var(--border-color)',
                                                                            fontSize: '0.85rem',
                                                                            color: 'var(--text-secondary)',
                                                                            textAlign: 'center'
                                                                        }}>
                                                                            Changes may not take effect till next week
                                                                        </div>
                                                                    );
                                                                }

                                                                return (
                                                                    <div style={{
                                                                        marginTop: 'var(--spacing-md)',
                                                                        padding: '0.75rem',
                                                                        backgroundColor: 'rgba(239, 68, 68, 0.1)',
                                                                        borderRadius: 'var(--radius-sm)',
                                                                        border: '1px solid var(--color-danger)',
                                                                        fontSize: '0.85rem',
                                                                        color: 'var(--color-danger)',
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        gap: '0.5rem',
                                                                        textAlign: 'center',
                                                                        justifyContent: 'center'
                                                                    }}>
                                                                        <AlertTriangle size={16} />
                                                                        <span><strong>Warning:</strong> This vendor has no delivery days configured. Orders will NOT be created.</span>
                                                                    </div>
                                                                );
                                                            })()}

                                                            {/* Box Content Selection */}
                                                            <div style={{ marginTop: '1rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>

                                                                {/* Check if vendor has delivery days */}
                                                                {computedVendorId && !getNextDeliveryDateForVendor(computedVendorId) ? (
                                                                    <div style={{
                                                                        padding: '1.5rem',
                                                                        backgroundColor: 'var(--bg-surface-active)',
                                                                        borderRadius: 'var(--radius-md)',
                                                                        border: '1px dashed var(--color-danger)',
                                                                        color: 'var(--text-secondary)',
                                                                        textAlign: 'center',
                                                                        display: 'flex',
                                                                        flexDirection: 'column',
                                                                        alignItems: 'center',
                                                                        gap: '0.5rem',
                                                                        opacity: 0.7
                                                                    }}>
                                                                        <AlertTriangle size={24} color="var(--color-danger)" />
                                                                        <span style={{ color: 'var(--color-danger)', fontWeight: 600 }}>Action Required</span>
                                                                        <span style={{ fontSize: '0.9rem' }}>
                                                                            Please configure <strong>Delivery Days</strong> for this vendor in Settings before adding items.
                                                                        </span>
                                                                    </div>
                                                                ) : (
                                                                    <>
                                                                        {/* Show all categories with box items */}
                                                                        {categories.map(category => {
                                                                            // Filter items for this category
                                                                            const availableItems = menuItems.filter(i =>
                                                                                (i.vendorId === null || i.vendorId === '') &&
                                                                                i.isActive &&
                                                                                i.categoryId === category.id
                                                                            );

                                                                            if (availableItems.length === 0) return null;

                                                                            // Parse and normalize box.items (handles JSON strings and object quantity formats)
                                                                            // Similar logic to SidebarActiveOrderSummary.tsx
                                                                            const parsedItems = parseBoxItems(box.items);
                                                                            const selectedItems = parsedItems || {};

                                                                            // Calculate quota for THIS box/category
                                                                            let categoryQuotaValue = 0;
                                                                            Object.entries(selectedItems).forEach(([itemId, qty]) => {
                                                                                const item = menuItems.find(i => i.id === itemId);
                                                                                if (item && item.categoryId === category.id) {
                                                                                    const itemQuotaValue = item.quotaValue || 1;
                                                                                    categoryQuotaValue += (qty as number) * itemQuotaValue;
                                                                                }
                                                                            });

                                                                            let requiredQuotaValue: number | null = null;
                                                                            if (category.setValue !== undefined && category.setValue !== null) {
                                                                                requiredQuotaValue = category.setValue;
                                                                            } else if (box.boxTypeId) {
                                                                                const quota = boxQuotas.find(q => q.boxTypeId === box.boxTypeId && q.categoryId === category.id);
                                                                                if (quota) {
                                                                                    requiredQuotaValue = quota.targetValue;
                                                                                }
                                                                            }
                                                                            const meetsQuota = requiredQuotaValue !== null ? isMeetingExactTarget(categoryQuotaValue, requiredQuotaValue) : true;

                                                                            return (
                                                                                <div key={category.id} style={{ marginBottom: '1rem', background: 'var(--bg-surface-hover)', padding: '0.75rem', borderRadius: '6px', border: requiredQuotaValue !== null && !meetsQuota ? '2px solid var(--color-danger)' : '1px solid var(--border-color)' }}>
                                                                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.85rem' }}>
                                                                                        <span style={{ fontWeight: 600 }}>{category.name}</span>
                                                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                                            {requiredQuotaValue !== null && (
                                                                                                <span style={{
                                                                                                    color: meetsQuota ? 'var(--color-success)' : 'var(--color-danger)',
                                                                                                    fontSize: '0.8rem',
                                                                                                    fontWeight: 500
                                                                                                }}>
                                                                                                    Quota: {categoryQuotaValue} / {requiredQuotaValue}
                                                                                                </span>
                                                                                            )}
                                                                                            {categoryQuotaValue > 0 && requiredQuotaValue === null && (
                                                                                                <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                                                                                                    Total: {categoryQuotaValue}
                                                                                                </span>
                                                                                            )}
                                                                                        </div>
                                                                                    </div>

                                                                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
                                                                                        {availableItems.map(item => {
                                                                                            const qty = Number(selectedItems[item.id] || 0);
                                                                                            const note = box.itemNotes?.[item.id] || '';
                                                                                            const isSelected = qty > 0;
                                                                                            const upcomingQty = getUpcomingOrderQuantityForBoxItem(item.id, computedVendorId);

                                                                                            return (
                                                                                                <div key={item.id} style={{
                                                                                                    border: isSelected ? '1px solid var(--color-primary)' : '1px solid var(--border-color)',
                                                                                                    backgroundColor: isSelected ? 'rgba(var(--color-primary-rgb), 0.05)' : 'var(--bg-app)',
                                                                                                    borderRadius: '8px',
                                                                                                    padding: '12px',
                                                                                                    display: 'flex',
                                                                                                    flexDirection: 'column',
                                                                                                    gap: '10px',
                                                                                                    transition: 'all 0.2s ease',
                                                                                                    boxShadow: isSelected ? '0 2px 4px rgba(0,0,0,0.05)' : 'none'
                                                                                                }}>
                                                                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
                                                                                                        <div style={{ flex: 1 }}>
                                                                                                            <div style={{ fontWeight: 600, fontSize: '0.9rem', color: isSelected ? 'var(--color-primary)' : 'var(--text-primary)' }}>
                                                                                                                {item.name}
                                                                                                            </div>
                                                                                                            {(item.quotaValue || 1) !== 1 && (
                                                                                                                <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                                                                                                                    Counts as {item.quotaValue} meals
                                                                                                                </div>
                                                                                                            )}
                                                                                                            {upcomingQty > 0 && (
                                                                                                                <div style={{ 
                                                                                                                    color: 'var(--color-primary)', 
                                                                                                                    fontSize: '0.85em', 
                                                                                                                    marginTop: '4px',
                                                                                                                    fontWeight: 500,
                                                                                                                    backgroundColor: 'var(--bg-surface-hover)',
                                                                                                                    padding: '2px 6px',
                                                                                                                    borderRadius: 'var(--radius-sm)',
                                                                                                                    display: 'inline-block'
                                                                                                                }}>
                                                                                                                    ({upcomingQty} in upcoming orders)
                                                                                                                </div>
                                                                                                            )}
                                                                                                        </div>
                                                                                                        <div className={styles.quantityControl} style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: 'var(--bg-surface)', padding: '2px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                                                                                                            <button
                                                                                                                onClick={() => handleBoxItemUpdate(index, item.id, Math.max(0, qty - 1), note)}
                                                                                                                className="btn btn-ghost btn-sm"
                                                                                                                style={{ width: '24px', height: '24px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                                                                                                disabled={qty === 0}
                                                                                                            >
                                                                                                                -
                                                                                                            </button>
                                                                                                            <span style={{ width: '24px', textAlign: 'center', fontWeight: 600, fontSize: '0.9rem' }}>{qty}</span>
                                                                                                            <button
                                                                                                                onClick={() => handleBoxItemUpdate(index, item.id, qty + 1, note)}
                                                                                                                className="btn btn-ghost btn-sm"
                                                                                                                style={{ width: '24px', height: '24px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                                                                                            >
                                                                                                                +
                                                                                                            </button>
                                                                                                        </div>
                                                                                                    </div>

                                                                                                    {isSelected && (
                                                                                                        <div style={{ marginTop: '0px' }}>
                                                                                                            <TextareaAutosize
                                                                                                                minRows={1}
                                                                                                                placeholder="Add notes for this item..."
                                                                                                                value={note}
                                                                                                                onChange={(e) => handleBoxItemUpdate(index, item.id, qty, e.target.value)}
                                                                                                                style={{
                                                                                                                    width: '100%',
                                                                                                                    fontSize: '0.85rem',
                                                                                                                    padding: '6px 8px',
                                                                                                                    borderRadius: '6px',
                                                                                                                    border: '1px solid rgba(0,0,0,0.1)',
                                                                                                                    backgroundColor: 'rgba(255,255,255,0.5)',
                                                                                                                    resize: 'none'
                                                                                                                }}
                                                                                                            />
                                                                                                        </div>
                                                                                                    )}
                                                                                                </div>
                                                                                            );
                                                                                        })}
                                                                                    </div>
                                                                                </div>
                                                                            );
                                                                        })}

                                                                        {/* Show uncategorized items if any */}
                                                                        {(() => {
                                                                            const uncategorizedItems = menuItems.filter(i =>
                                                                                (i.vendorId === null || i.vendorId === '') &&
                                                                                i.isActive &&
                                                                                (!i.categoryId || i.categoryId === '')
                                                                            );

                                                                            if (uncategorizedItems.length === 0) return null;

                                                                            // Parse and normalize box.items (handles JSON strings and object quantity formats)
                                                                            // Similar logic to SidebarActiveOrderSummary.tsx
                                                                            const parsedItems = parseBoxItems(box.items);
                                                                            const selectedItems = parsedItems || {};

                                                                            return (
                                                                                <div style={{ marginBottom: '1rem', background: 'var(--bg-surface-hover)', padding: '0.75rem', borderRadius: '6px' }}>
                                                                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.85rem' }}>
                                                                                        <span style={{ fontWeight: 600 }}>Uncategorized</span>
                                                                                    </div>

                                                                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
                                                                                        {uncategorizedItems.map(item => {
                                                                                            const qty = Number(selectedItems[item.id] || 0);
                                                                                            const note = box.itemNotes?.[item.id] || '';
                                                                                            const isSelected = qty > 0;
                                                                                            const upcomingQty = getUpcomingOrderQuantityForBoxItem(item.id, computedVendorId);

                                                                                            return (
                                                                                                <div key={item.id} style={{
                                                                                                    border: isSelected ? '1px solid var(--color-primary)' : '1px solid var(--border-color)',
                                                                                                    backgroundColor: isSelected ? 'rgba(var(--color-primary-rgb), 0.05)' : 'var(--bg-app)',
                                                                                                    borderRadius: '8px',
                                                                                                    padding: '12px',
                                                                                                    display: 'flex',
                                                                                                    flexDirection: 'column',
                                                                                                    gap: '10px',
                                                                                                    transition: 'all 0.2s ease',
                                                                                                    boxShadow: isSelected ? '0 2px 4px rgba(0,0,0,0.05)' : 'none'
                                                                                                }}>
                                                                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
                                                                                                        <div style={{ flex: 1 }}>
                                                                                                            <div style={{ fontWeight: 600, fontSize: '0.9rem', color: isSelected ? 'var(--color-primary)' : 'var(--text-primary)' }}>
                                                                                                                {item.name}
                                                                                                            </div>
                                                                                                            {(item.quotaValue || 1) !== 1 && (
                                                                                                                <div style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                                                                                                                    Counts as {item.quotaValue} meals
                                                                                                                </div>
                                                                                                            )}
                                                                                                            {upcomingQty > 0 && (
                                                                                                                <div style={{ 
                                                                                                                    color: 'var(--color-primary)', 
                                                                                                                    fontSize: '0.85em', 
                                                                                                                    marginTop: '4px',
                                                                                                                    fontWeight: 500,
                                                                                                                    backgroundColor: 'var(--bg-surface-hover)',
                                                                                                                    padding: '2px 6px',
                                                                                                                    borderRadius: 'var(--radius-sm)',
                                                                                                                    display: 'inline-block'
                                                                                                                }}>
                                                                                                                    ({upcomingQty} in upcoming orders)
                                                                                                                </div>
                                                                                                            )}
                                                                                                        </div>
                                                                                                        <div className={styles.quantityControl} style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: 'var(--bg-surface)', padding: '2px', borderRadius: '6px', border: '1px solid var(--border-color)' }}>
                                                                                                            <button
                                                                                                                onClick={() => handleBoxItemUpdate(index, item.id, Math.max(0, qty - 1), note)}
                                                                                                                className="btn btn-ghost btn-sm"
                                                                                                                style={{ width: '24px', height: '24px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                                                                                                disabled={qty === 0}
                                                                                                            >
                                                                                                                -
                                                                                                            </button>
                                                                                                            <span style={{ width: '24px', textAlign: 'center', fontWeight: 600, fontSize: '0.9rem' }}>{qty}</span>
                                                                                                            <button
                                                                                                                onClick={() => handleBoxItemUpdate(index, item.id, qty + 1, note)}
                                                                                                                className="btn btn-ghost btn-sm"
                                                                                                                style={{ width: '24px', height: '24px', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                                                                                            >
                                                                                                                +
                                                                                                            </button>
                                                                                                        </div>
                                                                                                    </div>

                                                                                                    {isSelected && (
                                                                                                        <div style={{ marginTop: '0px' }}>
                                                                                                            <TextareaAutosize
                                                                                                                minRows={1}
                                                                                                                placeholder="Add notes for this item..."
                                                                                                                value={note}
                                                                                                                onChange={(e) => handleBoxItemUpdate(index, item.id, qty, e.target.value)}
                                                                                                                style={{
                                                                                                                    width: '100%',
                                                                                                                    fontSize: '0.85rem',
                                                                                                                    padding: '6px 8px',
                                                                                                                    borderRadius: '6px',
                                                                                                                    border: '1px solid rgba(0,0,0,0.1)',
                                                                                                                    backgroundColor: 'rgba(255,255,255,0.5)',
                                                                                                                    resize: 'none'
                                                                                                                }}
                                                                                                            />
                                                                                                        </div>
                                                                                                    )}
                                                                                                </div>
                                                                                            );
                                                                                        })}
                                                                                    </div>
                                                                                </div>
                                                                            );
                                                                        })()}
                                                                    </>
                                                                )}
                                                            </div>
                                                        </div>
                                                        );
                                                    })}

                                                    {/* Add Box Button */}
                                                    {(!formData.authorizedAmount || currentBoxes.length < formData.authorizedAmount) && (
                                                        <button
                                                            type="button"
                                                            className="btn btn-outline"
                                                            style={{ width: '100%', borderStyle: 'dashed', padding: '1rem', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '0.5rem' }}
                                                            onClick={handleAddBox}
                                                        >
                                                            <Plus size={16} /> Add Another Box
                                                        </button>
                                                    )}

                                                    <div style={{ marginTop: '2rem' }}>
                                                        <label className={styles.label}>General Order Notes</label>
                                                        <textarea
                                                            className="input"
                                                            placeholder="Add general notes for this order..."
                                                            value={orderConfig.notes || ''}
                                                            onChange={(e) => setOrderConfig({ ...orderConfig, notes: e.target.value })}
                                                            rows={2}
                                                            style={{ resize: 'vertical', minHeight: '3rem' }}
                                                        />
                                                    </div>
                                                </div>
                                            );
                                        })()}

                                        {formData.serviceType === 'Custom' && (
                                            <div className="animate-fade-in">
                                                <div className={styles.formGroup}>
                                                    <label className="label">Vendor</label>
                                                    <select
                                                        className="input"
                                                        value={orderConfig.vendorId || ''}
                                                        onChange={e => {
                                                            setOrderConfig({
                                                                ...orderConfig,
                                                                vendorId: e.target.value
                                                            });
                                                        }}
                                                    >
                                                        <option value="">Select Vendor...</option>
                                                        {vendors && vendors.length > 0 ? vendors.filter(v => {
                                                            // For Custom orders, show all active vendors (not filtered by service type)
                                                            const isActive = v.isActive !== undefined ? v.isActive : true;
                                                            return isActive;
                                                        }).map(v => (
                                                            <option key={v.id} value={v.id}>{v.name}</option>
                                                        )) : <option value="" disabled>Loading vendors...</option>}
                                                    </select>
                                                    {vendors.filter(v => v.isActive !== undefined ? v.isActive : true).length === 0 && (
                                                        <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: '0.5rem', fontStyle: 'italic' }}>
                                                            No active vendors found. Please create a vendor in the admin panel.
                                                        </p>
                                                    )}
                                                </div>

                                                {orderConfig.vendorId && (
                                                    <div style={{ marginTop: '1rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                                                            <h4 style={{ fontSize: '0.9rem', margin: 0, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                <Package size={14} /> Custom Order Items
                                                            </h4>
                                                            <button
                                                                className="btn btn-secondary"
                                                                onClick={() => {
                                                                    const customItems = orderConfig.customItems || [];
                                                                    setOrderConfig({
                                                                        ...orderConfig,
                                                                        customItems: [...customItems, { name: '', price: 0, quantity: 1 }]
                                                                    });
                                                                }}
                                                                style={{ fontSize: '0.8rem', padding: '0.375rem 0.75rem' }}
                                                            >
                                                                <Plus size={14} /> Add Item
                                                            </button>
                                                        </div>

                                                        {(orderConfig.customItems || []).length === 0 ? (
                                                            <div style={{
                                                                padding: '1.5rem',
                                                                backgroundColor: 'var(--bg-surface-active)',
                                                                borderRadius: 'var(--radius-md)',
                                                                border: '1px dashed var(--border-color)',
                                                                color: 'var(--text-secondary)',
                                                                textAlign: 'center'
                                                            }}>
                                                                <p style={{ margin: 0, fontSize: '0.9rem' }}>
                                                                    No custom items added yet. Click "Add Item" to add custom order items.
                                                                </p>
                                                            </div>
                                                        ) : (
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                                                {(orderConfig.customItems || []).map((item: any, index: number) => (
                                                                    <div
                                                                        key={index}
                                                                        style={{
                                                                            padding: '0.75rem',
                                                                            backgroundColor: 'var(--bg-surface-hover)',
                                                                            borderRadius: 'var(--radius-sm)',
                                                                            border: '1px solid var(--border-color)',
                                                                            display: 'flex',
                                                                            gap: '0.5rem',
                                                                            alignItems: 'flex-start'
                                                                        }}
                                                                    >
                                                                        <div style={{ flex: 1 }}>
                                                                            <label className="label" style={{ fontSize: '0.8rem', marginBottom: '0.25rem' }}>Item Name</label>
                                                                            <input
                                                                                className="input"
                                                                                value={item.name || ''}
                                                                                onChange={e => {
                                                                                    const customItems = [...(orderConfig.customItems || [])];
                                                                                    customItems[index] = { ...customItems[index], name: e.target.value };
                                                                                    setOrderConfig({ ...orderConfig, customItems });
                                                                                }}
                                                                                placeholder="Enter item name"
                                                                                style={{ fontSize: '0.9rem' }}
                                                                            />
                                                                        </div>
                                                                        <div style={{ width: '120px' }}>
                                                                            <label className="label" style={{ fontSize: '0.8rem', marginBottom: '0.25rem' }}>Price</label>
                                                                            <input
                                                                                type="number"
                                                                                step="0.01"
                                                                                className="input"
                                                                                value={item.price || 0}
                                                                                onChange={e => {
                                                                                    const customItems = [...(orderConfig.customItems || [])];
                                                                                    customItems[index] = { ...customItems[index], price: parseFloat(e.target.value) || 0 };
                                                                                    setOrderConfig({ ...orderConfig, customItems });
                                                                                }}
                                                                                placeholder="0.00"
                                                                                style={{ fontSize: '0.9rem' }}
                                                                            />
                                                                        </div>
                                                                        <div style={{ width: '100px' }}>
                                                                            <label className="label" style={{ fontSize: '0.8rem', marginBottom: '0.25rem' }}>Quantity</label>
                                                                            <input
                                                                                type="number"
                                                                                min="1"
                                                                                className="input"
                                                                                value={item.quantity || 1}
                                                                                onChange={e => {
                                                                                    const customItems = [...(orderConfig.customItems || [])];
                                                                                    customItems[index] = { ...customItems[index], quantity: parseInt(e.target.value) || 1 };
                                                                                    setOrderConfig({ ...orderConfig, customItems });
                                                                                }}
                                                                                style={{ fontSize: '0.9rem' }}
                                                                            />
                                                                        </div>
                                                                        <button
                                                                            className={`${styles.iconBtn} ${styles.danger}`}
                                                                            onClick={() => {
                                                                                const customItems = [...(orderConfig.customItems || [])];
                                                                                customItems.splice(index, 1);
                                                                                setOrderConfig({ ...orderConfig, customItems });
                                                                            }}
                                                                            style={{ marginTop: '1.5rem' }}
                                                                            title="Remove Item"
                                                                        >
                                                                            <Trash2 size={16} />
                                                                        </button>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* Equipment Order Section - Always visible */}
                                        <div className={styles.divider} style={{ marginTop: '2rem', marginBottom: '1rem' }} />
                                        <div style={{ marginTop: '1rem' }}>
                                            <h4 style={{ fontSize: '0.9rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                <Wrench size={14} /> Equipment Order
                                            </h4>
                                            {!showEquipmentOrder ? (
                                                <button
                                                    className="btn btn-secondary"
                                                    onClick={() => setShowEquipmentOrder(true)}
                                                    style={{ width: '100%' }}
                                                >
                                                    Equipment Order
                                                </button>
                                            ) : (
                                                <div style={{
                                                    padding: '1rem',
                                                    backgroundColor: 'var(--bg-surface-hover)',
                                                    borderRadius: 'var(--radius-md)',
                                                    border: '1px solid var(--border-color)'
                                                }}>
                                                    <div className={styles.formGroup}>
                                                        <label className="label">Vendor</label>
                                                        <select
                                                            className="input"
                                                            value={equipmentOrder?.vendorId || ''}
                                                            onChange={e => setEquipmentOrder({
                                                                ...equipmentOrder,
                                                                vendorId: e.target.value,
                                                                equipmentId: '' // Reset equipment selection when vendor changes
                                                            })}
                                                        >
                                                            <option value="">Select Vendor...</option>
                                                            {vendors && vendors.length > 0 ? vendors
                                                                .filter(v => {
                                                                    const hasEquipment = v.serviceTypes && Array.isArray(v.serviceTypes) && v.serviceTypes.includes('Equipment');
                                                                    const isActive = v.isActive !== undefined ? v.isActive : true;
                                                                    return hasEquipment && isActive;
                                                                })
                                                                .map(v => (
                                                                    <option key={v.id} value={v.id}>{v.name}</option>
                                                                )) : <option value="" disabled>Loading vendors...</option>}
                                                        </select>
                                                        {vendors.filter(v => v.serviceTypes && v.serviceTypes.includes('Equipment') && v.isActive).length === 0 && (
                                                            <p style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', marginTop: '0.5rem', fontStyle: 'italic' }}>
                                                                No active vendors with Equipment service type found. Please create a vendor with Equipment service type in the admin panel.
                                                            </p>
                                                        )}
                                                    </div>

                                                    {equipmentOrder?.vendorId && (
                                                        <div className={styles.formGroup}>
                                                            <label className="label">Equipment Item</label>
                                                            <select
                                                                className="input"
                                                                value={equipmentOrder?.equipmentId || ''}
                                                                onChange={e => setEquipmentOrder({
                                                                    ...equipmentOrder,
                                                                    equipmentId: e.target.value
                                                                })}
                                                            >
                                                                <option value="">Select Equipment Item...</option>
                                                                {equipment
                                                                    .filter(eq => !eq.vendorId || eq.vendorId === equipmentOrder.vendorId)
                                                                    .map(eq => (
                                                                        <option key={eq.id} value={eq.id}>
                                                                            {eq.name} - ${eq.price.toFixed(2)}
                                                                        </option>
                                                                    ))}
                                                            </select>
                                                        </div>
                                                    )}

                                                    {equipmentOrder?.equipmentId && (
                                                        <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem' }}>
                                                            <button
                                                                className="btn btn-primary"
                                                                onClick={async () => {
                                                                    if (!equipmentOrder.vendorId || !equipmentOrder.equipmentId) {
                                                                        alert('Please select both vendor and equipment item');
                                                                        return;
                                                                    }
                                                                    if (isNewClient) {
                                                                        alert('Please save the client first before creating an equipment order.');
                                                                        return;
                                                                    }
                                                                    try {
                                                                        setSubmittingEquipmentOrder(true);
                                                                        await saveEquipmentOrder(
                                                                            clientId,
                                                                            equipmentOrder.vendorId,
                                                                            equipmentOrder.equipmentId,
                                                                            orderConfig.caseId
                                                                        );
                                                                        setMessage('Equipment order submitted successfully!');
                                                                        setTimeout(() => setMessage(null), 3000);
                                                                        setShowEquipmentOrder(false);
                                                                        setEquipmentOrder(null);
                                                                        // Reload data to show the new order in Recent Orders section
                                                                        setLoadingOrderDetails(true);
                                                                        const [activeOrderData, orderHistoryData] = await Promise.all([
                                                                            getRecentOrdersForClient(clientId),
                                                                            getOrderHistory(clientId)
                                                                        ]);
                                                                        setActiveOrder(activeOrderData);
                                                                        setOrderHistory(orderHistoryData || []);
                                                                        setLoadingOrderDetails(false);
                                                                    } catch (error: any) {
                                                                        alert(`Error submitting equipment order: ${error.message || 'Unknown error'}`);
                                                                    } finally {
                                                                        setSubmittingEquipmentOrder(false);
                                                                    }
                                                                }}
                                                                disabled={submittingEquipmentOrder}
                                                            >
                                                                {submittingEquipmentOrder ? 'Submitting...' : 'Submit Equipment Order'}
                                                            </button>
                                                            <button
                                                                className="btn btn-secondary"
                                                                onClick={() => {
                                                                    setShowEquipmentOrder(false);
                                                                    setEquipmentOrder(null);
                                                                }}
                                                            >
                                                                Cancel
                                                            </button>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    </>
                                )}
                            </section>

                            {/* Recent Orders Panel */}
                            <section className={styles.card} style={{ marginTop: 'var(--spacing-lg)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: 'var(--spacing-md)' }}>
                                    <Calendar size={18} />
                                    <h3 className={styles.sectionTitle} style={{ marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}>
                                        Recent Orders
                                    </h3>
                                </div>
                                {loadingOrderDetails ? (
                                    <div className={styles.loadingContainer}>
                                        <div className={styles.spinner}></div>
                                        <p className={styles.loadingText}>Loading order details...</p>
                                    </div>
                                ) : activeOrder ? (
                                    <div>
                                        {(() => {
                                            // Handle both single order (backward compatibility) and multiple orders
                                            const isMultiple = activeOrder.multiple === true && Array.isArray(activeOrder.orders);
                                            const ordersToDisplay = isMultiple ? activeOrder.orders : [activeOrder];

                                            return (
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                                                    {ordersToDisplay.map((order: any, orderIdx: number) => {
                                                        const isFood = order.serviceType === 'Food';
                                                        const isBoxes = order.serviceType === 'Boxes';
                                                        const isEquipment = order.serviceType === 'Equipment';

                                                        return (
                                                            <div key={orderIdx} style={isMultiple ? {
                                                                padding: 'var(--spacing-md)',
                                                                backgroundColor: 'var(--bg-surface)',
                                                                borderRadius: 'var(--radius-md)',
                                                                border: '1px solid var(--border-color)'
                                                            } : {}}>
                                                                <div style={{
                                                                    marginBottom: 'var(--spacing-md)',
                                                                    paddingBottom: 'var(--spacing-sm)',
                                                                    borderBottom: '1px solid var(--border-color)',
                                                                    display: 'flex',
                                                                    justifyContent: 'space-between',
                                                                    alignItems: 'center',
                                                                    flexWrap: 'wrap',
                                                                    gap: '8px'
                                                                }}>
                                                                    <div style={{
                                                                        fontSize: '0.9rem',
                                                                        fontWeight: 600,
                                                                        color: 'var(--text-secondary)'
                                                                    }}>
                                                                        {order.id ? (
                                                                            <Link href={`/orders/${order.id}`} style={{ color: 'var(--color-primary)', textDecoration: 'none', cursor: 'pointer' }}>
                                                                                {order.orderNumber ? `Order #${order.orderNumber}` : `Order ${orderIdx + 1}`}
                                                                            </Link>
                                                                        ) : (
                                                                            <span>{order.orderNumber ? `Order #${order.orderNumber}` : `Order ${orderIdx + 1}`}</span>
                                                                        )}
                                                                        {isMultiple && !order.orderNumber && ` of ${ordersToDisplay.length}`}
                                                                        {order.scheduledDeliveryDate && (
                                                                            <span style={{ marginLeft: 'var(--spacing-sm)', fontSize: '0.85rem', fontWeight: 400, color: 'var(--text-secondary)' }}>
                                                                                • Scheduled: {(() => {
                                                                                    // Parse YYYY-MM-DD as local date to avoid timezone issues
                                                                                    const [year, month, day] = order.scheduledDeliveryDate.split('-').map(Number);
                                                                                    const date = new Date(year, month - 1, day);
                                                                                    return date.toLocaleDateString('en-US');
                                                                                })()}
                                                                            </span>
                                                                        )}
                                                                    </div>

                                                                    {/* Proof of Delivery / Status */}
                                                                    <div style={{ fontSize: '0.85rem' }}>
                                                                        {order.proofOfDelivery ? (
                                                                            <a
                                                                                href={order.proofOfDelivery}
                                                                                target="_blank"
                                                                                rel="noopener noreferrer"
                                                                                style={{
                                                                                    display: 'flex',
                                                                                    alignItems: 'center',
                                                                                    gap: '4px',
                                                                                    color: 'var(--color-primary)',
                                                                                    fontWeight: 500,
                                                                                    textDecoration: 'none'
                                                                                }}
                                                                            >
                                                                                View Proof of Delivery
                                                                            </a>
                                                                        ) : (
                                                                            <span style={{
                                                                                color: 'var(--text-tertiary)',
                                                                                fontStyle: 'italic',
                                                                                display: 'flex',
                                                                                alignItems: 'center',
                                                                                gap: '4px'
                                                                            }}>
                                                                                Not yet delivered
                                                                            </span>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                                <div>
                                                                    {/* Service Type Header */}
                                                                    <div style={{ marginBottom: 'var(--spacing-sm)', fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                                                                        {isFood ? 'Food' : isBoxes ? 'Boxes' : isEquipment ? 'Equipment' : 'Unknown Service'}
                                                                    </div>

                                                                    {/* Food Order Display - Show vendors first, then items grouped by vendor */}
                                                                    {isFood && (
                                                                        <div style={{ padding: 'var(--spacing-md)', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
                                                                            {order.vendorSelections && order.vendorSelections.length > 0 ? (
                                                                                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                                                                                    {order.vendorSelections.map((vendorSelection: any, idx: number) => {
                                                                                        const vendor = vendors.find(v => v.id === vendorSelection.vendorId);
                                                                                        const vendorName = vendor?.name || 'Unassigned';
                                                                                        const nextDelivery = getNextDeliveryDate(vendorSelection.vendorId);
                                                                                        const items = vendorSelection.items || {};

                                                                                        return (
                                                                                            <div key={idx} style={{ padding: 'var(--spacing-md)', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
                                                                                                {/* Vendor Header */}
                                                                                                <div style={{ marginBottom: 'var(--spacing-sm)', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                                                                                    {vendorName}
                                                                                                </div>
                                                                                                {/* Items List */}
                                                                                                {Object.keys(items).length > 0 ? (
                                                                                                    <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                                                                                                        {Object.entries(items).map(([itemId, qty]: [string, any]) => {
                                                                                                            const item = menuItems.find(i => i.id === itemId);
                                                                                                            return item ? (
                                                                                                                <div key={itemId} style={{ marginBottom: '4px' }}>
                                                                                                                    {item.name} × {qty}
                                                                                                                </div>
                                                                                                            ) : null;
                                                                                                        })}
                                                                                                    </div>
                                                                                                ) : (
                                                                                                    <div style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
                                                                                                        No items selected
                                                                                                    </div>
                                                                                                )}

                                                                                            </div>
                                                                                        );
                                                                                    })}
                                                                                </div>
                                                                            ) : (
                                                                                <div style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
                                                                                    No vendors or items selected
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    )}

                                                                    {/* Boxes Order Display - Show vendor, box type, and all items */}
                                                                    {isBoxes && (order.boxTypeId || (order.boxOrders && order.boxOrders.length > 0)) && (
                                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                                                            {(() => {
                                                                                // Debug logging
                                                                                if (order.serviceType === 'Boxes') {
                                                                                    console.log('[ClientProfile] Box order data:', {
                                                                                        hasBoxOrders: !!(order.boxOrders && order.boxOrders.length > 0),
                                                                                        boxOrdersLength: order.boxOrders?.length || 0,
                                                                                        boxOrders: order.boxOrders,
                                                                                        hasBoxTypeId: !!order.boxTypeId,
                                                                                        hasItems: !!order.items,
                                                                                        itemsKeys: order.items ? Object.keys(order.items) : []
                                                                                    });
                                                                                }
                                                                                
                                                                                const boxesToDisplay = (order.boxOrders && order.boxOrders.length > 0)
                                                                                    ? order.boxOrders
                                                                                    : [{
                                                                                        boxTypeId: order.boxTypeId,
                                                                                        vendorId: order.vendorId,
                                                                                        quantity: order.boxQuantity,
                                                                                        items: order.items
                                                                                    }];

                                                                                return boxesToDisplay.map((boxData: any, bIdx: number) => {
                                                                                    const box = boxTypes.find(b => b.id === boxData.boxTypeId);
                                                                                    const boxVendorId = boxData.vendorId || box?.vendorId || null;
                                                                                    const vendor = boxVendorId ? vendors.find(v => v.id === boxVendorId) : null;
                                                                                    const vendorName = vendor?.name || 'Unassigned';
                                                                                    const boxName = box?.name || 'Unknown Box';
                                                                                    
                                                                                    // Handle items - ensure it's an object
                                                                                    let items: any = {};
                                                                                    if (boxData.items) {
                                                                                        if (typeof boxData.items === 'object' && !Array.isArray(boxData.items)) {
                                                                                            items = boxData.items;
                                                                                        } else if (typeof boxData.items === 'string') {
                                                                                            try {
                                                                                                items = JSON.parse(boxData.items);
                                                                                            } catch (e) {
                                                                                                console.error('[ClientProfile] Error parsing box items string:', e);
                                                                                            }
                                                                                        }
                                                                                    }
                                                                                    
                                                                                    // Debug logging for this specific box
                                                                                    console.log('[ClientProfile] Box display data:', {
                                                                                        boxIndex: bIdx,
                                                                                        boxTypeId: boxData.boxTypeId,
                                                                                        vendorId: boxData.vendorId,
                                                                                        quantity: boxData.quantity,
                                                                                        itemsType: typeof items,
                                                                                        itemsKeys: Object.keys(items),
                                                                                        itemsCount: Object.keys(items).length,
                                                                                        items: items
                                                                                    });

                                                                                    return (
                                                                                        <div key={bIdx} style={{ padding: 'var(--spacing-md)', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
                                                                                            {/* Vendor */}
                                                                                            <div style={{ marginBottom: 'var(--spacing-xs)', fontSize: '0.8rem', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.025em', fontWeight: 600 }}>
                                                                                                {vendorName}
                                                                                            </div>
                                                                                            {/* Box Type and Quantity */}
                                                                                            <div style={{ marginBottom: 'var(--spacing-sm)', fontSize: '0.9rem', color: 'var(--text-primary)', fontWeight: 600 }}>
                                                                                                {boxName} × {boxData.quantity || 1}
                                                                                            </div>
                                                                                            {/* Items List */}
                                                                                            {items && typeof items === 'object' && Object.keys(items).length > 0 ? (
                                                                                                <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                                                                                                    {Object.entries(items)
                                                                                                        .filter(([_, qty]) => qty && Number(qty) > 0) // Filter out zero quantities
                                                                                                        .map(([itemId, qty]: [string, any]) => {
                                                                                                            const item = menuItems.find(i => i.id === itemId);
                                                                                                            return item ? (
                                                                                                                <div key={itemId} style={{ marginBottom: '4px', display: 'flex', justifyContent: 'space-between' }}>
                                                                                                                    <span>{item.name}</span>
                                                                                                                    <span style={{ color: 'var(--text-secondary)' }}>× {qty}</span>
                                                                                                                </div>
                                                                                                            ) : null;
                                                                                                        })}
                                                                                                </div>
                                                                                            ) : (
                                                                                                <div style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
                                                                                                    No items selected
                                                                                                </div>
                                                                                            )}
                                                                                        </div>
                                                                                    );
                                                                                });
                                                                            })()}
                                                                        </div>
                                                                    )}

                                                                    {/* Equipment Order Display */}
                                                                    {isEquipment && (
                                                                        <div style={{ padding: 'var(--spacing-md)', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
                                                                            {(() => {
                                                                                // Parse equipment details from order notes or orderDetails
                                                                                let equipmentDetails: any = null;
                                                                                try {
                                                                                    if (order.orderDetails?.equipmentSelection) {
                                                                                        equipmentDetails = order.orderDetails.equipmentSelection;
                                                                                    } else if (order.notes) {
                                                                                        const parsed = JSON.parse(order.notes);
                                                                                        if (parsed.equipmentName) {
                                                                                            equipmentDetails = parsed;
                                                                                        }
                                                                                    }
                                                                                } catch (e) {
                                                                                    console.error('Error parsing equipment order:', e);
                                                                                }

                                                                                const vendorId = equipmentDetails?.vendorId;
                                                                                const vendor = vendorId ? vendors.find(v => v.id === vendorId) : null;
                                                                                const vendorName = vendor?.name || 'Unknown Vendor';
                                                                                const equipmentName = equipmentDetails?.equipmentName || 'Unknown Equipment';
                                                                                const price = equipmentDetails?.price || order.totalValue || 0;
                                                                                const nextDelivery = vendorId ? getNextDeliveryDate(vendorId) : null;

                                                                                return (
                                                                                    <>
                                                                                        {/* Vendor */}
                                                                                        <div style={{ marginBottom: 'var(--spacing-sm)', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                                                                            {vendorName}
                                                                                        </div>
                                                                                        {/* Equipment Item */}
                                                                                        <div style={{ marginBottom: 'var(--spacing-sm)', fontSize: '0.85rem', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                                            <Wrench size={14} />
                                                                                            <span>{equipmentName}</span>
                                                                                            <span style={{ marginLeft: 'auto', fontWeight: 600, color: 'var(--color-primary)' }}>
                                                                                                ${price.toFixed(2)}
                                                                                            </span>
                                                                                        </div>

                                                                                    </>
                                                                                );
                                                                            })()}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            );
                                        })()}
                                    </div>
                                ) : (
                                    <div className={styles.empty}>
                                        No recent orders.
                                    </div>
                                )}
                            </section>
                        </div>
                    </div>
                )}
                {
                    onClose && (
                        <div className={styles.bottomAction} style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                            <button
                                className="btn"
                                onClick={handleDiscardChanges}
                                disabled={saving}
                                style={{
                                    width: '200px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '8px',
                                    background: 'none',
                                    border: '1px solid var(--border-color)',
                                    color: 'var(--text-secondary)',
                                    opacity: saving ? 0.7 : 1,
                                    cursor: saving ? 'not-allowed' : 'pointer'
                                }}
                            >
                                Discard Changes
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={handleSaveAndClose}
                                disabled={saving}
                                style={{
                                    width: '200px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '8px',
                                    opacity: saving ? 0.7 : 1,
                                    cursor: saving ? 'not-allowed' : 'pointer'
                                }}
                            >
                                {saving ? (
                                    <>
                                        <Loader2
                                            size={16}
                                            style={{
                                                animation: 'spin 1s linear infinite',
                                                display: 'inline-block'
                                            }}
                                        />
                                        Saving...
                                    </>
                                ) : (
                                    'Save'
                                )}
                            </button>
                        </div>
                    )
                }
            </div>
        );
    }

    const content = getContent();

    return (
        <>
            {onClose ? (
                <div className={styles.modalOverlay} onClick={() => {
                    // Try to save and close when clicking overlay
                    handleSaveAndClose();
                }}>
                    <div className={styles.modalContent} onClick={e => e.stopPropagation()} style={{ position: 'relative' }}>
                        {saving && (
                            <div className={styles.savingOverlay}>
                                <div className={styles.savingIndicator}>
                                    <Loader2 size={48} className="animate-spin" style={{ color: 'var(--color-primary)' }} />
                                    <p className={styles.savingText}>Saving changes...</p>
                                </div>
                            </div>
                        )}
                        <div style={{ filter: saving ? 'blur(4px)' : 'none', pointerEvents: saving ? 'none' : 'auto' }}>
                            {content}
                        </div>
                    </div>
                </div>
            ) : (
                <div style={{ position: 'relative' }}>
                    {saving && (
                        <div className={styles.savingOverlay}>
                            <div className={styles.savingIndicator}>
                                <Loader2 size={48} className="animate-spin" style={{ color: 'var(--color-primary)' }} />
                                <p className={styles.savingText}>Saving changes...</p>
                            </div>
                        </div>
                    )}
                    <div style={{ filter: saving ? 'blur(4px)' : 'none', pointerEvents: saving ? 'none' : 'auto' }}>
                        {content}
                    </div>
                </div>
            )}
            {validationError.show && (
                <div className={styles.modalOverlay} style={{ zIndex: 200 }}>
                    <div className={styles.modalContent} style={{ maxWidth: '400px', height: 'auto', padding: '24px' }} onClick={e => e.stopPropagation()}>
                        <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-danger)' }}>
                            <AlertTriangle size={24} />
                            Cannot Save
                        </h2>
                        <p style={{ marginBottom: '16px', color: 'var(--text-secondary)' }}>
                            Please fix the following errors before saving:
                        </p>
                        <div style={{ background: 'var(--bg-surface-hover)', padding: '12px', borderRadius: '8px', marginBottom: '24px' }}>
                            <ul style={{ listStyle: 'disc', paddingLeft: '20px', margin: 0 }}>
                                {validationError.messages.map((msg, i) => (
                                    <li key={i} style={{ marginBottom: '4px', color: 'var(--text-primary)' }}>{msg}</li>
                                ))}
                            </ul>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <button
                                className="btn btn-primary"
                                onClick={() => setValidationError({ show: false, messages: [] })}
                            >
                                Return to Editing
                            </button>
                            <button
                                className="btn"
                                style={{ background: 'none', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}
                                onClick={handleDiscardChanges}
                            >
                                Discard Changes & Exit
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {errorModal.show && (
                <div className={styles.modalOverlay} style={{ zIndex: 200 }}>
                    <div className={styles.modalContent} style={{ maxWidth: '500px', height: 'auto', padding: '24px' }} onClick={e => e.stopPropagation()}>
                        <h2 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--color-danger)' }}>
                            <AlertTriangle size={24} />
                            Error Saving Client
                        </h2>
                        <p style={{ marginBottom: '24px', color: 'var(--text-primary)', lineHeight: '1.5' }}>
                            {errorModal.message}
                        </p>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                            <button
                                className="btn btn-primary"
                                onClick={() => setErrorModal({ show: false, message: '' })}
                            >
                                OK
                            </button>
                        </div>
                    </div>
                </div>
            )}
            <UnitsModal
                isOpen={showUnitsModal}
                onClose={() => {
                    setShowUnitsModal(false);
                    setPendingStatusChange(null);
                }}
                onConfirm={executeSave}
                saving={saving}
            />
            <DeleteConfirmationModal
                isOpen={showDeleteModal}
                onClose={() => setShowDeleteModal(false)}
                onConfirm={handleDelete}
                clientName={formData.fullName || 'this client'}
                deleting={saving}
            />
            <MapConfirmDialog
                open={mapOpen}
                onClose={() => {
                    abortAllGeo();
                    setMapOpen(false);
                }}
                initialQuery={streetQueryNoUnit({
                    address: formData.address || "",
                    city: formData.city || "",
                    state: formData.state || "",
                    zip: formData.zip || "",
                })}
                initialLatLng={
                    typeof formData.lat === "number" && typeof formData.lng === "number"
                        ? [formData.lat, formData.lng]
                        : null
                }
                onConfirm={onMapConfirm}
            />
        </>
    );

    // Helper function to create address query for geocoding
    function streetQueryNoUnit(addressData: { address?: string; city?: string; state?: string; zip?: string }) {
        const parts = [addressData.address, addressData.city, addressData.state, addressData.zip].filter(Boolean);
        return parts.join(", ");
    }

    // Tracked fetch for geocoding with timeout and abort
    const trackedFetch = async (input: string, init: RequestInit = {}) => {
        const ctrl = new AbortController();
        const sig = init.signal
            ? (() => {
                try {
                    return AbortSignal.any([init.signal!, ctrl.signal]);
                } catch {
                    return ctrl.signal;
                }
            })()
            : ctrl.signal;
        inflight.current.add(ctrl);
        try {
            const timeout = setTimeout(() => ctrl.abort(), 10000);
            const res = await fetch(input, { ...init, signal: sig });
            clearTimeout(timeout);
            return res;
        } finally {
            inflight.current.delete(ctrl);
            setGeoBusy(false);
        }
    };

    // Persist lat/lng to server
    async function persistLatLng(userId: string, geo: { lat: number; lng: number; address?: string; city?: string; state?: string; zip?: string }) {
        if (!Number.isFinite(Number(userId))) return;
        setGeoPersisting(true);
        try {
            await updateClient(userId, {
                lat: geo.lat,
                lng: geo.lng,
                ...(geo.address ? { address: geo.address } : {}),
                ...(geo.city ? { city: geo.city } : {}),
                ...(geo.state ? { state: geo.state } : {}),
                ...(geo.zip ? { zip: geo.zip } : {}),
            });
        } catch (_) {
            // Silently fail - user can retry
        } finally {
            setGeoPersisting(false);
        }
    }

    // Auto geocode function
    async function tryAutoGeocode() {
        if (saving || geoBusy) return;
        setGeoBusy(true);
        setGeoErr("");
        setCandsOpen(false);
        setCands([]);
        setGeoSuccess(false);

        const qStrict = buildGeocodeQuery({
            address: formData.address || "",
            city: formData.city || "",
            state: formData.state || "",
            zip: formData.zip || "",
        }) || streetQueryNoUnit({
            address: formData.address || "",
            city: formData.city || "",
            state: formData.state || "",
            zip: formData.zip || "",
        });

        try {
            const a = await geocodeOneClient(qStrict);
            setFormData(f => ({ ...f, lat: a.lat, lng: a.lng }));
            if (formData.id) {
                await persistLatLng(formData.id, {
                    lat: a.lat,
                    lng: a.lng,
                    address: formData.address || "",
                    city: formData.city || "",
                    state: formData.state || "",
                    zip: formData.zip || "",
                });
            }
            setGeoSuccess(true);
            setTimeout(() => setGeoSuccess(false), 2000);
        } catch {
            try {
                const qLoose = streetQueryNoUnit({
                    address: formData.address || "",
                    city: formData.city || "",
                    state: formData.state || "",
                    zip: "",
                });
                const a2 = await geocodeOneClient(qLoose);
                setFormData(f => ({ ...f, lat: a2.lat, lng: a2.lng }));
                if (formData.id) {
                    await persistLatLng(formData.id, {
                        lat: a2.lat,
                        lng: a2.lng,
                        address: formData.address || "",
                        city: formData.city || "",
                        state: formData.state || "",
                        zip: formData.zip || "",
                    });
                }
                setGeoSuccess(true);
                setTimeout(() => setGeoSuccess(false), 2000);
            } catch {
                setGeoErr("Address not found. Try suggestions or map selection.");
            }
        } finally {
            setGeoBusy(false);
        }
    }

    // Open suggestions for geocoding
    async function openSuggestions() {
        if (saving || geoBusy) return;
        setCandsOpen(true);
        setCands([]);
        setGeoBusy(true);
        setGeoErr("");
        try {
            const q = streetQueryNoUnit({
                address: formData.address || "",
                city: formData.city || "",
                state: formData.state || "",
                zip: formData.zip || "",
            });
            const res = await trackedFetch(`/api/geocode/search?q=${encodeURIComponent(q)}&limit=8`, { cache: "no-store" });
            if (!res.ok) throw new Error(`HTTP error ${res.status}`);
            const data = await res.json();
            setCands(Array.isArray(data?.items) ? data.items : []);
        } catch (e: any) {
            if (e?.name !== "AbortError") setGeoErr("Failed to load suggestions. Try again or use map.");
        } finally {
            setGeoBusy(false);
        }
    }

    // Pick a candidate from suggestions
    async function pickCandidate(item: any) {
        const lat = Number(item?.lat);
        const lng = Number(item?.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        setFormData(f => ({ ...f, lat, lng }));
        setCandsOpen(false);
        setGeoErr("");
        if (formData.id) {
            await persistLatLng(formData.id, {
                lat,
                lng,
                address: formData.address || "",
                city: formData.city || "",
                state: formData.state || "",
                zip: formData.zip || "",
            });
        }
        setGeoSuccess(true);
        setTimeout(() => setGeoSuccess(false), 2000);
    }

    // Handle map confirmation
    async function onMapConfirm({ lat, lng }: { lat: number; lng: number }) {
        setFormData(f => ({ ...f, lat, lng }));
        setMapOpen(false);
        setGeoErr("");
        if (formData.id) {
            await persistLatLng(formData.id, {
                lat,
                lng,
                address: formData.address || "",
                city: formData.city || "",
                state: formData.state || "",
                zip: formData.zip || "",
            });
        }
        setGeoSuccess(true);
        setTimeout(() => setGeoSuccess(false), 2000);
    }

    async function handleSave(): Promise<boolean> {

        if (!client && !isNewClient) {
            return false;
        }

        // Validate approvedMealsPerWeek min/max bounds
        // Allow 0/undefined (can be under min), but if > 0, must be within min/max bounds
        const approvedMeals = formData.approvedMealsPerWeek ?? 0;

        // If value is > 0, validate it's within bounds (0 is always allowed)
        if (approvedMeals > 0) {
            if (approvedMeals < MIN_APPROVED_MEALS_PER_WEEK) {
                setValidationError({
                    show: true,
                    messages: [`Approved meals per week (${approvedMeals}) must be at least ${MIN_APPROVED_MEALS_PER_WEEK}.`]
                });

                return false;
            }
            if (approvedMeals > MAX_APPROVED_MEALS_PER_WEEK) {
                setValidationError({
                    show: true,
                    messages: [`Approved meals per week (${approvedMeals}) must be at most ${MAX_APPROVED_MEALS_PER_WEEK}.`]
                });

                return false;
            }
        }

        // Validate Order Config before saving (if we have config)
        // For Boxes, validate even without caseId (caseId is optional for boxes)
        // For other services, require caseId
        const shouldValidate = orderConfig && (
            formData.serviceType === 'Boxes' 
                ? (orderConfig.boxOrders && Array.isArray(orderConfig.boxOrders) && orderConfig.boxOrders.length > 0)
                : orderConfig.caseId
        );
        if (shouldValidate) {
            const validation = validateOrder();
            if (!validation.isValid) {
                setValidationError({ show: true, messages: validation.messages });
                return false;
            }
        }

        // Check for Status Change by Navigator
        // Only show units modal if the new status requires units on change
        // Skip this check for new clients
        if (!isNewClient && client) {
            if (currentUser?.role === 'navigator' && formData.statusId !== client.statusId) {
                const newStatus = statuses.find(s => s.id === formData.statusId);

                // Only show modal if the new status has requiresUnitsOnChange enabled
                if (newStatus?.requiresUnitsOnChange) {
                    try {
                        const oldStatusName = getStatusName(client.statusId);
                        const newStatusName = getStatusName(formData.statusId!);
                        setPendingStatusChange({ oldStatus: oldStatusName, newStatus: newStatusName });
                        setShowUnitsModal(true);
                        return false; // Intercepted
                    } catch (e) {
                        console.error('[handleSave] Error in status change logic:', e);
                    }
                }
            }
        }


        return await executeSave(0);
    }

    async function executeSave(unitsAdded: number = 0): Promise<boolean> {
        // Helper to prepare cleaned active order
        const prepareActiveOrder = () => {
            if (!orderConfig) return undefined;

            const cleanedOrderConfig = { ...orderConfig };

            // CRITICAL: Always preserve caseId at the top level for both Food and Boxes
            cleanedOrderConfig.caseId = orderConfig.caseId;

            if (formData.serviceType === 'Food') {
                // For Food service: Ensure vendorId and items are preserved in all vendor selections
                if (cleanedOrderConfig.deliveryDayOrders) {
                    // Multi-day format: Clean and preserve vendor selections for each day
                    for (const day of Object.keys(cleanedOrderConfig.deliveryDayOrders)) {
                        // Ensure deliveryDay is attached to the day order
                        if (!cleanedOrderConfig.deliveryDayOrders[day].deliveryDay) {
                            cleanedOrderConfig.deliveryDayOrders[day].deliveryDay = day;
                        }
                        cleanedOrderConfig.deliveryDayOrders[day].vendorSelections = (cleanedOrderConfig.deliveryDayOrders[day].vendorSelections || [])
                            .filter((s: any) => s.vendorId) // Only keep selections with a vendor
                            .map((s: any) => ({
                                vendorId: s.vendorId, // Preserve vendor ID
                                items: s.items || {}, // Preserve items
                                deliveryDay: day  // Explicitly attach the delivery day to this vendor selection
                            }));
                    }
                } else if (cleanedOrderConfig.vendorSelections) {
                    // Check if we have per-vendor delivery days (itemsByDay format)
                    const hasPerVendorDeliveryDays = cleanedOrderConfig.vendorSelections.some((s: any) =>
                        s.selectedDeliveryDays && s.selectedDeliveryDays.length > 0 && s.itemsByDay
                    );

                    if (hasPerVendorDeliveryDays) {
                        // Convert per-vendor delivery days to deliveryDayOrders format
                        const deliveryDayOrders: any = {};
                        for (const selection of cleanedOrderConfig.vendorSelections) {
                            if (!selection.vendorId || !selection.selectedDeliveryDays || !selection.itemsByDay) continue;

                            for (const day of selection.selectedDeliveryDays) {
                                if (!deliveryDayOrders[day]) {
                                    deliveryDayOrders[day] = { 
                                        vendorSelections: [],
                                        deliveryDay: day  // Explicitly attach the delivery day to the order
                                    };
                                }
                                const dayItems = selection.itemsByDay[day] || {};
                                const hasItems = Object.keys(dayItems).length > 0 && Object.values(dayItems).some((qty: any) => (Number(qty) || 0) > 0);
                                if (hasItems) {
                                    // Preserve vendorId, items, and deliveryDay for this day
                                    deliveryDayOrders[day].vendorSelections.push({
                                        vendorId: selection.vendorId,
                                        items: dayItems,
                                        deliveryDay: day  // Explicitly attach the delivery day to this vendor selection
                                    });
                                }
                            }
                        }
                        // Clean up days with no vendors
                        const daysWithVendors = Object.keys(deliveryDayOrders).filter(day =>
                            deliveryDayOrders[day].vendorSelections && deliveryDayOrders[day].vendorSelections.length > 0
                        );
                        if (daysWithVendors.length > 0) {
                            const cleanedDeliveryDayOrders: any = {};
                            for (const day of daysWithVendors) cleanedDeliveryDayOrders[day] = deliveryDayOrders[day];
                            cleanedOrderConfig.deliveryDayOrders = cleanedDeliveryDayOrders;
                            cleanedOrderConfig.vendorSelections = undefined;
                        } else {
                            // CRITICAL FIX: If no days have vendors with items, preserve the original vendorSelections format
                            // Don't set vendorSelections to undefined - keep the original structure
                            console.warn('[prepareActiveOrder] No days with vendors found after conversion, preserving original vendorSelections format');
                            // Keep vendorSelections as-is, don't convert to deliveryDayOrders
                            cleanedOrderConfig.deliveryDayOrders = undefined;
                        }
                    } else {
                        // Single-day format: Clean and preserve vendor selections
                        // CRITICAL FIX: Only filter out selections without vendorId, but keep all selections with vendorId
                        // even if items are empty (they might be added later or items might be in a different format)
                        cleanedOrderConfig.vendorSelections = (cleanedOrderConfig.vendorSelections || [])
                            .filter((s: any) => s.vendorId && s.vendorId.trim() !== '') // Only keep selections with a valid vendor
                            .map((s: any) => ({
                                vendorId: s.vendorId, // Preserve vendor ID
                                items: s.items || {} // Preserve items (even if empty - they might be added in a different format)
                            }));
                        
                        // Validate that we have at least one vendor selection with items
                        const hasItems = cleanedOrderConfig.vendorSelections.some((s: any) => {
                            const items = s.items || {};
                            return Object.keys(items).length > 0 && Object.values(items).some((qty: any) => (Number(qty) || 0) > 0);
                        });
                        
                        if (!hasItems && cleanedOrderConfig.vendorSelections.length > 0) {
                            console.warn('[prepareActiveOrder] Vendor selections exist but no items found. This might indicate items are in itemsByDay format.');
                            // Don't remove vendor selections - they might have items in itemsByDay format that we missed
                        }
                    }
                }
            } else if (formData.serviceType === 'Boxes') {
                // For Boxes: Use the boxOrders array which supports multiple boxes
                // Match triangleorder approach: Clean items and notes, only keep items with qty > 0
                if (orderConfig.boxOrders && Array.isArray(orderConfig.boxOrders)) {
                    cleanedOrderConfig.boxOrders = orderConfig.boxOrders.map((box: any) => {
                        const cleanedItems: any = {};
                        const cleanedNotes: any = {};

                        if (box.items) {
                            Object.entries(box.items).forEach(([itemId, qty]) => {
                                if (Number(qty) > 0) {
                                    cleanedItems[itemId] = Number(qty);
                                    if (box.itemNotes && box.itemNotes[itemId]) {
                                        cleanedNotes[itemId] = box.itemNotes[itemId];
                                    }
                                }
                            });
                        }

                        return {
                            ...box,
                            items: cleanedItems,
                            itemNotes: cleanedNotes
                        };
                    });
                } else {
                    // Fallback: migrate legacy fields to boxOrders array if array is missing
                    const legacyBox = {
                        boxTypeId: orderConfig.boxTypeId || '',
                        vendorId: orderConfig.vendorId || '',
                        quantity: orderConfig.boxQuantity || 1,
                        items: orderConfig.items || {},
                        itemNotes: {}
                    };
                    cleanedOrderConfig.boxOrders = [legacyBox];
                }
                // Also preserve top-level fields for backward compatibility
                if (cleanedOrderConfig.boxOrders && cleanedOrderConfig.boxOrders.length > 0) {
                    const firstBox = cleanedOrderConfig.boxOrders[0];
                    cleanedOrderConfig.vendorId = firstBox.vendorId;
                    cleanedOrderConfig.boxTypeId = firstBox.boxTypeId;
                    cleanedOrderConfig.boxQuantity = firstBox.quantity;
                    cleanedOrderConfig.items = firstBox.items;
                }
                cleanedOrderConfig.caseId = orderConfig.caseId; // Preserve case ID (also set above)
                cleanedOrderConfig.itemPrices = orderConfig.itemPrices || {}; // Preserve item prices
                console.log('[prepareActiveOrder] Box Orders prepared:', JSON.stringify(cleanedOrderConfig.boxOrders, null, 2));
            } else if (formData.serviceType === 'Custom') {
                // For Custom: Preserve vendorId and customItems
                if (orderConfig.vendorId !== undefined) {
                    cleanedOrderConfig.vendorId = orderConfig.vendorId;
                }
                cleanedOrderConfig.caseId = orderConfig.caseId; // Preserve case ID (also set above)
                // Preserve customItems array, filtering out items with empty names
                cleanedOrderConfig.customItems = (orderConfig.customItems || [])
                    .filter((item: any) => item.name && item.name.trim() !== '')
                    .map((item: any) => ({
                        name: item.name || '',
                        price: parseFloat(item.price) || 0,
                        quantity: parseInt(item.quantity) || 1
                    }));
            }

            return {
                ...cleanedOrderConfig,
                serviceType: formData.serviceType,
                lastUpdated: new Date().toISOString(),
                updatedBy: 'Admin'
            };
        };

        if (!client && !isNewClient) return false;
        setSaving(true);
        setMessage(null);

        try {
            // Handle new client creation
            if (isNewClient) {
                // Validate that client name is not empty
                if (!formData.fullName || !formData.fullName.trim()) {
                    setSaving(false);
                    setMessage('Client name is required. Please enter a client name before saving.');
                    return false;
                }

                // Determine if orderConfig has meaningful data to save (before creating client)
                const hasCaseId = orderConfig?.caseId && orderConfig.caseId.trim() !== '';
                const hasVendorSelections = orderConfig?.vendorSelections &&
                    Array.isArray(orderConfig.vendorSelections) &&
                    orderConfig.vendorSelections.some((s: any) => s.vendorId && s.vendorId.trim() !== '');
                const hasDeliveryDayOrders = orderConfig?.deliveryDayOrders &&
                    Object.keys(orderConfig.deliveryDayOrders).length > 0;
                const hasBoxConfig = (orderConfig?.vendorId && orderConfig.vendorId.trim() !== '') ||
                    (orderConfig?.boxTypeId && orderConfig.boxTypeId.trim() !== '') ||
                    (orderConfig?.boxOrders && Array.isArray(orderConfig.boxOrders) && orderConfig.boxOrders.length > 0);
                const hasOrderData = hasCaseId || hasVendorSelections || hasDeliveryDayOrders || hasBoxConfig;

                // Prepare active order data before creating client
                const preparedActiveOrder = hasOrderData ? prepareActiveOrder() : undefined;

                const initialStatusId = (initialStatuses || statuses)[0]?.id || '';
                const defaultNavigatorId = (initialNavigators || navigators).find(n => n.isActive)?.id || '';

                // Create client WITH activeOrder included during creation
                const clientData: Omit<ClientProfile, 'id' | 'createdAt' | 'updatedAt'> = {
                    fullName: formData.fullName ?? '',
                    email: formData.email ?? '',
                    address: formData.address ?? '',
                    phoneNumber: formData.phoneNumber ?? '',
                    secondaryPhoneNumber: formData.secondaryPhoneNumber ?? null,
                    navigatorId: formData.navigatorId ?? defaultNavigatorId,
                    endDate: formData.endDate ?? '',
                    screeningTookPlace: formData.screeningTookPlace ?? false,
                    screeningSigned: formData.screeningSigned ?? false,
                    notes: formData.notes ?? '',
                    statusId: formData.statusId ?? initialStatusId,
                    serviceType: formData.serviceType ?? 'Food',
                    approvedMealsPerWeek: formData.approvedMealsPerWeek ?? 21,
                    authorizedAmount: formData.authorizedAmount ?? null,
                    expirationDate: formData.expirationDate ?? null,
                    // New fields from dietfantasy
                    firstName: formData.firstName ?? null,
                    lastName: formData.lastName ?? null,
                    apt: formData.apt ?? null,
                    city: formData.city ?? null,
                    state: formData.state ?? null,
                    zip: formData.zip ?? null,
                    county: formData.county ?? null,
                    clientIdExternal: formData.clientIdExternal ?? null,
                    caseIdExternal: formData.caseIdExternal ?? null,
                    medicaid: formData.medicaid ?? false,
                    paused: formData.paused ?? false,
                    complex: formData.complex ?? false,
                    bill: formData.bill ?? true,
                    delivery: formData.delivery ?? true,
                    dislikes: formData.dislikes ?? null,
                    latitude: formData.latitude ?? null,
                    longitude: formData.longitude ?? null,
                    lat: formData.lat ?? null,
                    lng: formData.lng ?? null,
                    geocodedAt: formData.geocodedAt ?? null,
                    billings: formData.billings ?? null,
                    visits: formData.visits ?? null,
                    signToken: formData.signToken ?? null,
                    activeOrder: preparedActiveOrder // Include order details during creation
                };

                const newClient = await addClient(clientData);

                if (!newClient) {
                    setSaving(false);
                    return false;
                }

                // Fetch the created client (it already has activeOrder in the database)
                const updatedClient = await getClient(newClient.id);

                if (!updatedClient) {
                    console.error('[ClientProfile] Failed to fetch updated client after update');
                    setSaving(false);
                    setMessage('Error: Failed to fetch updated client.');
                    return false;
                }




                // IMPORTANT: Set flag BEFORE changing clientId to prevent useEffect from overwriting orderConfig
                justCreatedClientRef.current = true;

                // Update state with the updated client
                setActualClientId(updatedClient.id);
                setClient(updatedClient);
                setFormData(updatedClient);

                // Set orderConfig from the updated client's activeOrder
                if (updatedClient.activeOrder && Object.keys(updatedClient.activeOrder).length > 0) {

                    setOrderConfig(updatedClient.activeOrder);
                    setOriginalOrderConfig(updatedClient.activeOrder);
                } else {
                    // If no activeOrder, keep the current orderConfig

                }

                invalidateClientData();
                setMessage('Client created successfully.');

                // Sync to upcoming_orders if there's order data (same as edit path)
                if (updatedClient.activeOrder && updatedClient.activeOrder.caseId) {
                    await syncCurrentOrderToUpcoming(updatedClient.id, updatedClient, true);
                }

                // IMPORTANT: Set saving to false and return true BEFORE any state updates that might trigger re-renders
                setSaving(false);

                return true;
            }

            // Existing client update logic
            if (!client) {
                setSaving(false);
                return false;
            }

            // Log Navigator Action if applicable
            if (currentUser?.role === 'navigator' && pendingStatusChange && unitsAdded >= 0) {
                await logNavigatorAction({
                    navigatorId: currentUser.id,
                    clientId: clientId,
                    oldStatus: pendingStatusChange.oldStatus,
                    newStatus: pendingStatusChange.newStatus,
                    unitsAdded: unitsAdded
                });
            }

            // -- Change Detection --
            const changes: string[] = [];
            if (client.fullName !== formData.fullName) changes.push(`Full Name: "${client.fullName}" -> "${formData.fullName}"`);
            if (client.address !== formData.address) changes.push(`Address: "${client.address}" -> "${formData.address}"`);
            if (client.email !== formData.email) changes.push(`Email: "${client.email}" -> "${formData.email}"`);
            if (client.phoneNumber !== formData.phoneNumber) changes.push(`Phone: "${client.phoneNumber}" -> "${formData.phoneNumber}"`);
            if ((client.secondaryPhoneNumber || '') !== (formData.secondaryPhoneNumber || '')) {
                changes.push(`Secondary Phone: "${client.secondaryPhoneNumber || ''}" -> "${formData.secondaryPhoneNumber || ''}"`);
            }
            if (client.notes !== formData.notes) changes.push('Notes updated');
            if (client.statusId !== formData.statusId) {
                const oldStatus = statuses.find(s => s.id === client.statusId)?.name || 'Unknown';
                const newStatus = statuses.find(s => s.id === formData.statusId)?.name || 'Unknown';
                changes.push(`Status: "${oldStatus}" -> "${newStatus}"`);
            }
            if (client.navigatorId !== formData.navigatorId) {
                const oldNav = navigators.find(n => n.id === client.navigatorId)?.name || 'Unassigned';
                const newNav = navigators.find(n => n.id === formData.navigatorId)?.name || 'Unassigned';
                changes.push(`Navigator: "${oldNav}" -> "${newNav}"`);
            }
            if (client.serviceType !== formData.serviceType) changes.push(`Service Type: "${client.serviceType}" -> "${formData.serviceType}"`);
            if (client.approvedMealsPerWeek !== formData.approvedMealsPerWeek) changes.push(`Approved Meals: ${client.approvedMealsPerWeek} -> ${formData.approvedMealsPerWeek}`);
            if (client.screeningTookPlace !== formData.screeningTookPlace) changes.push(`Screening Took Place: ${client.screeningTookPlace} -> ${formData.screeningTookPlace}`);
            if (client.screeningSigned !== formData.screeningSigned) changes.push(`Screening Signed: ${client.screeningSigned} -> ${formData.screeningSigned}`);
            if ((client.authorizedAmount ?? null) !== (formData.authorizedAmount ?? null)) {
                changes.push(`Authorized Amount: ${client.authorizedAmount ?? 'null'} -> ${formData.authorizedAmount ?? 'null'}`);
            }
            if ((client.expirationDate || null) !== (formData.expirationDate || null)) {
                changes.push(`Expiration Date: ${client.expirationDate || 'null'} -> ${formData.expirationDate || 'null'}`);
            }

            // Check if order configuration changed
            // For Boxes, check if boxOrders exist (caseId is optional)
            // For other services, require caseId
            const hasOrderChanges = orderConfig && (
                formData.serviceType === 'Boxes' 
                    ? (orderConfig.boxOrders && Array.isArray(orderConfig.boxOrders) && orderConfig.boxOrders.length > 0)
                    : orderConfig.caseId
            );
            if (hasOrderChanges) {
                changes.push('Order configuration changed');
            }

            const summary = changes.length > 0 ? changes.join(', ') : 'No functional changes detected (re-saved profile)';

            // Update client profile
            // We defer this call until after we've prepared the activeOrder above if needed
            // But wait, the order config block is BELOW this. We need to move the updateClient call down or move the prep up.
            // Actually, let's keep it simple: 
            // 1. Calculate changes
            // 2. Prepare updateData
            // 3. IF order changes, add activeOrder to updateData
            // 4. Call updateClient once

            // Checking order changes again...
            // The original code called updateClient BEFORE calculating cleanedOrderConfig.
            // This means we need to restructure a bit.

            let updateData: Partial<ClientProfile> = { ...formData };

            await recordClientChange(clientId, summary, 'Admin');

            // Sync Current Order Request
            const hasOrderConfigChanges = JSON.stringify(orderConfig) !== JSON.stringify(originalOrderConfig);
            
            console.log('[ClientProfile] Order save check:', {
                serviceType: formData.serviceType,
                hasOrderConfigChanges,
                hasOrderChanges,
                hasCaseId: !!orderConfig?.caseId,
                caseId: orderConfig?.caseId,
                hasBoxOrders: !!(orderConfig?.boxOrders && Array.isArray(orderConfig.boxOrders) && orderConfig.boxOrders.length > 0),
                boxOrdersCount: orderConfig?.boxOrders?.length || 0
            });
            
            // Match triangleorder approach: Save if there are order config changes OR order changes
            // Don't check hasValidOrderData - let the backend handle validation
            if (hasOrderConfigChanges || hasOrderChanges) {
                // Add activeOrder to updateData so updateClient handles the full save + sync efficiently
                // efficiently with only ONE revalidation
                const preparedOrder = prepareActiveOrder();
                if (preparedOrder) {
                    updateData.activeOrder = preparedOrder;
                    console.log('[ClientProfile] Saving order with activeOrder:', {
                        serviceType: preparedOrder.serviceType,
                        hasCaseId: !!preparedOrder.caseId,
                        caseId: preparedOrder.caseId,
                        hasVendorSelections: !!(preparedOrder as any).vendorSelections,
                        vendorSelectionsCount: (preparedOrder as any).vendorSelections?.length || 0,
                        hasDeliveryDayOrders: !!(preparedOrder as any).deliveryDayOrders,
                        deliveryDayOrdersKeys: (preparedOrder as any).deliveryDayOrders ? Object.keys((preparedOrder as any).deliveryDayOrders) : [],
                        hasBoxOrders: !!(preparedOrder as any).boxOrders,
                        boxOrdersCount: (preparedOrder as any).boxOrders?.length || 0,
                        boxOrders: (preparedOrder as any).boxOrders?.map((box: any) => ({
                            boxTypeId: box.boxTypeId,
                            vendorId: box.vendorId,
                            itemsCount: Object.keys(box.items || {}).length
                        })) || []
                    });
                } else {
                    console.warn('[ClientProfile] prepareActiveOrder returned undefined, skipping order save');
                }
            }

            // CRITICAL: Execute the single update call
            try {
                await updateClient(clientId, updateData);
            } catch (error) {
                console.error('[ClientProfile] Error updating client:', error);
                const errorMessage = error instanceof Error ? error.message : 'An error occurred while saving the client.';
                setErrorModal({ show: true, message: errorMessage });
                setSaving(false);
                return false;
            }

            // Sync to new independent tables if there's order data
            // Sync to new independent tables if there's order data OR if we need to clear data
            const serviceType = formData.serviceType;
            
            // For Boxes service, save even without caseId (caseId is optional for boxes)
            if (serviceType === 'Boxes' && updateData.activeOrder) {
                const boxesToSave = (updateData.activeOrder as any)?.boxOrders || [];
                console.log('[ClientProfile] Saving box orders:', {
                    serviceType,
                    hasCaseId: !!updateData.activeOrder.caseId,
                    caseId: updateData.activeOrder.caseId,
                    boxesCount: boxesToSave.length,
                    boxes: boxesToSave.map((box: any) => ({
                        boxTypeId: box.boxTypeId,
                        vendorId: box.vendorId,
                        quantity: box.quantity,
                        itemsCount: Object.keys(box.items || {}).length,
                        hasItems: Object.keys(box.items || {}).length > 0
                    }))
                });
                if (boxesToSave.length > 0) {
                    await saveClientBoxOrder(clientId, boxesToSave.map((box: any) => ({
                        ...box,
                        caseId: updateData.activeOrder?.caseId
                    })));
                }
            }
            
            // For other service types, require caseId
            if (updateData.activeOrder && updateData.activeOrder.caseId) {
                if (serviceType === 'Custom') {
                    if (updateData.activeOrder.custom_name && updateData.activeOrder.custom_price && updateData.activeOrder.vendorId && updateData.activeOrder.deliveryDay) {
                        await saveClientCustomOrder(
                            clientId,
                            updateData.activeOrder.vendorId,
                            updateData.activeOrder.custom_name,
                            Number(updateData.activeOrder.custom_price),
                            updateData.activeOrder.deliveryDay,
                            updateData.activeOrder.caseId
                        );
                    }
                }

                // Save to appropriate independent tables based on what data exists
                // NOTE: A Food service client can have BOTH deliveryDayOrders AND mealSelections (e.g., Breakfast)

                // Save food orders: ALWAYS if service type is Food, to allow clearing
                if (serviceType === 'Food') {
                    await saveClientFoodOrder(clientId, {
                        caseId: updateData.activeOrder.caseId,
                        deliveryDayOrders: (updateData.activeOrder as any).deliveryDayOrders || {}
                    });
                }

                // Also handle the case where we might have food orders but currently not Food service? 
                // No, only save to Food table if type is Food.

                // Save meal orders if mealSelections exists OR if service type is Meal OR if service type is Food (to allow clearing)
                if ((updateData.activeOrder as any).mealSelections || serviceType === 'Meal' || serviceType === 'Food') {
                    await saveClientMealOrder(clientId, {
                        caseId: updateData.activeOrder.caseId,
                        mealSelections: (updateData.activeOrder as any).mealSelections || {}
                    });
                }
            }
            // Still call legacy sync for backward compatibility during migration
            await syncCurrentOrderToUpcoming(clientId, { ...client, ...updateData } as ClientProfile, true);

            // Reload upcoming order if we had order changes
            // COMMENTED OUT: We rely on updatedClient.activeOrder which we just loaded above.
            // Fetching upcomingOrder here caused Draft orders (which don't exist in upcoming_orders table)
            // to be overwritten with null/empty, clearing the form.
            /*
            if (hasOrderConfigChanges || hasOrderChanges) {
                const updatedUpcomingOrder = await getUpcomingOrderForClient(clientId);
                if (updatedUpcomingOrder) {
                    setOrderConfig(updatedUpcomingOrder);
                    setOriginalOrderConfig(JSON.parse(JSON.stringify(updatedUpcomingOrder)));
                }
            }
            */

            // Show cutoff-aware confirmation message if order was saved
            let confirmationMessage = 'Changes saved successfully.';
            if (hasOrderChanges && orderConfig && orderConfig.caseId) {
                const cutoffPassed = isCutoffPassed();
                const takeEffectDate = getEarliestTakeEffectDateForOrder();

                if (cutoffPassed && takeEffectDate) {
                    confirmationMessage = `Order saved. The weekly cutoff has passed, so this order will take effect on ${takeEffectDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} (earliest effective date is always a Sunday). View Recent Orders section to see what will be delivered this week.`;
                } else if (takeEffectDate) {
                    confirmationMessage = `Order saved successfully. This order will take effect on ${takeEffectDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}.`;
                }
            }

            // Always close modal and client portal after saving (especially for navigators adding units)
            const wasNavigatorAddingUnits = currentUser?.role === 'navigator' && pendingStatusChange !== null;
            setShowUnitsModal(false);
            setPendingStatusChange(null);
            
            // If navigator added units, always close the portal
            if (wasNavigatorAddingUnits && onClose) {
                onClose();
                return true;
            }
            
            if (onClose) {
                onClose();
            } else {
                setMessage(confirmationMessage);
                setTimeout(() => setMessage(null), 6000); // Longer timeout for longer messages
                const updatedClient = await getClient(clientId);
                if (updatedClient) {
                    setClient(updatedClient);
                    loadData();
                }
            }
            return true;
        } catch (error) {
            setMessage('Error saving changes.');
            console.error(error);
            // Even on error, close modal and portal if navigator was adding units
            const wasNavigatorAddingUnits = currentUser?.role === 'navigator' && pendingStatusChange !== null;
            setShowUnitsModal(false);
            setPendingStatusChange(null);
            if (onClose && wasNavigatorAddingUnits) {
                onClose();
            }
            return false;
        } finally {
            setSaving(false);
            // Ensure modal is closed
            setShowUnitsModal(false);
            setPendingStatusChange(null);
        }
    }
}
