import type { ClientChangeKind } from './clientChangeKind';

/** UI / filter categories for the admin Changes log (a row can have several). */
export type ChangeDisplayTag =
    | 'created'
    | 'deleted'
    | 'restored'
    | 'paused'
    | 'vendor'
    | 'address'
    | 'notes_history'
    | 'profile_info';

export const CHANGE_TAG_LABELS: Record<ChangeDisplayTag, string> = {
    created: 'Created',
    deleted: 'Deleted',
    restored: 'Restored',
    paused: 'Paused',
    vendor: 'Vendor / service',
    address: 'Address',
    notes_history: 'Notes / history',
    profile_info: 'Profile info',
};

/** Order for stable display and checkbox lists */
export const CHANGE_TAG_ORDER: ChangeDisplayTag[] = [
    'created',
    'deleted',
    'restored',
    'paused',
    'vendor',
    'address',
    'notes_history',
    'profile_info',
];

function splitSummaryLines(summary: string): string[] {
    const s = summary.trim();
    if (!s) return [];
    if (s.includes('\n')) {
        return s.split('\n').map((l) => l.trim()).filter(Boolean);
    }
    return s.split(/\s*;\s+/).map((l) => l.trim()).filter(Boolean);
}

/**
 * Classify a single summary fragment (one field change line).
 * Handles shelf diff lines (`path: a → b`), ClientProfile lines (`Label: "x" -> "y"`), and cron text.
 */
export function classifySummaryLine(line: string): ChangeDisplayTag[] {
    const tags = new Set<ChangeDisplayTag>();
    const L = line.trim();
    if (!L) return [];

    const lower = L.toLowerCase();

    if (/^paused\s*:/i.test(L) || /^paused:/i.test(L)) tags.add('paused');
    if (/automatically paused/i.test(L)) tags.add('paused');

    // Shelf-style paths (`path: … → …`)
    if (/^(address|apt|city|state|zip|county|lat|lng|latitude|longitude|geocoded)\s*:/i.test(L)) tags.add('address');
    if (/^produceVendorId\s*:/i.test(L) || /^serviceType\s*:/i.test(L)) tags.add('vendor');
    if (/^(notes|history|dislikes)\s*:/i.test(L)) tags.add('notes_history');

    // ClientProfile long-form labels
    if (
        /^address\s*:/i.test(L) ||
        /^city\s*:/i.test(L) ||
        /^state\s*:/i.test(L) ||
        /^zip\s*:/i.test(L) ||
        /^apt\s*:/i.test(L) ||
        /^county\s*:/i.test(L)
    ) {
        tags.add('address');
    }
    if (/^service type\s*:/i.test(L)) tags.add('vendor');
    if (/notes updated/i.test(L)) tags.add('notes_history');

    // Vendor / produce food transitions (free text)
    if (
        /produce\s*\(/i.test(L) ||
        (/food/i.test(L) && /produce/i.test(L) && /→|->/.test(L)) ||
        /producevendor/i.test(lower.replace(/\s/g, ''))
    ) {
        tags.add('vendor');
    }

    // Profile-ish fields (not already address/vendor/notes lines above)
    if (
        /^full name\s*:/i.test(L) ||
        /^email\s*:/i.test(L) ||
        /^phone\s*:/i.test(L) ||
        /^secondary phone\s*:/i.test(L) ||
        /^status\s*:/i.test(L) ||
        /^navigator\s*:/i.test(L) ||
        /screening/i.test(L) ||
        /^authorized amount\s*:/i.test(L) ||
        /^expiration date\s*:/i.test(L) ||
        /^approved meals\s*:/i.test(L) ||
        /order configuration changed/i.test(L) ||
        /^complex\s*:/i.test(L) ||
        /^bill\s*:/i.test(L) ||
        /^delivery\s*:/i.test(L)
    ) {
        tags.add('profile_info');
    }

    return [...tags];
}

function sortTags(tags: ChangeDisplayTag[]): ChangeDisplayTag[] {
    const order = new Map(CHANGE_TAG_ORDER.map((t, i) => [t, i]));
    return [...new Set(tags)].sort((a, b) => (order.get(a) ?? 99) - (order.get(b) ?? 99));
}

export function inferAdminChangeTags(input: {
    changeKind: ClientChangeKind | 'legacy_unknown' | null;
    summary: string;
}): ChangeDisplayTag[] {
    const acc = new Set<ChangeDisplayTag>();
    const k = input.changeKind;
    const summary = input.summary ?? '';

    if (k === 'client_created') acc.add('created');
    if (k === 'client_deleted') acc.add('deleted');
    if (k === 'client_restored') acc.add('restored');
    if (k === 'client_paused' || k === 'system') acc.add('paused');

    if (k === 'legacy_unknown') acc.add('profile_info');

    if (/deleted from main client/i.test(summary)) acc.add('deleted');
    if (/restored to main client/i.test(summary)) acc.add('restored');
    if (/automatically paused/i.test(summary)) acc.add('paused');

    const lines = splitSummaryLines(summary);
    for (const line of lines) {
        for (const t of classifySummaryLine(line)) {
            acc.add(t);
        }
    }

    if (k === 'client_updated' && lines.length > 0) {
        const perLine = lines.map((line) => classifySummaryLine(line));
        const flat = perLine.flat();
        if (flat.length === 0) acc.add('profile_info');
        else if (perLine.some((tags) => tags.length === 0)) acc.add('profile_info');
    }

    // Created summary text
    if (/^created (client|dependent|placeholder)/i.test(summary.trim())) acc.add('created');

    return sortTags([...acc]);
}

export function formatTagsDisplay(tags: ChangeDisplayTag[]): string {
    if (!tags.length) return '—';
    return tags.map((t) => CHANGE_TAG_LABELS[t]).join(', ');
}
