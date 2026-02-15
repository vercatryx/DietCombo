"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import { fetchDriver, fetchStops, fetchDriversPageData, setStopCompleted } from "../../../lib/api";
import { mapsUrlFromAddress } from "../../../lib/maps";
import {
    CheckCircle2, MapPin, Phone, Clock, Hash, ArrowLeft, Link as LinkIcon, X, Map as MapIcon, Crosshair
} from "lucide-react";
import SearchStops from "../../../components/drivers/SearchStops";
import { DateFilter } from "../../../components/routes/DateFilter";
import { getTodayInAppTz, toDateStringInAppTz, toCalendarDateKeyInAppTz } from "@/lib/timezone";

/** Lazy-load the shared Leaflet map */
const DriversMapLeaflet = dynamic(() => import("../../../components/routes/DriversMapLeaflet"), { ssr: false });

/** Fetch signature status — never cached */
async function fetchSignStatus() {
    const res = await fetch("/api/signatures/status", {
        cache: "no-store",
        headers: { "cache-control": "no-store" },
    });
    if (!res.ok) return [];
    return res.json(); // [{ userId, collected }]
}

/** Merge {userId → collected} onto stops as s.sigCollected */
function mergeSigCounts(stops: any[], sigRows: any[]) {
    const sigMap = new Map(sigRows.map((r) => [String(r.userId), Number(r.collected || 0)]));
    return stops.map((s) => ({ ...s, sigCollected: sigMap.get(String(s.userId)) ?? 0 }));
}

/** Normalize address for duplicate detection (ignoring unit/apt) */
function makeAddressKey(stop: any) {
    if (!stop) return "";
    const addrRaw = String(stop.address || "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();

    let addrNoUnit = addrRaw
        .replace(/\b(apt|apartment|ste|suite|unit|fl|floor|bldg|building)\b\.?\s*[a-z0-9-]+/gi, "")
        .replace(/#\s*\w+/g, "")
        .replace(/[.,]/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    addrNoUnit = addrNoUnit
        .replace(/\bstreet\b/g, "st")
        .replace(/\bavenue\b/g, "ave")
        .replace(/\broad\b/g, "rd")
        .replace(/\bdrive\b/g, "dr")
        .replace(/\bcourt\b/g, "ct")
        .replace(/\blane\b/g, "ln")
        .replace(/\bboulevard\b/g, "blvd")
        .replace(/\bparkway\b/g, "pkwy")
        .replace(/\bcircle\b/g, "cir")
        .replace(/\bplace\b/g, "pl")
        .replace(/\bnorth\b/g, "n")
        .replace(/\bsouth\b/g, "s")
        .replace(/\beast\b/g, "e")
        .replace(/\bwest\b/g, "w");

    addrNoUnit = addrNoUnit
        .replace(/[.,;:]/g, "")
        .replace(/\s+/g, " ")
        .trim();

    return addrNoUnit;
}

/** Listen for postMessage from the sign iframe */
function InlineMessageListener({ onDone }: { onDone?: () => void | Promise<void> }) {
    useEffect(() => {
        const handler = async (e: MessageEvent) => {
            if (!e?.data || e.data.type !== "signatures:done") return;
            try { await onDone?.(); } catch {}
        };
        window.addEventListener("message", handler);
        return () => window.removeEventListener("message", handler);
    }, [onDone]);
    return null;
}

export default function DriverDetailPage() {
    const { id } = useParams(); // driver id
    const router = useRouter();
    
    // Get delivery_date from URL search params, default to today (app timezone)
    const getInitialDate = () => {
        if (typeof window !== 'undefined') {
            const params = new URLSearchParams(window.location.search);
            const dateParam = params.get('delivery_date');
            if (dateParam) return dateParam;
        }
        return getTodayInAppTz();
    };
    
    const [selectedDate, setSelectedDate] = useState<string>(getInitialDate);
    
    // Sync selectedDate with URL params on mount and when URL changes
    useEffect(() => {
        if (typeof window !== 'undefined') {
            const params = new URLSearchParams(window.location.search);
            const dateParam = params.get('delivery_date');
            if (dateParam && dateParam !== selectedDate) {
                setSelectedDate(dateParam);
            } else if (!dateParam && selectedDate) {
                // If URL doesn't have date but state does, sync URL
                const url = new URL(window.location.href);
                url.searchParams.set('delivery_date', selectedDate);
                window.history.replaceState({}, '', url.toString());
            }
        }
    }, []);

    const [driver, setDriver] = useState<any>(null);
    const [stops, setStops] = useState<any[]>([]);       // ordered, server-truth only, with sigCollected
    const [allStops, setAllStops] = useState<any[]>([]); // for SearchStops, with sigCollected
    const [loading, setLoading] = useState(true);

    // Map sheet state + API from Leaflet
    const [mapOpen, setMapOpen] = useState(false);
    const mapApiRef = useRef<{ getMap: () => any } | null>(null);       // provided by DriversMapLeaflet.onExpose
    const myLocMarkerRef = useRef<any>(null);  // blue dot
    const myLocAccuracyRef = useRef<any>(null);// faint ring

    // Geolocation (ask on button click)
    const [myLoc, setMyLoc] = useState<{ lat: number; lng: number; acc?: number } | null>(null); // { lat, lng, acc } or null
    const askedOnceRef = useRef(false);

    // Signature sheet state
    const [sheetOpen, setSheetOpen] = useState(false);
    const [sheetTitle, setSheetTitle] = useState("");
    const [sheetToken, setSheetToken] = useState<string | null>(null);
    const [sheetUrl, setSheetUrl] = useState("");

    // Per-stop state
    const [completingId, setCompletingId] = useState(null);
    const [sigOpeningId, setSigOpeningId] = useState(null);

    // Reverse button state
    const [reversing, setReversing] = useState(false);

    /** Order "every" by the driver's stopIds without any local overlay */
    function orderByDriverStopIds(route: any, every: any[]) {
        const byId = new Map(every.map((s: any) => [String(s.id), s]));
        return (route?.stopIds ?? [])
            .map((sid: any) => byId.get(String(sid)))
            .filter(Boolean)
            .sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0));
    }

    async function reverseOnServer(routeId: string) {
        const res = await fetch("/api/route/reverse", {
            method: "POST",
            headers: { "Content-Type": "application/json", "cache-control": "no-store" },
            body: JSON.stringify({ routeId }),
            cache: "no-store",
        });
        return res.json();
    }

    /** Centralized reload — use route API (driver_route_order) when date set, else mobile APIs */
    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const dateParam = selectedDate || null;
            const sigRows = await fetchSignStatus().catch(() => []);

            if (dateParam) {
                const dateNorm = dateParam.split('T')[0].split(' ')[0];
                const pageData = await fetchDriversPageData(dateNorm);
                const dFromPage = pageData?.drivers?.find((r: any) => String(r.id) === String(id)) ?? null;
                if (pageData && dFromPage) {
                    const stopsById = new Map(pageData.allStops.map((s: any) => [String(s.id), s]));
                    const orderedServer = (dFromPage.stopIds || [])
                        .map((sid: any) => stopsById.get(String(sid)))
                        .filter(Boolean);
                    const orderedWithSigs = mergeSigCounts(orderedServer, sigRows);
                    const allWithSigs = mergeSigCounts(pageData.allStops, sigRows);
                    setDriver({ id: dFromPage.id, name: dFromPage.name, color: dFromPage.color, stopIds: dFromPage.stopIds });
                    setAllStops(allWithSigs);
                    setStops(orderedWithSigs);
                } else {
                    const d = await fetchDriver(id as string, dateNorm as any);
                    const every = await fetchStops(dateNorm as any);
                    const filteredEvery = every.filter((s: any) => {
                        const stopDate = s.delivery_date || s.deliveryDate;
                        if (!stopDate) return false;
                        const key = toCalendarDateKeyInAppTz(stopDate);
                        return key === dateNorm;
                    });
                    const orderedServer = orderByDriverStopIds(d, filteredEvery);
                    const orderedWithSigs = mergeSigCounts(orderedServer, sigRows);
                    const allWithSigs = mergeSigCounts(filteredEvery, sigRows);
                    setDriver(d);
                    setAllStops(allWithSigs);
                    setStops(orderedWithSigs);
                }
            } else {
                const d = await fetchDriver(id as string, null);
                const every = await fetchStops(null);
                const orderedServer = orderByDriverStopIds(d, every);
                const orderedWithSigs = mergeSigCounts(orderedServer, sigRows);
                const allWithSigs = mergeSigCounts(every, sigRows);
                setDriver(d);
                setAllStops(allWithSigs);
                setStops(orderedWithSigs);
            }
        } finally {
            setLoading(false);
        }

        // Scroll to hash (nice-to-have)
        requestAnimationFrame(() => {
            const hash = window.location.hash.replace("#", "");
            if (!hash) return;
            const el = document.getElementById(hash);
            if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
        });
    }, [id, selectedDate]);

    useEffect(() => {
        let active = true;
        (async () => {
            try {
                if (!active) return;
                await loadData();
            } catch (e) {
                console.error("Driver detail load failed:", e);
                if (active) setLoading(false);
            }
        })();
        return () => { active = false; };
    }, [loadData]);

    /* ================== Progress counts ================== */
    const total = stops.length;
    const doneCount = useMemo(() => stops.filter((s) => !!s?.completed).length, [stops]);
    const pctDone = total > 0 ? Math.min(100, Math.max(0, (doneCount / total) * 100)) : 0;

    // A "signature complete user" = sigCollected >= 5
    const sigUsersDone = useMemo(() => stops.filter((s) => Number(s?.sigCollected ?? 0) >= 5).length, [stops]);
    const pctSigs = total > 0 ? Math.min(100, Math.max(0, (sigUsersDone / total) * 100)) : 0;

    // Ensure progress values are valid numbers for rendering
    const safePctDone = Number.isFinite(pctDone) ? pctDone : 0;
    const safePctSigs = Number.isFinite(pctSigs) ? pctSigs : 0;

    // Debug logging (remove in production)
    useEffect(() => {
        if (stops.length > 0) {
            console.log('[Driver Progress]', {
                total: stops.length,
                doneCount,
                sigUsersDone,
                pctDone: safePctDone,
                pctSigs: safePctSigs,
                sampleStop: stops[0]
            });
        }
    }, [stops.length, doneCount, sigUsersDone, safePctDone, safePctSigs]);

    /* ================== Duplicate address detection ================== */
    const addressGroups = useMemo(() => {
        const groups = new Map(); // addressKey → stop[]
        for (const stop of stops) {
            const key = makeAddressKey(stop);
            if (!key) continue;
            if (!groups.has(key)) groups.set(key, []);
            groups.get(key).push(stop);
        }
        return groups;
    }, [stops]);

    const stopsWithDuplicateFlag = useMemo(() => {
        return stops.map((stop) => {
            const key = makeAddressKey(stop);
            const group = addressGroups.get(key);
            return {
                ...stop,
                hasDuplicateAtAddress: group && group.length > 1,
            };
        });
    }, [stops, addressGroups]);

    const reverseRoute = async () => {
        if (reversing) return;
        setReversing(true);
        try {
            const r = await reverseOnServer(id as string);
            if (!r?.ok) console.error("Reverse failed:", r?.error);
            await loadData(); // fresh after reverse
        } finally {
            setReversing(false);
        }
    };

    const closeSignSheet = async () => {
        setSheetOpen(false);
        setSheetToken(null);
        setSheetUrl("");
        try {
            await loadData(); // fresh sig counts after collection
        } catch {}
    };

    // Same endpoint your UsersTable uses
    async function ensureTokenForUser(userId: string) {
        const url = `/api/signatures/ensure-token/${encodeURIComponent(userId)}`;
        const res = await fetch(url, { method: "POST", headers: { "cache-control": "no-store" }, cache: "no-store" });
        const raw = await res.text();
        let json = null;
        try { json = JSON.parse(raw); } catch {}
        return { ok: res.ok, status: res.status, raw, json, url };
    }

    // Single-driver payload for Leaflet
    const mapDrivers = useMemo(() => {
        if (!driver) return [];
        return [{
            driverId: Number(id),
            name: driver.name || `Route ${id}`,
            color: driver.color || "#3665F3",
            stops: stops || [],
            polygon: [],
        }];
    }, [driver, stops, id]);

    /** Ask for geolocation exactly on button click (gesture-safe) */
    const requestGeolocationOnce = useCallback(async () => {
        if (askedOnceRef.current) return; // avoid repeat prompts
        askedOnceRef.current = true;

        if (!window.isSecureContext || !navigator?.geolocation) {
            console.debug("Geolocation unavailable: insecure context or missing API");
            return;
        }

        try {
            const perm = await navigator.permissions?.query?.({ name: "geolocation" });
            if (perm?.state === "denied") {
                console.debug("Geolocation previously denied by user");
                return;
            }
        } catch {}

        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const { latitude, longitude, accuracy } = pos.coords || {};
                if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
                    setMyLoc({ lat: latitude, lng: longitude, acc: accuracy });
                }
            },
            (err) => {
                console.debug("Geolocation error:", err?.message || err);
            },
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
        );
    }, []);

    /** If permission already granted, silently fetch coords on open */
    useEffect(() => {
        if (!mapOpen || myLoc || !navigator?.permissions || !navigator?.geolocation) return;
        navigator.permissions.query({ name: "geolocation" })
            .then((p) => {
                if (p.state === "granted") {
                    navigator.geolocation.getCurrentPosition(
                        (pos) => {
                            const { latitude, longitude, accuracy } = pos.coords || {};
                            if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
                                setMyLoc({ lat: latitude, lng: longitude, acc: accuracy });
                            }
                        },
                        () => {},
                        { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 }
                    );
                }
            })
            .catch(() => {});
    }, [mapOpen, myLoc]);

    /** Fit all stops + render blue dot from saved coords */
    useEffect(() => {
        if (!mapOpen || !mapApiRef.current?.getMap || typeof window === "undefined") return;
        const map = mapApiRef.current.getMap();
        if (!map) return;

        // Dynamically import Leaflet only on client side
        (async () => {
            try {
                const Leaflet = await import("leaflet");
                const L = Leaflet.default;

                // (A) Fit bounds to all stops with padding
                const pts = (stops || [])
                    .map(s => {
                        const lat = Number(s?.lat), lng = Number(s?.lng);
                        return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
                    })
                    .filter((p): p is [number, number] => p !== null);

                if (pts.length > 0) {
                    try {
                        const bounds = L.latLngBounds(pts);
                        map.fitBounds(bounds, { padding: [40, 40] });
                    } catch {}
                }

                // (B) Draw blue dot if we already have coords
                if (myLoc && Number.isFinite(myLoc.lat) && Number.isFinite(myLoc.lng)) {
                    try {
                        if (myLocMarkerRef.current) map.removeLayer(myLocMarkerRef.current);
                        if (myLocAccuracyRef.current) map.removeLayer(myLocAccuracyRef.current);
                    } catch {}

                    const dot = L.circleMarker([myLoc.lat, myLoc.lng], {
                        radius: 7,
                        color: "#0B66FF",
                        weight: 2,
                        fillColor: "#0B66FF",
                        fillOpacity: 0.9,
                    }).addTo(map);

                    let ring = null;
                    if (myLoc.acc !== undefined && Number.isFinite(myLoc.acc) && myLoc.acc > 0) {
                        ring = L.circle([myLoc.lat, myLoc.lng], {
                            radius: Math.min(myLoc.acc, 120),
                            color: "#0B66FF",
                            weight: 1,
                            fillColor: "#0B66FF",
                            fillOpacity: 0.08,
                        }).addTo(map);
                    }

                    myLocMarkerRef.current = dot;
                    myLocAccuracyRef.current = ring;
                }
            } catch (e) {
                console.error("Failed to load Leaflet", e);
            }
        })();

        // Cleanup on close
        return () => {
            try {
                if (myLocMarkerRef.current) { map.removeLayer(myLocMarkerRef.current); myLocMarkerRef.current = null; }
                if (myLocAccuracyRef.current) { map.removeLayer(myLocAccuracyRef.current); myLocAccuracyRef.current = null; }
            } catch {}
        };
    }, [mapOpen, stops, myLoc]);

    // Manual locate button inside the map sheet (optional convenience)
    const locateMe = useCallback(() => {
        const map = mapApiRef.current?.getMap?.();
        if (!map || !navigator?.geolocation) return;
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const { latitude, longitude } = pos.coords || {};
                if (Number.isFinite(latitude) && Number.isFinite(longitude)) {
                    map.flyTo([latitude, longitude], Math.max(map.getZoom() || 12, 15), { animate: true });
                }
            },
            () => {},
            { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
        );
    }, []);

    if (loading || !driver) {
        return <div className="muted" style={{ padding: 16 }}>Loading route…</div>;
    }

    const brandColor = driver.color || "#3665F3";
    
    return (
        <div className="container theme" style={{ "--brand": brandColor } as React.CSSProperties}>
            {/* Sticky mobile header */}
            <header className="sticky-header">
                <button className="icon-back" onClick={() => router.push("/drivers")} aria-label="Back to routes">
                    <ArrowLeft />
                </button>
                <div className="hdr-center">
                    <div className="hdr-top">
                        <div className="hdr-pill"><Hash /></div>
                        <div className="hdr-txt"><div className="title">Route {driver.name}</div></div>
                    </div>

                    {/* Progress #1: Completed stops */}
                    <div className="progress"><span style={{ width: `${safePctDone}%`, background: brandColor, display: 'block', height: '100%', borderRadius: '999px' }} /></div>

                    {/* Progress #2: Signature-complete users */}
                    <div className="progress sig"><span style={{ width: `${safePctSigs}%`, background: '#0ea5e9', display: 'block', height: '100%', borderRadius: '999px' }} /></div>
                </div>
                <div className="hdr-count">
                    <div className="strong">{doneCount}/{stops.length}</div>
                    <div className="muted tiny">Bags</div>
                    <div className="strong sig-ct">{sigUsersDone}/{stops.length}</div>
                    <div className="muted tiny">Sigs</div>
                </div>
            </header>

            {/* Desktop banner (hidden on small) */}
            <div
                className="card banner desktop-only"
                style={{ background: `linear-gradient(0deg, ${driver.color || "#3665F3"}, ${driver.color || "#3665F3"})`, color: "#fff" }}
            >
                <div className="card-content">
                    <div className="row">
                        <div className="flex">
                            <button className="icon-back" onClick={() => router.push("/drivers")} aria-label="Back to routes">
                                <ArrowLeft />
                            </button>
                            <div className="hdr-badge" style={{ background: "#fff", color: "var(--brand)" }}>
                                <Hash />
                            </div>
                            <div><h1 className="h1" style={{ color: "#fff" }}>{driver.name}</h1></div>
                        </div>
                        <div className="flex" />
                        <div style={{ textAlign: "right" }}>
                            <div className="xxl">{doneCount}/{stops.length}</div>
                            <div className="muted white">Bags</div>
                            <div className="xxl" style={{ marginTop: 6 }}>{sigUsersDone}/{stops.length}</div>
                            <div className="muted white">Signatures</div>
                        </div>
                    </div>

                    <div className="banner-progress">
                        <div className="muted white mb8">Progress</div>
                        <div className="progress"><span style={{ width: `${safePctDone}%`, background: "#fff", display: 'block', height: '100%', borderRadius: '999px' }} /></div>
                        <div className="progress sig" style={{ marginTop: 8 }}><span style={{ width: `${safePctSigs}%`, background: "#fff", display: 'block', height: '100%', borderRadius: '999px' }} /></div>
                    </div>
                </div>
            </div>

            {/* Date Filter */}
            <div style={{ marginBottom: 12, padding: '0 12px' }}>
                <DateFilter
                    selectedDate={selectedDate}
                    onDateChange={(date) => {
                        setSelectedDate(date);
                        const url = new URL(window.location.href);
                        if (date) {
                            url.searchParams.set('delivery_date', date);
                        } else {
                            url.searchParams.delete('delivery_date');
                        }
                        window.history.replaceState({}, '', url.toString());
                    }}
                    onClear={() => {
                        const todayStr = getTodayInAppTz();
                        setSelectedDate(todayStr);
                        const url = new URL(window.location.href);
                        url.searchParams.set('delivery_date', todayStr);
                        window.history.replaceState({}, '', url.toString());
                    }}
                    datesSource="orders"
                />
            </div>

            {/* Search */}
            <div className="search-wrap">
                <SearchStops allStops={allStops} drivers={[driver]} themeColor={driver.color || "#3665F3"} />
            </div>

            {/* View Map button — requests geolocation on click, then opens sheet */}
            <div style={{ textAlign: "center", marginBottom: 12 }}>
                <button
                    className="btn btn-primary"
                    onClick={() => { requestGeolocationOnce(); setMapOpen(true); }}
                    style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
                >
                    <MapIcon className="i16" /> View Map
                </button>
            </div>

            {/* Stops list */}
            <section className="grid">
                {stopsWithDuplicateFlag.length === 0 ? (
                    <div style={{
                        textAlign: "center",
                        padding: "48px 24px",
                        color: "var(--muted, #6b7280)"
                    }}>
                        <p style={{ fontSize: "16px", fontWeight: 500, marginBottom: "8px" }}>No stops assigned</p>
                        <p style={{ fontSize: "14px" }}>This route currently has no delivery stops assigned.</p>
                    </div>
                ) : (
                    stopsWithDuplicateFlag.map((s, idx) => {
                    const done = !!s.completed;
                    const sigs = Number(s.sigCollected ?? 0);
                    const sigDone = sigs >= 5;
                    const isLoading = completingId === s.id;

                    const mapsUrl = mapsUrlFromAddress({
                        address: s.address, city: s.city, state: s.state, zip: s.zip,
                    });

                    let completeLabel = "Mark Complete";
                    let completeClass = "btn btn-outline";
                    let completeDisabled = false;
                    if (done) { completeLabel = "Completed"; completeClass = "btn btn-outline btn-muted"; completeDisabled = true; }
                    else if (isLoading) { completeLabel = "Saving…"; completeClass = "btn btn-outline btn-loading"; completeDisabled = true; }

                    const showSigBtn = !sigDone;
                    const sigBtnIsOpening = sigOpeningId === s.id;

                    return (
                        <div key={s.id} id={`stop-${s.id}`} className={`card stop-card ${done ? "done-bg" : ""} ${s.hasDuplicateAtAddress ? "duplicate-address" : ""}`}>
                            <div className="color-rail" style={{ background: "var(--brand)" }} />
                            <div className="card-content">
                                <div className="row top">
                                    <div className="main">
                                        <div className="flex head">
                                            {done ? <CheckCircle2 color="var(--success)" /> : <span className="pill">{idx + 1}</span>}
                                            <h2 className="title2" title={s.name}>{s.name}</h2>
                                            <span className="chip" title="Collected signatures for this customer">{sigs}/5 sigs</span>
                                            {done && <span className="muted d14">Done</span>}
                                        </div>

                                        <div className="kv">
                                            <div className="address-line" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                                <MapPin className="i22" style={{ color: "var(--brand)", flexShrink: 0 }} />
                                                {(() => {
                                                    const unit =
                                                        s.apt ?? s.unit ?? s.apartment ?? s.suite ?? s.flat ?? s.unitNumber ?? null;
                                                    return (
                                                        <span className="addr-text" style={{ lineHeight: 1.4, fontSize: 15 }}>
                                                            {s.address}
                                                            {unit && (
                                                                <span
                                                                    style={{
                                                                        color: "var(--brand)",
                                                                        fontWeight: 700,
                                                                        fontSize: "1.05em",
                                                                        marginLeft: 4,
                                                                    }}
                                                                >
                                                                    (Unit {unit})
                                                                </span>
                                                            )}
                                                            , {s.city}, {s.state} {s.zip}
                                                        </span>
                                                    );
                                                })()}
                                            </div>

                                            {/* Temporarily add order tracking info - always show for debugging */}
                                            <div className="flex muted wrap" style={{ fontSize: 12, marginTop: 4, padding: 6, background: "#f3f4f6", borderRadius: 6 }}>
                                                <span><strong>Order ID:</strong> {s.orderId ? s.orderId.substring(0, 8) + "..." : "N/A"}</span>
                                                <span style={{ marginLeft: 8 }}>
                                                    <strong>Order Date:</strong> {s.orderDate ? new Date(s.orderDate).toLocaleDateString() : "N/A"}
                                                </span>
                                                <span style={{ marginLeft: 8 }}>
                                                    <strong>Delivery Date:</strong> {s.deliveryDate ? new Date(s.deliveryDate).toLocaleDateString() : "N/A"}
                                                </span>
                                            </div>

                                            {s.phone && (
                                                <div className="flex muted wrap">
                                                    <Phone className="i16" />
                                                    <a className="link" href={`tel:${s.phone}`}>{s.phone}</a>
                                                </div>
                                            )}
                                            {s.dislikes && (
                                                <div className="flex muted wrap">
                                                    <span className="b600">Notes:</span>
                                                    <span>{s.dislikes}</span>
                                                </div>
                                            )}
                                            {done && (
                                                <div className="flex muted wrap">
                                                    <Clock className="i16" />
                                                    <span>Completed</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Actions */}
                                    <div className="mobile-actions">
                                        <a className="btn btn-primary block" href={mapsUrl} target="_blank" rel="noreferrer">
                                            Open in Maps
                                        </a>

                                        {showSigBtn && (
                                            <button
                                                className={`${sigBtnIsOpening ? "btn btn-outline btn-loading" : "btn btn-outline"} block`}
                                                onClick={async () => {
                                                    setSigOpeningId(s.id);

                                                    // Open sheet immediately
                                                    setSheetTitle(s.name || "Sign");
                                                    setSheetOpen(true);
                                                    setSheetToken(null);
                                                    setSheetUrl("");

                                                    try {
                                                        const result = await ensureTokenForUser(s.userId);
                                                        if (!result.ok || !result.json?.sign_token) {
                                                            setSheetUrl("/sign/INVALID_TOKEN");
                                                        } else {
                                                            const token = String(result.json.sign_token);
                                                            setSheetToken(token);
                                                            setSheetUrl(`/sign/${token}`);
                                                        }
                                                    } catch (e) {
                                                        setSheetUrl("/sign/INVALID_TOKEN");
                                                    } finally {
                                                        setSigOpeningId(null);
                                                    }
                                                }}
                                                disabled={sigBtnIsOpening}
                                                title="Open the public signature page"
                                            >
                                                <LinkIcon style={{ height: 16, width: 16 }} />
                                                {sigBtnIsOpening ? "Opening…" : "Collect Signatures"}
                                            </button>
                                        )}

                                        <button
                                            className={`${completeClass} block`}
                                            onClick={async () => {
                                                if (completeDisabled) return;
                                                setCompletingId(s.id);

                                                try {
                                                    const res = await setStopCompleted(s.userId, s.id, true);
                                                    if (res?.ok && res?.stop?.completed) {
                                                        setStops(prev => prev.map(x => (x.id === s.id ? { ...x, completed: true } : x)));
                                                    } else {
                                                        console.error("setStopCompleted failed", res);
                                                    }
                                                } catch (err) {
                                                    console.error("setStopCompleted error", err);
                                                } finally {
                                                    setCompletingId(null);
                                                }
                                            }}
                                            disabled={completeDisabled}
                                            title={done ? "Completed" : "Mark this stop as completed"}
                                        >
                                            {completeLabel}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })
                )}
            </section>

            <div style={{ marginTop: 24, textAlign: "center", width: "80%" }}>
                <button
                    className={`btn btn-outline ${reversing ? "btn-loading" : ""}`}
                    onClick={reverseRoute}
                    disabled={reversing}
                    aria-disabled={reversing}
                    title={reversing ? "Reversing…" : "Reverse the order of this route"}
                >
                    {reversing ? "Reversing…" : "Reverse Route"}
                </button>
            </div>

            {/* MAP Full-screen Sheet */}
            {mapOpen && (
                <div className="mapsheet">
                    <div className="mapsheet-backdrop" onClick={() => setMapOpen(false)} />
                    <div className="mapsheet-panel">
                        <div className="mapsheet-header">
                            <div className="mapsheet-title">Driver Map</div>
                            <div className="mapsheet-actions">
                                <button className="seg" onClick={locateMe} title="Locate me">
                                    <Crosshair className="i16" /> Locate
                                </button>
                                <button className="icon-btn" onClick={() => setMapOpen(false)} aria-label="Close"><X /></button>
                            </div>
                        </div>
                        <div className="mapsheet-body">
                            {(() => {
                                const Component = DriversMapLeaflet as any;
                                return <Component
                                    drivers={mapDrivers}
                                    unrouted={[]}
                                    showRouteLinesDefault
                                    onReassign={async () => {}}
                                    onExpose={(api: any) => { mapApiRef.current = api; }}
                                />;
                            })()}
                        </div>
                    </div>
                </div>
            )}

            {/* SIGNATURE Bottom Sheet */}
            {sheetOpen && (
                <div className="sheet">
                    <div className="sheet-backdrop" onClick={closeSignSheet} />
                    <div className="sheet-panel">
                        <div className="sheet-header">
                            <div className="sheet-title">{sheetTitle}</div>
                            <button className="icon-btn" onClick={closeSignSheet} aria-label="Close"><X /></button>
                        </div>

                        <iframe
                            src={sheetUrl || "about:blank"}
                            className="sheet-frame"
                            title="Signature"
                            sandbox="allow-scripts allow-same-origin allow-forms"
                        />
                    </div>
                </div>
            )}

            <InlineMessageListener onDone={closeSignSheet} />

            {/* Page CSS */}
            <style
                dangerouslySetInnerHTML={{
                    __html: `:root{
  --bg:#f7f8fb; --border:#e8eaef; --muted:#6b7280; --radius:14px;
  --shadow:0 6px 18px rgba(16,24,40,.06), 0 1px 6px rgba(16,24,40,.05);
  --success:#16a34a; --tap: rgba(0,0,0,.06);
  --sigbar:#0ea5e9;
}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:var(--bg);color:#111;
  -webkit-tap-highlight-color: transparent;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial}
.container{width:100%;max-width:1200px;margin:0 auto;padding:12px 12px calc(12px + env(safe-area-inset-bottom));}

.sticky-header{position: sticky; top: 0; z-index: 50; display:flex; align-items:center; gap:10px;
  background: #fff; border-bottom:1px solid var(--border); padding:10px 12px;}
.icon-back{display:inline-grid; place-items:center; width:40px; height:40px; border-radius:10px;
  border:1px solid var(--border); background:#fff; cursor:pointer;}
.icon-back svg{width:20px;height:20px}
.hdr-center{flex:1; min-width:0}
.hdr-top{display:flex; align-items:center; gap:10px}
.hdr-pill{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:#e7eefc;color:var(--brand);box-shadow:inset 0 0 0 1px rgba(39,72,216,.12)}
.hdr-txt .title{font-weight:800; font-size:16px; line-height:1.1}
.hdr-count{min-width:64px; text-align:right}
.hdr-count .strong{font-weight:800}
.hdr-count .sig-ct{margin-top:4px}
.tiny{font-size:11px}
.progress{width:100%;height:6px;border-radius:999px;background:#f1f5f9;overflow:hidden;margin-top:6px}
.progress>span{display:block;height:100%;border-radius:999px;background:var(--brand);transition:width .25s ease}
.progress.sig{background:#eef6fb}
.progress.sig>span{background:var(--sigbar)}

.desktop-only{display:none}
@media (min-width: 780px){
  .desktop-only{display:block}
  .sticky-header{display:none}
  .container{padding:24px 24px calc(24px + env(safe-area-inset-bottom))}
}

.card{position:relative;border:1px solid var(--border);background:#fff;border-radius:18px;box-shadow:var(--shadow);overflow:hidden}
.card-content{padding:14px}
.color-rail{position:absolute;left:0;top:0;bottom:0;width:6px;border-top-left-radius:18px;border-bottom-left-radius:18px}
.row{display:flex;align-items:center;justify-content:space-between;gap:10px}
.row.top{align-items:flex-start}
.flex{display:flex;align-items:center;gap:8px}
.grid{display:grid;gap:12px}
.h1{font-size:28px;font-weight:800;margin:0}
.muted{color:var(--muted)}
.hdr-badge{width:44px;height:44px;border-radius:12px;display:grid;place-items:center;background:#e7eefc;color:#2748d8;box-shadow:inset 0 0 0 1px rgba(39,72,216,.12)}
.banner .xxl{font-size:28px;font-weight:800}
.white{color:#fff}
.mb8{margin-bottom:8px}
.banner-progress{margin-top:16px;background:rgba(255,255,255,.15);border-radius:12px;padding:16px}
.banner-progress .progress{height:8px}
.banner-progress .progress + .progress{margin-top:10px}

.pill{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border-radius:50%;
  background:#fff;color:var(--brand);border:2px solid var(--brand);font-weight:700;font-size:14px;flex-shrink:0}
.kv{display:grid;gap:6px;margin-top:8px}
.link{color:#1d4ed8;text-decoration:none}
.link:hover{text-decoration:underline}
.title2{font-weight:800; font-size:17px; margin:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis}
.d14{font-size:14px}
.wrap{flex-wrap:wrap}
.i16{width:16px;height:16px}
.i22{width:22px;height:22px;vertical-align:middle}
.b600{font-weight:600}
.chip{font-size:12px;padding:2px 8px;border:1px solid var(--border);border-radius:12px;background:#f8fafc}
.done-bg{ background:#ECFDF5; }

/* Duplicate address highlighting */
.duplicate-address{ background:#FEFCE8; }
.duplicate-address.done-bg{ background:#ECFDF5; border:3px solid #FDE047; }

.btn{display:inline-flex; align-items:center; justify-content:center; gap:8px;
  padding:12px 14px; border-radius:12px; border:1px solid var(--border); background:#111; color:#fff;
  cursor:pointer; user-select:none; position:relative; touch-action:manipulation;}
.btn:active{transform:translateY(1px); background: #0f0f0f;}
.btn.block{width:100%}
.btn-primary{background:var(--brand); border-color:var(--brand)}
.btn-outline{background:#fff;color:#111;border-color:var(--border)}
.btn-muted{background:#f3f4f6;color:#6b7280;cursor:default}
.btn-loading{opacity:.85;cursor:wait}
.btn-loading::after{content:""; position:absolute; right:12px; width:16px; height:16px; border-radius:50%;
  border:2px solid currentColor; border-top-color: transparent; animation: spin .7s linear infinite;}
@keyframes spin{to{transform:rotate(360deg)}}

.mobile-actions{display:grid; gap:8px; width:100%; max-width:520px}
@media (min-width: 780px){
  .mobile-actions{display:flex; flex-direction:column; width:auto; min-width:180px}
}

.search-wrap{margin:10px 0 14px}

/* SIGNATURE Bottom sheet */
.sheet{position:fixed;inset:0;z-index:1000;display:grid}
.sheet-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.35)}
.sheet-panel{position:absolute;left:0;right:0;bottom:0;height:92vh;max-height:760px;background:#fff;
  border-top-left-radius:18px;border-top-right-radius:18px;box-shadow:0 -10px 30px rgba(0,0,0,.25);display:flex;flex-direction:column;}
.sheet-header{display:flex;align-items:center;justify-content:space-between;padding:12px;border-bottom:1px solid #eee}
.sheet-title{font-weight:700}
.icon-btn{border:1px solid #e5e7eb;background:#fff;border-radius:10px;padding:8px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer}
.sheet-frame{border:0;width:100%;height:100%;border-bottom-left-radius:18px;border-bottom-right-radius:18px}

/* MAP Full-screen sheet */
.mapsheet{position:fixed;inset:0;z-index:1200;display:grid}
.mapsheet-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.35)}
.mapsheet-panel{position:absolute;inset:0;background:#fff;display:flex;flex-direction:column}
.mapsheet-header{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid #eee}
.mapsheet-title{font-weight:800}
.mapsheet-actions{display:flex;align-items:center;gap:8px}
.seg{padding:8px 10px;border:1px solid var(--border);border-radius:10px;background:#fff;display:inline-flex;gap:6px;align-items:center;cursor:pointer;font-weight:600}
.mapsheet-body{flex:1;min-height:0}
.mapsheet-body > div{height:100%;width:100%}

/* Hide desktop overlays of DriversMapLeaflet (search/legend) in the mobile sheet */
.mapsheet-body > div > div:nth-child(1),
.mapsheet-body > div > div:nth-child(2){
  display:none !important;
}

.stop-card{ overflow:hidden; }
@media (max-width: 780px){
  .row.top{ flex-direction: column; align-items: stretch; }
  .mobile-actions{ display: grid; grid-template-columns: 1fr; gap: 10px; width: 100%; }
  .btn.block{ width: 100%; }
  .card-content{ padding-right: 14px; }
  .title2{ max-width: 100%; }
}`,
                }}
            />
        </div>
    );
}

