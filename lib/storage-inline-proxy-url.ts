/**
 * Same-origin URLs for displaying R2/storage images in <img>.
 * Mobile Safari often fails to render cross-origin proof URLs while desktop works;
 * proxying through /api/storage-proxy avoids that class of failures.
 */

export function allowedStorageHosts(): Set<string> {
    const hosts = new Set<string>(['storage.thedietfantasy.com']);
    for (const raw of [process.env.NEXT_PUBLIC_R2_DOMAIN, process.env.R2_PUBLIC_URL_BASE]) {
        if (!raw?.trim()) continue;
        try {
            const u = new URL(raw.trim());
            hosts.add(u.hostname);
        } catch {
            /* ignore invalid env */
        }
    }
    return hosts;
}

/** Returns a same-origin proxy URL for allowed https storage hosts; otherwise the original string. */
export function inlineProxyUrlForStorageImage(remoteUrl: string): string {
    const trimmed = remoteUrl.trim();
    if (!trimmed) return trimmed;
    let u: URL;
    try {
        u = new URL(trimmed);
    } catch {
        return remoteUrl;
    }
    if (u.protocol !== 'https:') return remoteUrl;
    if (!allowedStorageHosts().has(u.hostname)) return remoteUrl;
    return `/api/storage-proxy?url=${encodeURIComponent(trimmed)}&inline=1`;
}
