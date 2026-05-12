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
  const [pdfExporting, setPdfExporting] = useState(false);
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

  const buildCookingSheetRows = useCallback(() => {
    const totals = new Map<string, number>();
    for (const entry of edits) {
      for (const item of entry.items) {
        if (item.quantity > 0) {
          totals.set(item.name, (totals.get(item.name) ?? 0) + item.quantity);
        }
      }
    }
    return Array.from(totals.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([name, qty]) => ({ Item: name, 'Total Qty': qty }));
  }, [edits]);

  const exportToExcel = useCallback(async () => {
    const XLSX = await import('xlsx');
    const wb = XLSX.utils.book_new();

    const rows = buildExportRows();
    const ws = XLSX.utils.json_to_sheet(rows);
    ws['!cols'] = [{ wch: 28 }, { wch: 32 }, { wch: 8 }, { wch: 10 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Meal Plan Edits');

    const cookingRows = buildCookingSheetRows();
    const ws2 = XLSX.utils.json_to_sheet(cookingRows);
    ws2['!cols'] = [{ wch: 36 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws2, 'Cooking Sheet');

    XLSX.writeFile(wb, `meal-plan-edits-${selectedDate}.xlsx`);
  }, [buildExportRows, buildCookingSheetRows, selectedDate]);

  const exportToPdf = useCallback(async () => {
    setPdfExporting(true);
    try {
    const { jsPDF } = await import('jspdf');
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 14;
    const bottom = pageH - 16;
    let y = 18;

    /** Inset client panel stroke from page margin */
    const boxHInset = 3.5;
    const boxLeft = margin + boxHInset;
    const boxW = pageW - 2 * margin - 2 * boxHInset;
    /** Padding inside the stroke before titles / table / totals */
    const boxInnerPadX = 4;
    const boxInnerPadYTop = 4.5;
    const boxInnerPadYBottom = 4.5;
    const contentLeft = boxLeft + boxInnerPadX;
    const contentRight = boxLeft + boxW - boxInnerPadX;
    const itemX = contentLeft;
    const qtyX = margin + 118;
    const mealsX = margin + 142;
    const itemColW = qtyX - itemX - 6;
    const fontBody = 9;
    /** Baseline step between wrapped lines (9pt Helvetica needs ~≥5.2mm to avoid overlap). */
    const lineHeight = 5.8;
    const rowPadTop = 4;
    const rowPadBottom = 4;
    const gapAfterRow = 2;
    const gapBetweenClients = 9;
    /** Section title + ITEM/QTY/MEALS sub-header + rule */
    const sectionHeaderH = 14;
    const totalLineH = 6.5;

    const clientHeading = (entry: MealPlanEditEntry) => {
      const dep =
        entry.foodDependentNames.length > 0
          ? ` (${entry.foodDependentNames.join(', ')})`
          : '';
      return `${entry.clientName}${dep}`;
    };

    const strokeClientBox = (top: number, bottomY: number) => {
      if (bottomY - top < 4) return;
      doc.setDrawColor(135, 138, 148);
      doc.setLineWidth(0.35);
      doc.rect(boxLeft, top, boxW, bottomY - top, 'S');
    };

    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('Meal Plan Edits', margin, y);
    y += 7;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(selectedDate ? formatDateLong(selectedDate) : '', margin, y);
    doc.text(`${edits.length} client${edits.length !== 1 ? 's' : ''} changed`, pageW - margin, y, { align: 'right' });
    y += 10;

    const drawClientSectionHeader = (entry: MealPlanEditEntry) => {
      const title = clientHeading(entry);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'bold');
      doc.text(title.slice(0, 80), contentLeft, y);
      y += 5;
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.text('ITEM', itemX, y);
      doc.text('QTY', qtyX, y);
      doc.text('MEALS', mealsX, y);
      y += 1;
      doc.setDrawColor(200);
      doc.line(contentLeft, y, contentRight, y);
      y += 4;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(fontBody);
    };

    const measureClientBlockHeight = (
      rows: { Item: string; Qty: number | string; Meals: number | string }[],
    ) => {
      doc.setFontSize(fontBody);
      doc.setFont('helvetica', 'normal');
      let h = boxInnerPadYTop + sectionHeaderH;
      for (const row of rows) {
        const lines = doc.splitTextToSize(String(row.Item), itemColW);
        const textSpan = (lines.length - 1) * lineHeight;
        h += textSpan + rowPadBottom + gapAfterRow;
      }
      h += totalLineH + boxInnerPadYBottom;
      return h;
    };

    let isFirstClient = true;

    for (const entry of edits) {
      if (!isFirstClient) {
        y += gapBetweenClients;
      }
      isFirstClient = false;

      const visibleItems = entry.items.filter((i) => i.quantity > 0);
      const rows: { Item: string; Qty: number | string; Meals: number | string }[] =
        visibleItems.length === 0
          ? [{ Item: '(no items)', Qty: 0, Meals: '—' }]
          : visibleItems.map((item) => ({
              Item: item.name,
              Qty: item.quantity,
              Meals: item.value != null ? item.quantity * item.value : '—',
            }));

      const blockHeight = measureClientBlockHeight(rows);
      if (y + blockHeight > bottom) {
        doc.addPage();
        y = 18;
      }

      const boxSegTop = y;
      y += boxInnerPadYTop;
      drawClientSectionHeader(entry);

      let rowStripe = 0;
      for (const row of rows) {
        doc.setFontSize(fontBody);
        doc.setFont('helvetica', 'normal');
        const lines = doc.splitTextToSize(String(row.Item), itemColW);
        const textSpan = (lines.length - 1) * lineHeight;

        const rowVisualBottom = y + textSpan + rowPadBottom;

        const alt = rowStripe % 2 === 1;
        rowStripe += 1;
        const bandTop = y - rowPadTop;
        const bandH = rowPadTop + textSpan + rowPadBottom;
        doc.setFillColor(alt ? 236 : 255, alt ? 237 : 255, alt ? 239 : 255);
        doc.rect(contentLeft, bandTop, contentRight - contentLeft, bandH, 'F');
        doc.setTextColor(0, 0, 0);

        for (let li = 0; li < lines.length; li++) {
          doc.text(lines[li], itemX, y + li * lineHeight);
        }

        const qtyBaseline =
          lines.length > 1 ? y + textSpan / 2 : y;
        doc.text(String(row.Qty), qtyX, qtyBaseline);
        doc.text(String(row.Meals), mealsX, qtyBaseline);

        y = rowVisualBottom + gapAfterRow;
      }

      const totalMeals = visibleItems.reduce(
        (sum, i) => sum + Number(i.quantity) * Number(i.value ?? 0),
        0,
      );
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.text(`Total meals: ${totalMeals}`, itemX, y + 4);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(fontBody);
      y += totalLineH;
      strokeClientBox(boxSegTop, y + boxInnerPadYBottom);
      y += boxInnerPadYBottom;
    }

    doc.save(`meal-plan-edits-${selectedDate}.pdf`);
    } catch (err) {
      console.error('Meal plan edits PDF export failed:', err);
    } finally {
      setPdfExporting(false);
    }
  }, [selectedDate, edits]);

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
                    <button
                      type="button"
                      className={styles.exportBtn}
                      onClick={exportToPdf}
                      disabled={pdfExporting}
                      title={pdfExporting ? 'Generating PDF…' : 'Export to PDF'}
                      aria-busy={pdfExporting}
                    >
                      {pdfExporting ? (
                        <Loader2 size={16} className={styles.spinner} aria-hidden />
                      ) : (
                        <FileText size={16} aria-hidden />
                      )}
                      {pdfExporting ? 'Generating…' : 'PDF'}
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
                          {entry.foodDependentNames.length > 0 ? (
                            <span className={styles.dependentsSuffix}>
                              {' '}
                              ({entry.foodDependentNames.join(', ')})
                            </span>
                          ) : null}
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
