'use client';

import { useState, useMemo, useEffect } from 'react';
import { CalendarDays, UtensilsCrossed } from 'lucide-react';
import { getMealPlannerOrders, type MealPlannerOrderResult } from '@/lib/actions';
import styles from './SavedMealPlanMonth.module.css';

/** Date range: start of current month through end of next month. */
function getDateRange(): { start: string; end: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const start = `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const endLast = new Date(y, m + 2, 0);
  const end = `${endLast.getFullYear()}-${String(endLast.getMonth() + 1).padStart(2, '0')}-${String(endLast.getDate()).padStart(2, '0')}`;
  return { start, end };
}

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

export interface SavedMealPlanMonthProps {
  /** Current client ID; when null or 'new', no data is loaded. */
  clientId: string | null;
}

export function SavedMealPlanMonth({ clientId }: SavedMealPlanMonthProps) {
  const dateRange = useMemo(() => getDateRange(), []);
  const [orders, setOrders] = useState<MealPlannerOrderResult[]>([]);
  const [loadingDates, setLoadingDates] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const effectiveClientId = clientId && clientId !== 'new' ? clientId : null;

  // Load meal planner orders (saved from client meal selections) for this client
  useEffect(() => {
    if (!effectiveClientId) {
      setOrders([]);
      setSelectedDate(null);
      return;
    }
    setLoadingDates(true);
    getMealPlannerOrders(effectiveClientId, dateRange.start, dateRange.end)
      .then((list) => {
        setOrders(list);
        setSelectedDate(null);
      })
      .catch((err) => {
        console.error('[SavedMealPlanMonth] Error loading meal planner orders:', err);
        setOrders([]);
      })
      .finally(() => setLoadingDates(false));
  }, [effectiveClientId, dateRange.start, dateRange.end]);

  const datesWithPlans = useMemo(
    () => orders.map((o) => o.scheduledDeliveryDate).filter(Boolean),
    [orders]
  );
  const selectedOrder = useMemo(
    () => (selectedDate ? orders.find((o) => o.scheduledDeliveryDate === selectedDate) : null),
    [orders, selectedDate]
  );
  const hasDates = datesWithPlans.length > 0;

  return (
    <div className={styles.wrapper}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <CalendarDays className={styles.titleIcon} size={26} />
          <h4 className={styles.title}>Saved Meal Plan for the Month</h4>
        </div>
        <p className={styles.subtitle}>
          Dates with a saved meal plan for this client. Click a date to view its items.
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
          <p>No saved meal plans in this date range.</p>
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
                          <td className={styles.itemQty}>×{item.quantity}</td>
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
