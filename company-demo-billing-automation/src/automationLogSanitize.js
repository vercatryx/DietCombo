/**
 * Strip emails, full URLs, client ids, and tokens from strings sent to the dashboard log (SSE).
 */

function maskEmailToken(email) {
    const s = String(email || '').trim();
    if (!s.includes('@')) return '(account)';
    const parts = s.split('@');
    const domain = parts.slice(1).join('@');
    if (!domain) return '(account)';
    return '(Unite Us account)';
}

function shortenUrlToken(urlStr) {
    const trimmed = String(urlStr || '').replace(/[.,;)\]}>'"]+$/g, '');
    try {
        const u = new URL(trimmed);
        const host = u.hostname.toLowerCase();
        if (/thedietfantasy\.com$/i.test(host) || host === 'localhost' || host.endsWith('.localhost')) {
            return '(Diet Fantasy app API)';
        }
        if (/uniteus\.io$/i.test(host)) {
            return '(Unite Us)';
        }
        return `${u.origin}/…`;
    } catch {
        return '(link)';
    }
}

/**
 * @param {string} msg
 * @returns {string}
 */
function redactSensitiveInLogMessage(msg) {
    if (msg == null || typeof msg !== 'string') return msg;

    let s = msg;

    s = s.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, (m) => maskEmailToken(m));

    s = s.replace(/https?:\/\/[^\s)\]}>,'"]+/gi, (m) => shortenUrlToken(m));

    s = s.replace(/\bclientId=\S+/gi, 'clientId=(redacted)');

    s = s.replace(/\bBearer\s+\S+/gi, 'Bearer (redacted)');

    s = s.replace(/\btel:\+?[\d\-().\s]+/gi, 'tel:…');

    s = s.replace(/Generated proof URL:\s*.+/gi, 'Generated proof attachment (PDF).');

    return s;
}

module.exports = { redactSensitiveInLogMessage, maskEmailToken, shortenUrlToken };
