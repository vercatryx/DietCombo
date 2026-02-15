'use client';

// components/DriversDialog.jsx converted to Routes Page
"use client";

import * as React from "react";
import {
    Button,
    Box,
    Typography,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    FormControl,
    InputLabel,
    Select,
    MenuItem,
    CircularProgress,
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
    /** Lightweight data for Client Assignment: clients (with assigned_driver_id) + driver id→name (+ color). Loaded once. */
    const [assignmentData, setAssignmentData] = React.useState<{ clients: any[]; drivers: { id: string; name: string; color: string | null }[] } | null>(null);
    const [assignmentDataLoading, setAssignmentDataLoading] = React.useState(true);
    /** Orders for selected delivery date (DB-side via RPC). Fetched when Orders View tab is active. */
    const [ordersForDate, setOrdersForDate] = React.useState<{ order_ids: string[]; client_ids: string[] } | null>(null);
    /** Orders View: no fetch until user picks a date. null = show empty map only. */
    const [ordersViewDate, setOrdersViewDate] = React.useState<string | null>(null);

    const [busy, setBusy] = React.useState(false);
    const [reorganizing, setReorganizing] = React.useState(false);
    const [activeTab, setActiveTab] = React.useState("clients"); // "map" or "clients" — default: Client Assignment


    // Map API reference (set once via onExpose)
    const mapApiRef = React.useRef(null);

    // Stats coming from the map (selected count, etc.)
    const [stats, setStats] = React.useState({ selectedCount: 0, totalAssigned: 0, unroutedVisible: 0, indexItems: [] });

    // Manual geocode dialog
    const [missingBatch, setMissingBatch] = React.useState<any[]>([]);
    const [manualOpen, setManualOpen] = React.useState(false);

    const hasRoutes = routes.length > 0;

    const loadRoutes = React.useCallback(async () => {
        setBusy(true);
        try {
            // Same API as driver page: /api/route/routes with delivery_date for driver_route_order ordering
            const dateNorm = selectedDeliveryDate ? selectedDeliveryDate.split("T")[0].split(" ")[0] : null;
            let url = `/api/route/routes?day=${selectedDay}&light=1`;
            if (dateNorm) {
                url += `&delivery_date=${encodeURIComponent(dateNorm)}`;
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


    // Single lightweight load for Client Assignment: clients + driver map (DB-side filter). No /api/users, no full routes.
    React.useEffect(() => {
        (async () => {
            setAssignmentDataLoading(true);
            try {
                const res = await fetch(`/api/route/assignment-data?day=${selectedDay}`, { cache: "no-store" });
                if (!res.ok) throw new Error("Failed to load assignment data");
                const data = await res.json();
                setAssignmentData({ clients: data.clients || [], drivers: data.drivers || [] });
                const clients = data.clients || [];
                const missing = clients.filter((c: any) => (c.lat ?? null) == null || (c.lng ?? null) == null);
                setMissingBatch(missing);
            } catch (e) {
                console.error("Failed to load assignment data", e);
                setAssignmentData({ clients: [], drivers: [] });
            } finally {
                setAssignmentDataLoading(false);
            }
        })();
    }, [selectedDay]);

    // Load routes when Client Assignment or Map tab is active so route order (driver_route_order) is fresh for map lines and buttons.
    React.useEffect(() => {
        if (activeTab === "clients" || activeTab === "map") {
            loadRoutes();
        }
    }, [activeTab, selectedDay, selectedDeliveryDate, loadRoutes]);

    const refreshAssignmentData = React.useCallback(async () => {
        try {
            const res = await fetch(`/api/route/assignment-data?day=${selectedDay}`, { cache: "no-store" });
            if (res.ok) {
                const data = await res.json();
                setAssignmentData({ clients: data.clients || [], drivers: data.drivers || [] });
            }
        } catch (e) {
            console.error("Failed to refresh assignment data", e);
        }
    }, [selectedDay]);

    // Orders View: only load orders-for-date (no routes API, no stops). Map is built from clients + client_ids.
    React.useEffect(() => {
        if (activeTab !== "map" || !ordersViewDate) return;
        (async () => {
            setBusy(true);
            try {
                const ordRes = await fetch(`/api/route/orders-for-date?date=${ordersViewDate}`, { cache: "no-store" });
                if (ordRes.ok) {
                    const ordData = await ordRes.json();
                    console.log("[Routes Orders View] Fetched orders-for-date:", {
                        requestedDate: ordersViewDate,
                        delivery_date: ordData.delivery_date,
                        orderCount: (ordData.order_ids || []).length,
                        clientCount: (ordData.client_ids || []).length,
                    });
                    setOrdersForDate({
                        order_ids: ordData.order_ids || [],
                        client_ids: ordData.client_ids || [],
                    });
                } else {
                    setOrdersForDate(null);
                }
            } catch (e) {
                console.error("Failed to load orders for Orders View", e);
                setOrdersForDate(null);
            } finally {
                setBusy(false);
            }
        })();
    }, [activeTab, ordersViewDate]);

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
            setAssignmentData(prev => {
                if (!prev) return prev;
                const updated = prev.clients.map((c: any) => {
                    const u = updates.find((x: any) => String(x.id) === String(c.id));
                    return u ? { ...c, ...u } : c;
                });
                return { ...prev, clients: updated };
            });
            setMissingBatch((prev: any[]) => prev.filter((u: any) => !updates.some((x: any) => x.id === u.id)));
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
                const toIdx = next.findIndex(r => String(r.driverId) === String(toId));
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

    // Driver id -> color map (from routes when available, else from assignmentData.drivers for Orders View)
    const driverIdToColor = React.useMemo(() => {
        const m = new Map<string, string>();
        if ((routes || []).length > 0) {
            (routes || []).forEach((r, i) => {
                const id = String(r.driverId ?? r.id ?? "");
                if (id) m.set(id, r.color || palette[i % palette.length]);
            });
        } else if (assignmentData?.drivers?.length) {
            assignmentData.drivers.forEach((d, i) => {
                if (d.id) m.set(String(d.id), d.color || palette[i % palette.length]);
            });
        }
        return m;
    }, [routes, assignmentData?.drivers]);

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

    // Orders View: map from clients + orders (no stops). Clients with orders on selected date, grouped by assigned_driver_id.
    const clientIdsWithOrdersOnDate = React.useMemo(
        () => new Set<string>((ordersForDate?.client_ids || []).map((id) => String(id))),
        [ordersForDate?.client_ids]
    );
    const ordersViewClients = React.useMemo(() => {
        if (!assignmentData?.clients?.length || clientIdsWithOrdersOnDate.size === 0) return [];
        return assignmentData.clients.filter((c: any) => clientIdsWithOrdersOnDate.has(String(c.id)));
    }, [assignmentData?.clients, clientIdsWithOrdersOnDate]);

    const mapDriversOrdersView = React.useMemo(() => {
        const drivers = assignmentData?.drivers || [];
        return drivers.map((d, i) => {
            const driverId = String(d.id);
            const color = d.color || palette[i % palette.length];
            const stops = ordersViewClients
                .filter((c: any) => String(c.assigned_driver_id || c.assignedDriverId || "") === driverId)
                .filter((c: any) => c.lat != null && c.lng != null && Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lng)))
                .map((c: any, idx: number) => ({
                    id: c.id,
                    userId: c.id,
                    name: nameOf(c),
                    first: c.first ?? null,
                    last: c.last ?? null,
                    firstName: c.first ?? null,
                    lastName: c.last ?? null,
                    fullName: nameOf(c),
                    address: `${c.address ?? ""}${c.apt ? " " + c.apt : ""}`.trim(),
                    phone: c.phone ?? "",
                    city: c.city ?? "",
                    state: c.state ?? "",
                    zip: c.zip ?? "",
                    lat: Number(c.lat),
                    lng: Number(c.lng),
                    __driverId: driverId,
                    __driverName: d.name || `Driver ${i}`,
                    assigned_driver_id: driverId,
                    __driverColor: color,
                    __stopIndex: idx,
                    orderId: null,
                    orderDate: null,
                    deliveryDate: null,
                    orderStatus: null,
                    completed: false,
                    dislikes: "",
                }));
            return { id: driverId, driverId, name: d.name || `Driver ${i}`, color, polygon: [], stops };
        });
    }, [assignmentData?.drivers, ordersViewClients]);

    // Debug: log Orders View stop counts per driver
    React.useEffect(() => {
        if (activeTab === "map" && mapDriversOrdersView?.length > 0) {
            const counts = mapDriversOrdersView.map((r: any) => `${r.name}: ${r.stops?.length ?? 0}`);
            console.log("[Routes Orders View] mapDriversOrdersView stop counts:", counts);
        }
    }, [activeTab, mapDriversOrdersView]);

    const enrichedUnroutedOrdersView = React.useMemo(() => {
        const noDriver = ordersViewClients.filter(
            (c: any) => !(c.assigned_driver_id || c.assignedDriverId) && c.lat != null && c.lng != null && Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lng))
        );
        return noDriver.map((c: any) => ({
            id: c.id,
            userId: c.id,
            name: nameOf(c),
            first: c.first,
            last: c.last,
            address: c.address ?? "",
            lat: Number(c.lat),
            lng: Number(c.lng),
            assigned_driver_id: null,
            __driverColor: "#666",
        }));
    }, [ordersViewClients]);

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

    // ===== PDF helpers (unchanged but referenced) =====
    const buildSortedForLabels = React.useCallback(() => {
        const meta = (routes || []).map((r, i) => ({
            i,
            num: rankForRoute(r, i),
            color: r?.color,
            name: r?.driverName || r?.name || `Driver ${i}`,
        }));
        meta.sort((a, b) => {
            const aa: number = Number.isFinite(a.num) ? (a.num ?? 0) : a.i;
            const bb: number = Number.isFinite(b.num) ? (b.num ?? 0) : b.i;
            return aa - bb || a.i - b.i;
        });
        const colorsSorted = meta.map((m, idx) => m.color || driverColors[m.i] || palette[idx % palette.length]);
        const enrichedSorted = meta.map((m, newIdx) => {
            const driverNum = Number.isFinite(m.num) ? m.num : newIdx;
            const driverName = `Driver ${driverNum}`;
            const arr = (routeStops[m.i] || []);
            return arr.map((s: any, si: number) => ({
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

    // Set driver color (manual)
    const [colorDialogOpen, setColorDialogOpen] = React.useState(false);
    const [colorDriverId, setColorDriverId] = React.useState<string | "">("");
    const [colorValue, setColorValue] = React.useState("#1f77b4");

    const openColorDialog = React.useCallback(() => {
        const first = routes.find(r => r.driverId);
        if (first) {
            setColorDriverId(String(first.driverId));
            setColorValue((first.color && /^#[0-9A-Fa-f]{3,6}$/.test(first.color)) ? first.color : "#1f77b4");
        } else {
            setColorDriverId("");
            setColorValue("#1f77b4");
        }
        setColorDialogOpen(true);
    }, [routes]);

    async function handleSaveDriverColor() {
        if (!colorDriverId) return;
        setBusy(true);
        try {
            const res = await fetch("/api/route/driver-color", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ driverId: colorDriverId, color: colorValue }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed to set driver color");
            await loadRoutes();
            saveCurrentRun(true);
            setColorDialogOpen(false);
        } catch (e: any) {
            console.error("Set driver color failed:", e);
            alert("Failed to set driver color: " + (e?.message || "Unknown error"));
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

    // Reorganize routes - optimize stop order per driver by geolocation
    async function handleReorganizeRoutes() {
        setBusy(true);
        setReorganizing(true);
        try {
            const res = await fetch("/api/route/reorganize", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    day: selectedDay,
                    delivery_date: selectedDeliveryDate || undefined,
                }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Failed to reorganize routes");
            await loadRoutes();
            saveCurrentRun(true);
            alert("Routes reorganized successfully.");
        } catch (e: any) {
            console.error("Reorganize routes failed:", e);
            alert("Failed to reorganize routes: " + (e?.message || "Unknown error"));
            await loadRoutes();
        } finally {
            setBusy(false);
            setReorganizing(false);
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
                usersMissing={missingBatch as unknown as never[]}
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
                                selectedDate={ordersViewDate ?? ''}
                                onDateChange={(date) => {
                                    setOrdersViewDate(date);
                                    setSelectedDeliveryDate(date);
                                }}
                                datesSource="orders"
                                onClear={() => {
                                    setOrdersViewDate(null);
                                    setRoutes([]);
                                    setUnrouted([]);
                                    setOrdersForDate(null);
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
                                const useOrdersViewData = activeTab === "map" && ordersForDate?.client_ids != null;
                                // Use mapDrivers (from routes API / driver_route_order) whenever we have routes so route lines show correct order and update after Reorganize
                                const mapDriversForMap = routes.length > 0 ? mapDrivers : (useOrdersViewData ? mapDriversOrdersView : mapDrivers);
                                const dataSource = routes.length > 0 ? "mapDrivers (routes API)" : (useOrdersViewData ? "mapDriversOrdersView (orders-for-date)" : "mapDrivers");
                                console.log("[RoutesPage] map data source:", dataSource, "routes.length:", routes.length, "useOrdersViewData:", useOrdersViewData, "stops total:", mapDriversForMap?.reduce((n: number, r: any) => n + (r.stops?.length ?? 0), 0));
                                return <Component
                                    drivers={mapDriversForMap}
                                    unrouted={useOrdersViewData ? enrichedUnroutedOrdersView : enrichedUnrouted}
                                    onReassign={handleReassign}
                                    onRenameDriver={handleRenameDriver}
                                    busy={busy}
                                    readonly={false}
                                    onExpose={(api: any) => { mapApiRef.current = api || null; }}
                                    onComputedStats={(s: any) => setStats(s)}
                                    initialCenter={[40.7128, -74.006]}
                                    initialZoom={5}
                                    isOrdersViewTab={activeTab === "map"}
                                    dataSourceLabel={dataSource}
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
                            <DateFilter
                                selectedDate={selectedDeliveryDate}
                                onDateChange={(date) => {
                                    setSelectedDeliveryDate(date);
                                    setOrdersViewDate(date);
                                }}
                                datesSource="orders"
                                onClear={() => {
                                    const today = getTodayDate();
                                    setSelectedDeliveryDate(today);
                                    setOrdersViewDate(today);
                                }}
                            />
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
                            <Button
                                onClick={openColorDialog}
                                variant="outlined"
                                size="small"
                                disabled={busy || routes.length === 0}
                                sx={{ borderRadius: 2 }}
                            >
                                🎨 Set Driver Color
                            </Button>
                            <Dialog open={colorDialogOpen} onClose={() => setColorDialogOpen(false)} maxWidth="xs" fullWidth>
                                <DialogTitle>Set driver color</DialogTitle>
                                <DialogContent>
                                    <FormControl fullWidth sx={{ mt: 1, mb: 2 }}>
                                        <InputLabel id="driver-color-driver-label">Driver</InputLabel>
                                        <Select
                                            labelId="driver-color-driver-label"
                                            value={colorDriverId}
                                            label="Driver"
                                            onChange={(e) => {
                                                const id = e.target.value as string;
                                                setColorDriverId(id);
                                                const r = routes.find((x: any) => String(x.driverId) === String(id));
                                                if (r?.color && /^#[0-9A-Fa-f]{3,6}$/.test(r.color)) setColorValue(r.color);
                                            }}
                                        >
                                            {routes.filter((r: any) => r.driverId).map((r: any) => (
                                                <MenuItem key={r.driverId} value={r.driverId}>
                                                    {r.driverName || r.name || `Driver ${r.driverId}`}
                                                </MenuItem>
                                            ))}
                                        </Select>
                                    </FormControl>
                                    <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                                        <input
                                            type="color"
                                            value={colorValue}
                                            onChange={(e) => setColorValue(e.target.value)}
                                            style={{ width: 48, height: 36, padding: 0, border: "1px solid #ccc", borderRadius: 4, cursor: "pointer" }}
                                        />
                                        <Typography variant="body2" sx={{ color: "text.secondary" }}>
                                            {colorValue}
                                        </Typography>
                                    </Box>
                                </DialogContent>
                                <DialogActions>
                                    <Button onClick={() => setColorDialogOpen(false)}>Cancel</Button>
                                    <Button onClick={handleSaveDriverColor} variant="contained" disabled={busy}>
                                        Save
                                    </Button>
                                </DialogActions>
                            </Dialog>
                            <div style={{ fontSize: 13, color: "#6b7280", marginLeft: 'var(--spacing-xs)' }}>
                                Drivers: {routes.filter(r => {
                                    const driverName = r.driverName || r.name || "";
                                    return !/driver\s+0/i.test(driverName);
                                }).length}
                            </div>
                        </div>
                        <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
                            <ClientDriverAssignment
                                initialClients={assignmentData?.clients ?? []}
                                drivers={assignmentData?.drivers ?? []}
                                assignmentDataLoading={assignmentDataLoading}
                                selectedDay={selectedDay}
                                selectedDeliveryDate={selectedDeliveryDate}
                                readOnly={false}
                                onDriverAssigned={() => {
                                    loadRoutes();
                                    saveCurrentRun(true);
                                    refreshAssignmentData();
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
                            let activeClients = assignmentData?.clients ?? [];
                            const driverList = assignmentData?.drivers ?? [];
                            if (activeClients.length === 0) {
                                alert('No client data loaded. Please wait for the page to load.');
                                return;
                            }
                            // Filter to clients with orders on selected date when Orders View has a date (match Orders View)
                            if (ordersForDate?.client_ids?.length && ordersViewDate) {
                                const clientIdsWithOrders = new Set((ordersForDate.client_ids || []).map((id: string) => String(id)));
                                activeClients = activeClients.filter((c: any) => clientIdsWithOrders.has(String(c.id)));
                                if (activeClients.length === 0) {
                                    alert(`No clients with orders on ${ordersViewDate}. Select a date with orders in Orders View, or clear the date filter to include all assigned clients.`);
                                    return;
                                }
                            }
                            // Build driver map from assignment-data (id -> { color, name, number })
                            const driverMap = new Map<string, { color: string; name: string; number: number }>();
                            driverList.forEach((d: any, i: number) => {
                                const driverId = String(d.id);
                                const driverNum = parseDriverNum(d.name) ?? i;
                                driverMap.set(driverId, {
                                    color: (d.color && d.color !== "#666") ? d.color : palette[i % palette.length],
                                    name: d.name || `Driver ${driverNum}`,
                                    number: driverNum,
                                });
                            });
                            
                            // Build complex index from active clients only
                            const idxs = buildComplexIndex(activeClients);
                            
                            // Group clients by assigned_driver_id (only active clients)
                            const clientsByDriver = new Map<string, any[]>();
                            const clientsWithoutDriver: any[] = [];
                            
                            activeClients.forEach((client: any) => {
                                // API returns assignedDriverId (camelCase) but also check assigned_driver_id (snake_case) for compatibility
                                const assignedDriverId = (client.assignedDriverId || client.assigned_driver_id) ? String(client.assignedDriverId || client.assigned_driver_id) : null;
                                if (assignedDriverId && driverMap.has(assignedDriverId)) {
                                    if (!clientsByDriver.has(assignedDriverId)) {
                                        clientsByDriver.set(assignedDriverId, []);
                                    }
                                    clientsByDriver.get(assignedDriverId)!.push(client);
                                } else {
                                    clientsWithoutDriver.push(client);
                                }
                            });
                            
                            // Convert clients to stop format and mark complex
                            const enrichedSorted: any[] = [];
                            const colorsSorted: string[] = [];
                            
                            // Sort drivers by number
                            const sortedDriverIds = Array.from(clientsByDriver.keys()).sort((a, b) => {
                                const driverA = driverMap.get(a);
                                const driverB = driverMap.get(b);
                                const numA = driverA?.number ?? Number.MAX_SAFE_INTEGER;
                                const numB = driverB?.number ?? Number.MAX_SAFE_INTEGER;
                                return numA - numB;
                            });
                            
                            sortedDriverIds.forEach((driverId) => {
                                const driverInfo = driverMap.get(driverId);
                                const clients = clientsByDriver.get(driverId) || [];
                                
                                // Mark complex and convert to stop format
                                const stops = clients.map((client: any, si: number) => {
                                    const marked = markStopComplex(client, si, idxs);
                                    return {
                                        id: client.id,
                                        userId: client.id,
                                        name: client.name || client.fullName || `${client.first || client.first_name || ''} ${client.last || client.last_name || ''}`.trim() || 'Unnamed',
                                        first: client.first || client.first_name,
                                        last: client.last || client.last_name,
                                        first_name: client.first || client.first_name,
                                        last_name: client.last || client.last_name,
                                        fullName: client.name || client.fullName || client.full_name,
                                        full_name: client.name || client.fullName || client.full_name,
                                        address: client.address || '',
                                        apt: client.apt || '',
                                        city: client.city || '',
                                        state: client.state || '',
                                        zip: client.zip || '',
                                        phone: client.phone || client.phone_number || '',
                                        lat: client.lat,
                                        lng: client.lng,
                                        dislikes: client.dislikes || '',
                                        assigned_driver_id: driverId,
                                        complex: marked.complex ?? false,
                                        __complexSource: marked.__complexSource ?? 'none',
                                        __driverNumber: driverInfo?.number ?? 0,
                                        __driverName: driverInfo?.name || `Driver ${driverInfo?.number ?? 0}`,
                                        __stopIndex: si, // Keep for internal use, but we'll show count instead
                                    };
                                });
                                
                                enrichedSorted.push(stops);
                                colorsSorted.push(driverInfo?.color || palette[0]);
                            });
                            
                            await exportRouteLabelsPDF(enrichedSorted, colorsSorted, tsString);
                        } catch (error) {
                            console.error('[Download Labels] Error:', error);
                            alert('Failed to generate labels: ' + (error instanceof Error ? error.message : String(error)));
                        } finally {
                            setBusy(false);
                        }
                    }}
                    variant="outlined"
                    disabled={busy || !assignmentData || assignmentData.clients.length === 0}
                >
                    Download Labels
                </Button>

                <Button
                    onClick={handleReorganizeRoutes}
                    variant="outlined"
                    disabled={busy || routes.length === 0 || reorganizing}
                    startIcon={reorganizing ? <CircularProgress size={16} color="inherit" /> : null}
                >
                    {reorganizing ? "Reorganizing…" : "Reorganize Routes"}
                </Button>

            </div>
        </div>
    );
}
