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
}

export async function generateLabelsPDF(options: LabelGenerationOptions): Promise<void> {
    const {
        orders,
        getClientName,
        getClientAddress,
        formatOrderedItemsForCSV,
        formatDate,
        vendorName,
        deliveryDate
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
        // Split layout
        qrZoneWidth: 1.3, // Reserved right side width
    };

    const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'in',
        format: 'letter'
    });

    // Determine Base URL
    const origin = typeof window !== 'undefined' && window.location.origin ? window.location.origin : 'https://vercatryx-triangle.vercel.app';

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

        // -- ZONES --
        const contentX = labelX + PROPS.padding;
        const contentY = labelY + PROPS.padding;
        // Left Zone Width (Total - QR Zone - Padding)
        const textZoneWidth = PROPS.labelWidth - PROPS.qrZoneWidth - (PROPS.padding * 2);

        // Right Zone (QR)
        const qrZoneX = labelX + PROPS.labelWidth - PROPS.qrZoneWidth - PROPS.padding;

        let currentY = contentY + 0.15; // Start Y

        // 1. Client Name (Bold)
        doc.setFontSize(PROPS.headerSize);
        doc.setFont('helvetica', 'bold');
        const clientName = getClientName(order.client_id).toUpperCase();

        // Wrap text
        const splitName = doc.splitTextToSize(clientName, textZoneWidth);
        doc.text(splitName, contentX, currentY);

        // Increment Y based on lines used
        currentY += (splitName.length * 0.2);

        // 2. Address (Normal)
        doc.setFontSize(PROPS.fontSize);
        doc.setFont('helvetica', 'normal');
        const address = getClientAddress(order.client_id);

        if (address && address !== '-') {
            const splitAddress = doc.splitTextToSize(address, textZoneWidth);
            doc.text(splitAddress, contentX, currentY);
            currentY += (splitAddress.length * 0.16) + 0.1; // Add extra gap after address
        } else {
            currentY += 0.1;
        }

        // 3. Ordered Items
        doc.setFontSize(PROPS.smallSize);
        // Process items string: replace ; with |
        const itemsText = formatOrderedItemsForCSV(order).split('; ').join(' | ');
        const itemsDisplay = itemsText || 'No items';

        // Calculate remaining height for text
        const maxY = labelY + PROPS.labelHeight - PROPS.padding;
        const remainingHeight = maxY - currentY;

        if (remainingHeight > 0.2) {
            const splitItems = doc.splitTextToSize(itemsDisplay, textZoneWidth);

            // Check if it fits, otherwise simple truncation (no fancy ellipsing for multi-line block for now)
            // jsPDF overflow handling is manual.
            const lineHeight = 0.14;
            const maxLines = Math.floor(remainingHeight / lineHeight);

            if (splitItems.length > maxLines) {
                const visible = splitItems.slice(0, maxLines);
                // Add ... to last visible line
                if (visible.length > 0) {
                    const last = visible[visible.length - 1];
                    visible[visible.length - 1] = last.substring(0, last.length - 3) + '...';
                }
                doc.text(visible, contentX, currentY);
            } else {
                doc.text(splitItems, contentX, currentY);
            }
        }


        // 4. QR Code & ID (Right Side - Vertical Center)
        try {
            // Use client ID to link to produce page
            const produceUrl = `${origin}/produce/${order.client_id}`;

            const qrSize = 1.1;
            // Center in the reserved zone
            const qrX = qrZoneX + ((PROPS.qrZoneWidth - qrSize) / 2);

            // Vertically center in label
            const qrY = labelY + ((PROPS.labelHeight - qrSize) / 2) - 0.1;

            const qrDataUrl = await QRCode.toDataURL(produceUrl, {
                errorCorrectionLevel: 'M',
                margin: 0,
                width: 300
            });

            doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize);

            // Order Number below QR
            const orderNum = order.orderNumber || order.id.slice(0, 6);
            doc.setFontSize(10);
            doc.setFont('helvetica', 'bold');
            doc.text(`#${orderNum}`, qrX + (qrSize / 2), qrY + qrSize + 0.15, { align: 'center' });

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







