import type { AuditDiffEntry } from './clientDiff';

/** Stored on `order_history.change_kind` (nullable for legacy rows). */
export type ClientChangeKind =
  | 'client_created'
  | 'client_deleted'
  | 'client_restored'
  | 'client_paused'
  | 'client_unpaused'
  | 'client_updated'
  | 'system';

export const CLIENT_CHANGE_KIND_LABELS: Record<ClientChangeKind, string> = {
  client_created: 'Created',
  client_deleted: 'Deleted',
  client_restored: 'Restored',
  client_paused: 'Paused',
  client_unpaused: 'Unpaused',
  client_updated: 'Updated',
  system: 'Automated',
};

/** When only the paused flag changed in a shelf diff, tag as pause/unpause. */
export function inferChangeKindFromAuditDiffs(diffs: AuditDiffEntry[]): ClientChangeKind | undefined {
  if (diffs.length === 0) return undefined;
  if (diffs.length === 1) {
    const p = diffs[0].path;
    if (p === 'paused' || p.endsWith('.paused')) {
      return diffs[0].after === true ? 'client_paused' : 'client_unpaused';
    }
  }
  return 'client_updated';
}

/**
 * Best-effort kind for rows inserted before `change_kind` existed.
 */
export function inferLegacyChangeKind(summary: string): ClientChangeKind | 'legacy_unknown' {
  const s = summary.toLowerCase();
  if (s.includes('deleted from main client')) return 'client_deleted';
  if (s.includes('restored to main client')) return 'client_restored';
  if (s.includes('automatically paused')) return 'system';
  if (/paused\s*:/i.test(summary)) {
    const m = summary.match(/paused\s*:\s*([^→\-]+)\s*[→\-]\s*(.+)/i);
    if (m) {
      const after = m[2].trim().toLowerCase();
      const normalized = after.replace(/^"|"$/g, '');
      if (normalized === 'true') return 'client_paused';
      if (normalized === 'false') return 'client_unpaused';
    }
    return 'client_updated';
  }
  return 'legacy_unknown';
}
