/** Match dietcombo `lib/timezone.ts`: Eastern business calendar by default. */
export const APP_TIMEZONE = process.env.EXPO_PUBLIC_APP_TIMEZONE?.trim() || 'America/New_York';

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

export function toCalendarDateKeyInAppTz(value: string | null | undefined): string | null {
    if (value == null || typeof value !== 'string') return null;
    const trimmed = String(value).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
    try {
        return getTodayInAppTz(new Date(value));
    } catch {
        return null;
    }
}
