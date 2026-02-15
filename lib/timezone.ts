/**
 * App-wide timezone handling.
 * EST (America/New_York) is the ONLY source of time for the project.
 * All order creation, delivery dates, meal planner calendar dates, and display use Eastern time
 * so that server UTC (e.g. on Vercel) does not shift "today" or delivery days.
 */

export const APP_TIMEZONE = 'America/New_York';

/**
 * Current date in the app timezone (Eastern) as YYYY-MM-DD.
 * Use this whenever you need "today" for business logic (cutoffs, next delivery day, etc.).
 */
export function getTodayInAppTz(now: Date = new Date()): string {
  return toDateStringInAppTz(now);
}

/**
 * Convert a Date to a calendar date string (YYYY-MM-DD) in the app timezone (EST).
 * Use this whenever you need to store or compare "calendar date" from a Date object—
 * never use date.toISOString().slice(0, 10) as that uses UTC and can shift the day in EST.
 */
export function toDateStringInAppTz(date: Date): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value ?? '';
  const month = parts.find((p) => p.type === 'month')?.value ?? '';
  const day = parts.find((p) => p.type === 'day')?.value ?? '';
  return `${year}-${month}-${day}`;
}

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
/** ISO or date-only: YYYY-MM-DD at start (avoids UTC shift when DB returns e.g. 2026-02-16T00:00:00.000Z). */
const STARTS_WITH_DATE_REGEX = /^\d{4}-\d{2}-\d{2}/;

/**
 * Get a YYYY-MM-DD calendar date key for grouping/compare.
 * DB date/timestamp columns often return ISO strings (e.g. 2026-02-16T00:00:00.000Z).
 * Parsing that as UTC and converting to Eastern shifts the day (UTC midnight = Feb 15 evening Eastern).
 * So we treat any value that starts with YYYY-MM-DD as a calendar date and use the date part only.
 */
export function toCalendarDateKeyInAppTz(value: string | null | undefined): string | null {
  if (value == null || typeof value !== 'string') return null;
  const trimmed = String(value).trim();
  if (DATE_ONLY_REGEX.test(trimmed)) return trimmed;
  if (STARTS_WITH_DATE_REGEX.test(trimmed)) return trimmed.slice(0, 10);
  try {
    return toDateStringInAppTz(new Date(value));
  } catch {
    return null;
  }
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
 * Get date parts (year, month, day) in the app timezone (EST).
 * month is 0-indexed (0 = January) to match JavaScript Date.
 */
export function getDatePartsInAppTz(now: Date = new Date()): {
  year: number;
  month: number;
  day: number;
} {
  const s = toDateStringInAppTz(now);
  const [y, m, d] = s.split('-').map(Number);
  return { year: y, month: m - 1, day: d };
}

/**
 * Get the weekday (0=Sun, 6=Sat) of a YYYY-MM-DD date in the app timezone.
 * Use when building calendar grids so alignment matches EST.
 */
export function getWeekdayOfDateInAppTz(dateStr: string): number {
  const d = new Date(dateStr + 'T12:00:00.000-05:00'); // noon EST
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIMEZONE,
    weekday: 'short',
  });
  const wd = formatter.format(d);
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[wd] ?? 0;
}

/**
 * Build calendar days for a month in the app timezone (EST).
 * Returns array of { dateKey, dayNum } or null for leading empty cells.
 * Use this for meal planner and other calendars so dates align with stored data.
 */
export function getCalendarDaysForMonthInAppTz(
  year: number,
  month: number
): Array<{ dateKey: string; dayNum: number } | null> {
  const firstOfMonth = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const firstWeekday = getWeekdayOfDateInAppTz(firstOfMonth);
  const lastDay = new Date(year, month + 1, 0).getDate();
  const days: Array<{ dateKey: string; dayNum: number } | null> = [];
  for (let i = 0; i < firstWeekday; i++) days.push(null);
  for (let d = 1; d <= lastDay; d++) {
    days.push({
      dateKey: `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      dayNum: d,
    });
  }
  return days;
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
