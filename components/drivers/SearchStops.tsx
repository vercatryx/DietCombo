// components/drivers/SearchStops.tsx
"use client";

import React, { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Link as LinkIcon, Search } from "lucide-react";
import { mapsUrlFromAddress } from "@/lib/maps";

/**
 * Props:
 *  - allStops: array of stop objects returned by /api/mobile/stops
 *      Must include: id, name, address, city, state, zip, signToken, sigCollected, completed, userId, (optional: phone, dislikes)
 *  - drivers: array of route objects, each with { id, name, color, stopIds, routeNumber }
 *  - themeColor: optional string to tint accents
 */
export default function SearchStops({ allStops = [], drivers = [], themeColor = "#3665F3" }) {
    const router = useRouter();
    const [q, setQ] = useState("");

    const results = useMemo(() => {
        const term = q.trim().toLowerCase();
        if (!term) return [];
        return allStops
            .filter((s) => {
                const hay = [
                    s.name,
                    s.address, s.apt,
                    s.city, s.state, s.zip,
                    s.phone,
                ]
                    .filter(Boolean)
                    .join(" ")
                    .toLowerCase();
                return hay.includes(term);
            })
            .slice(0, 30);
    }, [q, allStops]);

    const routeByStopId = useMemo(() => {
        const map = new Map();
        for (const r of drivers || []) {
            for (const sid of r?.stopIds ?? []) {
                map.set(String(sid), r);
            }
        }
        return map;
    }, [drivers]);

    return (
        <div className="search-card">
            <div className="search-row">
                <Search style={{ width: 18, height: 18, color: "#6b7280" }} />
                <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search address, name, city…"
                    className="search-input"
                    aria-label="Search stops"
                />
            </div>

            {!!q && (
                <div className="results">
                    {results.length === 0 && (
                        <div className="empty">No matches</div>
                    )}

                    {results.map((s) => {
                        const r = routeByStopId.get(String(s.id));
                        const mapsUrl = mapsUrlFromAddress({
                            address: s.address,
                            city: s.city,
                            state: s.state,
                            zip: s.zip,
                        });

                        return (
                            <div key={s.id} className="result">
                                <div className="info">
                                    <div className="title-row">
                                        <div className="name">{s.name}</div>
                                        {r && (
                                            <button
                                                className="route-pill"
                                                onClick={() => router.push(`/drivers/${r.id}#stop-${s.id}`)}
                                                title={`Go to ${r.name}`}
                                                style={{ borderColor: r.color, color: r.color }}
                                            >
                                                {r.name ?? `Route ${r.id}`}
                                            </button>
                                        )}
                                    </div>

                                    <div className="sub">
                                        <MapPin style={{ width: 14, height: 14 }} />
                                        <span>
                      {s.address}{s.apt ? `, ${s.apt}` : ""}, {s.city}, {s.state} {s.zip}
                    </span>
                                    </div>

                                    <div className="meta">
                    <span className="chip" title="Collected signatures">
                      {(s.sigCollected ?? 0)}/5 sigs
                    </span>
                                        {s.completed ? <span className="done">Completed</span> : null}
                                    </div>
                                </div>

                                <div className="actions">
                                    <a className="btn small" href={mapsUrl} target="_blank" rel="noreferrer">
                                        Open in Maps
                                    </a>
                                    <button
                                        className="btn outline small"
                                        onClick={() => {
                                            if (!s.signToken) {
                                                alert("No signature link for this customer.");
                                                return;
                                            }
                                            window.open(`/sign/${s.signToken}`, "_blank", "noopener,noreferrer");
                                        }}
                                        title="Open the public signature page"
                                        style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                                    >
                                        <LinkIcon style={{ width: 16, height: 16 }} />
                                        Collect
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            <style
                dangerouslySetInnerHTML={{
                    __html: `
          .search-card{border:1px solid #e5e7eb;background:#fff;border-radius:12px;padding:12px}
          .search-row{display:flex;align-items:center;gap:8px;border:1px solid #e5e7eb;border-radius:10px;padding:8px 10px}
          .search-input{flex:1;border:0;outline:none;font-size:14px;background:transparent}
          .results{margin-top:12px;display:grid;gap:10px;max-height:340px;overflow:auto}
          .empty{color:#6b7280;font-size:13px;padding:8px 4px}
          .result{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;border:1px solid #f1f5f9;border-radius:10px;padding:10px}
          .info{min-width:0}
          .title-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
          .name{font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:48ch}
          .route-pill{background:#fff;border:1px solid ${themeColor};color:${themeColor};border-radius:999px;font-size:12px;padding:2px 8px;cursor:pointer}
          .sub{display:flex;align-items:center;gap:6px;color:#6b7280;font-size:13px;margin-top:4px}
          .meta{display:flex;align-items:center;gap:8px;margin-top:6px}
          .chip{border:1px solid #e5e7eb;border-radius:999px;font-size:12px;padding:2px 8px;background:#f8fafc}
          .done{color:#16a34a;font-weight:600}
          .actions{display:flex;align-items:center;gap:8px;flex-shrink:0}
          .btn{border:1px solid #111;background:#111;color:#fff;border-radius:10px;padding:8px 10px;cursor:pointer}
          .btn.small{padding:6px 10px;font-size:13px}
          .btn.outline{background:#fff;color:#111;border-color:#e5e7eb}
        `,
                }}
            />
        </div>
    );
}

