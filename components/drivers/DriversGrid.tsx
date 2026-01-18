"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { MapPin, ChevronRight, Hash, User, PenLine } from "lucide-react";

/* ---------------- signatures: always fetch fresh ---------------- */
async function fetchSignStatusClient() {
    const res = await fetch("/api/signatures/status", {
        cache: "no-store",
        headers: { "cache-control": "no-store" },
    });
    if (!res.ok) return [];
    return res.json();
}

/** Build a normalized address key that ignores apt/unit and collapses spacing/case. */
function makeAddressKey(stop) {
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

export default function DriversGrid({ drivers = [], allStops = [], selectedDate = '' }) {
    const [sigRows, setSigRows] = useState([]);

    useEffect(() => {
        let active = true;
        (async () => {
            try {
                const rows = await fetchSignStatusClient();
                if (active) setSigRows(rows);
            } catch {
                if (active) setSigRows([]);
            }
        })();
        return () => { active = false; };
    }, []);

    // Filter stops by selected date if a date is provided
    const filteredStops = useMemo(() => {
        if (!selectedDate) return allStops;
        
        // Normalize date string to YYYY-MM-DD format
        const normalizeDate = (dateStr: string | null | undefined): string | null => {
            if (!dateStr) return null;
            return dateStr.split('T')[0].split(' ')[0];
        };
        
        return allStops.filter((stop: any) => {
            const stopDate = stop.delivery_date || stop.deliveryDate;
            if (!stopDate) return false;
            const stopDateStr = normalizeDate(stopDate);
            return stopDateStr === selectedDate;
        });
    }, [allStops, selectedDate]);

    const stopsById = useMemo(() => new Map(filteredStops.map((s) => [String(s.id), s])), [filteredStops]);
    const sigMap = useMemo(
        () => new Map(sigRows.map((r) => [String(r.userId), Number(r.collected || 0)])),
        [sigRows]
    );

    const getStopsForDriver = useMemo(() => {
        return (d) => {
            if (Array.isArray(d?.stopIds) && d.stopIds.length)
                return d.stopIds.map((sid) => stopsById.get(String(sid))).filter(Boolean);
            return filteredStops.filter((s) => Number(s.driverId) === Number(d.id));
        };
    }, [stopsById, filteredStops]);

    // Filter drivers to only show those with stops for the selected date (if date is selected)
    const filteredDrivers = useMemo(() => {
        if (!selectedDate) return drivers;
        
        return drivers.filter((d) => {
            const driverStops = getStopsForDriver(d);
            return driverStops.length > 0;
        });
    }, [drivers, selectedDate, getStopsForDriver]);

    // Show empty state if no drivers
    if (filteredDrivers.length === 0) {
        return (
            <div style={{
                textAlign: "center",
                padding: "48px 24px",
                color: "var(--muted, #6b7280)"
            }}>
                <p style={{ fontSize: "16px", fontWeight: 500, marginBottom: "8px" }}>
                    {selectedDate ? "No routes for selected date" : "No routes available"}
                </p>
                <p style={{ fontSize: "14px" }}>
                    {selectedDate 
                        ? `There are no delivery routes with stops for ${new Date(selectedDate).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}.`
                        : "There are currently no delivery routes to display."}
                </p>
            </div>
        );
    }

    return (
        <div className="grid">
            {filteredDrivers.map((d) => {
                const cardStops = getStopsForDriver(d);

                // Use actual loaded stops count instead of API count to ensure consistency
                // Only fall back to API count if we have no loaded stops data
                const actualTotal = cardStops.length;
                const apiTotal = d.totalStops ?? (d.stopIds?.length ?? 0);
                const total = actualTotal > 0 ? actualTotal : apiTotal;
                const done = cardStops.length > 0 
                    ? cardStops.filter((s) => !!s?.completed).length 
                    : (d.completedStops ?? 0);
                const pct = total > 0 ? (done / total) * 100 : 0;

                const sigUsersDone = cardStops.length > 0
                    ? cardStops.filter((s) => (sigMap.get(String(s?.userId)) ?? 0) >= 5).length
                    : 0;
                const pctSigs = total > 0 ? (sigUsersDone / total) * 100 : 0;

                // Unique addresses for this driver (ignoring apt#)
                const uniqueAddrCount = (() => {
                    const set = new Set();
                    for (const s of cardStops) {
                        const key = makeAddressKey(s);
                        if (key) set.add(key);
                    }
                    return set.size;
                })();

                const color = d.color?.trim() || "#3665F3";

                return (
                    <Link
                        key={d.id}
                        href={`/drivers/${d.id}`}
                        className="card driver-card"
                        style={{ textDecoration: "none", color: "inherit" }}
                    >
                        <div className="color-rail" style={{ background: color }} />
                        <div className="card-content">
                            <div className="row">
                                <div className="flex">
                                    <div className="hdr-badge" style={{ background: "#fff", color }}>
                                        <User />
                                    </div>
                                    <div>
                                        <div className="flex" style={{ gap: 6 }}>
                                            <h2 className="bold" style={{ fontSize: 18 }}>{d.name}</h2>
                                            <ChevronRight className="muted" />
                                        </div>

                                        <div className="flex muted" style={{ marginTop: 2 }}>
                                            <Hash style={{ width: 16, height: 16 }} />
                                            <span>
                                                {uniqueAddrCount} {uniqueAddrCount === 1 ? "address" : "addresses"}
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Stops completed */}
                            <div className="flex muted" style={{ marginTop: 12 }}>
                                <MapPin style={{ width: 16, height: 16 }} />
                                <span>{done} / {total} bags</span>
                            </div>
                            <div className="progress" style={{ marginTop: 8 }}>
                                <span style={{ width: `${pct}%`, background: color }} />
                            </div>

                            {/* Signatures complete */}
                            <div className="flex muted" style={{ marginTop: 10 }}>
                                <PenLine style={{ width: 16, height: 16 }} />
                                <span>{sigUsersDone} / {total} signatures</span>
                            </div>
                            <div className="progress sig" style={{ marginTop: 8 }}>
                                <span style={{ width: `${pctSigs}%`, background: color }} />
                            </div>
                        </div>
                    </Link>
                );
            })}
        </div>
    );
}

