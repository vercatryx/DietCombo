// utils/pdfRouteLabels.js
// Route-ordered Avery 5163 labels (4" × 2", 2×5 per page).
// - Each driver’s non-complex stops print in route order, then page break.
// - Complex stops print afterward, keeping their driver’s color.
// - Each label shows a small “driver.stop” marker above the name (left-aligned).

import jsPDF from "jspdf";

/* ---------- Name + complex helpers ---------- */
function displayName(u = {}) {
    const cands = [
        u.name,
        u.fullName,
        u.full_name,
        `${u.first ?? ""} ${u.last ?? ""}`.trim(),
        `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim(),
        `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim(),
        u?.user?.name,
        u?.user?.full_name,
        `${u?.user?.first ?? ""} ${u?.user?.last ?? ""}`.trim(),
        `${u?.user?.first_name ?? ""} ${u?.user?.last_name ?? ""}`.trim(),
    ]
        .map((s) => (typeof s === "string" ? s.trim() : ""))
        .filter(Boolean);
    return cands[0] || "Unnamed";
}

/** Client name for the first line of the label. Use the stop's name field first (from API/stops record), then other name fields. Never use address as name. */
function clientName(u = {}) {
    const addressLine = `${u.address ?? ""}${u.apt ? " " + u.apt : ""}`.trim();
    const cands = [
        u.name, // stop's name field from API (client name from stops record)
        u.fullName,
        u.full_name,
        `${u.first ?? ""} ${u.last ?? ""}`.trim(),
        `${u.first_name ?? ""} ${u.last_name ?? ""}`.trim(),
        `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim(),
        u?.user?.name,
        u?.user?.full_name,
        `${u?.user?.first ?? ""} ${u?.user?.last ?? ""}`.trim(),
        `${u?.user?.first_name ?? ""} ${u?.user?.last_name ?? ""}`.trim(),
    ]
        .map((s) => (typeof s === "string" ? s.trim() : ""))
        .filter(Boolean);
    const name = cands.find((s) => s && s !== addressLine);
    return name || "Unnamed";
}

const toBool = (v) => {
    if (typeof v === "boolean") return v;
    if (typeof v === "number") return v !== 0;
    if (typeof v === "string") {
        const s = v.trim().toLowerCase();
        return s === "true" || s === "1" || s === "yes" || s === "y";
    }
    return false;
};

const isComplexFallback = (u = {}) =>
    toBool(u?.complex) ||
    toBool(u?.isComplex) ||
    toBool(u?.flags?.complex) ||
    toBool(u?.user?.complex) ||
    toBool(u?.User?.complex) ||
    toBool(u?.client?.complex);

/* ---------- Notes (from dislikes/notes fields; label shows "Notes:") ---------- */
function getNotes(u = {}) {
    const v =
        u.dislikes ??
        u?.user?.dislikes ??
        u?.User?.dislikes ??
        u?.client?.dislikes ??
        u?.flags?.dislikes ??
        u.notes ??
        u?.user?.notes ??
        u?.client?.notes ??
        "";

    const s = (v == null ? "" : String(v)).trim();
    if (/^(none|no|n\/a|na|nil|-|—|not applicable)$/i.test(s)) return "";
    return s.replace(/^(?:dislikes|notes)\s*:\s*/i, "").trim();
}

/* ---------- Driver/stop numbering helpers (zero-based safe) ---------- */
function parseDriverNumFromName(name) {
    const m = /driver\s+(\d+)/i.exec(String(name || ""));
    return m ? parseInt(m[1], 10) : null;
}

function getDriverIdx0(u, routeIdx0) {
    if (Number.isFinite(u?.__driverNumber)) return u.__driverNumber;
    const parsed = parseDriverNumFromName(u?.__driverName);
    if (Number.isFinite(parsed)) return parsed;
    return routeIdx0;
}

function getStopNum1(u, localIdx0) {
    if (Number.isFinite(u?.__stopIndex)) return u.__stopIndex + 1;
    return localIdx0 + 1;
}

/* ---------- Layout constants ---------- */
const LABEL_W = 4.0;
const LABEL_H = 2.0;
const MARGIN_L = 0.25;
const MARGIN_T = 0.5;
const PAD_L = 0.2,
    PAD_R = 0.2,
    PAD_T = 0.35,
    PAD_B = 0.2;

const MAX_FONT = 11;
const MIN_FONT = 6;
const lineHeightFromFont = (pt) => Math.max(0.18, pt * 0.025);

/* ---------- Drawing helpers ---------- */
function drawBadgeAbove(doc, x, y, text, colorRGB) {
    const prevSize = doc.getFontSize();
    const prevColor = doc.getTextColor();
    try {
        doc.setFontSize(9);
        doc.setTextColor(...colorRGB);
        const xx = x + PAD_L;
        const yy = y + PAD_T - 0.08;
        doc.text(String(text || ""), xx, yy, { baseline: "top", align: "left" });
    } finally {
        doc.setFontSize(prevSize);
        if (Array.isArray(prevColor)) doc.setTextColor(...prevColor);
        else doc.setTextColor(0, 0, 0);
    }
}

function measureWrapped(doc, lines, font, maxWidth, lineH) {
    const prev = doc.getFontSize();
    doc.setFontSize(font);
    let y = 0;
    for (const ln of lines) {
        const text = ln || "";
        if (!text) {
            y += lineH;
            continue;
        }
        const words = text.split(/(\s+)/);
        let line = "";
        for (const w of words) {
            const test = line + w;
            const tw = doc.getTextWidth(test);
            if (tw > maxWidth && line) {
                y += lineH;
                line = w;
            } else line = test;
        }
        y += lineH;
    }
    doc.setFontSize(prev);
    return y;
}

function drawLines(doc, x, y, colorRGB, lines) {
    const maxW = Math.max(0, LABEL_W - PAD_L - PAD_R);
    const maxH = Math.max(0, LABEL_H - PAD_T - PAD_B);
    let font = MAX_FONT;
    let lh = lineHeightFromFont(font);
    let h = measureWrapped(doc, lines, font, maxW, lh);
    while (h > maxH && font > MIN_FONT) {
        font -= 1;
        lh = lineHeightFromFont(font);
        h = measureWrapped(doc, lines, font, maxW, lh);
    }
    doc.setFontSize(font);
    doc.setTextColor(...colorRGB);
    let yy = y + PAD_T;
    const xx = x + PAD_L;
    for (const ln of lines) {
        const text = ln || "";
        if (!text) {
            yy += lh;
            continue;
        }
        const words = text.split(/(\s+)/);
        let line = "";
        for (const w of words) {
            const test = line + w;
            const tw = doc.getTextWidth(test);
            if (tw > maxW && line) {
                doc.text(line, xx, yy, { baseline: "top" });
                yy += lh;
                line = w;
            } else line = test;
        }
        if (line) {
            doc.text(line, xx, yy, { baseline: "top" });
            yy += lh;
        }
    }
}

function advance(state, doc) {
    state.col++;
    if (state.col === 2) {
        state.col = 0;
        state.row++;
        state.x = MARGIN_L;
        state.y += LABEL_H;
    } else state.x += LABEL_W;
    if (state.row === 5) {
        doc.addPage();
        state.x = MARGIN_L;
        state.y = MARGIN_T;
        state.col = 0;
        state.row = 0;
    }
}

function resetPage(state, doc) {
    doc.addPage();
    state.x = MARGIN_L;
    state.y = MARGIN_T;
    state.col = 0;
    state.row = 0;
}

function atFreshTop(state) {
    return state.col === 0 && state.row === 0 && state.x === MARGIN_L && state.y === MARGIN_T;
}

/* ---------- Complex detection helper (comprehensive) ---------- */
function isComplexStop(u = {}) {
    // Primary check: direct complex flag (most common case from routes page)
    if (toBool(u?.complex)) return true;
    
    // Fallback checks for nested complex flags
    if (isComplexFallback(u)) return true;
    
    // Additional check: __complexSource indicates it was marked as complex
    if (u?.__complexSource && u.__complexSource !== "none") return true;
    
    return false;
}

/* ---------- Main export ---------- */
export async function exportRouteLabelsPDF(routes, driverColors, tsString) {
    const doc = new jsPDF({ unit: "in", format: "letter" });

    const DEFAULT_COLORS = [
        "#1677FF", "#52C41A", "#FA8C16", "#EB2F96",
        "#13C2C2", "#F5222D", "#722ED1", "#A0D911",
        "#2F54EB", "#FAAD14", "#73D13D", "#36CFC9",
    ];
    const palette = Array.isArray(driverColors) && driverColors.length ? driverColors : DEFAULT_COLORS;
    const hexToRgb = (hex) => {
        const h = (hex || "#000000").replace("#", "");
        const r = parseInt(h.slice(0, 2), 16) || 0;
        const g = parseInt(h.slice(2, 4), 16) || 0;
        const b = parseInt(h.slice(4, 6), 16) || 0;
        return [r, g, b];
    };

    const state = { x: MARGIN_L, y: MARGIN_T, col: 0, row: 0 };
    const complexAll = [];

    // First pass: Separate complex stops from non-complex stops
    routes.forEach((stops, di) => {
        const colorRGB = hexToRgb(palette[di % palette.length]);
        let printed = false;

        (stops || []).forEach((u, si) => {
            // Comprehensive complex detection
            const isCx = isComplexStop(u);
            
            if (isCx) {
                // Collect complex stops for later segregation
                complexAll.push({ u, driverIdx: di, stopIdx: si });
                console.log(`[Route Labels PDF] Marked stop as complex:`, {
                    id: u?.id,
                    name: displayName(u),
                    driverIdx: di,
                    stopIdx: si,
                    complex: u?.complex,
                    __complexSource: u?.__complexSource
                });
                return; // Skip printing in main section
            }

            // Print non-complex stops in route order (first line = client name only, never address)
            const notesText = getNotes(u);
            const cityStateZip = [u.city, u.state, u.zip].filter(Boolean).join(", ");
            const lines = [
                clientName(u),
                `${u.address ?? ""}${u.apt ? " " + u.apt : ""}`.trim(),
                cityStateZip,
                (u.phone ? `Phone: ${u.phone}` : "").trim(),
                notesText ? `Notes: ${notesText}` : "",
            ].filter(Boolean);

            // --- driver badge: driver.stop (e.g. 1.1, 1.2) ---
            const driverIdx0 = getDriverIdx0(u, di);
            const stopNum1 = getStopNum1(u, si);
            drawBadgeAbove(doc, state.x, state.y, `${driverIdx0}.${stopNum1}`, colorRGB);

            drawLines(doc, state.x, state.y, colorRGB, lines);
            printed = true;
            advance(state, doc);
        });

        if (printed && !atFreshTop(state)) resetPage(state, doc);
    });

    // Console summary
    try {
        const perDriver = routes.map((stops, i) => ({
            driver: i + 1,
            complex: (stops || []).filter((s) => isComplexStop(s)).length,
            total: (stops || []).length,
        }));
        const totalCx = perDriver.reduce((a, r) => a + r.complex, 0);
        console.groupCollapsed(
            `[Route Labels] Export summary — drivers: ${routes.length}, complex total: ${totalCx}`
        );
        console.table(perDriver);
        console.groupEnd();
    } catch {}

    // Segregate complex stops: Print them in a separate section after all non-complex stops
    if (complexAll.length > 0) {
        // Add a new page to clearly separate complex stops section
        resetPage(state, doc);
        
        // Draw a prominent header for Complex Stops section
        doc.setFontSize(18);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(200, 0, 0); // Red color to make it stand out
        const headerY = MARGIN_T - 0.15;
        doc.text("COMPLEX STOPS", MARGIN_L, headerY);
        
        // Draw a thicker line under the header for better visibility
        doc.setLineWidth(0.02);
        doc.setDrawColor(200, 0, 0);
        doc.line(MARGIN_L, headerY + 0.08, 8.5 - MARGIN_L, headerY + 0.08);
        
        // Reset text color and state for label printing
        doc.setTextColor(0, 0, 0);
        state.x = MARGIN_L;
        state.y = MARGIN_T + 0.2; // Add more space after header for better separation
        state.col = 0;
        state.row = 0;

        console.log(`[Route Labels PDF] Printing ${complexAll.length} complex stops in segregated section`);

        // Print all complex stops, maintaining their driver colors
        for (const { u, driverIdx, stopIdx } of complexAll) {
            // Double-check this is actually a complex stop
            const isCx = isComplexStop(u);
            if (!isCx) {
                console.warn(`[Route Labels PDF] Stop ${u?.id} was in complexAll but complex flag is false`, {
                    id: u?.id,
                    name: displayName(u),
                    complex: u?.complex,
                    __complexSource: u?.__complexSource
                });
                // Continue anyway - it was marked as complex, so print it
            }
            
            // Use the actual driver color from the palette array (which matches driverColors)
            // driverIdx corresponds to the index in the routes array, which matches colorsSorted
            const driverColor = palette[driverIdx % palette.length];
            const colorRGB = hexToRgb(driverColor);
            const driverIdx0 = getDriverIdx0(u, driverIdx);
            const stopNum1 = getStopNum1(u, stopIdx);
            drawBadgeAbove(doc, state.x, state.y, `${driverIdx0}.${stopNum1}`, colorRGB);

            // Prepare label content (first line = client name only, never address)
            const notesText = getNotes(u);
            const cityStateZip = [u.city, u.state, u.zip].filter(Boolean).join(", ");
            const lines = [
                clientName(u),
                `${u.address ?? ""}${u.apt ? " " + u.apt : ""}`.trim(),
                cityStateZip,
                (u.phone ? `Phone: ${u.phone}` : "").trim(),
                notesText ? `Notes: ${notesText}` : "",
            ].filter(Boolean);

            // Draw the label content
            drawLines(doc, state.x, state.y, colorRGB, lines);
            advance(state, doc);
        }
        
        console.log(`[Route Labels PDF] Completed printing ${complexAll.length} complex stops in segregated section`);
    } else {
        console.log(`[Route Labels PDF] No complex stops found - skipping complex stops section`);
    }

    // Final summary
    const totalNonComplex = routes.reduce((sum, stops, di) => {
        return sum + (stops || []).filter((u) => {
            return !isComplexStop(u);
        }).length;
    }, 0);
    
    console.log(`[Route Labels PDF] Final summary:`, {
        totalNonComplexStops: totalNonComplex,
        totalComplexStops: complexAll.length,
        totalStops: totalNonComplex + complexAll.length,
        hasComplexSection: complexAll.length > 0,
        segregationWorking: complexAll.length > 0 ? "Yes - Complex stops printed in separate section" : "N/A - No complex stops"
    });

    // Build a safe filename so the browser doesn't show "unnamed"
    const raw = typeof tsString === "function" ? tsString() : (tsString == null ? "" : String(tsString));
    const safePart = (raw || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}-${String(new Date().getDate()).padStart(2, "0")}`)
        .replace(/[/\\:*?"<>|]/g, "_")
        .replace(/\s+/g, "_")
        .trim() || "labels";
    const filename = `labels_route_order_${safePart}.pdf`;

    const blob = doc.output("blob");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

export default exportRouteLabelsPDF;