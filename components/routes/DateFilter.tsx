'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { Calendar, X, ChevronLeft, ChevronRight } from 'lucide-react';
import styles from './DateFilter.module.css';

interface DateFilterProps {
    selectedDate: string;
    onDateChange: (date: string) => void;
    onClear: () => void;
    /** 'orders' = show dates that have orders (Orders View); 'stops' = show dates that have stops (default) */
    datesSource?: 'stops' | 'orders';
}

export function DateFilter({ selectedDate, onDateChange, onClear, datesSource = 'stops' }: DateFilterProps) {
    const [showCalendar, setShowCalendar] = useState(false); // Hidden by default
    const [inputValue, setInputValue] = useState(selectedDate || ''); // Text input value
    const [datesWithStops, setDatesWithStops] = useState<Map<string, number>>(new Map());
    const [loadingDates, setLoadingDates] = useState(false);
    const [calendarPosition, setCalendarPosition] = useState<{ top: number; left: number } | null>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const [currentMonth, setCurrentMonth] = useState(() => {
        // Set to month of selected date, or current month if no date selected
        if (selectedDate) {
            const date = new Date(selectedDate);
            if (!isNaN(date.getTime())) {
                return new Date(date.getFullYear(), date.getMonth(), 1);
            }
        }
        const today = new Date();
        return new Date(today.getFullYear(), today.getMonth(), 1);
    });

    // Update input value when selectedDate changes externally
    useEffect(() => {
        setInputValue(selectedDate || '');
    }, [selectedDate]);

    // Update current month when selected date changes (if date is outside current view)
    useEffect(() => {
        if (selectedDate) {
            const date = new Date(selectedDate);
            if (!isNaN(date.getTime())) {
                const newMonth = new Date(date.getFullYear(), date.getMonth(), 1);
                setCurrentMonth(prevMonth => {
                    const prevMonthKey = `${prevMonth.getFullYear()}-${prevMonth.getMonth()}`;
                    const newMonthKey = `${newMonth.getFullYear()}-${newMonth.getMonth()}`;
                    // Only update if the selected date is in a different month
                    if (prevMonthKey !== newMonthKey) {
                        return newMonth;
                    }
                    return prevMonth;
                });
            }
        }
    }, [selectedDate]);

    // Fetch dates with counts: orders table for Orders View, stops for others
    useEffect(() => {
        const url = datesSource === 'orders' ? '/api/route/orders-dates' : '/api/stops/dates';
        const fetchDates = async () => {
            setLoadingDates(true);
            try {
                const response = await fetch(url, { cache: 'no-store' });
                if (response.ok) {
                    const data = await response.json();
                    const datesMap = new Map<string, number>();
                    if (data.dates && typeof data.dates === 'object') {
                        Object.entries(data.dates).forEach(([date, count]) => {
                            datesMap.set(date, count as number);
                        });
                    }
                    setDatesWithStops(datesMap);
                }
            } catch (error) {
                console.error('Error fetching dates:', error);
            } finally {
                setLoadingDates(false);
            }
        };

        fetchDates();
    }, [datesSource]);

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
        setInputValue(dateKey);
        setShowCalendar(false); // Close calendar after selection
    };

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setInputValue(value);
        
        // Validate and update if it's a valid date format (YYYY-MM-DD)
        if (value.match(/^\d{4}-\d{2}-\d{2}$/)) {
            const date = new Date(value);
            if (!isNaN(date.getTime())) {
                onDateChange(value);
            }
        }
    };

    const updateCalendarPosition = () => {
        if (wrapperRef.current) {
            const rect = wrapperRef.current.getBoundingClientRect();
            setCalendarPosition({
                top: rect.bottom + window.scrollY + 0.5 * 16, // 0.5rem in pixels
                left: rect.left + window.scrollX
            });
        }
    };

    const handleInputFocus = () => {
        updateCalendarPosition();
        setShowCalendar(true);
    };

    const handleCalendarIconClick = () => {
        if (!showCalendar) {
            updateCalendarPosition();
        }
        setShowCalendar(!showCalendar);
    };

    const handleClear = () => {
        setInputValue('');
        onClear();
        setShowCalendar(false);
    };

    // Update calendar position on scroll/resize when visible
    useEffect(() => {
        if (!showCalendar) return;

        const updatePosition = () => {
            updateCalendarPosition();
        };

        window.addEventListener('scroll', updatePosition, true);
        window.addEventListener('resize', updatePosition);

        return () => {
            window.removeEventListener('scroll', updatePosition, true);
            window.removeEventListener('resize', updatePosition);
        };
    }, [showCalendar]);

    // Close calendar when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as HTMLElement;
            const calendarElement = document.querySelector(`.${styles.calendarView}`);
            const inputElement = document.querySelector(`.${styles.dateInput}`);
            const iconElement = document.querySelector(`.${styles.calendarIcon}`);
            
            if (
                showCalendar &&
                calendarElement &&
                !calendarElement.contains(target) &&
                !inputElement?.contains(target) &&
                !iconElement?.contains(target) &&
                wrapperRef.current &&
                !wrapperRef.current.contains(target)
            ) {
                setShowCalendar(false);
            }
        };

        if (showCalendar) {
            document.addEventListener('mousedown', handleClickOutside);
            return () => {
                document.removeEventListener('mousedown', handleClickOutside);
            };
        }
    }, [showCalendar]);

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
            <div className={styles.dateFilterWrapper} ref={wrapperRef}>
                <Calendar 
                    size={18} 
                    className={styles.calendarIcon}
                    onClick={handleCalendarIconClick}
                    style={{ cursor: 'pointer' }}
                />
                <input
                    type="text"
                    className={styles.dateInput}
                    value={inputValue}
                    onChange={handleInputChange}
                    onFocus={handleInputFocus}
                    placeholder="YYYY-MM-DD or click calendar icon"
                    pattern="\d{4}-\d{2}-\d{2}"
                />
                {selectedDate && (
                    <button
                        className={styles.clearButton}
                        onClick={handleClear}
                        title="Clear date filter"
                    >
                        <X size={16} />
                    </button>
                )}

                {/* Calendar View - Floating below input */}
                {showCalendar && calendarPosition && (
                    <div 
                        className={styles.calendarView}
                        style={{
                            top: `${calendarPosition.top}px`,
                            left: `${calendarPosition.left}px`
                        }}
                    >
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
            </div>

            {selectedDate && !showCalendar && (
                <div className={styles.selectedDateLabel}>
                    Showing routes for: <strong>{formatDisplayDate(selectedDate)}</strong>
                </div>
            )}
        </div>
    );
}

/** Format YYYY-MM-DD as local calendar date (avoids UTC-midnight timezone shift). */
function formatDisplayDate(dateStr: string): string {
    try {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
        if (match) {
            const year = parseInt(match[1], 10);
            const month = parseInt(match[2], 10) - 1;
            const day = parseInt(match[3], 10);
            const date = new Date(year, month, day);
            if (!isNaN(date.getTime())) {
                return date.toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                });
            }
        }
        const date = new Date(dateStr);
        if (!isNaN(date.getTime())) {
            return date.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
            });
        }
        return dateStr;
    } catch {
        return dateStr;
    }
}
