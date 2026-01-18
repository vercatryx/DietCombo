// components/DriversDialog.jsx
"use client";

import * as React from "react";
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    Button,
    Box,
    Typography,
    Switch,
    FormControlLabel,
} from "@mui/material";
import Link from "next/link";
import dynamic from "next/dynamic";
const DriversMapLeaflet = dynamic(() => import("./DriversMapLeaflet"), { ssr: false });
const ClientDriverAssignment = dynamic(() => import("./ClientDriverAssignment"), { ssr: false });

import ManualGeocodeDialog from "./ManualGeocodeDialog";
import { exportRouteLabelsPDF } from "@/utils/pdfRouteLabels";
import { DateFilter } from "./DateFilter";

/* =================== helpers / palette =================== */
const palette = [
    "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd",
    "#8c564b", "#e377c2", "#17becf", "#bcbd22", "#393b79",
    "#ad494a", "#637939", "#ce6dbd", "#8c6d31", "#7f7f7f",
];

const nameOf = (u = {}) => {
    const n = u.name ?? u.fullName ?? `${u.first ?? ""} ${u.last ?? ""}`.trim();
    if (n) return n;
    const addr = `${u.address ?? ""}${u.apt ? " " + u.apt : ""}`.trim();
    return addr || "Unnamed";
};

/* ========= complex detection (unchanged) ========= */
const toBool = (v) => {
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;
    if (typeof v === "string") {
        const s = v.trim().toLowerCase();
        return s === "true" || s === "1" || s === "yes" || s === "y";
    }
    return false;
};
const displayNameLoose = (u = {}) => {
    const cands = [
        u.name, u.fullName,
        `${u.first ?? ""} ${u.last ?? ""}`.trim(),
        `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim(),
        u?.user?.name,
        `${u?.user?.first ?? ""} ${u?.user?.last ?? ""}`.trim(),
    ].filter(Boolean);
    return cands[0] || "";
};
const normalize = (s) =>
    String(s || "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .replace(/[^\p{L}\p{N}\s]/gu, "")
        .trim();
const normalizePhone = (s) => String(s || "").replace(/\D+/g, "").replace(/^1/, "");
const normalizeAddr = (u = {}) =>
    normalize([u.address || u.addr || "", u.apt || u.unit || "", u.city || "", u.state || "", u.zip || ""].filter(Boolean).join(", "));
const llKey = (u) => {
    const lat = typeof u.lat === "number" ? u.lat : u.latitude;
    const lng = typeof u.lng === "number" ? u.lng : u.longitude;
    const lk = Number.isFinite(lat) ? lat.toFixed(4) : "";
    const gk = Number.isFinite(lng) ? lng.toFixed(4) : "";
    return `${lk}|${gk}`;
};
function buildComplexIndex(users = []) {
    const idSet = new Set();
    const nameSet = new Set();
    const phoneSet = new Set();
    const addrSet = new Set();
    const llSet = new Set();

    for (const u of users) {
        const isCx =
            toBool(u?.complex) ||
            toBool(u?.isComplex) ||
            toBool(u?.flags?.complex) ||
            toBool(u?.user?.complex) ||
            toBool(u?.User?.complex) ||
            toBool(u?.client?.complex);
        if (!isCx) continue;

        if (u.id != null) idSet.add(String(u.id));
        const nm = normalize(displayNameLoose(u));
        if (nm) nameSet.add(nm);
        const ph = normalizePhone(u.phone);
        if (ph) phoneSet.add(ph);
        const ak = normalizeAddr(u);
        if (ak) addrSet.add(ak);
        const ll = llKey(u);
        if (ll !== "|") llSet.add(ll);
    }
    return { idSet, nameSet, phoneSet, addrSet, llSet };
}
function markStopComplex(stop, idx, idxs) {
    const s = stop || {};
    const direct =
        toBool(s?.complex) ||
        toBool(s?.isComplex) ||
        toBool(s?.flags?.complex) ||
        toBool(s?.user?.complex) ||
        toBool(s?.User?.complex) ||
        toBool(s?.client?.complex);
    if (direct) {
        const userName = nameOf(s);
        if (userName && userName.toUpperCase().includes('ETEL') && userName.toUpperCase().includes('ROSEN')) {
            console.warn('[Complex Detection] ETEL ROSEN marked complex by direct flag:', {
                id: s.id,
                userId: s.userId,
                name: userName,
                complex: s.complex,
                isComplex: s.isComplex,
                flags: s.flags,
                user: s.user,
            });
        }
        return { ...s, complex: true, __complexSource: "stop.direct" };
    }

    const ids = [
        s.userId, s.userID, s.userid, s?.user?.id, s?.User?.id, s?.client?.id, s.id,
    ].map(v => (v == null ? null : String(v))).filter(Boolean);
    for (const id of ids) {
        if (idxs.idSet.has(id)) {
            const userName = nameOf(s);
            if (userName && userName.toUpperCase().includes('ETEL') && userName.toUpperCase().includes('ROSEN')) {
                console.log('[Complex Detection] ETEL ROSEN marked complex by user ID:', {
                    id: s.id,
                    userId: s.userId,
                    name: userName,
                    matchedId: id,
                });
            }
            return { ...s, complex: true, __complexSource: "user.id" };
        }
    }

    // NOTE: Name matching removed - different people can have the same name
    // const nm = normalize(displayNameLoose(s));
    // if (nm && idxs.nameSet.has(nm)) return { ...s, complex: true, __complexSource: "user.name" };

    // NOTE: Phone matching removed - phone numbers can be shared (family members, businesses)
    // This was causing false positives where non-complex users were marked complex
    // const ph = normalizePhone(s.phone || s?.user?.phone);
    // if (ph && idxs.phoneSet.has(ph)) return { ...s, complex: true, __complexSource: "user.phone" };

    // NOTE: Address matching removed - addresses can be shared (apartments, family members)
    // This was causing false positives where non-complex users were marked complex
    // const ak = normalizeAddr(s);
    // if (ak && idxs.addrSet.has(ak)) return { ...s, complex: true, __complexSource: "user.addr" };

    // NOTE: lat/lng matching removed - nearby addresses shouldn't automatically be complex
    // const ll = llKey(s);
    // if (ll !== "|" && idxs.llSet.has(ll)) {
    //     return { ...s, complex: true, __complexSource: "user.latlng" };
    // }

    return { ...s, complex: false, __complexSource: "none" };
}

/* ===== driver numbering helpers (keep Driver 0 first) ===== */
const parseDriverNum = (name) => {
    const m = /driver\s+(\d+)/i.exec(String(name || ""));
    return m ? parseInt(m[1], 10) : null;
};
const rankForRoute = (route, idxFallback = 0) => {
    const n = parseDriverNum(route?.driverName || route?.name);
    return Number.isFinite(n) ? n : idxFallback;
};

/* ======================================================== */

export default function DriversDialog({
                                          open,
                                          onClose,
                                          users = [],
                                          initialDriverCount = 6,
                                          initialSelectedDay = "all",
                                          onUsersPatched,
                                      }) {
    const [driverCount, setDriverCount] = React.useState(Number(initialDriverCount || 6));
    const [selectedDay] = React.useState(initialSelectedDay || "all");
    // Default to today's date in YYYY-MM-DD format
    const getTodayDate = () => {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };
    const [selectedDeliveryDate, setSelectedDeliveryDate] = React.useState(getTodayDate());

    const [routes, setRoutes] = React.useState([]);
    const [unrouted, setUnrouted] = React.useState([]);

    const [mapOpen, setMapOpen] = React.useState(false);
    const [busy, setBusy] = React.useState(false);
    const [isReadOnlyMode, setIsReadOnlyMode] = React.useState(false);
    const [activeTab, setActiveTab] = React.useState("map"); // "map" or "clients"


    // Map API reference (set once via onExpose)
    const mapApiRef = React.useRef(null);

    // Stats coming from the map (selected count, etc.)
    const [stats, setStats] = React.useState({ selectedCount: 0, totalAssigned: 0, unroutedVisible: 0, indexItems: [] });

    // Manual geocode dialog
    const [missingBatch, setMissingBatch] = React.useState([]);
    const [manualOpen, setManualOpen] = React.useState(false);

    const hasRoutes = routes.length > 0;

    const loadRoutes = React.useCallback(async () => {
        setBusy(true);
        try {
            let url = `/api/route/routes?day=${selectedDay}`;
            if (selectedDeliveryDate) {
                url += `&delivery_date=${selectedDeliveryDate}`;
            }
            const res = await fetch(url, { cache: "no-store" });
            const data = await res.json();
            setRoutes(data.routes || []);
            setUnrouted(data.unrouted || []);

            // Debug: Log route data
            console.log(`[DriversDialog] Loaded routes for day="${selectedDay}":`, {
                routesCount: (data.routes || []).length,
                unroutedCount: (data.unrouted || []).length,
                routes: data.routes || []
            });
            
            if (!data.routes || data.routes.length === 0) {
                console.warn(`[DriversDialog] ⚠️ No drivers found for day="${selectedDay}". Click "Generate New Route" to create drivers.`);
            }

            // Log users without stops to browser console
            if (data.usersWithoutStops && Array.isArray(data.usersWithoutStops)) {
                console.log(`\n[DriversDialog] Checking users without stops for day: ${selectedDay}`);
                if (data.usersWithoutStops.length === 0) {
                    console.log(`  ✅ All users have stops for day: ${selectedDay}`);
                } else {
                    data.usersWithoutStops.forEach((user) => {
                        console.log(`  ❌ User #${user.id} (${user.name}): ${user.reason}`);
                    });
                    console.log(`  📊 Total users without stops: ${data.usersWithoutStops.length}`);
                }
            }
        } catch (e) {
            console.error("Failed to load routes", e);
        } finally {
            setBusy(false);
        }
    }, [selectedDay, selectedDeliveryDate]);


    React.useEffect(() => {
        if (!open) return;
        const missing = users.filter(u => (u.lat ?? u.latitude) == null || (u.lng ?? u.longitude) == null);
        setMissingBatch(missing);
        setMapOpen(true);

        // Load data and then auto-cleanup
        (async () => {
            setBusy(true);
            try {
                // Load initial data
                let url1 = `/api/route/routes?day=${selectedDay}`;
                if (selectedDeliveryDate) {
                    url1 += `&delivery_date=${selectedDeliveryDate}`;
                }
                const res1 = await fetch(url1, { cache: "no-store" });
                const data1 = await res1.json();
                setRoutes(data1.routes || []);
                setUnrouted(data1.unrouted || []);
                
                // Debug: Log initial route data
                console.log(`[DriversDialog] Initial load for day="${selectedDay}":`, {
                    routesCount: (data1.routes || []).length,
                    unroutedCount: (data1.unrouted || []).length
                });
                
                if (!data1.routes || data1.routes.length === 0) {
                    console.warn(`[DriversDialog] ⚠️ No drivers found on initial load for day="${selectedDay}". User needs to generate routes.`);
                }

                // Log users without stops to browser console
                if (data1.usersWithoutStops && Array.isArray(data1.usersWithoutStops)) {
                    console.log(`\n[DriversDialog] Checking users without stops for day: ${selectedDay}`);
                    if (data1.usersWithoutStops.length === 0) {
                        console.log(`  ✅ All users have stops for day: ${selectedDay}`);
                    } else {
                        data1.usersWithoutStops.forEach((user) => {
                            console.log(`  ❌ User #${user.id} (${user.name}): ${user.reason}`);
                        });
                        console.log(`  📊 Total users without stops: ${data1.usersWithoutStops.length}`);
                    }
                }


                // Auto-cleanup after initial load (for selected day and "all" for drivers)
                // This ensures all active users (not paused, delivery=true) have stops
                let cleanupUrl = `/api/route/cleanup?day=${selectedDay}`;
                if (selectedDeliveryDate) {
                    cleanupUrl += `&delivery_date=${selectedDeliveryDate}`;
                }
                const res3 = await fetch(cleanupUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                });

                let cleanupData = null;
                if (res3.ok) {
                    cleanupData = await res3.json().catch(() => null);
                    if (cleanupData?.stopsCreated > 0) {
                        console.log(`[DriversDialog] Created ${cleanupData.stopsCreated} missing stops for day "${selectedDay}"`);
                    }
                } else {
                    const errorText = await res3.text().catch(() => "Unknown error");
                    console.error(`[DriversDialog] Cleanup failed for "${selectedDay}":`, errorText);
                }

                // Also cleanup "all" day routes (used by driver app)
                if (selectedDay !== "all") {
                    try {
                        const resAll = await fetch("/api/route/cleanup?day=all", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                        });
                        if (resAll.ok) {
                            const allData = await resAll.json().catch(() => null);
                            if (allData?.stopsCreated > 0) {
                                console.log(`[DriversDialog] Created ${allData.stopsCreated} missing stops for day "all"`);
                            }
                        }
                    } catch (e) {
                        console.error("[DriversDialog] Cleanup for 'all' day failed:", e);
                    }
                }

                if (res3.ok) {
                    // Reload after cleanup
                    let url4 = `/api/route/routes?day=${selectedDay}`;
                    if (selectedDeliveryDate) {
                        url4 += `&delivery_date=${selectedDeliveryDate}`;
                    }
                    const res4 = await fetch(url4, { cache: "no-store" });
                    const data4 = await res4.json();
                    setRoutes(data4.routes || []);
                    setUnrouted(data4.unrouted || []);

                }
            } catch (e) {
                console.error("Auto-cleanup failed:", e);
                // Silently fail - don't block the dialog
            } finally {
                setBusy(false);
            }
        })();
    }, [open, users, selectedDay, selectedDeliveryDate]);

    async function handleManualGeocoded(updates) {
        try {
            await Promise.all(
                updates.map(({ id, lat, lng, ...rest }) =>
                    fetch(`/api/users/${id}`, {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ lat, lng, cascadeStops: true, ...rest }),
                    }).then(async (r) => {
                        if (!r.ok) throw new Error(await r.text().catch(() => `HTTP ${r.status}`));
                    })
                )
            );
            onUsersPatched?.(updates);
            setMissingBatch((prev) => prev.filter((u) => !updates.some((x) => x.id === u.id)));
        } catch (err) {
            console.error("Manual geocode save failed:", err);
            alert("Save failed: " + (err.message || "Unknown error"));
        }
    }

    /* ============================================================
     *  SAVE-CURRENT RUN (active run overwrite)
     * ============================================================ */
    const saveTimerRef = React.useRef(null);
    const saveCurrentRun = React.useCallback((immediate = false) => {
        const doPost = async () => {
            try {
                await fetch("/api/route/runs/save-current", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        day: selectedDay,
                    }),
                });
            } catch (e) {
                console.warn("save-current failed:", e);
            }
        };
        if (immediate) {
            if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
            doPost();
            return;
        }
        if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
        saveTimerRef.current = setTimeout(doPost, 800); // debounce rapid edits
    }, [selectedDay]);

    // === Single reassign used by the map for individual popup assigns ===
    const handleReassign = React.useCallback(async (stop, toDriverId) => {
        const toId = String(toDriverId); // Keep as string to match API expectations
        console.log("[handleReassign] Starting reassign:", { stopId: stop.id, toDriverId: toId, stop });
        // optimistic local UI (in dialog routes copy)
        setRoutes(prevRoutes => {
            const next = prevRoutes.map(r => ({ ...r, stops: [...(r.stops || [])] }));
            if (stop.__driverId) {
                const fromIdx = next.findIndex(r => String(r.driverId) === String(stop.__driverId));
                const toIdx   = next.findIndex(r => String(r.driverId) === String(toId));
                if (fromIdx === -1 || toIdx === -1) return prevRoutes;
                const sIdx = next[fromIdx].stops.findIndex(s => String(s.id) === String(stop.id));
                if (sIdx === -1) return prevRoutes;
                const [moved] = next[fromIdx].stops.splice(sIdx, 1);
                next[toIdx].stops.push({ ...moved, __driverId: toId });
                return next;
            } else {
                const toIdx = next.findIndex(r => String(r.driverId) === String(toId));
                if (toIdx === -1) return prevRoutes;
                next[toIdx].stops.push({ ...stop, __driverId: toId });
                return next;
            }
        });
        if (!stop.__driverId) {
            setUnrouted(prev => prev.filter(u => String(u.id) !== String(stop.id)));
        }

        try {
            const res = await fetch("/api/route/reassign", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    day: selectedDay,
                    toDriverId: toId,
                    stopId: String(stop.id),
                    userId: stop.userId ? String(stop.userId) : undefined,
                    delivery_date: selectedDeliveryDate || undefined
                }),
            });
            if (!res.ok) throw new Error(await res.text());
            // persist snapshot to active run (debounced)
            saveCurrentRun();
        } catch (e) {
            console.error("Reassign failed:", e);
            await loadRoutes();
            alert("Reassign didn’t save. View refreshed.");
        }
    }, [selectedDay, loadRoutes, saveCurrentRun]);

    // Map-facing drivers (kept in sync with dialog routes)
    const mapDrivers = React.useMemo(() => {
        return (routes || []).map((r, i) => {
            const driverId = String(r.driverId ?? r.id ?? ""); // Keep as string (UUID) to match database
            const color = r.color || palette[i % palette.length];
            const dname = r.driverName || r.name || `Driver ${i}`;
            const stops = (r.stops || [])
                .map((u, idx) => ({
                    id: u.id,
                    userId: u.userId ?? u.id,
                    name: nameOf(u),
                    address: `${u.address ?? ""}${u.apt ? " " + u.apt : ""}`.trim(),
                    phone: u.phone ?? "",
                    city: u.city ?? "",
                    state: u.state ?? "",
                    zip: u.zip ?? "",
                    lat: Number(u.lat),
                    lng: Number(u.lng),
                    __driverId: driverId,
                    __driverName: dname,
                    __stopIndex: idx,
                }))
                .filter(s => Number.isFinite(s.lat) && Number.isFinite(s.lng));
            return { id: driverId, driverId, name: dname, color, polygon: [], stops };
        });
    }, [routes]);

    const routeStops = React.useMemo(() => routes.map(r => (r.stops || [])), [routes]);
    const driverColors = React.useMemo(() => routes.map((r, i) => r.color || palette[i % palette.length]), [routes]);

    function tsString() {
        const d = new Date();
        const mm = d.getMonth() + 1;
        const dd = d.getDate();
        let h = d.getHours();
        const m = d.getMinutes();
        const ampm = h >= 12 ? "PM" : "AM";
        h = h % 12 || 12;
        return `${mm}-${dd} ${h}:${String(m).padStart(2, "0")}${ampm}`;
    }


    // ====== NEW: dedicated cleanup ======
    async function cleanUpNow({ silent = false } = {}) {
        setBusy(true);
        try {
            const res = await fetch("/api/route/cleanup", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ 
                    day: selectedDay,
                    delivery_date: selectedDeliveryDate || undefined
                }),
            });
            if (!res.ok) throw new Error(await res.text());
            await loadRoutes();
            // Save the cleaned state back to the active run
            saveCurrentRun(true);
            if (!silent) alert("Cleanup completed.");
        } catch (e) {
            console.error("Cleanup failed:", e);
            if (!silent) alert("Cleanup failed: " + (e.message || "Unknown error"));
        } finally {
            setBusy(false);
        }
    }

    // NEW: regenerate routes (fresh version)
    async function regenerateRoutes() {
        const countStr = window.prompt("How many drivers for the new route?", String(driverCount));
        if (countStr == null) return;
        const count = Number(countStr);
        if (!Number.isFinite(count) || count <= 0) {
            alert("Enter a valid number.");
            return;
        }

        setDriverCount(count);
        const ok = window.confirm(`Regenerate routes for "${selectedDay}" with ${count} drivers?`);
        if (!ok) return;

        try {
            setBusy(true);

            const res = await fetch("/api/route/generate", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ 
                    day: selectedDay, 
                    driverCount: count,
                    delivery_date: selectedDeliveryDate || undefined
                }),
            });
            if (!res.ok) throw new Error(await res.text());

            // Refresh map data
            await loadRoutes();
        } catch (e) {
            console.error(e);
            alert("Failed to regenerate.");
        } finally {
            setBusy(false);
        }
    }

    // UPDATED: when resetting, also run a cleanup pass afterward
    async function resetAllRoutes() {
        if (!routes.length) return;
        const ok = window.confirm(
            `Reset ALL routes for "${selectedDay}"?\n\nNote: This will also run Cleanup (remove deleted users, paused users, or users with Delivery = false).`
        );
        if (!ok) return;

        const driverIds = Array.from(new Set(routes.map(r => r.driverId).filter(Boolean)));
        setBusy(true);
        try {
            await Promise.all(driverIds.map(id =>
                fetch("/api/route/reset", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ driverId: id, day: selectedDay, clearProof: false }),
                })
            ));

            // Immediately follow with a cleanup pass
            await cleanUpNow({ silent: true });

            await loadRoutes();

            // Persist snapshot after bulk change
            saveCurrentRun(true);
            alert("Routes reset and cleaned.");
        } catch (e) {
            console.error(e);
            alert("Failed to reset routes.");
        } finally {
            setBusy(false);
        }
    }

    async function optimizeAllRoutes() {
        if (!routes.length) return;

        setBusy(true);
        try {
            const driverIds = Array.from(new Set(routes.map(r => r.driverId).filter(Boolean)));

            // STEP A: pre-pass to consolidate duplicates across drivers
            {
                const res = await fetch("/api/route/optimize", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        day: selectedDay,
                        useDietFantasyStart: true,
                        consolidateDuplicates: true,
                    }),
                });
                if (!res.ok) throw new Error(await res.text());
            }

            // STEP B: per-driver local reordering only (no cross-driver moves)
            await Promise.all(
                driverIds.map(id =>
                    fetch("/api/route/optimize", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            driverId: id,
                            day: selectedDay,
                            useDietFantasyStart: true,
                        }),
                    })
                )
            );

            await loadRoutes();
            saveCurrentRun(true);
        } catch (e) {
            console.error(e);
            alert("Failed to optimize routes.");
        } finally {
            setBusy(false);
        }
    }

    // ===== PDF helpers (unchanged but referenced) =====
    const buildSortedForLabels = React.useCallback(() => {
        const meta = (routes || []).map((r, i) => ({
            i,
            num: rankForRoute(r, i),
            color: r?.color,
            name: r?.driverName || r?.name || `Driver ${i}`,
        }));
        meta.sort((a, b) => {
            const aa = Number.isFinite(a.num) ? a.num : a.i;
            const bb = Number.isFinite(b.num) ? b.num : b.i;
            return aa - bb || a.i - b.i;
        });
        const colorsSorted = meta.map((m, idx) => m.color || driverColors[m.i] || palette[idx % palette.length]);
        const enrichedSorted = meta.map((m, newIdx) => {
            const driverNum = Number.isFinite(m.num) ? m.num : newIdx;
            const driverName = `Driver ${driverNum}`;
            const arr = (routeStops[m.i] || []);
            return arr.map((s, si) => ({
                ...s,
                __driverNumber: driverNum,
                __driverName: driverName,
                __stopIndex: si,
            }));
        });
        return { enrichedSorted, colorsSorted };
    }, [routes, routeStops, driverColors]);

    // Add a new driver
    async function handleAddDriver() {
        setBusy(true);
        try {
            const res = await fetch("/api/route/add-driver", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ day: selectedDay }),
            });
            if (!res.ok) {
                let errorMessage = "Failed to add driver";
                try {
                    const errorData = await res.json();
                    errorMessage = errorData.error || errorMessage;
                } catch {
                    // If response is not JSON, try to get text
                    try {
                        const errorText = await res.text();
                        errorMessage = errorText || errorMessage;
                    } catch {
                        errorMessage = `HTTP ${res.status}: ${res.statusText}`;
                    }
                }
                throw new Error(errorMessage);
            }
            await loadRoutes();
            saveCurrentRun(true);
            alert("Driver added successfully");
        } catch (e) {
            console.error("Add driver failed:", e);
            const errorMessage = e instanceof Error ? e.message : String(e);
            alert("Failed to add driver: " + errorMessage);
        } finally {
            setBusy(false);
        }
    }

    // Remove a driver
    async function handleRemoveDriver() {
        // Get list of drivers (excluding Driver 0)
        const removableDrivers = routes.filter(r => {
            const driverName = r.driverName || r.name || "";
            const isDriver0 = /driver\s+0/i.test(driverName);
            return !isDriver0;
        });

        if (removableDrivers.length === 0) {
            alert("No drivers to remove");
            return;
        }

        // Show selection dialog
        const driverNames = removableDrivers.map((r, idx) => `${idx + 1}. ${r.driverName || r.name || "Unknown"} (${r.stops?.length || 0} stops)`).join("\n");
        const selection = window.prompt(
            `Select driver to remove (enter number):\n${driverNames}`,
            "1"
        );

        if (!selection) return; // User cancelled

        const idx = parseInt(selection, 10) - 1;
        if (idx < 0 || idx >= removableDrivers.length) {
            alert("Invalid selection");
            return;
        }

        const driverToRemove = removableDrivers[idx];

        setBusy(true);
        try {
            const res = await fetch("/api/route/remove-driver", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ day: selectedDay, driverId: driverToRemove.driverId }),
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || "Failed to remove driver");
            }

            await loadRoutes();
            saveCurrentRun(true);
            alert("Driver removed successfully");
        } catch (e) {
            console.error("Remove driver failed:", e);
            alert("Failed to remove driver: " + (e.message || "Unknown error"));
        } finally {
            setBusy(false);
        }
    }

    // Rename a driver
    async function handleRenameDriver(driverId, newNumber) {
        try {
            const res = await fetch("/api/route/rename-driver", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ driverId, newNumber }),
            });

            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || "Failed to rename driver");
            }

            await loadRoutes();
            saveCurrentRun(true);
        } catch (e) {
            console.error("Rename driver failed:", e);
            throw e; // Re-throw so the map component can handle it
        }
    }


    return (
        <>
            <ManualGeocodeDialog
                open={manualOpen}
                onClose={() => setManualOpen(false)}
                usersMissing={missingBatch}
                onGeocoded={handleManualGeocoded}
            />

            <Dialog
                open={mapOpen}
                onClose={() => { setMapOpen(false); onClose?.(); }}
                maxWidth="lg"
                fullWidth
                PaperProps={{ style: { height: "80vh", position: "relative" } }}
            >
                <DialogTitle sx={{ pb: 1 }}>
                    <Box
                        sx={{
                            display: "grid",
                            gridTemplateColumns: "1fr auto 1fr",
                            alignItems: "center",
                            gap: 1,
                        }}
                    >
                        {/* LEFT: Title */}
                        <Box sx={{ justifySelf: "start", fontWeight: 600 }}>
                            <span>Routes Map</span>
                        </Box>

                        {/* CENTER: Generate + Driver Management */}
                        <Box sx={{ justifySelf: "center", display: "flex", flexDirection: "column", gap: 1, alignItems: "center" }}>
                            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                                <Button
                                    onClick={regenerateRoutes}
                                    variant="contained"
                                    color="error"
                                    disabled={busy || isReadOnlyMode}
                                    sx={{ fontWeight: 700, borderRadius: 2 }}
                                >
                                    Generate New Route
                                </Button>
                            </Box>

                            <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                                <Button
                                    onClick={handleAddDriver}
                                    variant="outlined"
                                    size="small"
                                    disabled={busy || isReadOnlyMode}
                                    sx={{ borderRadius: 2 }}
                                >
                                    ➕ Add Driver
                                </Button>
                                <Button
                                    onClick={handleRemoveDriver}
                                    variant="outlined"
                                    size="small"
                                    disabled={busy || isReadOnlyMode || routes.length <= 1}
                                    sx={{ borderRadius: 2 }}
                                >
                                    ➖ Remove Driver
                                </Button>
                                <Box sx={{ fontSize: 13, color: "#6b7280", ml: 1 }}>
                                    Drivers: {routes.filter(r => {
                                        const driverName = r.driverName || r.name || "";
                                        return !/driver\s+0/i.test(driverName);
                                    }).length}
                                </Box>
                            </Box>
                        </Box>

                        {/* RIGHT: Mode switch + link */}
                        <Box sx={{ justifySelf: "end", display: "flex", alignItems: "center", gap: 2 }}>
                            <FormControlLabel
                                control={
                                    <Switch
                                        checked={!isReadOnlyMode}
                                        onChange={(e) => setIsReadOnlyMode(!e.target.checked)}
                                        size="small"
                                    />
                                }
                                label={
                                    <Typography variant="body2" sx={{ fontSize: 12 }}>
                                        {isReadOnlyMode ? "Readonly" : "Admin Edit"}
                                    </Typography>
                                }
                                sx={{ m: 0 }}
                            />
                            <Link
                                href="/drivers"
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ fontSize: 12, color: "#4b5563", textDecoration: "none" }}
                                onMouseEnter={(e) => (e.currentTarget.style.textDecoration = "underline")}
                                onMouseLeave={(e) => (e.currentTarget.style.textDecoration = "none")}
                            >
                                Drivers →
                            </Link>
                        </Box>
                    </Box>
                </DialogTitle>

                <DialogContent dividers sx={{ position: "relative", p: 0, display: "flex", flexDirection: "column" }}>
                    {/* Date Filter */}
                    <Box sx={{ p: 2, borderBottom: "1px solid #e5e7eb" }}>
                        <DateFilter
                            selectedDate={selectedDeliveryDate}
                            onDateChange={(date) => setSelectedDeliveryDate(date)}
                            onClear={() => {
                                const today = new Date();
                                const year = today.getFullYear();
                                const month = String(today.getMonth() + 1).padStart(2, '0');
                                const day = String(today.getDate()).padStart(2, '0');
                                setSelectedDeliveryDate(`${year}-${month}-${day}`);
                            }}
                        />
                    </Box>

                    {/* Tabs */}
                    <Box sx={{ borderBottom: "1px solid #e5e7eb", display: "flex", gap: 0 }}>
                        <Button
                            onClick={() => setActiveTab("map")}
                            variant={activeTab === "map" ? "contained" : "text"}
                            sx={{
                                borderRadius: 0,
                                textTransform: "none",
                                fontWeight: activeTab === "map" ? 600 : 400,
                                borderBottom: activeTab === "map" ? "2px solid" : "none",
                                borderColor: activeTab === "map" ? "primary.main" : "transparent",
                            }}
                        >
                            Map View
                        </Button>
                        <Button
                            onClick={() => setActiveTab("clients")}
                            variant={activeTab === "clients" ? "contained" : "text"}
                            sx={{
                                borderRadius: 0,
                                textTransform: "none",
                                fontWeight: activeTab === "clients" ? 600 : 400,
                                borderBottom: activeTab === "clients" ? "2px solid" : "none",
                                borderColor: activeTab === "clients" ? "primary.main" : "transparent",
                            }}
                        >
                            Client Assignment
                        </Button>
                    </Box>

                    {/* Tab Content */}
                    {activeTab === "map" ? (
                        <Box sx={{ height: "100%", width: "100%", position: "relative", flex: 1 }}>
                            <DriversMapLeaflet
                                drivers={mapDrivers}
                                unrouted={unrouted}
                                onReassign={isReadOnlyMode ? undefined : handleReassign}
                                onRenameDriver={isReadOnlyMode ? undefined : handleRenameDriver}
                                busy={busy}
                                readonly={isReadOnlyMode}
                                onExpose={(api) => { mapApiRef.current = api || null; }}
                                onComputedStats={(s) => setStats(s)}
                                initialCenter={[40.7128, -74.006]}
                                initialZoom={5}
                            />
                        </Box>
                    ) : (
                        <Box sx={{ height: "100%", width: "100%", position: "relative", flex: 1, minHeight: 0 }}>
                            <ClientDriverAssignment
                                routes={routes}
                                selectedDay={selectedDay}
                                selectedDeliveryDate={selectedDeliveryDate}
                                onDriverAssigned={() => {
                                    loadRoutes();
                                    saveCurrentRun(true);
                                }}
                            />
                        </Box>
                    )}
                </DialogContent>

                <DialogActions sx={{ gap: 1, flexWrap: "wrap" }}>
                    {missingBatch.length > 0 && (
                        <Typography variant="body2" sx={{ mr: "auto", opacity: 0.8 }}>
                            {missingBatch.length} customer{missingBatch.length === 1 ? "" : "s"} are not geocoded.
                            <Button size="small" sx={{ ml: 1 }} onClick={() => setManualOpen(true)} disabled={isReadOnlyMode}>
                                Manual Geocoding
                            </Button>
                        </Typography>
                    )}

                    <Button
                        onClick={async () => {
                            setBusy(true);
                            try {
                                const idxs = buildComplexIndex(users);

                                // Debug: Check for FRADY SILBERSTEIN
                                console.log('[Download Labels] Checking for FRADY SILBERSTEIN in complex index');
                                const fradyInIndex = Array.from(idxs.nameSet).filter(n => n.includes('frady') && n.includes('silberstein'));
                                console.log('[Download Labels] FRADY SILBERSTEIN names in complex index:', fradyInIndex);

                                const complexMarked = (routeStops || []).map((stops) =>
                                    (stops || []).map((s, si) => {
                                        const marked = markStopComplex(s, si, idxs);
                                        const userName = nameOf(s);
                                        if (userName && userName.toUpperCase().includes('FRADY') && userName.toUpperCase().includes('SILBERSTEIN')) {
                                            console.log('[Download Labels] FRADY SILBERSTEIN found:', {
                                                id: s.id,
                                                userId: s.userId,
                                                name: userName,
                                                address: s.address,
                                                complex: marked.complex,
                                                source: marked.__complexSource,
                                            });
                                        }
                                        return marked;
                                    })
                                );
                                const { enrichedSorted, colorsSorted } = buildSortedForLabels();
                                const complexById = new Map();
                                complexMarked.forEach(route => route.forEach(s => complexById.set(String(s.id), s)));
                                const stampedWithComplex = enrichedSorted.map((route, ri) =>
                                    route.map((s, si) => {
                                        const cm = complexById.get(String(s.id));
                                        return { ...s, complex: cm?.complex ?? false, __complexSource: cm?.__complexSource ?? 'none' };
                                    })
                                );
                                await exportRouteLabelsPDF(stampedWithComplex, colorsSorted, tsString);
                            } finally {
                                setBusy(false);
                            }
                        }}
                        variant="outlined"
                        disabled={busy || !hasRoutes || isReadOnlyMode}
                    >
                        Download Labels
                    </Button>

                    <Button onClick={resetAllRoutes} variant="outlined" disabled={busy || !hasRoutes || isReadOnlyMode}>
                        Reset All Routes
                    </Button>

                    <Button onClick={optimizeAllRoutes} variant="outlined" disabled={busy || !hasRoutes || isReadOnlyMode}>
                        Optimize All Routes
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
}