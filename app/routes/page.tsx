'use client';

// components/DriversDialog.jsx converted to Routes Page
"use client";

import * as React from "react";
import {
    Button,
    Box,
    Typography,
} from "@mui/material";
import Link from "next/link";
import dynamic from "next/dynamic";
const DriversMapLeaflet = dynamic(() => import("@/components/routes/DriversMapLeaflet"), { ssr: false });
const ClientDriverAssignment = dynamic(() => import("@/components/routes/ClientDriverAssignment"), { ssr: false });

import ManualGeocodeDialog from "@/components/routes/ManualGeocodeDialog";
import { exportRouteLabelsPDF } from "@/utils/pdfRouteLabels";
import { DateFilter } from "@/components/routes/DateFilter";
import { fetchDrivers } from "@/lib/api";
import styles from './routes.module.css';

/* =================== helpers / palette =================== */
const palette = [
    "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd",
    "#8c564b", "#e377c2", "#17becf", "#bcbd22", "#393b79",
    "#ad494a", "#637939", "#ce6dbd", "#8c6d31", "#7f7f7f",
];

const nameOf = (u: any = {}) => {
    const n = u.name ?? u.fullName ?? `${u.first ?? ""} ${u.last ?? ""}`.trim();
    if (n) return n;
    const addr = `${u.address ?? ""}${u.apt ? " " + u.apt : ""}`.trim();
    return addr || "Unnamed";
};

/* ========= complex detection (unchanged) ========= */
const toBool = (v: any) => {
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;
    if (typeof v === "string") {
        const s = v.trim().toLowerCase();
        return s === "true" || s === "1" || s === "yes" || s === "y";
    }
    return false;
};
const displayNameLoose = (u: any = {}) => {
    const cands = [
        u.name, u.fullName,
        `${u.first ?? ""} ${u.last ?? ""}`.trim(),
        `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim(),
        u?.user?.name,
        `${u?.user?.first ?? ""} ${u?.user?.last ?? ""}`.trim(),
    ].filter(Boolean);
    return cands[0] || "";
};
const normalize = (s: any) =>
    String(s || "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .replace(/[^\p{L}\p{N}\s]/gu, "")
        .trim();
const normalizePhone = (s: any) => String(s || "").replace(/\D+/g, "").replace(/^1/, "");
const normalizeAddr = (u: any = {}) =>
    normalize([u.address || u.addr || "", u.apt || u.unit || "", u.city || "", u.state || "", u.zip || ""].filter(Boolean).join(", "));
const llKey = (u: any) => {
    const lat = typeof u.lat === "number" ? u.lat : u.latitude;
    const lng = typeof u.lng === "number" ? u.lng : u.longitude;
    const lk = Number.isFinite(lat) ? lat.toFixed(4) : "";
    const gk = Number.isFinite(lng) ? lng.toFixed(4) : "";
    return `${lk}|${gk}`;
};
function buildComplexIndex(users: any[] = []) {
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
function markStopComplex(stop: any, idx: any, idxs: any) {
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

    return { ...s, complex: false, __complexSource: "none" };
}

/* ===== driver numbering helpers (keep Driver 0 first) ===== */
const parseDriverNum = (name: any) => {
    const m = /driver\s+(\d+)/i.exec(String(name || ""));
    return m ? parseInt(m[1], 10) : null;
};
const rankForRoute = (route: any, idxFallback = 0) => {
    const n = parseDriverNum(route?.driverName || route?.name);
    return Number.isFinite(n) ? n : idxFallback;
};

/* ======================================================== */

export default function RoutesPage() {
    const [driverCount, setDriverCount] = React.useState(6);
    const [selectedDay] = React.useState("all");
    // Default to today's date in YYYY-MM-DD format
    const getTodayDate = () => {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };
    const [selectedDeliveryDate, setSelectedDeliveryDate] = React.useState(getTodayDate());

    const [routes, setRoutes] = React.useState<any[]>([]);
    const [unrouted, setUnrouted] = React.useState<any[]>([]);
    const [users, setUsers] = React.useState<any[]>([]);

    const [busy, setBusy] = React.useState(false);
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
            console.log(`[RoutesPage] Loaded routes for day="${selectedDay}":`, {
                routesCount: (data.routes || []).length,
                unroutedCount: (data.unrouted || []).length,
                routes: data.routes || []
            });
            
            if (!data.routes || data.routes.length === 0) {
                console.warn(`[RoutesPage] ⚠️ No drivers found for day="${selectedDay}". Click "Generate New Route" to create drivers.`);
            }

            // Log users without stops to browser console
            if (data.usersWithoutStops && Array.isArray(data.usersWithoutStops)) {
                console.log(`\n[RoutesPage] Checking users without stops for day: ${selectedDay}`);
                if (data.usersWithoutStops.length === 0) {
                    console.log(`  ✅ All users have stops for day: ${selectedDay}`);
                } else {
                    data.usersWithoutStops.forEach((user: any) => {
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
        // Load users
        (async () => {
            try {
                const usersRes = await fetch('/api/users', { cache: 'no-store' });
                if (usersRes.ok) {
                    const usersData = await usersRes.json();
                    setUsers(Array.isArray(usersData) ? usersData : []);
                    
                    const missing = usersData.filter((u: any) => (u.lat ?? u.latitude) == null || (u.lng ?? u.longitude) == null);
                    setMissingBatch(missing);
                }
            } catch (e) {
                console.error("Failed to load users", e);
            }
        })();

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
                console.log(`[RoutesPage] Initial load for day="${selectedDay}":`, {
                    routesCount: (data1.routes || []).length,
                    unroutedCount: (data1.unrouted || []).length
                });
                
                if (!data1.routes || data1.routes.length === 0) {
                    console.warn(`[RoutesPage] ⚠️ No drivers found on initial load for day="${selectedDay}". User needs to generate routes.`);
                }

                // Log users without stops to browser console
                if (data1.usersWithoutStops && Array.isArray(data1.usersWithoutStops)) {
                    console.log(`\n[RoutesPage] Checking users without stops for day: ${selectedDay}`);
                    if (data1.usersWithoutStops.length === 0) {
                        console.log(`  ✅ All users have stops for day: ${selectedDay}`);
                    } else {
                        data1.usersWithoutStops.forEach((user: any) => {
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
                        console.log(`[RoutesPage] Created ${cleanupData.stopsCreated} missing stops for day "${selectedDay}"`);
                    }
                } else {
                    const errorText = await res3.text().catch(() => "Unknown error");
                    console.error(`[RoutesPage] Cleanup failed for "${selectedDay}":`, errorText);
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
                                console.log(`[RoutesPage] Created ${allData.stopsCreated} missing stops for day "all"`);
                            }
                        }
                    } catch (e) {
                        console.error("[RoutesPage] Cleanup for 'all' day failed:", e);
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
                // Silently fail - don't block the page
            } finally {
                setBusy(false);
            }
        })();
    }, [selectedDay, selectedDeliveryDate]);

    async function handleManualGeocoded(updates: any) {
        try {
            await Promise.all(
                updates.map(({ id, lat, lng, ...rest }: any) =>
                    fetch(`/api/users/${id}`, {
                        method: "PUT",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ lat, lng, cascadeStops: true, ...rest }),
                    }).then(async (r) => {
                        if (!r.ok) throw new Error(await r.text().catch(() => `HTTP ${r.status}`));
                    })
                )
            );
            setUsers(prev => {
                const updated = [...prev];
                updates.forEach((u: any) => {
                    const idx = updated.findIndex(usr => String(usr.id) === String(u.id));
                    if (idx >= 0) {
                        updated[idx] = { ...updated[idx], ...u };
                    }
                });
                return updated;
            });
            setMissingBatch((prev) => prev.filter((u: any) => !updates.some((x: any) => x.id === u.id)));
        } catch (err: any) {
            console.error("Manual geocode save failed:", err);
            alert("Save failed: " + (err?.message || "Unknown error"));
        }
    }

    /* ============================================================
     *  SAVE-CURRENT RUN (active run overwrite)
     * ============================================================ */
    const saveTimerRef = React.useRef<NodeJS.Timeout | null>(null);
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
    const handleReassign = React.useCallback(async (stop: any, toDriverId: any) => {
        const toId = String(toDriverId); // Keep as string to match API expectations
        console.log("[handleReassign] Starting reassign:", { stopId: stop.id, toDriverId: toId, stop });
        // optimistic local UI (in page routes copy)
        setRoutes(prevRoutes => {
            const next = prevRoutes.map(r => ({ ...r, stops: [...(r.stops || [])] }));
            if (stop.__driverId) {
                const fromIdx = next.findIndex(r => String(r.driverId) === String(stop.__driverId));
                const toIdx   = next.findIndex(r => String(r.driverId) === String(toId));
                if (fromIdx === -1 || toIdx === -1) return prevRoutes;
                const sIdx = next[fromIdx].stops.findIndex((s: any) => String(s.id) === String(stop.id));
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
            alert("Reassign didn't save. View refreshed.");
        }
    }, [selectedDay, loadRoutes, saveCurrentRun, selectedDeliveryDate]);

    // Driver id -> color map for marker coloring by assigned driver (client's assigned_driver_id)
    const driverIdToColor = React.useMemo(() => {
        const m = new Map<string, string>();
        (routes || []).forEach((r, i) => {
            const id = String(r.driverId ?? r.id ?? "");
            if (id) m.set(id, r.color || palette[i % palette.length]);
        });
        return m;
    }, [routes]);

    // Map-facing drivers (kept in sync with page routes)
    // Marker colors use the assigned driver's color (client's assigned_driver_id), not the route owner
    const mapDrivers = React.useMemo(() => {
        return (routes || []).map((r, i) => {
            const driverId = String(r.driverId ?? r.id ?? ""); // Keep as string (UUID) to match database
            const color = r.color || palette[i % palette.length];
            const dname = r.driverName || r.name || `Driver ${i}`;
            const stops = (r.stops || [])
                .map((u: any, idx: number) => {
                    const assignedId = u.assigned_driver_id ?? null;
                    const assignedColor = assignedId ? driverIdToColor.get(String(assignedId)) : null;
                    return {
                        id: u.id,
                        userId: u.userId ?? u.id,
                        name: nameOf(u),
                        first: u.first || u.first_name || null,
                        last: u.last || u.last_name || null,
                        firstName: u.first || u.first_name || null,
                        lastName: u.last || u.last_name || null,
                        first_name: u.first || u.first_name || null,
                        last_name: u.last || u.last_name || null,
                        fullName: u.fullName || u.full_name || null,
                        full_name: u.fullName || u.full_name || null,
                        address: `${u.address ?? ""}${u.apt ? " " + u.apt : ""}`.trim(),
                        phone: u.phone ?? "",
                        city: u.city ?? "",
                        state: u.state ?? "",
                        zip: u.zip ?? "",
                        lat: Number(u.lat),
                        lng: Number(u.lng),
                        __driverId: driverId,
                        __driverName: dname,
                        assigned_driver_id: assignedId,
                        __driverColor: assignedColor ?? "#666",
                        __stopIndex: idx,
                        orderId: u.orderId || null,
                        orderDate: u.orderDate || null,
                        deliveryDate: u.deliveryDate || u.delivery_date || null,
                        orderStatus: u.orderStatus || null,
                        completed: u.completed,
                        dislikes: u.dislikes || "",
                    };
                })
                .filter((s: any) => Number.isFinite(s.lat) && Number.isFinite(s.lng));
            return {
                id: driverId,
                driverId: driverId,
                name: dname,
                color: color,
                polygon: [],
                stops,
            };
        });
    }, [routes, driverIdToColor]);

    // Enrich unrouted stops with __driverColor from client's assigned driver
    const enrichedUnrouted = React.useMemo(() => {
        return (unrouted || []).map((s: any) => {
            const assignedId = s.assigned_driver_id ?? null;
            const assignedColor = assignedId ? driverIdToColor.get(String(assignedId)) : null;
            return { ...s, __driverColor: assignedColor ?? "#666" };
        });
    }, [unrouted, driverIdToColor]);

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
        } catch (e: any) {
            console.error("Cleanup failed:", e);
            if (!silent) alert("Cleanup failed: " + (e?.message || "Unknown error"));
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
        // Create meta with route data and stops directly from routes
        const meta = (routes || []).map((r, i) => ({
            i,
            num: rankForRoute(r, i),
            color: r?.color,
            name: r?.driverName || r?.name || `Driver ${i}`,
            stops: r?.stops || [], // Get stops directly from route
        }));
        meta.sort((a, b) => {
            const aa = Number.isFinite(a.num) ? a.num : (a.i ?? 0);
            const bb = Number.isFinite(b.num) ? b.num : (b.i ?? 0);
            return (aa ?? 0) - (bb ?? 0) || (a.i ?? 0) - (b.i ?? 0);
        });
        const colorsSorted = meta.map((m, idx) => m.color || driverColors[m.i] || palette[idx % palette.length]);
        const enrichedSorted = meta.map((m, newIdx) => {
            const driverNum = Number.isFinite(m.num) ? m.num : newIdx;
            const driverName = `Driver ${driverNum}`;
            // Use stops directly from meta (which came from routes)
            const arr = (m.stops || []);
            return arr.map((s: any, si: number) => ({
                ...s,
                __driverNumber: driverNum,
                __driverName: driverName,
                __stopIndex: si,
            }));
        });
        return { enrichedSorted, colorsSorted };
    }, [routes, driverColors]);

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
        } catch (e: any) {
            console.error("Remove driver failed:", e);
            alert("Failed to remove driver: " + (e?.message || "Unknown error"));
        } finally {
            setBusy(false);
        }
    }

    // Rename a driver
    async function handleRenameDriver(driverId: any, newNumber: any) {
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
        <div className={styles.container} style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
            <ManualGeocodeDialog
                open={manualOpen}
                onClose={() => setManualOpen(false)}
                usersMissing={missingBatch}
                onGeocoded={handleManualGeocoded}
            />

            {/* Header */}
            <div style={{ 
                padding: 'var(--spacing-md)', 
                borderBottom: '1px solid var(--border-color)',
                display: 'grid',
                gridTemplateColumns: '1fr auto 1fr',
                alignItems: 'center',
                gap: 'var(--spacing-md)',
            }}>
                {/* LEFT: Title */}
                <div style={{ justifySelf: 'start', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)', flexWrap: 'wrap' }}>
                    <span style={{ fontSize: '1.5rem' }}>Routes Map</span>
                </div>

                {/* RIGHT: Link */}
                <div style={{ justifySelf: 'end', display: 'flex', alignItems: 'center', gap: 'var(--spacing-md)' }}>
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
                </div>
            </div>

            {/* Tabs */}
            <div style={{ borderBottom: "1px solid #e5e7eb", display: "flex", gap: 0 }}>
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
                    Orders View
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
            </div>

            {/* Tab Content */}
            <div style={{ flex: 1, position: 'relative', minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                {activeTab === "map" ? (
                    <div style={{ height: "100%", width: "100%", position: "relative", display: 'flex', flexDirection: 'column' }}>
                        {/* Date Filter inside Orders View tab */}
                        <div style={{ 
                            padding: 'var(--spacing-md)', 
                            borderBottom: '1px solid var(--border-color)',
                            display: 'flex', 
                            alignItems: 'center',
                            backgroundColor: 'white',
                            position: 'relative'
                        }}>
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
                        </div>
                        <div style={{ flex: 1, position: "relative", minHeight: 0 }}>
                            {(() => {
                                const Component = DriversMapLeaflet as any;
                                return <Component
                                    drivers={mapDrivers}
                                    unrouted={enrichedUnrouted}
                                    onReassign={handleReassign}
                                    onRenameDriver={handleRenameDriver}
                                    busy={busy}
                                    readonly={false}
                                    onExpose={(api: any) => { mapApiRef.current = api || null; }}
                                    onComputedStats={(s: any) => setStats(s)}
                                    initialCenter={[40.7128, -74.006]}
                                    initialZoom={5}
                                    isOrdersViewTab={activeTab === "map"}
                                />;
                            })()}
                        </div>
                    </div>
                ) : (
                    <div style={{ height: "100%", width: "100%", position: "relative", minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column' }}>
                        {/* Generate Route + Driver Management buttons inside Client Assignment tab */}
                        <div style={{ 
                            padding: 'var(--spacing-md)', 
                            borderBottom: '1px solid var(--border-color)',
                            display: 'flex', 
                            gap: 'var(--spacing-xs)', 
                            alignItems: 'center',
                            backgroundColor: 'white',
                            position: 'relative',
                            flexWrap: 'wrap'
                        }}>
                            <Button
                                onClick={regenerateRoutes}
                                variant="contained"
                                color="error"
                                disabled={busy}
                                sx={{ fontWeight: 700, borderRadius: 2 }}
                            >
                                Generate New Route
                            </Button>
                            <Button
                                onClick={handleAddDriver}
                                variant="outlined"
                                size="small"
                                disabled={busy}
                                sx={{ borderRadius: 2 }}
                            >
                                ➕ Add Driver
                            </Button>
                            <Button
                                onClick={handleRemoveDriver}
                                variant="outlined"
                                size="small"
                                disabled={busy || routes.length <= 1}
                                sx={{ borderRadius: 2 }}
                            >
                                ➖ Remove Driver
                            </Button>
                            <div style={{ fontSize: 13, color: "#6b7280", marginLeft: 'var(--spacing-xs)' }}>
                                Drivers: {routes.filter(r => {
                                    const driverName = r.driverName || r.name || "";
                                    return !/driver\s+0/i.test(driverName);
                                }).length}
                            </div>
                        </div>
                        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                            <ClientDriverAssignment
                                routes={routes}
                                selectedDay={selectedDay}
                                selectedDeliveryDate={selectedDeliveryDate}
                                readOnly={false}
                                onDriverAssigned={() => {
                                    loadRoutes();
                                    saveCurrentRun(true);
                                }}
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Footer Actions */}
            <div style={{ 
                padding: 'var(--spacing-md)', 
                borderTop: '1px solid var(--border-color)',
                display: 'flex',
                gap: 'var(--spacing-xs)',
                flexWrap: 'wrap',
                alignItems: 'center'
            }}>
                {missingBatch.length > 0 && (
                    <Typography variant="body2" sx={{ mr: "auto", opacity: 0.8 }}>
                        {missingBatch.length} customer{missingBatch.length === 1 ? "" : "s"} are not geocoded.
                        <Button size="small" sx={{ ml: 1 }} onClick={() => setManualOpen(true)}>
                            Manual Geocoding
                        </Button>
                    </Typography>
                )}

                <Button
                    onClick={async () => {
                        setBusy(true);
                        try {
                            // Validate we have routes with stops
                            if (!routes || routes.length === 0) {
                                alert('No routes available. Please generate routes first.');
                                return;
                            }

                            // Log route structure for debugging
                            console.log('[Download Labels] Routes structure:', {
                                routesCount: routes.length,
                                routesWithStops: routes.filter(r => r.stops && r.stops.length > 0).length,
                                totalStops: routes.reduce((sum, r) => sum + (r.stops?.length || 0), 0),
                                sampleRoute: routes[0] ? {
                                    driverId: routes[0].driverId,
                                    driverName: routes[0].driverName,
                                    stopsCount: routes[0].stops?.length || 0,
                                    sampleStop: routes[0].stops?.[0] || null
                                } : null,
                                selectedDate: selectedDeliveryDate
                            });

                            const totalStopsInRoutes = routes.reduce((sum, r) => sum + (r.stops?.length || 0), 0);
                            if (totalStopsInRoutes === 0) {
                                alert('No stops found in routes. Please assign stops to drivers first.');
                                return;
                            }

                            const idxs = buildComplexIndex(users);

                            // Mark stops as complex using routeStops (with proper indices) before building enrichedSorted
                            const complexMarked = (routeStops || []).map((stops) =>
                                (stops || []).map((s: any, si: number) => {
                                    const marked = markStopComplex(s, si, idxs);
                                    return marked;
                                })
                            );

                            // Build a map of complex-marked stops by ID
                            const complexById = new Map();
                            complexMarked.forEach((route: any[]) => route.forEach((s: any) => complexById.set(String(s.id), s)));

                            const { enrichedSorted, colorsSorted } = buildSortedForLabels();
                            
                            // Validate enrichedSorted has data
                            if (!enrichedSorted || enrichedSorted.length === 0) {
                                console.error('[Download Labels] enrichedSorted is empty', { 
                                    routes, 
                                    routesCount: routes.length,
                                    routesWithStops: routes.filter(r => r.stops && r.stops.length > 0).length
                                });
                                alert('No stops found to export. Please check that routes have stops assigned.');
                                return;
                            }

                            const totalEnrichedStops = enrichedSorted.reduce((sum, route) => sum + (route?.length || 0), 0);
                            if (totalEnrichedStops === 0) {
                                console.error('[Download Labels] No stops in enrichedSorted', { 
                                    enrichedSorted, 
                                    routes,
                                    routesCount: routes.length,
                                    routesWithStops: routes.filter(r => r.stops && r.stops.length > 0).length
                                });
                                alert('No stops found to export. Please check that routes have stops assigned.');
                                return;
                            }
                            
                            // Map complex flags from marked stops to enrichedSorted
                            const stampedWithComplex = enrichedSorted.map((route, ri) =>
                                (route || []).map((s: any, si: number) => {
                                    if (!s || !s.id) return null;
                                    // Ensure stop has at least name or address for PDF rendering
                                    const hasName = s.name || s.fullName || s.first || s.last || s.firstName || s.lastName;
                                    const hasAddress = s.address;
                                    if (!hasName && !hasAddress) {
                                        console.warn('[Download Labels] Skipping stop without name or address:', s.id);
                                        return null;
                                    }
                                    const cm = complexById.get(String(s.id));
                                    return { ...s, complex: cm?.complex ?? false, __complexSource: cm?.__complexSource ?? "none" };
                                }).filter(Boolean)
                            );

                            // Final validation - filter out any empty routes
                            const filteredForExport = stampedWithComplex.filter(route => route && route.length > 0);
                            const totalStops = filteredForExport.reduce((sum, route) => sum + (route?.length || 0), 0);
                            
                            // Count complex stops for logging
                            const complexStopsCount = filteredForExport.reduce((sum, route) => 
                                sum + route.filter((s: any) => s?.complex === true).length, 0
                            );
                            
                            console.log('[Download Labels] Exporting:', {
                                routes: filteredForExport.length,
                                totalStops,
                                complexStops: complexStopsCount,
                                stopsPerRoute: filteredForExport.map(r => r?.length || 0),
                                complexPerRoute: filteredForExport.map(r => r.filter((s: any) => s?.complex === true).length),
                                sampleStop: totalStops > 0 ? filteredForExport[0]?.[0] : null,
                                sampleComplexStop: complexStopsCount > 0 ? filteredForExport.flat().find((s: any) => s?.complex === true) : null,
                                selectedDate: selectedDeliveryDate,
                            });

                            if (totalStops === 0) {
                                alert('No stops found to export after processing. Please check the console for details.');
                                console.error('[Download Labels] Debug info:', {
                                    routesCount: routes.length,
                                    routeStopsCount: routeStops.length,
                                    enrichedSortedCount: enrichedSorted.length,
                                    enrichedSortedStops: enrichedSorted.reduce((sum, r) => sum + (r?.length || 0), 0),
                                });
                                return;
                            }

                            // Routes are already filtered by selected date (API). Use those stops = same as map in Orders View.
                            const filenameFn = () =>
                                selectedDeliveryDate ? String(selectedDeliveryDate) : tsString();

                            await exportRouteLabelsPDF(filteredForExport, colorsSorted, filenameFn);
                        } catch (error) {
                            console.error('[Download Labels] Error:', error);
                            alert('Failed to generate labels: ' + (error instanceof Error ? error.message : String(error)));
                        } finally {
                            setBusy(false);
                        }
                    }}
                    variant="outlined"
                    disabled={busy || !hasRoutes}
                >
                    Download Labels
                </Button>

                <Button onClick={resetAllRoutes} variant="outlined" disabled={busy || !hasRoutes}>
                    Reset All Routes
                </Button>

                <Button onClick={optimizeAllRoutes} variant="outlined" disabled={busy || !hasRoutes}>
                    Optimize All Routes
                </Button>
            </div>
        </div>
    );
}
