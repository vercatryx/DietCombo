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
        `${u.first ?? ""} ${u.last ?? ""}`.trim(),
        `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim(),
        u?.user?.name,
        `${u?.user?.first ?? ""} ${u?.user?.last ?? ""}`.trim(),
    ]
        .map((s) => (typeof s === "string" ? s.trim() : ""))
        .filter(Boolean);
    return cands[0] || "(Unnamed)";
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

/* ---------- Dislikes (localized fallback only) ---------- */
// Prefer top-level, but fall back to common nests.
// Keep this tiny and local since the rest of the label is rendering fine.
function getDislikes(u = {}) {
    const v =
        u.dislikes ??
        u?.user?.dislikes ??
        u?.User?.dislikes ??
        u?.client?.dislikes ??
        u?.flags?.dislikes ??
        "";

    const s = (v == null ? "" : String(v)).trim();
    // Treat common "empty" indicators as none
    if (/^(none|no|n\/a|na|nil|-|—|not applicable)$/i.test(s)) return "";
    // If data was typed as "Dislikes: X", strip prefix
    return s.replace(/^dislikes\s*:\s*/i, "").trim();
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

    routes.forEach((stops, di) => {
        const colorRGB = hexToRgb(palette[di % palette.length]);
        let printed = false;

        (stops || []).forEach((u, si) => {
            const isCx = toBool(u?.complex);
            if (isCx) {
                complexAll.push({ u, driverIdx: di, stopIdx: si });
                return;
            }

            const dislikeText = getDislikes(u);

            const lines = [
                displayName(u),
                `${u.address ?? ""}${u.apt ? " " + u.apt : ""}`.trim(),
                `${u.city ?? ""} ${u.state ?? ""}`.trim(),
                (u.phone ? `Phone: ${u.phone}` : "").trim(),
                dislikeText ? `Dislikes: ${dislikeText}` : "",
            ].filter(Boolean);

            // --- zero-based driver badge ---
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
            complex: (stops || []).filter((s) => toBool(s?.complex) || isComplexFallback(s)).length,
            total: (stops || []).length,
        }));
        const totalCx = perDriver.reduce((a, r) => a + r.complex, 0);
        console.groupCollapsed(
            `[Route Labels] Export summary — drivers: ${routes.length}, complex total: ${totalCx}`
        );
        console.table(perDriver);
        console.groupEnd();
    } catch {}

    if (complexAll.length > 0) {
        resetPage(state, doc);
        doc.setFontSize(14);
        doc.setTextColor(0, 0, 0);
        doc.text("Complex Stops", MARGIN_L, MARGIN_T - 0.15);
        state.x = MARGIN_L;
        state.y = MARGIN_T;
        state.col = 0;
        state.row = 0;

        for (const { u, driverIdx, stopIdx } of complexAll) {
            const colorRGB = hexToRgb(palette[driverIdx % palette.length]);
            const driverIdx0 = getDriverIdx0(u, driverIdx);
            const stopNum1 = getStopNum1(u, stopIdx);
            drawBadgeAbove(doc, state.x, state.y, `${driverIdx0}.${stopNum1}`, colorRGB);

            const dislikeText = getDislikes(u);
            const lines = [
                displayName(u),
                `${u.address ?? ""}${u.apt ? " " + u.apt : ""}`.trim(),
                `${u.city ?? ""} ${u.state ?? ""}`.trim(),
                (u.phone ? `Phone: ${u.phone}` : "").trim(),
                dislikeText ? `Dislikes: ${dislikeText}` : "",
            ].filter(Boolean);

            drawLines(doc, state.x, state.y, colorRGB, lines);
            advance(state, doc);
        }
    }

    doc.save(`labels (route order) ${tsString()}.pdf`);
}

export default exportRouteLabelsPDF;