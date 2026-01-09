"use client";

import React, { useEffect, useRef, useState, useMemo, useCallback } from "react";
import { useParams } from "next/navigation";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";

type Pt = { x: number; y: number; t: number };
type Stroke = Pt[];

type Loaded = {
    user: {
        id: string;
        first: string;
        last: string;
        address?: string | null;
        apt?: string | null;
        city?: string | null;
        state?: string | null;
        zip?: string | null;
    };
    collected: number;
    slots: number[];
    signatures?: {
        slot: number;
        strokes: Stroke[];
        signedAt?: string;
        ip?: string | null;
        userAgent?: string | null;
        orderId?: string | null;
    }[];
};

function drawStrokes(canvas: HTMLCanvasElement, strokes: Stroke[], width = 600, height = 160) {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    
    // Normalize and validate strokes data
    if (!strokes || !Array.isArray(strokes)) {
        return;
    }
    
    for (const s of strokes) {
        // Skip if stroke is not an array
        if (!Array.isArray(s)) {
            continue;
        }
        
        // Ensure we have at least one point
        if (s.length === 0) {
            continue;
        }
        
        ctx.beginPath();
        let hasValidPoint = false;
        
        for (let i = 0; i < s.length; i++) {
            const p = s[i];
            // Validate point structure
            if (p && typeof p === 'object' && typeof p.x === 'number' && typeof p.y === 'number') {
                if (i === 0) {
                    ctx.moveTo(p.x, p.y);
                    hasValidPoint = true;
                } else {
                    ctx.lineTo(p.x, p.y);
                }
            }
        }
        
        // Only stroke if we had at least one valid point
        if (hasValidPoint) {
            ctx.stroke();
        }
    }
}

function todayString() {
    const d = new Date();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${mm}/${dd}/${yyyy}`;
}

async function fetchLogoBytes(): Promise<Uint8Array | null> {
    try {
        const r = await fetch("/mainLogo.jpg", { cache: "reload" });
        if (!r.ok) return null;
        const buf = await r.arrayBuffer();
        return new Uint8Array(buf);
    } catch {
        return null;
    }
}

export default function SignaturesViewPage() {
    const { token } = useParams<{ token: string }>();

    const [data, setData] = useState<Loaded | null>(null);
    const [busy, setBusy] = useState(false);

    const [pdfBusy, setPdfBusy] = useState(false);
    const [exportSlot, setExportSlot] = useState<"random" | number>("random");
    const [startDate, setStartDate] = useState<string>(todayString());
    const [endDate, setEndDate] = useState<string>(todayString());
    const [deliveryDate, setDeliveryDate] = useState<string>(todayString());

    const padRefs = useMemo(() => [
        React.createRef<HTMLCanvasElement>(),
        React.createRef<HTMLCanvasElement>(),
        React.createRef<HTMLCanvasElement>(),
        React.createRef<HTMLCanvasElement>(),
        React.createRef<HTMLCanvasElement>(),
    ], []);

    const load = useCallback(async () => {
        const res = await fetch(`/api/signatures/admin/${token}`, { cache: "no-store" });
        if (!res.ok) throw new Error(await res.text());
        const j: Loaded = await res.json();
        setData(j);
    }, [token]);

    useEffect(() => {
        load().catch((e) => alert(e.message || "Failed to load signatures"));
    }, [load]);

    useEffect(() => {
        if (!data?.signatures) {
            for (const ref of padRefs) {
                const c = ref.current;
                if (c) drawStrokes(c, []);
            }
            return;
        }
        for (const sig of data.signatures) {
            const idx = sig.slot - 1;
            const c = padRefs[idx]?.current;
            if (c) {
                // Ensure strokes is an array, default to empty array if invalid
                const strokes = Array.isArray(sig.strokes) ? sig.strokes : [];
                drawStrokes(c, strokes);
            }
        }
        const signedSet = new Set(data.signatures.map((s) => s.slot));
        [1, 2, 3, 4, 5].forEach((slot) => {
            if (!signedSet.has(slot)) {
                const c = padRefs[slot - 1]?.current;
                if (c) drawStrokes(c, []);
            }
        });
    }, [data, padRefs]);

    const handleDeleteAll = async () => {
        if (!confirm("Delete ALL signatures for this user? This cannot be undone.")) return;
        setBusy(true);
        try {
            const res = await fetch(`/api/signatures/admin/${token}`, { method: "DELETE" });
            if (!res.ok) throw new Error(await res.text());
            setData((prev) =>
                prev
                    ? { ...prev, collected: 0, slots: [], signatures: [] }
                    : {
                        user: { id: "", first: "", last: "" },
                        collected: 0,
                        slots: [],
                        signatures: [],
                    }
            );
            for (const ref of padRefs) {
                const c = ref.current;
                if (c) drawStrokes(c, []);
            }
            alert("All signatures deleted.");
        } catch (e: any) {
            alert(e?.message || "Failed to delete signatures");
        } finally {
            setBusy(false);
        }
    };

    const fullName = useMemo(
        () => (data?.user ? `${data.user.first} ${data.user.last}`.trim() : ""),
        [data?.user]
    );

    const addressLine = useMemo(() => {
        if (!data?.user) return "";
        const parts = [
            data.user.address ?? "",
            data.user.apt ?? "",
            [data.user.city, data.user.state, data.user.zip].filter(Boolean).join(" "),
        ]
            .filter(Boolean)
            .join(" ");
        return parts;
    }, [data?.user]);

    const getSignedSlots = useCallback((): number[] => {
        const detailed = data?.signatures?.map((s) => s.slot) ?? [];
        const basic = data?.slots ?? [];
        const merged = Array.from(new Set([...(detailed || []), ...(basic || [])])).filter(Boolean) as number[];
        return merged.sort((a, b) => a - b);
    }, [data?.signatures, data?.slots]);

    function drawLabelValueBold(opts: {
        page: any; font: any; bold: any; x: number; y: number; size: number;
        label: string; value: string;
    }) {
        const { page, font, bold, x, y, size, label, value } = opts;
        page.drawText(`${label}: `, { x, y, size, font });
        const labelWidth = font.widthOfTextAtSize(`${label}: `, size);
        page.drawText(value || "—", { x: x + labelWidth, y, size, font: bold });
    }

    function drawCheckedBox(page: any, x: number, yBaseline: number, size: number) {
        const cap = size * 0.70;
        const box = Math.max(10, Math.round(size * 0.90));
        const yBox = yBaseline + (cap / 2) - (box / 2);

        page.drawRectangle({
            x,
            y: yBox,
            width: box,
            height: box,
            borderColor: rgb(0, 0, 0),
            borderWidth: 1,
        });

        const sX = x + box * 0.22;
        const sY = yBox + box * 0.48;
        const mX = x + box * 0.45;
        const mY = yBox + box * 0.22;
        const eX = x + box * 0.82;
        const eY = yBox + box * 0.80;

        page.drawLine({ start: { x: sX, y: sY }, end: { x: mX, y: mY }, thickness: 1 });
        page.drawLine({ start: { x: mX, y: mY }, end: { x: eX, y: eY }, thickness: 1 });
    }

    function drawCheckboxLine(opts: { page: any; font: any; x: number; y: number; size: number; text: string }) {
        const { page, font, x, y, size, text } = opts;
        drawCheckedBox(page, x, y, size);
        const gap = 8;
        page.drawText(text, { x: x + Math.max(10, Math.round(size * 0.90)) + gap, y, size, font });
    }

    async function handleDownloadPdf() {
        if (pdfBusy || !data) return;

        const signedSlots = getSignedSlots();
        if (!signedSlots.length) return;

        const slot = exportSlot === "random"
            ? signedSlots[Math.floor(Math.random() * signedSlots.length)]
            : exportSlot;

        if (exportSlot !== "random" && !signedSlots.includes(exportSlot)) return;

        const canvas = padRefs[slot - 1]?.current;
        if (!canvas) return;

        try {
            setPdfBusy(true);

            // Ensure the canvas is properly drawn before extracting
            // Find the signature data for the selected slot
            const signature = data.signatures?.find((s) => s.slot === slot);
            
            // Verify canvas has context
            const ctx = canvas.getContext("2d");
            if (!ctx) {
                throw new Error("Unable to get canvas context");
            }

            // Ensure canvas dimensions are set (re-apply if needed)
            const dpr = window.devicePixelRatio || 1;
            const canvasWidth = 600;
            const canvasHeight = 160;
            if (canvas.width !== canvasWidth * dpr || canvas.height !== canvasHeight * dpr) {
                canvas.width = canvasWidth * dpr;
                canvas.height = canvasHeight * dpr;
                canvas.style.width = `${canvasWidth}px`;
                canvas.style.height = `${canvasHeight}px`;
                ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
            }
            
            // Set white background for PDF export (ensures signature is visible)
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, canvasWidth, canvasHeight);
            
            // Re-draw the strokes to ensure canvas is up-to-date
            if (signature && signature.strokes) {
                const strokes = Array.isArray(signature.strokes) ? signature.strokes : [];
                if (strokes.length > 0) {
                    // Set stroke style
                    ctx.strokeStyle = "#000000";
                    ctx.lineWidth = 2;
                    ctx.lineJoin = "round";
                    ctx.lineCap = "round";
                    
                    // Draw each stroke
                    for (const s of strokes) {
                        if (!Array.isArray(s) || s.length === 0) continue;
                        
                        ctx.beginPath();
                        let hasValidPoint = false;
                        
                        for (let i = 0; i < s.length; i++) {
                            const p = s[i];
                            if (p && typeof p === 'object' && typeof p.x === 'number' && typeof p.y === 'number') {
                                if (i === 0) {
                                    ctx.moveTo(p.x, p.y);
                                    hasValidPoint = true;
                                } else {
                                    ctx.lineTo(p.x, p.y);
                                }
                            }
                        }
                        
                        if (hasValidPoint) {
                            ctx.stroke();
                        }
                    }
                }
            }

            // Wait a brief moment to ensure canvas rendering is complete
            await new Promise(resolve => setTimeout(resolve, 100));

            // Extract image data from canvas - ensure we get PNG format
            let dataUrl: string;
            try {
                dataUrl = canvas.toDataURL("image/png");
            } catch (err) {
                throw new Error(`Failed to extract canvas data: ${err instanceof Error ? err.message : String(err)}`);
            }

            // Validate data URL
            if (!dataUrl || dataUrl === "data:," || !dataUrl.startsWith("data:image/png")) {
                throw new Error("Canvas is empty or not properly rendered - no signature data available");
            }

            const base64 = dataUrl.split(",")[1] || "";
            if (!base64) {
                throw new Error("Failed to extract image data from canvas");
            }

            const bin = atob(base64);
            const imgBytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) imgBytes[i] = bin.charCodeAt(i);

            const pdf = await PDFDocument.create();
            const page = pdf.addPage([612, 792]);
            const font = await pdf.embedFont(StandardFonts.Helvetica);
            const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

            const margin = 72;
            const lineGap = 18;
            let y = 760;

            const usableWidth = page.getWidth() - margin * 2.5;

            const logoBytes = await fetchLogoBytes();
            if (logoBytes) {
                try {
                    const logoImg = await pdf.embedPng(logoBytes).catch(async () => await pdf.embedJpg(logoBytes));
                    const maxW = 240, maxH = 70;
                    const scale = Math.min(maxW / logoImg.width, maxH / logoImg.height, 1);
                    const drawW = logoImg.width * scale;
                    const drawH = logoImg.height * scale;
                    const xLogo = (page.getWidth() - drawW) / 2;
                    const yLogo = y - drawH;
                    page.drawImage(logoImg, { x: xLogo, y: yLogo, width: drawW, height: drawH });
                    y = yLogo - 18;
                } catch { }
            }

            page.drawText("Member Attestation of Medically Tailored Meal Delivery", {
                x: margin, y, size: 16, font: bold,
            });
            y -= 28;
            page.drawLine({
                start: { x: margin, y }, end: { x: page.getWidth() - margin, y },
                thickness: 1, color: rgb(0.8, 0.8, 0.8),
            });
            y -= 28;

            const fullName = `${data.user.first ?? ""} ${data.user.last ?? ""}`.trim();
            const addressLine = [
                data.user.address ?? "",
                data.user.apt ?? "",
                [data.user.city, data.user.state, data.user.zip].filter(Boolean).join(" "),
            ].filter(Boolean).join(" ");

            drawLabelValueBold({ page, font, bold, x: margin, y, size: 12, label: "Member Name", value: fullName || "—" });
            y -= lineGap;

            page.drawText(`Address: ${addressLine || "—"}`, { x: margin, y, size: 12, font });
            y -= 30;

            page.drawText("Meal Delivery Information", { x: margin, y, size: 14, font: bold });
            y -= lineGap;

            page.drawText("Type of Meals (if applicable):", { x: margin + 12, y, size: 12, font });
            y -= lineGap;
            drawCheckboxLine({ page, font, x: margin + 28, y, size: 12, text: "Breakfast" }); y -= lineGap;
            drawCheckboxLine({ page, font, x: margin + 28, y, size: 12, text: "Lunch" });     y -= lineGap;
            drawCheckboxLine({ page, font, x: margin + 28, y, size: 12, text: "Dinner" });    y -= lineGap;
            drawCheckboxLine({ page, font, x: margin + 28, y, size: 12, text: "Snacks" });

            y -= 30;
            page.drawLine({
                start: { x: margin, y }, end: { x: page.getWidth() - margin, y },
                thickness: 1, color: rgb(0.8, 0.8, 0.8),
            });

            y -= 30;
            page.drawText("Member Delivery Attestation", { x: margin, y, size: 14, font: bold });
            y -= lineGap * 1.5;

            const startDateString = startDate.trim();
            const endDateString = endDate.trim();
            const dateString = deliveryDate.trim();
            
            const firstLineStart = `${fullName || "Member"}`;
            page.drawText(firstLineStart, { x: margin, y, size: 12, font: bold });
            const startWidth = bold.widthOfTextAtSize(firstLineStart, 12);

            let dateText = "";
            if (startDateString && endDateString && dateString) {
                dateText = ` for the service period from ${startDateString} to ${endDateString}, delivered on ${dateString}`;
            } else if (dateString) {
                dateText = ` on ${dateString}`;
            } else if (startDateString && endDateString) {
                dateText = ` for the service period from ${startDateString} to ${endDateString}`;
            } else {
                dateText = " on the date indicated above";
            }
            
            const afterName =
                `  confirms that they personally received their medically tailored meals${dateText}.`;

            const remainingWidth = Math.max(0, usableWidth - startWidth);

            if (remainingWidth > 40) {
                const lines = wrapText(afterName, remainingWidth, font, 12);
                if (lines.length) {
                    page.drawText(lines[0], { x: margin + startWidth, y, size: 12, font });
                }
                for (let i = 1; i < lines.length; i++) {
                    y -= 16;
                    page.drawText(lines[i], { x: margin, y, size: 12, font });
                }
                y -= 16;
            } else {
                y -= 16;
                for (const ln of wrapText(afterName, usableWidth, font, 12)) {
                    page.drawText(ln, { x: margin, y, size: 12, font });
                    y -= 16;
                }
            }

            const para =
                "This attestation documents that delivery occurred as stated. The information and electronic signature on this form may be used by the Social Care Network and its providers to verify service delivery for compliance and reimbursement purposes. The electronic signature is captured and retained with this record.";

            for (const ln of wrapText(para, usableWidth, font, 12)) {
                page.drawText(ln, { x: margin, y, size: 12, font });
                y -= 16;
            }

            y -= 26;
            page.drawText("Signature", { x: margin, y, size: 14, font: bold });
            y -= 10;

            // Embed the signature image
            let embedded;
            try {
                // Try PNG first (canvas produces PNG)
                embedded = await pdf.embedPng(imgBytes);
            } catch (pngErr) {
                try {
                    // Fallback to JPG if PNG fails
                    embedded = await pdf.embedJpg(imgBytes);
                } catch (jpgErr) {
                    console.error("Failed to embed signature image:", pngErr, jpgErr);
                    throw new Error("Failed to embed signature image into PDF");
                }
            }

            // Validate embedded image exists
            if (!embedded || !embedded.width || !embedded.height) {
                throw new Error("Invalid signature image data");
            }

            const maxW = 300, maxH = 100;
            const scale = Math.min(maxW / embedded.width, maxH / embedded.height, 1);
            const drawW = embedded.width * scale;
            const drawH = embedded.height * scale;
            const xImg = margin;
            const yImg = y - drawH - 8;
            
            // Draw the signature image on the PDF
            page.drawImage(embedded, { x: xImg, y: yImg, width: drawW, height: drawH });

            page.drawText(`Date: ${dateString || "—"}`, {
                x: margin + drawW + 60,
                y: yImg + drawH / 2,
                size: 12,
                font,
            });

            page.drawText(
                "For internal use only – retain this attestation for program and audit records.",
                { x: margin, y: 72, size: 10, font, color: rgb(0.3, 0.3, 0.3) }
            );

            const bytes = await pdf.save();
            const ab = new ArrayBuffer(bytes.byteLength);
            new Uint8Array(ab).set(bytes);
            const blob = new Blob([ab], { type: "application/pdf" });

            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            const fname = (fullName || "member").replace(/\s+/g, "_");
            a.href = url;
            a.download = `${fname}_attestation.pdf`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
        } catch (err: any) {
            console.error("Error generating PDF:", err);
            alert(`Failed to generate PDF: ${err?.message || "Unknown error"}`);
        } finally {
            setPdfBusy(false);
        }
    }

    function wrapText(text: string, width: number, fnt: any, size: number): string[] {
        const words = text.split(/\s+/);
        const lines: string[] = [];
        let line = "";
        for (const w of words) {
            const test = line ? `${line} ${w}` : w;
            const tw = fnt.widthOfTextAtSize(test, size);
            if (tw > width && line) {
                lines.push(line);
                line = w;
            } else {
                line = test;
            }
        }
        if (line) lines.push(line);
        return lines;
    }

    if (!data) {
        return <div style={{ padding: 24, fontFamily: "ui-sans-serif, system-ui" }}>Loading…</div>;
    }

    return (
        <div style={{ maxWidth: 780, margin: "36px auto", padding: 16, fontFamily: "ui-sans-serif, system-ui" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <h1 style={{ fontSize: 24, marginBottom: 8 }}>
                    {data.user.first} {data.user.last} — Completed Signatures ({data.collected}/5)
                </h1>

                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <label style={{ fontSize: 12, color: "#374151" }}>
                        Export:
                        <select
                            value={exportSlot as any}
                            onChange={(e) => {
                                const v = e.target.value;
                                setExportSlot(v === "random" ? "random" : Number(v));
                            }}
                            style={{
                                marginLeft: 6,
                                padding: "6px 8px",
                                borderRadius: 8,
                                border: "1px solid #e5e7eb",
                                background: "#fff",
                                cursor: "pointer",
                            }}
                            title="Choose which signature to export"
                        >
                            <option value="random">Random</option>
                            {getSignedSlots().map((slot) => (
                                <option key={`slot-${slot}`} value={slot}>
                                    Signature {slot}
                                </option>
                            ))}
                        </select>
                    </label>

                    <label style={{ fontSize: 12, color: "#374151", display: "flex", flexDirection: "column", gap: 4 }}>
                        Start Date:
                        <input
                            type="text"
                            inputMode="text"
                            placeholder="e.g. 10/12/2025"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            style={{
                                padding: "6px 8px",
                                borderRadius: 8,
                                border: "1px solid #e5e7eb",
                                background: "#fff",
                                minWidth: 180,
                            }}
                            title="Enter the service period start date"
                        />
                    </label>
                    
                    <label style={{ fontSize: 12, color: "#374151", display: "flex", flexDirection: "column", gap: 4 }}>
                        End Date:
                        <input
                            type="text"
                            inputMode="text"
                            placeholder="e.g. 10/12/2025"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            style={{
                                padding: "6px 8px",
                                borderRadius: 8,
                                border: "1px solid #e5e7eb",
                                background: "#fff",
                                minWidth: 180,
                            }}
                            title="Enter the service period end date"
                        />
                    </label>
                    
                    <label style={{ fontSize: 12, color: "#374151", display: "flex", flexDirection: "column", gap: 4 }}>
                        Delivery Date:
                        <input
                            type="text"
                            inputMode="text"
                            placeholder="e.g. 10/12/2025"
                            value={deliveryDate}
                            onChange={(e) => setDeliveryDate(e.target.value)}
                            style={{
                                padding: "6px 8px",
                                borderRadius: 8,
                                border: "1px solid #e5e7eb",
                                background: "#fff",
                                minWidth: 180,
                            }}
                            title="Enter the delivery date to include on the PDF"
                        />
                    </label>

                    <button
                        onClick={handleDownloadPdf}
                        disabled={pdfBusy || getSignedSlots().length === 0}
                        style={{
                            padding: "8px 12px",
                            borderRadius: 8,
                            border: "1px solid #111827",
                            background: "#111827",
                            color: "#fff",
                            fontWeight: 600,
                            cursor: pdfBusy || getSignedSlots().length === 0 ? "not-allowed" : "pointer",
                        }}
                        title="Download the attestation PDF with the selected signature"
                    >
                        {pdfBusy ? "Building…" : "Download PDF"}
                    </button>

                    <button
                        onClick={handleDeleteAll}
                        disabled={busy}
                        style={{
                            padding: "8px 12px",
                            borderRadius: 8,
                            border: "1px solid #c00",
                            background: "#c00",
                            color: "#fff",
                            fontWeight: 600,
                            cursor: busy ? "not-allowed" : "pointer",
                        }}
                        title="Delete all signatures for this user"
                    >
                        {busy ? "Deleting…" : "Delete All"}
                    </button>
                </div>
            </div>

            <p style={{ marginBottom: 16, color: "#666" }}>
                Read-only preview. Timestamp/IP/UA are shown when available.
            </p>

            {[1, 2, 3, 4, 5].map((slot) => {
                const done = data.slots?.includes(slot);
                const meta = data.signatures?.find((s) => s.slot === slot);
                return (
                    <div key={slot} style={{ marginBottom: 18 }}>
                        <div style={{ margin: "6px 0", fontWeight: 600 }}>
                            Slot {slot} {done ? "✓" : "—"}
                        </div>
                        <canvas
                            ref={padRefs[slot - 1]}
                            style={{
                                display: "block",
                                width: 600,
                                height: 160,
                                background: "#f9f9f9",
                                borderRadius: 8,
                                border: "1px solid #e1e1e1",
                            }}
                        />
                        {meta ? (
                            <div style={{ fontSize: 12, color: "#666", marginTop: 6 }}>
                                Signed: {meta.signedAt ? new Date(meta.signedAt).toLocaleString() : "—"}
                                {meta.orderId ? (
                                    <span style={{ color: "#1976d2", marginLeft: "8px" }}>
                                        • Order: <a href={`/orders/${meta.orderId}`} target="_blank" rel="noopener noreferrer" style={{ color: "#1976d2", textDecoration: "underline" }}>View Order</a>
                                    </span>
                                ) : null}
                                {meta.ip ? ` • IP: ${meta.ip}` : ""} {meta.userAgent ? ` • UA: ${meta.userAgent.substring(0, 50)}${meta.userAgent.length > 50 ? '...' : ''}` : ""}
                            </div>
                        ) : null}
                    </div>
                );
            })}
        </div>
    );
}

