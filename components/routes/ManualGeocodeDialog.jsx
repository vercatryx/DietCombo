// components/ManualGeocodeDialog.jsx
"use client";

import * as React from "react";
import {
    Dialog, DialogTitle, DialogContent, DialogActions,
    Button, Box, Typography, Stack, TextField, LinearProgress, Chip, Collapse,
    IconButton, List, ListItemButton, ListItemText
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import { geocodeOneClient, searchGeocodeCandidates } from "@/utils/geocodeOneClient";
import { buildGeocodeQuery } from "@/utils/addressHelpers";
import MapConfirmDialog from "./MapConfirmDialog";

export default function ManualGeocodeDialog({
                                                open,
                                                onClose,
                                                usersMissing = [],
                                                onGeocoded,
                                            }) {
    const toRow = React.useCallback((u) => ({
        id: u.id,
        name: `${u.first ?? ""} ${u.last ?? ""}`.trim() || "Unnamed",
        address: String(u.address || ""),
        city: u.city || "",
        state: u.state || "",
        zip: u.zip || "",
        status: "pending",
        lat: null,
        lng: null,
        attemptCount: 0,
        lastError: null,
        logs: [],
        showLog: false,
        candidatesOpen: false,
        candidates: [],
    }), []);

    const [rows, setRows] = React.useState(() => usersMissing.map(toRow));
    const [autoDone, setAutoDone] = React.useState(0);
    const [workingAuto, setWorkingAuto] = React.useState(false);

    const [pickerOpen, setPickerOpen] = React.useState(false);
    const [pickerRow, setPickerRow] = React.useState(null);

    const [hintById, setHintById] = React.useState({});

    const rowsRef = React.useRef(rows);
    React.useEffect(() => { rowsRef.current = rows; }, [rows]);

    React.useEffect(() => {
        if (!open) return;
        setRows(usersMissing.map(toRow));
        setAutoDone(0);
    }, [open, usersMissing, toRow]);

    const updateRow = (id, patch) => {
        setRows(prev => prev.map(r => (r.id === id ? { ...r, ...patch } : r)));
    };
    const pushLog = (id, msg) => {
        const ts = new Date().toLocaleTimeString();
        setRows(prev => prev.map(r => (r.id === id ? { ...r, logs: [...r.logs, { ts, msg }] } : r)));
    };

    const persistOK = async (id, lat, lng, label = "Resolved") => {
        pushLog(id, label);
        setAutoDone(d => d + 1);
        try {
            await onGeocoded?.([{ id, lat, lng }]);
        } catch (e) {
            pushLog(id, `DB save failed: ${e?.message || e}`);
            updateRow(id, { status: "error", lastError: "DB save failed" });
            return;
        }
        setRows(prev => prev.filter(r => r.id !== id));
    };

    const markError = (id, errMsg) => {
        const current = rowsRef.current.find(r => r.id === id);
        const attempts = (current?.attemptCount ?? 0) + 1;
        updateRow(id, { status: "error", lastError: errMsg, attemptCount: attempts });
        pushLog(id, `❌ ${errMsg}`);
    };

    async function geocodeRowAuto(row, modeLabel = "Auto") {
        const strictQ = buildGeocodeQuery(row);
        updateRow(row.id, { status: "geocoding" });
        pushLog(row.id, `🔎 ${modeLabel}: "${strictQ}"`);

        try {
            const { lat, lng, provider, formatted } = await geocodeOneClient(strictQ);
            await persistOK(row.id, lat, lng, `✅ ${modeLabel} via ${provider}${formatted ? ` (${formatted})` : ""}`);
            return true;
        } catch (e1) {
            const looseQ = [row.address, row.city, row.state].filter(Boolean).join(", ");
            pushLog(row.id, `↪ fallback: "${looseQ}"`);
            try {
                const { lat, lng, provider, formatted } = await geocodeOneClient(looseQ);
                await persistOK(row.id, lat, lng, `✅ fallback via ${provider}${formatted ? ` (${formatted})` : ""}`);
                return true;
            } catch (e2) {
                const msg = e2?.message || e1?.message || "No match";
                markError(row.id, msg);
                // fetchCandidates(row); // auto-open suggestions on failure
                return false;
            }
        }
    }

    const runAutoGeocoding = React.useCallback(async () => {
        if (!open) return;
        const snapshot = rowsRef.current;
        if (!snapshot.length) return;
        setWorkingAuto(true);
        for (const row of snapshot) {
            // eslint-disable-next-line no-await-in-loop
            await geocodeRowAuto(row, "Auto");
        }
        setWorkingAuto(false);
    }, [open]);

    const unresolved = rows.length;

    const openPickerFor = (row) => { setPickerRow(row); setPickerOpen(true); };
    const onPickerConfirm = async ({ lat, lng }) => {
        if (pickerRow) await persistOK(pickerRow.id, lat, lng, "✅ manual map pick");
        setPickerOpen(false);
        setPickerRow(null);
    };

    async function fetchCandidates(row) {
        const q = buildGeocodeQuery(row);
        updateRow(row.id, { candidatesOpen: true, candidates: [] });
        pushLog(row.id, `🧭 suggestions for "${q}"`);
        try {
            const res = await fetch(`/api/geocode/search?q=${encodeURIComponent(q)}&limit=8`, { cache: "no-store" });
            const data = await res.json();
            const items = Array.isArray(data?.items) ? data.items : [];
            updateRow(row.id, { candidates: items });
            setHintById(prev => ({ ...prev, [row.id]: { shownFor: q, queryUsed: data?.queryUsed || q } }));
            if (!items.length) pushLog(row.id, "No suggestions.");
        } catch (e) {
            pushLog(row.id, `Suggestion lookup failed: ${e?.message || e}`);
        }
    }

    async function pickCandidate(row, item) {
        await persistOK(row.id, Number(item.lat), Number(item.lng), `✅ picked: ${item.label}`);
    }

    const geocodeOneNow = async (row) => { await geocodeRowAuto(row, "Manual auto-try"); };

    return (
        <>
            <MapConfirmDialog
                open={pickerOpen}
                onClose={() => { setPickerOpen(false); setPickerRow(null); }}
                initialQuery={pickerRow ? buildGeocodeQuery(pickerRow) : ""}
                onConfirm={onPickerConfirm}
            />

            <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
                <DialogTitle>Manual Geocoding</DialogTitle>
                <DialogContent dividers>
                    {workingAuto && (
                        <Box sx={{ mb: 2 }}>
                            <LinearProgress />
                            <Typography variant="caption">Trying auto geocoding…</Typography>
                        </Box>
                    )}

                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }} flexWrap="wrap">
                        <Chip label={`Resolved: ${autoDone}`} color={autoDone ? "success" : "default"} size="small" />
                        <Chip label={`Need manual: ${unresolved}`} color={unresolved ? "warning" : "default"} size="small" />
                        <Box sx={{ flex: 1 }} />
                        <Button size="small" variant="outlined" onClick={runAutoGeocoding} disabled={workingAuto || unresolved===0}>
                            Auto-try all
                        </Button>
                    </Stack>

                    {unresolved === 0 ? (
                        <Typography variant="body2" sx={{ opacity: 0.8 }}>
                            🎉 All users resolved.
                        </Typography>
                    ) : (
                        <Stack spacing={2}>
                            {rows.map((r) => {
                                const hint = hintById[r.id];
                                return (
                                    <Box key={r.id} sx={{ p: 1, border: "1px solid #eee", borderRadius: 1 }}>
                                        <Typography variant="subtitle2" sx={{ mb: 1 }}>
                                            {r.name} — ID #{r.id}
                                        </Typography>

                                        <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
                                            <TextField size="small" label="Street (no unit)" value={r.address}
                                                       onChange={(e) => updateRow(r.id, { address: e.target.value, status: "pending" })} fullWidth />
                                            <TextField size="small" label="City" value={r.city}
                                                       onChange={(e) => updateRow(r.id, { city: e.target.value, status: "pending" })} />
                                            <TextField size="small" label="State" value={r.state}
                                                       onChange={(e) => updateRow(r.id, { state: e.target.value, status: "pending" })} sx={{ width: 90 }} />
                                            <TextField size="small" label="ZIP" value={r.zip}
                                                       onChange={(e) => updateRow(r.id, { zip: e.target.value, status: "pending" })} sx={{ width: 120 }} />
                                        </Stack>

                                        <Stack direction="row" spacing={1} sx={{ mt: 1 }} alignItems="center" flexWrap="wrap">
                                            <Button size="small" variant="outlined" onClick={() => geocodeOneNow(r)}>
                                                Auto-try again
                                            </Button>
                                            <Button size="small" variant="outlined" onClick={() => openPickerFor(r)}>
                                                Select on map
                                            </Button>
                                            <Button size="small" onClick={() => fetchCandidates(r)}>
                                                See suggestions
                                            </Button>

                                            <IconButton size="small" onClick={() => updateRow(r.id, { showLog: !r.showLog })} title="Show log" sx={{ ml: "auto" }}>
                                                {r.showLog ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                                            </IconButton>
                                            <Typography variant="caption" sx={{ ml: 0.5, opacity: 0.7 }}>
                                                {r.status === "pending" && "Needs geocode"}
                                                {r.status === "geocoding" && "Looking up…"}
                                                {r.status === "error" && (r.lastError ? `Error: ${r.lastError}` : "No match")}
                                            </Typography>
                                        </Stack>

                                        {hint && hint.queryUsed && hint.shownFor && hint.queryUsed !== hint.shownFor && (
                                            <Typography variant="caption" sx={{ display: "block", mt: 0.5, opacity: 0.8 }}>
                                                Showing results for <b>{hint.queryUsed}</b>. Search instead for <b>{hint.shownFor}</b>.
                                            </Typography>
                                        )}

                                        <Collapse in={r.candidatesOpen} unmountOnExit>
                                            <Box sx={{ mt: 1, border: "1px dashed #ccc", borderRadius: 1, maxHeight: 200, overflow: "auto" }}>
                                                {r.candidates?.length ? (
                                                    <List dense>
                                                        {r.candidates.map((c, idx) => (
                                                            <ListItemButton key={idx} onClick={() => pickCandidate(r, c)}>
                                                                <ListItemText primary={c.label}
                                                                              secondary={`${Number(c.lat).toFixed(5)}, ${Number(c.lng).toFixed(5)}`} />
                                                            </ListItemButton>
                                                        ))}
                                                    </List>
                                                ) : (
                                                    <Typography variant="caption" sx={{ p: 1, display: "block", opacity: 0.75 }}>
                                                        No suggestions yet.
                                                    </Typography>
                                                )}
                                            </Box>
                                        </Collapse>

                                        <Collapse in={r.showLog} unmountOnExit>
                                            <Box sx={{ mt: 1, p: 1, borderRadius: 1, background: "#fafafa", border: "1px solid #eee" }}>
                                                {r.logs.length ? r.logs.map((L, i) => (
                                                    <Typography key={i} variant="caption" sx={{ display: "block" }}>
                                                        [{L.ts}] {L.msg}
                                                    </Typography>
                                                )) : (
                                                    <Typography variant="caption" sx={{ opacity: 0.7 }}>
                                                        No log entries yet.
                                                    </Typography>
                                                )}
                                            </Box>
                                        </Collapse>
                                    </Box>
                                );
                            })}
                        </Stack>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={onClose}>Done</Button>
                    <Button onClick={runAutoGeocoding} variant="contained" disabled={workingAuto || unresolved===0}>
                        Auto-try all unresolved
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
}