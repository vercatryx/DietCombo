'use client';

import * as React from "react";
import dynamic from "next/dynamic";

// Dynamically import Leaflet components to avoid SSR issues
const MapContainer = dynamic(() => import("react-leaflet").then(m => ({ default: m.MapContainer })), { ssr: false });
const TileLayer = dynamic(() => import("react-leaflet").then(m => ({ default: m.TileLayer })), { ssr: false });
const Marker = dynamic(() => import("react-leaflet").then(m => ({ default: m.Marker })), { ssr: false });

const DEFAULT_CENTER: [number, number] = [41.1112, -74.0730]; // near Monsey

interface MapConfirmDialogProps {
    open: boolean;
    onClose: () => void;
    initialQuery?: string;
    initialCenter?: [number, number];
    initialLatLng?: [number, number] | null;
    onConfirm: (coords: { lat: number; lng: number }) => void;
}

export default function MapConfirmDialog({
    open,
    onClose,
    initialQuery = "",
    initialCenter = DEFAULT_CENTER,
    initialLatLng = null,
    onConfirm,
}: MapConfirmDialogProps) {
    const [q, setQ] = React.useState(initialQuery);
    const [results, setResults] = React.useState<any[]>([]);
    const [pos, setPos] = React.useState<[number, number]>(
        Array.isArray(initialLatLng) ? initialLatLng : initialCenter
    );

    const mountedRef = React.useRef(false);
    const wasOpenRef = React.useRef(false);

    React.useEffect(() => {
        if (open && !wasOpenRef.current) {
            wasOpenRef.current = true;
            mountedRef.current = true;
            const nextQ = initialQuery || "";
            const nextPos: [number, number] = Array.isArray(initialLatLng) ? initialLatLng : (initialCenter || DEFAULT_CENTER);
            setResults([]);
            setQ(prev => (prev === nextQ ? prev : nextQ));
            setPos(prev =>
                prev?.[0] === nextPos?.[0] && prev?.[1] === nextPos?.[1] ? prev : nextPos
            );
        }
        if (!open && wasOpenRef.current) {
            wasOpenRef.current = false;
            mountedRef.current = false;
        }
    }, [open, initialQuery, initialLatLng, initialCenter]);

    React.useEffect(() => () => { mountedRef.current = false; }, []);

    async function search() {
        const term = q.trim();
        if (!term) {
            if (mountedRef.current) setResults([]);
            return;
        }
        const res = await fetch(`/api/geocode/search?q=${encodeURIComponent(term)}&limit=6`, { cache: "no-store" });
        if (!res.ok) {
            console.error("search error:", await res.text());
            if (mountedRef.current) setResults([]);
            return;
        }
        const data = await res.json();
        if (mountedRef.current) setResults(Array.isArray(data.items) ? data.items : []);
    }

    function pickCandidate(item: any) {
        if (!mountedRef.current) return;
        const next: [number, number] = [item.lat, item.lng];
        setPos(prev => (prev?.[0] === next[0] && prev?.[1] === next[1]) ? prev : next);
        setResults([]);
    }

    // Load Leaflet CSS - must be called before any conditional returns
    React.useEffect(() => {
        if (typeof window !== 'undefined') {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
            link.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
            link.crossOrigin = '';
            document.head.appendChild(link);

            return () => {
                document.head.removeChild(link);
            };
        }
    }, []);

    // Early return must come after all hooks
    if (!open) return null;

    const mapKey = `${Number(pos?.[0]).toFixed(5)},${Number(pos?.[1]).toFixed(5)}`;

    return (
        <div
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1000,
            }}
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div
                style={{
                    backgroundColor: 'var(--bg-surface)',
                    borderRadius: 'var(--radius-lg)',
                    width: '90vw',
                    maxWidth: '900px',
                    height: '80vh',
                    display: 'flex',
                    flexDirection: 'column',
                    padding: '1.5rem',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <h2 style={{ marginTop: 0, marginBottom: '1rem', fontSize: '1.25rem', fontWeight: 600 }}>
                    Find & Confirm Location
                </h2>

                <div style={{ marginBottom: '1rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <input
                            type="text"
                            className="input"
                            placeholder="Search address or place"
                            value={q}
                            onChange={(e) => setQ(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") search(); }}
                            style={{ flex: 1 }}
                        />
                        <button className="btn btn-secondary" onClick={search}>
                            Search
                        </button>
                    </div>
                    {results.length > 0 && (
                        <div style={{ border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', maxHeight: '200px', overflow: 'auto' }}>
                            {results.map((r, idx) => (
                                <div
                                    key={idx}
                                    onClick={() => pickCandidate(r)}
                                    style={{
                                        padding: '0.75rem',
                                        cursor: 'pointer',
                                        borderBottom: idx < results.length - 1 ? '1px solid var(--border-color)' : 'none',
                                        backgroundColor: 'transparent',
                                        transition: 'background-color 0.2s',
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.backgroundColor = 'var(--bg-surface-hover)';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.backgroundColor = 'transparent';
                                    }}
                                >
                                    <div style={{ fontWeight: 500 }}>{r.label}</div>
                                    <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                                        {r.lat.toFixed(5)}, {r.lng.toFixed(5)}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                    <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', margin: 0 }}>
                        Tip: Drag the marker to fine-tune the position before confirming.
                    </p>
                </div>

                <div style={{ flex: 1, minHeight: 400, position: 'relative', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                    <MapContainer
                        key={mapKey}
                        center={pos || DEFAULT_CENTER}
                        zoom={15}
                        style={{ height: "100%", width: "100%" }}
                        scrollWheelZoom
                    >
                        <TileLayer
                            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                        />
                        <Marker
                            position={pos || DEFAULT_CENTER}
                            draggable
                            eventHandlers={{
                                dragend: (e: any) => {
                                    if (!mountedRef.current) return;
                                    try {
                                        const p = e?.target?.getLatLng?.();
                                        if (p && Number.isFinite(p.lat) && Number.isFinite(p.lng)) {
                                            const next: [number, number] = [p.lat, p.lng];
                                            setPos(prev => (prev?.[0] === next[0] && prev?.[1] === next[1]) ? prev : next);
                                        }
                                    } catch (err) {
                                        console.debug("dragend skipped:", err);
                                    }
                                },
                            }}
                        />
                    </MapContainer>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1rem' }}>
                    <button className="btn" onClick={onClose}>
                        Cancel
                    </button>
                    <button
                        className="btn btn-primary"
                        onClick={() => onConfirm?.({ lat: Number(pos?.[0]), lng: Number(pos?.[1]) })}
                    >
                        Confirm location
                    </button>
                </div>
            </div>
        </div>
    );
}
