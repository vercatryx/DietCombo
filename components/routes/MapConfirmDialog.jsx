// components/MapConfirmDialog.jsx
"use client";

import * as React from "react";
import {
    Dialog, DialogTitle, DialogContent, DialogActions,
    Button, Box, Stack, TextField, List, ListItemButton, ListItemText, Typography
} from "@mui/material";
import dynamic from "next/dynamic";

const MapContainer = dynamic(() => import("react-leaflet").then(m => m.MapContainer), { ssr: false });
const TileLayer   = dynamic(() => import("react-leaflet").then(m => m.TileLayer),   { ssr: false });
const Marker      = dynamic(() => import("react-leaflet").then(m => m.Marker),      { ssr: false });

const DEFAULT_CENTER = [41.1112, -74.0730]; // near Monsey

export default function MapConfirmDialog({
                                             open,
                                             onClose,
                                             initialQuery = "",
                                             initialCenter = DEFAULT_CENTER,
                                             initialLatLng = null,
                                             onConfirm,
                                         }) {
    const [q, setQ] = React.useState(initialQuery);
    const [results, setResults] = React.useState([]);
    const [pos, setPos] = React.useState(
        Array.isArray(initialLatLng) ? initialLatLng : initialCenter
    );

    const mountedRef = React.useRef(false);
    const wasOpenRef = React.useRef(false);

    React.useEffect(() => {
        if (open && !wasOpenRef.current) {
            wasOpenRef.current = true;
            mountedRef.current = true;
            const nextQ = initialQuery || "";
            const nextPos = Array.isArray(initialLatLng) ? initialLatLng : (initialCenter || DEFAULT_CENTER);
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
    }, [open]); // keep deps minimal

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

    function pickCandidate(item) {
        if (!mountedRef.current) return;
        const next = [item.lat, item.lng];
        setPos(prev => (prev?.[0] === next[0] && prev?.[1] === next[1]) ? prev : next);
        setResults([]);
    }

    const mapKey = `${Number(pos?.[0]).toFixed(5)},${Number(pos?.[1]).toFixed(5)}`;

    return (
        <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth PaperProps={{ style: { height: "80vh" } }}>
            <DialogTitle>Find & Confirm Location</DialogTitle>
            <DialogContent dividers>
                <Stack spacing={1} sx={{ mb: 1 }}>
                    <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                        <TextField
                            fullWidth
                            size="small"
                            label="Search address or place"
                            value={q}
                            onChange={(e) => setQ(e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") search(); }}
                        />
                        <Button variant="outlined" onClick={search}>Search</Button>
                    </Stack>
                    {results.length > 0 && (
                        <Box sx={{ border: "1px solid #eee", borderRadius: 1, maxHeight: 200, overflow: "auto" }}>
                            <List dense>
                                {results.map((r, idx) => (
                                    <ListItemButton key={idx} onClick={() => pickCandidate(r)}>
                                        <ListItemText primary={r.label} secondary={`${r.lat.toFixed(5)}, ${r.lng.toFixed(5)}`} />
                                    </ListItemButton>
                                ))}
                            </List>
                        </Box>
                    )}
                    <Typography variant="caption" sx={{ opacity: 0.75 }}>
                        Tip: Drag the marker to fine-tune the position before confirming.
                    </Typography>
                </Stack>

                <Box sx={{ height: "100%", minHeight: 400 }}>
                    <MapContainer
                        key={mapKey}
                        center={pos || DEFAULT_CENTER}
                        zoom={15}
                        style={{ height: "100%", minHeight: 400 }}
                        scrollWheelZoom
                    >
                        <TileLayer
                            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                            attribution='&copy; OSM contributors'
                        />
                        <Marker
                            position={pos || DEFAULT_CENTER}
                            draggable
                            eventHandlers={{
                                dragend: (e) => {
                                    if (!mountedRef.current) return;
                                    try {
                                        const p = e?.target?.getLatLng?.();
                                        if (p && Number.isFinite(p.lat) && Number.isFinite(p.lng)) {
                                            const next = [p.lat, p.lng];
                                            setPos(prev => (prev?.[0] === next[0] && prev?.[1] === next[1]) ? prev : next);
                                        }
                                    } catch (err) {
                                        console.debug("dragend skipped:", err);
                                    }
                                },
                            }}
                        />
                    </MapContainer>
                </Box>
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose}>Cancel</Button>
                <Button onClick={() => onConfirm?.({ lat: Number(pos?.[0]), lng: Number(pos?.[1]) })} variant="contained">
                    Confirm location
                </Button>
            </DialogActions>
        </Dialog>
    );
}