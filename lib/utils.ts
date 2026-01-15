import { type ClassValue, clsx } from 'clsx';

export function cn(...inputs: ClassValue[]) {
    return clsx(inputs);
}

export function formatDate(dateStr: string) {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

/**
 * Validates if a string is a valid UniteUs case URL
 * Pattern: https://app.uniteus.io/dashboard/cases/open/{case-uuid}/contact/{contact-uuid}
 */
export function isValidUniteUsUrl(url: string): boolean {
    if (!url || typeof url !== 'string') return false;
    const caseUrlPattern = /^https:\/\/app\.uniteus\.io\/dashboard\/cases\/open\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/contact\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return caseUrlPattern.test(url.trim());
}

/**
 * Extracts and formats a UniteUs URL for display
 * Returns the URL if valid, otherwise returns null
 */
export function formatUniteUsUrl(url: string | null | undefined): string | null {
    if (!url) return null;
    const trimmed = url.trim();
    return isValidUniteUsUrl(trimmed) ? trimmed : null;
}

/**
 * Parses a UniteUs URL to extract caseId and clientId (contact ID)
 * Returns { caseId, clientId } or null if invalid
 * Based on dietfantasy UserModal.jsx implementation
 */
export function parseUniteUsUrl(urlStr: string | null | undefined): { caseId: string; clientId: string } | null {
    if (!urlStr) return null;
    try {
        const u = new URL(String(urlStr));
        const path = u.pathname.replace(/\/+$/, '');
        const m = /\/cases\/open\/([0-9a-fA-F-]{10,})\/contact\/([0-9a-fA-F-]{10,})/.exec(path);
        if (!m) return null;
        const [, caseId, clientId] = m;
        return { caseId, clientId };
    } catch {
        return null;
    }
}

/**
 * Composes a UniteUs URL from caseId and clientId (contact ID)
 * Returns empty string if either ID is missing
 * Based on dietfantasy UserModal.jsx implementation
 */
export function composeUniteUsUrl(caseId: string | null | undefined, clientId: string | null | undefined): string {
    if (!caseId || !clientId) return '';
    return `https://app.uniteus.io/dashboard/cases/open/${encodeURIComponent(caseId)}/contact/${encodeURIComponent(clientId)}`;
}

/**
 * Rounds a number to 2 decimal places for currency calculations.
 * This prevents floating-point precision errors when working with monetary values.
 * @param value - The number to round
 * @returns The value rounded to 2 decimal places
 */
export function roundCurrency(value: number): number {
    return Math.round(value * 100) / 100;
}

export const VAL_TOLERANCE = 0.05;

/**
 * Checks if a value meets a minimum requirement with fuzzy tolerance.
 * @param value The actual value
 * @param minimum The minimum required
 * @returns true if value >= minimum - TOLERANCE
 */
export function isMeetingMinimum(value: number, minimum: number): boolean {
    return value >= minimum - VAL_TOLERANCE;
}

/**
 * Checks if a value exceeds a maximum limit with fuzzy tolerance.
 * @param value The actual value
 * @param maximum The limit
 * @returns true if value > maximum + TOLERANCE (i.e. it strictly exceeds the limit even with tolerance)
 */
export function isExceedingMaximum(value: number, maximum: number): boolean {
    return value > maximum + VAL_TOLERANCE;
}

/**
 * Checks if a value meets an exact target with fuzzy tolerance.
 * @param value The actual value
 * @param target The target value
 * @returns true if |value - target| <= TOLERANCE
 */
export function isMeetingExactTarget(value: number, target: number): boolean {
    return Math.abs(value - target) <= VAL_TOLERANCE;
}
