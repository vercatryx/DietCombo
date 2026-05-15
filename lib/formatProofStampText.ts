import { APP_TIMEZONE } from '@/lib/timezone';

/**
 * Intl (especially modern ICU) may insert U+202F narrow no-break space between
 * time and AM/PM. SVG text in Sharp/librsvg and some canvas stacks render that
 * code point as missing-glyph boxes while the fallback layer still shows correct
 * glyphs — looks like hollow rectangles on top of readable text.
 *
 * ICU may also use Unicode minus (U+2212) in GMT offsets and other punctuation
 * outside the embedded Inter subset; those often render as empty tofu boxes too.
 */
export function sanitizeProofStampDisplayText(s: string): string {
  return s
    .replace(/\u2212/g, '-') // Unicode minus → ASCII hyphen (common in GMT-5 style labels)
    .replace(/[\u2010-\u2015]/g, '-') // figure dash, en dash, em dash, etc.
    .replace(/\u202f/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/[\u2000-\u200a]/g, ' ')
    // Bidi / format controls: ICU can emit these; librsvg often renders them as missing-glyph boxes.
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function proofStampFromParts(
  date: Date,
  locale: string,
  timeZone: string,
  includeTimeZoneName: boolean
): string {
  const dtf = new Intl.DateTimeFormat(locale, {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    ...(includeTimeZoneName ? { timeZoneName: 'short' as const } : {}),
  });

  let month = '';
  let day = '';
  let year = '';
  let hour = '';
  let minute = '';
  let dayPeriod = '';
  let timeZoneName = '';

  for (const { type, value } of dtf.formatToParts(date)) {
    switch (type) {
      case 'month':
        month = value;
        break;
      case 'day':
        day = value;
        break;
      case 'year':
        year = value;
        break;
      case 'hour':
        hour = value;
        break;
      case 'minute':
        minute = value;
        break;
      case 'dayPeriod':
        dayPeriod = value;
        break;
      case 'timeZoneName':
        timeZoneName = value;
        break;
      default:
        break;
    }
  }

  const dateHalf = month && day && year ? `${month} ${day}, ${year}` : '';
  const timeHalf = hour && minute !== '' && dayPeriod ? `${hour}:${minute} ${dayPeriod}` : '';
  const tz = includeTimeZoneName && timeZoneName ? ` ${timeZoneName}` : '';

  if (dateHalf && timeHalf) {
    return `${dateHalf}, ${timeHalf}${tz}`;
  }
  if (dateHalf) return `${dateHalf}${tz}`;
  if (timeHalf) return `${timeHalf}${tz}`;
  return '';
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

  // Never use `.format()` for proof stamps: ICU "literal" segments often contain U+202F
  // and other code points that librsvg draws as hollow boxes. `formatToParts` + our own
  // punctuation avoids those invisible/problematic characters.
  try {
    const assembled = proofStampFromParts(date, locale, timeZone, true);
    if (assembled) return sanitizeProofStampDisplayText(assembled);
  } catch {
    /* try without time zone name */
  }

  try {
    const assembled = proofStampFromParts(date, locale, timeZone, false);
    if (assembled) return sanitizeProofStampDisplayText(assembled);
  } catch {
    /* fall through */
  }

  const fallback = new Intl.DateTimeFormat(locale, {
    timeZone,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(date);
  return sanitizeProofStampDisplayText(fallback);
}
