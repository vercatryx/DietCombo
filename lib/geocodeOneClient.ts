// lib/geocodeOneClient.ts
// Client-side geocode helpers with:
// - in-memory LRU
// - localStorage cache with versioning
// - in-flight de-duplication (same query => one network call)
// - short-guard for candidates and cooldown

import { buildGeocodeQuery } from './addressHelpers';

const LS_KEY = "geoCacheV1";
const LS_MAX = 500; // keep up to 500 entries locally
const COOLDOWN_MS = 30_000; // suppress identical fetches within 30s

// Simple normalize so "123 Main St, NY" and "123  Main st, ny" map to the same cache key
function normalizeQuery(q: string) {
    return String(q || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ")
        .replace(/[.,]+/g, ".") // collapse punctuation a bit
        .replace(/\bunited states\b|\bus\b/g, "")
        .trim();
}

interface GeocodeResult {
    lat: number;
    lng: number;
    provider?: string;
    formatted?: string;
    place_id?: string;
    ts?: number;
}

// ----- In-memory LRU + in-flight map -----
const memLRU = new Map<string, GeocodeResult>();              // key => { lat,lng, provider, formatted, place_id, ts }
const inflight = new Map<string, Promise<GeocodeResult>>();            // key => Promise
const lastFetchAt = new Map<string, number>();         // key => timestamp (for cooldown)

function lruGet(key: string): GeocodeResult | null {
    if (!memLRU.has(key)) return null;
    const val = memLRU.get(key)!;
    // refresh recency
    memLRU.delete(key);
    memLRU.set(key, val);
    return val;
}
function lruSet(key: string, val: GeocodeResult) {
    if (memLRU.has(key)) memLRU.delete(key);
    memLRU.set(key, { ...val, ts: Date.now() });
    if (memLRU.size > LS_MAX) {
        // evict oldest
        const firstKey = memLRU.keys().next().value;
        if (firstKey) {
            memLRU.delete(firstKey);
        }
    }
}

// ----- LocalStorage persistence (best-effort) -----
function readLS(): Record<string, GeocodeResult> {
    if (typeof window === 'undefined') return {};
    try {
        const raw = localStorage.getItem(LS_KEY);
        if (!raw) return {};
        const obj = JSON.parse(raw);
        return typeof obj === "object" && obj ? obj : {};
    } catch { return {}; }
}
function writeLS(all: Record<string, GeocodeResult>) {
    if (typeof window === 'undefined') return;
    try {
        localStorage.setItem(LS_KEY, JSON.stringify(all));
    } catch { /* ignore quota */ }
}
function lsGet(key: string): GeocodeResult | null {
    const all = readLS();
    const val = all[key];
    if (!val) return null;
    return val;
}
function lsSet(key: string, val: GeocodeResult) {
    const all = readLS();
    all[key] = { ...val, ts: Date.now() };
    // trim to LS_MAX
    const entries = Object.entries(all).sort((a,b) => (a[1].ts || 0) - (b[1].ts || 0));
    while (entries.length > LS_MAX) entries.shift();
    const trimmed = Object.fromEntries(entries);
    writeLS(trimmed);
}

// Core fetcher to your API with de-duplication + caching
async function fetchGeocodeFromApi(query: string): Promise<GeocodeResult> {
    const key = normalizeQuery(query);
    if (!key) {
        const e = new Error("Empty query");
        (e as any).code = "EMPTY";
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
        return inflight.get(key)!;
    }
    lastFetchAt.set(key, now);

    // 4) In-flight de-dupe
    if (inflight.has(key)) return inflight.get(key)!;

    const p = (async () => {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`, { cache: "no-store" });
        const text = await res.text().catch(() => "");
        let data: any = null;
        try { data = text ? JSON.parse(text) : null; } catch { /* ignore */ }

        if (!res.ok) {
            const reason = data?.error || (Array.isArray(data?.detail) ? data.detail.join(", ") : "") || text || `HTTP ${res.status}`;
            const e = new Error(reason);
            (e as any).code = res.status;
            (e as any).detail = data?.detail || null;
            throw e;
        }
        if (typeof data?.lat !== "number" || typeof data?.lng !== "number") {
            const e = new Error("Invalid geocode response");
            (e as any).code = "BAD_RESPONSE";
            throw e;
        }

        const out: GeocodeResult = {
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

export async function geocodeOneClient(query: string): Promise<GeocodeResult> {
    return fetchGeocodeFromApi(query);
}

// ===== Candidate Search =====

// One session token per tab for grouping autocomplete calls server-side
const sessionToken = (() => {
    const s4 = () => Math.random().toString(16).slice(2, 10);
    return `${s4()}-${s4()}-${Date.now().toString(16)}`;
})();

const searchCooldown = new Map<string, number>(); // key => ts
const SEARCH_COOLDOWN_MS = 10_000; // 10s cooldown per normalized query

export interface GeocodeCandidate {
    label: string;
    lat: number;
    lng: number;
    provider: string;
    confidence?: number;
}

export async function searchGeocodeCandidates(query: string, limit = 6): Promise<GeocodeCandidate[]> {
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

// ===== Server-side geocoding helper =====

export interface AddressInput {
    address?: string | null;
    apt?: string | null;
    city?: string | null;
    state?: string | null;
    zip?: string | null;
}

/**
 * Server-side function to geocode an address if needed.
 * Returns { lat, lng } if geocoding succeeds, or null if it fails or isn't needed.
 */
export async function geocodeIfNeeded(
    address: AddressInput,
    addressChanged: boolean
): Promise<{ lat: number; lng: number } | null> {
    // Only geocode if address changed
    if (!addressChanged) {
        return null;
    }

    // Build query string from address components
    const queryRaw = buildGeocodeQuery(address);
    
    if (!queryRaw || queryRaw.trim().length === 0) {
        return null;
    }

    // Strip unit/apt/suite from address (same logic as geocode API)
    const query = queryRaw
        .replace(/\b(apt|apartment|unit|ste|suite|fl|floor|bsmnt|basement|rm|room|#)\s*[\w\-\/]+/gi, "")
        .replace(/,\s*,/g, ", ")
        .replace(/\s+/g, " ")
        .trim();

    if (!query) {
        return null;
    }

    try {
        // Use the same geocode logic as the API route
        const NOMINATIM = "https://nominatim.openstreetmap.org/search";
        const COUNTRY = (process.env.GEOCODE_COUNTRY || "US").toLowerCase();
        const TIMEOUT = Number(process.env.GEOCODE_TIMEOUT_MS || 7000);
        const BOUNDS_STR = process.env.GEOCODE_BOUNDS || "-75.8,39.5,-72.9,41.9";
        const GOOGLE_KEY = process.env.GOOGLE_MAPS_KEY || process.env.GOOGLE_MAPS_API_KEY || "";
        const GOOGLE_BOUNDS = process.env.GEOCODE_GOOGLE_BOUNDS || "39.5,-75.8|41.9,-72.9";

        const withTimeout = <T>(p: Promise<T>, ms = TIMEOUT) => {
            return Promise.race([
                p,
                new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)),
            ]);
        };

        // Try Nominatim first
        try {
            const params = new URLSearchParams({
                format: "json",
                q: query,
                addressdetails: "1",
                limit: "1",
                countrycodes: COUNTRY,
                bounded: "1",
                viewbox: BOUNDS_STR,
            });
            const res = await withTimeout(fetch(`${NOMINATIM}?${params}`, {
                headers: {
                    "User-Agent": "diet-combo/1.0 (contact: admin@local)",
                    "Accept": "application/json",
                },
            }));
            if (res.ok) {
                const arr = await res.json();
                if (Array.isArray(arr) && arr.length > 0) {
                    const lat = Number(arr[0]?.lat);
                    const lng = Number(arr[0]?.lon);
                    if (Number.isFinite(lat) && Number.isFinite(lng)) {
                        return { lat, lng };
                    }
                }
            }
        } catch {
            // Fall through to Google
        }

        // Try Google as fallback
        if (GOOGLE_KEY) {
            try {
                const params = new URLSearchParams({
                    key: GOOGLE_KEY,
                    address: query,
                    components: `country:${COUNTRY.toUpperCase()}|administrative_area:NY|administrative_area:NJ`,
                    bounds: GOOGLE_BOUNDS,
                    region: "us",
                });
                const res = await withTimeout(fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`));
                if (res.ok) {
                    const data = await res.json();
                    const r = data?.results?.[0];
                    const lat = r?.geometry?.location?.lat;
                    const lng = r?.geometry?.location?.lng;
                    if (Number.isFinite(lat) && Number.isFinite(lng)) {
                        return { lat, lng };
                    }
                }
            } catch {
                // Return null if both fail
            }
        }

        return null;
    } catch (error) {
        console.error('Geocoding error:', error);
        return null;
    }
}