import { NextResponse } from "next/server";

const GOOGLE_KEY = process.env.GOOGLE_MAPS_KEY || process.env.GOOGLE_MAPS_API_KEY || "";
const TRI_STATE_BOUNDS = "39.5,-75.8|41.9,-72.9";
const COMPONENTS = "country:US|administrative_area:NY";

// --- CORS headers ---
const ALLOW_ORIGIN = process.env.EXT_ORIGIN || "*";
const CORS_HEADERS = {
    "Access-Control-Allow-Origin": ALLOW_ORIGIN,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

function normalizeSuffixes(q: string) {
    const map: Record<string, string> = {
        circle: "cir", cir: "cir", avenue: "ave", ave: "ave",
        street: "st", st: "st", road: "rd", rd: "rd", drive: "dr", dr: "dr",
        court: "ct", ct: "ct", place: "pl", pl: "pl", terrace: "ter", ter: "ter",
        lane: "ln", ln: "ln",
    };
    return q.replace(/\b([a-z]+)\b/gi, (m) => map[m.toLowerCase()] || m);
}

async function googleFindPlace(q: string) {
    if (!GOOGLE_KEY) return { items: [], queryUsed: q };
    const url = new URL("https://maps.googleapis.com/maps/api/place/findplacefromtext/json");
    url.searchParams.set("key", GOOGLE_KEY);
    url.searchParams.set("inputtype", "textquery");
    url.searchParams.set("fields", "formatted_address,geometry,name");
    url.searchParams.set("input", q);
    url.searchParams.set("locationbias", "rectangle:39.5,-75.8|41.9,-72.9");
    const r = await fetch(url.toString(), { cache: "no-store" });
    const j = await r.json().catch(() => ({} as any));
    const items = Array.isArray(j.candidates) ? j.candidates.map((c: any) => ({
        label: c.formatted_address || c.name,
        lat: c?.geometry?.location?.lat,
        lng: c?.geometry?.location?.lng,
        provider: "google-findplace",
        confidence: 0.8,
    })).filter((x: any) => Number.isFinite(x.lat) && Number.isFinite(x.lng)) : [];
    return { items, queryUsed: q };
}

async function googleGeocode(q: string) {
    if (!GOOGLE_KEY) return { items: [], queryUsed: q };
    const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
    url.searchParams.set("key", GOOGLE_KEY);
    url.searchParams.set("address", q);
    url.searchParams.set("components", COMPONENTS);
    url.searchParams.set("bounds", TRI_STATE_BOUNDS);
    url.searchParams.set("region", "us");
    const r = await fetch(url.toString(), { cache: "no-store" });
    const j = await r.json().catch(() => ({} as any));
    const items = Array.isArray(j.results) ? j.results.map((res: any) => ({
        label: res.formatted_address,
        lat: res?.geometry?.location?.lat,
        lng: res?.geometry?.location?.lng,
        provider: "google-geocode",
        confidence: res.partial_match ? 0.6 : 0.9,
    })).filter((x: any) => Number.isFinite(x.lat) && Number.isFinite(x.lng)) : [];
    const normalized = normalizeSuffixes(q);
    const queryUsed = normalized !== q ? normalized : q;
    return { items, queryUsed };
}

async function nominatimSearch(q: string) {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("q", q);
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("limit", "8");
    url.searchParams.set("viewbox", "-75.8,41.9,-72.9,39.5");
    url.searchParams.set("bounded", "1");
    const r = await fetch(url.toString(), {
        headers: { "User-Agent": "diet-combo/1.0 (manual geocode)" },
        cache: "no-store",
    });
    const j = await r.json().catch(() => []);
    const items = Array.isArray(j) ? j.map((it: any) => ({
        label: it.display_name,
        lat: Number(it.lat),
        lng: Number(it.lon),
        provider: "nominatim",
        confidence: 0.5,
    })).filter(x => Number.isFinite(x.lat) && Number.isFinite(x.lng)) : [];
    return { items, queryUsed: q };
}

export async function GET(req: Request) {
    try {
        const { searchParams } = new URL(req.url);
        const q = (searchParams.get("q") || "").trim();
        const limit = Math.min(10, Math.max(3, Number(searchParams.get("limit") || 6)));
        if (!q) return NextResponse.json({ items: [], queryUsed: "" }, { headers: CORS_HEADERS });

        const fp = await googleFindPlace(q);
        let items = fp.items;

        if (!items.length) {
            const gg = await googleGeocode(q);
            items = gg.items;
        }
        if (!items.length) {
            const nm = await nominatimSearch(q);
            items = nm.items;
        }

        return NextResponse.json({ items: items.slice(0, limit), queryUsed: normalizeSuffixes(q) }, { headers: CORS_HEADERS });
    } catch (e: any) {
        return NextResponse.json({ items: [], error: e?.message || "search failed" }, { status: 500, headers: CORS_HEADERS });
    }
}
