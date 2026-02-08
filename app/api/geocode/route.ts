import { NextResponse } from "next/server";

const NOMINATIM = "https://nominatim.openstreetmap.org/search";

// ---- Bias & config (override in .env.local) ----
const COUNTRY  = (process.env.GEOCODE_COUNTRY || "US").toLowerCase();
const TIMEOUT  = Number(process.env.GEOCODE_TIMEOUT_MS || 7000);

// Nominatim viewbox (lon1,lat1,lon2,lat2) – tri-state bias (incl. Monsey area)
const BOUNDS_STR =
    process.env.GEOCODE_BOUNDS ||
    "-75.8,39.5,-72.9,41.9";

// Google fallback: bounds as "south,west|north,east" (lat,lon | lat,lon)
const GOOGLE_KEY    = process.env.GOOGLE_MAPS_KEY || process.env.GOOGLE_MAPS_API_KEY || "";
const GOOGLE_BOUNDS = process.env.GEOCODE_GOOGLE_BOUNDS || "39.5,-75.8|41.9,-72.9";

function withTimeout<T>(p: Promise<T>, ms = TIMEOUT) {
    return Promise.race([
        p,
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)),
    ]);
}

// Strip unit/apt/suite from incoming address strings
function stripUnit(s: string) {
    return (s || "")
        .replace(/\b(apt|apartment|unit|ste|suite|fl|floor|bsmnt|basement|rm|room|#)\s*[\w\-\/]+/gi, "")
        .replace(/,\s*,/g, ", ")
        .replace(/\s+/g, " ")
        .trim();
}

async function tryNominatim(q: string) {
    const params = new URLSearchParams({
        format: "json",
        q,
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
        next: { revalidate: 0 },
    }));
    if (!res.ok) throw new Error("nominatim upstream");
    const arr = await res.json();
    if (!Array.isArray(arr) || arr.length === 0) throw new Error("nominatim not found");
    const lat = Number(arr[0]?.lat);
    const lng = Number(arr[0]?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error("nominatim invalid");
    return { lat, lng, provider: "nominatim" as const, formatted: arr[0]?.display_name, place_id: arr[0]?.place_id };
}

async function tryGoogle(q: string) {
    if (!GOOGLE_KEY) throw new Error("google disabled");
    const params = new URLSearchParams({
        key: GOOGLE_KEY,
        address: q,
        components: `country:${COUNTRY.toUpperCase()}|administrative_area:NY|administrative_area:NJ`,
        bounds: GOOGLE_BOUNDS,
        region: "us",
    });
    const res = await withTimeout(fetch(`https://maps.googleapis.com/maps/api/geocode/json?${params}`));
    if (!res.ok) throw new Error("google upstream");
    const data = await res.json();
    const r = data?.results?.[0];
    const lat = r?.geometry?.location?.lat;
    const lng = r?.geometry?.location?.lng;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error("google not found");
    return { lat, lng, provider: "google" as const, formatted: r?.formatted_address, place_id: r?.place_id };
}

export async function GET(req: Request) {
    const { searchParams } = new URL(req.url);
    const qRaw = searchParams.get("q")?.trim();
    if (!qRaw) return NextResponse.json({ error: "Missing q" }, { status: 400 });

    const provider = searchParams.get("provider")?.toLowerCase() || "auto";

    const q = stripUnit(qRaw)
        .replace(/\s+/g, " ")
        .replace(/\s*,\s*/g, ", ")
        .trim();

    const errors: string[] = [];

    // Determine which providers to try based on provider parameter
    let attempts: Array<() => Promise<{ lat: number; lng: number; provider: string; formatted?: string; place_id?: string }>> = [];
    
    if (provider === "nominatim") {
        attempts = [tryNominatim];
    } else if (provider === "google") {
        attempts = [tryGoogle];
    } else if (provider === "auto" || provider === "") {
        attempts = [tryNominatim, tryGoogle];
    } else if (provider === "none") {
        return NextResponse.json({ error: "Geocoding skipped" }, { status: 400 });
    } else {
        return NextResponse.json({ error: "Invalid provider. Use 'auto', 'nominatim', 'google', or 'none'" }, { status: 400 });
    }

    for (const fn of attempts) {
        try {
            const hit = await fn(q);
            return NextResponse.json({
                lat: hit.lat,
                lng: hit.lng,
                provider: hit.provider,
                formatted: hit.formatted,
                place_id: hit.place_id,
            });
        } catch (e: any) {
            errors.push(e?.message || String(e));
        }
    }

    return NextResponse.json({ error: "Not found", detail: errors }, { status: 404 });
}
