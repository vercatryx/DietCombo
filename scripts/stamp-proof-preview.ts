/**
 * Run the same server-side proof stamp as production without uploading or creating orders.
 *
 *   npx tsx scripts/stamp-proof-preview.ts
 *   npx tsx scripts/stamp-proof-preview.ts "https://storage.thedietfantasy.com/your-key.jpg"
 *
 * Writes stamp-proof-preview-out.jpg in the project root (gitignored pattern: use /tmp if you prefer).
 */

import { writeFileSync } from 'fs';
import { join } from 'path';
import { stampTimestampOnImageBuffer } from '../lib/stampTimestampOnImageBuffer';

const defaultUrl =
    'https://storage.thedietfantasy.com/produce-proof-972381ec-caa9-4b89-9c1a-a7c383df17ac-1778789400806-1.jpg';

/** Accept direct storage HTTPS URLs or `/api/storage-proxy?url=...` style links. */
function resolveImageUrl(arg: string): string {
    const trimmed = arg.trim();
    try {
        const u = new URL(trimmed);
        const inner = u.searchParams.get('url');
        if (inner && (u.pathname.endsWith('/storage-proxy') || u.pathname.includes('storage-proxy'))) {
            return inner.trim();
        }
    } catch {
        /* not a URL */
    }
    return trimmed;
}

async function main() {
    const imageUrl = resolveImageUrl(process.argv[2] || defaultUrl);
    const res = await fetch(imageUrl, { redirect: 'follow' });
    if (!res.ok) {
        console.error('Fetch failed', res.status, res.statusText);
        process.exit(1);
    }
    const mime = res.headers.get('content-type') || 'image/jpeg';
    const input = Buffer.from(await res.arrayBuffer());
    const out = await stampTimestampOnImageBuffer(input, mime, new Date());
    const ext = out.fileExtension === 'png' ? 'png' : 'jpg';
    const outPath = join(process.cwd(), `stamp-proof-preview-out.${ext}`);
    writeFileSync(outPath, out.buffer);
    console.log('Wrote', outPath);
    console.log({ stampedAtIso: out.stampedAtIso, source: out.source, contentType: out.contentType });
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
