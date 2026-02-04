/**
 * Week helpers for billing (Sunday–Saturday).
 * Uses app timezone (Eastern) for "today" so current week is correct regardless of server TZ.
 */
import { getTodayInAppTz } from './timezone';

/**
 * Start of week = Sunday 00:00:00 for the given date.
 */
export function getWeekStart(date: Date): Date {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    const day = d.getDay(); // 0 = Sunday
    const diff = d.getDate() - day;
    d.setDate(diff);
    return d;
}

/**
 * End of week = Saturday 23:59:59.999.
 */
export function getWeekEnd(date: Date): Date {
    const weekStart = getWeekStart(date);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);
    return weekEnd;
}

/**
 * Display string for the week, e.g. "Jan 5 - Jan 11, 2025".
 */
export function getWeekRangeString(date: Date): string {
    const weekStart = getWeekStart(date);
    const weekEnd = getWeekEnd(date);
    const startStr = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const endStr = weekEnd.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    return `${startStr} - ${endStr}`;
}

/**
 * Whether a date falls in the same week (Sunday–Saturday) as weekStart.
 */
export function isDateInWeek(date: Date, weekStart: Date): boolean {
    const dateWeekStart = getWeekStart(date);
    return dateWeekStart.getTime() === getWeekStart(weekStart).getTime();
}

/**
 * Array of week-start dates for a dropdown: weeksBack + current + weeksForward.
 * Uses Eastern "today" so the current week matches app timezone.
 */
export function getWeekOptions(weeksBack: number = 8, weeksForward: number = 2): Date[] {
    const todayStr = getTodayInAppTz();
    const today = new Date(`${todayStr}T12:00:00.000Z`);
    const currentWeekStart = getWeekStart(today);
    const options: Date[] = [];
    for (let i = weeksBack; i >= 0; i--) {
        const weekDate = new Date(currentWeekStart);
        weekDate.setDate(weekDate.getDate() - i * 7);
        options.push(weekDate);
    }
    for (let i = 1; i <= weeksForward; i++) {
        const weekDate = new Date(currentWeekStart);
        weekDate.setDate(weekDate.getDate() + i * 7);
        options.push(weekDate);
    }
    return options;
}
