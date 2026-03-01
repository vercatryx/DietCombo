'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { CalendarDays, UtensilsCrossed, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  getClientMealPlannerData,
  getAvailableMealPlanTemplateWithAllDates,
  getAvailableMealPlanTemplateWithAllDatesIncludingRecurring,
  saveClientMealPlannerData,
  type MealPlannerOrderResult,
  type MealPlannerOrderDisplayItem
} from '@/lib/actions';
import { getTodayInAppTz } from '@/lib/timezone';
import styles from './SavedMealPlanMonth.module.css';
import clientProfileStyles from './ClientProfile.module.css';

const APP_TZ = 'America/New_York';

function formatDateLabel(iso: string): string {
  if (!iso || typeof iso !== 'string') return iso || '—';
  const normalized = iso.trim().slice(0, 10);
  const d = new Date(normalized + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return normalized || '—';
  const month = d.toLocaleDateString('en-US', { month: 'short', timeZone: APP_TZ });
  const day = d.toLocaleDateString('en-US', { day: 'numeric', timeZone: APP_TZ });
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: APP_TZ });
  return `${month} ${day} (${weekday})`;
}

function isToday(iso: string): boolean {
  const todayStr = getTodayInAppTz();
  return iso.trim().slice(0, 10) === todayStr;
}

function getTodayIso(): string {
  return getTodayInAppTz();
}

function formatExpirationLabel(iso: string): string {
  if (!iso || typeof iso !== 'string') return '—';
  const normalized = iso.trim().slice(0, 10);
  const d = new Date(normalized + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return normalized || '—';
  const month = d.toLocaleDateString('en-US', { month: 'short', timeZone: APP_TZ });
  const day = d.toLocaleDateString('en-US', { day: 'numeric', timeZone: APP_TZ });
  const year = d.toLocaleDateString('en-US', { year: 'numeric', timeZone: APP_TZ });
  return `${month} ${day}, ${year}`;
}

export interface SavedMealPlanMonthProps {
  /** Current client ID; when null or 'new', no data is loaded. */
  clientId: string | null;
  /** Called whenever the current orders (with quantities) change, so the parent can persist them on save. */
  onOrdersChange?: (orders: MealPlannerOrderResult[]) => void;
  /** Called when the set of dates edited in this session changes (so parent can show save button and only save those dates). */
  onEditedDatesChange?: (dates: string[]) => void;
  /** Preloaded orders (from profile payload or parent preload). When provided, skips the initial fetch for faster load. */
  initialOrders?: MealPlannerOrderResult[] | null;
  /** When true and clientId is 'new', parent is preloading; show loading and do not fetch (avoids duplicate request). */
  preloadInProgress?: boolean;
  /** When false, do not auto-save on each edit; parent will save on main Save click. Default true. */
  autoSave?: boolean;
  /** When this value changes (e.g. increment after save), component clears session-edited dates so parent can hide save button. */
  editedDatesResetTrigger?: number;
  /** When true, template for each day = recurring (Food default) + day-specific. Use for client portal day-only view. */
  includeRecurringInTemplate?: boolean;
  /** Number of people on the account (primary + dependants). Expected totals per day are multiplied by this so each person gets the default amount. Default 1. */
  householdSize?: number;
}

function applyOrders(orders: MealPlannerOrderResult[], setOrders: (o: MealPlannerOrderResult[]) => void) {
  setOrders(orders);
}

/** Scale template item quantities by household size so defaults show per-account amounts (e.g. 3 people → 3x quantities). */
function scaleTemplateQuantities(list: MealPlannerOrderResult[], multiplier: number): MealPlannerOrderResult[] {
  if (!list?.length || multiplier <= 1) return list ?? [];
  return list.map((order) => ({
    ...order,
    items: (order.items ?? []).map((item) => ({
      ...item,
      quantity: Math.max(0, Math.round((Number(item.quantity) ?? 0) * multiplier))
    }))
  }));
}

export function SavedMealPlanMonth({ clientId, onOrdersChange, onEditedDatesChange, initialOrders, preloadInProgress, autoSave = true, editedDatesResetTrigger, includeRecurringInTemplate = false, householdSize = 1 }: SavedMealPlanMonthProps) {
  const [orders, setOrders] = useState<MealPlannerOrderResult[]>([]);
  const [loadingDates, setLoadingDates] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [updatingItemId, setUpdatingItemId] = useState<string | null>(null);
  const [editingQty, setEditingQty] = useState<{ itemId: string; value: string } | null>(null);
  const fetchIdRef = useRef(0);
  /** Only dates the client has edited are persisted; untouched dates stay template-only. */
  const clientEditedDatesRef = useRef<Set<string>>(new Set());
  /** Dates edited in this session only (so parent saves only these, not all dates with data). */
  const sessionEditedDatesRef = useRef<Set<string>>(new Set());

  const effectiveClientId = clientId && clientId !== 'new' ? clientId : null;

  // Report only client-edited dates to parent so we don't overwrite template with merged data for untouched dates.
  useEffect(() => {
    const toPersist = orders.filter((o) => o.scheduledDeliveryDate && clientEditedDatesRef.current.has(o.scheduledDeliveryDate));
    if (toPersist.length > 0) onOrdersChange?.(toPersist);
  }, [orders, onOrdersChange]);

  // When initialOrders is provided (existing client from profile payload or new client preload), use it and skip fetch.
  // Treat dates in initialOrders as client-edited so we persist them on save; only add new dates when user edits.
  useEffect(() => {
    if (initialOrders == null || !Array.isArray(initialOrders)) return;
    clientEditedDatesRef.current = new Set(initialOrders.map((o) => o.scheduledDeliveryDate).filter(Boolean));
    applyOrders(initialOrders, setOrders);
    setLoadingDates(false);
  }, [initialOrders]);

  // Load all available dates from default template when clientId is 'new' and no initialOrders.
  // When preloadInProgress is true, parent is fetching; don't fetch here to avoid duplicate request.
  const getTemplateFn = includeRecurringInTemplate ? getAvailableMealPlanTemplateWithAllDatesIncludingRecurring : getAvailableMealPlanTemplateWithAllDates;
  useEffect(() => {
    if (clientId !== 'new' || preloadInProgress || (initialOrders != null && initialOrders.length > 0)) return;
    setLoadingDates(true);
    const thisFetchId = fetchIdRef.current + 1;
    fetchIdRef.current = thisFetchId;
    getTemplateFn()
      .then((list) => {
        if (fetchIdRef.current !== thisFetchId) return;
        applyOrders(list, setOrders);
      })
      .catch((err) => {
        if (fetchIdRef.current !== thisFetchId) return;
        console.error('[SavedMealPlanMonth] Error loading default template for new client:', err);
        setOrders([]);
      })
      .finally(() => {
        if (fetchIdRef.current === thisFetchId) setLoadingDates(false);
      });
  }, [clientId, initialOrders, preloadInProgress, includeRecurringInTemplate]);

  // Load meal plan data for existing client: show ALL dates from settings (default template),
  // merged with this client's saved data per date. So every configured date appears; client's
  // choices are remembered where they've set them.
  useEffect(() => {
    if (!effectiveClientId) {
      if (clientId !== 'new') {
        setOrders([]);
        setSelectedDate(null);
        setLoadingDates(false);
      }
      return;
    }
    // Menu (items, order, meals per item) always comes from the template. Only the client's
    // selection (quantities) is merged on top so the same full menu is shown with their choices.
    const mergeTemplateWithClient = (templateList: MealPlannerOrderResult[], clientSavedList: MealPlannerOrderResult[]) => {
      const byDate = new Map<string, MealPlannerOrderResult>();
      for (const o of templateList) {
        if (o.scheduledDeliveryDate) byDate.set(o.scheduledDeliveryDate, o);
      }
      for (const o of clientSavedList) {
        if (!o.scheduledDeliveryDate) continue;
        const templateOrder = byDate.get(o.scheduledDeliveryDate);
        if (!templateOrder) {
          byDate.set(o.scheduledDeliveryDate, o);
          continue;
        }
        const clientSelectionsByKey = new Map(
          o.items.map((i) => [(i.name ?? '').trim().toLowerCase(), i])
        );
        const mergedItems = templateOrder.items.map((tItem) => {
          const key = (tItem.name ?? '').trim().toLowerCase();
          const clientItem = clientSelectionsByKey.get(key);
          if (clientItem) {
            return {
              ...tItem,
              id: clientItem.id,
              quantity: clientItem.quantity
              // value (meals per item) stays from template - menu is fixed
            };
          }
          return tItem;
        });
        byDate.set(o.scheduledDeliveryDate, {
          ...templateOrder,
          items: mergedItems,
          expirationDate: templateOrder.expirationDate ?? o.expirationDate,
          expectedTotalMeals: templateOrder.expectedTotalMeals ?? o.expectedTotalMeals
        });
      }
      return Array.from(byDate.values()).sort((a, b) =>
        (a.scheduledDeliveryDate || '').localeCompare(b.scheduledDeliveryDate || '')
      );
    };
    if (initialOrders != null && initialOrders.length > 0) {
      // Parent passed cached client data; still merge with template so all dates from settings show.
      setLoadingDates(true);
      const thisFetchId = fetchIdRef.current + 1;
      fetchIdRef.current = thisFetchId;
      (includeRecurringInTemplate ? getAvailableMealPlanTemplateWithAllDatesIncludingRecurring() : getAvailableMealPlanTemplateWithAllDates())
        .then((templateList) => {
          if (fetchIdRef.current !== thisFetchId) return;
          const scaledTemplate = scaleTemplateQuantities(templateList ?? [], householdSize);
          console.log('[MealPlan Step 5] SavedMealPlanMonth (with initialOrders): templateList length=', templateList?.length ?? 0, 'first order items=', templateList?.[0]?.items?.length ?? 0, 'initialOrders length=', initialOrders?.length ?? 0);
          clientEditedDatesRef.current = new Set(initialOrders.map((o) => o.scheduledDeliveryDate).filter(Boolean));
          const merged = mergeTemplateWithClient(scaledTemplate, initialOrders);
          console.log('[MealPlan Step 5] SavedMealPlanMonth: merged length=', merged?.length ?? 0, 'first merged order items=', merged?.[0]?.items?.length ?? 0);
          applyOrders(merged, setOrders);
        })
        .catch((err) => {
          if (fetchIdRef.current !== thisFetchId) return;
          applyOrders(initialOrders, setOrders);
        })
        .finally(() => {
          if (fetchIdRef.current === thisFetchId) setLoadingDates(false);
        });
      return;
    }
    setLoadingDates(true);
    const thisFetchId = fetchIdRef.current + 1;
    fetchIdRef.current = thisFetchId;

    Promise.all([
      includeRecurringInTemplate ? getAvailableMealPlanTemplateWithAllDatesIncludingRecurring() : getAvailableMealPlanTemplateWithAllDates(),
      getClientMealPlannerData(effectiveClientId)
    ])
      .then(([templateList, clientSavedList]) => {
        if (fetchIdRef.current !== thisFetchId) return;
        const scaledTemplate = scaleTemplateQuantities(templateList ?? [], householdSize);
        console.log('[MealPlan Step 5] SavedMealPlanMonth (no initialOrders): templateList length=', templateList?.length ?? 0, 'first order items=', templateList?.[0]?.items?.length ?? 0, 'clientSavedList length=', clientSavedList?.length ?? 0);
        clientEditedDatesRef.current = new Set(clientSavedList.map((o) => o.scheduledDeliveryDate).filter(Boolean));
        const merged = mergeTemplateWithClient(scaledTemplate, clientSavedList);
        console.log('[MealPlan Step 5] SavedMealPlanMonth: merged length=', merged?.length ?? 0, 'first merged order items=', merged?.[0]?.items?.length ?? 0);
        applyOrders(merged, setOrders);
      })
      .catch((err) => {
        if (fetchIdRef.current !== thisFetchId) return;
        console.error('[SavedMealPlanMonth] Error loading meal planner data:', err);
        setOrders([]);
      })
      .finally(() => {
        if (fetchIdRef.current === thisFetchId) setLoadingDates(false);
      });
  }, [effectiveClientId, initialOrders, includeRecurringInTemplate, householdSize]);

  const todayIso = useMemo(() => getTodayIso(), []);

  // Only show dates that are today or future and not expired (expirationDate >= today when set)
  const futureOrders = useMemo(
    () =>
      orders.filter(
        (o) =>
          (o.scheduledDeliveryDate || '') >= todayIso &&
          (o.expirationDate == null || o.expirationDate === '' || o.expirationDate >= todayIso)
      ),
    [orders, todayIso]
  );

  const validDateSet = useMemo(() => new Set(futureOrders.map((o) => o.scheduledDeliveryDate).filter(Boolean)), [futureOrders]);

  // When parent signals save completed (trigger changed), clear session-edited set so we don't report stale dirty state.
  useEffect(() => {
    if (editedDatesResetTrigger == null) return;
    sessionEditedDatesRef.current = new Set();
    onEditedDatesChange?.([]);
  }, [editedDatesResetTrigger, onEditedDatesChange]);

  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  const calendarDays = useMemo(() => {
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const firstDay = new Date(year, month, 1);
    const firstWeekday = firstDay.getDay();
    const lastDay = new Date(year, month + 1, 0).getDate();
    const days: (Date | null)[] = [];
    for (let i = 0; i < firstWeekday; i++) days.push(null);
    for (let d = 1; d <= lastDay; d++) days.push(new Date(year, month, d));
    return days;
  }, [calendarMonth]);

  function dateKeyForCalendarDay(year: number, month: number, day: number): string {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const calendarMonthYear = calendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const selectedOrder = useMemo(
    () => (selectedDate ? futureOrders.find((o) => o.scheduledDeliveryDate === selectedDate) : null),
    [futureOrders, selectedDate]
  );
  const hasDates = futureOrders.length > 0;

  // When selected date is no longer in the list, switch to first available date or clear
  useEffect(() => {
    if (!selectedDate) return;
    if (futureOrders.some((o) => o.scheduledDeliveryDate === selectedDate)) return;
    setSelectedDate(futureOrders.length > 0 ? (futureOrders[0]?.scheduledDeliveryDate ?? null) : null);
  }, [selectedDate, futureOrders]);

  function getItemQty(item: MealPlannerOrderDisplayItem): number {
    const n = Number(item.quantity);
    return Number.isNaN(n) ? 0 : Math.max(0, Math.floor(n));
  }

  async function changeQuantity(item: MealPlannerOrderDisplayItem, delta: number) {
    if (!selectedDate || !selectedOrder) return;
    const currentQty = getItemQty(item);
    const newQty = Math.max(0, currentQty + delta);
    if (newQty === currentQty) return;
    await setQuantityDirect(item, newQty);
  }

  async function setQuantityDirect(item: MealPlannerOrderDisplayItem, newQty: number) {
    if (!selectedDate || !selectedOrder) return;
    const qty = Math.max(0, Math.floor(Number(newQty)) || 0);
    const currentQty = getItemQty(item);
    if (qty === currentQty) return;
    clientEditedDatesRef.current.add(selectedDate);
    sessionEditedDatesRef.current.add(selectedDate);
    onEditedDatesChange?.(Array.from(sessionEditedDatesRef.current));
    setUpdatingItemId(item.id);
    const nextOrders = orders.map((o) =>
      o.scheduledDeliveryDate === selectedDate
        ? {
            ...o,
            items: o.items.map((i) =>
              i.id === item.id ? { ...i, quantity: qty } : i
            )
          }
        : o
    );
    setOrders(nextOrders);
    const toPersist = nextOrders.filter((o) => o.scheduledDeliveryDate && clientEditedDatesRef.current.has(o.scheduledDeliveryDate));
    onOrdersChange?.(toPersist);
    // For new client, only update local state; parent will persist on save via saveClientMealPlannerDataFull
    if (!effectiveClientId) {
      setUpdatingItemId(null);
      return;
    }
    // When autoSave is false (e.g. client portal), parent Save button persists; don't write here.
    if (!autoSave) {
      setUpdatingItemId(null);
      return;
    }
    try {
      const updatedItems = nextOrders.find((o) => o.scheduledDeliveryDate === selectedDate)?.items ?? [];
      const { ok } = await saveClientMealPlannerData(effectiveClientId, selectedDate, updatedItems);
      if (!ok) {
        getClientMealPlannerData(effectiveClientId).then((list) => {
          setOrders(list);
          onOrdersChange?.(list);
        }).catch(() => {});
      }
    } finally {
      setUpdatingItemId(null);
    }
  }

  return (
    <div className={styles.wrapper}>
      <header className={styles.header}>
        <p className={styles.titleSimple}>Click on a day marked in green to customize the orders for that day.</p>
      </header>

      {!effectiveClientId && (clientId !== 'new' || orders.length === 0) ? (
        <div className={styles.emptyState}>
          <CalendarDays size={32} />
          <p>{clientId === 'new' ? 'No default meal plan template configured, or save the client to load the meal plan.' : 'Save the client first to see saved meal plans.'}</p>
        </div>
      ) : (loadingDates || (clientId === 'new' && preloadInProgress)) ? (
        <div className={styles.calendarLoadingWrap}>
          <div className={styles.calendarLoading} aria-hidden>
            <div className={styles.calendarLoadingHeader}>
              <div className={styles.calendarLoadingNav} />
              <div className={styles.calendarLoadingMonth} />
              <div className={styles.calendarLoadingNav} />
            </div>
            <div className={styles.calendarLoadingWeekdays}>
              {WEEKDAY_LABELS.map((label) => (
                <div key={label} className={styles.calendarLoadingWeekday}>{label}</div>
              ))}
            </div>
            <div className={styles.calendarLoadingGrid}>
              {Array.from({ length: 35 }, (_, i) => (
                <div key={i} className={styles.calendarLoadingDay} />
              ))}
            </div>
            <p className={styles.calendarLoadingLabel} aria-live="polite">Loading calendar…</p>
          </div>
        </div>
      ) : !hasDates ? (
        <div className={styles.emptyState}>
          <CalendarDays size={32} />
          <p>No non-expired delivery dates. Add dates in the meal planner settings or extend expiration to show them here.</p>
        </div>
      ) : (
        <>
          <div className={styles.mealPlannerCalendarWrap}>
          <div className={styles.mealPlannerCalendar}>
            <div className={styles.calendarHeader}>
              <button
                type="button"
                className={styles.calendarNav}
                onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))}
                aria-label="Previous month"
              >
                <ChevronLeft size={20} />
              </button>
              <span className={styles.calendarMonthYear}>{calendarMonthYear}</span>
              <button
                type="button"
                className={styles.calendarNav}
                onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))}
                aria-label="Next month"
              >
                <ChevronRight size={20} />
              </button>
            </div>
            <div className={styles.calendarWeekdays}>
              {WEEKDAY_LABELS.map((label) => (
                <div key={label} className={styles.calendarWeekday}>{label}</div>
              ))}
            </div>
            <div className={styles.calendarGrid}>
              {calendarDays.map((date, index) => {
                const dateKey = date ? dateKeyForCalendarDay(date.getFullYear(), date.getMonth(), date.getDate()) : null;
                const isSelectable = dateKey != null && validDateSet.has(dateKey);
                const hasPlan = isSelectable && futureOrders.some((o) => o.scheduledDeliveryDate === dateKey);
                const isTodayCell = dateKey === getTodayIso();
                return (
                  <div
                    key={dateKey ?? `empty-${index}`}
                    className={[
                      date ? styles.calendarDay : styles.calendarDayEmpty,
                      date && !isSelectable && styles.calendarDayDisabled,
                      date && hasPlan && styles.calendarDayHasPlan,
                      date && isTodayCell && styles.calendarDayToday,
                    ].filter(Boolean).join(' ')}
                    onClick={isSelectable && dateKey ? () => setSelectedDate(selectedDate === dateKey ? null : dateKey) : undefined}
                    role={date && isSelectable ? 'button' : undefined}
                    tabIndex={date && isSelectable ? 0 : undefined}
                    onKeyDown={dateKey && isSelectable ? (e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedDate(selectedDate === dateKey ? null : dateKey); } : undefined}
                    title={!isSelectable && dateKey ? 'Expired or not configured' : date && isSelectable ? 'Select to edit order' : undefined}
                  >
                    {date && (
                      <span className={styles.calendarDayNum}>{date.getDate()}</span>
                    )}
                  </div>
                );
              })}
            </div>
            <div className={styles.calendarLegend} aria-hidden>
              <span className={styles.calendarLegendItem}>
         
              </span>
            </div>
          </div>
          </div>

          {selectedDate && (
            <div className={styles.detailPanel}>
              <div className={styles.detailHeader}>
                <UtensilsCrossed className={styles.detailIcon} size={22} />
                <span>{formatDateLabel(selectedDate)}</span>
                {isToday(selectedDate) && <span className={styles.todayBadge}>Today</span>}
                {selectedOrder?.expirationDate && (
                  <span className={styles.expiresTag} title={`You can edit this order until ${formatExpirationLabel(selectedOrder.expirationDate)}`}>
                    You can edit this order till {formatExpirationLabel(selectedOrder.expirationDate)}
                  </span>
                )}
              </div>
              {!selectedOrder ? (
                <p className={styles.noItems}>No order for this date.</p>
              ) : selectedOrder.items.length === 0 ? (
                <p className={styles.noItems}>No items for this date.</p>
              ) : (() => {
                const currentTotalMeals = selectedOrder.items.reduce((sum, item) => {
                  const unitValue = item.value != null && !Number.isNaN(Number(item.value)) ? Number(item.value) : 1;
                  return sum + unitValue * getItemQty(item);
                }, 0);
                const baseExpected = selectedOrder.expectedTotalMeals ?? null;
                const expectedTotal = baseExpected != null ? baseExpected * householdSize : null;
                const totalMismatch = expectedTotal != null && currentTotalMeals !== expectedTotal;

                return (
                  <>
                    {totalMismatch && (
                      <div className={styles.mealsMismatchBanner} role="alert">
                        The total meals must be exactly equal to {expectedTotal}{householdSize > 1 ? ` (${baseExpected} × ${householdSize} people)` : ''}. You currently have {currentTotalMeals} selected.
                      </div>
                    )}
                    <div className={styles.tableWrap}>
                      <table className={styles.itemsTable}>
                        <thead>
                          <tr>
                            <th className={styles.thName}>Item</th>
                            <th className={styles.thQty}>Qty</th>
                            <th className={styles.thValue}>Meals</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(() => {
                            const items = selectedOrder.items;
                            // Hide placeholder rows: backend uses name "Item" when item has no custom_name/menu_item (stray "item qt 2" at top).
                            // Do NOT filter out items with id starting with 'recurring-' — those are real recurring menu items (name may be "Item" when template resolution failed).
                            const isPlaceholder = (i: typeof items[0]) =>
                                (i.name ?? '').trim().toLowerCase() === 'item' && !String(i.id || '').startsWith('recurring-');
                            const filteredItems = items.filter((i) => !isPlaceholder(i));
                            const recurringItems = includeRecurringInTemplate ? filteredItems.filter((i) => String(i.id || '').startsWith('recurring-')) : filteredItems;
                            const daySpecificItems = includeRecurringInTemplate ? filteredItems.filter((i) => !String(i.id || '').startsWith('recurring-')) : filteredItems;
                            const showSeparator = includeRecurringInTemplate && recurringItems.length > 0 && daySpecificItems.length > 0;
                            // Day-specific on top, grey bar "Alternate items", then recurring on bottom
                            const itemsToRender = includeRecurringInTemplate ? [...daySpecificItems, ...(showSeparator ? [{ _separator: true, label: 'Alternate items' }] : []), ...recurringItems] : filteredItems;
                            console.log('[MealPlan Step 6] SavedMealPlanMonth render:', 'selectedDate=', selectedDate, 'items=', items.length, 'filtered=', filteredItems.length, 'recurring=', recurringItems.length, 'daySpecific=', daySpecificItems.length, 'itemsToRender=', itemsToRender.length);
                            return itemsToRender.map((itemOrSep, idx) => {
                            if ((itemOrSep as any)._separator) {
                              const label = (itemOrSep as any).label ?? 'Alternate items';
                              return (
                                <tr key={`sep-${idx}`} className={styles.separatorRow} aria-hidden>
                                  <td colSpan={3}>
                                    <span className={styles.separatorLabel}>{label}</span>
                                    <span className={styles.separatorLine} />
                                  </td>
                                </tr>
                              );
                            }
                            const item = itemOrSep as typeof selectedOrder.items[0];
                            const unitValue = item.value != null && !Number.isNaN(Number(item.value)) ? Number(item.value) : 1;
                            const lineTotal = unitValue * getItemQty(item);
                            return (
                              <tr key={item.id} className={styles.itemRow}>
                                <td className={styles.itemName}>
                                  {item.name}
                                  {item.value != null && !Number.isNaN(Number(item.value)) && Number(item.value) !== 1 && (
                                    <span className={styles.itemValueHint}> ({Number(item.value)} meals)</span>
                                  )}
                                </td>
                                <td className={styles.itemQty}>
                                  <div
                                    className={clientProfileStyles.quantityControl}
                                    style={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '8px',
                                      backgroundColor: 'var(--bg-surface)',
                                      padding: '2px',
                                      borderRadius: '6px',
                                      border: '1px solid var(--border-color)'
                                    }}
                                  >
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        changeQuantity(item, -1);
                                      }}
                                      className="btn btn-ghost btn-sm"
                                      style={{
                                        width: '24px',
                                        height: '24px',
                                        padding: 0,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center'
                                      }}
                                      aria-label="Decrease quantity"
                                    >
                                      -
                                    </button>
                                    <input
                                      type="number"
                                      min={0}
                                      step={1}
                                      value={editingQty?.itemId === item.id ? editingQty.value : String(getItemQty(item))}
                                      onFocus={() =>
                                        setEditingQty({ itemId: item.id, value: String(getItemQty(item)) })
                                      }
                                      onChange={(e) => {
                                        const raw = e.target.value;
                                        if (editingQty?.itemId === item.id) {
                                          setEditingQty({ itemId: item.id, value: raw });
                                        }
                                      }}
                                      onBlur={() => {
                                        const raw = editingQty?.itemId === item.id ? editingQty.value : '';
                                        setEditingQty(null);
                                        const num = raw === '' ? 0 : parseInt(raw, 10);
                                        const qty = Number.isNaN(num) || num < 0 ? 0 : num;
                                        if (qty !== getItemQty(item)) setQuantityDirect(item, qty);
                                      }}
                                      onKeyDown={(e) => {
                                        if (e.key === 'Enter') {
                                          e.currentTarget.blur();
                                        }
                                      }}
                                      style={{
                                        width: '44px',
                                        textAlign: 'center',
                                        fontWeight: 600,
                                        fontSize: '0.9rem',
                                        border: '1px solid var(--border-color)',
                                        borderRadius: '4px',
                                        padding: '2px 4px',
                                        backgroundColor: 'var(--bg-surface)'
                                      }}
                                      aria-label="Quantity"
                                    />
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        changeQuantity(item, 1);
                                      }}
                                      className="btn btn-ghost btn-sm"
                                      style={{
                                        width: '24px',
                                        height: '24px',
                                        padding: 0,
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center'
                                      }}
                                      aria-label="Increase quantity"
                                    >
                                      +
                                    </button>
                                  </div>
                                </td>
                                <td className={styles.itemValue}>{lineTotal}</td>
                              </tr>
                            );
                          });
                          })()}
                        </tbody>
                        <tfoot>
                          <tr className={styles.totalRow}>
                            <td className={styles.itemName} colSpan={2}>
                              <strong>Total meals</strong>
                            </td>
                            <td className={styles.itemValue}>
                              {selectedOrder.items.reduce((sum, item) => {
                                const unitValue = item.value != null && !Number.isNaN(Number(item.value)) ? Number(item.value) : 1;
                                return sum + unitValue * getItemQty(item);
                              }, 0)}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  </>
                );
              })()}
            </div>
          )}
        </>
      )}
    </div>
  );
}
