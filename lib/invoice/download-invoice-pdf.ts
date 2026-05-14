/**
 * Rasterize a DOM node (A4-style invoice) to a single portrait PDF page.
 */

function sanitizeFilenameBase(name: string): string {
    const trimmed = name.trim().slice(0, 80);
    const safe = trimmed.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
    return safe || 'invoice';
}

/**
 * Captures `element` with html2canvas and fits the image onto one A4 page in jsPDF.
 */
export async function downloadInvoicePdfFromElement(element: HTMLElement, filenameBase: string): Promise<void> {
    const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);

    const canvas = await html2canvas(element, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
        windowWidth: element.scrollWidth,
        windowHeight: element.scrollHeight,
    });

    const imgData = canvas.toDataURL('image/png', 1.0);
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    /** Small margin so the raster uses almost the full A4 sheet (width + height). */
    const marginMm = 5;
    const maxW = pageW - marginMm * 2;
    const maxH = pageH - marginMm * 2;

    /**
     * Map the screenshot to the full printable rectangle so the PDF uses the whole page.
     * Aspect ratio may change slightly vs the on-screen preview when the canvas is much taller than wide.
     */
    const x = marginMm;
    const y = marginMm;
    pdf.addImage(imgData, 'PNG', x, y, maxW, maxH);
    pdf.save(`${sanitizeFilenameBase(filenameBase)}.pdf`);
}
