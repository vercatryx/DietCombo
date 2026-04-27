/**
 * Demo / recording: never show real client names or stray PII in the dashboard queue or logs.
 * Keeps URLs and billing fields needed for automation; limits how many rows load when enabled.
 */

const path = require('path');
const dotenvPath = process.env.DOTENV_PATH || path.join(__dirname, '..', '.env');
require('dotenv').config({ path: dotenvPath });
const { DEMO_PROFILES } = require('./demoPersonas');

function isDemoSafeQueueEnabled() {
    return /^(1|true|yes|on)$/i.test(String(process.env.DEMO_SAFE_QUEUE || '').trim());
}

function getDemoQueueLimit() {
    const n = parseInt(process.env.DEMO_QUEUE_LIMIT || '20', 10);
    if (!Number.isFinite(n) || n < 1) return 20;
    return Math.min(n, 500);
}

function demoDisplayName(index) {
    return DEMO_PROFILES[index % DEMO_PROFILES.length].name;
}

/** Strip known PII-ish keys from API payloads (best-effort). */
function stripLoosePii(obj) {
    if (!obj || typeof obj !== 'object') return;
    const keys = ['email', 'Email', 'phone', 'Phone', 'phoneNumber', 'address', 'Address', 'street', 'City', 'zip', 'ssn', 'dob', 'DOB'];
    for (const k of keys) {
        if (k in obj) delete obj[k];
    }
}

function sanitizeDependant(d, idx, parentRowIndex) {
    if (!d || typeof d !== 'object') return d;
    const out = { ...d };
    stripLoosePii(out);
    const n = (typeof parentRowIndex === 'number' ? parentRowIndex : 0) + idx + 1;
    out.name = demoDisplayName(n);
    return out;
}

/**
 * One queue row: replace name and scrub extra fields; keep url, dates, ids needed for billing.
 */
function sanitizeBillingRequest(req, index) {
    const out = { ...req };
    stripLoosePii(out);
    out.name = demoDisplayName(index);
    out._demoSanitized = true;
    if (Array.isArray(out.dependants)) {
        out.dependants = out.dependants.map((d, i) => sanitizeDependant(d, i, index));
    }
    return out;
}

/** When demo safe queue is off, returns the array unchanged. */
function maybeLimitDemoQueue(requests) {
    if (!isDemoSafeQueueEnabled() || !Array.isArray(requests)) return requests;
    return requests.slice(0, getDemoQueueLimit());
}

/** When demo safe queue is off, returns the array unchanged. */
function sanitizeBillingRequestsList(requests) {
    if (!isDemoSafeQueueEnabled() || !Array.isArray(requests)) return requests;
    return requests.map((r, i) => sanitizeBillingRequest(r, i));
}

function limitAndSanitizeQueue(requests) {
    const limited = maybeLimitDemoQueue(requests);
    return sanitizeBillingRequestsList(limited);
}

/** Mutate rows in place (same object refs) so SSE queue and selection stay aligned. */
function sanitizeBillingRequestsInPlace(arr) {
    if (!isDemoSafeQueueEnabled() || !Array.isArray(arr)) return;
    arr.forEach((r, i) => {
        const s = sanitizeBillingRequest(r, i);
        Object.assign(r, s);
    });
}

module.exports = {
    isDemoSafeQueueEnabled,
    getDemoQueueLimit,
    demoDisplayName,
    sanitizeBillingRequest,
    sanitizeBillingRequestsList,
    sanitizeBillingRequestsInPlace,
    maybeLimitDemoQueue,
    limitAndSanitizeQueue
};
