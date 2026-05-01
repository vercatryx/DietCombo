/** Layout modes that share the same client list column structure (brooklyn/eligible/etc. match "std"). */
export type ClientListColumnLayoutView =
    | 'all'
    | 'brooklyn'
    | 'eligible'
    | 'ineligible'
    | 'billing'
    | 'needs-attention';

const STORAGE_PREFIX = 'clientList.columnWidths.';

export function clientListColumnLayoutStorageKey(view: ClientListColumnLayoutView, expanded: boolean): string {
    const row = view === 'needs-attention' ? 'na' : 'std';
    return `${STORAGE_PREFIX}${row}-${expanded ? 'exp' : 'cmp'}`;
}

/** Default pixel widths per visible column (order matches header / row cell order). */
export function clientListDefaultColumnWidths(view: ClientListColumnLayoutView, expanded: boolean): number[] {
    const base = [52, 200, 100, 90, 120, 140, 160];
    const chevron = 44;

    if (view === 'needs-attention') {
        const mid = [400, 150, 150];
        if (!expanded) return [...base, ...mid, chevron];
        const expNa = [92, 92, 72, 96, 64, 72, 96, 120, 96, 88, 72, 72, 64, 72, 88, 140];
        return [...base, ...mid, ...expNa, chevron];
    }

    const mid = [140, 200, 180, 140, 140, 250, 200];
    if (!expanded) return [...base, ...mid, chevron];
    const expStd = [92, 92, 72, 96, 64, 72, 96, 120, 96, 108, 108, 88, 72, 72, 64, 72, 88, 140];
    return [...base, ...mid, ...expStd, chevron];
}
