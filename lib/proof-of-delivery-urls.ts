/**
 * Helpers for orders.proof_of_delivery_urls (JSONB string[]) and legacy proof_of_delivery_url.
 */

export function normalizeProofUrlsFromDb(raw: unknown): string[] {
    if (raw == null) return [];
    if (Array.isArray(raw)) {
        return raw
            .filter((u): u is string => typeof u === 'string' && u.trim() !== '')
            .map((u) => u.trim());
    }
    if (typeof raw === 'string') {
        try {
            const p = JSON.parse(raw) as unknown;
            if (Array.isArray(p)) return normalizeProofUrlsFromDb(p);
        } catch {
            /* ignore */
        }
    }
    return [];
}

export type OrderProofRow = {
    proof_of_delivery_urls?: unknown;
    proof_of_delivery_url?: string | null;
    /** Present only on old DBs before migrate-proof-of-delivery-urls.sql */
    proof_of_delivery_image?: string | null;
};

/** All proof URLs for an order row (new JSON column, then legacy fallbacks). */
export function orderRowProofUrls(row: OrderProofRow): string[] {
    const fromJson = normalizeProofUrlsFromDb(row.proof_of_delivery_urls);
    if (fromJson.length > 0) return fromJson;
    const out: string[] = [];
    const one = row.proof_of_delivery_url?.trim();
    const two = row.proof_of_delivery_image?.trim();
    if (one) out.push(one);
    if (two) out.push(two);
    return out;
}

export function primaryProofUrl(row: OrderProofRow): string {
    return orderRowProofUrls(row)[0] ?? '';
}

export function hasAnyProofUrl(row: OrderProofRow): boolean {
    return orderRowProofUrls(row).length > 0;
}

/** Payload for Supabase insert/update (JSONB array + legacy first URL). */
export function proofPayloadForDb(urls: string[]): {
    proof_of_delivery_urls: string[];
    proof_of_delivery_url: string | null;
} {
    const clean = urls.map((u) => String(u).trim()).filter(Boolean);
    return {
        proof_of_delivery_urls: clean,
        proof_of_delivery_url: clean[0] ?? null
    };
}

/**
 * Minimal FormData shape used by proof uploads. Structural typing avoids collisions between
 * Web `Request.formData()` and `@types/node` FormData during `next build`.
 */
export type ProofUploadFormData = {
    get(name: string): FormDataEntryValue | null;
    getAll(name: string): FormDataEntryValue[];
};

/** Read image files from FormData: repeated key "files", plus legacy single "file". */
export function collectImageFilesFromFormData(formData: ProofUploadFormData): File[] {
    const multi = formData.getAll('files');
    const out: File[] = [];
    for (const entry of multi) {
        if (entry && typeof entry === 'object' && 'size' in entry && (entry as File).size > 0) {
            out.push(entry as File);
        }
    }
    if (out.length > 0) return out;
    const single = formData.get('file');
    if (single && typeof single === 'object' && 'size' in single && (single as File).size > 0) {
        return [single as File];
    }
    return [];
}
