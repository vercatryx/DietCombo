/**
 * Centralized Order Date Calculation Utilities
 * 
 * This file contains ALL order date assignment logic:
 * - Next delivery dates (first occurrence)
 * - Scheduled delivery dates
 * - Take effect dates (using weekly locking)
 * - Multi-vendor date calculations
 * 
 * IMPORTANT: All date calculations for orders should use functions from this file.
 */

import { Vendor, AppSettings } from './types';
import { getEarliestEffectiveDate } from './weekly-lock';

/**
 * Day name to day number mapping (consistent across all date calculations)
 */
export const DAY_NAME_TO_NUMBER: { [key: string]: number } = {
    'Sunday': 0,
    'Monday': 1,
    'Tuesday': 2,
    'Wednesday': 3,
    'Thursday': 4,
    'Friday': 5,
    'Saturday': 6
};

/**
 * Get day number from day name (0 = Sunday, 6 = Saturday)
 */
export function getDayNumber(dayName: string): number | undefined {
    return DAY_NAME_TO_NUMBER[dayName];
}

/**
 * Get all delivery day numbers for a vendor
 */
function getVendorDeliveryDayNumbers(vendor: Vendor | { deliveryDays?: string[] }): number[] {
    const deliveryDays = 'deliveryDays' in vendor ? vendor.deliveryDays : (vendor as any).delivery_days;
    if (!deliveryDays || deliveryDays.length === 0) {
        return [];
    }

    return deliveryDays
        .map((day: string) => DAY_NAME_TO_NUMBER[day])
        .filter((num: number | undefined): num is number => num !== undefined);
}

/**
 * Calculate the next delivery date (first occurrence) for a vendor.
 * Returns the next upcoming delivery date based on the vendor's delivery days.
 * 
 * @param vendorId - The vendor ID
 * @param vendors - Array of all vendors
 * @param referenceDate - Optional reference date (defaults to today)
 * @returns Date object for the next delivery date, or null if vendor has no delivery days
 */
export function getNextDeliveryDate(
    vendorId: string,
    vendors: Vendor[],
    referenceDate: Date = new Date()
): Date | null {
    if (!vendorId) return null;

    const vendor = vendors.find(v => v.id === vendorId);
    if (!vendor) return null;

    const deliveryDayNumbers = getVendorDeliveryDayNumbers(vendor);
    if (deliveryDayNumbers.length === 0) return null;

    const today = new Date(referenceDate);
    today.setHours(0, 0, 0, 0);

    // Find the first occurrence (next delivery day, starting from today)
    // If a cutoff is defined, ensure we are outside the cutoff window
    // Start checking from 0 (today) up to 21 days (3 weeks) to be safe
    for (let i = 0; i <= 21; i++) {
        const checkDate = new Date(today);
        checkDate.setDate(today.getDate() + i);

        // If today, check if we passed cutoff? 
        // Logic: (DeliveryDate - Now) > CutoffHours
        // DeliveryDate is start of day (00:00)? Or end of day?
        // Typically delivery is during the day. Let's assume end of previous day or start of current day?
        // Let's assume strict cutoff: Now + CutoffHours < DeliveryDateEnd (23:59:59)
        // Or simpler: Now + CutoffHours < DeliveryDate (00:00) makes it strict "before the day starts"
        // Let's use: DeliveryDate items cutoff at X hours before 00:00 of that day?
        // Usually "48 hour cutoff" means 48 hours before the delivery event.
        // Let's assume delivery is at 8am or something? Or just use the date object (00:00).

        // Revised logic:
        // We want to find a date D such that Now + CutoffHours < D (where D is set to some time, e.g. 23:59 or something)
        // If cutoff is 48 hours, and delivery is Wednesday.
        // If it's Monday 10am. 48h later is Wednesday 10am. So Wednesday delivery is OK (assuming delivery is later than 10am).
        // If it's Tuesday 10am. 48h later is Thursday 10am. Wednesday is TOO SOON.

        // Let's set the "delivery cutoff time" to be the end of the day (23:59:59) for maximum leniency, 
        // OR better: treat the delivery date as 00:00 local time.
        // If Now + CutoffHours > DeliveryDate(00:00), then it's too late.

        // Example: Cutoff 48h. Delivery Wednesday 00:00.
        // Must order by Monday 00:00.
        // If Now is Monday 01:00. Now+48 = Wednesday 01:00. > Wednesday 00:00. Too late. Correct.

        const cutoffHours = vendor.cutoffHours ?? 0;
        const cutoffMs = cutoffHours * 60 * 60 * 1000;
        const now = new Date();
        const minimumDate = new Date(now.getTime() + cutoffMs);

        // Check if this date is a valid delivery day
        if (deliveryDayNumbers.includes(checkDate.getDay())) {
            // Check cutoff
            // Compare checkDate (which is 00:00 local) with minimumDate
            // Note: checkDate is already set to 00:00 of the target day.

            // However, verify timezone handling?
            // "today" was created from referenceDate (default new Date()).
            // checkDate is 00:00 local time.

            // Let's compare timestamps.
            // If checkDate (00:00) is AFTER minimumDate, it's valid.
            // Wait, if cutoff is 0 (immediate), minimumDate is Now.
            // If checkDate is Today (00:00) and Now is Today (10:00).
            // checkDate < minimumDate. So Today is skipped?
            // That implies same-day delivery is impossible if we use strictly 00:00.
            // If cutoff is 0, we usually allow same day if it's "not too late"? 
            // Or maybe we say Cutoff applies to the START of the day.

            // For now, let's stick to the 00:00 rule.
            // If cutoff is 0, checkDate (Today 00:00) < minimumDate (Today 10:00). So Today is invalid.
            // This effectively disables same-day orders unless we adjust checkDate to end of day?
            // Use 23:59:59 for the checkDate comparison?
            // If I order at 10am for Today. IDK if that's allowed.
            // Let's assume standard "Order ahead" model.
            // If cutoff is 0, maybe we allow today.

            // Special case: if cutoffHours is 0, allow today even if passed 00:00?
            // Let's use a "Grace Period" or assume delivery is at end of day (23:59).
            // Let's compare against End of Day for the Delivery Day.
            const deliveryDeadline = new Date(checkDate);
            deliveryDeadline.setHours(23, 59, 59, 999);

            if (deliveryDeadline.getTime() > minimumDate.getTime()) {
                return checkDate;
            }
        }
    }
    return null;
}

/**
 * Calculate the next delivery date for a specific day of week.
 * Returns the next occurrence of the specified day.
 * 
 * @param deliveryDay - Day name (e.g., "Monday", "Tuesday")
 * @param vendors - Array of all vendors (for validation if vendorId is provided)
 * @param vendorId - Optional vendor ID to validate the vendor delivers on this day
 * @param referenceDate - Optional reference date (defaults to today)
 * @param currentTime - Optional current time for cutoff checks (defaults to referenceDate or new Date())
 * @returns Date object for the next occurrence of the delivery day, or null if invalid
 */
export function getNextDeliveryDateForDay(
    deliveryDay: string,
    vendors: Vendor[],
    vendorId?: string,
    referenceDate: Date = new Date(),
    currentTime?: Date
): Date | null {
    if (!deliveryDay) return null;

    const targetDayNumber = DAY_NAME_TO_NUMBER[deliveryDay];
    if (targetDayNumber === undefined) return null;

    // If vendorId is provided, verify the vendor delivers on this day
    if (vendorId) {
        const vendor = vendors.find(v => v.id === vendorId);
        if (!vendor) return null;
        const deliveryDays = 'deliveryDays' in vendor ? vendor.deliveryDays : (vendor as any).delivery_days;
        if (!deliveryDays || !deliveryDays.includes(deliveryDay)) {
            return null;
        }
    }

    const today = new Date(referenceDate);
    today.setHours(0, 0, 0, 0);

    // Find the next occurrence of this day
    // Extend search to 21 days to handle skipped weeks due to cutoff
    for (let i = 0; i <= 21; i++) {
        const checkDate = new Date(today);
        checkDate.setDate(today.getDate() + i);
        if (checkDate.getDay() === targetDayNumber) {

            // Check cutoff if vendor info is available
            if (vendorId) {
                const vendor = vendors.find(v => v.id === vendorId);
                if (vendor) {
                    const cutoffHours = vendor.cutoffHours ?? 0;
                    const cutoffMs = cutoffHours * 60 * 60 * 1000;
                    const now = currentTime || referenceDate || new Date();
                    const minimumDate = new Date(now.getTime() + cutoffMs);

                    // Compare against end of delivery day
                    const deliveryDeadline = new Date(checkDate);
                    deliveryDeadline.setHours(23, 59, 59, 999);

                    if (deliveryDeadline.getTime() > minimumDate.getTime()) {
                        return checkDate;
                    } else {
                        // Cutoff passed, look for next week
                        continue;
                    }
                }
            }

            // If no vendor validation needed or passed, return
            return checkDate;
        }
    }

    return null;
}

/**
 * Calculate the take effect date (second occurrence) for a vendor.
 * DEPRECATED: This uses the old "second occurrence" logic. 
 * Use getEarliestEffectiveDate() instead, which respects weekly locking.
 * 
 * @param vendorId - The vendor ID
 * @param vendors - Array of all vendors
 * @param referenceDate - Optional reference date (defaults to today)
 * @returns Date object for the second occurrence delivery date, or null
 */
export function getTakeEffectDateLegacy(
    vendorId: string,
    vendors: Vendor[],
    referenceDate: Date = new Date()
): Date | null {
    if (!vendorId) return null;

    const vendor = vendors.find(v => v.id === vendorId);
    if (!vendor) return null;

    const deliveryDayNumbers = getVendorDeliveryDayNumbers(vendor);
    if (deliveryDayNumbers.length === 0) return null;

    const today = new Date(referenceDate);
    today.setHours(0, 0, 0, 0);

    // Find the second occurrence (next next delivery day, starting from tomorrow)
    let foundCount = 0;
    for (let i = 1; i <= 21; i++) {
        const checkDate = new Date(today);
        checkDate.setDate(today.getDate() + i);
        const dayOfWeek = checkDate.getDay();

        if (deliveryDayNumbers.includes(dayOfWeek)) {
            foundCount++;
            if (foundCount === 2) {
                return checkDate;
            }
        }
    }

    return null;
}

/**
 * Calculate the take effect date for a specific delivery day (second occurrence).
 * DEPRECATED: This uses the old "second occurrence" logic.
 * Use getEarliestEffectiveDate() instead, which respects weekly locking.
 * 
 * @param deliveryDay - Day name (e.g., "Monday", "Tuesday")
 * @param vendors - Array of all vendors
 * @param vendorId - Optional vendor ID to validate
 * @param referenceDate - Optional reference date (defaults to today)
 * @returns Date object for the second occurrence, or null
 */
export function getTakeEffectDateForDayLegacy(
    deliveryDay: string,
    vendors: Vendor[],
    vendorId?: string,
    referenceDate: Date = new Date()
): Date | null {
    if (!deliveryDay) return null;

    const targetDayNumber = DAY_NAME_TO_NUMBER[deliveryDay];
    if (targetDayNumber === undefined) return null;

    // If vendorId is provided, verify the vendor delivers on this day
    if (vendorId) {
        const vendor = vendors.find(v => v.id === vendorId);
        if (!vendor) return null;
        const deliveryDays = 'deliveryDays' in vendor ? vendor.deliveryDays : (vendor as any).delivery_days;
        if (!deliveryDays || !deliveryDays.includes(deliveryDay)) {
            return null;
        }
    }

    const today = new Date(referenceDate);
    today.setHours(0, 0, 0, 0);

    // Find the second occurrence (starting from tomorrow)
    let foundCount = 0;
    for (let i = 1; i <= 21; i++) {
        const checkDate = new Date(today);
        checkDate.setDate(today.getDate() + i);
        if (checkDate.getDay() === targetDayNumber) {
            foundCount++;
            if (foundCount === 2) {
                return checkDate;
            }
        }
    }

    return null;
}

/**
 * Get the earliest take effect date using weekly locking logic.
 * This is the PREFERRED method - always returns a Sunday and respects weekly cutoff rules.
 * 
 * @param settings - App settings containing cutoff configuration
 * @param referenceDate - Optional reference date (defaults to current time)
 * @returns Date object for the earliest effective date (always a Sunday), or null if settings are invalid
 */
export function getTakeEffectDate(
    settings: AppSettings,
    referenceDate: Date = new Date()
): Date | null {
    if (!settings) return null;
    return getEarliestEffectiveDate(settings, referenceDate);
}

/**
 * Get the earliest delivery date from multiple vendors.
 * Useful for Food orders with multiple vendors.
 * 
 * @param vendorIds - Array of vendor IDs
 * @param vendors - Array of all vendors
 * @param referenceDate - Optional reference date (defaults to today)
 * @returns The earliest delivery date across all vendors, or null if none found
 */
export function getEarliestDeliveryDate(
    vendorIds: string[],
    vendors: Vendor[],
    referenceDate: Date = new Date()
): Date | null {
    const dates: Date[] = [];

    for (const vendorId of vendorIds) {
        const date = getNextDeliveryDate(vendorId, vendors, referenceDate);
        if (date) dates.push(date);
    }

    if (dates.length === 0) return null;
    return dates.reduce((earliest, current) => current < earliest ? current : earliest);
}

/**
 * Get all delivery dates for an order configuration.
 * Handles both single-day and multi-day order formats.
 * 
 * @param orderConfig - The order configuration
 * @param vendors - Array of all vendors
 * @param serviceType - Service type ('Food' or 'Boxes')
 * @param referenceDate - Optional reference date (defaults to today)
 * @returns Array of delivery dates
 */
export function getAllDeliveryDatesForOrder(
    orderConfig: any,
    vendors: Vendor[],
    serviceType: 'Food' | 'Boxes',
    referenceDate: Date = new Date()
): Date[] {
    const deliveryDates: Date[] = [];

    if (serviceType === 'Food') {
        if (orderConfig.deliveryDayOrders) {
            // Multi-day format: get delivery dates for each day in deliveryDayOrders
            for (const day of Object.keys(orderConfig.deliveryDayOrders)) {
                const daySelections = orderConfig.deliveryDayOrders[day].vendorSelections || [];
                for (const selection of daySelections) {
                    if (selection.vendorId) {
                        const date = getNextDeliveryDateForDay(day, vendors, selection.vendorId, referenceDate);
                        if (date) deliveryDates.push(date);
                    }
                }
            }
        } else if (orderConfig.vendorSelections) {
            // Single-day format: get next delivery date for each vendor
            for (const selection of orderConfig.vendorSelections) {
                if (selection.vendorId) {
                    const date = getNextDeliveryDate(selection.vendorId, vendors, referenceDate);
                    if (date) deliveryDates.push(date);
                }
            }
        }
    } else if (serviceType === 'Boxes' && orderConfig.vendorId) {
        const date = getNextDeliveryDate(orderConfig.vendorId, vendors, referenceDate);
        if (date) deliveryDates.push(date);
    }

    return deliveryDates;
}

/**
 * Get a formatted string representation of a delivery date.
 * 
 * @param date - The date to format
 * @returns Formatted string like "Monday, January 15, 2024"
 */
export function formatDeliveryDate(date: Date): string {
    return date.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

/**
 * Get a formatted string representation for display with day and date.
 * 
 * @param date - The date to format
 * @returns Formatted string like "Monday, Jan 15"
 */
export function formatDeliveryDateShort(date: Date): string {
    return date.toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'short',
        day: 'numeric'
    });
}

/**
 * Get the date for a specific day in the NEXT week (the week following the current one).
 * Week starts on Sunday.
 * 
 * @param deliveryDay - Day name (e.g., "Monday")
 * @param referenceDate - Optional reference date (defaults to today)
 * @returns Date object for that day in the next week, or null if day name invalid
 */
export function getDateInNextWeek(
    deliveryDay: string,
    referenceDate: Date = new Date()
): Date | null {
    const targetDayNumber = DAY_NAME_TO_NUMBER[deliveryDay];
    if (targetDayNumber === undefined) return null;

    const today = new Date(referenceDate);
    today.setHours(0, 0, 0, 0);

    // 1. Find start of CURRENT week (Sunday)
    const currentDayNum = today.getDay();
    const currentWeekStart = new Date(today);
    currentWeekStart.setDate(today.getDate() - currentDayNum);

    // 2. Add 7 days to get start of NEXT week (Sunday)
    const nextWeekStart = new Date(currentWeekStart);
    nextWeekStart.setDate(currentWeekStart.getDate() + 7);

    // 3. Add target day number to get the specific date
    const targetDate = new Date(nextWeekStart);
    targetDate.setDate(nextWeekStart.getDate() + targetDayNumber);

    // Ensure accurate time (start of day)
    targetDate.setHours(0, 0, 0, 0);

    return targetDate;
}

/**
 * Get the immediate next occurrence of a specific day of the week.
 * Returns the date of the selected day if today is that day or earlier in the week.
 * If today is already past the selected day, returns the date of next week's occurrence.
 * Does NOT skip weeks or check cutoffs.
 * 
 * @param deliveryDay - Day name (e.g., "Monday")
 * @param referenceDate - Optional reference date (defaults to today)
 * @returns Date object for the next occurrence, or null if day name is invalid
 */
export function getNextOccurrence(
    deliveryDay: string,
    referenceDate: Date = new Date()
): Date | null {
    const targetDayNumber = DAY_NAME_TO_NUMBER[deliveryDay];
    if (targetDayNumber === undefined) return null;

    const today = new Date(referenceDate);
    today.setHours(0, 0, 0, 0);
    const todayDayNumber = today.getDay();

    // Calculate days until the target day
    let daysUntilTarget = targetDayNumber - todayDayNumber;
    
    // If the target day has already passed this week (negative), add 7 days to get next week's occurrence
    if (daysUntilTarget < 0) {
        daysUntilTarget += 7;
    }
    // If daysUntilTarget is 0, we're on the target day, return today
    // If daysUntilTarget > 0, the target day is later this week

    const targetDate = new Date(today);
    targetDate.setDate(today.getDate() + daysUntilTarget);
    targetDate.setHours(0, 0, 0, 0);

    return targetDate;
}






