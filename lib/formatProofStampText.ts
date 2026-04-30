import { APP_TIMEZONE } from '@/lib/timezone';

/**
 * Intl (especially modern ICU) may insert U+202F narrow no-break space between
 * time and AM/PM. SVG text in Sharp/librsvg and some canvas stacks render that
 * code point as missing-glyph boxes while the fallback layer still shows correct
 * glyphs — looks like hollow rectangles on top of readable text.
 */
export function sanitizeProofStampDisplayText(s: string): string {
  return s
    .replace(/\u202f/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u2000-\u200a]/g, ' ');
}

export type FormatProofStampOptions = {
  locale?: string;
  /**
   * Defaults to app Eastern timezone for parity with server-side proof stamps.
   * Omit on the client only if you intentionally want the viewer's local zone.
   */
  timeZone?: string;
};

/**
 * Single human-readable line for proof photos (matches delivery/produce stamp convention).
 */
export function formatProofStampText(date: Date, options: FormatProofStampOptions = {}): string {
  const locale = options.locale ?? 'en-US';
  const timeZone = options.timeZone ?? APP_TIMEZONE;

  try {
    const raw = new Intl.DateTimeFormat(locale, {
      timeZone,
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short',
    }).format(date);
    return sanitizeProofStampDisplayText(raw);
  } catch {
    const raw = new Intl.DateTimeFormat(locale, {
      timeZone,
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(date);
    return sanitizeProofStampDisplayText(raw);
  }
}
