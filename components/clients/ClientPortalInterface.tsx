'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { ClientProfile, ClientStatus, Navigator, Vendor, MenuItem, BoxType, ItemCategory, BoxQuota, BoxConfiguration, ServiceType } from '@/lib/types';
import { syncCurrentOrderToUpcoming, getBoxQuotas, invalidateOrderData, updateClient, saveClientFoodOrder, saveClientBoxOrder, saveClientMealPlannerData, isFoodOrderSameAsDefault } from '@/lib/actions';
import { getCachedDefaultOrderTemplate, getDefaultOrderTemplateCachedSync } from '@/lib/default-order-template-cache';
import { migrateLegacyBoxOrder, getTotalBoxCount, validateBoxCountAgainstAuthorization, getMaxBoxesAllowed } from '@/lib/box-order-helpers';
import { fromStoredUpcomingOrder } from '@/lib/upcoming-order-schema';
import { Package, Truck, User, Loader2, Info, Plus, Calendar, AlertTriangle, Check, Trash2 } from 'lucide-react';
import styles from './ClientProfile.module.css';
import { SavedMealPlanMonth } from './SavedMealPlanMonth';

interface Props {
    client: ClientProfile;
    statuses: ClientStatus[];
    navigators: Navigator[];
    vendors: Vendor[];
    menuItems: MenuItem[];
    boxTypes: BoxType[];
    categories: ItemCategory[];
    upcomingOrder: any;
    activeOrder: any;
    previousOrders: any[];
    /** When true, show only Current Order Request + Saved Meal Plan (for client portal). Keeps code independent from admin profile. */
    orderAndMealPlanOnly?: boolean;
    /** Preloaded meal plan orders for Saved Meal Plan section (when orderAndMealPlanOnly and service is Food). */
    initialMealPlanOrders?: any[] | null;
    /** Primary + dependants for "People on this account" in sidebar (client portal). */
    householdPeople?: ClientProfile[];
}

export function ClientPortalInterface({ client: initialClient, householdPeople = [], statuses, navigators, vendors, menuItems, boxTypes, categories, upcomingOrder, activeOrder, previousOrders, orderAndMealPlanOnly = false, initialMealPlanOrders = null }: Props) {
    const router = useRouter();
    const [client, setClient] = useState<ClientProfile>(initialClient);
    const [activeBoxQuotas, setActiveBoxQuotas] = useState<BoxQuota[]>([]);


    // Profile State
    const [profileData, setProfileData] = useState({
        fullName: initialClient.fullName,
        email: initialClient.email || '',
        phoneNumber: initialClient.phoneNumber || '',
        secondaryPhoneNumber: initialClient.secondaryPhoneNumber || '',
        address: initialClient.address || ''
    });
    const [originalProfileData, setOriginalProfileData] = useState({
        fullName: initialClient.fullName,
        email: initialClient.email || '',
        phoneNumber: initialClient.phoneNumber || '',
        secondaryPhoneNumber: initialClient.secondaryPhoneNumber || '',
        address: initialClient.address || ''
    });

    // Order Configuration State — initialize from upcomingOrder on portal so first paint has data (avoids zero flash)
    const [orderConfig, setOrderConfig] = useState<any>(() => {
        if (!orderAndMealPlanOnly || !upcomingOrder || !initialClient) return {};
        const st = (initialClient.serviceType || 'Food') as ServiceType;
        const hydrated = fromStoredUpcomingOrder(upcomingOrder, st);
        return hydrated ?? {};
    });
    const [originalOrderConfig, setOriginalOrderConfig] = useState<any>(() => {
        if (!orderAndMealPlanOnly || !upcomingOrder || !initialClient) return {};
        const st = (initialClient.serviceType || 'Food') as ServiceType;
        const hydrated = fromStoredUpcomingOrder(upcomingOrder, st);
        const config = hydrated ?? {};
        return JSON.parse(JSON.stringify(config));
    });

    // UI State
    const [saving, setSaving] = useState(false);
    const [savingProfile, setSavingProfile] = useState(false);
    const [message, setMessage] = useState<string | null>('');
    const [profileMessage, setProfileMessage] = useState<string | null>('');
    const [missingItemsToastDismissed, setMissingItemsToastDismissed] = useState(false);
    /** Current meal plan orders (from SavedMealPlanMonth) for saving only when user clicks Save. */
    const [mealPlanOrders, setMealPlanOrders] = useState<any[]>([]);
    /** Dates edited in meal plan this session; save bar shows and we only write these to clients.meal_planner_data. */
    const [mealPlanEditedDates, setMealPlanEditedDates] = useState<string[]>([]);
    const [mealPlanEditedResetTrigger, setMealPlanEditedResetTrigger] = useState(0);
    const [mealPlanDiscardTrigger, setMealPlanDiscardTrigger] = useState(0);

    // Reset missing-items toast when client changes so it can show again for another client
    useEffect(() => {
        setMissingItemsToastDismissed(false);
    }, [client?.id]);

    // Sync profile data when initialClient changes
    useEffect(() => {
        setProfileData({
            fullName: initialClient.fullName,
            email: initialClient.email || '',
            phoneNumber: initialClient.phoneNumber || '',
            secondaryPhoneNumber: initialClient.secondaryPhoneNumber || '',
            address: initialClient.address || ''
        });
        setOriginalProfileData({
            fullName: initialClient.fullName,
            email: initialClient.email || '',
            phoneNumber: initialClient.phoneNumber || '',
            secondaryPhoneNumber: initialClient.secondaryPhoneNumber || '',
            address: initialClient.address || ''
        });
        setClient(initialClient);
    }, [initialClient]);

    // Track if we've already initialized to prevent overwriting user changes
    const hasInitializedRef = useRef(false);
    const lastSavedTimestampRef = useRef<string | null>(null);
    const lastUpcomingOrderIdRef = useRef<string | null>(null);
    const defaultTemplateAppliedRef = useRef(false);
    const lastClientIdForDefaultRef = useRef<string | null>(null);

    // Same as ClientProfile: true if order has any vendor/delivery-day items
    function hasOrderDetailsInOrder(order: any): boolean {
        if (!order || typeof order !== 'object') return false;
        const vs = order.vendorSelections ?? order.vendor_selections;
        if (Array.isArray(vs) && vs.some((s: any) => s?.items && typeof s.items === 'object' && Object.keys(s.items).length > 0)) return true;
        const ddo = order.deliveryDayOrders ?? order.delivery_day_orders;
        if (ddo && typeof ddo === 'object' && Object.values(ddo).some((d: any) => (d?.vendorSelections || d?.vendor_selections || []).some((s: any) => s?.items && Object.keys(s.items || {}).length > 0))) return true;
        return false;
    }

    // Initialize order config - matching ClientProfile logic exactly (read from clients.upcoming_order; when empty, use default template)
    useEffect(() => {
        if (!client) {
            return;
        }

        // Get the upcoming order ID and timestamp for comparison
        const upcomingOrderId = upcomingOrder ? (
            typeof upcomingOrder === 'object' && !(upcomingOrder as any).serviceType ?
                (upcomingOrder as any)['default']?.id :
                (upcomingOrder as any)?.id
        ) : null;

        const upcomingOrderTimestamp = upcomingOrder ? (
            typeof upcomingOrder === 'object' && !(upcomingOrder as any).serviceType ?
                (upcomingOrder as any)['default']?.lastUpdated :
                (upcomingOrder as any)?.lastUpdated
        ) : null;

        // If we've already initialized and client.activeOrder is more recent than upcomingOrder,
        // prefer client.activeOrder to prevent overwriting recent saves
        const clientActiveOrderTimestamp = (client?.activeOrder as any)?.lastUpdated;
        const upcomingOrderUnchanged = upcomingOrderId === lastUpcomingOrderIdRef.current;
        const clientActiveOrderIsNewer = clientActiveOrderTimestamp && upcomingOrderTimestamp &&
            new Date(clientActiveOrderTimestamp) > new Date(upcomingOrderTimestamp);

        const shouldPreferClientActiveOrder = hasInitializedRef.current &&
            upcomingOrderUnchanged &&
            clientActiveOrderIsNewer &&
            client.activeOrder;

        if (shouldPreferClientActiveOrder) {
            const configToSet = { ...client.activeOrder };
            if (!configToSet.serviceType) {
                configToSet.serviceType = client.serviceType;
            }
            setOrderConfig(configToSet);
            setOriginalOrderConfig(JSON.parse(JSON.stringify(configToSet)));
            return;
        }

        let configToSet: any = {};
        let source = '';

        // Client portal: single source of truth is clients.upcoming_order (via upcomingOrder / client.activeOrder).
        // Never populate the form from activeOrder (orders table) so we always read/write clients.upcoming_order.
        const useOnlyClientUpcomingOrder = orderAndMealPlanOnly;

        const sourceOrder = upcomingOrder ?? client.activeOrder ?? null;

        if (useOnlyClientUpcomingOrder) {
            // Portal: use only client.activeOrder (clients.upcoming_order) or empty default.
            // Use same hydration as getClient (fromStoredUpcomingOrder) so items/vendorSelections match profile.
            if (sourceOrder) {
                source = 'client.upcoming_order';
                const serviceType = (client.serviceType || 'Food') as ServiceType;
                const hydrated = fromStoredUpcomingOrder(sourceOrder, serviceType);
                if (hydrated) {
                    configToSet = hydrated;
                } else {
                    const order = sourceOrder as any;
                    const isMultiDayFormat = typeof order === 'object' &&
                        !order.serviceType &&
                        !order.deliveryDayOrders &&
                        Object.keys(order).some((key: string) => {
                            const val = order[key];
                            return val && typeof val === 'object' && (val as any).serviceType;
                        });

                    if (isMultiDayFormat) {
                        const deliveryDayOrders: any = {};
                        for (const day of Object.keys(order)) {
                            const dayOrder = order[day];
                            if (dayOrder && (dayOrder as any).serviceType) {
                                deliveryDayOrders[day] = {
                                    vendorSelections: (dayOrder as any).vendorSelections || (dayOrder as any).vendor_selections || []
                                };
                            }
                        }
                        const firstDayKey = Object.keys(order)[0];
                        const firstDayOrder = order[firstDayKey];
                        if (firstDayOrder?.serviceType === 'Boxes') {
                            configToSet = firstDayOrder;
                        } else {
                            configToSet = {
                                serviceType: firstDayOrder?.serviceType || client.serviceType,
                                deliveryDayOrders
                            };
                        }
                    } else if (order.serviceType === 'Food' && !order.vendorSelections?.length && !(order.deliveryDayOrders && Object.keys(order.deliveryDayOrders).length > 0)) {
                        if (order.vendorId) {
                            configToSet = { ...order, vendorSelections: [{ vendorId: order.vendorId, items: order.menuSelections || {} }] };
                        } else {
                            configToSet = { ...order, vendorSelections: [{ vendorId: '', items: {} }] };
                        }
                    } else {
                        configToSet = { ...order };
                    }
                }
            } else {
                source = 'default';
                configToSet = client.serviceType === 'Food'
                    ? { serviceType: 'Food', vendorSelections: [{ vendorId: '', items: {} }] }
                    : { serviceType: client.serviceType };
            }
        } else {
            // Admin ClientProfile: existing priority (upcoming_orders table, then activeOrder, then client.activeOrder, then default)
            if (upcomingOrder) {
                source = 'upcomingOrder';
                const isMultiDayFormat = upcomingOrder && typeof upcomingOrder === 'object' &&
                    !(upcomingOrder as any).serviceType &&
                    !(upcomingOrder as any).deliveryDayOrders &&
                    Object.keys(upcomingOrder).some(key => {
                        const val = (upcomingOrder as any)[key];
                        return val && val.serviceType;
                    });

                if (isMultiDayFormat) {
                    const deliveryDayOrders: any = {};
                    for (const day of Object.keys(upcomingOrder)) {
                        const dayOrder = (upcomingOrder as any)[day];
                        if (dayOrder && dayOrder.serviceType) {
                            deliveryDayOrders[day] = { vendorSelections: dayOrder.vendorSelections || [] };
                        }
                    }
                    const firstDayKey = Object.keys(upcomingOrder)[0];
                    const firstDayOrder = (upcomingOrder as any)[firstDayKey];
                    if (firstDayOrder?.serviceType === 'Boxes') {
                        configToSet = firstDayOrder;
                    } else {
                        configToSet = {
                            serviceType: firstDayOrder?.serviceType || client.serviceType,
                            deliveryDayOrders
                        };
                    }
                } else if ((upcomingOrder as any).serviceType === 'Food' && !(upcomingOrder as any).vendorSelections && !(upcomingOrder as any).deliveryDayOrders) {
                    if ((upcomingOrder as any).vendorId) {
                        (upcomingOrder as any).vendorSelections = [{ vendorId: (upcomingOrder as any).vendorId, items: (upcomingOrder as any).menuSelections || {} }];
                    } else {
                        (upcomingOrder as any).vendorSelections = [{ vendorId: '', items: {} }];
                    }
                    configToSet = upcomingOrder;
                } else {
                    configToSet = upcomingOrder;
                }
            } else if (activeOrder) {
                source = 'activeOrder';
                if ((activeOrder as any).multiple === true && Array.isArray((activeOrder as any).orders) && client.serviceType === 'Food') {
                    const orders = (activeOrder as any).orders as any[];
                    const deliveryDayOrders: any = {};
                    for (const order of orders) {
                        const dayKey = order.scheduledDeliveryDate || order.deliveryDay || order.id;
                        if (order.vendorSelections?.length > 0) {
                            deliveryDayOrders[dayKey] = { vendorSelections: order.vendorSelections };
                        }
                    }
                    configToSet = Object.keys(deliveryDayOrders).length > 0
                        ? { serviceType: 'Food', caseId: orders[0]?.caseId, deliveryDayOrders }
                        : (orders[0] ? { ...orders[0], serviceType: 'Food' } : { serviceType: 'Food', vendorSelections: [{ vendorId: '', items: {} }] });
                } else {
                    configToSet = { ...activeOrder };
                    if (!configToSet.serviceType) configToSet.serviceType = client.serviceType;
                }
            } else if (client.activeOrder) {
                source = 'client.activeOrder';
                configToSet = { ...client.activeOrder };
                if (!configToSet.serviceType) configToSet.serviceType = client.serviceType;
            } else {
                source = 'default';
                configToSet = client.serviceType === 'Food'
                    ? { serviceType: 'Food', vendorSelections: [{ vendorId: '', items: {} }] }
                    : { serviceType: client.serviceType };
            }
        }

        // Migrate legacy box order format to new format if needed
        if (configToSet.serviceType === 'Boxes') {
            configToSet = migrateLegacyBoxOrder(configToSet);
        }

        // Client portal + Food with no order data: use default order template (same as ClientProfile loadData)
        if (useOnlyClientUpcomingOrder && client.id !== lastClientIdForDefaultRef.current) {
            lastClientIdForDefaultRef.current = client.id;
            defaultTemplateAppliedRef.current = false;
        }
        const shouldApplyDefaultTemplate = useOnlyClientUpcomingOrder && client.serviceType === 'Food' && !defaultTemplateAppliedRef.current &&
            (!sourceOrder || !hasOrderDetailsInOrder(sourceOrder));

        const defaultVendorId = (vendors?.length && (vendors.find((v: any) => v.isDefault && (v.serviceTypes || []).includes('Food'))?.id || vendors.find((v: any) => (v.serviceTypes || []).includes('Food'))?.id || vendors[0]?.id)) || '';

        function applyTemplateToState(template: any) {
            if (!template) return;
            const templateVs = template.vendorSelections || [];
            const applied: any = { serviceType: 'Food', caseId: template.caseId, notes: template.notes };
            if (template.deliveryDayOrders && typeof template.deliveryDayOrders === 'object' && Object.keys(template.deliveryDayOrders).length > 0) {
                applied.deliveryDayOrders = {};
                for (const [day, dayOrder] of Object.entries(template.deliveryDayOrders)) {
                    const dayVal = dayOrder as { vendorSelections?: any[] };
                    const selections = (dayVal.vendorSelections || []).map((vs: any) => ({
                        vendorId: defaultVendorId || vs.vendorId || '',
                        items: { ...(vs.items || {}) }
                    }));
                    if (selections.length > 0) applied.deliveryDayOrders[day] = { vendorSelections: selections };
                }
            }
            if (!applied.deliveryDayOrders || Object.keys(applied.deliveryDayOrders).length === 0) {
                applied.vendorSelections = templateVs.length > 0
                    ? templateVs.map((vs: any) => ({ vendorId: defaultVendorId || vs.vendorId || '', items: { ...(vs.items || {}) } }))
                    : [{ vendorId: defaultVendorId || '', items: {} }];
            }
            setOrderConfig(applied);
            setOriginalOrderConfig(JSON.parse(JSON.stringify(applied)));
            defaultTemplateAppliedRef.current = true;
        }

        if (shouldApplyDefaultTemplate) {
            const cached = getDefaultOrderTemplateCachedSync('Food');
            if (cached) {
                applyTemplateToState(cached);
            } else {
                getCachedDefaultOrderTemplate('Food')
                    .then((template) => {
                        if (template) {
                            applyTemplateToState(template);
                        } else {
                            defaultTemplateAppliedRef.current = false;
                            setOrderConfig(configToSet);
                            setOriginalOrderConfig(JSON.parse(JSON.stringify(configToSet)));
                        }
                    })
                    .catch((e) => {
                        console.warn('[ClientPortalInterface] Default Food template load failed', e);
                        defaultTemplateAppliedRef.current = false;
                        setOrderConfig(configToSet);
                        setOriginalOrderConfig(JSON.parse(JSON.stringify(configToSet)));
                    });
            }
        }

        // Don't overwrite with empty when: we've already applied the default template, OR we're about to apply it (so client never sees zero when they have no upcoming order)
        const skipOverwriteWithEmpty = useOnlyClientUpcomingOrder && client.serviceType === 'Food' && (
            (defaultTemplateAppliedRef.current && !hasOrderDetailsInOrder(configToSet)) ||
            shouldApplyDefaultTemplate
        );

        if (!skipOverwriteWithEmpty) {
            setOrderConfig(configToSet);
            const deepCopy = JSON.parse(JSON.stringify(configToSet));
            setOriginalOrderConfig(deepCopy);
        }
        hasInitializedRef.current = true;

        // Track the upcoming order ID we just initialized from
        const currentUpcomingOrderId = upcomingOrder ? (
            typeof upcomingOrder === 'object' && !(upcomingOrder as any).serviceType ?
                (upcomingOrder as any)['default']?.id :
                (upcomingOrder as any)?.id
        ) : null;
        lastUpcomingOrderIdRef.current = currentUpcomingOrderId;
    }, [upcomingOrder, activeOrder, client, vendors]);

    // Box Logic - Load quotas if boxTypeId is set (supports both legacy and new format)
    useEffect(() => {
        if (client.serviceType === 'Boxes') {
            const boxTypeId = orderConfig.boxes?.[0]?.boxTypeId || orderConfig.boxTypeId;
            if (boxTypeId) {
                getBoxQuotas(boxTypeId).then(quotas => {
                    setActiveBoxQuotas(quotas);
                }).catch(err => {
                    console.error('Error loading box quotas:', err);
                    setActiveBoxQuotas([]);
                });
            } else {
                setActiveBoxQuotas([]);
            }
        } else {
            setActiveBoxQuotas([]);
        }
    }, [orderConfig.boxes, orderConfig.boxTypeId, client.serviceType]);

    // Portal + Food: always single-vendor UI — no vendor dropdown, no Add Vendor (client-portal page only)
    const foodVendors = useMemo(() => vendors.filter((v: any) => {
        const active = v.isActive !== false;
        const types = v.serviceTypes ?? [];
        const hasFood = Array.isArray(types) ? types.some((t: string) => String(t).toLowerCase() === 'food') : false;
        return hasFood && active;
    }), [vendors]);
    const singleVendorMode = Boolean(orderAndMealPlanOnly && client.serviceType === 'Food');
    const singleVendor = singleVendorMode ? (foodVendors[0] ?? vendors[0] ?? null) : null;

    const singleVendorInitDoneRef = useRef(false);
    useEffect(() => {
        if (!singleVendorMode || !singleVendor) return;
        if (singleVendorInitDoneRef.current) return;
        setOrderConfig((prev: any) => {
            const current = prev.vendorSelections || [];
            const hasSingleVendor = current.length === 1 && current[0]?.vendorId === singleVendor.id;
            if (hasSingleVendor) {
                singleVendorInitDoneRef.current = true;
                return prev;
            }
            const needInit = current.length === 0 || (current.length === 1 && !current[0]?.vendorId);
            if (!needInit) return prev;

            const ddo = prev.deliveryDayOrders;
            const hasItemsInDdo = ddo && typeof ddo === 'object' && Object.keys(ddo).length > 0 &&
                Object.values(ddo).some((dayOrder: any) => (dayOrder?.vendorSelections ?? []).some((s: any) => Object.keys(s?.items ?? {}).length > 0));

            singleVendorInitDoneRef.current = true;
            let one: any[];
            let next: any;
            if (hasItemsInDdo && ddo) {
                const deliveryDays = Object.keys(ddo).sort();
                const itemsByDay: Record<string, Record<string, number>> = {};
                const selectedDeliveryDays: string[] = [];
                for (const day of deliveryDays) {
                    const dayOrder = ddo[day];
                    const selections = dayOrder?.vendorSelections ?? [];
                    const sel = selections.find((s: any) => s.vendorId === singleVendor.id) ?? selections[0];
                    if (sel?.items && Object.keys(sel.items).length > 0) {
                        itemsByDay[day] = sel.items;
                        selectedDeliveryDays.push(day);
                    }
                }
                one = [{ vendorId: singleVendor.id, items: {}, itemsByDay, selectedDeliveryDays }];
                next = { ...prev, vendorSelections: one, deliveryDayOrders: ddo };
            } else {
                one = [{ vendorId: singleVendor.id, items: current[0]?.items || {}, itemsByDay: current[0]?.itemsByDay, selectedDeliveryDays: current[0]?.selectedDeliveryDays || [] }];
                next = { ...prev, vendorSelections: one, deliveryDayOrders: prev.deliveryDayOrders ?? undefined };
            }
            setOriginalOrderConfig(JSON.parse(JSON.stringify(next)));
            return next;
        });
    }, [singleVendorMode, singleVendor?.id]);

    // Extract dependencies for auto-save
    const vendorSelections = useMemo(() => orderConfig?.vendorSelections ?? [], [orderConfig?.vendorSelections]);
    const vendorId = useMemo(() => orderConfig?.vendorId ?? null, [orderConfig?.vendorId]);
    const boxTypeId = useMemo(() => orderConfig?.boxTypeId ?? null, [orderConfig?.boxTypeId]);
    const boxQuantity = useMemo(() => orderConfig?.boxQuantity ?? null, [orderConfig?.boxQuantity]);
    const items = useMemo(() => (orderConfig as any)?.items ?? {}, [JSON.stringify((orderConfig as any)?.items)]);
    const itemPrices = useMemo(() => (orderConfig as any)?.itemPrices ?? {}, [(orderConfig as any)?.itemPrices]);
    const serviceType = client.serviceType;

    // Auto-Save Logic - matching ClientProfile exactly
    // Manual Save Logic
    const handleSave = async () => {
        console.log('[ClientPortalInterface] handleSave called', {
            mealPlanEditedDatesCount: mealPlanEditedDates.length,
            mealPlanEditedDatesSample: mealPlanEditedDates.slice(0, 5),
            orderAndMealPlanOnly
        });
        if (!client || !orderConfig) {
            setMessage('Error: Missing client or order configuration. Please refresh the page.');
            setTimeout(() => setMessage(null), 5000);
            return;
        }

        // Check if orderConfig is effectively empty (no meaningful data). In portal meal-plan-only mode, allow save when only meal plan was edited.
        const hasOrderData =
            (orderConfig.vendorSelections && orderConfig.vendorSelections.length > 0) ||
            (orderConfig.deliveryDayOrders && Object.keys(orderConfig.deliveryDayOrders).length > 0) ||
            (orderConfig.vendorId && orderConfig.vendorId.trim() !== '') ||
            (orderConfig.boxTypeId && orderConfig.boxTypeId.trim() !== '') ||
            (orderConfig.boxes && orderConfig.boxes.length > 0) ||
            (orderConfig.customItems && orderConfig.customItems.length > 0);
        const mealPlanOnlySave = orderAndMealPlanOnly && mealPlanEditedDates.length > 0;
        console.log('[ClientPortalInterface] hasOrderData=', hasOrderData, 'mealPlanOnlySave=', mealPlanOnlySave);

        if (!hasOrderData && !mealPlanOnlySave) {
            setMessage('Error: Please configure your order (select vendors, items, or boxes) or edit the meal plan before saving.');
            setTimeout(() => setMessage(null), 5000);
            return;
        }

        // Comprehensive pre-save validation
        const validationErrors: string[] = [];

        if (serviceType === 'Food') {
            // Check if order has items after cleaning
            const hasItemsInVendorSelections = orderConfig.vendorSelections?.some((s: any) => {
                if (!s.vendorId) return false;
                const items = s.items || {};
                return Object.keys(items).length > 0 && Object.values(items).some((qty: any) => (Number(qty) || 0) > 0);
            });

            const hasItemsInDeliveryDayOrders = orderConfig.deliveryDayOrders && Object.values(orderConfig.deliveryDayOrders).some((day: any) => {
                if (!day.vendorSelections || day.vendorSelections.length === 0) return false;
                return day.vendorSelections.some((s: any) => {
                    if (!s.vendorId) return false;
                    const items = s.items || {};
                    return Object.keys(items).length > 0 && Object.values(items).some((qty: any) => (Number(qty) || 0) > 0);
                });
            });

            const hasItemsInItemsByDay = orderConfig.vendorSelections?.some((s: any) => {
                if (!s.vendorId || !s.itemsByDay || !s.selectedDeliveryDays) return false;
                return s.selectedDeliveryDays.some((day: string) => {
                    const dayItems = s.itemsByDay[day] || {};
                    return Object.keys(dayItems).length > 0 && Object.values(dayItems).some((qty: any) => (Number(qty) || 0) > 0);
                });
            });

            if (
                !hasItemsInVendorSelections &&
                !hasItemsInDeliveryDayOrders &&
                !hasItemsInItemsByDay &&
                !mealPlanOnlySave
            ) {
                validationErrors.push('Please select at least one item before saving');
            }

            // Per-date: total meals must equal expected for that day (expectedTotalMeals × household size). Block save if any date does not match.
            const householdSize = Math.max(1, householdPeople?.length ?? 1);
            for (const order of mealPlanOrders) {
                const expectedForDay = (order.expectedTotalMeals ?? 0) * householdSize;
                if (expectedForDay <= 0) continue;
                const currentForDay = (order.items ?? []).reduce((s: number, i: { value?: number | null; quantity?: number }) => s + ((i.value ?? 1) * Math.max(0, Number(i.quantity) ?? 0)), 0);
                if (currentForDay !== expectedForDay) {
                    validationErrors.push(`Total meals for each day must equal the expected amount. At least one day has ${currentForDay} selected but must be exactly ${expectedForDay}.`);
                    break;
                }
            }
            // Also check aggregate for non–meal-plan path (recurring order)
            const totalValueFromPlan = mealPlanOrders.reduce((sum, o) => sum + (o.items ?? []).reduce((s: number, i: { value?: number | null; quantity?: number }) => s + ((i.value ?? 1) * Math.max(0, Number(i.quantity) ?? 0)), 0), 0);
            const totalValue = mealPlanOrders.length > 0 ? totalValueFromPlan : getTotalMealCountAllDays();
            const totalExpectedFromPlan = mealPlanOrders.reduce((sum, o) => sum + (o.expectedTotalMeals ?? 0), 0) * householdSize;
            if (totalExpectedFromPlan > 0 && totalValue !== totalExpectedFromPlan && validationErrors.every(e => !e.includes('Total meals for each day'))) {
                if (totalValue > totalExpectedFromPlan) {
                    validationErrors.push(`Total meals (${totalValue}) exceeds the expected total for your delivery dates (${totalExpectedFromPlan}). Please reduce to match.`);
                } else {
                    validationErrors.push(`Total meals (${totalValue}) is less than the expected total for your delivery dates (${totalExpectedFromPlan}). Please add items to match.`);
                }
            }

            // Validate vendors have delivery days configured (if we can check)
            if (orderConfig.vendorSelections && orderConfig.vendorSelections.length > 0) {
                const vendorsWithoutDays = orderConfig.vendorSelections
                    .filter((s: any) => s.vendorId)
                    .map((s: any) => {
                        const vendor = vendors.find(v => v.id === s.vendorId);
                        return vendor && (!vendor.deliveryDays || vendor.deliveryDays.length === 0) ? vendor.name : null;
                    })
                    .filter(Boolean);

                if (vendorsWithoutDays.length > 0) {
                    validationErrors.push(`Vendor(s) ${vendorsWithoutDays.join(', ')} have no delivery days configured. Please contact support.`);
                }
            }
        } else if (serviceType === 'Boxes') {
            // CRITICAL: Always use orderConfig.boxes directly if it exists, even if empty
            // This ensures we're reading from the current state, not a stale migration
            let boxes: BoxConfiguration[] = [];
            
            if (orderConfig.boxes && Array.isArray(orderConfig.boxes)) {
                // Use boxes directly from orderConfig (current state)
                boxes = orderConfig.boxes;
            } else {
                // Only migrate if boxes doesn't exist at all
                const migrated = migrateLegacyBoxOrder(orderConfig);
                boxes = migrated.boxes || [];
            }


            // Validate boxes array exists and has at least one box
            if (boxes.length === 0) {
                // Fallback to legacy validation
                if (!orderConfig.vendorId && !orderConfig.boxTypeId) {
                    validationErrors.push('Please add at least one box to the order.');
                }
            } else {
                // Validate each box has a boxTypeId
                for (const box of boxes) {
                    if (!box.boxTypeId || box.boxTypeId.trim() === '') {
                        validationErrors.push(`Box #${box.boxNumber} must have a box type selected.`);
                    }
                }

                // Validate against authorization
                if (boxes.length > 0) {
                    const firstBoxType = boxTypes.find(bt => bt.id === boxes[0].boxTypeId);
                    const validation = validateBoxCountAgainstAuthorization(
                        boxes.length,
                        client.authorizedAmount,
                        firstBoxType?.priceEach
                    );

                    if (!validation.valid) {
                        validationErrors.push(validation.message || 'Box count exceeds authorization.');
                    }
                }

                // Validate category set values per box
                for (const box of boxes) {
                    // CRITICAL: Read items directly from box.items, ensuring we have the current state
                    const selectedItems = box.items || {};
                    const boxType = boxTypes.find(bt => bt.id === box.boxTypeId);
                    const boxQuotas = boxType ? activeBoxQuotas.filter(q => q.boxTypeId === box.boxTypeId) : [];

                    // Check each category that has a setValue
                    for (const category of categories) {
                        if (category.setValue !== undefined && category.setValue !== null) {
                            // Calculate total quota value for this category in this box
                            let categoryQuotaValue = 0;

                            for (const [itemId, qty] of Object.entries(selectedItems)) {
                                const item = menuItems.find(i => i.id === itemId);
                                if (item && item.categoryId === category.id) {
                                    const itemQuotaValue = item.quotaValue || 1;
                                    const quantity = Number(qty) || 0;
                                    categoryQuotaValue += quantity * itemQuotaValue;
                                }
                            }

                            // Check if it matches exactly the setValue
                            if (categoryQuotaValue !== category.setValue) {
                                validationErrors.push(
                                    `Box #${box.boxNumber}: You must have a total of ${category.setValue} ${category.name} points, but you have ${categoryQuotaValue}. ` +
                                    `Please adjust items in this category to match exactly.`
                                );
                            }
                        }
                    }

                    // Validate box quotas if applicable
                    if (boxType && boxQuotas.length > 0) {
                        for (const quota of boxQuotas) {
                            let categoryQuotaValue = 0;

                            for (const [itemId, qty] of Object.entries(selectedItems)) {
                                const item = menuItems.find(i => i.id === itemId);
                                if (item && item.categoryId === quota.categoryId) {
                                    const itemQuotaValue = item.quotaValue || 1;
                                    categoryQuotaValue += (qty as number) * itemQuotaValue;
                                }
                            }

                            const requiredQuotaValue = quota.targetValue; // Per box
                            if (categoryQuotaValue !== requiredQuotaValue) {
                                const category = categories.find(c => c.id === quota.categoryId);
                                const categoryName = category?.name || 'Unknown Category';
                                validationErrors.push(
                                    `Box #${box.boxNumber}: Category "${categoryName}" requires exactly ${requiredQuotaValue} quota value, but you have ${categoryQuotaValue}. ` +
                                    `Please adjust items in this category to match exactly.`
                                );
                            }
                        }
                    }
                }
            }

            // Legacy format validation (fallback) - only if no boxes exist at all
            // IMPORTANT: Only validate legacy format if boxes array doesn't exist or is truly empty
            // If orderConfig.boxes exists (even if empty array), we've already validated using boxes format above
            // CRITICAL: Don't run legacy validation if we have boxes - that means items are in boxes[].items, not orderConfig.items
            if (boxes.length === 0 && orderConfig.items && (!orderConfig.boxes || (Array.isArray(orderConfig.boxes) && orderConfig.boxes.length === 0))) {
                const selectedItems = orderConfig.items || {};
                const boxQuantity = orderConfig.boxQuantity || 1;

                for (const category of categories) {
                    if (category.setValue !== undefined && category.setValue !== null) {
                        let categoryQuotaValue = 0;

                        for (const [itemId, qty] of Object.entries(selectedItems)) {
                            const item = menuItems.find(i => i.id === itemId);
                            if (item && item.categoryId === category.id) {
                                const itemQuotaValue = item.quotaValue || 1;
                                categoryQuotaValue += (qty as number) * itemQuotaValue;
                            }
                        }

                        // For Boxes serviceType, multiply setValue by the number of boxes
                        // This supports multiple boxes where each box needs to meet the setValue requirement
                        const requiredSetValue = orderConfig.serviceType === 'Boxes' 
                            ? category.setValue * boxQuantity 
                            : category.setValue;

                        if (categoryQuotaValue !== requiredSetValue) {
                            validationErrors.push(
                                `You must have a total of ${requiredSetValue} ${category.name} points, but you have ${categoryQuotaValue}. ` +
                                `Please adjust items in this category to match exactly.`
                            );
                        }
                    }
                }
            }
        }

        if (validationErrors.length > 0) {
            console.log('[ClientPortalInterface] Save blocked by validation:', validationErrors);
            setMessage(`Error: ${validationErrors.join('; ')}`);
            setTimeout(() => setMessage(null), 8000);
            return;
        }

        try {
            // Ensure structure is correct and convert per-vendor delivery days to deliveryDayOrders format
            const cleanedOrderConfig = { ...orderConfig };


            if (serviceType === 'Food') {
                if (cleanedOrderConfig.deliveryDayOrders) {
                    // Clean multi-day format (already in deliveryDayOrders)
                    for (const day of Object.keys(cleanedOrderConfig.deliveryDayOrders)) {
                        cleanedOrderConfig.deliveryDayOrders[day].vendorSelections = (cleanedOrderConfig.deliveryDayOrders[day].vendorSelections || [])
                            .filter((s: any) => s.vendorId)
                            .map((s: any) => ({
                                vendorId: s.vendorId,
                                items: s.items || {}
                            }));
                    }

                    // Validate that after cleaning, we still have orders with items
                    const hasValidOrders = Object.values(cleanedOrderConfig.deliveryDayOrders).some((day: any) => {
                        if (!day.vendorSelections || day.vendorSelections.length === 0) return false;
                        return day.vendorSelections.some((s: any) => {
                            if (!s.vendorId) return false;
                            const items = s.items || {};
                            return Object.keys(items).length > 0 && Object.values(items).some((qty: any) => (Number(qty) || 0) > 0);
                        });
                    });

                    if (!hasValidOrders && !mealPlanOnlySave) {
                        setMessage('Error: After filtering, no valid orders remain. Please ensure at least one vendor has items selected.');
                        setTimeout(() => setMessage(null), 8000);
                        return;
                    }
                } else if (cleanedOrderConfig.vendorSelections) {
                    // Check if any vendor has per-vendor delivery days (itemsByDay)
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
                                    deliveryDayOrders[day] = { vendorSelections: [] };
                                }

                                // Add this vendor to this day with its items
                                deliveryDayOrders[day].vendorSelections.push({
                                    vendorId: selection.vendorId,
                                    items: selection.itemsByDay[day] || {}
                                });
                            }
                        }

                        cleanedOrderConfig.deliveryDayOrders = deliveryDayOrders;
                        cleanedOrderConfig.vendorSelections = undefined;
                    } else {
                        // Clean single-day format (normal items, not itemsByDay)
                        cleanedOrderConfig.vendorSelections = (cleanedOrderConfig.vendorSelections || [])
                            .filter((s: any) => s.vendorId)
                            .map((s: any) => ({
                                vendorId: s.vendorId,
                                items: s.items || {}
                            }));

                        // Validate that after cleaning, we still have vendors with items
                        const hasValidSelections = cleanedOrderConfig.vendorSelections.some((s: any) => {
                            if (!s.vendorId) return false;
                            const items = s.items || {};
                            return Object.keys(items).length > 0 && Object.values(items).some((qty: any) => (Number(qty) || 0) > 0);
                        });

                        if (!hasValidSelections && !mealPlanOnlySave) {
                            setMessage('Error: After filtering, no valid vendor selections remain. Please ensure at least one vendor has items selected.');
                            setTimeout(() => setMessage(null), 8000);
                            return;
                        }
                    }
                }
            } else if (serviceType === 'Boxes') {
                // Migrate to boxes format if needed
                const migratedConfig = migrateLegacyBoxOrder(orderConfig);
                
                // Save in new format (boxes array)
                if (migratedConfig.boxes && migratedConfig.boxes.length > 0) {
                    cleanedOrderConfig.boxes = migratedConfig.boxes;
                    // Also preserve vendorId from first box if available
                    cleanedOrderConfig.vendorId = migratedConfig.boxes[0]?.vendorId || orderConfig.vendorId;
                    cleanedOrderConfig.boxTypeId = migratedConfig.boxes[0]?.boxTypeId || orderConfig.boxTypeId;
                } else {
                    // Legacy format fallback
                    cleanedOrderConfig.vendorId = orderConfig.vendorId;
                    cleanedOrderConfig.boxTypeId = orderConfig.boxTypeId;
                    cleanedOrderConfig.boxQuantity = orderConfig.boxQuantity || 1;
                    cleanedOrderConfig.items = orderConfig.items || {};
                    cleanedOrderConfig.itemPrices = orderConfig.itemPrices || {};
                }
            } else if (serviceType === 'Custom') {
                // For Custom: Preserve vendorId and customItems
                cleanedOrderConfig.vendorId = orderConfig.vendorId;
                // Preserve customItems array, filtering out items with empty names
                cleanedOrderConfig.customItems = (orderConfig.customItems || [])
                    .filter((item: any) => item.name && item.name.trim() !== '')
                    .map((item: any) => ({
                        name: item.name || '',
                        price: parseFloat(item.price) || 0,
                        quantity: parseInt(item.quantity) || 1
                    }));
            }

            // Create a temporary client object for syncCurrentOrderToUpcoming
            const tempClient: ClientProfile = {
                ...client,
                activeOrder: {
                    ...cleanedOrderConfig,
                    serviceType: serviceType,
                    lastUpdated: new Date().toISOString(),
                    updatedBy: 'Client'
                }
            } as ClientProfile;

            setSaving(true);
            setMessage('Saving...');

            // Portal (orderAndMealPlanOnly): do not write to clients.upcoming_order; only day-based meal plan is saved below.
            // Admin or non-Food: persist to clients.upcoming_order when the recurring order was actually changed.
            if (configChanged && !orderAndMealPlanOnly) {
                // Debug logging
                console.log('[ClientPortalInterface] About to save order:', {
                    clientId: client.id,
                    serviceType: serviceType,
                    orderConfig: cleanedOrderConfig,
                    tempClientActiveOrder: tempClient.activeOrder
                });

                // For Food: only persist when order differs from default; otherwise clear so client follows default template
                let activeOrderToPersist: any = tempClient.activeOrder;
                if (serviceType === 'Food') {
                    const defaultFoodTemplate = await getCachedDefaultOrderTemplate('Food');
                    if (defaultFoodTemplate && (await isFoodOrderSameAsDefault(tempClient.activeOrder, defaultFoodTemplate))) {
                        activeOrderToPersist = null;
                    }
                }

                // Persist recurring order to client.upcoming_order (single source of truth)
                try {
                    await updateClient(client.id, {
                        activeOrder: activeOrderToPersist,
                        serviceType: client.serviceType
                    });
                    console.log('[ClientPortalInterface] updateClient (upcoming_order) completed successfully', activeOrderToPersist == null ? '(cleared; using default)' : '');
                } catch (updateError: any) {
                    console.error('[ClientPortalInterface] Error updating client upcoming_order:', updateError);
                    throw updateError;
                }

                // Food: save full activeOrder to clients.upcoming_order so structure is preserved (only when customized, not default)
                if (serviceType === 'Food' && activeOrderToPersist) {
                    const activeOrderAny = activeOrderToPersist as any;
                    const hasDeliveryDayOrders = activeOrderAny.deliveryDayOrders && typeof activeOrderAny.deliveryDayOrders === 'object' && Object.keys(activeOrderAny.deliveryDayOrders).length > 0;
                    try {
                        await saveClientFoodOrder(client.id, {
                            caseId: activeOrderAny.caseId ?? undefined,
                            ...(hasDeliveryDayOrders && { deliveryDayOrders: activeOrderAny.deliveryDayOrders })
                        }, activeOrderAny);
                    } catch (foodErr: any) {
                        console.error('[ClientPortalInterface] saveClientFoodOrder error (non-fatal):', foodErr);
                    }
                }

                // Boxes: persist box orders to client_box_orders
                if (serviceType === 'Boxes' && (tempClient.activeOrder as any)?.boxOrders?.length > 0) {
                    try {
                        const boxOrders = (tempClient.activeOrder as any).boxOrders;
                        await saveClientBoxOrder(client.id, boxOrders.map((box: any) => ({
                            ...box,
                            caseId: (tempClient.activeOrder as any).caseId
                        })));
                    } catch (boxErr: any) {
                        console.error('[ClientPortalInterface] saveClientBoxOrder error (non-fatal):', boxErr);
                    }
                }

                // Optional no-op sync (kept for any future implementation)
                await syncCurrentOrderToUpcoming(client.id, { ...client, activeOrder: activeOrderToPersist ?? undefined } as ClientProfile);

                // Update local client so UI shows saved state (no "Default template (not saved)")
                setClient({ ...client, activeOrder: activeOrderToPersist ?? undefined });

                // After saving, update originalOrderConfig to prevent re-saving
                const savedConfig = JSON.parse(JSON.stringify(orderConfig));
                setOriginalOrderConfig(savedConfig);

                lastSavedTimestampRef.current = new Date().toISOString();
            }

            // Only persist to clients.meal_planner_data for dates that were actually edited (merge-by-date; don't touch other days).
            // Each saved day is the full snapshot for that day: recurring + day-specific items combined.
            const didSaveMealPlan = mealPlanEditedDates.length > 0;
            console.log('[ClientPortalInterface] Reached save block: didSaveMealPlan=', didSaveMealPlan, 'mealPlanEditedDates.length=', mealPlanEditedDates.length);
            if (didSaveMealPlan) {
                console.log('[ClientPortalInterface] Saving meal plan: edited dates only', mealPlanEditedDates.slice(0, 10), mealPlanEditedDates.length > 10 ? `... (+${mealPlanEditedDates.length - 10} more)` : '');
                for (const date of mealPlanEditedDates) {
                    const order = mealPlanOrders.find((o: any) => (o.scheduledDeliveryDate || '').slice(0, 10) === date.slice(0, 10));
                    if (order?.items) {
                        console.log('[ClientPortalInterface] Saving date', date, 'items count=', order.items.length, 'sample=', order.items.slice(0, 3).map((i: any) => ({ name: i.name, qty: i.quantity })));
                        const { ok, error: mealErr } = await saveClientMealPlannerData(client.id, date, order.items);
                        if (ok) {
                            console.log('[ClientPortalInterface] Meal planner saved for', date);
                        } else if (mealErr) {
                            console.warn('[ClientPortalInterface] Meal planner save for date', date, mealErr);
                        }
                    } else {
                        console.warn('[ClientPortalInterface] No order or items for edited date', date, 'skipping');
                    }
                }
                setMealPlanEditedDates([]);
                setMealPlanEditedResetTrigger((t) => t + 1);
            }

            // Refresh the router to refetch server data when we saved something
            if (configChanged || didSaveMealPlan) {
                router.refresh();
            }

            setSaving(false);
            setMessage('Saved');
            setTimeout(() => setMessage(null), 2000);
        } catch (error: any) {
            console.error('Error saving Service Configuration:', error);
            setSaving(false);
            
            // Parse error message for user-friendly display
            const errorMessage = parseErrorMessage(error);
            setMessage(errorMessage);
            setTimeout(() => setMessage(null), 10000); // Increased timeout for better visibility
        }
    };

    const handleDiscard = () => {
        // Reset order config to original
        setOrderConfig(JSON.parse(JSON.stringify(originalOrderConfig)));
        // Reset meal plan to last saved (portal): parent state + tell SavedMealPlanMonth to reset internal orders
        if (orderAndMealPlanOnly) {
            setMealPlanEditedDates([]);
            setMealPlanOrders(Array.isArray(initialMealPlanOrders) ? [...initialMealPlanOrders] : []);
            setMealPlanDiscardTrigger((t) => t + 1);
        }
        setMessage('Changes discarded');
        setTimeout(() => setMessage(null), 2000);
    };

    // Helper function to parse error messages for user-friendly display
    function parseErrorMessage(error: any): string {
        const message = error?.message || '';
        const errorString = String(message).toLowerCase();
        
        // RLS and permission errors
        if (error?.code === 'PGRST301' || errorString.includes('permission denied') || errorString.includes('rls') || errorString.includes('row-level security')) {
            return 'Database permission error. Please contact support. If this persists, check that SUPABASE_SERVICE_ROLE_KEY is configured correctly.';
        }
        
        // Foreign key violations
        if (errorString.includes('foreign key') || errorString.includes('violates foreign key constraint')) {
            return 'Invalid reference detected. Please refresh the page and try again. If the problem persists, contact support.';
        }
        
        // NOT NULL constraint violations
        if (errorString.includes('not null') || errorString.includes('null value in column')) {
            return 'Missing required information. Please check that all required fields are filled.';
        }
        
        // Date-related errors
        if (errorString.includes('missing dates') || errorString.includes('delivery dates') || errorString.includes('cannot calculate')) {
            return message || 'Cannot calculate delivery dates. Please ensure vendor has delivery days configured.';
        }
        
        // Database connection errors
        if (errorString.includes('network') || errorString.includes('connection') || errorString.includes('fetch')) {
            return 'Network error. Please check your internet connection and try again.';
        }
        
        // Service type errors
        if (errorString.includes('service type') || errorString.includes('invalid service')) {
            return 'Invalid service type. Please refresh the page and try again.';
        }
        
        // Generic database errors
        if (errorString.includes('database') || errorString.includes('sql') || errorString.includes('constraint')) {
            return `Database error: ${message || 'An unexpected database error occurred. Please try again or contact support.'}`;
        }
        
        // Return original message if it exists and is meaningful
        if (message && message.length > 0 && message !== 'Error saving') {
            return message;
        }
        
        // Fallback
        return 'An unexpected error occurred while saving. Please try again. If the problem persists, contact support.';
    }

    // Auto-Save Profile Logic - DISABLED: Profile editing is not allowed in client portal
    // useEffect(() => {
    //     if (!client) return;

    //     const profileChanged =
    //         profileData.fullName !== originalProfileData.fullName ||
    //         profileData.email !== originalProfileData.email ||
    //         profileData.phoneNumber !== originalProfileData.phoneNumber ||
    //         profileData.secondaryPhoneNumber !== originalProfileData.secondaryPhoneNumber ||
    //         profileData.address !== originalProfileData.address;

    //     if (!profileChanged) return;

    //     const timeoutId = setTimeout(async () => {
    //         try {
    //             setSavingProfile(true);
    //             setProfileMessage('Saving...');

    //             await updateClient(client.id, {
    //                 fullName: profileData.fullName,
    //                 email: profileData.email || null,
    //                 phoneNumber: profileData.phoneNumber || '',
    //                 secondaryPhoneNumber: profileData.secondaryPhoneNumber || null,
    //                 address: profileData.address || ''
    //             });

    //             setOriginalProfileData({ ...profileData });
    //             setSavingProfile(false);
    //             setProfileMessage('Saved');
    //             setTimeout(() => setProfileMessage(null), 2000);
    //         } catch (error) {
    //             console.error('Error saving profile:', error);
    //             setSavingProfile(false);
    //             setProfileMessage('Error saving');
    //         }
    //     }, 1000);

    //     return () => clearTimeout(timeoutId);
    // }, [profileData, originalProfileData, client]);


    // -- LOGIC HELPERS --

    function getVendorMenuItems(vendorId: string) {
        return menuItems.filter(i => i.vendorId === vendorId && i.isActive);
    }

    /** All menu items for this vendor (so the full menu always shows; items with zero quantity stay visible). Only includes items that exist in the menu (no "Unknown item" rows). */
    function getItemsToDisplayForVendor(vendorId: string, _orderItemIds?: string[]): Array<{ id: string; name: string; value?: number; isOrderOnly?: boolean }> {
        const menu = getVendorMenuItems(vendorId).sort((a, b) => {
            const sortOrderA = a.sortOrder ?? 0;
            const sortOrderB = b.sortOrder ?? 0;
            if (sortOrderA !== sortOrderB) return sortOrderA - sortOrderB;
            return (a.name ?? '').localeCompare(b.name ?? '', undefined, { numeric: true, sensitivity: 'base' });
        });
        return menu.map((i) => ({
            id: i.id,
            name: i.name,
            value: i.quotaValue ?? i.value ?? 1,
            isOrderOnly: false as const
        }));
    }

    // Legacy handler - now works with boxes array
    function handleBoxItemChange(itemId: string, qty: number, boxNumber?: number) {
        // If using new boxes format
        if (orderConfig.boxes && orderConfig.boxes.length > 0) {
            const targetBoxNumber = boxNumber || 1; // Default to first box
            const updatedBoxes = orderConfig.boxes.map((box: BoxConfiguration) => {
                if (box.boxNumber !== targetBoxNumber) return box;
                
                const newItems = { ...box.items };
                if (qty > 0) {
                    newItems[itemId] = qty;
                } else {
                    delete newItems[itemId];
                }
                return { ...box, items: newItems };
            });
            
            setOrderConfig({ ...orderConfig, boxes: updatedBoxes });
        } else {
            // Legacy format
            const currentItems = { ...(orderConfig.items || {}) };
            if (qty > 0) {
                currentItems[itemId] = qty;
            } else {
                delete currentItems[itemId];
            }
            setOrderConfig({ ...orderConfig, items: currentItems });
        }
    }

    // New helper functions for multiple boxes
    function canAddMoreBoxes(): boolean {
        if (!client.authorizedAmount) return true; // No limit
        
        const currentBoxCount = getTotalBoxCount(orderConfig);
        const firstBox = orderConfig.boxes?.[0];
        const boxType = firstBox ? boxTypes.find(bt => bt.id === firstBox.boxTypeId) : null;
        if (!boxType?.priceEach) return true;
        
        const maxBoxes = getMaxBoxesAllowed(client.authorizedAmount, boxType.priceEach);
        return maxBoxes === null || currentBoxCount < maxBoxes;
    }

    function handleAddBox() {
        if (!canAddMoreBoxes()) return;
        
        // Ensure we're using boxes format
        let currentBoxes = orderConfig.boxes || [];
        
        // If no boxes yet, migrate from legacy or create first box
        if (currentBoxes.length === 0) {
            const migrated = migrateLegacyBoxOrder(orderConfig);
            currentBoxes = migrated.boxes || [];
            
            // If still no boxes, create first one
            if (currentBoxes.length === 0) {
                const defaultBoxTypeId = boxTypes.find(bt => bt.isActive)?.id || '';
                currentBoxes = [{
                    boxNumber: 1,
                    boxTypeId: defaultBoxTypeId,
                    items: {},
                    itemPrices: {}
                }];
            }
        }
        
        const nextBoxNumber = currentBoxes.length + 1;
        const defaultBoxTypeId = boxTypes.find(bt => bt.isActive)?.id || currentBoxes[0]?.boxTypeId || '';
        
        const newBox: BoxConfiguration = {
            boxNumber: nextBoxNumber,
            boxTypeId: defaultBoxTypeId,
            vendorId: currentBoxes[0]?.vendorId,
            items: {},
            itemPrices: {},
            itemNotes: {}
        };
        
        setOrderConfig({
            ...orderConfig,
            boxes: [...currentBoxes, newBox]
        });
    }

    function removeBox(boxNumber: number) {
        const currentBoxes = orderConfig.boxes || [];
        if (currentBoxes.length <= 1) return; // Can't remove last box
        
            const updatedBoxes = currentBoxes
                .filter((b: BoxConfiguration) => b.boxNumber !== boxNumber)
                .map((b: BoxConfiguration, index: number) => ({ ...b, boxNumber: index + 1 })); // Renumber
        
        setOrderConfig({
            ...orderConfig,
            boxes: updatedBoxes
        });
    }

    function updateBoxItem(boxNumber: number, itemId: string, delta: number) {
        // CRITICAL: Ensure boxes array exists before updating
        let currentBoxes = orderConfig.boxes || [];
        
        // If no boxes exist, create a default box
        if (currentBoxes.length === 0) {
            const defaultBox: BoxConfiguration = {
                boxNumber: 1,
                boxTypeId: boxTypes.find(bt => bt.isActive)?.id || '',
                items: {},
                itemPrices: {},
                itemNotes: {}
            };
            currentBoxes = [defaultBox];
        }
        
        const updatedBoxes = currentBoxes.map((box: BoxConfiguration) => {
            if (box.boxNumber !== boxNumber) return box;
            
            const currentQty = (box.items && box.items[itemId]) ? box.items[itemId] : 0;
            const newQty = Math.max(0, currentQty + delta);
            
            const newItems = { ...(box.items || {}) };
            const newItemNotes = { ...(box.itemNotes || {}) };
            
            if (newQty > 0) {
                newItems[itemId] = newQty;
                // Keep existing note if item still has quantity
            } else {
                delete newItems[itemId];
                delete newItemNotes[itemId]; // Remove note when quantity is 0
            }
            
            return { ...box, items: newItems, itemNotes: newItemNotes };
        });
        
        setOrderConfig({
            ...orderConfig,
            boxes: updatedBoxes
        });
    }

    function updateBoxType(boxNumber: number, boxTypeId: string) {
        const currentBoxes = orderConfig.boxes || [];
        const updatedBoxes = currentBoxes.map((box: BoxConfiguration) => {
            if (box.boxNumber !== boxNumber) return box;
            return { ...box, boxTypeId };
        });
        
        setOrderConfig({
            ...orderConfig,
            boxes: updatedBoxes
        });
    }

    function getVendorSelectionsForDay(day: string | null): any[] {
        if (!orderConfig.deliveryDayOrders) {
            return orderConfig.vendorSelections || [];
        }
        if (day && orderConfig.deliveryDayOrders[day]) {
            return orderConfig.deliveryDayOrders[day].vendorSelections || [];
        }
        // If getting all (null) but in multi-day format, we need to flatten/combine.
        // For simple iteration of *active* selections across all days:
        let allSelections: any[] = [];
        if (orderConfig.deliveryDayOrders) {
            Object.values(orderConfig.deliveryDayOrders).forEach((dayOrder: any) => {
                if (dayOrder.vendorSelections) {
                    allSelections = [...allSelections, ...dayOrder.vendorSelections];
                }
            });
        }
        return allSelections;
    }

    function getVendorMealCount(vendorId: string, selection: any): number {
        if (!selection) return 0;
        // Handle per-vendor delivery days (itemsByDay)
        if (selection.itemsByDay && selection.selectedDeliveryDays) {
            let total = 0;
            for (const deliveryDay of selection.selectedDeliveryDays) {
                const dayItems = selection.itemsByDay[deliveryDay] || {};
                total += Object.entries(dayItems).reduce((sum: number, [itemId, qty]) => {
                    const item = menuItems.find(i => i.id === itemId);
                    // Use item.value as the meal count multiplier
                    const multiplier = item ? item.value : 1;
                    return sum + ((Number(qty) || 0) * multiplier);
                }, 0);
            }
            return total;
        }
        // Normal items structure
        if (!selection.items) return 0;
        let total = 0;
        for (const [itemId, qty] of Object.entries(selection.items)) {
            const item = menuItems.find(i => i.id === itemId);
            // Use item.value as the meal count multiplier
            const multiplier = item ? item.value : 1;
            total += ((qty as number) || 0) * multiplier;
        }
        return total;
    }

    function getTotalMealCountAllDays(): number {
        // If editing in 'vendorSelections' mode (transient state before save)
        if (orderConfig.vendorSelections) {
            let total = 0;
            for (const selection of orderConfig.vendorSelections) {
                total += getVendorMealCount(selection.vendorId, selection);
            }
            return total;
        }
        // If in saved/multi-day format
        if (orderConfig.deliveryDayOrders) {
            let total = 0;
            for (const day of Object.keys(orderConfig.deliveryDayOrders)) {
                // simple summation of items in that day
                const daySelections = orderConfig.deliveryDayOrders[day].vendorSelections || [];
                for (const sel of daySelections) {
                    const items = sel.items || {};
                    total += Object.entries(items).reduce((sum: number, [itemId, qty]) => {
                        const item = menuItems.find(i => i.id === itemId);
                        // Use item.value as the meal count multiplier
                        const multiplier = item ? item.value : 1;
                        return sum + ((Number(qty) || 0) * multiplier);
                    }, 0);
                }
            }
            return total;
        }
        return 0;
    }

    function getCurrentOrderTotalValueAllDays(): number {
        // If editing in 'vendorSelections' mode
        if (orderConfig.vendorSelections) {
            let total = 0;
            for (const selection of orderConfig.vendorSelections) {
                // Calculate value
                if (selection.itemsByDay && selection.selectedDeliveryDays) {
                    for (const day of selection.selectedDeliveryDays) {
                        const dayItems = selection.itemsByDay[day] || {};
                        for (const [itemId, qty] of Object.entries(dayItems)) {
                            const item = menuItems.find(i => i.id === itemId);
                            const mealsPerItem = item != null && (item.value ?? 0) > 0 ? (item.value ?? 1) : 1;
                            total += mealsPerItem * (qty as number);
                        }
                    }
                } else if (selection.items) {
                    for (const [itemId, qty] of Object.entries(selection.items)) {
                        const item = menuItems.find(i => i.id === itemId);
                        const mealsPerItem = item != null && (item.value ?? 0) > 0 ? (item.value ?? 1) : 1;
                        total += mealsPerItem * (qty as number);
                    }
                }
            }
            return total;
        }
        // If in saved/multi-day format
        if (orderConfig.deliveryDayOrders) {
            let total = 0;
            for (const day of Object.keys(orderConfig.deliveryDayOrders)) {
                const daySelections = orderConfig.deliveryDayOrders[day].vendorSelections || [];
                for (const sel of daySelections) {
                    const items = sel.items || {};
                    for (const [itemId, qty] of Object.entries(items)) {
                        const item = menuItems.find(i => i.id === itemId);
                        const mealsPerItem = item != null && (item.value ?? 0) > 0 ? (item.value ?? 1) : 1;
                        total += mealsPerItem * (qty as number);
                    }
                }
            }
            return total;
        }
        return 0;
    }

    // -- RENDER HELPERS --

    const renderFoodOrderSection = () => {
        // Multi-day parsing logic for UI
        const isAlreadyMultiDay = orderConfig.deliveryDayOrders && typeof orderConfig.deliveryDayOrders === 'object';
        let currentSelections = orderConfig.vendorSelections || [];

        // When we have deliveryDayOrders, convert to per-vendor format so items show (DB often has empty vendorSelections + items in deliveryDayOrders)
        if (isAlreadyMultiDay) {
            const deliveryDays = Object.keys(orderConfig.deliveryDayOrders).sort();
            const vendorMap = new Map<string, any>();

            const vendorsByDay: { [day: string]: any[] } = {};
            for (const day of deliveryDays) {
                const daySelections = orderConfig.deliveryDayOrders[day].vendorSelections || [];
                for (const sel of daySelections) {
                    if (!sel.vendorId) continue;
                    if (!vendorsByDay[day]) vendorsByDay[day] = [];
                    vendorsByDay[day].push(sel);
                }
            }

            for (const day of deliveryDays) {
                for (const sel of vendorsByDay[day] || []) {
                    if (!vendorMap.has(sel.vendorId)) {
                        vendorMap.set(sel.vendorId, {
                            vendorId: sel.vendorId,
                            selectedDeliveryDays: [],
                            itemsByDay: {}
                        });
                    }
                    const vendorSel = vendorMap.get(sel.vendorId);
                    if (!vendorSel.selectedDeliveryDays.includes(day)) {
                        vendorSel.selectedDeliveryDays.push(day);
                    }
                    vendorSel.itemsByDay[day] = sel.items || {};
                }
            }
            if (Array.from(vendorMap.values()).length > 0) {
                currentSelections = Array.from(vendorMap.values());
            }
        }

        // Prefer vendorSelections only when they actually have items; otherwise use currentSelections (from deliveryDayOrders conversion).
        // DB often has vendorSelections: [{ items: {}, vendorId }] and real items in deliveryDayOrders.Wednesday etc. — show the latter.
        const hasItemsInVendorSelections = orderConfig.vendorSelections?.some((s: any) => s?.items && Object.keys(s.items || {}).length > 0) ?? false;
        const selectionsToRender = (orderConfig.vendorSelections && orderConfig.vendorSelections.length > 0 && hasItemsInVendorSelections)
            ? orderConfig.vendorSelections
            : currentSelections;

        // Day-specific meal plan item IDs (from bottom section): do not show them in the recurring order section.
        const mealPlanItemIds = new Set<string>();
        if (orderAndMealPlanOnly && initialMealPlanOrders && Array.isArray(initialMealPlanOrders)) {
            for (const order of initialMealPlanOrders) {
                for (const item of order.items ?? []) {
                    if (item?.id) mealPlanItemIds.add(String(item.id));
                }
            }
        }
        const recurringOnlyItemIds = (ids: string[]) =>
            mealPlanItemIds.size === 0 ? ids : ids.filter((id) => !mealPlanItemIds.has(id));

        // Only menu items that exist for this vendor are shown; order IDs not in the menu are omitted (no "Unknown item" rows).

        const totalMeals = getTotalMealCountAllDays();

        return (
            <div className={styles.vendorsList}>
                {/* Budget Header */}
                <div className={styles.orderHeader} style={{ marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h4>Recurring order (same every delivery)</h4>
                        <div style={{ display: 'flex', gap: '0.5rem', flexDirection: 'column', alignItems: 'flex-end' }}>
                            <div className={styles.budget} style={{
                                color: getTotalMealCountAllDays() !== (client.approvedMealsPerWeek || 0) ? 'white' : 'inherit',
                                backgroundColor: getTotalMealCountAllDays() !== (client.approvedMealsPerWeek || 0) ? 'var(--color-danger)' : 'var(--bg-surface-hover)',
                                padding: '8px 12px',
                                borderRadius: '6px',
                                fontSize: '1rem',
                                fontWeight: 700,
                                border: getTotalMealCountAllDays() !== (client.approvedMealsPerWeek || 0) ? '2px solid #991b1b' : 'none',
                                boxShadow: getTotalMealCountAllDays() !== (client.approvedMealsPerWeek || 0) ? '0 2px 5px rgba(220, 38, 38, 0.3)' : 'none'
                            }}>
                                Meals: {getTotalMealCountAllDays()} / {client.approvedMealsPerWeek || 0}
                                {getTotalMealCountAllDays() !== (client.approvedMealsPerWeek || 0) && (
                                    <span style={{ marginLeft: '8px' }}>
                                        {getTotalMealCountAllDays() > (client.approvedMealsPerWeek || 0) ? '(OVER LIMIT)' : '(UNDER LIMIT)'}
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                    {getTotalMealCountAllDays() !== (client.approvedMealsPerWeek || 0) && (
                        <div style={{
                            padding: '12px',
                            backgroundColor: '#fee2e2',
                            border: '1px solid #ef4444',
                            borderRadius: '6px',
                            color: '#b91c1c',
                            fontWeight: 600,
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            marginTop: '8px',
                            width: '100%'
                        }}>
                            <AlertTriangle size={24} />
                            <span>
                                {getTotalMealCountAllDays() > (client.approvedMealsPerWeek || 0) 
                                    ? `You have exceeded your meal allowance of ${client.approvedMealsPerWeek || 0} meals. Please remove some items to exactly match the limit.`
                                    : `Your order must exactly match your meal allowance of ${client.approvedMealsPerWeek || 0} meals. Please add more items to match the limit.`
                                }
                            </span>
                        </div>
                    )}
                </div>

                {selectionsToRender.map((selection: any, index: number) => {
                    const vendor = selection.vendorId ? vendors.find(v => v.id === selection.vendorId) : null;
                    const vendorHasMultipleDays = vendor && vendor.deliveryDays && vendor.deliveryDays.length > 1;
                    const vendorDeliveryDays = vendor?.deliveryDays || [];
                    const vendorSelectedDays = (selection.selectedDeliveryDays || []) as string[];
                    const vendorMinimum = vendor?.minimumMeals || 0;

                    return (
                        <div key={index} className={styles.vendorBlock}>
                            <div className={styles.vendorHeader}>
                                {singleVendorMode ? (
                                    <span className={styles.sectionTitle} style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>
                                        {vendor?.name ?? singleVendor?.name ?? 'Vendor'}
                                    </span>
                                ) : (
                                    <>
                                        <select
                                            className="input"
                                            value={selection.vendorId}
                                            onChange={e => {
                                                const newSelections = [...selectionsToRender];
                                                newSelections[index] = { ...newSelections[index], vendorId: e.target.value, items: {}, itemsByDay: {}, selectedDeliveryDays: [] };
                                                setOrderConfig({ ...orderConfig, vendorSelections: newSelections, deliveryDayOrders: undefined });
                                            }}
                                        >
                                            <option value="">Select Vendor...</option>
                                            {vendors.filter((v: any) => {
                                                const types = (v.serviceTypes || []) as string[];
                                                const hasFood = types.some((t: string) => String(t).toLowerCase() === 'food');
                                                return hasFood && (v as any).isActive !== false;
                                            }).map((v: Vendor) => (
                                                <option key={v.id} value={v.id} disabled={selectionsToRender.some((s: any, i: number) => i !== index && s.vendorId === v.id)}>
                                                    {v.name}
                                                </option>
                                            ))}
                                        </select>
                                        <button className={`${styles.iconBtn} ${styles.danger}`} onClick={() => {
                                            const newSelections = [...selectionsToRender];
                                            newSelections.splice(index, 1);
                                            setOrderConfig({ ...orderConfig, vendorSelections: newSelections, deliveryDayOrders: undefined });
                                        }} title="Remove Vendor">
                                            <Trash2 size={16} />
                                        </button>
                                    </>
                                )}
                            </div>

                            {/* Delivery Day Selection */}
                            {selection.vendorId && vendorHasMultipleDays && (
                                <div style={{ marginBottom: '1rem', padding: '0.75rem', backgroundColor: 'var(--bg-surface-hover)', borderRadius: 'var(--radius-sm)' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem', fontSize: '0.9rem', fontWeight: 500 }}>
                                        <Calendar size={16} />
                                        <span>Select delivery days for {vendor?.name}:</span>
                                    </div>
                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
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

                                                        const updated = [...selectionsToRender];
                                                        updated[index] = {
                                                            ...updated[index],
                                                            selectedDeliveryDays: newSelected,
                                                            itemsByDay: (() => {
                                                                const itemsByDay = { ...(updated[index].itemsByDay || {}) };
                                                                if (!isSelected) { itemsByDay[day] = {}; } // Adding
                                                                else { delete itemsByDay[day]; } // Removing
                                                                return itemsByDay;
                                                            })()
                                                        };
                                                        setOrderConfig({ ...orderConfig, vendorSelections: updated, deliveryDayOrders: undefined });
                                                    }}
                                                    style={{
                                                        padding: '0.5rem 1rem',
                                                        borderRadius: 'var(--radius-sm)',
                                                        border: `2px solid ${isSelected ? 'var(--color-primary)' : 'var(--border-color)'}`,
                                                        backgroundColor: isSelected ? 'var(--color-primary)' : 'var(--bg-app)',
                                                        color: isSelected ? 'white' : 'var(--text-primary)',
                                                        cursor: 'pointer',
                                                        fontSize: '0.85rem',
                                                        fontWeight: isSelected ? 600 : 400
                                                    }}
                                                >
                                                    {day}
                                                    {isSelected && <Check size={14} style={{ marginLeft: '0.25rem', display: 'inline' }} />}
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Item Inputs */}
                            {selection.vendorId && (() => {
                                // If multiple days
                                if (vendorHasMultipleDays && vendorSelectedDays.length > 0) {
                                    return vendorSelectedDays.map((day: string) => {
                                        const dayItems = (selection.itemsByDay || {})[day] || {};

                                        const dayMealCount = Object.entries(dayItems).reduce((sum: number, [itemId, qty]) => {
                                            const item = menuItems.find(i => i.id === itemId);
                                            const val = item?.value || 1;
                                            return sum + ((Number(qty) || 0) * val);
                                        }, 0);
                                        const meetsMinimum = vendorMinimum === 0 || dayMealCount >= vendorMinimum;

                                        return (
                                            <div key={day} style={{ marginBottom: '1.5rem', padding: '1rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', background: meetsMinimum ? 'transparent' : 'rgba(239, 68, 68, 0.05)' }}>
                                                <div style={{ marginBottom: '0.75rem', paddingBottom: '0.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                        <Calendar size={16} />
                                                        <strong>{day}</strong>
                                                    </div>
                                                    {vendorMinimum > 0 && (
                                                        <div style={{ fontSize: '0.85rem', color: meetsMinimum ? 'var(--text-primary)' : 'var(--color-danger)', fontWeight: 500 }}>
                                                            Meals: {dayMealCount} / {vendorMinimum} min
                                                        </div>
                                                    )}
                                                </div>

                                                {vendorMinimum > 0 && !meetsMinimum && (
                                                    <div style={{ marginBottom: '0.75rem', padding: '0.5rem', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-danger)', backgroundColor: 'rgba(239, 68, 68, 0.1)', fontSize: '0.8rem', color: 'var(--color-danger)', display: 'flex', alignItems: 'center' }}>
                                                        <AlertTriangle size={14} style={{ marginRight: '8px' }} />
                                                        Minimum {vendorMinimum} meals required for {day}
                                                    </div>
                                                )}

                                                <div className={styles.menuItemsGrid} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
                                                    {getItemsToDisplayForVendor(selection.vendorId, recurringOnlyItemIds(Object.keys(dayItems))).map(item => {
                                                        const qty = Number(dayItems[item.id] || 0);
                                                        const val = item.value ?? 1;
                                                        const canAdd = !item.isOrderOnly && (totalMeals + val) <= (client.approvedMealsPerWeek || 0);

                                                        return (
                                                            <div key={item.id} className={styles.menuItemCard} style={{ padding: '0.75rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', background: item.isOrderOnly ? 'var(--bg-surface-hover)' : 'var(--bg-surface)' }}>
                                                                <div style={{ marginBottom: '8px', fontSize: '0.9rem', fontWeight: 500 }}>
                                                                    {item.name}
                                                                    {val !== 1 && (
                                                                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginLeft: '4px' }}>
                                                                            ({val} meals)
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <div className={styles.quantityControl} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                    <button onClick={() => {
                                                                        const updated = [...selectionsToRender];
                                                                        const itemsByDay = { ...(updated[index].itemsByDay || {}) };
                                                                        if (!itemsByDay[day]) itemsByDay[day] = {};
                                                                        const newQty = Math.max(0, qty - 1);
                                                                        if (newQty > 0) itemsByDay[day][item.id] = newQty;
                                                                        else delete itemsByDay[day][item.id];
                                                                        updated[index] = { ...updated[index], itemsByDay };
                                                                        setOrderConfig({ ...orderConfig, vendorSelections: updated, deliveryDayOrders: undefined });
                                                                    }} className="btn btn-secondary" style={{ padding: '2px 8px' }}>-</button>
                                                                    <span style={{ width: '20px', textAlign: 'center' }}>{qty}</span>
                                                                    {!item.isOrderOnly && (
                                                                        <button
                                                                            title={!canAdd ? "Adding this item would exceed your weekly meal allowance" : "Add item"}
                                                                            onClick={() => {
                                                                                if (!canAdd) {
                                                                                    alert("Adding this item would exceed your weekly meal allowance");
                                                                                    return;
                                                                                }
                                                                                const updated = [...selectionsToRender];
                                                                                const itemsByDay = { ...(updated[index].itemsByDay || {}) };
                                                                                if (!itemsByDay[day]) itemsByDay[day] = {};
                                                                                const items = itemsByDay[day];
                                                                                items[item.id] = qty + 1;
                                                                                updated[index] = { ...updated[index], itemsByDay };
                                                                                setOrderConfig({ ...orderConfig, vendorSelections: updated, deliveryDayOrders: undefined });
                                                                            }}
                                                                            className="btn btn-secondary"
                                                                            style={{
                                                                                padding: '2px 8px',
                                                                                opacity: canAdd ? 1 : 0.5,
                                                                                cursor: canAdd ? 'pointer' : 'not-allowed'
                                                                            }}
                                                                        >+</button>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )
                                    });
                                } else if (!vendorHasMultipleDays) {
                                    // Single Day / Standard — show menu items + any order item IDs not in menu (full order data)
                                    const singleDayItems = selection.items || {};
                                    return (
                                        <div className={styles.menuItemsGrid} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
                                            {getItemsToDisplayForVendor(selection.vendorId, recurringOnlyItemIds(Object.keys(singleDayItems))).map(item => {
                                                const qty = Number(singleDayItems[item.id] || 0);
                                                const val = item.value ?? 1;
                                                const canAdd = !item.isOrderOnly && (totalMeals + val) <= (client.approvedMealsPerWeek || 0);

                                                return (
                                                    <div key={item.id} className={styles.menuItemCard} style={{ padding: '0.75rem', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-sm)', background: item.isOrderOnly ? 'var(--bg-surface-hover)' : 'var(--bg-surface)' }}>
                                                        <div style={{ marginBottom: '8px', fontSize: '0.9rem', fontWeight: 500 }}>
                                                            {item.name}
                                                            {val !== 1 && (
                                                                <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginLeft: '4px' }}>
                                                                    ({val} meals)
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div className={styles.quantityControl} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                            <button onClick={() => {
                                                                const updated = [...selectionsToRender];
                                                                const items = { ...(updated[index].items || {}) };
                                                                const newQty = Math.max(0, qty - 1);
                                                                if (newQty > 0) items[item.id] = newQty;
                                                                else delete items[item.id];
                                                                updated[index] = { ...updated[index], items };
                                                                setOrderConfig({ ...orderConfig, vendorSelections: updated, deliveryDayOrders: undefined });
                                                            }} className="btn btn-secondary" style={{ padding: '2px 8px' }}>-</button>
                                                            <span style={{ width: '20px', textAlign: 'center' }}>{qty}</span>
                                                            {!item.isOrderOnly && (
                                                                <button
                                                                    title={!canAdd ? "Adding this item would exceed your weekly meal allowance" : "Add item"}
                                                                    onClick={() => {
                                                                        if (!canAdd) {
                                                                            alert("Adding this item would exceed your weekly meal allowance");
                                                                            return;
                                                                        }
                                                                        const updated = [...selectionsToRender];
                                                                        const items = { ...(updated[index].items || {}) };
                                                                        items[item.id] = qty + 1;
                                                                        updated[index] = { ...updated[index], items };
                                                                        setOrderConfig({ ...orderConfig, vendorSelections: updated, deliveryDayOrders: undefined });
                                                                    }}
                                                                    className="btn btn-secondary"
                                                                    style={{
                                                                        padding: '2px 8px',
                                                                        opacity: canAdd ? 1 : 0.5,
                                                                        cursor: canAdd ? 'pointer' : 'not-allowed'
                                                                    }}
                                                                >+</button>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    );
                                }
                            })()}
                        </div>
                    );
                })}

                {!singleVendorMode && (
                    <button className={styles.addVendorBtn} onClick={() => {
                        const newSelections = [...selectionsToRender, { vendorId: '', items: {} }];
                        setOrderConfig({ ...orderConfig, vendorSelections: newSelections, deliveryDayOrders: undefined });
                    }}>
                        <Plus size={16} /> Add Vendor
                    </button>
                )}
            </div>
        );
    };

    const configChanged = JSON.stringify(orderConfig) !== JSON.stringify(originalOrderConfig);
    const hasUnsavedChanges = configChanged || mealPlanEditedDates.length > 0;

    // Edited days whose total !== expected (only check dates the user edited, not defaults). Used for mismatch bar message and to block save.
    const mealPlanMismatchedEditedDates = orderAndMealPlanOnly && client.serviceType === 'Food' && mealPlanEditedDates.length > 0
        ? (() => {
            const householdSize = Math.max(1, householdPeople?.length ?? 1);
            const editedSet = new Set(mealPlanEditedDates.map((d) => String(d).slice(0, 10)));
            const mismatched: string[] = [];
            for (const order of mealPlanOrders) {
                const dateKey = (order.scheduledDeliveryDate ?? '').slice(0, 10);
                if (!editedSet.has(dateKey)) continue;
                const expectedForDay = (order.expectedTotalMeals ?? 0) * householdSize;
                if (expectedForDay <= 0) continue;
                const currentForDay = (order.items ?? []).reduce((s: number, i: { value?: number | null; quantity?: number }) => s + ((i.value ?? 1) * Math.max(0, Number(i.quantity) ?? 0)), 0);
                if (currentForDay !== expectedForDay) mismatched.push(dateKey);
            }
            return mismatched;
        })()
        : [];
    const mealPlanMismatch = mealPlanMismatchedEditedDates.length > 0;

    // Format ISO date for display in mismatch message (e.g. "Mar 9 (Mon)")
    const formatDateForMismatch = (iso: string) => {
        const d = new Date(iso.trim().slice(0, 10) + 'T12:00:00');
        if (Number.isNaN(d.getTime())) return iso;
        const month = d.toLocaleDateString('en-US', { month: 'short' });
        const day = d.toLocaleDateString('en-US', { day: 'numeric' });
        const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
        return `${month} ${day} (${weekday})`;
    };

    const mainContent = (
            <div className={styles.wideGrid}>
                {!orderAndMealPlanOnly && (
                /* Access Profile - Read Only */
                <div className={styles.card}>
                    <div className={styles.sectionTitle} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <User size={20} />
                            Profile Information
                        </div>
                    </div>
                    <div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '16px' }}>
                            <div>
                                <label className="label">Full Name</label>
                                <input
                                    type="text"
                                    className="input"
                                    value={profileData.fullName}
                                    disabled
                                    readOnly
                                    style={{ background: 'var(--bg-app)', opacity: 0.8, cursor: 'not-allowed' }}
                                />
                            </div>
                            <div>
                                <label className="label">Email Address</label>
                                <input
                                    type="email"
                                    className="input"
                                    value={profileData.email}
                                    disabled
                                    readOnly
                                    style={{ background: 'var(--bg-app)', opacity: 0.8, cursor: 'not-allowed' }}
                                />
                            </div>
                            <div>
                                <label className="label">Phone Number</label>
                                <input
                                    type="tel"
                                    className="input"
                                    value={profileData.phoneNumber}
                                    disabled
                                    readOnly
                                    style={{ background: 'var(--bg-app)', opacity: 0.8, cursor: 'not-allowed' }}
                                />
                            </div>
                        </div>
                        <div className={styles.formGridSplit}>
                            <div>
                                <label className="label">Secondary Phone Number</label>
                                <input
                                    type="tel"
                                    className="input"
                                    value={profileData.secondaryPhoneNumber}
                                    disabled
                                    readOnly
                                    style={{ background: 'var(--bg-app)', opacity: 0.8, cursor: 'not-allowed' }}
                                />
                            </div>
                            <div>
                                <label className="label">Delivery Address</label>
                                <textarea
                                    className="input"
                                    rows={1}
                                    value={profileData.address}
                                    disabled
                                    readOnly
                                    style={{ resize: 'vertical', minHeight: '42px', background: 'var(--bg-app)', opacity: 0.8, cursor: 'not-allowed' }}
                                />
                            </div>
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
                        <div>
                            <label className="label">Service Type</label>
                            <div className="input" style={{ background: 'var(--bg-app)', opacity: 0.8 }}>{client.serviceType}</div>
                        </div>
                        <div>
                            <label className="label">Approved Amount</label>
                            <div className="input" style={{ background: 'var(--bg-app)', opacity: 0.8 }}>
                                {client.serviceType === 'Food'
                                    ? `${client.approvedMealsPerWeek || 0} meals / week`
                                    : 'Standard Box Allocation'
                                }
                            </div>
                        </div>
                    </div>
                </div>
                )}

                {/* Current Order Request - Editable (hidden in portal for Food; portal shows only day-based meal plan) */}
                {!(orderAndMealPlanOnly && client.serviceType === 'Food') && (
                <div className={styles.card} style={{ marginTop: orderAndMealPlanOnly ? 0 : '6rem' }}>
                    <div className={styles.sectionTitle} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <span>Current Order Request</span>
                            {saving && <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: '4px' }}><Loader2 className="animate-spin" size={14} /> Saving...</span>}
                            {message && !saving && <span style={{ fontSize: '0.8rem', color: 'var(--color-success)' }}>{message}</span>}
                        </div>
                    </div>

                    <div className={styles.alert} style={{ marginBottom: '1rem' }}>
                        <Info size={16} />
                        <div>
                            <div>Update your order preferences below.</div>
                            {(() => {
                                if (client.serviceType === 'Boxes') {
                                    return (
                                        <div style={{ marginTop: '0.5rem', fontSize: '0.9rem', fontWeight: 500 }}>
                                            Your changes may not take effect until next week.
                                        </div>
                                    );
                                }

                                if (client.serviceType === 'Food') {
                                    const uniqueVendorIds = new Set<string>();

                                    // Collect vendors from either format
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
                                            const name = v.name?.trim() ?? '';
                                            const isDietFantasy = name.length > 0 && /^diet\s*fantasy$/i.test(name);
                                            if (isDietFantasy) {
                                                return;
                                            }
                                            const cutoff = v.cutoffHours || 0; // Default to 0 if not set, or maybe don't show? 
                                            // User said "write by each vendor that changes must be made by however many hours".
                                            // If cutoff is 0, arguably "Changes take effect immediately" or just show 0 hours?
                                            // Let's show it if it exists or even if 0 to be explicit.
                                            messages.push(`Orders for ${v.name} must be placed ${cutoff} hours before delivery.`);
                                        }
                                    });

                                    if (messages.length > 0) {
                                        return (
                                            <div style={{ marginTop: '0.5rem', fontSize: '0.9rem', fontWeight: 500 }}>
                                                {messages.map((msg, i) => (
                                                    <div key={i}>{msg}</div>
                                                ))}
                                            </div>
                                        );
                                    }
                                }

                                return null;
                            })()}
                        </div>
                    </div>

                    {client.serviceType === 'Food' && (
                        renderFoodOrderSection()
                    )}

                    {client.serviceType === 'Boxes' && (() => {
                        // Ensure we're using boxes format
                        const migratedConfig = migrateLegacyBoxOrder(orderConfig);
                        const boxes = migratedConfig.boxes || [];
                        
                        // Check if there are any box items (items without vendorId)
                        const hasBoxItems = menuItems.some(i =>
                            (i.vendorId === null || i.vendorId === '') &&
                            i.isActive
                        );

                        if (!hasBoxItems) {
                            return (
                                <div style={{ marginTop: '1rem', padding: '1rem', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '6px', border: '1px solid var(--color-danger)' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', color: 'var(--color-danger)', fontWeight: 600 }}>
                                        <AlertTriangle size={16} />
                                        No box items found
                                    </div>
                                    <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                                        There are no box items (menu items without a vendor) configured. Please contact support.
                                    </div>
                                </div>
                            );
                        }

                        // Ensure at least one box exists for display
                        // Note: The useEffect above ensures orderConfig.boxes has at least one box
                        const displayBoxes = boxes.length > 0 ? boxes : [{
                            boxNumber: 1,
                            boxTypeId: boxTypes.find(bt => bt.isActive)?.id || '',
                            items: {},
                            itemPrices: {},
                            itemNotes: {}
                        }];

                        const currentBoxCount = displayBoxes.length;
                        const firstBoxType = displayBoxes[0] ? boxTypes.find(bt => bt.id === displayBoxes[0].boxTypeId) : null;
                        const maxBoxesAllowed = getMaxBoxesAllowed(client.authorizedAmount, firstBoxType?.priceEach);

                        return (
                            <div style={{ marginTop: '1rem' }}>

                                {/* Max Boxes Authorized - Editable Input Field */}
                                <div className={styles.formGroup} style={{ marginBottom: '1rem' }}>
                                    <label className="label">Max Boxes Authorized</label>
                                    <input
                                        type="number"
                                        className="input"
                                        value={client.authorizedAmount || ''}
                                        onChange={async (e) => {
                                            const newValue = parseFloat(e.target.value) || 0;
                                            try {
                                                await updateClient(client.id, { authorizedAmount: newValue });
                                                setClient({ ...client, authorizedAmount: newValue });
                                            } catch (err) {
                                                console.error('Error updating authorized amount:', err);
                                            }
                                        }}
                                        min="0"
                                        step="1"
                                        style={{
                                            border: '2px solid #fbbf24',
                                            fontWeight: 500
                                        }}
                                    />
                                </div>

                                {/* Boxes List */}
                                {displayBoxes.map((box: BoxConfiguration) => {
                                    const boxType = boxTypes.find(bt => bt.id === box.boxTypeId);
                                    const boxQuotas = boxType ? activeBoxQuotas.filter(q => q.boxTypeId === box.boxTypeId) : [];

                                    return (
                                        <div key={box.boxNumber} style={{
                                            marginBottom: '1.5rem',
                                            padding: '1rem',
                                            background: 'var(--bg-app)',
                                            borderRadius: '8px',
                                            border: '2px solid var(--border-color)',
                                            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                                        }}>
                                            <div style={{
                                                display: 'flex',
                                                justifyContent: 'space-between',
                                                alignItems: 'center',
                                                marginBottom: '1rem',
                                                paddingBottom: '0.75rem',
                                                borderBottom: '1px solid var(--border-color)'
                                            }}>
                                                <h4 style={{
                                                    fontSize: '1rem',
                                                    fontWeight: 600,
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '0.5rem'
                                                }}>
                                                    <Package size={18} />
                                                    Box #{box.boxNumber}
                                                </h4>
                                                {displayBoxes.length > 1 && (
                                                    <button
                                                        onClick={() => removeBox(box.boxNumber)}
                                                        className="btn btn-secondary"
                                                        style={{
                                                            padding: '0.5rem',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '0.25rem'
                                                        }}
                                                        title="Remove this box"
                                                    >
                                                        <Trash2 size={14} />
                                                        Remove
                                                    </button>
                                                )}
                                            </div>

                                            {/* Vendor Selection */}
                                            <div className={styles.formGroup} style={{ marginBottom: '1rem' }}>
                                                <label className="label">Vendor</label>
                                                <select
                                                    className="input"
                                                    value={box.vendorId || orderConfig.vendorId || ''}
                                                    onChange={(e) => {
                                                        const newVendorId = e.target.value;
                                                        // Auto-select first active box type when vendor is selected
                                                        const firstActiveBoxType = boxTypes.find(bt => bt.isActive);
                                                        const updatedBoxes = orderConfig.boxes?.map((b: BoxConfiguration) => 
                                                            b.boxNumber === box.boxNumber 
                                                                ? { 
                                                                    ...b, 
                                                                    vendorId: newVendorId,
                                                                    boxTypeId: b.boxTypeId || firstActiveBoxType?.id || ''
                                                                }
                                                                : b
                                                        ) || [];
                                                        setOrderConfig({
                                                            ...orderConfig,
                                                            boxes: updatedBoxes,
                                                            vendorId: newVendorId,
                                                            boxTypeId: orderConfig.boxTypeId || firstActiveBoxType?.id || ''
                                                        });
                                                    }}
                                                >
                                                    <option value="">Select Vendor...</option>
                                                    {vendors.filter(v => v.serviceTypes.includes('Boxes') && v.isActive).map(v => (
                                                        <option key={v.id} value={v.id}>{v.name}</option>
                                                    ))}
                                                </select>
                                            </div>

                                            {/* Take Effect Date */}
                                            {(box.vendorId || orderConfig.vendorId) && (() => {
                                                const vendorId = box.vendorId || orderConfig.vendorId;
                                                const vendor = vendors.find(v => v.id === vendorId);
                                                if (!vendor || !vendor.deliveryDays || vendor.deliveryDays.length === 0) {
                                                    return null;
                                                }
                                                // Calculate take effect date (simplified - would need settings)
                                                const takeEffectDate = new Date();
                                                takeEffectDate.setDate(takeEffectDate.getDate() + (7 - takeEffectDate.getDay()));
                                                return (
                                                    <div style={{
                                                        marginBottom: '1rem',
                                                        padding: '0.75rem',
                                                        backgroundColor: 'var(--bg-surface-hover)',
                                                        borderRadius: 'var(--radius-sm)',
                                                        border: '1px solid var(--border-color)',
                                                        fontSize: '0.85rem',
                                                        textAlign: 'center'
                                                    }}>
                                                        <strong>Take Effect Date:</strong> {takeEffectDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })} (always a Sunday)
                                                    </div>
                                                );
                                            })()}

                                            {/* Box Contents - Show all categories with items */}
                                            <div style={{ marginTop: '1rem', borderTop: '1px solid var(--border-color)', paddingTop: '1rem' }}>
                                                <h4 style={{ fontSize: '0.9rem', marginBottom: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                    <Package size={14} /> Box Contents
                                                </h4>

                                                {/* Show all categories with box items */}
                                                {[...categories]
                                                    .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))
                                                    .map(category => {
                                                        const availableItems = menuItems
                                                            .filter(i =>
                                                                (i.vendorId === null || i.vendorId === '') &&
                                                                i.isActive &&
                                                                i.categoryId === category.id
                                                            )
                                                            .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

                                                        if (availableItems.length === 0) return null;

                                                        const selectedItems = box.items || {};
                                                        const boxQty = 1; // Per-box quota calculation
                                                        
                                                        // Calculate quota for this box's category
                                                        let categoryQuotaValue = 0;
                                                        Object.entries(selectedItems).forEach(([itemId, qty]) => {
                                                            const item = menuItems.find(i => i.id === itemId);
                                                            if (item && item.categoryId === category.id) {
                                                                const itemQuotaValue = item.quotaValue || 1;
                                                                categoryQuotaValue += (qty as number) * itemQuotaValue;
                                                            }
                                                        });

                                                        const quota = boxType ? boxQuotas.find(q => q.categoryId === category.id) : null;
                                                        const requiredQuotaValueFromBox = quota ? quota.targetValue * boxQty : null;
                                                        const requiredQuotaValueFromCategory = category.setValue !== undefined && category.setValue !== null ? category.setValue : null;
                                                        const requiredQuotaValue = requiredQuotaValueFromCategory !== null ? requiredQuotaValueFromCategory : requiredQuotaValueFromBox;
                                                        const meetsQuota = requiredQuotaValue !== null ? categoryQuotaValue === requiredQuotaValue : true;

                                                        return (
                                                            <div key={category.id} style={{
                                                                marginBottom: '1rem',
                                                                background: 'var(--bg-surface-hover)',
                                                                padding: '0.75rem',
                                                                borderRadius: '6px',
                                                                border: requiredQuotaValue !== null && !meetsQuota ? '2px solid var(--color-danger)' : '1px solid var(--border-color)'
                                                            }}>
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem', fontSize: '0.85rem' }}>
                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                                        <span style={{ fontWeight: 600 }}>{category.name}</span>
                                                                        {requiredQuotaValueFromCategory !== null && (
                                                                            <span style={{
                                                                                fontSize: '0.7rem',
                                                                                color: 'var(--color-primary)',
                                                                                background: 'var(--bg-app)',
                                                                                padding: '2px 6px',
                                                                                borderRadius: '4px',
                                                                                fontWeight: 500
                                                                            }}>
                                                                                Set Value: {requiredQuotaValueFromCategory}
                                                                            </span>
                                                                        )}
                                                                    </div>
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
                                                                    </div>
                                                                </div>
                                                                {requiredQuotaValue !== null && !meetsQuota && (
                                                                    <div style={{
                                                                        marginBottom: '0.5rem',
                                                                        padding: '0.5rem',
                                                                        backgroundColor: 'rgba(239, 68, 68, 0.1)',
                                                                        borderRadius: '4px',
                                                                        fontSize: '0.75rem',
                                                                        color: 'var(--color-danger)',
                                                                        display: 'flex',
                                                                        alignItems: 'center',
                                                                        gap: '0.25rem'
                                                                    }}>
                                                                        <AlertTriangle size={12} />
                                                                        <span>You must have a total of {requiredQuotaValue} {category.name} points</span>
                                                                    </div>
                                                                )}

                                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                                                    {availableItems.map(item => {
                                                                        const qty = Number(selectedItems[item.id] || 0);
                                                                        const itemVal = item.quotaValue || 1;
                                                                        const canAdd = requiredQuotaValue === null || (categoryQuotaValue + itemVal <= requiredQuotaValue);
                                                                        const itemNote = box.itemNotes?.[item.id] || '';

                                                                        return (
                                                                            <div key={item.id} style={{
                                                                                padding: '0.75rem',
                                                                                background: qty > 0 ? 'rgba(251, 191, 36, 0.1)' : 'var(--bg-app)',
                                                                                border: qty > 0 ? '2px solid #fbbf24' : '1px solid var(--border-color)',
                                                                                borderRadius: '6px'
                                                                            }}>
                                                                                <div style={{
                                                                                    display: 'flex',
                                                                                    alignItems: 'center',
                                                                                    justifyContent: 'space-between',
                                                                                    marginBottom: qty > 0 ? '0.5rem' : '0'
                                                                                }}>
                                                                                    <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>
                                                                                        {item.name}
                                                                                        {(item.quotaValue || 1) > 1 && (
                                                                                            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginLeft: '4px' }}>
                                                                                                (Counts as {item.quotaValue || 1} meals)
                                                                                            </span>
                                                                                        )}
                                                                                    </span>
                                                                                    <div className={styles.quantityControl} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                                        <button
                                                                                            onClick={() => updateBoxItem(box.boxNumber, item.id, -1)}
                                                                                            className="btn btn-secondary"
                                                                                            style={{ padding: '2px 8px' }}
                                                                                        >-</button>
                                                                                        <span style={{ width: '30px', textAlign: 'center', fontWeight: 500 }}>{qty}</span>
                                                                                        <button
                                                                                            onClick={() => {
                                                                                                if (!canAdd) {
                                                                                                    alert("Adding this item would exceed the category limit");
                                                                                                    return;
                                                                                                }
                                                                                                updateBoxItem(box.boxNumber, item.id, 1);
                                                                                            }}
                                                                                            className="btn btn-secondary"
                                                                                            style={{
                                                                                                padding: '2px 8px',
                                                                                                opacity: canAdd ? 1 : 0.5,
                                                                                                cursor: canAdd ? 'pointer' : 'not-allowed'
                                                                                            }}
                                                                                            title={!canAdd ? "Adding this item would exceed the category limit" : "Add item"}
                                                                                        >+</button>
                                                                                    </div>
                                                                                </div>
                                                                                {qty > 0 && (
                                                                                    <textarea
                                                                                        className="input"
                                                                                        placeholder="Add notes for this item..."
                                                                                        value={itemNote}
                                                                                        onChange={(e) => {
                                                                                            const updatedBoxes = orderConfig.boxes?.map((b: BoxConfiguration) => {
                                                                                                if (b.boxNumber !== box.boxNumber) return b;
                                                                                                const newItemNotes = { ...(b.itemNotes || {}) };
                                                                                                if (e.target.value.trim()) {
                                                                                                    newItemNotes[item.id] = e.target.value;
                                                                                                } else {
                                                                                                    delete newItemNotes[item.id];
                                                                                                }
                                                                                                return { ...b, itemNotes: newItemNotes };
                                                                                            }) || [];
                                                                                            setOrderConfig({ ...orderConfig, boxes: updatedBoxes });
                                                                                        }}
                                                                                        rows={2}
                                                                                        style={{
                                                                                            width: '100%',
                                                                                            fontSize: '0.85rem',
                                                                                            resize: 'vertical',
                                                                                            marginTop: '0.5rem'
                                                                                        }}
                                                                                    />
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
                                                    const uncategorizedItems = menuItems
                                                        .filter(i =>
                                                            (i.vendorId === null || i.vendorId === '') &&
                                                            i.isActive &&
                                                            (!i.categoryId || i.categoryId === '')
                                                        )
                                                        .sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

                                                    if (uncategorizedItems.length === 0) return null;

                                                    const selectedItems = box.items || {};

                                                    return (
                                                        <div style={{
                                                            marginTop: '1rem',
                                                            marginBottom: '1rem',
                                                            background: 'var(--bg-surface-hover)',
                                                            padding: '0.75rem',
                                                            borderRadius: '6px',
                                                            border: '1px solid var(--border-color)'
                                                        }}>
                                                            <div style={{ marginBottom: '0.5rem', fontSize: '0.85rem', fontWeight: 600 }}>Other Items</div>
                                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                                                                {uncategorizedItems.map(item => {
                                                                    const qty = Number(selectedItems[item.id] || 0);
                                                                    const itemNote = box.itemNotes?.[item.id] || '';
                                                                    return (
                                                                        <div key={item.id} style={{
                                                                            padding: '0.75rem',
                                                                            background: qty > 0 ? 'rgba(251, 191, 36, 0.1)' : 'var(--bg-app)',
                                                                            border: qty > 0 ? '2px solid #fbbf24' : '1px solid var(--border-color)',
                                                                            borderRadius: '6px'
                                                                        }}>
                                                                            <div style={{
                                                                                display: 'flex',
                                                                                alignItems: 'center',
                                                                                justifyContent: 'space-between',
                                                                                marginBottom: qty > 0 ? '0.5rem' : '0'
                                                                            }}>
                                                                                <span style={{ fontSize: '0.9rem', fontWeight: 500 }}>
                                                                                    {item.name}
                                                                                    {(item.quotaValue || 1) > 1 && (
                                                                                        <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginLeft: '4px' }}>
                                                                                            (Counts as {item.quotaValue || 1} meals)
                                                                                        </span>
                                                                                    )}
                                                                                </span>
                                                                                <div className={styles.quantityControl} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                                                    <button
                                                                                        onClick={() => updateBoxItem(box.boxNumber, item.id, -1)}
                                                                                        className="btn btn-secondary"
                                                                                        style={{ padding: '2px 8px' }}
                                                                                    >-</button>
                                                                                    <span style={{ width: '30px', textAlign: 'center', fontWeight: 500 }}>{qty}</span>
                                                                                    <button
                                                                                        onClick={() => updateBoxItem(box.boxNumber, item.id, 1)}
                                                                                        className="btn btn-secondary"
                                                                                        style={{ padding: '2px 8px' }}
                                                                                    >+</button>
                                                                                </div>
                                                                            </div>
                                                                            {qty > 0 && (
                                                                                <textarea
                                                                                    className="input"
                                                                                    placeholder="Add notes for this item..."
                                                                                    value={itemNote}
                                                                                    onChange={(e) => {
                                                                                        const updatedBoxes = orderConfig.boxes?.map((b: BoxConfiguration) => {
                                                                                            if (b.boxNumber !== box.boxNumber) return b;
                                                                                            const newItemNotes = { ...(b.itemNotes || {}) };
                                                                                            if (e.target.value.trim()) {
                                                                                                newItemNotes[item.id] = e.target.value;
                                                                                            } else {
                                                                                                delete newItemNotes[item.id];
                                                                                            }
                                                                                            return { ...b, itemNotes: newItemNotes };
                                                                                        }) || [];
                                                                                        setOrderConfig({ ...orderConfig, boxes: updatedBoxes });
                                                                                    }}
                                                                                    rows={2}
                                                                                    style={{
                                                                                        width: '100%',
                                                                                        fontSize: '0.85rem',
                                                                                        resize: 'vertical',
                                                                                        marginTop: '0.5rem'
                                                                                    }}
                                                                                />
                                                                            )}
                                                                        </div>
                                                                    );
                                                                })}
                                                            </div>
                                                        </div>
                                                    );
                                                })()}
                                            </div>
                                        </div>
                                    );
                                })}

                                {/* Add Box Button */}
                                <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    <button
                                        onClick={handleAddBox}
                                        disabled={!canAddMoreBoxes()}
                                        className="btn btn-primary"
                                        style={{
                                            padding: '0.75rem 1.5rem',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: '0.5rem',
                                            opacity: canAddMoreBoxes() ? 1 : 0.5,
                                            cursor: canAddMoreBoxes() ? 'pointer' : 'not-allowed'
                                        }}
                                    >
                                        <Plus size={18} />
                                        Add Another Box
                                    </button>
                                    
                                    {!canAddMoreBoxes() && (() => {
                                        const firstBoxType = displayBoxes[0] ? boxTypes.find(bt => bt.id === displayBoxes[0].boxTypeId) : null;
                                        const maxBoxes = getMaxBoxesAllowed(client.authorizedAmount, firstBoxType?.priceEach);
                                        return (
                                            <div style={{
                                                padding: '0.75rem',
                                                background: 'rgba(239, 68, 68, 0.1)',
                                                borderRadius: '6px',
                                                border: '1px solid var(--color-danger)',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '0.5rem',
                                                fontSize: '0.85rem',
                                                color: 'var(--color-danger)'
                                            }}>
                                                <AlertTriangle size={16} />
                                                <span>Maximum boxes reached based on authorized amount ({maxBoxes !== null ? maxBoxes : 'N/A'} boxes).</span>
                                            </div>
                                        );
                                    })()}
                                </div>
                            </div>
                        );
                    })()}

                    {/* Spacer to prevent content from being hidden behind fixed save bar */}
                    {(hasUnsavedChanges || saving) && (
                        <div style={{ height: 'clamp(140px, 20vh, 200px)' }} />
                    )}
                </div>
                )}

                {orderAndMealPlanOnly && client.serviceType === 'Food' && (() => {
                    const mealPlanHouseholdSize = Math.max(1, householdPeople?.length ?? 1);
                    const mealPlanTotal = mealPlanOrders.reduce((sum, o) => sum + (o.items ?? []).reduce((s: number, i: { value?: number | null; quantity?: number }) => s + ((i.value ?? 1) * Math.max(0, Number(i.quantity) ?? 0)), 0), 0);
                    const mealPlanExpected = mealPlanOrders.reduce((sum, o) => sum + (o.expectedTotalMeals ?? 0), 0) * mealPlanHouseholdSize;
                    return (
                    <section className={styles.card} style={{ marginTop: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                            {/* <h3 className={styles.sectionTitle} style={{ marginBottom: 0 }}>Your meal plan</h3> */}
                            <div className={styles.budget} style={{
                                color: mealPlanExpected > 0 && mealPlanTotal !== mealPlanExpected ? 'white' : 'inherit',
                                backgroundColor: mealPlanExpected > 0 && mealPlanTotal !== mealPlanExpected ? 'var(--color-danger)' : 'var(--bg-surface-hover)',
                                padding: '8px 12px',
                                borderRadius: '6px',
                                fontSize: '1rem',
                                fontWeight: 700
                            }}>
                                Meals: {mealPlanTotal} / {mealPlanExpected || '—'}
                                {mealPlanHouseholdSize > 1 && <span style={{ fontSize: '0.85rem', fontWeight: 500, opacity: 0.9 }}> ({mealPlanHouseholdSize} people)</span>}
                            </div>
                        </div>
                        <SavedMealPlanMonth
                            key={`meal-plan-${client.id}-${mealPlanDiscardTrigger}`}
                            clientId={client.id}
                            onOrdersChange={setMealPlanOrders}
                            onEditedDatesChange={setMealPlanEditedDates}
                            initialOrders={initialMealPlanOrders ?? undefined}
                            autoSave={false}
                            editedDatesResetTrigger={mealPlanEditedResetTrigger}
                            includeRecurringInTemplate={true}
                            householdSize={mealPlanHouseholdSize}
                        />
                    </section>
                    );
                })()}

                {!orderAndMealPlanOnly && (
                <>
                {/* Recent Orders Panel */}
                <div className={styles.card} style={{ marginTop: 'var(--spacing-lg)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: 'var(--spacing-md)' }}>
                        <Calendar size={18} />
                        <h3 className={styles.sectionTitle} style={{ marginBottom: 0, borderBottom: 'none', paddingBottom: 0 }}>
                            Recent Orders
                        </h3>
                    </div>
                    {previousOrders && previousOrders.length > 0 ? (
                        <div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                                {previousOrders.map((order: any, orderIdx: number) => {
                                    const isFood = order.serviceType === 'Food';
                                    const isBoxes = order.serviceType === 'Boxes';
                                    const isEquipment = order.serviceType === 'Equipment';

                                    return (
                                        <div key={order.id || orderIdx} style={{
                                            padding: 'var(--spacing-md)',
                                            backgroundColor: 'var(--bg-surface)',
                                            borderRadius: 'var(--radius-md)',
                                            border: '1px solid var(--border-color)'
                                        }}>
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
                                                    {order.orderNumber ? `Order #${order.orderNumber}` : `Order ${orderIdx + 1}`}
                                                    {order.scheduledDeliveryDate && (
                                                        <span style={{ marginLeft: 'var(--spacing-sm)', fontSize: '0.85rem', fontWeight: 400 }}>
                                                            • Scheduled: {(() => {
                                                                // Parse YYYY-MM-DD as local date to avoid timezone issues
                                                                const [year, month, day] = order.scheduledDeliveryDate.split('-').map(Number);
                                                                const date = new Date(year, month - 1, day);
                                                                return date.toLocaleDateString('en-US');
                                                            })()}
                                                        </span>
                                                    )}
                                                    {order.actualDeliveryDate && (
                                                        <span style={{ marginLeft: 'var(--spacing-sm)', fontSize: '0.85rem', fontWeight: 400 }}>
                                                            • Delivered: {(() => {
                                                                // Parse YYYY-MM-DD as local date to avoid timezone issues
                                                                const [year, month, day] = order.actualDeliveryDate.split('-').map(Number);
                                                                const date = new Date(year, month - 1, day);
                                                                return date.toLocaleDateString('en-US');
                                                            })()}
                                                        </span>
                                                    )}
                                                </div>

                                                {/* Proof of Delivery / Status */}
                                                <div style={{ fontSize: '0.85rem' }}>
                                                    {order.deliveryProofUrl ? (
                                                        <a
                                                            href={order.deliveryProofUrl}
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
                                                            {order.status === 'completed' ? 'Delivered' : order.status || 'Pending'}
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                            <div>
                                                {/* Service Type Header */}
                                                <div style={{ marginBottom: 'var(--spacing-sm)', fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                                                    {isFood ? 'Food' : isBoxes ? 'Boxes' : isEquipment ? 'Equipment' : 'Unknown Service'}
                                                </div>

                                                {/* Food Order Display */}
                                                {isFood && order.vendorSelections && order.vendorSelections.length > 0 && (
                                                    <div style={{ padding: 'var(--spacing-md)', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--spacing-md)' }}>
                                                            {order.vendorSelections.map((vendorSelection: any, idx: number) => {
                                                                const vendor = vendors.find(v => v.id === vendorSelection.vendorId);
                                                                const vendorName = vendor?.name || 'Unassigned';
                                                                const items = vendorSelection.items || [];

                                                                return (
                                                                    <div key={idx} style={{ padding: 'var(--spacing-md)', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
                                                                        <div style={{ marginBottom: 'var(--spacing-sm)', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                                                            {vendorName}
                                                                        </div>
                                                                        {items.length > 0 ? (
                                                                            <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                                                                                {items.map((item: any) => (
                                                                                    <div key={item.id || item.menuItemId} style={{ marginBottom: '4px' }}>
                                                                                        {item.menuItemName || 'Unknown Item'} × {item.quantity || 0}
                                                                                    </div>
                                                                                ))}
                                                                            </div>
                                                                        ) : (
                                                                            <div style={{ fontSize: '0.85rem', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
                                                                                No items
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Boxes Order Display */}
                                                {isBoxes && order.boxTypeId && (
                                                    <div style={{ padding: 'var(--spacing-md)', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
                                                        {(() => {
                                                            const box = boxTypes.find(b => b.id === order.boxTypeId);
                                                            const boxVendorId = order.vendorId || box?.vendorId || null;
                                                            const vendor = boxVendorId ? vendors.find(v => v.id === boxVendorId) : null;
                                                            const vendorName = vendor?.name || 'Unassigned';
                                                            const boxName = box?.name || 'Unknown Box';
                                                            const items = order.items || {};

                                                            return (
                                                                <>
                                                                    <div style={{ marginBottom: 'var(--spacing-sm)', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                                                                        {vendorName}
                                                                    </div>
                                                                    <div style={{ marginBottom: 'var(--spacing-sm)', fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                                                                        {boxName} × {order.boxQuantity || 1}
                                                                    </div>
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
                                                                </>
                                                            );
                                                        })()}
                                                    </div>
                                                )}

                                                {/* Equipment Order Display */}
                                                {isEquipment && (
                                                    <div style={{ padding: 'var(--spacing-md)', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-color)' }}>
                                                        <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                                                            {order.notes || 'Equipment order'}
                                                        </div>
                                                        {order.totalValue > 0 && (
                                                            <div style={{ marginTop: 'var(--spacing-sm)', fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-primary)' }}>
                                                                ${order.totalValue.toFixed(2)}
                                                            </div>
                                                        )}
                                                    </div>
                                                )}

                                                {/* Total Value */}
                                                {order.totalValue > 0 && (
                                                    <div style={{ marginTop: 'var(--spacing-sm)', paddingTop: 'var(--spacing-sm)', borderTop: '1px solid var(--border-color)', fontSize: '0.9rem', fontWeight: 600, color: 'var(--text-primary)' }}>
                                                        Total: ${order.totalValue.toFixed(2)}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ) : (
                        <div className={styles.empty} style={{ padding: 'var(--spacing-lg)', textAlign: 'center', color: 'var(--text-tertiary)' }}>
                            No recent orders.
                        </div>
                    )}
                </div>
                </>
                )}

                    {/* Spacer at very bottom so last content can scroll above the fixed save bar */}
                    {(hasUnsavedChanges || saving) && (
                        <div style={{ height: 'clamp(140px, 22vh, 220px)', minHeight: 140 }} aria-hidden />
                    )}

            {/* Fixed Floating Save Section at Bottom of Viewport */}
            {(hasUnsavedChanges || saving) && (
                <>
                    <style>{`
                        @media (max-width: 768px) {
                            .save-bar-container {
                                padding: 0.75rem 1rem !important;
                            }
                            .save-bar-content {
                                flex-direction: column !important;
                                gap: 0.75rem !important;
                            }
                            .save-bar-warning {
                                flex-direction: row !important;
                                gap: 0.5rem !important;
                                min-width: unset !important;
                            }
                            .save-bar-icon {
                                width: 20px !important;
                                height: 20px !important;
                            }
                            .save-bar-title {
                                font-size: 0.9rem !important;
                                margin-bottom: 0.125rem !important;
                            }
                            .save-bar-message {
                                font-size: 0.8rem !important;
                            }
                            .save-bar-buttons {
                                width: 100% !important;
                                flex-direction: column !important;
                                gap: 0.75rem !important;
                            }
                            .save-bar-button {
                                width: 100% !important;
                                font-size: 1rem !important;
                                padding: 12px 20px !important;
                                min-width: unset !important;
                            }
                            .save-bar-button-primary {
                                font-size: 1.1rem !important;
                                padding: 14px 24px !important;
                            }
                        }
                        @media (min-width: 769px) {
                            .save-bar-container {
                                padding: 1.5rem 2rem;
                            }
                            .save-bar-content {
                                gap: 1.5rem;
                            }
                            .save-bar-warning {
                                gap: 12px;
                            }
                            .save-bar-title {
                                font-size: 1.25rem;
                            }
                            .save-bar-message {
                                font-size: 0.95rem;
                            }
                            .save-bar-button {
                                font-size: 1.1rem;
                                padding: 14px 28px;
                            }
                            .save-bar-button-primary {
                                font-size: 1.25rem;
                                padding: 16px 40px;
                            }
                        }
                    `}</style>
                    <div className="save-bar-container" style={{
                        position: 'fixed',
                        bottom: 0,
                        left: 0,
                        right: 0,
                        backgroundColor: saving ? '#d1fae5' : mealPlanMismatch ? '#fef2f2' : '#fef3c7',
                        borderTop: saving ? '4px solid #10b981' : mealPlanMismatch ? '4px solid #dc2626' : '4px solid #f59e0b',
                        boxShadow: saving ? '0 -10px 30px -5px rgba(16, 185, 129, 0.4)' : mealPlanMismatch ? '0 -10px 30px -5px rgba(220, 38, 38, 0.4)' : '0 -10px 30px -5px rgba(245, 158, 11, 0.4)',
                        zIndex: 1000,
                        backdropFilter: 'blur(10px)'
                    }}>
                        <div className="save-bar-content" style={{
                            maxWidth: '1200px',
                            margin: '0 auto',
                            display: 'flex',
                            alignItems: 'center',
                            flexWrap: 'wrap'
                        }}>
                            <div className="save-bar-warning" style={{
                                display: 'flex',
                                alignItems: 'center',
                                flex: 1
                            }}>
                                {saving ? (
                                    <>
                                        <Loader2 className="save-bar-icon animate-spin" size={24} style={{ color: '#059669', flexShrink: 0 }} />
                                        <div style={{ flex: 1 }}>
                                            <div className="save-bar-title" style={{
                                                fontWeight: 700,
                                                color: '#059669',
                                                marginBottom: '0.25rem'
                                            }}>
                                                💾 SAVING CHANGES...
                                            </div>
                                            <div className="save-bar-message" style={{
                                                color: '#047857',
                                                fontWeight: 600
                                            }}>
                                                Please wait while your changes are being saved to the database
                                            </div>
                                        </div>
                                    </>
                                ) : mealPlanMismatch ? (
                                    <>
                                        <AlertTriangle className="save-bar-icon" size={24} style={{ color: '#b91c1c', flexShrink: 0 }} />
                                        <div style={{ flex: 1 }}>
                                            <div className="save-bar-title" style={{
                                                fontWeight: 700,
                                                color: '#b91c1c',
                                                marginBottom: '0.25rem'
                                            }}>
                                                ⚠️ UNSAVED CHANGES
                                            </div>
                                            <div className="save-bar-message" style={{
                                                color: '#991b1b',
                                                fontWeight: 600
                                            }}>
                                                Cannot save because of the mismatch. The following edited days have wrong amounts: {mealPlanMismatchedEditedDates.map(formatDateForMismatch).join(', ')}. Adjust quantities so each day&apos;s total matches the required amount.
                                            </div>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <AlertTriangle className="save-bar-icon" size={24} style={{ color: '#92400e', flexShrink: 0 }} />
                                        <div style={{ flex: 1 }}>
                                            <div className="save-bar-title" style={{
                                                fontWeight: 700,
                                                color: '#92400e',
                                                marginBottom: '0.25rem'
                                            }}>
                                                ⚠️ UNSAVED CHANGES
                                            </div>
                                            <div className="save-bar-message" style={{
                                                color: '#78350f',
                                                fontWeight: 600
                                            }}>
                                                Your changes will NOT be saved unless you click "Save Changes"
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                            <div className="save-bar-buttons" style={{ display: 'flex', flexWrap: 'wrap' }}>
                                <button
                                    onClick={handleDiscard}
                                    disabled={saving}
                                    className="btn btn-secondary save-bar-button"
                                    style={{
                                        fontWeight: 600,
                                        border: '2px solid var(--border-color)',
                                        opacity: saving ? 0.5 : 1,
                                        cursor: saving ? 'not-allowed' : 'pointer'
                                    }}
                                >
                                    Discard
                                </button>
                                <button
                                    onClick={handleSave}
                                    disabled={saving || mealPlanMismatch}
                                    className="btn btn-primary save-bar-button save-bar-button-primary"
                                    style={{
                                        fontWeight: 700,
                                        boxShadow: saving ? '0 4px 8px -2px rgba(0, 0, 0, 0.2)' : mealPlanMismatch ? '0 4px 8px -2px rgba(0, 0, 0, 0.2)' : '0 8px 16px -4px rgba(0, 0, 0, 0.3)',
                                        backgroundColor: saving ? '#10b981' : mealPlanMismatch ? '#9ca3af' : '#f59e0b',
                                        border: saving ? '2px solid #059669' : mealPlanMismatch ? '2px solid #6b7280' : '2px solid #d97706',
                                        color: '#1f2937',
                                        transform: saving || mealPlanMismatch ? 'scale(1)' : 'scale(1.05)',
                                        transition: 'all 0.2s',
                                        opacity: saving ? 0.9 : mealPlanMismatch ? 0.7 : 1,
                                        cursor: saving ? 'wait' : mealPlanMismatch ? 'not-allowed' : 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '8px',
                                        justifyContent: 'center'
                                    }}
                                    onMouseEnter={(e) => {
                                        if (!saving && !mealPlanMismatch) {
                                            e.currentTarget.style.transform = 'scale(1.08)';
                                            e.currentTarget.style.boxShadow = '0 12px 24px -4px rgba(0, 0, 0, 0.4)';
                                        }
                                    }}
                                    onMouseLeave={(e) => {
                                        if (!saving && !mealPlanMismatch) {
                                            e.currentTarget.style.transform = 'scale(1.05)';
                                            e.currentTarget.style.boxShadow = '0 8px 16px -4px rgba(0, 0, 0, 0.3)';
                                        }
                                    }}
                                >
                                    {saving ? (
                                        <>
                                            <Loader2 className="animate-spin" size={20} />
                                            SAVING...
                                        </>
                                    ) : (
                                        'SAVE CHANGES'
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                </>
            )}
            </div>
    );

    const clientInfoSidebar = orderAndMealPlanOnly && (
        <aside className={`${styles.profileLayoutSidebar} ${styles.profileLayoutSidebarCompact}`}>
            <section className={styles.clientInfoCard}>
                <h3 className={styles.sectionTitle} style={{ marginTop: 0 }}>Your info</h3>
                <div className={styles.clientInfoName}>{client.fullName || '—'}</div>
                <span className="label">Email</span>
                <div className={styles.clientInfoValue}>{client.email || '—'}</div>
                <span className="label">Phone</span>
                <div className={styles.clientInfoValue}>{client.phoneNumber || '—'}</div>
                {client.secondaryPhoneNumber && (
                    <>
                        <span className="label">Secondary phone</span>
                        <div className={styles.clientInfoValue}>{client.secondaryPhoneNumber}</div>
                    </>
                )}
                <span className="label">Address</span>
                <div className={styles.clientInfoValue}>{client.address || '—'}</div>
                <span className="label">Service</span>
                <div className={styles.clientInfoValue}>{client.serviceType || '—'}</div>
                <span className="label">People on this account</span>
                <div className={`${styles.clientInfoValue} ${styles.clientInfoValueLast}`}>
                    {householdPeople.length > 0 ? (
                        <ul style={{ margin: 0, paddingLeft: '1.1rem', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                            {householdPeople.map((p) => (
                                <li key={p.id}>{p.fullName || '—'}</li>
                            ))}
                        </ul>
                    ) : (
                        client.fullName || '—'
                    )}
                </div>
            </section>
        </aside>
    );

    return (
        <div className={styles.container}>
            {orderAndMealPlanOnly ? (
                <div className={`${styles.profileLayout} ${styles.profileLayoutPortal}`}>
                    {clientInfoSidebar}
                    <div className={styles.profileLayoutMain}>
                        {mainContent}
                    </div>
                </div>
            ) : (
                mainContent
            )}
        </div>
    );
}
