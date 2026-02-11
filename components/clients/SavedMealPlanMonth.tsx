'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { CalendarDays, UtensilsCrossed, ChevronLeft, ChevronRight, Check } from 'lucide-react';
import {
  getClientMealPlannerData,
  getAvailableMealPlanTemplateWithAllDates,
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
  const [editingQty, setEditingQty] = useState<{ itemId: string; value: string } | null>(null);
  const fetchIdRef = useRef(0);
  /** Only dates the client has edited are persisted; untouched dates stay template-only. */
  const clientEditedDatesRef = useRef<Set<string>>(new Set());

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
    applyOrdersAndSelectFirst(initialOrders, setOrders, setSelectedDate);
    setLoadingDates(false);
  }, [initialOrders]);

  // Load all available dates from default template when clientId is 'new' and no initialOrders.
  // When preloadInProgress is true, parent is fetching; don't fetch here to avoid duplicate request.
  useEffect(() => {
    if (clientId !== 'new' || preloadInProgress || (initialOrders != null && initialOrders.length > 0)) return;
    setLoadingDates(true);
    const thisFetchId = fetchIdRef.current + 1;
    fetchIdRef.current = thisFetchId;
    getAvailableMealPlanTemplateWithAllDates()
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
        getAvailableMealPlanTemplateWithAllDates()
        .then((templateList) => {
          if (fetchIdRef.current !== thisFetchId) return;
          clientEditedDatesRef.current = new Set(initialOrders.map((o) => o.scheduledDeliveryDate).filter(Boolean));
          const merged = mergeTemplateWithClient(templateList, initialOrders);
          applyOrdersAndSelectFirst(merged, setOrders, setSelectedDate);
        })
        .catch((err) => {
          if (fetchIdRef.current !== thisFetchId) return;
          applyOrdersAndSelectFirst(initialOrders, setOrders, setSelectedDate);
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
      getAvailableMealPlanTemplateWithAllDates(),
      getClientMealPlannerData(effectiveClientId)
    ])
      .then(([templateList, clientSavedList]) => {
        if (fetchIdRef.current !== thisFetchId) return;
        clientEditedDatesRef.current = new Set(clientSavedList.map((o) => o.scheduledDeliveryDate).filter(Boolean));
        const merged = mergeTemplateWithClient(templateList, clientSavedList);
        applyOrdersAndSelectFirst(merged, setOrders, setSelectedDate);
      })
      .catch((err) => {
        if (fetchIdRef.current !== thisFetchId) return;
        console.error('[SavedMealPlanMonth] Error loading meal planner data:', err);
        setOrders([]);
      })
      .finally(() => {
        if (fetchIdRef.current === thisFetchId) setLoadingDates(false);
      });
  }, [effectiveClientId, initialOrders]);

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
        <div className={styles.titleRow}>
          <CalendarDays className={styles.titleIcon} size={26} />
          <h4 className={styles.title}>Day-specific meal plan</h4>
        </div>
        <p className={styles.subtitle}>
          Different selections per delivery date. Only non-expired dates are shown. Select a date on the calendar to view or set quantities.
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
          <p>No non-expired delivery dates. Add dates in the meal planner settings or extend expiration to show them here.</p>
        </div>
      ) : (
        <>
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
                const orderForDate = dateKey ? futureOrders.find((o) => o.scheduledDeliveryDate === dateKey) : null;
                const itemCount = orderForDate?.items?.length ?? 0;
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
                    title={date && hasPlan ? `Meal plan · ${itemCount} item${itemCount !== 1 ? 's' : ''}` : !isSelectable && dateKey ? 'Expired or not configured' : undefined}
                  >
                    {date && (
                      <>
                        {hasPlan && (
                          <span className={styles.calendarDayCheck} aria-hidden>
                            <Check size={12} strokeWidth={2.5} />
                          </span>
                        )}
                        <span className={styles.calendarDayNum}>{date.getDate()}</span>
                        {hasPlan && itemCount > 0 && (
                          <span className={styles.calendarDayIndicator} aria-hidden>
                            {itemCount}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            <div className={styles.calendarLegend} aria-hidden>
              <span className={styles.calendarLegendItem}>
                <Check size={14} strokeWidth={2.5} />
                <span>Meal plan saved</span>
              </span>
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
                const expectedTotal = selectedOrder.expectedTotalMeals ?? null;
                const totalMismatch = expectedTotal != null && currentTotalMeals !== expectedTotal;

                return (
                  <>
                    {totalMismatch && (
                      <div className={styles.mealsMismatchBanner} role="alert">
                        Total meals ({currentTotalMeals}) must equal the default for this day ({expectedTotal}). Adjust quantities to match.
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
                          {selectedOrder.items.map((item) => {
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
                          })}
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
