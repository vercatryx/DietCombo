/**
 * Webcam screenshots start as huge JPEG data URLs. Mobile Safari often paints blank <img>
 * for those; blob: URLs render reliably.
 *
 * On submit, iOS Safari has been observed to return empty/incorrect bodies from fetch(blobUrl).
 * Keep the Blob from capture and build Files directly for upload.
 */

export type ProofShot = {
    blob: Blob;
    previewUrl: string;
};

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

export async function blobFromScreenshotDataUrl(dataUrl: string): Promise<Blob | null> {
    try {
        const res = await fetch(dataUrl);
        const blob = await res.blob();
        return blob.size > 0 ? blob : null;
    } catch {
        return null;
    }
}

/** One JPEG blob + preview URL + timestamp for proof flows. */
export async function proofShotFromScreenshot(dataUrl: string): Promise<ProofShot | null> {
    const blob = await blobFromScreenshotDataUrl(dataUrl);
    if (!blob) return null;
    return {
        blob,
        previewUrl: URL.createObjectURL(blob),
    };
}
