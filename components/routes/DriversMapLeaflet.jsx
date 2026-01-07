// components/DriversMapLeaflet.jsx
"use client";

import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
    MapContainer,
    TileLayer,
    Marker,
    ZoomControl,
    useMap,
    CircleMarker,
    Polyline,
    Pane,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import MapLoadingOverlay from "./MapLoadingOverlay";

/* ==================== Config / constants ==================== */

// Selection colors
const SELECTION_PIN_COLOR = "#ebf707"; // yellow
const SELECTION_RING_COLOR = "rgba(235,247,7,0.55)"; // halo/glow

// Icon geometry
const PIN_W = 28;
const PIN_H = 42;
const ANCHOR_X = 14; // tip X
const ANCHOR_Y = 42; // tip Y

// Selection hit tolerance (pixels)
const HIT_RADIUS_PX = 16;

/* ==================== Utils ==================== */
const sid = (v) => {
    try {
        return v == null ? "" : String(v);
    } catch {
        return "";
    }
};

// robust number coercion: number | string | Prisma.Decimal | object-with-toString()
const toNum = (v) => {
    if (v == null) return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v === "string") {
        const n = parseFloat(v);
        return Number.isFinite(n) ? n : null;
    }
    if (typeof v === "object") {
        if (typeof v.toNumber === "function") {
            const n = v.toNumber();
            return Number.isFinite(n) ? n : null;
        }
        if (typeof v.valueOf === "function") {
            const vv = v.valueOf();
            if (typeof vv === "number" && Number.isFinite(vv)) return vv;
            if (typeof vv === "string") {
                const n = parseFloat(vv);
                return Number.isFinite(n) ? n : null;
            }
        }
        if (typeof v.toString === "function") {
            const n = parseFloat(v.toString());
            return Number.isFinite(n) ? n : null;
        }
    }
    return null;
};

// pull coords from several common shapes (flat & nested)
const getLL = (s) => {
    if (!s) return null;

    // flat
    let lat = toNum(s?.lat ?? s?.latitude);
    let lng = toNum(s?.lng ?? s?.longitude);

    // nested: user.*, geo.*, location.*, coords.*, position.*
    if (lat == null || lng == null) {
        const srcs = [s.user, s.geo, s.location, s.coords, s.position];
        for (const src of srcs) {
            if (!src) continue;
            if (lat == null) lat = toNum(src.lat ?? src.latitude);
            if (lng == null) lng = toNum(src.lng ?? src.longitude);
            if (lat != null && lng != null) break;
        }
    }

    // defensive: ignore 0/0 and obvious junk
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    if (Math.abs(lat) < 0.00001 && Math.abs(lng) < 0.00001) return null;

    return [lat, lng];
};

// Very small, stable offset (meters) to separate exact-overlap markers
function jitterLL(ll, id) {
    if (!ll) return null;
    const [lat, lng] = ll;
    const s = sid(id);
    // simple FNV-like hash
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    // -0.5..0.5
    const r1 = ((h & 1023) / 1023) - 0.5;
    const r2 = (((h >>> 10) & 1023) / 1023) - 0.5;

    const meters = 6; // small nudge; visually separates stacks
    const dLat = (meters / 111320) * r1;
    const dLng =
        (meters /
            (40075000 * Math.cos((lat * Math.PI) / 180) / 360)) * r2;

    return [lat + dLat, lng + dLng];
}

const asLeafletMarker = (maybe) => {
    if (!maybe) return null;
    if (typeof maybe.getLatLng === "function") return maybe;
    if (maybe.leafletElement?.getLatLng) return maybe.leafletElement;
    if (maybe.marker?.getLatLng) return maybe.marker;
    return null;
};

/** Extract numeric order from "Driver X" (Driver 0 should be first) */
function driverRankByName(name) {
    const m = /driver\s+(\d+)/i.exec(String(name || ""));
    return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
}

/** Helper to read boolean-ish values across shapes */
function truthyish(v) {
    if (v === true || v === 1) return true;
    if (typeof v === "string") {
        const s = v.trim().toLowerCase();
        return s === "true" || s === "1" || s === "yes" || s === "y";
    }
    return false;
}

/** Robust paused detector (common variants + strings) */
function isPausedStop(s) {
    const flags = [
        s?.paused,
        s?.isPaused,
        s?.pause,
        s?.onHold,
        s?.hold,
        s?.flags?.paused,
        s?.flags?.hold,
        s?.user?.paused,
        s?.user?.isPaused,
        s?.visit?.paused,
        (s?.pausedAt ?? s?.holdUntil ?? s?.onHoldUntil ?? null) ? true : false,
    ];
    if (flags.some(truthyish)) return true;

    const statusCandidates = [
        s?.status,
        s?.state,
        s?.routeStatus,
        s?.deliveryStatus,
        s?.visitStatus,
        s?.user?.status,
        s?.flags?.status,
        s?.note,
        s?.pausedReason,
    ].map((x) => (x == null ? "" : String(x).toLowerCase()));

    for (const status of statusCandidates) {
        if (
            status.includes("pause") ||
            status.includes("on hold") ||
            status.includes("on_hold") ||
            status === "hold" ||
            status === "paused" ||
            status === "skipped" ||
            status === "skip"
        ) {
            return true;
        }
    }
    return false;
}

/* ==================== Icons (anchor-fixed) ==================== */
const iconCache = new Map();
const iconKey = (color, selected) => `${color}|${selected ? "sel" : "norm"}`;

function makePinIcon(color = "#1f77b4", selected = false) {
    const k = iconKey(color, selected);
    const cached = iconCache.get(k);
    if (cached) return cached;

    const fill = selected ? SELECTION_PIN_COLOR : color;
    const stroke = selected ? "rgba(0,0,0,0.8)" : "rgba(0,0,0,0.4)";
    const ring = selected
        ? `<circle cx="${ANCHOR_X}" cy="${ANCHOR_Y - 29}" r="8" fill="none" stroke="${SELECTION_RING_COLOR}" stroke-width="3"></circle>`
        : "";

    const html = `
    <div style="position:relative; width:${PIN_W}px; height:${PIN_H}px;">
      <svg width="${PIN_W}" height="${PIN_H}" viewBox="0 0 ${PIN_W} ${PIN_H}" xmlns="http://www.w3.org/2000/svg" style="display:block">
        ${ring}
        <path d="M14 0C6.82 0 1 5.82 1 13c0 9.6 10.3 18.1 12.2 19.67a1 1 0 0 0 1.6 0C16.7 31.1 27 22.6 27 13 27 5.82 21.18 0 14 0z" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>
        <circle cx="14" cy="13" r="4.5" fill="white"/>
      </svg>
      <div style="
        position:absolute;
        left:${ANCHOR_X - 8};
        bottom:0;
        transform: translate3d(0,4px,0);
        width:16px; height:6px;
        border-radius:50%;
        background:rgba(0,0,0,0.25);
        opacity:.8;
      "></div>
    </div>
  `;

    const icon = L.divIcon({
        html,
        className: "pin-icon",
        iconSize: [PIN_W, PIN_H],
        iconAnchor: [ANCHOR_X, ANCHOR_Y],
        popupAnchor: [0, -36],
    });
    iconCache.set(k, icon);
    return icon;
}

/* ==================== Data helpers ==================== */
function findStopByIdLocal(id, drivers, unrouted) {
    const key = sid(id);
    for (const d of drivers) for (const s of d.stops || []) {
        if (sid(s.id) === key)
            return { stop: s, color: d.color || "#1f77b4", fromDriverId: d.driverId };
    }
    for (const s of unrouted || [])
        if (sid(s.id) === key) return { stop: s, color: "#666", fromDriverId: null };
    return { stop: null, color: "#666", fromDriverId: null };
}

/* ==================== View persistence ==================== */
const VIEW_KEY = "driversMap:view";
function saveView(map) {
    try {
        const c = map.getCenter(),
            z = map.getZoom();
        sessionStorage.setItem(
            VIEW_KEY,
            JSON.stringify({ lat: c.lat, lng: c.lng, zoom: z })
        );
    } catch {}
}
function loadView() {
    try {
        const raw = sessionStorage.getItem(VIEW_KEY);
        if (!raw) return null;
        const v = JSON.parse(raw);
        if (
            Number.isFinite(v?.lat) &&
            Number.isFinite(v?.lng) &&
            Number.isFinite(v?.zoom)
        )
            return v;
    } catch {}
    return null;
}

/* ==================== Map bridge (single-fire) ==================== */
function MapBridge({ onReady }) {
    const map = useMap();
    const onReadyRef = useRef(onReady);
    const calledRef = useRef(false);
    useEffect(() => {
        onReadyRef.current = onReady;
    }, [onReady]);
    useEffect(() => {
        if (map && !calledRef.current) {
            calledRef.current = true;
            onReadyRef.current?.(map);
        }
    }, [map]);
    return null;
}

/* ==================== Programmatic popup ==================== */
/** Assign popup with current driver preselected (if any) */
function openAssignPopup({ map, stop, color, drivers, onAssign }) {
    if (!map || !stop) return;
    const ll = getLL(stop);
    if (!ll) return;

    // Determine currently assigned driverId, if any
    const stopId = sid(stop.id);
    let currentDriverId = null;
    for (const d of drivers || []) {
        if ((d.stops || []).some((s) => sid(s.id) === stopId)) {
            currentDriverId = d.driverId;
            break;
        }
    }
    if (currentDriverId == null && stop.__driverId != null) {
        currentDriverId = stop.__driverId;
    }

    const container = document.createElement("div");
    container.style.minWidth = "240px";
    container.style.border = `3px solid ${color}`;
    container.style.borderRadius = "10px";
    container.style.padding = "6px";
    container.style.boxShadow = "0 6px 24px rgba(0,0,0,0.15)";
    container.innerHTML = `
    <div style="font-weight:700">${stop.name || "Unnamed"}</div>
    <div>${stop.address || ""}${stop.apt ? " " + stop.apt : ""}</div>
    <div>${stop.city || ""} ${stop.state || ""} ${stop.zip || ""}</div>
    ${stop.phone ? `<div style="margin-top:4px">${stop.phone}</div>` : ""}
    <div style="margin-top:8px;display:flex;gap:8px;align-items:center">
      <label style="font-size:12px">Assign to:</label>
      <select id="__assignSel" style="padding:4px 6px;border-radius:6px;border:1px solid #ccc"></select>
    </div>
  `;
    const sel = container.querySelector("#__assignSel");

    const sortedDrivers = [...(drivers || [])].sort(
        (a, b) => driverRankByName(a.name) - driverRankByName(b.name)
    );

    const o0 = document.createElement("option");
    o0.value = "";
    o0.textContent = "Select driver…";
    o0.disabled = !!currentDriverId;
    o0.selected = !currentDriverId;
    sel.appendChild(o0);

    for (const d of sortedDrivers) {
        const o = document.createElement("option");
        o.value = String(d.driverId);
        o.textContent = d.name;
        sel.appendChild(o);
    }

    if (currentDriverId != null) {
        sel.value = String(currentDriverId);
    }

    sel.addEventListener("change", () => {
        const to = Number(sel.value);
        if (Number.isFinite(to)) onAssign?.(stop, to);
    });

    L.popup({ closeOnClick: true, autoClose: true, className: "color-popup" })
        .setLatLng(ll)
        .setContent(container)
        .openOn(map);
}

/* ==================== Pretty checkbox row ==================== */
function CheckRow({ id, checked, onChange, label, title }) {
    const selected = !!checked;
    return (
        <label
            htmlFor={id}
            title={title}
            style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                fontSize: 13,
                userSelect: "none",
                cursor: "pointer",
                padding: "8px 10px",
                borderRadius: 10,
                border: selected ? "1px solid #99c2ff" : "1px solid #e5e7eb",
                background: selected ? "#eef5ff" : "#fff",
                color: selected ? "#0b66ff" : "#111827",
                transition: "background 120ms, color 120ms, border 120ms",
            }}
        >
            <input
                id={id}
                type="checkbox"
                checked={checked}
                onChange={(e) => onChange?.(e.target.checked)}
                style={{
                    width: 18,
                    height: 18,
                    transform: "scale(1.25)",
                    accentColor: "#0b66ff",
                    cursor: "pointer",
                }}
            />
            <span style={{ lineHeight: 1 }}>{label}</span>
        </label>
    );
}

/* ==================== Component ==================== */
export default function DriversMapLeaflet({
                                              drivers = [],
                                              unrouted = [],
                                              onReassign, // (stop, driverId)
                                              onRenameDriver, // optional: (driverId, newNumber) => Promise
                                              onExpose, // optional
                                              initialCenter = [40.7128, -74.006],
                                              initialZoom = 10,
                                              showRouteLinesDefault = false,
                                              busy = false, // external loading flag
                                              pausedDetector, // optional override for paused detection
                                              logoSrc, // optional loading logo (path or URL)
                                          }) {
    const mapRef = useRef(null);
    const [mapReady, setMapReady] = useState(false);
    const [didFitOnce, setDidFitOnce] = useState(false);

    // Driver editing state
    const [editingDriverId, setEditingDriverId] = useState(null);
    const [editingNumber, setEditingNumber] = useState("");

    const onReassignRef = useRef(onReassign);
    useEffect(() => {
        onReassignRef.current = onReassign;
    }, [onReassign]);

    const [localDrivers, setLocalDrivers] = useState(drivers || []);
    const [localUnrouted, setLocalUnrouted] = useState(unrouted || []);
    const localDriversRef = useRef(localDrivers);
    const localUnroutedRef = useRef(localUnrouted);
    useEffect(() => {
        localDriversRef.current = localDrivers;
    }, [localDrivers]);
    useEffect(() => {
        localUnroutedRef.current = localUnrouted;
    }, [localUnrouted]);
    useEffect(() => {
        setLocalDrivers(Array.isArray(drivers) ? drivers : []);
    }, [drivers]);
    useEffect(() => {
        setLocalUnrouted(Array.isArray(unrouted) ? unrouted : []);
    }, [unrouted]);

    // 🔑 Always-sorted view of drivers so 0 is first
    const sortedDrivers = useMemo(
        () =>
            (localDrivers || [])
                .slice()
                .sort((a, b) => driverRankByName(a.name) - driverRankByName(b.name)),
        [localDrivers]
    );

    /* ------- toggles / selection / halo ------- */
    const [showRouteLines, setShowRouteLines] = useState(!!showRouteLinesDefault);
    const [selectMode, setSelectMode] = useState(false);
    const [clickPickMode, setClickPickMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState(() => new Set());
    const [hoverIds, setHoverIds] = useState(() => new Set());
    const hoverIdsRef = useRef(new Set());
    const [bulkDriverId, setBulkDriverId] = useState("");
    const [bulkBusy, setBulkBusy] = useState(false);
    const selectedCount = selectedIds.size;

    const [selectedHalo, setSelectedHalo] = useState({
        lat: null,
        lng: null,
        color: "#666",
    });
    const clearHalo = useCallback(
        () => setSelectedHalo({ lat: null, lng: null, color: "#666" }),
        []
    );

    /* ===== Driver filter (index click) ===== */
    const [driverFilter, setDriverFilter] = useState(() => new Set());
    const hasFilter = driverFilter.size > 0;

    const toggleDriverFilter = useCallback((driverId) => {
        setDriverFilter((prev) => {
            const next = new Set(prev);
            const idNum = Number(driverId);
            if (next.has(idNum)) next.delete(idNum);
            else next.add(idNum);
            return next;
        });
    }, []);

    const clearDriverFilter = useCallback(() => setDriverFilter(new Set()), []);

    // Only show selected drivers when filtered; otherwise show all
    const visibleDrivers = useMemo(
        () =>
            hasFilter
                ? sortedDrivers.filter((d) => driverFilter.has(Number(d.driverId)))
                : sortedDrivers,
        [sortedDrivers, driverFilter, hasFilter]
    );

    /* ------- derived ------- */
    const hasLL = (s) => !!getLL(s);
    const allPoints = useMemo(() => {
        const pts = [];
        for (const d of visibleDrivers)
            for (const s of d.stops || []) {
                const ll = getLL(s);
                if (ll) pts.push(ll);
            }
        // hide unrouted when filtering by driver
        if (!hasFilter) {
            for (const s of localUnrouted) {
                const ll = getLL(s);
                if (ll) pts.push(ll);
            }
        }
        return pts;
    }, [visibleDrivers, localUnrouted, hasFilter]);

    const assignedIdSet = useMemo(() => {
        const set = new Set();
        for (const d of sortedDrivers) for (const s of d.stops || []) set.add(sid(s.id));
        return set;
    }, [sortedDrivers]);

    const unroutedFiltered = useMemo(
        () => (localUnrouted || []).filter((s) => !assignedIdSet.has(sid(s.id))),
        [localUnrouted, assignedIdSet]
    );

    // Only show unrouted when not filtering by driver
    const unroutedFilteredVisible = useMemo(
        () => (hasFilter ? [] : unroutedFiltered),
        [hasFilter, unroutedFiltered]
    );

    const indexItems = useMemo(
        () =>
            sortedDrivers.map((d) => ({
                driverId: d.driverId,
                name: d.name,
                color: d.color,
                count: (d.stops || []).filter(hasLL).length,
            })),
        [sortedDrivers]
    );
    const totalAssigned = useMemo(
        () =>
            visibleDrivers.reduce((s, d) => s + (d.stops || []).filter(hasLL).length, 0),
        [visibleDrivers]
    );

    // Header totals
    const unroutedVisible = useMemo(
        () => unroutedFilteredVisible.filter(hasLL).length,
        [unroutedFilteredVisible]
    );
    const totalVisibleStops = totalAssigned + unroutedVisible;

    const pausedVisible = useMemo(() => {
        const detect = typeof pausedDetector === "function" ? pausedDetector : isPausedStop;
        let c = 0;
        for (const d of visibleDrivers) {
            for (const s of d.stops || []) {
                if (hasLL(s) && detect(s)) c++;
            }
        }
        for (const s of unroutedFilteredVisible) {
            if (hasLL(s) && detect(s)) c++;
        }
        return c;
    }, [visibleDrivers, unroutedFilteredVisible, pausedDetector]);

    const idBaseColor = useMemo(() => {
        const m = new Map();
        for (const d of sortedDrivers)
            for (const s of d.stops || []) m.set(sid(s.id), d.color || "#1f77b4");
        for (const s of localUnrouted) m.set(sid(s.id), "#666");
        return m;
    }, [sortedDrivers, localUnrouted]);

    /* ------- marker refs ------- */
    const assignedMarkerRefs = useRef(new Map());
    const unroutedMarkerRefs = useRef(new Map());
    useEffect(() => {
        assignedMarkerRefs.current = new Map();
        unroutedMarkerRefs.current = new Map();
    }, [sortedDrivers, unroutedFiltered]);

    /* ------- local data updates ------- */
    const moveStopsLocally = useCallback((stopIds, toDriverId) => {
        const toId = Number(toDriverId);
        const idKeys = new Set(stopIds.map(sid));
        const dSnap = localDriversRef.current;
        const uSnap = localUnroutedRef.current;

        const movingStops = [];
        for (const id of idKeys) {
            const { stop } = findStopByIdLocal(id, dSnap, uSnap);
            if (stop) {
                movingStops.push({ ...stop, __driverId: toId });
            }
        }

        const strippedDrivers = dSnap.map((d) => ({
            ...d,
            stops: (d.stops || []).filter((s) => !idKeys.has(sid(s.id))),
        }));
        const nextUnrouted = uSnap.filter((s) => !idKeys.has(sid(s.id)));

        let injected = false;
        const nextDrivers = strippedDrivers.map((d) => {
            if (Number(d.driverId) === toId) {
                injected = true;
                const newStops = Array.isArray(d.stops) ? [...d.stops, ...movingStops] : [...movingStops];
                return { ...d, stops: newStops };
            }
            return d;
        });

        const finalDrivers = injected
            ? nextDrivers
            : [
                ...nextDrivers,
                {
                    driverId: toId,
                    name: `Driver ${toId}`,
                    color: "#1f77b4",
                    stops: movingStops,
                    polygon: [],
                },
            ];

        setLocalDrivers(finalDrivers);
        setLocalUnrouted(nextUnrouted);
        localDriversRef.current = finalDrivers;
        localUnroutedRef.current = nextUnrouted;
    }, []);
    /* ------- popup assign (single) ------- */
    const onReassignLocal = useCallback(
        async (stop, toDriverId) => {
            const id = stop?.id;
            if (id == null) return;
            await onReassignRef.current?.(stop, Number(toDriverId));
            moveStopsLocally([id], toDriverId);
        },
        [moveStopsLocally]
    );

    const openAssignForStop = useCallback(
        (stop, baseColor) => {
            const map = mapRef.current;
            if (!map) return;
            openAssignPopup({
                map,
                stop,
                color: baseColor || "#1f77b4",
                drivers: localDriversRef.current,
                onAssign: onReassignLocal,
            });
            const ll = getLL(stop);
            if (ll) setSelectedHalo({ lat: ll[0], lng: ll[1], color: baseColor || "#1f77b4" });
        },
        [onReassignLocal]
    );

    /* ------- search ------- */
    const [q, setQ] = useState("");
    const searchInputRef = useRef(null);
    const [results, setResults] = useState([]);

    const clearSearch = useCallback(() => {
        setQ("");
        requestAnimationFrame(() => searchInputRef.current?.focus());
    }, []);

    useEffect(() => {
        const needle = q.trim().toLowerCase();
        if (!needle) {
            setResults([]);
            return;
        }
        const rows = [];
        for (const d of sortedDrivers)
            for (const s of d.stops || []) {
                const hay = [s.name, s.address, s.city, s.state, s.zip, s.phone]
                    .filter(Boolean)
                    .join(" ")
                    .toLowerCase();
                if (hay.includes(needle))
                    rows.push({
                        ...s,
                        __driverId: d.driverId,
                        __driverName: d.name,
                        __unrouted: false,
                        __color: d.color,
                    });
            }
        for (const s of unroutedFiltered) {
            const hay = [s.name, s.address, s.city, s.state, s.zip, s.phone]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();
            if (hay.includes(needle))
                rows.push({
                    ...s,
                    __driverId: null,
                    __driverName: "Unrouted",
                    __unrouted: true,
                    __color: "#666",
                });
        }
        setResults(rows.slice(0, 50));
    }, [q, sortedDrivers, unroutedFiltered]);

    const focusResult = useCallback(
        (row, { clear = false } = {}) => {
            if (!row) return;
            const map = mapRef.current;
            const ll = getLL(row);
            if (!map || !ll) return;
            map.setView(ll, Math.max(map.getZoom(), 14), { animate: true });

            const { stop, color } = findStopByIdLocal(
                row.id,
                localDriversRef.current,
                localUnroutedRef.current
            );
            openAssignForStop(stop || row, color || row.__color || "#1f77b4");

            if (clear) clearSearch();
        },
        [openAssignForStop, clearSearch]
    );

    /* ------- selection helpers ------- */
    const toggleId = useCallback((id, forceOn = null) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (forceOn === true) next.add(id);
            else if (forceOn === false) next.delete(id);
            else {
                next.has(id) ? next.delete(id) : next.add(id);
            }
            return next;
        });
    }, []);

    const handleMarkerClick = useCallback(
        (id, stop, baseColor, e) => {
            const map = mapRef.current;
            const ev = e?.originalEvent;
            const modifier = ev?.altKey || ev?.metaKey || ev?.ctrlKey;
            const isToggle = clickPickMode || modifier;

            if (isToggle) {
                toggleId(id);
                map?.closePopup();
                ev?.preventDefault?.();
                ev?.stopPropagation?.();
                return;
            }
            map?.closePopup();
            openAssignForStop(stop, baseColor);
        },
        [clickPickMode, openAssignForStop, toggleId]
    );

    /* ------- driver editing ------- */
    const startEditDriver = useCallback((driverId, currentName) => {
        // Don't allow editing Driver 0
        const isDriver0 = /driver\s+0/i.test(currentName || "");
        if (isDriver0) return;

        // Extract current number
        const match = /driver\s+(\d+)/i.exec(currentName || "");
        const currentNum = match ? match[1] : "";

        setEditingDriverId(driverId);
        setEditingNumber(currentNum);
    }, []);

    const cancelEditDriver = useCallback(() => {
        setEditingDriverId(null);
        setEditingNumber("");
    }, []);

    const saveEditDriver = useCallback(async () => {
        if (!editingDriverId || !editingNumber.trim()) {
            cancelEditDriver();
            return;
        }

        const newNum = parseInt(editingNumber.trim(), 10);

        // Validate
        if (!Number.isInteger(newNum) || newNum < 1 || newNum > 99) {
            alert("Driver number must be between 1 and 99");
            return;
        }

        // Check for duplicates
        const duplicate = sortedDrivers.find(d => {
            const match = /driver\s+(\d+)/i.exec(d.name || "");
            const num = match ? parseInt(match[1], 10) : -1;
            return num === newNum && d.driverId !== editingDriverId;
        });

        if (duplicate) {
            alert(`Driver ${newNum} already exists`);
            return;
        }

        // Call the rename callback if provided
        if (onRenameDriver) {
            try {
                await onRenameDriver(editingDriverId, newNum);
                cancelEditDriver();
            } catch (e) {
                console.error("Rename failed:", e);
                alert("Failed to rename driver: " + (e.message || "Unknown error"));
            }
        } else {
            cancelEditDriver();
        }
    }, [editingDriverId, editingNumber, sortedDrivers, onRenameDriver, cancelEditDriver]);

    /* ------- Map ready / view ------- */
    const handleMapReady = useCallback(
        (m) => {
            mapRef.current = m;
            const saved = loadView();
            if (saved) m.setView([saved.lat, saved.lng], saved.zoom, { animate: false });
            else m.setView(initialCenter, initialZoom, { animate: false });

            const onMoveEnd = () => saveView(m);
            m.on("moveend", onMoveEnd);
            m.on("zoomend", onMoveEnd);

            m.on("click", clearHalo);
            m.on("popupclose", clearHalo);

            setMapReady(true);
        },
        [initialCenter, initialZoom, clearHalo]
    );

    useEffect(() => {
        if (!mapReady || didFitOnce) return;
        const saved = loadView();
        if (saved) {
            setDidFitOnce(true);
            return;
        }
        if (!allPoints.length) return;
        try {
            const b = L.latLngBounds(allPoints);
            mapRef.current.fitBounds(b, { padding: [50, 50] });
            setDidFitOnce(true);
        } catch {}
    }, [mapReady, didFitOnce, allPoints]);

    /* ======== Box select (accurate; container pixel space) ======== */
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;
        const container = map.getContainer();
        if (!container) return;

        let startClient = null;
        let overlay = null;
        let locked = false;

        const lockMap = () => {
            if (locked) return;
            map.dragging.disable();
            map.touchZoom.disable();
            map.doubleClickZoom.disable();
            map.scrollWheelZoom.disable();
            map.boxZoom.disable();
            map.keyboard.disable();
            locked = true;
        };
        const unlockMap = () => {
            if (!locked) return;
            map.dragging.enable();
            map.touchZoom.enable();
            map.doubleClickZoom.enable();
            map.scrollWheelZoom.enable();
            map.boxZoom.enable();
            map.keyboard.enable();
            locked = false;
        };

        const toContainerXY = (clientX, clientY) => {
            const r = container.getBoundingClientRect();
            return { x: clientX - r.left, y: clientY - r.top };
        };

        const normalizeRect = (a, b) => ({
            x1: Math.min(a.x, b.x),
            y1: Math.min(a.y, b.y),
            x2: Math.max(a.x, b.x),
            y2: Math.max(a.y, b.y),
        });

        const pointInRect = (p, r, pad = 0) =>
            p.x >= r.x1 - pad &&
            p.x <= r.x2 + pad &&
            p.y >= r.y1 - pad &&
            p.y <= r.y2 + pad;

        function onMouseDown(e) {
            if (!selectMode || !e.shiftKey || e.button !== 0) return;
            if (e.target.closest(".leaflet-control")) return;

            startClient = { x: e.clientX, y: e.clientY };

            const cRect = container.getBoundingClientRect();
            overlay = document.createElement("div");
            overlay.style.position = "absolute";
            overlay.style.left = `${startClient.x - cRect.left}px`;
            overlay.style.top = `${startClient.y - cRect.top}px`;
            overlay.style.width = "0px";
            overlay.style.height = "0px";
            overlay.style.border = "1.5px dashed rgba(0,120,255,0.9)";
            overlay.style.background = "rgba(0,120,255,0.12)";
            overlay.style.pointerEvents = "none";
            overlay.style.zIndex = 999;
            container.appendChild(overlay);

            lockMap();
            clearHalo();
            map.closePopup();
            e.preventDefault();
            e.stopPropagation();
        }

        function onMouseMove(e) {
            if (!startClient || !overlay) return;

            const cRect = container.getBoundingClientRect();
            const nowClient = { x: e.clientX, y: e.clientY };
            const rrClient = {
                x1: Math.min(startClient.x, nowClient.x),
                y1: Math.min(startClient.y, nowClient.y),
                x2: Math.max(startClient.x, nowClient.x),
                y2: Math.max(startClient.y, nowClient.y),
            };
            overlay.style.left = `${rrClient.x1 - cRect.left}px`;
            overlay.style.top = `${rrClient.y1 - cRect.top}px`;
            overlay.style.width = `${rrClient.x2 - rrClient.x1}px`;
            overlay.style.height = `${rrClient.y2 - rrClient.y1}px`;

            const a = toContainerXY(startClient.x, startClient.y);
            const b = toContainerXY(nowClient.x, nowClient.y);
            const rect = normalizeRect(a, b);

            const pad = HIT_RADIUS_PX;
            const picked = new Set();

            const visit = (refMap) => {
                refMap.forEach((m, id) => {
                    const ll = m?.getLatLng?.();
                    if (!ll) return;
                    const pt = map.latLngToContainerPoint(ll);
                    if (pointInRect(pt, rect, pad)) picked.add(id);
                });
            };

            visit(assignedMarkerRefs.current);
            visit(unroutedMarkerRefs.current);

            let changed = false;
            if (picked.size !== hoverIdsRef.current.size) changed = true;
            else {
                for (const id of picked) {
                    if (!hoverIdsRef.current.has(id)) {
                        changed = true;
                        break;
                    }
                }
            }
            if (changed) {
                hoverIdsRef.current = picked;
                setHoverIds(picked);
            }

            e.preventDefault();
            e.stopPropagation();
        }

        function onMouseUp(e) {
            if (!startClient) return;

            setHoverIds((prevHover) => {
                setSelectedIds((prev) => {
                    const next = new Set(prev);
                    const subtract = e.altKey || e.metaKey || e.ctrlKey;
                    prevHover.forEach((id) => (subtract ? next.delete(id) : next.add(id)));
                    return next;
                });
                return new Set();
            });
            hoverIdsRef.current = new Set();

            if (overlay?.parentNode) overlay.parentNode.removeChild(overlay);
            overlay = null;
            startClient = null;
            unlockMap();
            e.preventDefault();
            e.stopPropagation();
        }

        container.addEventListener("mousedown", onMouseDown, true);
        window.addEventListener("mousemove", onMouseMove, true);
        window.addEventListener("mouseup", onMouseUp, true);
        return () => {
            container.removeEventListener("mousedown", onMouseDown, true);
            window.removeEventListener("mousemove", onMouseMove, true);
            window.removeEventListener("mouseup", onMouseUp, true);
            unlockMap();
        };
    }, [selectMode, clearHalo]);

    /* ======== Live coloring ======== */
    const prevLiveSetRef = useRef(new Set());
    const setIconForId = useCallback(
        (id, on) => {
            const m =
                assignedMarkerRefs.current.get(id) ||
                unroutedMarkerRefs.current.get(id);
            if (!m) return;
            const base = idBaseColor.get(id) || "#666";
            m.setIcon(makePinIcon(base, !!on));
        },
        [idBaseColor]
    );

    useEffect(() => {
        const live = new Set([...selectedIds, ...hoverIds]);
        const prev = prevLiveSetRef.current;
        live.forEach((id) => {
            if (!prev.has(id)) setIconForId(id, true);
        });
        prev.forEach((id) => {
            if (!live.has(id)) setIconForId(id, false);
        });
        prevLiveSetRef.current = live;
    }, [selectedIds, hoverIds, setIconForId]);

    /* ======== TRUE SEQUENTIAL BULK ASSIGN ======== */
    const applyBulkAssign = useCallback(
        async (toDriverId) => {
            const to = Number(toDriverId);
            const ids = Array.from(selectedIds);
            if (!Number.isFinite(to) || ids.length === 0 || bulkBusy) return;

            setBulkBusy(true);
            try {
                for (const id of ids) {
                    const { stop } = findStopByIdLocal(
                        id,
                        localDriversRef.current,
                        localUnroutedRef.current
                    );
                    if (!stop) continue;
                    await onReassignRef.current?.(stop, to); // persist (server)
                    moveStopsLocally([id], to); // update local UI
                }
            } catch (err) {
                console.error("[BulkAssign(sequential)] failed:", err);
            } finally {
                prevLiveSetRef.current.forEach((id) => setIconForId(id, false));
                prevLiveSetRef.current = new Set();
                setSelectedIds(new Set());
                setHoverIds(new Set());
                hoverIdsRef.current = new Set();
                setBulkDriverId("");
                clearHalo();
                setBulkBusy(false);
            }
        },
        [selectedIds, bulkBusy, moveStopsLocally, clearHalo, setIconForId]
    );

    const clearSelection = useCallback(() => {
        prevLiveSetRef.current.forEach((id) => setIconForId(id, false));
        prevLiveSetRef.current = new Set();
        setSelectedIds(new Set());
        setHoverIds(new Set());
        hoverIdsRef.current = new Set();
        setBulkDriverId("");
        clearHalo();
    }, [setIconForId, clearHalo]);

    /* ======== BULK DELETE GEOCODING ======== */
    const deleteGeocodingForSelected = useCallback(async () => {
        const ids = Array.from(selectedIds);
        if (ids.length === 0 || bulkBusy) return;

        // Confirmation dialog
        const confirmed = window.confirm(
            `Delete geocoding (lat/lng) for ${ids.length} selected user${ids.length > 1 ? 's' : ''}?\n\n` +
            `This will remove their map location and they will need to be geocoded again.`
        );
        if (!confirmed) return;

        setBulkBusy(true);
        let successCount = 0;
        let failCount = 0;

        try {
            for (const id of ids) {
                const { stop } = findStopByIdLocal(
                    id,
                    localDriversRef.current,
                    localUnroutedRef.current
                );
                if (!stop) continue;

                // Get the actual userId (could be stop.userId or stop.id)
                const userId = stop.userId || stop.id;
                if (!userId) continue;

                try {
                    // Use the clearGeocode flag to explicitly delete coordinates
                    const res = await fetch(`/api/users/${userId}`, {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            clearGeocode: true,
                            cascadeStops: true
                        }),
                    });
                    if (!res.ok) {
                        throw new Error(await res.text().catch(() => `HTTP ${res.status}`));
                    }
                    successCount++;
                } catch (err) {
                    console.error(`Failed to delete geocoding for user ${userId}:`, err);
                    failCount++;
                }
            }

            // Show result
            if (failCount > 0) {
                alert(`Geocoding deleted for ${successCount} user${successCount !== 1 ? 's' : ''}.\n${failCount} failed.\n\nPage will reload to refresh the view.`);
            } else {
                alert(`Geocoding deleted for ${successCount} user${successCount !== 1 ? 's' : ''}.\n\nPage will reload to refresh the view.`);
            }

            // Clear selection
            clearSelection();

            // Reload the page to refresh all data (users list, missing geocodes, etc.)
            if (successCount > 0) {
                window.location.reload();
            }
        } catch (err) {
            console.error("[BulkDeleteGeocoding] failed:", err);
            alert("Failed to delete geocoding: " + (err.message || "Unknown error"));
        } finally {
            setBulkBusy(false);
        }
    }, [selectedIds, bulkBusy, clearSelection]);

    /* ======== Expose API (optional) ======== */
    useEffect(() => {
        if (!onExpose) return;
        const api = {
            getMap: () => mapRef.current,
            flyTo: (lat, lng, zoom = 15) =>
                mapRef.current?.flyTo([lat, lng], zoom, { animate: true }),
            applyBulkAssign,
            clearSelection,
            getSelectedCount: () => selectedIds.size,
        };
        onExpose(api);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    /* ------- Render ------- */
    const showOverlay = !!busy || !!(bulkBusy);

    // NEW: one-click select all unrouted (that are visible/geocoded)
    const selectAllUnrouted = useCallback(() => {
        const ids = unroutedFiltered.filter(hasLL).map((s) => sid(s.id));
        setSelectedIds(new Set(ids));
        clearHalo();
        mapRef.current?.closePopup();
    }, [unroutedFiltered, clearHalo]);

    // SAFE visibility log
    useEffect(() => {
        const has = (x) => !!getLL(x);

        const assignedWithLL = sortedDrivers.reduce(
            (sum, d) => sum + (d.stops || []).filter(has).length,
            0
        );
        const assignedTotal = sortedDrivers.reduce(
            (s, d) => s + (d.stops || []).length,
            0
        );

        const unroutedAll = (localUnrouted || []).filter(
            (s) => !assignedIdSet.has(sid(s.id))
        );
        const unroutedWithLL = unroutedAll.filter(has).length;
        const unroutedTotal = unroutedAll.length;

        console.log(
            `[DriversMap] assigned: ${assignedWithLL}/${assignedTotal} | unrouted: ${unroutedWithLL}/${unroutedTotal}`
        );
    }, [sortedDrivers, localUnrouted, assignedIdSet]);

    return (
        <div style={{ height: "100%", width: "100%", position: "relative" }}>
            {/* Left: Search overlay */}
            <div
                style={{
                    position: "absolute",
                    zIndex: 1000,
                    left: 10,
                    top: 10,
                    width: 360,
                    pointerEvents: "auto",
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
            >
                <div
                    style={{
                        background: "rgba(255,255,255,0.97)",
                        border: "1px solid #ddd",
                        borderRadius: 12,
                        padding: 10,
                        boxShadow: "0 2px 10px rgba(0,0,0,0.12)",
                    }}
                >
                    <div style={{ position: "relative" }}>
                        <input
                            ref={searchInputRef}
                            value={q}
                            onChange={(e) => setQ(e.target.value)}
                            placeholder="Search name, address, phone… (Enter selects first)"
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && results.length) {
                                    focusResult(results[0], { clear: true });
                                }
                            }}
                            style={{
                                width: "100%",
                                height: 36,
                                borderRadius: 8,
                                border: "1px solid #ccc",
                                padding: "0 34px 0 10px",
                                outline: "none",
                            }}
                        />
                        {q.trim() && (
                            <button
                                type="button"
                                aria-label="Clear search"
                                onClick={clearSearch}
                                style={{
                                    position: "absolute",
                                    right: 6,
                                    top: "50%",
                                    transform: "translateY(-50%)",
                                    width: 24,
                                    height: 24,
                                    borderRadius: 12,
                                    border: "1px solid #ddd",
                                    background: "#f8f8f8",
                                    cursor: "pointer",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    fontSize: 14,
                                    lineHeight: 1,
                                    userSelect: "none",
                                }}
                                title="Clear"
                            >
                                ×
                            </button>
                        )}
                    </div>

                    {q.trim() && (
                        <div
                            style={{
                                marginTop: 8,
                                borderTop: "1px solid #eee",
                                maxHeight: 260,
                                overflowY: "auto",
                                borderRadius: 8,
                            }}
                        >
                            {results.length === 0 ? (
                                <div style={{ padding: "8px 6px", fontSize: 12, opacity: 0.7 }}>
                                    No matches
                                </div>
                            ) : (
                                results.map((r) => {
                                    const id = sid(r.id);
                                    const ll = getLL(r);
                                    const sub =
                                        `${r.address || ""}${r.apt ? " " + r.apt : ""}`.trim() ||
                                        [r.city, r.state, r.zip].filter(Boolean).join(" ");
                                    return (
                                        <button
                                            key={id}
                                            type="button"
                                            onClick={() => {
                                                focusResult(r, { clear: true });
                                            }}
                                            style={{
                                                width: "100%",
                                                textAlign: "left",
                                                padding: "8px 10px",
                                                background: "#fff",
                                                border: "1px solid #eee",
                                                borderRadius: 8,
                                                marginBottom: 6,
                                                cursor: ll ? "pointer" : "not-allowed",
                                                opacity: ll ? 1 : 0.6,
                                            }}
                                            title={
                                                r.__driverId ? `Driver: ${r.__driverName}` : "Unrouted"
                                            }
                                        >
                                            <div
                                                style={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: 8,
                                                }}
                                            >
                                                <span
                                                    style={{
                                                        width: 12,
                                                        height: 12,
                                                        borderRadius: 3,
                                                        background: r.__color || "#999",
                                                        border: "1px solid rgba(0,0,0,0.2)",
                                                    }}
                                                />
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div
                                                        style={{
                                                            fontSize: 13,
                                                            fontWeight: 700,
                                                            whiteSpace: "nowrap",
                                                            overflow: "hidden",
                                                            textOverflow: "ellipsis",
                                                        }}
                                                    >
                                                        {r.name || "(Unnamed)"}
                                                    </div>
                                                    <div
                                                        style={{
                                                            fontSize: 12,
                                                            opacity: 0.8,
                                                            whiteSpace: "nowrap",
                                                            overflow: "hidden",
                                                            textOverflow: "ellipsis",
                                                        }}
                                                    >
                                                        {sub}
                                                    </div>
                                                </div>
                                                {r.__driverId != null && (
                                                    <div style={{ fontSize: 11, opacity: 0.8 }}>
                                                        {r.__driverName}
                                                    </div>
                                                )}
                                            </div>
                                        </button>
                                    );
                                })
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Right: Tools + legend + bulk assign */}
            <div
                style={{
                    position: "absolute",
                    zIndex: 1000,
                    top: 12,
                    right: 12,
                    width: 320,
                    display: "flex",
                    flexDirection: "column",
                    gap: 10,
                    pointerEvents: "auto",
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
            >
                {(selectedCount > 0 || hoverIds.size > 0) && (
                    <div
                        style={{
                            background: "rgba(255,255,255,0.98)",
                            border: "1px solid #cde",
                            borderRadius: 12,
                            padding: 10,
                            boxShadow: "0 6px 18px rgba(0,0,0,0.18)",
                            display: "flex",
                            flexDirection: "column",
                            gap: 8,
                            outline: "2px solid rgba(0,120,255,0.15)",
                        }}
                    >
                        <div style={{ fontWeight: 700, fontSize: 13 }}>
                            {selectedCount} selected
                            {hoverIds.size ? ` (+${hoverIds.size} preview)` : ""}
                        </div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <label style={{ fontSize: 12 }}>Assign to:</label>
                            <select
                                value={bulkDriverId}
                                onChange={(e) => setBulkDriverId(e.target.value)}
                                disabled={bulkBusy}
                                style={{
                                    padding: "6px 8px",
                                    borderRadius: 8,
                                    border: "1px solid #ccc",
                                    flex: "1 1 auto",
                                    opacity: bulkBusy ? 0.7 : 1,
                                }}
                            >
                                <option value="">Choose driver…</option>
                                {sortedDrivers.map((opt) => (
                                    <option key={opt.driverId} value={opt.driverId}>
                                        {opt.name}
                                    </option>
                                ))}
                            </select>
                            <button
                                onClick={() => applyBulkAssign(bulkDriverId)}
                                disabled={!bulkDriverId || bulkBusy || selectedCount === 0}
                                style={{
                                    padding: "8px 10px",
                                    borderRadius: 10,
                                    border: "1px solid #2a7",
                                    background:
                                        !bulkDriverId || bulkBusy || selectedCount === 0
                                            ? "#f6f6f6"
                                            : "#eaffea",
                                    cursor:
                                        !bulkDriverId || bulkBusy || selectedCount === 0
                                            ? "not-allowed"
                                            : "pointer",
                                    fontWeight: 600,
                                    whiteSpace: "nowrap",
                                }}
                                title={bulkBusy ? "Assigning…" : `Assign ${selectedCount}`}
                            >
                                {bulkBusy ? "Assigning…" : `Assign ${selectedCount}`}
                            </button>
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                            <button
                                onClick={clearSelection}
                                disabled={bulkBusy}
                                style={{
                                    flex: 1,
                                    padding: "8px 10px",
                                    borderRadius: 10,
                                    border: "1px solid #ddd",
                                    background: "#fff",
                                    cursor: bulkBusy ? "not-allowed" : "pointer",
                                    fontWeight: 600,
                                    opacity: bulkBusy ? 0.7 : 1,
                                }}
                            >
                                Clear
                            </button>
                        </div>
                        <div style={{ display: "flex", gap: 8 }}>
                            <button
                                onClick={deleteGeocodingForSelected}
                                disabled={bulkBusy || selectedCount === 0}
                                style={{
                                    flex: 1,
                                    padding: "8px 10px",
                                    borderRadius: 10,
                                    border: "1px solid #d32f2f",
                                    background: bulkBusy || selectedCount === 0 ? "#f6f6f6" : "#ffebee",
                                    color: bulkBusy || selectedCount === 0 ? "#999" : "#c62828",
                                    cursor: bulkBusy || selectedCount === 0 ? "not-allowed" : "pointer",
                                    fontWeight: 600,
                                    opacity: bulkBusy ? 0.7 : 1,
                                }}
                                title="Remove lat/lng coordinates for selected users"
                            >
                                Delete Geocoding
                            </button>
                        </div>
                        <div style={{ fontSize: 11, opacity: 0.8, lineHeight: 1.3 }}>
                            Box: hold <b>Shift</b> and drag (add). Hold{" "}
                            <b>Alt/Option/Ctrl/Cmd</b> when releasing to subtract.
                            <br />
                            Click: enable <b>Click to select</b>, or hold{" "}
                            <b>Alt/Option/Ctrl/Cmd</b> while clicking a dot.
                        </div>
                    </div>
                )}

                <div
                    style={{
                        background: "rgba(255,255,255,0.97)",
                        border: "1px solid #ddd",
                        borderRadius: 12,
                        padding: 10,
                        boxShadow: "0 2px 10px rgba(0,0,0,0.12)",
                        overflow: "auto",
                        maxHeight: "55vh",
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                    }}
                >
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>
                        Stops: {totalVisibleStops} &nbsp;
                    </div>

                    <CheckRow
                        id="toggle-routes"
                        checked={showRouteLines}
                        onChange={setShowRouteLines}
                        label="Show route lines"
                        title="Draw a line connecting stops in order for each driver"
                    />
                    <CheckRow
                        id="toggle-area"
                        checked={selectMode}
                        onChange={setSelectMode}
                        label="Area select (Shift+drag)"
                        title="Shift-drag to select, Alt/Option/Ctrl/Cmd to subtract"
                    />
                    <CheckRow
                        id="toggle-click"
                        checked={clickPickMode}
                        onChange={setClickPickMode}
                        label="Click to select (one-by-one)"
                        title="When ON, clicking a dot toggles selection (no popup)"
                    />

                    {/* Filter status row */}
                    {hasFilter && (
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                fontSize: 12,
                                background: "#f6fbff",
                                border: "1px solid #cfe8ff",
                                borderRadius: 8,
                                padding: "6px 8px",
                            }}
                        >
                            <div style={{ fontWeight: 700 }}>
                                Filtering {driverFilter.size} driver{driverFilter.size > 1 ? "s" : ""}
                            </div>
                            <button
                                type="button"
                                onClick={clearDriverFilter}
                                style={{
                                    marginLeft: "auto",
                                    padding: "4px 8px",
                                    borderRadius: 8,
                                    border: "1px solid #cde",
                                    background: "#fff",
                                    cursor: "pointer",
                                    fontSize: 12,
                                    fontWeight: 600,
                                }}
                                title="Show all drivers"
                            >
                                Clear filter
                            </button>
                        </div>
                    )}

                    {/* Unrouted summary + NEW "Select all unrouted" */}
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ fontSize: 12, opacity: 0.8 }}>
                            Unrouted (visible): {unroutedVisible}
                        </div>
                        {unroutedVisible > 0 && !hasFilter && (
                            <button
                                type="button"
                                onClick={selectAllUnrouted}
                                title="Select all geocoded unrouted stops so you can bulk-assign them"
                                style={{
                                    marginLeft: "auto",
                                    padding: "6px 8px",
                                    borderRadius: 8,
                                    border: "1px solid #cde",
                                    background: "#f7fbff",
                                    cursor: "pointer",
                                    fontSize: 12,
                                    fontWeight: 600,
                                }}
                            >
                                Select all unrouted
                            </button>
                        )}
                    </div>

                    {/* Clickable driver index */}
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {indexItems.map((it) => {
                            const idNum = Number(it.driverId);
                            const active = driverFilter.has(idNum);
                            const isEditing = editingDriverId === it.driverId;
                            const isDriver0 = /driver\s+0/i.test(it.name || "");

                            return (
                                <div
                                    key={it.driverId}
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: 8,
                                        fontSize: 13,
                                        width: "100%",
                                        textAlign: "left",
                                        padding: "8px 10px",
                                        borderRadius: 10,
                                        border: active ? "1px solid #7db3ff" : "1px solid #ddd",
                                        background: active ? "#eef5ff" : "#fff",
                                    }}
                                >
                                    <span
                                        style={{
                                            width: 16,
                                            height: 16,
                                            borderRadius: 4,
                                            background: it.color,
                                            border: "1px solid rgba(0,0,0,0.15)",
                                            flexShrink: 0,
                                        }}
                                    />

                                    {isEditing ? (
                                        <>
                                            <span style={{ fontSize: 12 }}>Driver</span>
                                            <input
                                                type="number"
                                                value={editingNumber}
                                                onChange={(e) => setEditingNumber(e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === "Enter") saveEditDriver();
                                                    if (e.key === "Escape") cancelEditDriver();
                                                }}
                                                autoFocus
                                                style={{
                                                    width: 50,
                                                    padding: "2px 6px",
                                                    fontSize: 13,
                                                    border: "1px solid #ccc",
                                                    borderRadius: 4,
                                                }}
                                            />
                                            <button
                                                onClick={saveEditDriver}
                                                style={{
                                                    padding: "2px 8px",
                                                    fontSize: 12,
                                                    border: "1px solid #2a7",
                                                    borderRadius: 4,
                                                    background: "#eaffea",
                                                    cursor: "pointer",
                                                }}
                                            >
                                                ✓
                                            </button>
                                            <button
                                                onClick={cancelEditDriver}
                                                style={{
                                                    padding: "2px 8px",
                                                    fontSize: 12,
                                                    border: "1px solid #ccc",
                                                    borderRadius: 4,
                                                    background: "#f6f6f6",
                                                    cursor: "pointer",
                                                }}
                                            >
                                                ✕
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            <button
                                                type="button"
                                                onClick={() => toggleDriverFilter(it.driverId)}
                                                title={active ? "Remove from filter" : "Show only this driver"}
                                                style={{
                                                    flex: 1,
                                                    background: "transparent",
                                                    border: "none",
                                                    textAlign: "left",
                                                    cursor: "pointer",
                                                    whiteSpace: "nowrap",
                                                    overflow: "hidden",
                                                    textOverflow: "ellipsis",
                                                    fontWeight: active ? 700 : 500,
                                                    padding: 0,
                                                }}
                                            >
                                                {it.name}
                                            </button>
                                            <div
                                                style={{
                                                    fontVariantNumeric: "tabular-nums",
                                                    opacity: 0.85,
                                                    paddingLeft: 6,
                                                }}
                                            >
                                                {it.count}
                                            </div>
                                            {!isDriver0 && onRenameDriver && (
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        startEditDriver(it.driverId, it.name);
                                                    }}
                                                    title="Edit driver number"
                                                    style={{
                                                        padding: "2px 6px",
                                                        fontSize: 11,
                                                        border: "1px solid #ddd",
                                                        borderRadius: 4,
                                                        background: "#fff",
                                                        cursor: "pointer",
                                                        opacity: 0.7,
                                                    }}
                                                >
                                                    ✎
                                                </button>
                                            )}
                                        </>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* MAP */}
            <div
                style={{
                    height: "100%",
                    width: "100%",
                    borderRadius: 12,
                    overflow: "hidden",
                    position: "relative",
                }}
            >
                <MapContainer
                    key="drivers-map-stable"
                    center={initialCenter}
                    zoom={initialZoom}
                    style={{
                        height: "100%",
                        width: "100%",
                        filter: showOverlay ? "grayscale(30%) brightness(0.9)" : "none",
                    }}
                    scrollWheelZoom
                    zoomControl={false}
                >
                    <MapBridge onReady={handleMapReady} />

                    <TileLayer
                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                        attribution="&copy; OpenStreetMap contributors"
                    />
                    <ZoomControl position="bottomleft" />

                    {/* High-z pane to keep pins above everything */}
                    <Pane name="pins" style={{ zIndex: 650 }} />

                    {/* halo */}
                    {Number.isFinite(selectedHalo.lat) && Number.isFinite(selectedHalo.lng) && (
                        <CircleMarker
                            center={[selectedHalo.lat, selectedHalo.lng]}
                            pathOptions={{
                                color: selectedHalo.color,
                                fillColor: selectedHalo.color,
                                fillOpacity: 0.18,
                            }}
                            radius={18}
                            weight={3}
                            interactive={false}
                            pane="pins"
                        />
                    )}

                    {/* route lines */}
                    {showRouteLines &&
                        visibleDrivers.map((d) => {
                            const pts = (d.stops || []).map(getLL).filter(Boolean);
                            if (pts.length < 2) return null;
                            return (
                                <Polyline
                                    key={`route-${String(d.driverId)}`}
                                    positions={pts}
                                    pathOptions={{
                                        color: d.color || "#1f77b4",
                                        weight: 4,
                                        opacity: 0.8,
                                    }}
                                />
                            );
                        })}

                    {/* UNROUTED markers */}
                    {unroutedFilteredVisible.map((s) => {
                        const ll = getLL(s);
                        if (!ll) return null;
                        const id = sid(s.id);
                        const pos = jitterLL(ll, id);
                        return (
                            <Marker
                                key={`u-${id}`}
                                position={pos}
                                pane="pins"
                                zIndexOffset={2000}
                                icon={makePinIcon("#666", selectedIds.has(id) || hoverIds.has(id))}
                                ref={(ref) => {
                                    const m = asLeafletMarker(ref);
                                    if (m) unroutedMarkerRefs.current.set(id, m);
                                }}
                                eventHandlers={{
                                    click: (e) => handleMarkerClick(id, s, "#666", e),
                                }}
                            />
                        );
                    })}

                    {/* ASSIGNED markers */}
                    {visibleDrivers.map((d, di) =>
                        (d.stops || []).map((s) => {
                            const ll = getLL(s);
                            if (!ll) return null;
                            const id = sid(s.id);
                            const pos = jitterLL(ll, id);
                            const base = d.color || "#1f77b4";
                            const z = 2100 + di; // slightly above unrouted, and stable order
                            return (
                                <Marker
                                    key={`d-${sid(d.driverId)}-s-${id}`}
                                    position={pos}
                                    pane="pins"
                                    zIndexOffset={z}
                                    icon={makePinIcon(base, selectedIds.has(id) || hoverIds.has(id))}
                                    ref={(ref) => {
                                        const m = asLeafletMarker(ref);
                                        if (m) assignedMarkerRefs.current.set(id, m);
                                    }}
                                    eventHandlers={{
                                        click: (e) => handleMarkerClick(id, s, base, e),
                                    }}
                                />
                            );
                        })
                    )}
                </MapContainer>

                {/* Loading overlay (separate component) */}
                <MapLoadingOverlay show={showOverlay} logoSrc={logoSrc || "/logo.png"} />
            </div>
        </div>
    );
}

export const runtime = "nodejs";
