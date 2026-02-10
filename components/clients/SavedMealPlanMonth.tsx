'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { CalendarDays, UtensilsCrossed } from 'lucide-react';
import {
  getSavedMealPlanDatesWithItemsFromOrders,
  getDefaultMealPlanTemplateForNewClient,
  updateMealPlannerOrderItemQuantity,
  ensureMealPlannerOrdersFromDefaultTemplate,
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

export interface SavedMealPlanMonthProps {
  /** Current client ID; when null or 'new', no data is loaded. */
  clientId: string | null;
  /** Called whenever the current orders (with quantities) change, so the parent can persist them on save. */
  onOrdersChange?: (orders: MealPlannerOrderResult[]) => void;
  /** Preloaded orders (from profile payload or parent preload). When provided, skips the initial fetch for faster load. */
  initialOrders?: MealPlannerOrderResult[] | null;
  /** When true and clientId is 'new', parent is preloading; show loading and do not fetch (avoids duplicate request). */
  preloadInProgress?: boolean;
}

function applyOrdersAndSelectFirst(orders: MealPlannerOrderResult[], setOrders: (o: MealPlannerOrderResult[]) => void, setSelectedDate: (d: string | null) => void) {
  setOrders(orders);
  const today = getTodayIso();
  const future = orders.filter((o) => (o.scheduledDeliveryDate || '') >= today);
  const sorted = [...future].sort((a, b) => (a.scheduledDeliveryDate || '').localeCompare(b.scheduledDeliveryDate || ''));
  const firstDate = sorted.length > 0 ? sorted[0].scheduledDeliveryDate : (orders[0]?.scheduledDeliveryDate ?? null);
  setSelectedDate(firstDate);
}

export function SavedMealPlanMonth({ clientId, onOrdersChange, initialOrders, preloadInProgress }: SavedMealPlanMonthProps) {
  const [orders, setOrders] = useState<MealPlannerOrderResult[]>([]);
  const [loadingDates, setLoadingDates] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [updatingItemId, setUpdatingItemId] = useState<string | null>(null);
  const fetchIdRef = useRef(0);

  const effectiveClientId = clientId && clientId !== 'new' ? clientId : null;

  // Report current orders to parent so client profile save can persist meal plan quantity changes.
  useEffect(() => {
    if (orders.length > 0) onOrdersChange?.(orders);
  }, [orders, onOrdersChange]);

  // When initialOrders is provided (existing client from profile payload or new client preload), use it and skip fetch.
  useEffect(() => {
    if (initialOrders == null || !Array.isArray(initialOrders)) return;
    applyOrdersAndSelectFirst(initialOrders, setOrders, setSelectedDate);
    setLoadingDates(false);
  }, [initialOrders]);

  // Load default template when clientId is 'new' and no initialOrders (user opened new client without preload).
  // When preloadInProgress is true, parent is fetching; don't fetch here to avoid duplicate request.
  useEffect(() => {
    if (clientId !== 'new' || preloadInProgress || (initialOrders != null && initialOrders.length > 0)) return;
    setLoadingDates(true);
    const thisFetchId = fetchIdRef.current + 1;
    fetchIdRef.current = thisFetchId;
    getDefaultMealPlanTemplateForNewClient()
      .then((list) => {
        if (fetchIdRef.current !== thisFetchId) return;
        applyOrdersAndSelectFirst(list, setOrders, setSelectedDate);
      })
      .catch((err) => {
        if (fetchIdRef.current !== thisFetchId) return;
        console.error('[SavedMealPlanMonth] Error loading default template for new client:', err);
        setOrders([]);
      })
      .finally(() => {
        if (fetchIdRef.current === thisFetchId) setLoadingDates(false);
      });
  }, [clientId, initialOrders, preloadInProgress]);

  // Load meal plan data when the dialog is opened for an existing client (and no initialOrders). Always refetch when the client
  // is set so the list of dates with meal plans is always up to date (e.g. after adding a plan
  // elsewhere and reopening the dialog).
  useEffect(() => {
    if (!effectiveClientId) {
      if (clientId !== 'new') {
        setOrders([]);
        setSelectedDate(null);
        setLoadingDates(false);
      }
      return;
    }
    if (initialOrders != null && initialOrders.length > 0) {
      applyOrdersAndSelectFirst(initialOrders, setOrders, setSelectedDate);
      setLoadingDates(false);
      return;
    }
    setLoadingDates(true);
    const thisFetchId = fetchIdRef.current + 1;
    fetchIdRef.current = thisFetchId;

    getSavedMealPlanDatesWithItemsFromOrders(effectiveClientId)
      .then(async (list) => {
        if (fetchIdRef.current !== thisFetchId) return;
        // When no dates or items, load default template from meal_planner_custom_items for today and future and create orders
        if (list.length === 0) {
          const { ok } = await ensureMealPlannerOrdersFromDefaultTemplate(effectiveClientId);
          if (ok) {
            const refetched = await getSavedMealPlanDatesWithItemsFromOrders(effectiveClientId);
            if (fetchIdRef.current !== thisFetchId) return;
            list = refetched;
          }
        }
        applyOrdersAndSelectFirst(list, setOrders, setSelectedDate);
      })
      .catch((err) => {
        if (fetchIdRef.current !== thisFetchId) return;
        console.error('[SavedMealPlanMonth] Error loading meal planner orders:', err);
        setOrders([]);
      })
      .finally(() => {
        if (fetchIdRef.current === thisFetchId) setLoadingDates(false);
      });
  }, [effectiveClientId, initialOrders]);

  const todayIso = useMemo(() => getTodayIso(), []);

  // Only show today and future dates in the meal planner (from upcoming_orders + upcoming_order_items, service_type = meal_planner)
  const futureOrders = useMemo(
    () => orders.filter((o) => (o.scheduledDeliveryDate || '') >= todayIso),
    [orders, todayIso]
  );
  const datesWithPlans = useMemo(
    () => futureOrders.map((o) => o.scheduledDeliveryDate).filter(Boolean),
    [futureOrders]
  );
  const selectedOrder = useMemo(
    () => (selectedDate ? futureOrders.find((o) => o.scheduledDeliveryDate === selectedDate) : null),
    [futureOrders, selectedDate]
  );
  const hasDates = datesWithPlans.length > 0;

  function getItemQty(item: MealPlannerOrderDisplayItem): number {
    return Math.max(1, Number(item.quantity) || 1);
  }

  async function changeQuantity(item: MealPlannerOrderDisplayItem, delta: number) {
    if (!selectedDate || !selectedOrder) return;
    const currentQty = getItemQty(item);
    const newQty = Math.max(1, currentQty + delta);
    if (newQty === currentQty) return;
    await setQuantityDirect(item, newQty);
  }

  async function setQuantityDirect(item: MealPlannerOrderDisplayItem, newQty: number) {
    if (!selectedDate || !selectedOrder) return;
    const qty = Math.max(1, Number(newQty) || 1);
    const currentQty = getItemQty(item);
    if (qty === currentQty) return;
    setUpdatingItemId(item.id);
    // Optimistic update so the displayed quantity changes immediately
    setOrders((prev) =>
      prev.map((o) =>
        o.scheduledDeliveryDate === selectedDate
          ? {
              ...o,
              items: o.items.map((i) =>
                i.id === item.id ? { ...i, quantity: qty } : i
              )
            }
          : o
      )
    );
    // For new client, only update local state; parent will persist on save via createMealPlannerOrdersFromTemplate
    if (!effectiveClientId) {
      setUpdatingItemId(null);
      return;
    }
    try {
      const { ok } = await updateMealPlannerOrderItemQuantity(item.id, qty);
      if (!ok) {
        getSavedMealPlanDatesWithItemsFromOrders(effectiveClientId).then(setOrders).catch(() => {});
      }
    } finally {
      setUpdatingItemId(null);
    }
  }

  return (
    <div className={styles.wrapper}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <CalendarDays className={styles.titleIcon} size={26} />
          <h4 className={styles.title}>Saved Meal Plan for the Month</h4>
        </div>
        <p className={styles.subtitle}>
          Upcoming dates (today and future) with a saved meal plan. Click a date to view its items.
        </p>
      </header>

      {!effectiveClientId && (clientId !== 'new' || orders.length === 0) ? (
        <div className={styles.emptyState}>
          <CalendarDays size={32} />
          <p>{clientId === 'new' ? 'No default meal plan template configured, or save the client to load the meal plan.' : 'Save the client first to see saved meal plans.'}</p>
        </div>
      ) : (loadingDates || (clientId === 'new' && preloadInProgress)) ? (
        <div className={styles.emptyState}>
          <p>Loading saved dates…</p>
        </div>
      ) : !hasDates ? (
        <div className={styles.emptyState}>
          <CalendarDays size={32} />
          <p>No saved meal plans for this client.</p>
        </div>
      ) : (
        <>
          <div className={styles.datesRow}>
            {datesWithPlans.map((d) => (
              <button
                key={d}
                type="button"
                className={`${styles.dateBtn} ${selectedDate === d ? styles.active : ''}`}
                onClick={() => setSelectedDate(selectedDate === d ? null : d)}
              >
                {isToday(d) && <span className={styles.todayTag}>Today</span>}
                <span className={styles.dateLabel}>{formatDateLabel(d)}</span>
              </button>
            ))}
          </div>

          {selectedDate && (
            <div className={styles.detailPanel}>
              <div className={styles.detailHeader}>
                <UtensilsCrossed className={styles.detailIcon} size={22} />
                <span>{formatDateLabel(selectedDate)}</span>
                {isToday(selectedDate) && <span className={styles.todayBadge}>Today</span>}
              </div>
              {!selectedOrder ? (
                <p className={styles.noItems}>No order for this date.</p>
              ) : selectedOrder.items.length === 0 ? (
                <p className={styles.noItems}>No items for this date.</p>
              ) : (
                <div className={styles.tableWrap}>
                  <table className={styles.itemsTable}>
                    <thead>
                      <tr>
                        <th className={styles.thName}>Item</th>
                        <th className={styles.thQty}>Qty</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedOrder.items.map((item) => (
                        <tr key={item.id} className={styles.itemRow}>
                          <td className={styles.itemName}>{item.name}</td>
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
                                disabled={
                                  getItemQty(item) <= 1 || updatingItemId === item.id
                                }
                                aria-label="Decrease quantity"
                              >
                                -
                              </button>
                              <span
                                style={{
                                  width: '24px',
                                  textAlign: 'center',
                                  fontWeight: 600,
                                  fontSize: '0.9rem'
                                }}
                              >
                                {getItemQty(item)}
                              </span>
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
                                disabled={updatingItemId === item.id}
                                aria-label="Increase quantity"
                              >
                                +
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
