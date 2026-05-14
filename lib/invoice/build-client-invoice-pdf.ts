/**
 * Server-side vector PDF for client invoices (public /api/client-invoice-pdf).
 * Layout and palette are tuned for print: soft greens, gradients, calm typography.
 */

import { existsSync, readFileSync } from 'fs';
import path from 'path';
import { jsPDF } from 'jspdf';
import type { ClientInvoiceApiPayload } from '@/lib/invoice/build-client-invoice-payload';
import { formatInvoiceMoney } from '@/lib/invoice/build-client-invoice-payload';
import { invoiceOrgContactOneLine } from '@/lib/invoice/invoice-org-footer';

/** Core palette (RGB) */
const C = {
    pageBg: [252, 253, 252] as [number, number, number],
    ink: [30, 41, 59] as [number, number, number],
    inkMuted: [100, 116, 139] as [number, number, number],
    accent: [21, 128, 61] as [number, number, number],
    accentSoft: [34, 160, 95] as [number, number, number],
    lineSubtle: [226, 232, 240] as [number, number, number],
    cardFill: [248, 250, 252] as [number, number, number],
    cardStroke: [203, 213, 225] as [number, number, number],
    tableHead: [22, 101, 52] as [number, number, number],
    tableHeadText: [255, 255, 255] as [number, number, number],
    rowAlt: [248, 250, 252] as [number, number, number],
    totalBg: [220, 252, 231] as [number, number, number],
    gradHeaderTop: [209, 250, 229] as [number, number, number],
    gradHeaderBot: [255, 255, 255] as [number, number, number],
    gradFooterTop: [255, 255, 255] as [number, number, number],
    gradFooterBot: [214, 249, 202] as [number, number, number],
};

function sanitizeFilenameBase(name: string): string {
    const trimmed = name.trim().slice(0, 80);
    const safe = trimmed.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
    return safe || 'invoice';
}

export function buildClientInvoicePdfFilename(payload: ClientInvoiceApiPayload): string {
    const base = sanitizeFilenameBase(`invoice-${payload.clientName}-${payload.periodFrom}-to-${payload.periodTo}`);
    const suffix = payload.produceInvoice ? '-produce' : '';
    return `${base}${suffix}.pdf`;
}

function pdfAscii(s: string): string {
    return String(s)
        .replace(/\u2192/g, '->')
        .replace(/\u2013/g, '-')
        .replace(/\u2014/g, '-')
        .replace(/\u2212/g, '-')
        .replace(/\u00a0/g, ' ');
}

function lerp(a: number, b: number, t: number): number {
    return Math.round(a + (b - a) * t);
}

/** Vertical gradient (top -> bottom), full vector bands. */
function fillGradientV(
    doc: jsPDF,
    x: number,
    y: number,
    w: number,
    h: number,
    top: [number, number, number],
    bottom: [number, number, number],
    steps = 52,
): void {
    if (h <= 0) return;
    const strip = h / steps;
    for (let i = 0; i < steps; i++) {
        const t = steps <= 1 ? 0 : i / (steps - 1);
        doc.setFillColor(lerp(top[0], bottom[0], t), lerp(top[1], bottom[1], t), lerp(top[2], bottom[2], t));
        doc.rect(x, y + i * strip, w, strip + 0.02, 'F');
    }
}

function setFill(doc: jsPDF, rgb: [number, number, number]): void {
    doc.setFillColor(rgb[0], rgb[1], rgb[2]);
}

function setDraw(doc: jsPDF, rgb: [number, number, number], w = 0.2): void {
    doc.setDrawColor(rgb[0], rgb[1], rgb[2]);
    doc.setLineWidth(w);
}

function setText(doc: jsPDF, rgb: [number, number, number]): void {
    doc.setTextColor(rgb[0], rgb[1], rgb[2]);
}

export function buildClientInvoicePdfBytes(payload: ClientInvoiceApiPayload): Uint8Array {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const m = 15;
    const contentW = pageW - m * 2;

    const HEADER_BAND = 28;
    const FOOTER_BAND = 28;
    const footerLine = process.env.NEXT_PUBLIC_INVOICE_ORG_FOOTER_LINE || 'Thank you for your business.';

    // --- Page wash (barely visible) ---
    setFill(doc, C.pageBg);
    doc.rect(0, HEADER_BAND, pageW, pageH - HEADER_BAND - FOOTER_BAND, 'F');

    // --- Header gradient band ---
    fillGradientV(doc, 0, 0, pageW, HEADER_BAND, C.gradHeaderTop, C.gradHeaderBot, 56);
    setDraw(doc, C.lineSubtle, 0.12);
    doc.line(0, HEADER_BAND, pageW, HEADER_BAND);

    // --- Logo ---
    const logoPath = path.join(process.cwd(), 'public', 'diet-fantasy-logo.png');
    const logoW = 54;
    const logoH = 18.5;
    const logoY = 9;
    if (existsSync(logoPath)) {
        try {
            const b64 = readFileSync(logoPath).toString('base64');
            doc.addImage(`data:image/png;base64,${b64}`, 'PNG', m, logoY, logoW, logoH);
        } catch {
            /* skip */
        }
    }

    // --- Title (right, in band) ---
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(22);
    setText(doc, C.accent);
    doc.text('Invoice', pageW - m, logoY + 12, { align: 'right' });

    let y = HEADER_BAND + 8;

    // --- Meta cards (two columns) ---
    const gap = 6;
    const cardW = (contentW - gap) / 2;
    const cardPad = 5;
    const cardTop = y;
    const leftX = m;
    const rightX = m + cardW + gap;

    const addr = (payload.clientAddress || '').trim();
    const addrParts = addr ? addr.split(/\n|,/).map((s) => s.trim()).filter(Boolean) : [];
    const addrBlock = addrParts.length ? addrParts.join('\n') : 'No address on file';

    const innerTextW = cardW - cardPad * 2 - 2;

    const measureLeftH = (): number => {
        let cy = cardTop + cardPad + 1 + 4.5;
        cy += doc.splitTextToSize(pdfAscii(payload.periodLabel), innerTextW).length * 4.6;
        cy += 3 + 4.5;
        cy += doc.splitTextToSize(pdfAscii(payload.deliveryDateFormatted), innerTextW).length * 4.6;
        return cy - cardTop + cardPad + 2;
    };
    const measureRightH = (): number => {
        let cy = cardTop + cardPad + 1 + 4.5 + 6;
        cy += doc.splitTextToSize(pdfAscii(addrBlock), innerTextW).length * 4.3;
        cy += doc.splitTextToSize(pdfAscii(payload.clientPhone?.trim() || '-'), innerTextW).length * 4.4;
        return cy - cardTop + cardPad + 2;
    };

    const cardH = Math.max(34, measureLeftH(), measureRightH());

    setFill(doc, C.cardFill);
    setDraw(doc, C.cardStroke, 0.18);
    doc.rect(leftX, cardTop, cardW, cardH, 'FD');
    setFill(doc, C.accent);
    doc.rect(leftX, cardTop, 1.2, cardH, 'F');

    setFill(doc, C.cardFill);
    setDraw(doc, C.cardStroke, 0.18);
    doc.rect(rightX, cardTop, cardW, cardH, 'FD');
    setFill(doc, C.accent);
    doc.rect(rightX, cardTop, 1.2, cardH, 'F');

    let ly = cardTop + cardPad + 1;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    setText(doc, C.accent);
    doc.text('BILLING PERIOD', leftX + cardPad + 2, ly);
    ly += 4.5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    setText(doc, C.ink);
    for (const ln of doc.splitTextToSize(pdfAscii(payload.periodLabel), innerTextW)) {
        doc.text(ln, leftX + cardPad + 2, ly);
        ly += 4.6;
    }
    ly += 3;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    setText(doc, C.accent);
    doc.text('DELIVERY DATE', leftX + cardPad + 2, ly);
    ly += 4.5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    for (const ln of doc.splitTextToSize(pdfAscii(payload.deliveryDateFormatted), innerTextW)) {
        doc.text(ln, leftX + cardPad + 2, ly);
        ly += 4.6;
    }

    let ry = cardTop + cardPad + 1;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    setText(doc, C.accent);
    doc.text('DELIVERY ADDRESS', rightX + cardPad + 2, ry);
    ry += 4.5;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    setText(doc, C.ink);
    doc.text(pdfAscii(payload.clientName), rightX + cardPad + 2, ry);
    ry += 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    setText(doc, C.inkMuted);
    for (const ln of doc.splitTextToSize(pdfAscii(addrBlock), innerTextW)) {
        doc.text(ln, rightX + cardPad + 2, ry);
        ry += 4.3;
    }
    doc.setFontSize(9.5);
    setText(doc, C.ink);
    for (const ln of doc.splitTextToSize(pdfAscii(payload.clientPhone?.trim() || '-'), innerTextW)) {
        doc.text(ln, rightX + cardPad + 2, ry);
        ry += 4.4;
    }

    y = cardTop + cardH + 9;

    if (payload.warnings.length > 0) {
        setFill(doc, [254, 252, 232]);
        setDraw(doc, [250, 204, 21], 0.15);
        const wt = doc.splitTextToSize(pdfAscii(payload.warnings.join(' ')), contentW - 8);
        const wh = wt.length * 4.2 + 8;
        doc.rect(m, y, contentW, wh, 'FD');
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        setText(doc, [113, 63, 18]);
        let wy = y + 5.5;
        for (const line of wt) {
            doc.text(line, m + 4, wy);
            wy += 4.2;
        }
        y += wh + 6;
    }

    // --- Line items table ---
    const tableLeft = m;
    const tableRight = m + contentW;
    const xV = {
        v0: tableLeft,
        v1: tableLeft + 12,
        v2: tableLeft + 96,
        v3: tableLeft + 136,
        v4: tableLeft + 156,
        v5: tableRight,
    };
    const headerH = 9;
    const bodyRowH = 8.5;
    const padRowH = 4.1;
    const padCount = 22;
    const totalRowH = 10;
    const tableTop = y;
    let rowTop = tableTop;

    setFill(doc, C.tableHead);
    doc.rect(xV.v0, rowTop, xV.v5 - xV.v0, headerH, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    setText(doc, C.tableHeadText);
    const hb = rowTop + 6.2;
    doc.text('#', xV.v1 - 1, hb, { align: 'right' });
    doc.text('ITEM', xV.v1 + 2, hb);
    doc.text('UNIT PRICE', xV.v3 - 1, hb, { align: 'right' });
    doc.text('QTY', xV.v4 - 1, hb, { align: 'right' });
    doc.text('TOTAL', xV.v5 - 2, hb, { align: 'right' });
    rowTop += headerH;

    const rule = (yLine: number, rgb = C.lineSubtle, lw = 0.12) => {
        setDraw(doc, rgb, lw);
        doc.line(xV.v0, yLine, xV.v5, yLine);
    };

    const fixedLine = payload.invoiceFixedLine;
    const bodyBaseline = rowTop + 5.5;
    setFill(doc, [255, 255, 255]);
    doc.rect(xV.v0, rowTop, xV.v5 - xV.v0, bodyRowH, 'F');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    setText(doc, C.ink);
    doc.text('1', xV.v1 - 1, bodyBaseline, { align: 'right' });
    doc.text(pdfAscii(fixedLine.description), xV.v1 + 2, bodyBaseline);
    doc.text(formatInvoiceMoney(fixedLine.unitPriceUsd), xV.v3 - 1, bodyBaseline, { align: 'right' });
    doc.text(String(fixedLine.quantity), xV.v4 - 1, bodyBaseline, { align: 'right' });
    doc.text(formatInvoiceMoney(fixedLine.lineTotalUsd), xV.v5 - 2, bodyBaseline, { align: 'right' });
    rowTop += bodyRowH;
    rule(rowTop);

    for (let i = 0; i < padCount; i++) {
        const fill = i % 2 === 0 ? [255, 255, 255] as [number, number, number] : C.rowAlt;
        setFill(doc, fill);
        doc.rect(xV.v0, rowTop, xV.v5 - xV.v0, padRowH, 'F');
        rowTop += padRowH;
        rule(rowTop);
    }

    setDraw(doc, C.accent, 0.35);
    doc.line(xV.v0, rowTop, xV.v5, rowTop);
    rowTop += 1.5;
    setFill(doc, C.totalBg);
    doc.rect(xV.v0, rowTop, xV.v5 - xV.v0, totalRowH, 'F');
    const totalBaseline = rowTop + 6;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    setText(doc, C.ink);
    doc.text('Invoice total', xV.v3 - 1, totalBaseline, { align: 'right' });
    doc.text(formatInvoiceMoney(fixedLine.lineTotalUsd), xV.v5 - 2, totalBaseline, { align: 'right' });
    rowTop += totalRowH;
    rule(rowTop, C.cardStroke, 0.25);

    const tableBottom = rowTop;
    setDraw(doc, C.cardStroke, 0.25);
    doc.rect(xV.v0, tableTop, xV.v5 - xV.v0, tableBottom - tableTop, 'S');
    setDraw(doc, C.lineSubtle, 0.1);
    for (const xv of [xV.v1, xV.v2, xV.v3, xV.v4]) {
        doc.line(xv, tableTop + headerH, xv, tableBottom);
    }

    // --- Footer gradient (draw on top of reserved area) ---
    const footerY0 = pageH - FOOTER_BAND;
    fillGradientV(doc, 0, footerY0, pageW, FOOTER_BAND, C.gradFooterTop, C.gradFooterBot, 48);
    setDraw(doc, C.lineSubtle, 0.12);
    doc.line(0, footerY0, pageW, footerY0);

    const taglineLines = doc.splitTextToSize(pdfAscii(footerLine), contentW);
    const contactLines = doc.splitTextToSize(pdfAscii(invoiceOrgContactOneLine()), contentW);
    const lineHt = 4.4;
    const blockH = taglineLines.length * lineHt + contactLines.length * 3.9 + 5;
    let fy = footerY0 + (FOOTER_BAND - blockH) / 2 + 3;

    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    setText(doc, C.accent);
    for (const ln of taglineLines) {
        doc.text(ln, pageW / 2, fy, { align: 'center' });
        fy += lineHt;
    }
    fy += 1;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    setText(doc, C.accentSoft);
    for (const ln of contactLines) {
        doc.text(ln, pageW / 2, fy, { align: 'center' });
        fy += 3.9;
    }

    const buf = doc.output('arraybuffer');
    return new Uint8Array(buf);
}
