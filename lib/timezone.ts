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
  const d = typeof date === 'string' ? parsePossiblyNaiveUtcTimestamp(date) : date;
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
  const d = typeof date === 'string' ? parsePossiblyNaiveUtcTimestamp(date) : date;
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

/**
 * Supabase/Postgres `timestamp` (without time zone) columns often come back as a string like
 * `2026-04-30T12:29:00` (no `Z` or offset). If that value is actually a UTC instant, `new Date(...)`
 * will incorrectly treat it as local time.
 *
 * For display, we interpret *timezone-less* date-time strings as UTC instants by appending `Z`.
 * (If the input already includes `Z` or an explicit offset, we leave it as-is.)
 */
function parsePossiblyNaiveUtcTimestamp(value: string): Date {
  const raw = String(value ?? '').trim();
  if (!raw) return new Date(NaN);

  // If it already has a timezone designator (`Z` or ±HH:MM / ±HHMM / ±HH), parse normally.
  const hasTz =
    /[zZ]$/.test(raw) ||
    /[+-]\d{2}:\d{2}$/.test(raw) ||
    /[+-]\d{2}\d{2}$/.test(raw) ||
    /[+-]\d{2}$/.test(raw);
  if (hasTz) return new Date(raw);

  // Normalize "YYYY-MM-DD HH:mm:ss" → "YYYY-MM-DDTHH:mm:ss"
  const normalized = raw.replace(' ', 'T');

  // If it looks like an ISO-like datetime but has no TZ, assume UTC.
  const isoNoTzMatch = normalized.match(
    /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(:\d{2})?(\.\d{1,9})?$/
  );
  if (isoNoTzMatch) {
    const base = `${isoNoTzMatch[1]}${isoNoTzMatch[2] ?? ''}`; // up to seconds
    const frac = isoNoTzMatch[3] ?? '';
    // JS Date parsing is reliably millisecond-precision; truncate fractional seconds to 3 digits.
    const ms = frac ? `.${frac.slice(1, 4).padEnd(3, '0')}` : '';
    return new Date(`${base}${ms}Z`);
  }

  // Fallback: let JS parse it (could be already-local or a non-ISO format).
  return new Date(raw);
}
/**
 * Inclusive UTC range for admin date filters: interpret `from` / `to` as calendar dates in
 * APP_TIMEZONE (America/New_York), not as naive local strings or UTC midnight.
 * Fixes SMS and other reports missing “today” or recent rows when the server/db uses UTC.
 */
export function appTzDateKeysToUtcIsoRangeInclusive(fromKey: string, toKey: string): { startIso: string; endIso: string } {
  if (!DATE_ONLY_REGEX.test(fromKey) || !DATE_ONLY_REGEX.test(toKey)) {
    throw new RangeError('from/to must be YYYY-MM-DD');
  }
  const start = easternWallClockToUtcInstant(fromKey, 0, 0, 0, 0);
  const endDay = easternWallClockToUtcInstant(toKey, 23, 59, 59, 0);
  const end = new Date(endDay.getTime() + 999);
  return { startIso: start.toISOString(), endIso: end.toISOString() };
}

/** Wall-clock time in APP_TIMEZONE → UTC instant (handles DST). */
function easternWallClockToUtcInstant(dateKey: string, hh: number, mm: number, ss: number, ms: number): Date {
  const [y, mo, d] = dateKey.split('-').map(Number);
  let t = Date.UTC(y, mo - 1, d, 17, 0, 0, 0);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const targetDay = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const wantSecs = hh * 3600 + mm * 60 + ss;
  for (let iter = 0; iter < 160; iter++) {
    const parts = formatter.formatToParts(new Date(t));
    const getn = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((p) => p.type === type)?.value ?? NaN);
    const py = getn('year');
    const pm = getn('month');
    const pd = getn('day');
    const ph = getn('hour');
    const pmi = getn('minute');
    const ps = getn('second');
    const curDay = `${py}-${String(pm).padStart(2, '0')}-${String(pd).padStart(2, '0')}`;
    const curSecs = ph * 3600 + pmi * 60 + ps;
    if (curDay === targetDay && curSecs === wantSecs) {
      return new Date(t + ms);
    }
    const dayCmp = curDay.localeCompare(targetDay);
    if (dayCmp < 0) t += 30 * 60 * 1000;
    else if (dayCmp > 0) t -= 30 * 60 * 1000;
    else t += (wantSecs - curSecs) * 1000;
  }
  return new Date(t + ms);
}
