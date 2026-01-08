// lib/api.js
function isBrowser() {
    return typeof window !== "undefined";
}

async function getServerBaseUrl() {
    const { headers } = await import("next/headers");
    const h = await headers(); // Next 15: must await
    const proto = h.get("x-forwarded-proto") ?? "http";
    const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
    return `${proto}://${host}`;
}

async function toURL(path) {
    const p = path.startsWith("/") ? path : `/${path}`;
    if (isBrowser()) return p;
    const base = await getServerBaseUrl();
    return `${base}${p}`;
}

export async function fetchJSON(path, init) {
    const full = await toURL(path);
    const started = Date.now();
    console.log("[fetchJSON] →", full, init?.method || "GET");
    const res = await fetch(full, { cache: "no-store", ...init });
    const contentType = res.headers.get("content-type") || "";
    const text = await res.text().catch(() => "");
    const ms = Date.now() - started;
    console.log("[fetchJSON] ←", full, "status:", res.status, "time:", ms + "ms");

    if (!res.ok) {
        console.error("[fetchJSON] error body:", text.slice(0, 400));
        const err = new Error(`[API] ${full} -> HTTP_${res.status} ${res.statusText}`);
        err.status = res.status;
        err.body = text;
        throw err;
    }
    try {
        const json = text ? JSON.parse(text) : null;
        if (Array.isArray(json)) {
            console.log(`[fetchJSON] parsed array length for ${full}:`, json.length);
        } else if (json && typeof json === "object") {
            console.log(`[fetchJSON] parsed object keys for ${full}:`, Object.keys(json));
        } else {
            console.log(`[fetchJSON] parsed scalar for ${full}:`, json);
        }
        return json;
    } catch {
        console.error("[fetchJSON] JSON parse failed, content-type:", contentType);
        console.error("[fetchJSON] body:", text.slice(0, 400));
        const err = new Error(`[API] JSON_PARSE_FAILED for ${full}`);
        err.body = text;
        throw err;
    }
}

/* ========= Public API ========= */

export async function fetchDrivers() {
    console.log("[fetchDrivers] start");
    const data = await fetchJSON("/api/mobile/routes");
    console.log("[fetchDrivers] got routes:", Array.isArray(data) ? data.length : "(not array)");
    return data;
}

export async function fetchDriver(driverId) {
    console.log("[fetchDriver] for id:", driverId);
    const routes = await fetchJSON("/api/mobile/routes");
    const found = routes.find((r) => String(r.id) === String(driverId)) ?? null;
    console.log("[fetchDriver] found:", !!found, found ? { id: found.id, name: found.name } : null);
    return found;
}

export async function fetchStops() {
    console.log("[fetchStops] start");
    const data = await fetchJSON("/api/mobile/stops");
    console.log("[fetchStops] got stops:", Array.isArray(data) ? data.length : "(not array)");
    return data;
}

export async function fetchStopsByIds(ids = []) {
    console.log("[fetchStopsByIds] ids:", ids);
    if (!ids?.length) return [];
    const all = await fetchJSON("/api/mobile/stops");
    const byId = new Map(all.map((s) => [String(s.id), s]));
    const result = ids.map((id) => byId.get(String(id))).filter(Boolean);
    console.log("[fetchStopsByIds] resolved:", result.length);
    return result;
}

export async function setStopCompleted(userId, stopId, completed) {
    console.log("[setStopCompleted] payload:", { userId, stopId, completed });
    return fetchJSON("/api/mobile/stop/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: userId, stopId: String(stopId), completed: !!completed }),
    });
}

