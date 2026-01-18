'use client';

import { Calendar, X } from 'lucide-react';
import styles from './DateFilter.module.css';

interface DateFilterProps {
    selectedDate: string;
    onDateChange: (date: string) => void;
    onClear: () => void;
}

export function DateFilter({ selectedDate, onDateChange, onClear }: DateFilterProps) {
    return (
        <div className={styles.dateFilterContainer}>
            <div className={styles.dateFilterWrapper}>
                <Calendar size={18} className={styles.calendarIcon} />
                <input
                    type="date"
                    className={styles.dateInput}
                    value={selectedDate}
                    onChange={(e) => onDateChange(e.target.value)}
                    placeholder="Filter by date..."
                />
                {selectedDate && (
                    <button
                        className={styles.clearButton}
                        onClick={onClear}
                        title="Clear date filter"
                    >
                        <X size={16} />
                    </button>
                )}
            </div>
            {selectedDate && (
                <div className={styles.selectedDateLabel}>
                    Showing routes for: <strong>{formatDisplayDate(selectedDate)}</strong>
                </div>
            )}
        </div>
    );
}

function formatDisplayDate(dateStr: string): string {
    try {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        });
    } catch {
        return dateStr;
    }
}
