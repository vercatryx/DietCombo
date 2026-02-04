/**
 * App-wide timezone handling.
 * All order creation, delivery dates, and display use Eastern time (America/New_York)
 * so that server UTC (e.g. on Vercel) does not shift "today" or delivery days.
 */

export const APP_TIMEZONE = 'America/New_York';

/**
 * Current date in the app timezone (Eastern) as YYYY-MM-DD.
 * Use this whenever you need "today" for business logic (cutoffs, next delivery day, etc.).
 */
export function getTodayInAppTz(now: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(now);
  const year = parts.find((p) => p.type === 'year')?.value ?? '';
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  return `${year}-${month}-${day}`;
}

/**
 * Returns a Date set to midnight UTC on "today" in Eastern.
 * Use this as the reference date for getNextOccurrence / getNextDeliveryDateForDay
 * so that "today" and day-of-week math use Eastern, not server (UTC) time.
 * On a UTC server, this keeps calendar day and weekday correct.
 */
export function getTodayDateInAppTzAsReference(now: Date = new Date()): Date {
  const todayStr = getTodayInAppTz(now);
  return new Date(`${todayStr}T00:00:00.000Z`);
}

/**
 * Format options for displaying dates in the app timezone.
 * Use for delivery dates, created dates, etc., so users see Eastern time.
 */
export const APP_DATE_FORMAT_OPTIONS: Intl.DateTimeFormatOptions = {
  timeZone: APP_TIMEZONE,
  year: 'numeric',
  month: 'short',
  day: 'numeric',
};

export const APP_DATE_ONLY_OPTIONS: Intl.DateTimeFormatOptions = {
  timeZone: APP_TIMEZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
};

/**
 * Format a date (Date or ISO string) for display in the app timezone (Eastern).
 * Use for order delivery dates, billing dates, etc.
 */
export function formatInAppTz(
  date: Date | string,
  options: Intl.DateTimeFormatOptions = APP_DATE_ONLY_OPTIONS
): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { ...APP_DATE_ONLY_OPTIONS, ...options });
}

/**
 * Format a datetime for display in the app timezone (Eastern).
 */
export function formatDateTimeInAppTz(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
