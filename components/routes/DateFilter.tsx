'use client';

import { useState, useEffect, useMemo } from 'react';
import { Calendar, X, ChevronLeft, ChevronRight } from 'lucide-react';
import styles from './DateFilter.module.css';

interface DateFilterProps {
    selectedDate: string;
    onDateChange: (date: string) => void;
    onClear: () => void;
}

export function DateFilter({ selectedDate, onDateChange, onClear }: DateFilterProps) {
    const [showCalendar, setShowCalendar] = useState(false);
    const [datesWithStops, setDatesWithStops] = useState<Map<string, number>>(new Map());
    const [loadingDates, setLoadingDates] = useState(false);
    const [currentMonth, setCurrentMonth] = useState(() => {
        const today = new Date();
        return new Date(today.getFullYear(), today.getMonth(), 1);
    });

    // Fetch dates with stops and their counts
    useEffect(() => {
        const fetchDatesWithStops = async () => {
            setLoadingDates(true);
            try {
                const response = await fetch('/api/stops/dates', { cache: 'no-store' });
                if (response.ok) {
                    const data = await response.json();
                    // Convert object { date: count } to Map
                    const datesMap = new Map<string, number>();
                    if (data.dates && typeof data.dates === 'object') {
                        Object.entries(data.dates).forEach(([date, count]) => {
                            datesMap.set(date, count as number);
                        });
                    }
                    setDatesWithStops(datesMap);
                }
            } catch (error) {
                console.error('Error fetching dates with stops:', error);
            } finally {
                setLoadingDates(false);
            }
        };

        fetchDatesWithStops();
    }, []);

    // Calendar view functions
    const monthYear = useMemo(() => {
        return currentMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }, [currentMonth]);

    const calendarDays = useMemo(() => {
        const year = currentMonth.getFullYear();
        const month = currentMonth.getMonth();
        
        // First day of the month
        const firstDay = new Date(year, month, 1);
        const firstDayWeekday = firstDay.getDay();
        
        // Last day of the month
        const lastDay = new Date(year, month + 1, 0);
        const lastDayDate = lastDay.getDate();
        
        const days: (Date | null)[] = [];
        
        // Add empty cells for days before the first day of the month
        for (let i = 0; i < firstDayWeekday; i++) {
            days.push(null);
        }
        
        // Add all days of the month
        for (let day = 1; day <= lastDayDate; day++) {
            days.push(new Date(year, month, day));
        }
        
        return days;
    }, [currentMonth]);

    const handlePrevMonth = () => {
        setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
    };

    const handleNextMonth = () => {
        setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));
    };

    const formatDateKey = (date: Date): string => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    const handleDateClick = (date: Date) => {
        const dateKey = formatDateKey(date);
        onDateChange(dateKey);
        setShowCalendar(false);
    };

    const isToday = (date: Date): boolean => {
        const today = new Date();
        return (
            date.getDate() === today.getDate() &&
            date.getMonth() === today.getMonth() &&
            date.getFullYear() === today.getFullYear()
        );
    };

    const isSelected = (date: Date): boolean => {
        if (!selectedDate) return false;
        return formatDateKey(date) === selectedDate;
    };

    const getStopCount = (date: Date): number => {
        const dateKey = formatDateKey(date);
        return datesWithStops.get(dateKey) || 0;
    };

    const hasStops = (date: Date): boolean => {
        return getStopCount(date) > 0;
    };

    return (
        <div className={styles.dateFilterContainer}>
            <div className={styles.dateFilterWrapper}>
                <Calendar 
                    size={18} 
                    className={styles.calendarIcon}
                    onClick={() => setShowCalendar(!showCalendar)}
                    style={{ cursor: 'pointer' }}
                    title="Toggle calendar view"
                />
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

            {/* Calendar View */}
            {showCalendar && (
                <div className={styles.calendarView}>
                    <div className={styles.calendarHeader}>
                        <button
                            className={styles.calendarNavButton}
                            onClick={handlePrevMonth}
                            title="Previous month"
                        >
                            <ChevronLeft size={18} />
                        </button>
                        <h3 className={styles.calendarMonthYear}>{monthYear}</h3>
                        <button
                            className={styles.calendarNavButton}
                            onClick={handleNextMonth}
                            title="Next month"
                        >
                            <ChevronRight size={18} />
                        </button>
                    </div>
                    <div className={styles.calendarGrid}>
                        {/* Day headers */}
                        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                            <div key={day} className={styles.calendarDayHeader}>{day}</div>
                        ))}
                        {/* Calendar days */}
                        {calendarDays.map((date, index) => {
                            if (!date) {
                                return <div key={`empty-${index}`} className={styles.calendarDayEmpty} />;
                            }
                            const dateKey = formatDateKey(date);
                            return (
                                <button
                                    key={dateKey}
                                    className={`${styles.calendarDay} ${
                                        isToday(date) ? styles.calendarDayToday : ''
                                    } ${isSelected(date) ? styles.calendarDaySelected : ''} ${
                                        hasStops(date) ? styles.calendarDayHasStops : ''
                                    }`}
                                    onClick={() => handleDateClick(date)}
                                    title={hasStops(date) ? `${getStopCount(date)} stop${getStopCount(date) !== 1 ? 's' : ''} on ${formatDisplayDate(dateKey)}` : formatDisplayDate(dateKey)}
                                >
                                    <span className={styles.calendarDayNumber}>{date.getDate()}</span>
                                    {hasStops(date) && (
                                        <span className={styles.calendarDayCount} title={`${getStopCount(date)} stop${getStopCount(date) !== 1 ? 's' : ''}`}>
                                            {getStopCount(date)}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                    {loadingDates && (
                        <div className={styles.calendarLoading}>Loading dates with stops...</div>
                    )}
                </div>
            )}

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
