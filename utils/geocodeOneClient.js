// utils/geocodeOneClient.js
// Client-side geocode helpers with:
// - in-memory LRU
// - localStorage cache with versioning
// - in-flight de-duplication (same query => one network call)
// - short-guard for candidates and cooldown

const LS_KEY = "geoCacheV1";
const LS_MAX = 500; // keep up to 500 entries locally
const COOLDOWN_MS = 30_000; // suppress identical fetches within 30s

// Simple normalize so "123 Main St, NY" and "123  Main st, ny" map to the same cache key
function normalizeQuery(q) {
    return String(q || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ")
        .replace(/[.,]+/g, ".") // collapse punctuation a bit
        .replace(/\bunited states\b|\bus\b/g, "")
        .trim();
}

// ----- In-memory LRU + in-flight map -----
const memLRU = new Map();              // key => { lat,lng, provider, formatted, place_id, ts }
const inflight = new Map();            // key => Promise
const lastFetchAt = new Map();         // key => timestamp (for cooldown)

function lruGet(key) {
    if (!memLRU.has(key)) return null;
    const val = memLRU.get(key);
    // refresh recency
    memLRU.delete(key);
    memLRU.set(key, val);
    return val;
}
function lruSet(key, val) {
    if (memLRU.has(key)) memLRU.delete(key);
    memLRU.set(key, { ...val, ts: Date.now() });
    if (memLRU.size > LS_MAX) {
        // evict oldest
        const firstKey = memLRU.keys().next().value;
        memLRU.delete(firstKey);
    }
}

// ----- LocalStorage persistence (best-effort) -----
function readLS() {
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) return {};
        const obj = JSON.parse(raw);
        return typeof obj === "object" && obj ? obj : {};
    } catch { return {}; }
}
function writeLS(all) {
    try {
        localStorage.setItem(LS_KEY, JSON.stringify(all));
    } catch { /* ignore quota */ }
}
function lsGet(key) {
    const all = readLS();
    const val = all[key];
    if (!val) return null;
    return val;
}
function lsSet(key, val) {
    const all = readLS();
    all[key] = { ...val, ts: Date.now() };
    // trim to LS_MAX
    const entries = Object.entries(all).sort((a,b) => a[1].ts - b[1].ts);
    while (entries.length > LS_MAX) entries.shift();
    const trimmed = Object.fromEntries(entries);
    writeLS(trimmed);
}

// Core fetcher to your API with de-duplication + caching
async function fetchGeocodeFromApi(query) {
    const key = normalizeQuery(query);
    if (!key) {
        const e = new Error("Empty query");
        e.code = "EMPTY";
        throw e;
    }

    // 1) In-memory LRU
    const mem = lruGet(key);
    if (mem) return mem;

    // 2) LocalStorage
    const ls = lsGet(key);
    if (ls) {
        lruSet(key, ls);
        return ls;
    }

    // 3) Cooldown (avoid hammering same key repeatedly)
    const last = lastFetchAt.get(key) || 0;
    const now = Date.now();
    if (now - last < COOLDOWN_MS && inflight.has(key)) {
        // Within cooldown, reuse in-flight if any
        return inflight.get(key);
    }
    lastFetchAt.set(key, now);

    // 4) In-flight de-dupe
    if (inflight.has(key)) return inflight.get(key);

    const p = (async () => {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`, { cache: "no-store" });
        const text = await res.text().catch(() => "");
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch { /* ignore */ }

        if (!res.ok) {
            const reason = data?.error || data?.detail?.join?.(", ") || text || `HTTP ${res.status}`;
            const e = new Error(reason);
            e.code = res.status;
            e.detail = data?.detail || null;
            throw e;
        }
        if (typeof data?.lat !== "number" || typeof data?.lng !== "number") {
            const e = new Error("Invalid geocode response");
            e.code = "BAD_RESPONSE";
            throw e;
        }

        const out = {
            lat: data.lat,
            lng: data.lng,
            provider: data?.provider,
            formatted: data?.formatted,
            place_id: data?.place_id,
        };
        // Persist
        lruSet(key, out);
        lsSet(key, out);
        return out;
    })();

    inflight.set(key, p);
    try {
        const result = await p;
        return result;
    } finally {
        inflight.delete(key);
    }
}

export async function geocodeOneClient(query) {
    return fetchGeocodeFromApi(query);
}

// ===== Candidate Search =====

// One session token per tab for grouping autocomplete calls server-side
const sessionToken = (() => {
    const s4 = () => Math.random().toString(16).slice(2, 10);
    return `${s4()}-${s4()}-${Date.now().toString(16)}`;
})();

const searchCooldown = new Map(); // key => ts
const SEARCH_COOLDOWN_MS = 10_000; // 10s cooldown per normalized query

export async function searchGeocodeCandidates(query, limit = 6) {
    const norm = normalizeQuery(query);
    // Guard very short queries to avoid spammy billing
    if (!norm || norm.length < 5) return [];

    const last = searchCooldown.get(norm) || 0;
    const now = Date.now();
    if (now - last < SEARCH_COOLDOWN_MS) {
        // within cooldown: do not re-hit the server; return empty (UI can show "wait" or last results)
        return [];
    }
    searchCooldown.set(norm, now);

    const url = `/api/geocode/search?q=${encodeURIComponent(query)}&limit=${limit}&session=${encodeURIComponent(sessionToken)}`;
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(`Candidate search failed: ${t || res.status}`);
    }
    const data = await res.json();
    return Array.isArray(data?.items) ? data.items : [];
}