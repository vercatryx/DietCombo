"use client";

import { useMemo } from "react";
import Link from "next/link";
import { MapPin, ChevronRight, Hash, User, ImageIcon } from "lucide-react";

/** Build a normalized address key that ignores apt/unit and collapses spacing/case. */
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

/**
 * Same geocoding check as DriversMapLeaflet's hasLL / getLL — keeps counts in sync.
 * Rejects null, NaN, and (0,0) junk coordinates.
 */
function hasValidCoords(s: any): boolean {
    if (!s) return false;
    const toNum = (v: any): number | null => {
        if (v == null) return null;
        if (typeof v === "number") return Number.isFinite(v) ? v : null;
        if (typeof v === "string") { const n = parseFloat(v); return Number.isFinite(n) ? n : null; }
        return null;
    };
    const lat = toNum(s.lat ?? s.latitude);
    const lng = toNum(s.lng ?? s.longitude);
    if (lat == null || lng == null) return false;
    if (Math.abs(lat) < 0.00001 && Math.abs(lng) < 0.00001) return false;
    return true;
}

export default function DriversGrid({ drivers = [], allStops = [], selectedDate = '' }: { drivers?: any[]; allStops?: any[]; selectedDate?: string }) {
    // Use d.stops directly from the API response (same data the routes page uses).
    // No re-filtering by date — the API already returns only stops for the requested date.
    const filteredDrivers = useMemo(() => {
        if (!selectedDate) return drivers;
        return drivers.filter((d) => {
            const stops: any[] = d.stops || [];
            return stops.filter(hasValidCoords).length > 0;
        });
    }, [drivers, selectedDate]);

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
                const rawStops: any[] = d.stops || [];
                const cardStops = rawStops.filter(hasValidCoords);

                const total = cardStops.length;
                const done = cardStops.filter((s: any) => !!s?.completed).length;
                const pct = total > 0 ? (done / total) * 100 : 0;

                const proofCount = cardStops.filter((s: any) => !!((s?.proofUrl ?? s?.proof_url) || "").trim()).length;
                const pctProof = total > 0 ? (proofCount / total) * 100 : 0;

                const uniqueAddrCount = (() => {
                    if (cardStops.length === 0) return 0;
                    const set = new Set();
                    for (const s of cardStops) {
                        const key = makeAddressKey(s);
                        if (key) set.add(key);
                    }
                    return set.size;
                })();

                const color = d.color?.trim() || "#3665F3";

                // Build URL with delivery_date if selectedDate is set
                const driverUrl = selectedDate 
                    ? `/drivers/${d.id}?delivery_date=${encodeURIComponent(selectedDate)}`
                    : `/drivers/${d.id}`;
                
                return (
                    <Link
                        key={d.id}
                        href={driverUrl}
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

                            {/* Proof images */}
                            <div className="flex muted" style={{ marginTop: 10 }}>
                                <ImageIcon style={{ width: 16, height: 16 }} />
                                <span>{proofCount} / {total} proof</span>
                            </div>
                            <div className="progress proof" style={{ marginTop: 8 }}>
                                <span style={{ width: `${pctProof}%`, background: color }} />
                            </div>
                        </div>
                    </Link>
                );
            })}
        </div>
    );
}

