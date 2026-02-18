import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';

interface Order {
    id: string;
    orderNumber?: string;
    client_id: string;
    service_type?: string;
    items?: any[];
    boxSelection?: any;
    equipmentSelection?: any;
    notes?: string;
}

interface LabelGenerationOptions {
    orders: Order[];
    getClientName: (clientId: string) => string;
    getClientAddress: (clientId: string) => string;
    formatOrderedItemsForCSV: (order: Order) => string;
    formatDate: (dateString: string | null | undefined) => string;
    vendorName?: string;
    deliveryDate?: string;
    /** When provided, shows driver (and optional stop number) below QR (in driver color) instead of order number */
    getDriverInfo?: (order: Order) => { driverNumber: number | string; driverColor: string; stopNumber?: number } | null;
    /** When provided, displays notes after items on each label (e.g. for Labels Alt) */
    getNotes?: (clientId: string) => string;
    /** Optional suffix for the download filename (e.g. '_complex' for a separate complex-only PDF) */
    filenameSuffix?: string;
}

/** Line height factor for a given font size (inches per pt). Matches pdfRouteLabels behavior. */
const lineHeightFromFont = (pt: number) => Math.max(0.14, pt * 0.017);

/**
 * Draw notes text, shrinking font from maxFont down to minFont until it fits in the available height.
 * Same approach as inroutes (pdfRouteLabels) drawLines.
 */
function drawNotesToFit(
    doc: jsPDF,
    text: string,
    x: number,
    startY: number,
    maxWidth: number,
    maxHeight: number,
    maxFont: number = 8,
    minFont: number = 5
): void {
    const notesDisplay = `Notes: ${text}`;
    const prevSize = doc.getFontSize();
    let font = maxFont;
    let lh = lineHeightFromFont(font);
    doc.setFontSize(font);
    let splitNotes = doc.splitTextToSize(notesDisplay, maxWidth);
    let h = splitNotes.length * lh;
    while (h > maxHeight && font > minFont) {
        font -= 1;
        lh = lineHeightFromFont(font);
        doc.setFontSize(font);
        splitNotes = doc.splitTextToSize(notesDisplay, maxWidth);
        h = splitNotes.length * lh;
    }
    doc.setFontSize(font);
    let yy = startY;
    for (const ln of splitNotes) {
        if (ln) doc.text(ln, x, yy);
        yy += lh;
    }
    doc.setFontSize(prevSize);
}

export async function generateLabelsPDF(options: LabelGenerationOptions): Promise<void> {
    const {
        orders,
        getClientName,
        getClientAddress,
        formatOrderedItemsForCSV,
        formatDate,
        vendorName,
        deliveryDate,
        getDriverInfo,
        getNotes,
        filenameSuffix
    } = options;

    if (orders.length === 0) {
        alert('No orders to export');
        return;
    }

    // Avery 5163 Template Dimensions (in inches)
    // 2 columns, 5 labels per page
    const PROPS = {
        pageWidth: 8.5,
        pageHeight: 11,
        marginTop: 0.5,
        marginLeft: 0.156,
        labelWidth: 4,
        labelHeight: 2,
        hGap: 0.188,
        vGap: 0,
        fontSize: 10,
        headerSize: 12, // Slightly smaller header to fit more
        smallSize: 8,
        padding: 0.15,
    };

    const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'in',
        format: 'letter'
    });

    // Determine Base URL
    const origin = typeof window !== 'undefined' && window.location.origin ? window.location.origin : 'https://customer.thedietfantasy.com';

    for (let index = 0; index < orders.length; index++) {
        const order = orders[index];

        // Check for page break (every 10 labels)
        if (index > 0 && index % 10 === 0) {
            doc.addPage();
        }

        // Calculate position
        const posOnPage = index % 10;
        const col = posOnPage % 2;
        const row = Math.floor(posOnPage / 2);

        const labelX = PROPS.marginLeft + (col * (PROPS.labelWidth + PROPS.hGap));
        const labelY = PROPS.marginTop + (row * PROPS.labelHeight);

        // Draw Border
        doc.setLineWidth(0.01);
        doc.rect(labelX, labelY, PROPS.labelWidth, PROPS.labelHeight);

        // -- ZONES -- QR block is permanently reserved (same on every label). Rest of label is for text.
        const contentX = labelX + PROPS.padding;
        const contentY = labelY + PROPS.padding;
        const qrMargin = 0.1;
        const qrPaddingLeft = 0.12;  // extra space between text and QR
        const qrPaddingBottom = 0.1; // extra space below QR
        const qrSize = 0.85;
        const qrZoneWidth = qrSize + 2 * qrMargin + qrPaddingLeft;
        const qrZoneX = labelX + PROPS.labelWidth - qrZoneWidth - PROPS.padding;
        const driverLabelHeight = 0.22;
        const qrY = labelY + PROPS.padding + driverLabelHeight;
        const qrX = qrZoneX + qrMargin + qrPaddingLeft; // QR sits after left padding
        const qrBlockBottom = qrY + qrSize + qrMargin + qrPaddingBottom;
        // QR block = [qrZoneX, labelY] to [labelX+labelWidth, qrBlockBottom]. Nothing draws here.

        // Boundary line: text must not cross this x. Same rule for all label text left of QR.
        const textRightEdge = qrZoneX - 0.2;
        const textZoneMax = textRightEdge - contentX;
        // Use only this width for any text left of QR so it never crosses the line (conservative factor)
        const textZoneWidth = Math.max(0.5, textZoneMax * 0.58);

        // Right edge of label: Phase 2 (below QR) must not go past end of label
        const labelRightEdge = labelX + PROPS.labelWidth - PROPS.padding - 0.1;
        const phase2MaxWidth = Math.max(0.5, (labelRightEdge - contentX) * 0.58);

        const labelBottom = labelY + PROPS.labelHeight - PROPS.padding;
        const labelBottomSafe = labelBottom - 0.06;
        // Phase 1: left column only; stop with margin above bottom of QR block
        const maxYPhase1 = qrBlockBottom - 0.08;
        // Below QR: continuation items + notes (when present)
        const phase2StartY = qrBlockBottom + 0.05;
        const lineHeight = 0.14;
        const phase2LineHeight = 0.12; // tighter so more continuation items fit (use with smaller font below)
        const headerLineHeight = 0.2;
        const addressLineHeight = 0.16;

        // Draw boundary line: text does not cross this (same as labels)
        doc.setDrawColor(180, 180, 180);
        doc.setLineWidth(0.006);
        doc.line(textRightEdge, labelY, textRightEdge, maxYPhase1);

        // Driver color for all text (when getDriverInfo provided)
        const driverInfo = getDriverInfo?.(order);
        const setDriverColor = () => {
            if (driverInfo?.driverColor) {
                const hex = driverInfo.driverColor.replace('#', '');
                const r = parseInt(hex.slice(0, 2), 16) || 0;
                const g = parseInt(hex.slice(2, 4), 16) || 0;
                const b = parseInt(hex.slice(4, 6), 16) || 0;
                doc.setTextColor(r, g, b);
            } else {
                doc.setTextColor(0, 0, 0);
            }
        };
        const resetColor = () => doc.setTextColor(0, 0, 0);

        // Helper: clamp so (startY + numLines * lineH) <= maxY
        const maxLinesThatFit = (startY: number, maxY: number, lineH: number) =>
            Math.max(0, Math.floor((maxY - startY) / lineH));

        let currentY = contentY + 0.15; // Start Y (must stay <= labelBottom)

        // 1. Client Name (Bold) — splitTextToSize so lines stay left of hard line
        doc.setFontSize(PROPS.headerSize);
        doc.setFont('helvetica', 'bold');
        setDriverColor();
        const clientName = getClientName(order.client_id).toUpperCase();
        const splitName = doc.splitTextToSize(clientName, textZoneWidth);
        const nameLinesToShow = Math.min(splitName.length, maxLinesThatFit(currentY, maxYPhase1, headerLineHeight));
        if (nameLinesToShow > 0) {
            const nameLines = splitName.slice(0, nameLinesToShow);
            doc.text(nameLines, contentX, currentY);
            currentY += nameLines.length * headerLineHeight;
        }

        // 2. Address (Normal) — splitTextToSize so lines stay left of hard line
        doc.setFontSize(PROPS.fontSize);
        doc.setFont('helvetica', 'normal');
        setDriverColor();
        const address = getClientAddress(order.client_id);
        if (address && address !== '-') {
            const splitAddress = doc.splitTextToSize(address, textZoneWidth);
            const addrLinesToShow = Math.min(splitAddress.length, maxLinesThatFit(currentY + 0.05, maxYPhase1, addressLineHeight));
            if (addrLinesToShow > 0) {
                const addrLines = splitAddress.slice(0, addrLinesToShow);
                doc.text(addrLines, contentX, currentY + 0.05);
                currentY += 0.05 + addrLines.length * addressLineHeight + 0.08;
            } else {
                currentY += 0.05;
            }
        } else {
            currentY += 0.1;
        }
        currentY = Math.min(currentY, maxYPhase1); // never go past QR block in phase 1

        // 3. Ordered Items — phase 1: left of QR (strictly above qrBlockBottom); phase 2: below QR (strictly above labelBottom)
        doc.setFontSize(PROPS.smallSize);
        setDriverColor();
        const itemsText = formatOrderedItemsForCSV(order).split('; ').join(' | ');
        const itemsDisplay = itemsText || 'No items';

        const remainingHeight1 = maxYPhase1 - currentY;
        let restItems: string | null = null;
        if (remainingHeight1 > 0.2) {
            const splitItems1 = doc.splitTextToSize(itemsDisplay, textZoneWidth);
            const maxLines1 = maxLinesThatFit(currentY, maxYPhase1, lineHeight);
            const linesPhase1 = splitItems1.slice(0, maxLines1);

            if (linesPhase1.length > 0) {
                doc.text(linesPhase1, contentX, currentY);
                currentY += linesPhase1.length * lineHeight + 0.06;
                if (splitItems1.length > maxLines1) {
                    restItems = splitItems1.slice(maxLines1).join(' ');
                }
            }
            currentY = Math.min(currentY, maxYPhase1);
        }

        // Below QR: continuation items (if any), then notes (when present)
        const phase2AvailableHeight = labelBottomSafe - phase2StartY;
        const notesText = getNotes?.(order.client_id)?.trim() ?? '';
        const hasNotes = notesText.length > 0;
        let phase2Y = phase2StartY;

        if (restItems && phase2AvailableHeight > phase2LineHeight) {
            doc.setFontSize(PROPS.smallSize - 1); // 7pt so more lines fit below QR
            const splitItems2 = doc.splitTextToSize(restItems, phase2MaxWidth);
            const reservedForNotes = hasNotes ? phase2LineHeight * 2.5 : 0;
            const maxLines2 = maxLinesThatFit(phase2StartY, labelBottomSafe - reservedForNotes, phase2LineHeight);
            const linesPhase2 = splitItems2.slice(0, maxLines2);
            if (linesPhase2.length > 0) {
                doc.text(linesPhase2, contentX, phase2Y);
                phase2Y += linesPhase2.length * phase2LineHeight + 0.04;
            }
            doc.setFontSize(PROPS.smallSize);
        }

        if (hasNotes && phase2Y + phase2LineHeight <= labelBottomSafe) {
            setDriverColor();
            const notesMaxHeight = labelBottomSafe - phase2Y;
            drawNotesToFit(doc, notesText, contentX, phase2Y, phase2MaxWidth, notesMaxHeight, PROPS.smallSize);
        } else if (hasNotes && !restItems && phase2AvailableHeight > phase2LineHeight) {
            setDriverColor();
            const notesMaxHeight = labelBottomSafe - phase2StartY;
            drawNotesToFit(doc, notesText, contentX, phase2StartY, phase2MaxWidth, notesMaxHeight, PROPS.smallSize);
        }
        resetColor();

        // 4. Driver number above QR, then QR (top-right with margin)
        try {
            const produceUrl = `${origin}/produce/${order.client_id}`;
            const driverOrOrderText = driverInfo
                ? (driverInfo.stopNumber != null
                    ? `${driverInfo.driverNumber}.${driverInfo.stopNumber}`
                    : String(driverInfo.driverNumber))
                : `#${order.orderNumber || order.id.slice(0, 6)}`;

            // Driver number on top of QR (centered in QR zone)
            doc.setFontSize(10);
            doc.setFont('helvetica', 'bold');
            setDriverColor();
            doc.text(driverOrOrderText, qrZoneX + qrZoneWidth / 2, labelY + PROPS.padding + 0.12, { align: 'center' });
            resetColor();

            const qrDataUrl = await QRCode.toDataURL(produceUrl, {
                errorCorrectionLevel: 'M',
                margin: 0,
                width: 280
            });
            doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize);
        } catch (e) {
            console.error("QR generation failed", e);
            doc.text("Error", qrZoneX, labelY + 1);
        }
    }

    // Generate filename (sanitize so browser uses it instead of "unnamed")
    let filename = `${vendorName || 'vendor'}_labels`;
    if (deliveryDate) {
        const formattedDate = formatDate(deliveryDate).replace(/\s/g, '_').replace(/[/\\:*?"<>|]/g, '_');
        filename += `_${formattedDate}`;
    }
    filename += (filenameSuffix ?? '') + '.pdf';

    const blob = doc.output('blob');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

/**
 * Generate labels PDF where each customer gets one row: left label (name, address, QR, notes) and right label (name, driver #, stop #, full order details).
 * Uses same Avery 5163 layout: 2 columns × 5 rows per page; each row = one customer with two labels.
 */
export async function generateLabelsPDFTwoPerCustomer(options: LabelGenerationOptions): Promise<void> {
    const {
        orders,
        getClientName,
        getClientAddress,
        formatOrderedItemsForCSV,
        formatDate,
        vendorName,
        deliveryDate,
        getDriverInfo,
        getNotes
    } = options;

    if (orders.length === 0) {
        alert('No orders to export');
        return;
    }

    const PROPS = {
        pageWidth: 8.5,
        pageHeight: 11,
        marginTop: 0.5,
        marginLeft: 0.156,
        labelWidth: 4,
        labelHeight: 2,
        hGap: 0.188,
        vGap: 0,
        fontSize: 10,
        headerSize: 12,
        smallSize: 8,
        padding: 0.15,
    };

    const doc = new jsPDF({ orientation: 'portrait', unit: 'in', format: 'letter' });
    const origin = typeof window !== 'undefined' && window.location.origin ? window.location.origin : 'https://customer.thedietfantasy.com';

    const lineHeight = 0.14;
    const headerLineHeight = 0.2;
    const addressLineHeight = 0.16;
    const phase2LineHeight = 0.12;
    const qrSize = 0.85;
    const qrMargin = 0.1;
    const qrPaddingLeft = 0.12;
    const qrPaddingBottom = 0.1;
    const qrZoneWidth = qrSize + 2 * qrMargin + qrPaddingLeft;
    const driverLabelHeight = 0.22;

    for (let index = 0; index < orders.length; index++) {
        const order = orders[index];
        const rowOnPage = index % 5;
        if (index > 0 && rowOnPage === 0) {
            doc.addPage();
        }

        const labelY = PROPS.marginTop + (rowOnPage * PROPS.labelHeight);
        const labelBottom = labelY + PROPS.labelHeight - PROPS.padding;
        const labelBottomSafe = labelBottom - 0.06;

        // ---- LEFT LABEL: name, address, QR code, notes ----
        const leftX = PROPS.marginLeft;
        doc.setLineWidth(0.01);
        doc.rect(leftX, labelY, PROPS.labelWidth, PROPS.labelHeight);

        const leftContentX = leftX + PROPS.padding;
        const leftContentY = labelY + PROPS.padding;
        const textRightEdge = leftX + PROPS.labelWidth - qrZoneWidth - PROPS.padding - 0.2;
        const textZoneWidth = Math.max(0.5, (textRightEdge - leftContentX) * 0.58);
        const qrZoneX = leftX + PROPS.labelWidth - qrZoneWidth - PROPS.padding;
        const qrY = labelY + PROPS.padding + driverLabelHeight;
        const qrX = qrZoneX + qrMargin + qrPaddingLeft;
        const qrBlockBottom = qrY + qrSize + qrMargin + qrPaddingBottom;
        const maxYPhase1 = qrBlockBottom - 0.08;
        const phase2StartY = qrBlockBottom + 0.05;
        const phase2MaxWidth = Math.max(0.5, (leftX + PROPS.labelWidth - PROPS.padding - 0.1 - leftContentX) * 0.58);

        const driverInfo = getDriverInfo?.(order);
        const setDriverColor = () => {
            if (driverInfo?.driverColor) {
                const hex = driverInfo.driverColor.replace('#', '');
                const r = parseInt(hex.slice(0, 2), 16) || 0;
                const g = parseInt(hex.slice(2, 4), 16) || 0;
                const b = parseInt(hex.slice(4, 6), 16) || 0;
                doc.setTextColor(r, g, b);
            } else {
                doc.setTextColor(0, 0, 0);
            }
        };
        const resetColor = () => doc.setTextColor(0, 0, 0);

        let currentY = leftContentY + 0.15;

        // Left: Name only (no driver/stop or order number on left label)
        doc.setFontSize(PROPS.headerSize);
        doc.setFont('helvetica', 'bold');
        setDriverColor();
        const clientName = getClientName(order.client_id).toUpperCase();
        const splitName = doc.splitTextToSize(clientName, textZoneWidth);
        const nameLines = splitName.slice(0, Math.min(splitName.length, Math.max(0, Math.floor((maxYPhase1 - currentY) / headerLineHeight))));
        if (nameLines.length > 0) {
            doc.text(nameLines, leftContentX, currentY);
            currentY += nameLines.length * headerLineHeight;
        }

        // Left: Address
        doc.setFontSize(PROPS.fontSize);
        doc.setFont('helvetica', 'normal');
        setDriverColor();
        const address = getClientAddress(order.client_id);
        if (address && address !== '-') {
            const splitAddress = doc.splitTextToSize(address, textZoneWidth);
            const addrLines = splitAddress.slice(0, Math.min(splitAddress.length, Math.max(0, Math.floor((maxYPhase1 - currentY - 0.05) / addressLineHeight))));
            if (addrLines.length > 0) {
                doc.text(addrLines, leftContentX, currentY + 0.05);
                currentY += 0.05 + addrLines.length * addressLineHeight + 0.08;
            }
        }
        currentY = Math.min(currentY, maxYPhase1);

        // Left: Notes below QR area (shrink font to fit like inroutes labels)
        const notesText = (getNotes?.(order.client_id) ?? '').trim();
        if (notesText && currentY < labelBottomSafe) {
            const notesY = Math.max(phase2StartY, currentY + 0.1);
            const notesMaxHeight = labelBottomSafe - notesY;
            setDriverColor();
            drawNotesToFit(doc, notesText, leftContentX, notesY, phase2MaxWidth, notesMaxHeight, PROPS.smallSize);
        }
        resetColor();

        // Left: Above QR show "0.1" (driver.stop) or order number only
        try {
            const produceUrl = `${origin}/produce/${order.client_id}`;
            const driverOrOrderText = driverInfo
                ? (driverInfo.stopNumber != null ? `${driverInfo.driverNumber}.${driverInfo.stopNumber}` : String(driverInfo.driverNumber))
                : `#${order.orderNumber || order.id.slice(0, 6)}`;
            doc.setFontSize(10);
            doc.setFont('helvetica', 'bold');
            setDriverColor();
            doc.text(driverOrOrderText, qrZoneX + qrZoneWidth / 2, labelY + PROPS.padding + 0.12, { align: 'center' });
            resetColor();
            const qrDataUrl = await QRCode.toDataURL(produceUrl, { errorCorrectionLevel: 'M', margin: 0, width: 280 });
            doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize);
        } catch (e) {
            console.error('QR generation failed', e);
            doc.text('Error', qrZoneX, labelY + 1);
        }

        // ---- RIGHT LABEL: name, driver #, stop #, full order details ----
        const rightX = PROPS.marginLeft + PROPS.labelWidth + PROPS.hGap;
        doc.setLineWidth(0.01);
        doc.rect(rightX, labelY, PROPS.labelWidth, PROPS.labelHeight);

        const rightContentX = rightX + PROPS.padding;
        const rightContentY = labelY + PROPS.padding;
        // Keep text well inside right label (same conservative factor as left so it doesn't go past edge)
        const rightTextEdge = rightX + PROPS.labelWidth - PROPS.padding - 0.2;
        const rightTextZoneWidth = Math.max(0.5, (rightTextEdge - rightContentX) * 0.58);

        let rightY = rightContentY + 0.1;

        // Right: Name + "0.1" + order number on one line (no separate "Driver 0 – Stop 1" line)
        doc.setFontSize(PROPS.headerSize);
        doc.setFont('helvetica', 'bold');
        setDriverColor();
        const rightDriverStopSuffix = driverInfo != null && driverInfo.stopNumber != null
            ? ` ${driverInfo.driverNumber}.${driverInfo.stopNumber}`
            : driverInfo != null
                ? ` ${driverInfo.driverNumber}`
                : '';
        const rightOrderNumSuffix = ` #${order.orderNumber || order.id.slice(0, 6)}`;
        const rightNameLine1 = clientName + rightDriverStopSuffix + rightOrderNumSuffix;
        const rightNameLines = doc.splitTextToSize(rightNameLine1, rightTextZoneWidth);
        const rightNameShow = rightNameLines.slice(0, Math.min(2, rightNameLines.length));
        if (rightNameShow.length > 0) {
            doc.text(rightNameShow, rightContentX, rightY);
            rightY += rightNameShow.length * headerLineHeight + 0.05;
        }

        // Right: Full order details (items) — respect label bottom
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(PROPS.smallSize);
        setDriverColor();
        const itemsText = formatOrderedItemsForCSV(order).split('; ').join(' | ') || 'No items';
        const splitItems = doc.splitTextToSize(itemsText, rightTextZoneWidth);
        const maxLines = Math.max(0, Math.floor((labelBottomSafe - rightY) / phase2LineHeight));
        const linesToShow = splitItems.slice(0, maxLines);
        if (linesToShow.length > 0) {
            doc.text(linesToShow, rightContentX, rightY);
        }
        resetColor();
    }

    let filename = `${vendorName || 'vendor'}_labels_two_per_customer`;
    if (deliveryDate) {
        const formattedDate = formatDate(deliveryDate).replace(/\s/g, '_').replace(/[/\\:*?"<>|]/g, '_');
        filename += `_${formattedDate}`;
    }
    filename += '.pdf';

    const blob = doc.output('blob');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

/** Render a grid (e.g. Breakdown or Cooking list) as a PDF table and trigger download */
export function generateTablePDF(options: {
    title: string;
    rows: string[][];
    filename: string;
    columnWidths?: number[]; // in % of page width (excluding margins), or equal if not provided
    /** If row's first cell equals this, draw a horizontal line instead of text (e.g. "---") */
    lineRowMarker?: string;
    /** If first column cell equals this, draw an empty checkbox (square) instead of text */
    checkboxMarker?: string;
}): void {
    const { title, rows, filename: baseFilename, columnWidths, lineRowMarker, checkboxMarker } = options;
    if (!rows || rows.length === 0) {
        alert('No data to export');
        return;
    }

    const doc = new jsPDF({ orientation: 'portrait', unit: 'in', format: 'letter' });
    const margin = 0.5;
    const pageWidth = 8.5;
    const pageHeight = 11;
    const contentWidth = pageWidth - 2 * margin;
    const fontSize = 9;
    const headerFontSize = 11;
    const lineHeight = 0.2;
    const cellPadding = 0.05;
    const checkboxSize = 0.14;

    doc.setFontSize(headerFontSize);
    doc.setFont('helvetica', 'bold');
    doc.text(title, margin, margin + 0.3);
    let y = margin + 0.55;

    const cols = rows[0]?.length ?? 0;
    const widths = columnWidths && columnWidths.length === cols
        ? columnWidths.map(p => (p / 100) * contentWidth)
        : Array(cols).fill(contentWidth / cols);

    const maxY = pageHeight - margin;

    for (let r = 0; r < rows.length; r++) {
        const row = rows[r];
        if (!row || row.length === 0) {
            y += lineHeight * 0.5;
            continue;
        }
        if (y > maxY - lineHeight) {
            doc.addPage();
            y = margin;
        }

        // Line row: draw horizontal rule between client blocks
        if (lineRowMarker && row[0] === lineRowMarker) {
            doc.setDrawColor(180, 180, 180);
            doc.setLineWidth(0.01);
            doc.line(margin, y + lineHeight / 2, margin + contentWidth, y + lineHeight / 2);
            y += lineHeight + cellPadding;
            continue;
        }

        const isHeader = r === 0 || (row[1] === 'Item Name' && row[2] === 'Quantity');
        doc.setFont('helvetica', isHeader ? 'bold' : 'normal');
        doc.setFontSize(fontSize);

        let rowHeight = lineHeight;
        const cellSplits: string[][] = [];
        for (let c = 0; c < row.length; c++) {
            const cellText = String(row[c] ?? '');
            const isCheckboxCell = c === 0 && checkboxMarker && cellText === checkboxMarker;
            if (isCheckboxCell) {
                cellSplits.push([]);
                const h = checkboxSize + 0.02;
                if (h > rowHeight) rowHeight = h;
            } else {
                const w = widths[c] ?? contentWidth / cols;
                const split = doc.splitTextToSize(cellText, Math.max(w - cellPadding * 2, 0.1));
                cellSplits.push(split);
                const h = split.length * lineHeight;
                if (h > rowHeight) rowHeight = h;
            }
        }
        for (let c = 0; c < row.length; c++) {
            const x = margin + widths.slice(0, c).reduce((a, b) => a + b, 0);
            const w = widths[c] ?? contentWidth / cols;
            const isCheckboxCell = c === 0 && checkboxMarker && String(row[c] ?? '') === checkboxMarker;
            if (isCheckboxCell) {
                const boxX = x + cellPadding;
                const boxY = y + (rowHeight - checkboxSize) / 2;
                doc.setDrawColor(0, 0, 0);
                doc.setLineWidth(0.01);
                doc.rect(boxX, boxY, checkboxSize, checkboxSize);
            } else {
                const lines = cellSplits[c];
                for (let L = 0; L < lines.length; L++) {
                    doc.text(lines[L], x + cellPadding, y + lineHeight - 0.02 + L * lineHeight);
                }
            }
        }
        y += rowHeight + cellPadding;
    }

    const filename = baseFilename.endsWith('.pdf') ? baseFilename : `${baseFilename}.pdf`;
    const blob = doc.output('blob');
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}







