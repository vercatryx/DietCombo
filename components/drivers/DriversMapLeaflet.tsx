// components/drivers/DriversMapLeaflet.tsx
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
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// Fix for default marker icons in Next.js
if (typeof window !== "undefined") {
    delete (L.Icon.Default.prototype as any)._getIconUrl;
    L.Icon.Default.mergeOptions({
        iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
        iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
        shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
    });
}

const FALLBACK_COLORS = [
    "#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd",
    "#8c564b", "#e377c2", "#17becf", "#bcbd22", "#393b79",
];

function getLL(s) {
    if (!s) return null;
    const lat = Number(s.lat ?? s.latitude);
    const lng = Number(s.lng ?? s.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return [lat, lng];
}

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

export default function DriversMapLeaflet({
    drivers = [],
    unrouted = [],
    onReassign,
    onExpose,
    initialCenter = [40.7128, -74.006],
    initialZoom = 10,
    showRouteLinesDefault = false,
    busy = false,
}) {
    const mapRef = useRef(null);
    const [mapReady, setMapReady] = useState(false);
    const [showRouteLines, setShowRouteLines] = useState(!!showRouteLinesDefault);

    const handleMapReady = useCallback(
        (m) => {
            mapRef.current = m;
            setMapReady(true);
        },
        []
    );

    useEffect(() => {
        if (!mapReady || !mapRef.current) return;
        const allPoints: [number, number][] = [];
        for (const d of drivers) {
            for (const s of d.stops || []) {
                const ll = getLL(s);
                if (ll) allPoints.push(ll as [number, number]);
            }
        }
        for (const s of unrouted || []) {
            const ll = getLL(s);
            if (ll) allPoints.push(ll as [number, number]);
        }
        if (allPoints.length > 0) {
            try {
                const bounds = L.latLngBounds(allPoints);
                mapRef.current.fitBounds(bounds, { padding: [50, 50] });
            } catch {}
        }
    }, [mapReady, drivers, unrouted]);

    useEffect(() => {
        if (!onExpose) return;
        const api = {
            getMap: () => mapRef.current,
            flyTo: (lat, lng, zoom = 15) =>
                mapRef.current?.flyTo([lat, lng], zoom, { animate: true }),
        };
        onExpose(api);
    }, [onExpose]);

    return (
        <div style={{ height: "100%", width: "100%", position: "relative" }}>
            <MapContainer
                center={initialCenter}
                zoom={initialZoom}
                style={{ height: "100%", width: "100%" }}
                scrollWheelZoom
                zoomControl={false}
            >
                <MapBridge onReady={handleMapReady} />
                <TileLayer
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    attribution="&copy; OpenStreetMap contributors"
                />
                <ZoomControl position="bottomleft" />

                {/* Route lines */}
                {showRouteLines &&
                    drivers.map((d) => {
                        const pts = (d.stops || [])
                            .map(getLL)
                            .filter(Boolean) as [number, number][];
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

                {/* Unrouted markers */}
                {unrouted.map((s) => {
                    const ll = getLL(s);
                    if (!ll) return null;
                    return (
                        <Marker
                            key={`u-${s.id}`}
                            position={ll as [number, number]}
                            icon={L.icon({
                                iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
                                iconSize: [25, 41],
                                iconAnchor: [12, 41],
                            })}
                        />
                    );
                })}

                {/* Driver markers */}
                {drivers.map((d, di) =>
                    (d.stops || []).map((s) => {
                        const ll = getLL(s);
                        if (!ll) return null;
                        const color = d.color || FALLBACK_COLORS[di % FALLBACK_COLORS.length];
                        return (
                            <CircleMarker
                                key={`d-${String(d.driverId)}-s-${s.id}`}
                                center={ll as [number, number]}
                                radius={8}
                                pathOptions={{
                                    color: color,
                                    fillColor: color,
                                    fillOpacity: 0.8,
                                    weight: 2,
                                }}
                            />
                        );
                    })
                )}
            </MapContainer>
        </div>
    );
}

export const runtime = "nodejs";

