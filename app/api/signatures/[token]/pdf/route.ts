/**
 * GET /api/signatures/[token]/pdf
 * Returns the attestation PDF for the client identified by sign_token.
 * Query params (optional): start, end, delivery (YYYY-MM-DD). Defaults from BILL_DATE_DEFAULT.
 * Server-side so automation can pull the PDF directly.
 */

import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, rgb, StandardFonts, PDFFont } from "pdf-lib";
import { supabase } from "@/lib/supabase";
import * as fs from "fs";
import * as path from "path";

const BILL_DATE_DEFAULT = "2026-02-16";

function isoToMDY(iso: string): string {
    if (!iso || !iso.match(/^\d{4}-\d{2}-\d{2}/)) return "";
    const [y, m, d] = iso.split("-");
    return `${m}/${d}/${y}`;
}

function addDays(iso: string, days: number): string {
    const d = new Date(iso + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
}

async function fetchLogoBytes(): Promise<Uint8Array | null> {
    try {
        const publicPath = path.join(process.cwd(), "public", "diet-fantasy-logo.png");
        if (fs.existsSync(publicPath)) {
            const buf = fs.readFileSync(publicPath);
            return new Uint8Array(buf);
        }
    } catch {
        // ignore
    }
    return null;
}

type Stroke = Array<{ x: number; y: number; t?: number }>;

function drawSignatureStrokes(
    page: any,
    strokes: Stroke[],
    opts: { x: number; y: number; width: number; height: number; sourceWidth: number; sourceHeight: number }
) {
    const { x: ox, y: oy, width, height, sourceWidth, sourceHeight } = opts;
    const scaleX = width / sourceWidth;
    const scaleY = height / sourceHeight;
    // Canvas coords: top-left origin. PDF: we use oy as bottom of the signature box, so flip Y.
    for (const stroke of strokes || []) {
        if (!Array.isArray(stroke) || stroke.length < 2) continue;
        for (let i = 0; i < stroke.length - 1; i++) {
            const p0 = stroke[i];
            const p1 = stroke[i + 1];
            if (!p0 || !p1 || typeof p0.x !== "number" || typeof p0.y !== "number" || typeof p1.x !== "number" || typeof p1.y !== "number") continue;
            const x0 = ox + p0.x * scaleX;
            const y0 = oy + (sourceHeight - p0.y) * scaleY;
            const x1 = ox + p1.x * scaleX;
            const y1 = oy + (sourceHeight - p1.y) * scaleY;
            page.drawLine({
                start: { x: x0, y: y0 },
                end: { x: x1, y: y1 },
                thickness: 2,
                color: rgb(0, 0, 0),
            });
        }
    }
}

function wrapText(text: string, width: number, font: PDFFont, size: number): string[] {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
        const test = line ? `${line} ${w}` : w;
        const tw = font.widthOfTextAtSize(test, size);
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

export async function GET(
    req: NextRequest,
    ctx: { params: Promise<{ token: string }> }
) {
    try {
        const { token } = await ctx.params;
        if (!token) {
            return NextResponse.json({ error: "Missing token" }, { status: 400 });
        }

        const searchParams = req.nextUrl.searchParams;
        const startParam = searchParams.get("start") || BILL_DATE_DEFAULT;
        const endParam = searchParams.get("end") || addDays(BILL_DATE_DEFAULT, 7);
        const deliveryParam = searchParams.get("delivery") || BILL_DATE_DEFAULT;

        const startDateMDY = isoToMDY(startParam);
        const endDateMDY = isoToMDY(endParam);
        const deliveryDateMDY = isoToMDY(deliveryParam);

        const { data: user } = await supabase
            .from("clients")
            .select("id, full_name, first_name, last_name, address, apt, city, state, zip")
            .eq("sign_token", token)
            .single();

        if (!user) {
            return NextResponse.json({ error: "Not found" }, { status: 404 });
        }

        let firstName = (user as any).first_name || "";
        let lastName = (user as any).last_name || "";
        if (!firstName && !lastName && (user as any).full_name) {
            const parts = String((user as any).full_name).trim().split(/\s+/);
            if (parts.length > 0) {
                firstName = parts[0];
                lastName = parts.slice(1).join(" ") || "";
            }
        }

        let sigs: any[] = [];
        try {
            const { data, error } = await supabase
                .from("signatures")
                .select("slot, strokes, signed_at")
                .eq("client_id", user.id)
                .order("slot", { ascending: true })
                .order("signed_at", { ascending: true });
            if (error) throw error;
            sigs = data || [];
        } catch {
            sigs = [];
        }

        const withStrokes = sigs.filter((s) => {
            let strokes = s.strokes;
            if (typeof strokes === "string") {
                try {
                    strokes = JSON.parse(strokes);
                } catch {
                    strokes = [];
                }
            }
            return Array.isArray(strokes) && strokes.length > 0;
        });

        if (withStrokes.length === 0) {
            return NextResponse.json(
                { error: "No signatures with stroke data found for this client" },
                { status: 404 }
            );
        }

        const chosen = withStrokes[0];
        let strokes: Stroke[] = chosen.strokes;
        if (typeof strokes === "string") {
            try {
                strokes = JSON.parse(strokes);
            } catch {
                strokes = [];
            }
        }
        if (!Array.isArray(strokes)) strokes = [];

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
                const maxW = 240,
                    maxH = 70;
                const scale = Math.min(maxW / logoImg.width, maxH / logoImg.height, 1);
                const drawW = logoImg.width * scale;
                const drawH = logoImg.height * scale;
                const xLogo = (page.getWidth() - drawW) / 2;
                const yLogo = y - drawH;
                page.drawImage(logoImg, { x: xLogo, y: yLogo, width: drawW, height: drawH });
                y = yLogo - 18;
            } catch {
                //
            }
        }

        page.drawText("Member Attestation of Medically Tailored Meal Delivery", {
            x: margin,
            y,
            size: 16,
            font: bold,
        });
        y -= 28;
        page.drawLine({
            start: { x: margin, y },
            end: { x: page.getWidth() - margin, y },
            thickness: 1,
            color: rgb(0.8, 0.8, 0.8),
        });
        y -= 28;

        const fullName = `${firstName} ${lastName}`.trim();
        const addressLine = [
            (user as any).address ?? "",
            (user as any).apt ?? "",
            [(user as any).city, (user as any).state, (user as any).zip].filter(Boolean).join(" "),
        ]
            .filter(Boolean)
            .join(" ");

        page.drawText(`Member Name: ${fullName || "—"}`, { x: margin, y, size: 12, font: bold });
        y -= lineGap;
        page.drawText(`Address: ${addressLine || "—"}`, { x: margin, y, size: 12, font });
        y -= 30;

        page.drawText("Meal Delivery Information", { x: margin, y, size: 14, font: bold });
        y -= lineGap;
        page.drawText("Type of Meals (if applicable): Breakfast / Lunch / Dinner / Snacks", { x: margin + 12, y, size: 12, font });
        y -= 30;
        page.drawLine({
            start: { x: margin, y },
            end: { x: page.getWidth() - margin, y },
            thickness: 1,
            color: rgb(0.8, 0.8, 0.8),
        });
        y -= 30;

        page.drawText("Member Delivery Attestation", { x: margin, y, size: 14, font: bold });
        y -= lineGap * 1.5;

        let dateText = "";
        if (startDateMDY && endDateMDY && deliveryDateMDY) {
            dateText = ` for the service period from ${startDateMDY} to ${endDateMDY}, delivered on ${deliveryDateMDY}`;
        } else if (deliveryDateMDY) {
            dateText = ` on ${deliveryDateMDY}`;
        } else if (startDateMDY && endDateMDY) {
            dateText = ` for the service period from ${startDateMDY} to ${endDateMDY}`;
        } else {
            dateText = " on the date indicated above";
        }

        const afterName = `${fullName || "Member"}  confirms that they personally received their medically tailored meals${dateText}.`;
        for (const ln of wrapText(afterName, usableWidth, font, 12)) {
            page.drawText(ln, { x: margin, y, size: 12, font });
            y -= 16;
        }

        const para =
            "This attestation documents that delivery occurred as stated. The information and electronic signature on this form may be used by the Social Care Network and its providers to verify service delivery for compliance and reimbursement purposes.";
        for (const ln of wrapText(para, usableWidth, font, 12)) {
            page.drawText(ln, { x: margin, y, size: 12, font });
            y -= 16;
        }

        y -= 26;
        page.drawText("Signature", { x: margin, y, size: 14, font: bold });
        y -= 10;

        const sigWidth = 300;
        const sigHeight = 80;
        const sigSourceW = 600;
        const sigSourceH = 160;
        const sigX = margin;
        const sigY = y - sigHeight - 8;

        drawSignatureStrokes(page, strokes, {
            x: sigX,
            y: sigY,
            width: sigWidth,
            height: sigHeight,
            sourceWidth: sigSourceW,
            sourceHeight: sigSourceH,
        });

        page.drawText(`Date: ${deliveryDateMDY || "—"}`, {
            x: margin + sigWidth + 20,
            y: sigY + sigHeight / 2 - 6,
            size: 12,
            font,
        });

        page.drawText("For internal use only – retain this attestation for program and audit records.", {
            x: margin,
            y: 72,
            size: 10,
            font,
            color: rgb(0.3, 0.3, 0.3),
        });

        const bytes = await pdf.save();
        return new NextResponse(Buffer.from(bytes), {
            status: 200,
            headers: {
                "Content-Type": "application/pdf",
                "Content-Disposition": `inline; filename="${(fullName || "attestation").replace(/\s+/g, "_")}_attestation.pdf"`,
            },
        });
    } catch (err: any) {
        console.error("[signatures pdf GET] error:", err);
        return NextResponse.json(
            { error: "Internal error", detail: err?.message },
            { status: 500 }
        );
    }
}
