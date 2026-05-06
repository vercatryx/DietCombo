import { NextRequest, NextResponse } from 'next/server';

function allowedStorageHosts(): Set<string> {
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

function filenameFromPath(pathname: string): string {
    const seg = pathname.split('/').filter(Boolean).pop();
    if (!seg || seg.includes('..')) return 'proof-image';
    return seg.replace(/[^\w.\-]+/g, '_').slice(0, 200) || 'proof-image';
}

/**
 * Server-side fetch of public R2 URLs so the browser can download without CORS.
 * Only https URLs whose host matches our storage domain(s) are allowed (SSRF-safe).
 */
export async function GET(req: NextRequest) {
    const urlParam = req.nextUrl.searchParams.get('url');
    if (!urlParam?.trim()) {
        return NextResponse.json({ error: 'Missing url' }, { status: 400 });
    }

    let remote: URL;
    try {
        remote = new URL(urlParam.trim());
    } catch {
        return NextResponse.json({ error: 'Invalid url' }, { status: 400 });
    }

    if (remote.protocol !== 'https:') {
        return NextResponse.json({ error: 'Only https URLs are allowed' }, { status: 400 });
    }

    const allowed = allowedStorageHosts();
    if (!allowed.has(remote.hostname)) {
        return NextResponse.json({ error: 'Host not allowed' }, { status: 403 });
    }

    let upstream: Response;
    try {
        upstream = await fetch(remote.toString(), {
            redirect: 'follow',
            cache: 'no-store',
        });
    } catch {
        return NextResponse.json({ error: 'Fetch failed' }, { status: 502 });
    }

    if (!upstream.ok) {
        return NextResponse.json({ error: 'Upstream error' }, { status: 502 });
    }

    const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
    const filename = filenameFromPath(remote.pathname);

    const headers = new Headers();
    headers.set('Content-Type', contentType);
    headers.set('Content-Disposition', `attachment; filename="${filename}"`);
    headers.set('Cache-Control', 'private, max-age=300');

    const body = upstream.body;
    if (!body) {
        const buf = await upstream.arrayBuffer();
        return new NextResponse(buf, { headers });
    }

    return new NextResponse(body, { headers });
}
