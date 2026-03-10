'use client';

import { useState, useMemo, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { getTodayInAppTz, getCalendarDaysForMonthInAppTz } from '@/lib/timezone';
import { getMealPlanEditsByDeliveryDate, getMealPlanEditCountsByMonth, type MealPlanEditEntry } from '@/lib/actions';
import { ChevronLeft, ChevronRight, Loader2, User, CalendarDays, Check, FileSpreadsheet, FileText } from 'lucide-react';
import styles from './MealPlanEdits.module.css';
import calendarStyles from '@/components/admin/DefaultOrderTemplate.module.css';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatDateLong(dateKey: string): string {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { weekday: 'short', month: 'long', day: 'numeric', year: 'numeric' });
}

export default function MealPlanEditsPage() {
  const [calendarMonth, setCalendarMonth] = useState(() => new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [edits, setEdits] = useState<MealPlanEditEntry[]>([]);
  const [loadingEdits, setLoadingEdits] = useState(false);
  const [editCounts, setEditCounts] = useState<Record<string, number>>({});

  const year = calendarMonth.getFullYear();
  const month = calendarMonth.getMonth();
  const monthYearLabel = calendarMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  const calendarDays = useMemo(
    () => getCalendarDaysForMonthInAppTz(year, month),
    [year, month]
  );

  useEffect(() => {
    const startDate = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const endDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    getMealPlanEditCountsByMonth(startDate, endDate).then(setEditCounts);
  }, [year, month]);

  useEffect(() => {
    if (!selectedDate) {
      setEdits([]);
      return;
    }
    setLoadingEdits(true);
    getMealPlanEditsByDeliveryDate(selectedDate)
      .then(setEdits)
      .finally(() => setLoadingEdits(false));
  }, [selectedDate]);

  const buildExportRows = useCallback(() => {
    const rows: { Client: string; Item: string; Qty: number; Meals: number | string }[] = [];
    for (const entry of edits) {
      const visibleItems = entry.items.filter((i) => i.quantity > 0);
      if (visibleItems.length === 0) {
        rows.push({ Client: entry.clientName, Item: '(no items)', Qty: 0, Meals: '—' });
      } else {
        for (const item of visibleItems) {
          rows.push({
            Client: entry.clientName,
            Item: item.name,
            Qty: item.quantity,
            Meals: item.value != null ? item.quantity * item.value : '—',
          });
        }
      }
    }
    return rows;
  }, [edits]);

  const exportToExcel = useCallback(async () => {
    const XLSX = await import('xlsx');
    const rows = buildExportRows();
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{ wch: 28 }, { wch: 32 }, { wch: 8 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Meal Plan Edits');
    XLSX.writeFile(wb, `meal-plan-edits-${selectedDate}.xlsx`);
  }, [buildExportRows, selectedDate]);

  const exportToPdf = useCallback(async () => {
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 14;
    let y = 18;

    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('Meal Plan Edits', margin, y);
    y += 7;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(selectedDate ? formatDateLong(selectedDate) : '', margin, y);
    doc.text(`${edits.length} client${edits.length !== 1 ? 's' : ''} changed`, pageW - margin, y, { align: 'right' });
    y += 8;

    const colX = [margin, margin + 72, margin + 130, margin + 150];
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('CLIENT', colX[0], y);
    doc.text('ITEM', colX[1], y);
    doc.text('QTY', colX[2], y);
    doc.text('MEALS', colX[3], y);
    y += 1;
    doc.setDrawColor(200);
    doc.line(margin, y, pageW - margin, y);
    y += 4;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const rows = buildExportRows();
    for (const row of rows) {
      if (y > doc.internal.pageSize.getHeight() - 16) {
        doc.addPage();
        y = 18;
      }
      doc.text(String(row.Client).slice(0, 36), colX[0], y);
      doc.text(String(row.Item).slice(0, 30), colX[1], y);
      doc.text(String(row.Qty), colX[2], y);
      doc.text(String(row.Meals), colX[3], y);
      y += 5.5;
    }

    doc.save(`meal-plan-edits-${selectedDate}.pdf`);
  }, [buildExportRows, selectedDate, edits.length]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Meal Plan Edits</h1>
        <p className={styles.subtitle}>
          Green dates have clients who changed their meal plan from the default. Click a date to see who changed and their new order.
        </p>
      </header>

      <div className={styles.layout}>
        <section className={styles.calendarSection} aria-label="Calendar">
          <div className={calendarStyles.mealPlannerCalendar}>
            <div className={calendarStyles.calendarHeader}>
              <button
                type="button"
                className={calendarStyles.calendarNav}
                onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1))}
                aria-label="Previous month"
              >
                <ChevronLeft size={20} />
              </button>
              <span className={calendarStyles.calendarMonthYear}>{monthYearLabel}</span>
              <button
                type="button"
                className={calendarStyles.calendarNav}
                onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1))}
                aria-label="Next month"
              >
                <ChevronRight size={20} />
              </button>
            </div>
            <div className={calendarStyles.calendarWeekdays}>
              {WEEKDAY_LABELS.map((label) => (
                <div key={label} className={calendarStyles.calendarWeekday}>{label}</div>
              ))}
            </div>
            <div className={calendarStyles.calendarGrid}>
              {calendarDays.map((cell, index) => {
                const dateKey = cell ? cell.dateKey : null;
                const dayNum = cell ? cell.dayNum : null;
                const count = dateKey != null ? (editCounts[dateKey] ?? 0) : 0;
                const hasEdits = count > 0;
                const isToday = dateKey === getTodayInAppTz();
                const isSelected = dateKey === selectedDate;
                return (
                  <div
                    key={dateKey ?? `empty-${index}`}
                    className={[
                      cell ? calendarStyles.calendarDay : calendarStyles.calendarDayEmpty,
                      hasEdits && calendarStyles.calendarDayHasPlan,
                      hasEdits && styles.calendarDayHasEdits,
                      isToday && calendarStyles.calendarDayToday,
                      isSelected && styles.calendarDaySelected,
                    ].filter(Boolean).join(' ')}
                    onClick={dateKey ? () => setSelectedDate(dateKey) : undefined}
                    role={cell ? 'button' : undefined}
                    tabIndex={cell ? 0 : undefined}
                    onKeyDown={dateKey ? (e) => { if (e.key === 'Enter' || e.key === ' ') setSelectedDate(dateKey); } : undefined}
                    title={cell && hasEdits ? `${count} client${count !== 1 ? 's' : ''} changed from default` : undefined}
                  >
                    {cell && (
                      <>
                        {hasEdits && (
                          <span className={calendarStyles.calendarDayCheck} aria-hidden>
                            <Check size={12} strokeWidth={2.5} />
                          </span>
                        )}
                        <span className={calendarStyles.calendarDayNum}>{dayNum}</span>
                        {hasEdits && (
                          <span className={calendarStyles.calendarDayIndicator} aria-hidden>
                            {count} {count === 1 ? 'client' : 'clients'}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                );
              })}
            </div>
            <div className={calendarStyles.calendarLegend} aria-hidden>
              <span className={calendarStyles.calendarLegendItem}>
                <Check size={14} strokeWidth={2.5} />
                <span>Clients changed from default</span>
              </span>
            </div>
          </div>
        </section>

        <section className={styles.listSection} aria-label="Clients who changed">
          {selectedDate ? (
            <>
              <div className={styles.listHeader}>
                <h2 className={styles.listTitle}>
                  {formatDateLong(selectedDate)}
                  {!loadingEdits && edits.length > 0 && (
                    <span className={styles.listCount}>{edits.length} {edits.length === 1 ? 'client' : 'clients'} changed</span>
                  )}
                </h2>
                {!loadingEdits && edits.length > 0 && (
                  <div className={styles.exportButtons}>
                    <button type="button" className={styles.exportBtn} onClick={exportToExcel} title="Export to Excel">
                      <FileSpreadsheet size={16} />
                      Excel
                    </button>
                    <button type="button" className={styles.exportBtn} onClick={exportToPdf} title="Export to PDF">
                      <FileText size={16} />
                      PDF
                    </button>
                  </div>
                )}
              </div>
              {loadingEdits ? (
                <div className={styles.loading}>
                  <Loader2 size={24} className={styles.spinner} />
                  <span>Loading…</span>
                </div>
              ) : edits.length === 0 ? (
                <p className={styles.empty}>No clients changed their meal plan from the default for this date.</p>
              ) : (
                <ul className={styles.editList}>
                  {edits.map((entry) => (
                    <li key={entry.clientId} className={styles.editCard}>
                      <div className={styles.editCardHeader}>
                        <User size={18} aria-hidden />
                        <Link href={`/clients/${entry.clientId}`} className={styles.clientLink}>
                          {entry.clientName}
                        </Link>
                      </div>
                      {entry.items.length > 0 ? (
                        <div className={styles.editCardBody}>
                          <div className={styles.itemsTableWrap}>
                            <table className={styles.itemsTable}>
                              <thead>
                                <tr>
                                  <th>Item</th>
                                  <th className={styles.qtyCol}>Qty</th>
                                  <th className={styles.mealsCol}>Meals</th>
                                </tr>
                              </thead>
                              <tbody>
                                {entry.items.filter((item) => item.quantity > 0).map((item) => (
                                  <tr key={item.id}>
                                    <td>{item.name}</td>
                                    <td className={styles.qtyCol}>{item.quantity}</td>
                                    <td className={styles.mealsCol}>
                                      {item.value != null ? Number(item.quantity) * Number(item.value) : '—'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          <div className={styles.totalLine}>
                            Total meals: {entry.items.reduce((sum, i) => sum + (i.quantity * (i.value ?? 0)), 0)}
                          </div>
                        </div>
                      ) : (
                        <div className={styles.editCardBody}>
                          <p className={styles.empty} style={{ padding: '0.5rem 0', margin: 0 }}>
                            Client changed from default (no item details stored).
                          </p>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <div className={styles.placeholder}>
              <CalendarDays size={48} className={styles.placeholderIcon} />
              <p>Click a date on the calendar to see which clients changed their meal plan for that delivery date.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
