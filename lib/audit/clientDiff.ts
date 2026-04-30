export type AuditDiffEntry = {
  path: string;
  before: unknown;
  after: unknown;
};

type DiffOptions = {
  /** Maximum recursion depth (prevents huge diffs). */
  maxDepth?: number;
  /** Maximum number of diff entries to return. */
  maxEntries?: number;
  /**
   * Treat `null` and `undefined` as equivalent when comparing.
   * Useful when UI normalizes empty fields but DB stores null.
   */
  nullishEqual?: boolean;
  /**
   * When `nullishEqual` is enabled, also treat empty strings (or strings containing only whitespace)
   * as equivalent to `null` / `undefined`. This prevents noisy diffs like `"" → —`.
   */
  emptyStringEqualNullish?: boolean;
  /** Paths (prefix match) to ignore, e.g. ["history"] */
  ignorePathPrefixes?: string[];
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v != null && !Array.isArray(v);
}

function stableStringify(v: unknown): string {
  if (v == null) return String(v);
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    if (Array.isArray(v)) return JSON.stringify(v.map(stableNormalize));
    if (isPlainObject(v)) return JSON.stringify(sortKeysDeep(v));
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function sortKeysDeep(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj).sort()) {
    const val = obj[k];
    if (Array.isArray(val)) out[k] = val.map(stableNormalize);
    else if (isPlainObject(val)) out[k] = sortKeysDeep(val);
    else out[k] = val;
  }
  return out;
}

function stableNormalize(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stableNormalize);
  if (isPlainObject(v)) return sortKeysDeep(v);
  return v;
}

function shouldIgnore(path: string, ignorePathPrefixes: string[]): boolean {
  return ignorePathPrefixes.some((p) => path === p || path.startsWith(p + '.'));
}

export function diffObjects(before: unknown, after: unknown, opts: DiffOptions = {}): AuditDiffEntry[] {
  const maxDepth = opts.maxDepth ?? 6;
  const maxEntries = opts.maxEntries ?? 200;
  const nullishEqual = opts.nullishEqual ?? true;
  const emptyStringEqualNullish = opts.emptyStringEqualNullish ?? true;
  const ignorePathPrefixes = opts.ignorePathPrefixes ?? [];
  const out: AuditDiffEntry[] = [];

  function eq(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (nullishEqual && (a == null && b == null)) return true;
    if (nullishEqual && emptyStringEqualNullish) {
      const aEmpty = typeof a === 'string' && a.trim() === '';
      const bEmpty = typeof b === 'string' && b.trim() === '';
      if ((aEmpty && b == null) || (bEmpty && a == null) || (aEmpty && bEmpty)) return true;
    }
    // For objects/arrays, compare stable JSON to avoid noise from key order.
    if (typeof a === 'object' && typeof b === 'object' && a != null && b != null) {
      return stableStringify(a) === stableStringify(b);
    }
    return false;
  }

  function walk(path: string, a: unknown, b: unknown, depth: number) {
    if (out.length >= maxEntries) return;
    if (path && shouldIgnore(path, ignorePathPrefixes)) return;

    if (eq(a, b)) return;
    if (depth >= maxDepth) {
      out.push({ path, before: a, after: b });
      return;
    }

    // Arrays: treat as whole-value changes to keep diffs readable.
    if (Array.isArray(a) || Array.isArray(b)) {
      out.push({ path, before: a, after: b });
      return;
    }

    if (isPlainObject(a) && isPlainObject(b)) {
      const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
      for (const k of Array.from(keys).sort()) {
        walk(path ? `${path}.${k}` : k, a[k], b[k], depth + 1);
        if (out.length >= maxEntries) return;
      }
      return;
    }

    out.push({ path, before: a, after: b });
  }

  walk('', before, after, 0);
  return out;
}

function truncate(s: string, max: number) {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

function formatValue(v: unknown): string {
  if (v == null) return '—';
  if (typeof v === 'string') return `"${truncate(v, 60)}"`;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return truncate(stableStringify(v), 80);
}

export function formatDiffSummary(args: {
  prefix?: string;
  diffs: AuditDiffEntry[];
  maxFields?: number;
  /** When true, write one change per line (better for audit logs). */
  multiline?: boolean;
}): string {
  const maxFields = args.maxFields ?? 10;
  const prefix = (args.prefix ?? '').trim();
  const multiline = args.multiline ?? false;
  const diffs = args.diffs.filter((d) => d.path.trim().length > 0);
  if (diffs.length === 0) return prefix ? `${prefix}: no changes` : 'no changes';

  const shown = diffs.slice(0, maxFields);
  const parts = shown.map((d) => `${d.path}: ${formatValue(d.before)} → ${formatValue(d.after)}`);
  const extraCount = diffs.length - maxFields;
  const extra = extraCount > 0 ? `+${extraCount} more` : '';

  if (multiline) {
    const lines = [...parts, ...(extra ? [extra] : [])];
    return lines.join('\n');
  }

  const extraInline = extra ? `; ${extra}` : '';
  const body = `${parts.join('; ')}${extraInline}`;
  return prefix ? `${prefix}: ${body}` : body;
}

