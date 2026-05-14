import { getApiBaseUrl } from '@/lib/config';
import { toCalendarDateKeyInAppTz } from '@/lib/timezone';

/** ngrok free tier may inject an interstitial; this header skips it for programmatic requests. */
function ngrokHeaders(): Record<string, string> {
    const base = getApiBaseUrl();
    if (/ngrok\.app|ngrok-free\.app|ngrok\.io/i.test(base)) {
        return { 'ngrok-skip-browser-warning': 'true' };
    }
    return {};
}

export type DriverCard = {
    id: string | number;
    name: string;
    color: string;
    stops: StopRecord[];
    stopIds: string[];
    totalStops: number;
    completedStops: number;
};

export type StopRecord = Record<string, any>;

async function fetchJSON(path: string, init?: RequestInit): Promise<any> {
    const base = getApiBaseUrl();
    const p = path.startsWith('/') ? path : `/${path}`;
    const url = `${base}${p}`;
    const res = await fetch(url, {
        cache: 'no-store',
        ...init,
        headers: { ...ngrokHeaders(), ...init?.headers },
    });
    const text = await res.text().catch(() => '');
    if (!res.ok) {
        throw new Error(`[API] ${url} -> HTTP_${res.status} ${text.slice(0, 200)}`);
    }
    try {
        return text ? JSON.parse(text) : null;
    } catch {
        throw new Error(`[API] JSON parse failed for ${url}`);
    }
}

/**
 * Same mapping as dietcombo `fetchDriversPageData` in lib/api.js.
 */
export async function fetchDriversPageData(deliveryDate: string): Promise<{ drivers: DriverCard[]; allStops: StopRecord[] } | null> {
    if (!deliveryDate) return null;
    const url = `/api/route/routes?delivery_date=${encodeURIComponent(deliveryDate)}&light=1&exclude_produce=1`;
    const data = await fetchJSON(url);
    if (!data?.routes) return { drivers: [], allStops: [] };
    const routes = data.routes || [];
    const unrouted = data.unrouted || [];
    const drivers: DriverCard[] = routes.map((r: any) => ({
        id: r.driverId,
        name: r.driverName,
        color: r.color ?? '#3665F3',
        stops: r.stops || [],
        stopIds: (r.stops || []).map((s: any) => String(s.id)),
        totalStops: (r.stops || []).length,
        completedStops: (r.stops || []).filter((s: any) => !!s?.completed).length,
    }));
    const allStops = [...routes.flatMap((r: any) => r.stops || []), ...unrouted];
    return { drivers, allStops };
}

export async function fetchDriversFallback(deliveryDate: string | null): Promise<any[]> {
    let url = '/api/mobile/routes';
    if (deliveryDate) url += `?delivery_date=${encodeURIComponent(deliveryDate)}`;
    return fetchJSON(url);
}

export async function fetchStopsFallback(deliveryDate: string | null): Promise<any[]> {
    let url = '/api/mobile/stops';
    if (deliveryDate) url += `?delivery_date=${encodeURIComponent(deliveryDate)}`;
    return fetchJSON(url);
}

export async function loadDriversPage(deliveryDate: string): Promise<{ drivers: DriverCard[]; allStops: StopRecord[] }> {
    const dateNorm = deliveryDate.split('T')[0].split(' ')[0];
    const pageData = await fetchDriversPageData(dateNorm);
    if (pageData && pageData.drivers.length > 0) {
        return pageData;
    }
    const [d, s] = await Promise.all([fetchDriversFallback(dateNorm), fetchStopsFallback(dateNorm)]);
    const driversRaw = Array.isArray(d) ? d : [];
    const stopsRaw = Array.isArray(s) ? s : [];
    const drivers: DriverCard[] = driversRaw.map((r: any) => ({
        id: r.id,
        name: r.name,
        color: r.color ?? '#3665F3',
        stops: [],
        stopIds: (r.stopIds || []).map((x: any) => String(x)),
        totalStops: r.totalStops ?? 0,
        completedStops: r.completedStops ?? 0,
    }));
    const byId = new Map(stopsRaw.map((st: any) => [String(st.id), st]));
    for (const dr of drivers) {
        dr.stops = dr.stopIds.map((sid) => byId.get(String(sid))).filter(Boolean);
    }
    return { drivers, allStops: stopsRaw };
}

export type OrdersDatesResponse = { dates?: Record<string, number> };

export async function fetchOrdersDates(): Promise<Map<string, number>> {
    try {
        const data = (await fetchJSON('/api/route/orders-dates')) as OrdersDatesResponse;
        const datesMap = new Map<string, number>();
        if (data?.dates && typeof data.dates === 'object') {
            Object.entries(data.dates).forEach(([date, count]) => {
                datesMap.set(date, count as number);
            });
        }
        return datesMap;
    } catch {
        return new Map();
    }
}

export async function postRouteCleanup(deliveryDate: string): Promise<void> {
    const base = getApiBaseUrl();
    const url = `${base}/api/route/cleanup?day=all&delivery_date=${encodeURIComponent(deliveryDate)}`;
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' } }).catch(() => {});
}

export async function fetchDriverDetail(driverId: string, deliveryDate: string): Promise<{ driver: DriverCard | null; allStops: StopRecord[]; orderedStops: StopRecord[] }> {
    const dateNorm = deliveryDate.split('T')[0].split(' ')[0];
    const pageData = await fetchDriversPageData(dateNorm);
    const dFromPage = pageData?.drivers?.find((r) => String(r.id) === String(driverId)) ?? null;
    if (pageData && dFromPage) {
        const stopsById = new Map(pageData.allStops.map((s: any) => [String(s.id), s]));
        const orderedServer = (dFromPage.stopIds || []).map((sid: any) => stopsById.get(String(sid))).filter(Boolean);
        return {
            driver: dFromPage,
            allStops: pageData.allStops,
            orderedStops: orderedServer,
        };
    }
    const routes = await fetchDriversFallback(dateNorm);
    const found = routes.find((r: any) => String(r.id) === String(driverId)) ?? null;
    const every = await fetchStopsFallback(dateNorm);
    const filteredEvery = every.filter((s: any) => {
        const stopDate = s.delivery_date || s.deliveryDate;
        if (!stopDate) return false;
        const key = toCalendarDateKeyInAppTz(stopDate);
        return key === dateNorm;
    });
    const byId = new Map(filteredEvery.map((s: any) => [String(s.id), s]));
    const ordered = (found?.stopIds ?? []).map((sid: any) => byId.get(String(sid))).filter(Boolean);
    const driver: DriverCard | null = found
        ? {
              id: found.id,
              name: found.name,
              color: found.color ?? '#3665F3',
              stops: ordered,
              stopIds: (found.stopIds || []).map((x: any) => String(x)),
              totalStops: ordered.length,
              completedStops: ordered.filter((s: any) => s?.completed).length,
          }
        : null;
    return { driver, allStops: filteredEvery, orderedStops: ordered };
}

export type DeliveryProofResult =
    | { success: true; urls?: string[]; url?: string }
    | { success: false; error?: string };

/** Multipart upload to `POST /api/delivery/proof` (same as web `processDeliveryProof`). */
export async function postDeliveryProof(orderIdOrNumber: string, fileUris: string[]): Promise<DeliveryProofResult> {
    const base = getApiBaseUrl();
    const form = new FormData();
    for (let i = 0; i < fileUris.length; i++) {
        form.append('files', { uri: fileUris[i], name: `delivery-proof-${i + 1}.jpg`, type: 'image/jpeg' } as any);
    }
    form.append('orderNumber', orderIdOrNumber);
    const res = await fetch(`${base}/api/delivery/proof`, {
        method: 'POST',
        body: form,
        headers: ngrokHeaders(),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
        return { success: false, error: String(json?.error || `HTTP ${res.status}`) };
    }
    if (json && json.success === true) {
        return { success: true, urls: json.urls as string[] | undefined, url: json.url as string | undefined };
    }
    return { success: false, error: String(json?.error || 'Upload failed') };
}
