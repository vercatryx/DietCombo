/**
 * Parse and merge gluten / sugar / dairy "free" preferences in client dietary text (clients.dislikes).
 * Fuzzy read; writes only append/remove plain phrases—no structured metadata blocks.
 */

export type DietaryFlags = {
    glutenFree: boolean;
    sugarFree: boolean;
    dairyFree: boolean;
};

function normForScan(s: string): string {
    return (s ?? '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

/** Order matters: first match wins for pairing words (e.g. gluten + free). */
const GLUTEN_PATTERNS: RegExp[] = [
    /\bgluten\s*[-]?\s*free\b/i,
    /\bno\s+gluten\b/i,
    /\bwithout\s+gluten\b/i,
    /\bglutenfree\b/i,
    /\bceliac\b/i,
    /\bcoeliac\b/i,
    /(^|[^\w])gf([^\w]|$)/i
];

const SUGAR_PATTERNS: RegExp[] = [
    /\bsugar\s*[-]?\s*free\b/i,
    /\bno\s+sugar\b/i,
    /\bwithout\s+sugar\b/i,
    /\bsugarfree\b/i
];

const DAIRY_PATTERNS: RegExp[] = [
    /\bdairy\s*[-]?\s*free\b/i,
    /\bmilk\s*[-]?\s*free\b/i,
    /\blactose\s*[-]?\s*free\b/i,
    /\bno\s+dairy\b/i,
    /\bno\s+milk\b/i,
    /\bdairyfree\b/i,
    /\bdariy\s*[-]?\s*free\b/i,
    /\bdairy\s*[-]?\s*frea\b/i
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
    const n = normForScan(text);
    if (!n) return false;
    for (const re of patterns) {
        re.lastIndex = 0;
        if (re.test(n)) return true;
    }
    return false;
}

export function parseDietaryFlags(text: string | null | undefined): DietaryFlags {
    const t = text ?? '';
    return {
        glutenFree: matchesAny(t, GLUTEN_PATTERNS),
        sugarFree: matchesAny(t, SUGAR_PATTERNS),
        dairyFree: matchesAny(t, DAIRY_PATTERNS)
    };
}

const GLUTEN_STRIP: RegExp[] = [
    /\bgluten\s*[-]?\s*free\b/gi,
    /\bno\s+gluten\b/gi,
    /\bwithout\s+gluten\b/gi,
    /\bglutenfree\b/gi,
    /\bceliac\b/gi,
    /\bcoeliac\b/gi,
    /\bgf\b/gi
];

const SUGAR_STRIP: RegExp[] = [
    /\bsugar\s*[-]?\s*free\b/gi,
    /\bno\s+sugar\b/gi,
    /\bwithout\s+sugar\b/gi,
    /\bsugarfree\b/gi
];

const DAIRY_STRIP: RegExp[] = [
    /\bdairy\s*[-]?\s*free\b/gi,
    /\bmilk\s*[-]?\s*free\b/gi,
    /\blactose\s*[-]?\s*free\b/gi,
    /\bno\s+dairy\b/gi,
    /\bno\s+milk\b/gi,
    /\bdairyfree\b/gi,
    /\bdariy\s*[-]?\s*free\b/gi,
    /\bdairy\s*[-]?\s*frea\b/gi
];

function stripCategory(s: string, patterns: RegExp[]): string {
    let out = s;
    for (const re of patterns) {
        out = out.replace(re, '');
    }
    return out;
}

/** Cleanup commas, "and", semicolons, extra spaces left after removals */
function tidyAfterStrip(s: string): string {
    let out = s
        .replace(/\s*,\s*,+/g, ', ')
        .replace(/\s*;\s*;+/g, '; ')
        .replace(/\(\s*\)/g, '')
        .replace(/\[\s*\]/g, '')
        .replace(/\s+and\s+and\b/gi, ' and')
        .replace(/^\s*,\s*|\s*,\s*$/g, '')
        .replace(/^\s*;\s*|\s*;\s*$/g, '')
        .replace(/\s{2,}/g, ' ')
        .replace(/\s*,\s*([.,])/g, '$1')
        .trim();
    out = out.replace(/^,\s*|,\s*$/g, '').trim();
    return out;
}

const APPEND_FRAGMENTS: Record<keyof DietaryFlags, string> = {
    glutenFree: 'gluten free',
    sugarFree: 'sugar free',
    dairyFree: 'dairy free'
};

export function mergeDietaryFlagsIntoNote(
    current: string | null | undefined,
    desired: DietaryFlags
): string {
    const keys: (keyof DietaryFlags)[] = ['glutenFree', 'sugarFree', 'dairyFree'];
    const stripMap: Record<keyof DietaryFlags, RegExp[]> = {
        glutenFree: GLUTEN_STRIP,
        sugarFree: SUGAR_STRIP,
        dairyFree: DAIRY_STRIP
    };

    let s = current ?? '';

    const before = parseDietaryFlags(s);
    for (const k of keys) {
        if (before[k] && !desired[k]) {
            s = stripCategory(s, stripMap[k]);
        }
    }

    s = tidyAfterStrip(s);

    let afterStrip = parseDietaryFlags(s);
    for (const k of keys) {
        if (!desired[k]) continue;
        if (afterStrip[k]) continue;

        const frag = APPEND_FRAGMENTS[k];
        if (!s.trim()) {
            s = frag.charAt(0).toUpperCase() + frag.slice(1);
        } else {
            const sep = /[.,;!?]\s*$/.test(s.trim()) ? ' ' : ', ';
            s = `${s.trimEnd()}${sep}${frag}`;
        }
        afterStrip = parseDietaryFlags(s);
    }

    return s.trim();
}
