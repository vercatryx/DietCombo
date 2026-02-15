"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { useParams, useRouter } from "next/navigation";
import { fetchDriver, fetchStops, fetchDriversPageData } from "../../../lib/api";
import { mapsUrlFromAddress } from "../../../lib/maps";
import {
    MapPin, Phone, Hash, ArrowLeft, X, Map as MapIcon, Crosshair, Camera, ExternalLink
} from "lucide-react";
import SearchStops from "../../../components/drivers/SearchStops";
import { DateFilter } from "../../../components/routes/DateFilter";
import { getTodayInAppTz, toDateStringInAppTz, toCalendarDateKeyInAppTz } from "@/lib/timezone";

/** Lazy-load the shared Leaflet map */
const DriversMapLeaflet = dynamic(() => import("../../../components/routes/DriversMapLeaflet"), { ssr: false });

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
    const [stops, setStops] = useState<any[]>([]);       // ordered, server-truth only (proofUrl from API)
    const [allStops, setAllStops] = useState<any[]>([]); // for SearchStops
    const [loading, setLoading] = useState(true);
    const [proofModalStop, setProofModalStop] = useState<any>(null);

    // Map sheet state + API from Leaflet
    const [mapOpen, setMapOpen] = useState(false);
    const mapApiRef = useRef<{ getMap: () => any } | null>(null);       // provided by DriversMapLeaflet.onExpose
    const myLocMarkerRef = useRef<any>(null);  // blue dot
    const myLocAccuracyRef = useRef<any>(null);// faint ring

    // Geolocation (ask on button click)
    const [myLoc, setMyLoc] = useState<{ lat: number; lng: number; acc?: number } | null>(null); // { lat, lng, acc } or null
    const askedOnceRef = useRef(false);

    // Reverse button was removed; keep variable so any stale reference does not throw
    const reversing = false;

    /** Order "every" by the driver's stopIds (used only when no date or fallback path). */
    function orderByDriverStopIds(route: any, every: any[]) {
        const byId = new Map(every.map((s: any) => [String(s.id), s]));
        return (route?.stopIds ?? [])
            .map((sid: any) => byId.get(String(sid)))
            .filter(Boolean)
            .sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0));
    }

    /** Centralized reload. When delivery_date is set we use route API (GET /api/route/routes) which orders stops by driver_route_order (same as Reorganize Routes). Otherwise we use mobile APIs and order by route.stopIds. */
    const loadData = useCallback(async () => {
        setLoading(true);
        try {
            const dateParam = selectedDate || null;

            if (dateParam) {
                const dateNorm = dateParam.split('T')[0].split(' ')[0];
                const pageData = await fetchDriversPageData(dateNorm);
                const dFromPage = pageData?.drivers?.find((r: any) => String(r.id) === String(id)) ?? null;
                if (pageData && dFromPage) {
                    const stopsById = new Map(pageData.allStops.map((s: any) => [String(s.id), s]));
                    const orderedServer = (dFromPage.stopIds || [])
                        .map((sid: any) => stopsById.get(String(sid)))
                        .filter(Boolean);
                    setDriver({ id: dFromPage.id, name: dFromPage.name, color: dFromPage.color, stopIds: dFromPage.stopIds });
                    setAllStops(pageData.allStops);
                    setStops(orderedServer);
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
                    setDriver(d);
                    setAllStops(filteredEvery);
                    setStops(orderedServer);
                }
            } else {
                const d = await fetchDriver(id as string, null);
                const every = await fetchStops(null);
                const orderedServer = orderByDriverStopIds(d, every);
                setDriver(d);
                setAllStops(every);
                setStops(orderedServer);
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

    /* ================== Progress (proof only) ================== */
    const total = stops.length;
    const proofCount = useMemo(() => stops.filter((s) => !!(s?.proofUrl || s?.proof_url)?.trim()).length, [stops]);
    const pctProof = total > 0 ? Math.min(100, Math.max(0, (proofCount / total) * 100)) : 0;
    const safePctProof = Number.isFinite(pctProof) ? pctProof : 0;

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

    /** Take photo = open delivery page for this order (same flow as /delivery/100992). Uses order number or order ID (UUID). */
    const deliveryProofUrl = (orderNumber: string | number | null | undefined, orderId: string | null | undefined) => {
        const num = orderNumber != null && String(orderNumber).trim() !== "" ? String(orderNumber) : null;
        const id = orderId != null && String(orderId).trim() !== "" ? String(orderId) : null;
        if (num) return `/delivery/${encodeURIComponent(num)}`;
        if (id) return `/delivery/${encodeURIComponent(id)}`;
        return null;
    };

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

    const brandColor = (driver?.color || "#3665F3") as string;

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
                        <div className="hdr-txt"><div className="title">Route {driver?.name ?? "…"}</div></div>
                    </div>

                    {/* Proof progress — hide when loading */}
                    {!loading && driver && (
                        <>
                            <div className="progress proof"><span style={{ width: `${safePctProof}%`, background: '#0ea5e9', display: 'block', height: '100%', borderRadius: '999px' }} /></div>
                        </>
                    )}
                </div>
                <div className="hdr-count">
                    {loading ? (
                        <div className="muted tiny">Loading…</div>
                    ) : (
                        <>
                            <div className="strong proof-ct">{proofCount}/{stops.length}</div>
                            <div className="muted tiny">Proof</div>
                        </>
                    )}
                </div>
            </header>

            {/* Desktop banner (hidden on small) */}
            {!loading && driver && (
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
                                <div className="xxl">{proofCount}/{stops.length}</div>
                                <div className="muted white">Proof</div>
                            </div>
                        </div>

                        <div className="banner-progress">
                            <div className="muted white mb8">Progress</div>
                            <div className="progress proof"><span style={{ width: `${safePctProof}%`, background: "#fff", display: 'block', height: '100%', borderRadius: '999px' }} /></div>
                        </div>
                    </div>
                </div>
            )}

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

            {/* Search — only when we have driver and stops data */}
            {!loading && driver && (
                <div className="search-wrap">
                    <SearchStops allStops={allStops} drivers={[driver]} themeColor={driver.color || "#3665F3"} />
                </div>
            )}

            {/* View Map button — only when we have driver */}
            {!loading && driver && (
                <div style={{ textAlign: "center", marginBottom: 12 }}>
                    <button
                        className="btn btn-primary"
                        onClick={() => { requestGeolocationOnce(); setMapOpen(true); }}
                        style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
                    >
                        <MapIcon className="i16" /> View Map
                    </button>
                </div>
            )}

            {/* Stops list — show loading state while fetching */}
            <section className="grid">
                {loading ? (
                    <div className="loading-stops" style={{ textAlign: "center", padding: "48px 24px", color: "var(--muted, #6b7280)" }}>
                        <div className="loading-spinner" style={{ width: 32, height: 32, margin: "0 auto 12px", border: "3px solid var(--border)", borderTopColor: "var(--brand)", borderRadius: "50%", animation: "spin .7s linear infinite" }} />
                        <p style={{ fontSize: "16px", fontWeight: 500 }}>Loading stops…</p>
                    </div>
                ) : !driver ? (
                    <div style={{ textAlign: "center", padding: "48px 24px", color: "var(--muted, #6b7280)" }}>
                        <p style={{ fontSize: "16px", fontWeight: 500 }}>Route not found.</p>
                    </div>
                ) : stopsWithDuplicateFlag.length === 0 ? (
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
                    const hasProof = !!((s.proofUrl || s.proof_url) || "").trim();
                    const proofUrl = (s.proofUrl || s.proof_url) || "";
                    const takePhotoUrl = deliveryProofUrl(s.orderNumber ?? s.order_number, s.orderId);

                    const mapsUrl = mapsUrlFromAddress({
                        address: s.address, city: s.city, state: s.state, zip: s.zip,
                    });

                    return (
                        <div key={s.id} id={`stop-${s.id}`} className={`card stop-card ${hasProof ? "stop-card-has-proof" : ""} ${s.hasDuplicateAtAddress ? "duplicate-address" : ""}`}>
                            <div className="color-rail" style={{ background: hasProof ? "#059669" : "var(--brand)" }} />
                            <div className="card-content">
                                <div className="row top">
                                    <div className="main">
                                        <div className="flex head">
                                            <span className="pill">{idx + 1}</span>
                                            <h2 className="title2" title={s.name}>{s.name}</h2>
                                            <span className={`chip ${hasProof ? "chip-ok" : ""}`} title={hasProof ? "Proof image uploaded" : "No proof yet"}>
                                                {hasProof ? "Proof ✓" : "No proof"}
                                            </span>
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

                                            {/* Order tracking info */}
                                            <div className="flex muted wrap" style={{ fontSize: 12, marginTop: 4, padding: 6, background: "#f3f4f6", borderRadius: 6 }}>
                                                <span><strong>Order #:</strong> {(s.orderNumber ?? s.order_number) ? `#${s.orderNumber ?? s.order_number}` : "N/A"}</span>
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
                                        </div>
                                    </div>

                                    {/* Two actions: Maps + Take photo (opens same delivery page as /delivery/100992) */}
                                    <div className="mobile-actions">
                                        <a className="btn btn-primary block" href={mapsUrl} target="_blank" rel="noreferrer">
                                            Maps
                                        </a>

                                        {!hasProof ? (
                                            takePhotoUrl ? (
                                                <button
                                                    type="button"
                                                    className="btn btn-outline block"
                                                    title="Take photo"
                                                    onClick={() => setProofModalStop(s)}
                                                >
                                                    <Camera style={{ height: 16, width: 16 }} />
                                                    Take photo
                                                </button>
                                            ) : (
                                                <span className="no-camera-msg" title="No order linked to this stop">
                                                    No order linked — can&apos;t add proof
                                                </span>
                                            )
                                        ) : (
                                            <a
                                                className="btn btn-outline block"
                                                href={proofUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                title="View proof image"
                                            >
                                                <ExternalLink style={{ height: 16, width: 16 }} />
                                                View proof
                                            </a>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })
                )}
            </section>

            {/* Bottom sheet: delivery page in bottom 2/3; click top to close */}
            {proofModalStop && (() => {
                const sheetUrl = deliveryProofUrl(proofModalStop.orderNumber ?? proofModalStop.order_number, proofModalStop.orderId);
                if (!sheetUrl) return null;
                return (
                    <div
                        style={{
                            position: "fixed",
                            inset: 0,
                            zIndex: 100,
                            display: "flex",
                            flexDirection: "column",
                        }}
                        aria-modal="true"
                        role="dialog"
                    >
                        <button
                            type="button"
                            onClick={() => setProofModalStop(null)}
                            style={{
                                flex: "0 0 12.5%",
                                minHeight: "12.5%",
                                width: "100%",
                                background: "rgba(0,0,0,0.6)",
                                border: "none",
                                cursor: "pointer",
                                padding: 0,
                                color: "#e5e7eb",
                                fontSize: 15,
                                fontWeight: 500,
                            }}
                            aria-label="Close"
                        >
                            Click here to close
                        </button>
                        <div
                            style={{
                                flex: "1 1 87.5%",
                                minHeight: 0,
                                background: "#fff",
                                borderTopLeftRadius: 12,
                                borderTopRightRadius: 12,
                                overflow: "hidden",
                                boxShadow: "0 -4px 20px rgba(0,0,0,0.15)",
                            }}
                        >
                            <iframe
                                title="Take delivery proof"
                                src={sheetUrl}
                                style={{
                                    width: "100%",
                                    height: "100%",
                                    border: "none",
                                    display: "block",
                                }}
                            />
                        </div>
                    </div>
                );
            })()}

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

            {/* Page CSS */}
            <style
                dangerouslySetInnerHTML={{
                    __html: `:root{
  --bg:#f7f8fb; --border:#e8eaef; --muted:#6b7280; --radius:14px;
  --shadow:0 6px 18px rgba(16,24,40,.06), 0 1px 6px rgba(16,24,40,.05);
  --success:#16a34a; --tap: rgba(0,0,0,.06);
  --proofbar:#0ea5e9;
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
.hdr-count .proof-ct{margin-top:4px}
.tiny{font-size:11px}
.progress{width:100%;height:6px;border-radius:999px;background:#f1f5f9;overflow:hidden;margin-top:6px}
.progress>span{display:block;height:100%;border-radius:999px;background:var(--brand);transition:width .25s ease}
.progress.proof{background:#eef6fb}
.progress.proof>span{background:var(--proofbar)}
.proof-actions{display:flex;flex-direction:column;gap:6px}
.proof-actions .btn{margin:0}
.hidden-input{position:absolute;width:0;height:0;opacity:0;pointer-events:none}
.chip.chip-ok{background:#ecfdf5;border-color:#10b981;color:#059669}
.stop-card-has-proof{border-color:#a7f3d0;background:#ecfdf5}
.stop-card-has-proof .color-rail{background:#059669}
.no-camera-msg{display:block;padding:10px 14px;font-size:13px;color:var(--muted);background:#f8fafc;border-radius:12px;border:1px solid var(--border)}

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

