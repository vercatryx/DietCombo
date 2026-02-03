'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { CalendarDays, UtensilsCrossed } from 'lucide-react';
import {
  getSavedMealPlanDatesWithItemsFromOrders,
  updateMealPlannerOrderItemQuantity,
  type MealPlannerOrderResult,
  type MealPlannerOrderDisplayItem
} from '@/lib/actions';
import styles from './SavedMealPlanMonth.module.css';
import clientProfileStyles from './ClientProfile.module.css';

function formatDateLabel(iso: string): string {
  if (!iso || typeof iso !== 'string') return iso || '—';
  const normalized = iso.trim().slice(0, 10);
  const d = new Date(normalized + 'T12:00:00');
  if (Number.isNaN(d.getTime())) return normalized || '—';
  const month = d.toLocaleDateString('en-US', { month: 'short' });
  const day = d.getDate();
  const weekday = d.toLocaleDateString('en-US', { weekday: 'short' });
  return `${month} ${day} (${weekday})`;
}

function isToday(iso: string): boolean {
  const today = new Date();
  const y = today.getFullYear();
  const m = today.getMonth();
  const d = today.getDate();
  const [yy, mm, dd] = iso.split('-').map(Number);
  return yy === y && mm === m + 1 && dd === d;
}

function getTodayIso(): string {
  const t = new Date();
  const y = t.getFullYear();
  const m = String(t.getMonth() + 1).padStart(2, '0');
  const d = String(t.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export interface SavedMealPlanMonthProps {
  /** Current client ID; when null or 'new', no data is loaded. */
  clientId: string | null;
}

export function SavedMealPlanMonth({ clientId }: SavedMealPlanMonthProps) {
  const [orders, setOrders] = useState<MealPlannerOrderResult[]>([]);
  const [loadingDates, setLoadingDates] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [updatingItemId, setUpdatingItemId] = useState<string | null>(null);
  const fetchIdRef = useRef(0);

  const effectiveClientId = clientId && clientId !== 'new' ? clientId : null;

  // Load meal plan data when the dialog is opened for a client. Always refetch when the client
  // is set so the list of dates with meal plans is always up to date (e.g. after adding a plan
  // elsewhere and reopening the dialog).
  useEffect(() => {
    if (!effectiveClientId) {
      setOrders([]);
      setSelectedDate(null);
      setLoadingDates(false);
      return;
    }
    setLoadingDates(true);
    const thisFetchId = fetchIdRef.current + 1;
    fetchIdRef.current = thisFetchId;

    getSavedMealPlanDatesWithItemsFromOrders(effectiveClientId)
      .then((list) => {
        if (fetchIdRef.current !== thisFetchId) return;
        setOrders(list);
        const today = getTodayIso();
        const future = list.filter((o) => (o.scheduledDeliveryDate || '') >= today);
        const sorted = [...future].sort((a, b) => (a.scheduledDeliveryDate || '').localeCompare(b.scheduledDeliveryDate || ''));
        const firstDate = sorted.length > 0 ? sorted[0].scheduledDeliveryDate : (list[0]?.scheduledDeliveryDate ?? null);
        setSelectedDate(firstDate);
      })
      .catch((err) => {
        if (fetchIdRef.current !== thisFetchId) return;
        console.error('[SavedMealPlanMonth] Error loading meal planner orders:', err);
        setOrders([]);
      })
      .finally(() => {
        if (fetchIdRef.current === thisFetchId) setLoadingDates(false);
      });
  }, [effectiveClientId]);

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
    if (!effectiveClientId || !selectedDate || !selectedOrder) return;
    const currentQty = getItemQty(item);
    const newQty = Math.max(1, currentQty + delta);
    if (newQty === currentQty) return;
    await setQuantityDirect(item, newQty);
  }

  async function setQuantityDirect(item: MealPlannerOrderDisplayItem, newQty: number) {
    if (!effectiveClientId || !selectedDate || !selectedOrder) return;
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

      {!effectiveClientId ? (
        <div className={styles.emptyState}>
          <CalendarDays size={32} />
          <p>Save the client first to see saved meal plans.</p>
        </div>
      ) : loadingDates ? (
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
