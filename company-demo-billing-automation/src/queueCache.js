/**
 * Persist the billing queue (default: first N rows, same as demo limit) so the UI
 * can reopen without calling /api/bill again.
 */

const fs = require('fs');
const path = require('path');
const { limitAndSanitizeQueue, getDemoQueueLimit } = require('./demoQueueSanitizer');

function getQueueCachePath() {
    return process.env.BILLING_QUEUE_CACHE_PATH || path.join(__dirname, '..', 'demo_queue_cache.json');
}

/** Max rows written to disk (defaults to DEMO_QUEUE_LIMIT / 20). */
function getCacheSaveLimit() {
    const raw = process.env.BILLING_QUEUE_CACHE_LIMIT;
    if (raw != null && String(raw).trim() !== '') {
        const n = parseInt(String(raw).trim(), 10);
        if (Number.isFinite(n) && n >= 1) return Math.min(n, 500);
    }
    return getDemoQueueLimit();
}

function normalizeQueueRows(requests) {
    if (!Array.isArray(requests)) return [];
    requests.forEach((r, i) => {
        r.status = r.status || 'pending';
        r.message = r.message || '';
        if (r.id == null) r.id = r.orderID ? String(r.orderID) : `cached-${i}`;
    });
    return requests;
}

function saveQueueToCache(requests) {
    if (!Array.isArray(requests) || requests.length === 0) return;
    let rows = limitAndSanitizeQueue(requests.slice());
    const cap = getCacheSaveLimit();
    rows = rows.slice(0, cap);
    normalizeQueueRows(rows);
    const p = getQueueCachePath();
    fs.writeFileSync(p, JSON.stringify(rows, null, 2), 'utf8');
    console.log(`[Queue cache] Saved ${rows.length} row(s) → ${p}`);
}

function loadQueueFromCache() {
    const p = getQueueCachePath();
    if (!fs.existsSync(p)) return null;
    try {
        const data = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (!Array.isArray(data) || data.length === 0) return null;
        let rows = limitAndSanitizeQueue(data.slice());
        rows = rows.slice(0, getCacheSaveLimit());
        normalizeQueueRows(rows);
        console.log(`[Queue cache] Loaded ${rows.length} row(s) ← ${p}`);
        return rows;
    } catch (e) {
        console.warn('[Queue cache]', e.message);
        return null;
    }
}

function clearQueueCacheFile() {
    const p = getQueueCachePath();
    if (fs.existsSync(p)) fs.unlinkSync(p);
}

function getQueueCacheInfo() {
    const p = getQueueCachePath();
    if (!fs.existsSync(p)) return { exists: false, path: p, count: 0 };
    try {
        const stat = fs.statSync(p);
        const data = JSON.parse(fs.readFileSync(p, 'utf8'));
        const count = Array.isArray(data) ? data.length : 0;
        return { exists: true, path: p, count, mtime: stat.mtime.toISOString() };
    } catch (e) {
        return { exists: false, path: p, count: 0, error: e.message };
    }
}

module.exports = {
    getQueueCachePath,
    getCacheSaveLimit,
    saveQueueToCache,
    loadQueueFromCache,
    clearQueueCacheFile,
    getQueueCacheInfo
};
