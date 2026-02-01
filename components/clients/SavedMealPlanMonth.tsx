'use client';

import { useState, useMemo, useEffect } from 'react';
import { CalendarDays, UtensilsCrossed, ChevronRight, Minus, Plus } from 'lucide-react';
import styles from './SavedMealPlanMonth.module.css';

const MIN_QUANTITY = 1;
const MAX_QUANTITY = 99;

/** Demo-only: mock meal plan for a given date. */
function getMockMealPlanForDate(dateStr: string): { planName: string; items: { name: string; quantity: number }[] } {
  const d = new Date(dateStr);
  const day = d.getDate();
  const plans = [
    { planName: 'Standard Weekly Plan A', items: [{ name: 'Grilled Chicken Bowl', quantity: 2 }, { name: 'Vegetable Medley', quantity: 1 }, { name: 'Fresh Fruit Cup', quantity: 1 }] },
    { planName: 'Standard Weekly Plan B', items: [{ name: 'Turkey Wrap', quantity: 2 }, { name: 'Side Salad', quantity: 1 }, { name: 'Apple', quantity: 2 }] },
    { planName: 'Light Options Plan', items: [{ name: 'Greek Salad', quantity: 2 }, { name: 'Hummus & Crackers', quantity: 1 }, { name: 'Yogurt Parfait', quantity: 1 }] },
    { planName: 'Heartier Meals Plan', items: [{ name: 'Beef Stroganoff', quantity: 2 }, { name: 'Mashed Potatoes', quantity: 1 }, { name: 'Green Beans', quantity: 1 }] },
  ];
  const idx = day % plans.length;
  return plans[idx];
}

/** Future dates for the current month (from today through end of month). */
function getFutureDatesForMonth(): string[] {
  const out: string[] = [];
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0); // last day of current month

  const cur = new Date(today);
  while (cur <= end) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, '0');
    const d = String(cur.getDate()).padStart(2, '0');
    out.push(`${y}-${m}-${d}`);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

function formatDateLabel(iso: string): string {
  const d = new Date(iso + 'T12:00:00');
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

export function SavedMealPlanMonth() {
  const futureDates = useMemo(() => getFutureDatesForMonth(), []);
  const firstDate = futureDates[0] ?? null;
  const [selectedDate, setSelectedDate] = useState<string | null>(firstDate);
  /** Editable copy of items for the selected date (quantity can be changed). */
  const [items, setItems] = useState<{ name: string; quantity: number }[]>([]);

  const mock = selectedDate ? getMockMealPlanForDate(selectedDate) : null;
  const hasDates = futureDates.length > 0;

  // Sync editable items when selected date changes
  useEffect(() => {
    if (!selectedDate) {
      setItems([]);
      return;
    }
    const plan = getMockMealPlanForDate(selectedDate);
    setItems(plan.items.map((i) => ({ name: i.name, quantity: i.quantity })));
  }, [selectedDate]);

  const setQuantity = (index: number, quantity: number) => {
    const clamped = Math.max(MIN_QUANTITY, Math.min(MAX_QUANTITY, quantity));
    setItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, quantity: clamped } : item))
    );
  };

  return (
    <div className={styles.wrapper}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <CalendarDays className={styles.titleIcon} size={26} />
          <h4 className={styles.title}>Saved Meal Plan for the Month</h4>
          <span className={styles.demoBadge}>Demo</span>
        </div>
        <p className={styles.subtitle}>
          Future dates only. Click a date to view its meal plan and items.
        </p>
      </header>

      {hasDates ? (
        <>
          <div className={styles.datesRow}>
            {futureDates.map((d) => (
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

          {selectedDate && mock && (
            <div className={styles.detailPanel}>
              <div className={styles.detailHeader}>
                <UtensilsCrossed className={styles.detailIcon} size={22} />
                <span>{formatDateLabel(selectedDate)}</span>
                {isToday(selectedDate) && <span className={styles.todayBadge}>Today</span>}
              </div>
              <div className={styles.planName}>{mock.planName}</div>
              <ul className={styles.itemsList}>
                {items.map((item, i) => (
                  <li key={i} className={styles.itemRow}>
                    <ChevronRight className={styles.itemBullet} size={18} />
                    <span className={styles.itemName}>{item.name}</span>
                    <div className={styles.quantityControl}>
                      <button
                        type="button"
                        className={styles.qtyBtn}
                        onClick={() => setQuantity(i, item.quantity - 1)}
                        disabled={item.quantity <= MIN_QUANTITY}
                        aria-label={`Decrease quantity for ${item.name}`}
                      >
                        <Minus size={16} />
                      </button>
                      <input
                        type="number"
                        min={MIN_QUANTITY}
                        max={MAX_QUANTITY}
                        value={item.quantity}
                        onChange={(e) => {
                          const v = parseInt(e.target.value, 10);
                          if (!Number.isNaN(v)) setQuantity(i, v);
                        }}
                        className={styles.qtyInput}
                        aria-label={`Quantity for ${item.name}`}
                      />
                      <button
                        type="button"
                        className={styles.qtyBtn}
                        onClick={() => setQuantity(i, item.quantity + 1)}
                        disabled={item.quantity >= MAX_QUANTITY}
                        aria-label={`Increase quantity for ${item.name}`}
                      >
                        <Plus size={16} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      ) : (
        <div className={styles.emptyState}>
          <CalendarDays size={32} />
          <p>No future dates left this month.</p>
        </div>
      )}
    </div>
  );
}
