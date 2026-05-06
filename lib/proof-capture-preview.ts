/**
 * Webcam screenshots are stored as huge JPEG data URLs. Mobile Safari often paints
 * blank <img> boxes for those; blob: URLs render reliably and still work with fetch() for upload.
 */

export function revokeProofPreviewUrl(url: string | undefined | null): void {
    if (url && url.startsWith('blob:')) {
        try {
            URL.revokeObjectURL(url);
        } catch {
            /* ignore */
        }
    }
}

export function revokeProofPreviewUrls(urls: readonly string[]): void {
    for (const u of urls) revokeProofPreviewUrl(u);
}

/** Prefer blob URL for preview; falls back to the data URL if conversion fails. */
export async function previewUrlFromScreenshotDataUrl(dataUrl: string): Promise<string> {
    try {
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        if (!blob.size) return dataUrl;
        return URL.createObjectURL(blob);
    } catch {
        return dataUrl;
    }
}
