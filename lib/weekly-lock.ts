/**
 * Weekly Locking Logic (Authoritative Implementation)
 * 
 * Rules:
 * 1. Active Week (Sunday-Saturday containing current date) is ALWAYS locked.
 * 2. Cutoff determines if the NEXT week is locked.
 * 3. Cutoff applies to the occurrence of the cutoff day/time in the week BEFORE the next week (i.e., within the active week).
 */

import { AppSettings } from './types';

/**
 * Get the start of a week (Sunday at 12:00 AM) for a given date
 */
export function getWeekStart(date: Date): Date {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);

    // Get day of week (0 = Sunday, 6 = Saturday)
    const day = d.getDay();

    // Calculate days to subtract to get to Sunday
    const daysToSunday = day === 0 ? 0 : day;

    d.setDate(d.getDate() - daysToSunday);
    return d;
}

/**
 * Get the end of a week (Saturday at 11:59:59.999 PM) for a given date
 */
export function getWeekEnd(date: Date): Date {
    const weekStart = getWeekStart(date);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    weekEnd.setHours(23, 59, 59, 999);
    return weekEnd;
}

/**
 * Check if a date falls within a specific week (inclusive)
 */
export function isDateInWeek(date: Date, weekStart: Date): boolean {
    const weekEnd = getWeekEnd(weekStart);
    return date >= weekStart && date <= weekEnd;
}

/**
 * Get the cutoff datetime for a specific effective week.
 * The cutoff is the designated day/time in the week PRIOR to the effective week.
 */
function getCutoffForEffectiveWeek(settings: AppSettings, effectiveWeekStart: Date): Date {
    // The cutoff is in the week BEFORE the effective week
    // So if effective week starts Sunday Jan 11, the cutoff is in the week of Jan 4-10.
    const weekBeforeStart = new Date(effectiveWeekStart);
    weekBeforeStart.setDate(effectiveWeekStart.getDate() - 7);

    const cutoffDayName = settings.weeklyCutoffDay || 'Friday';
    const cutoffTimeStr = settings.weeklyCutoffTime || '12:00'; // Default to noon as per example if missing
    const [cutoffHours, cutoffMinutes] = cutoffTimeStr.split(':').map(Number);

    const dayNameToNumber: { [key: string]: number } = {
        'Sunday': 0, 'Monday': 1, 'Tuesday': 2, 'Wednesday': 3,
        'Thursday': 4, 'Friday': 5, 'Saturday': 6
    };

    const cutoffDayNumber = dayNameToNumber[cutoffDayName] ?? 5; // Default Friday

    // Calculate the actual date of the cutoff
    const cutoffDate = new Date(weekBeforeStart);
    // Move to the correct day of that week
    // weekBeforeStart is Sunday. Add offset.
    cutoffDate.setDate(weekBeforeStart.getDate() + cutoffDayNumber);
    cutoffDate.setHours(cutoffHours, cutoffMinutes, 0, 0);

    return cutoffDate;
}

/**
 * Check if a delivery date is locked.
 * 
 * Logic:
 * 1. If date is in the past: LOCKED.
 * 2. If date is in the Active Week (current week): LOCKED.
 * 3. If date is in the Next Week (Active Week + 1):
 *    - Check against Cutoff. 
 *    - Cutoff for Next Week is simply the configured day/time in the Active Week.
 *    - If Current Time > Cutoff: LOCKED.
 *    - Else: OPEN.
 * 4. If date is > Next Week (Active Week + 2 or more): OPEN.
 */
export function isDeliveryDateLocked(
    deliveryDate: Date,
    settings: AppSettings,
    currentTime: Date = new Date()
): boolean {
    const activeWeekStart = getWeekStart(currentTime);
    const activeWeekEnd = getWeekEnd(currentTime);

    // 1. Check if date is in the past (before active week start)
    if (deliveryDate < activeWeekStart) {
        return true;
    }

    // 2. Check if date is in the Active Week
    if (deliveryDate <= activeWeekEnd) {
        return true; // Active week is ALWAYS locked
    }

    const nextWeekStart = new Date(activeWeekStart);
    nextWeekStart.setDate(activeWeekStart.getDate() + 7);

    // Check if delivery date is in the "Next Week" (Active Week + 1)
    if (isDateInWeek(deliveryDate, nextWeekStart)) {
        // 3. Check Cutoff for this Next Week
        // The cutoff for Next Week occurs in the Active Week.
        const cutoff = getCutoffForEffectiveWeek(settings, nextWeekStart);

        // If current time is AFTER cutoff, then Next Week is locked.
        if (currentTime > cutoff) {
            return true;
        }
        return false;
    }

    // 4. If date is further in future (Active Week + 2 or more)
    // It is open.
    return false;
}

/**
 * Check if ANY delivery date in a set is locked
 */
export function areAnyDeliveriesLocked(
    deliveryDates: Date[],
    settings: AppSettings,
    currentTime: Date = new Date()
): boolean {
    for (const date of deliveryDates) {
        if (isDeliveryDateLocked(date, settings, currentTime)) {
            return true;
        }
    }
    return false;
}

/**
 * Calculate the earliest effective date (always a Sunday).
 * 
 * Logic:
 * 1. Determine Active Week.
 * 2. Determine Next Week (Active + 1).
 * 3. Check Cutoff for Next Week.
 * 4. If Current Time <= Cutoff:
 *    - Changes can take effect in Next Week.
 *    - Return Next Week Start.
 * 5. If Current Time > Cutoff:
 *    - Next Week is locked.
 *    - Changes take effect in Week After Next (Active + 2).
 *    - Return (Next Week Start + 7 days).
 */
export function getEarliestEffectiveDate(
    settings: AppSettings,
    currentTime: Date = new Date()
): Date {
    const activeWeekStart = getWeekStart(currentTime);
    const nextWeekStart = new Date(activeWeekStart);
    nextWeekStart.setDate(activeWeekStart.getDate() + 7);

    const cutoffForNextWeek = getCutoffForEffectiveWeek(settings, nextWeekStart);

    if (currentTime <= cutoffForNextWeek) {
        return nextWeekStart;
    } else {
        const weekAfterNextStart = new Date(nextWeekStart);
        weekAfterNextStart.setDate(nextWeekStart.getDate() + 7);
        return weekAfterNextStart;
    }
}

/**
 * Get the locked week description for display.
 * This is slightly nuanced now because "Locked Week" could mean just Active Week
 * OR Active Week + Next Week depending on cutoff.
 */
export function getLockedWeekDescription(
    settings: AppSettings,
    currentTime: Date = new Date()
): string | null {
    const activeWeekStart = getWeekStart(currentTime);
    const activeWeekEnd = getWeekEnd(currentTime);

    const nextWeekStart = new Date(activeWeekStart);
    nextWeekStart.setDate(activeWeekStart.getDate() + 7);
    const nextWeekEnd = getWeekEnd(nextWeekStart);

    const cutoffForNextWeek = getCutoffForEffectiveWeek(settings, nextWeekStart);

    let lockedEnd = activeWeekEnd;

    // If we passed the cutoff, then next week is ALSO locked
    if (currentTime > cutoffForNextWeek) {
        lockedEnd = nextWeekEnd;
    }

    const formatDate = (date: Date) => {
        return date.toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric'
        });
    };

    return `${formatDate(activeWeekStart)} - ${formatDate(lockedEnd)}`;
}
