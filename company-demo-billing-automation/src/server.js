const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const XLSX = require('xlsx');
const { launchBrowser, launchBrowserInstance, closeAllBrowserInstances } = require('./core/browser');
const { billingWorker, fetchRequestsFromApi } = require('./core/billingWorker');
const envSettings = require('./envSettings');
const { limitAndSanitizeQueue, sanitizeBillingRequestsInPlace, isDemoSafeQueueEnabled } = require('./demoQueueSanitizer');
const {
    saveQueueToCache,
    loadQueueFromCache,
    clearQueueCacheFile,
    getQueueCacheInfo,
    getCacheSaveLimit
} = require('./queueCache');
const { redactSensitiveInLogMessage } = require('./automationLogSanitize');

// Settings UI persists CONCURRENT_BROWSERS / HEADLESS to the same .env as DOTENV_PATH (see electron-main).

// Load .env from DOTENV_PATH (packaged app) or project root
const dotenvPath = process.env.DOTENV_PATH || path.join(__dirname, '..', '.env');
require('dotenv').config({ path: dotenvPath });

/** Split array into N slices (round-robin) so each slot gets different clients. */
function roundRobinSlices(arr, n) {
    const slices = Array.from({ length: n }, () => []);
    arr.forEach((item, i) => slices[i % n].push(item));
    return slices;
}

const app = express();
const PORT = process.env.PORT || 3500;

app.use(express.json());
// Serve static frontend
app.use(express.static(path.join(__dirname, '../public')));

// -- SSE Setup --
let clients = [];

function eventsHandler(req, res) {
    const headers = {
        'Content-Type': 'text/event-stream',
        'Connection': 'keep-alive',
        'Cache-Control': 'no-cache'
    };
    res.writeHead(200, headers);

    const clientId = Date.now();
    const newClient = { id: clientId, res };
    clients.push(newClient);

    // Send initial queue state if exists
    if (currentRequests) {
        res.write(`event: queue\ndata: ${JSON.stringify(currentRequests)}\n\n`);
    }

    // Idle slot strip: configured browser slots from .env
    try {
        const s = envSettings.readSettings();
        res.write(`event: slotCount\ndata: ${JSON.stringify({ count: s.concurrentBrowsers })}\n\n`);
    } catch (e) {
        console.warn('[SSE] slotCount init:', e.message);
    }

    req.on('close', () => {
        clients = clients.filter(c => c.id !== clientId);
    });
}

function sanitizeBroadcastData(type, data) {
    if (!data || typeof data !== 'object') return data;
    if (type !== 'log' && type !== 'error') return data;
    if (typeof data.message !== 'string') return data;
    return { ...data, message: redactSensitiveInLogMessage(data.message) };
}

function broadcast(type, data) {
    const out = sanitizeBroadcastData(type, data);
    clients.forEach(client => {
        client.res.write(`event: ${type}\ndata: ${JSON.stringify(out)}\n\n`);
    });
}

app.get('/events', eventsHandler);

// State
let isRunning = false;
let currentRequests = null;

(() => {
    const loaded = loadQueueFromCache();
    if (loaded && loaded.length > 0) {
        currentRequests = loaded;
        console.log('[Server] Restored client queue from disk cache.');
    }
})();

// --- Settings (.env), open folder, Excel export ---
app.get('/api/settings', (req, res) => {
    try {
        const s = envSettings.readSettings();
        res.json({
            ...s,
            isRunning,
            minConcurrent: envSettings.MIN_CONCURRENT,
            maxConcurrent: envSettings.MAX_CONCURRENT
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/settings', (req, res) => {
    if (isRunning) {
        return res.status(409).json({ error: 'Automation is running; wait for it to finish before changing settings.' });
    }
    const body = req.body || {};
    const hasConcurrent = body.concurrentBrowsers != null;
    const hasHeadless = body.headless != null;
    if (!hasConcurrent && !hasHeadless) {
        return res.status(400).json({ error: 'Provide concurrentBrowsers and/or headless' });
    }
    try {
        const updates = {};
        if (hasConcurrent) updates.concurrentBrowsers = body.concurrentBrowsers;
        if (hasHeadless) updates.headless = body.headless;
        const saved = envSettings.writeSettings(updates);
        res.json({ ...saved, isRunning });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/queue-cache-info', (req, res) => {
    try {
        res.json(getQueueCacheInfo());
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

/** Reload queue from disk without restarting the server. */
app.post('/api/load-queue-cache', (req, res) => {
    if (isRunning) {
        return res.status(409).json({ error: 'Automation is running; wait until it finishes.' });
    }
    const loaded = loadQueueFromCache();
    if (!loaded || loaded.length === 0) {
        return res.status(404).json({ error: 'No saved queue file. Download the client list first.' });
    }
    currentRequests = loaded;
    broadcast('queue', currentRequests);
    broadcast('log', {
        message: `Loaded ${loaded.length} saved client(s) from disk (max ${getCacheSaveLimit()}).`,
        type: 'success'
    });
    res.json({
        success: true,
        count: loaded.length,
        message: `Loaded ${loaded.length} saved client(s).`
    });
});

/** Remove cached queue file (does not clear in-memory queue unless you reload). */
app.post('/api/clear-queue-cache', (req, res) => {
    if (isRunning) {
        return res.status(409).json({ error: 'Automation is running; wait until it finishes.' });
    }
    try {
        clearQueueCacheFile();
        res.json({ success: true, message: 'Saved queue file deleted.' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/open-env-folder', (req, res) => {
    try {
        envSettings.openEnvFolder();
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/export-queue.xlsx', (req, res) => {
    const queue = Array.isArray(currentRequests) ? currentRequests : [];
    if (queue.length === 0) {
        return res.status(400).json({ error: 'No queue loaded. Download clients from the server first.' });
    }
    const rows = queue.map((r) => ({
        'Client name': r.name || '',
        Id: r.id != null ? String(r.id) : r.orderID != null ? String(r.orderID) : '',
        ClientId: r.clientId != null ? String(r.clientId) : '',
        Start: r.start || r.date || '',
        End: r.end || r.endDate || '',
        Status: r.status || 'pending',
        Message: r.message || '',
        'Order numbers': Array.isArray(r.orderNumbers) ? r.orderNumbers.join(', ') : '',
        URL: r.url || ''
    }));
    const sheet = XLSX.utils.json_to_sheet(rows);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Queue');
    const buf = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="billing-queue-${stamp}.xlsx"`);
    res.send(buf);
});

// Routes
app.post('/fetch-requests', async (req, res) => {
    const { apiBaseUrl, apiKey } = req.body;
    const apiConfig = (apiBaseUrl) ? { baseUrl: apiBaseUrl, key: apiKey } : null;

    try {
        console.log('[Server] Fetching requests from API (Preview Mode)...');
        let requests = await fetchRequestsFromApi(apiConfig);
        requests = limitAndSanitizeQueue(requests);

        if (!requests || requests.length === 0) {
            return res.json({ success: true, count: 0, message: 'No pending requests found.' });
        }

        // Initialize status and stable id for selection
        requests.forEach((r, i) => {
            r.status = 'pending';
            r.message = '';
            if (r.id == null) r.id = r.orderID ? String(r.orderID) : `api-${i}`;
        });
        currentRequests = requests;
        broadcast('queue', currentRequests);
        saveQueueToCache(currentRequests);

        res.json({
            success: true,
            count: requests.length,
            message: `Loaded ${requests.length} requests.`,
            savedToCache: true
        });
    } catch (e) {
        console.error('[Server] Fetch Preview Error:', e);
        res.status(500).json({ error: e.message });
    }
});

// Pull clients from GET /api/bill (no auth). Optional ?date=YYYY-MM-DD&account=regular|brooklyn|both.
app.post('/fetch-all-clients', async (req, res) => {
    const apiBaseUrl = (req.body && req.body.apiBaseUrl) ? req.body.apiBaseUrl.trim() : 'http://customer.thedietfantasy.com';
    const dateParam = (req.body && req.body.date) ? String(req.body.date).trim() : null;
    const accountParam = (req.body && req.body.account) ? String(req.body.account).trim().toLowerCase() : null;
    const params = new URLSearchParams();
    if (dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
        params.set('date', dateParam);
    }
    if (accountParam && ['regular', 'brooklyn', 'both'].includes(accountParam)) {
        params.set('account', accountParam);
    }
    const qs = params.toString();
    let url = `${apiBaseUrl.replace(/\/$/, '')}/api/bill${qs ? '?' + qs : ''}`;
    try {
        console.log('[Server] Fetching all clients from', url);
        const { data } = await axios.get(url, { timeout: 30000 });
        if (!Array.isArray(data)) {
            return res.status(500).json({ error: 'Expected array from /api/bill' });
        }
        let requests = data.map((r, i) => ({
            id: `bill-${i + 1}`,
            clientId: r.clientId || null,
            name: r.name,
            url: r.url,
            date: r.date,
            endDate: r.endDate,
            amount: r.amount,
            dependants: r.dependants || [],
            orderNumbers: Array.isArray(r.orderNumbers) ? r.orderNumbers : [],
            proofURLs: Array.isArray(r.proofURLs) ? r.proofURLs : [],
            proofURL: (r.proofURLs && r.proofURLs[0]) || null,
            status: 'pending',
            message: ''
        }));
        requests = limitAndSanitizeQueue(requests);
        currentRequests = requests;
        broadcast('queue', currentRequests);
        saveQueueToCache(currentRequests);

        const cap = getCacheSaveLimit();
        res.json({
            success: true,
            count: requests.length,
            message: `Loaded ${requests.length} clients from /api/bill.`,
            savedToCache: true,
            cacheLimit: cap
        });
    } catch (e) {
        console.error('[Server] Fetch /api/bill Error:', e.message);
        res.status(500).json({ error: e.response ? `${e.response.status}: ${JSON.stringify(e.response.data)}` : e.message });
    }
});

app.post('/process-billing', async (req, res) => {
    if (isRunning) {
        return res.status(409).json({ message: 'Process already running' });
    }

    const { source = 'file', apiBaseUrl, apiKey } = req.body;

    let requests = [];

    try {
        if (source === 'file') {
            // -- SOURCE: FILE --
            const jsonPath = process.env.BILLING_REQUESTS_PATH || path.join(__dirname, '../billing_requests.json');
            if (!fs.existsSync(jsonPath)) {
                return res.status(404).json({ error: 'billing_requests.json not found' });
            }
            const data = fs.readFileSync(jsonPath, 'utf8');
            requests = JSON.parse(data);

            // Validate that we have an array
            if (!Array.isArray(requests)) {
                return res.status(500).json({ error: 'billing_requests.json must contain an array' });
            }
            if (requests.length === 0) {
                return res.status(400).json({ error: 'No requests found in billing_requests.json' });
            }

            // Initialize status for UI
            requests.forEach(r => { r.status = 'pending'; r.message = ''; });
            requests = limitAndSanitizeQueue(requests);
            currentRequests = requests;
            broadcast('queue', currentRequests);
        } else if (source === 'queue') {
            // -- SOURCE: QUEUE (current in-memory list, e.g. from "Download from /api/bill") --
            let queueList = Array.isArray(currentRequests) ? currentRequests : [];
            if (queueList.length === 0) {
                return res.status(400).json({ error: 'Queue is empty. Use "Download from /api/bill" or "Download from Cloud" first.' });
            }
            if (isDemoSafeQueueEnabled()) {
                sanitizeBillingRequestsInPlace(queueList);
            }
            // Optional: run only selected clients
            const { selectedIndices, selectedIds } = req.body || {};
            if (Array.isArray(selectedIds) && selectedIds.length > 0) {
                requests = queueList.filter(r => selectedIds.includes(String(r.id || r.orderID)));
            } else if (Array.isArray(selectedIndices) && selectedIndices.length > 0) {
                requests = queueList.filter((_, i) => selectedIndices.includes(i));
            } else {
                requests = queueList;
            }
            if (requests.length === 0) {
                return res.status(400).json({ error: 'No clients selected. Check the clients you want to run.' });
            }
            // Ensure status/message for UI
            queueList.forEach(r => { r.status = r.status || 'pending'; r.message = r.message || ''; });
            broadcast('queue', queueList);
        } else {
            // -- SOURCE: API (billing-requests) --
            // We set currentRequests to empty or null so UI knows something is happening but waiting for data
            currentRequests = [];
            broadcast('log', { message: 'Mode: API. Fetching pending requests...', type: 'info' });
        }

    } catch (e) {
        console.error('[Server] Setup Error:', e);
        return res.status(500).json({ error: `Setup failed: ${e.message}` });
    }

    console.log(`[Server] Starting automation (Source: ${source})`);
    res.json({ message: 'Automation started', source: source });

    isRunning = true;
    broadcast('automationState', { isRunning: true });
    broadcast('log', { message: `--- Starting Automation Run (${source}) ---`, type: 'info' });

    // API config for update-status: used for 'api' source and for 'queue' when apiBaseUrl (+ optional apiKey) provided
    const apiConfig = (apiBaseUrl && (source === 'api' || source === 'queue')) ? { baseUrl: apiBaseUrl, key: apiKey } : null;

    const workerRequests = (source === 'file' || source === 'queue') ? requests : null;

    const concurrency = Math.max(1, parseInt(process.env.CONCURRENT_BROWSERS, 10) || 1);

    (async () => {
        try {
            broadcast('slotCount', { count: concurrency });
            if (concurrency === 1) {
                await launchBrowser();
                await billingWorker(workerRequests, broadcast, source, apiConfig, { slotIndex: 0, slotLabel: 'Slot 0' });
            } else {
                broadcast('log', { message: `Starting ${concurrency} browsers in parallel (different clients per slot)...`, type: 'info' });
                let requests = workerRequests;
                if (source === 'api') {
                    requests = limitAndSanitizeQueue(await fetchRequestsFromApi(apiConfig));
                    if (!requests || requests.length === 0) {
                        broadcast('log', { message: 'No pending requests from API.', type: 'warning' });
                        isRunning = false;
                        return;
                    }
                }
                if (!requests || requests.length === 0) {
                    broadcast('log', { message: 'No requests to process.', type: 'warning' });
                    isRunning = false;
                    return;
                }
                requests.forEach((r, i) => {
                    r.status = r.status || 'pending';
                    r.message = r.message || '';
                    if (r.id == null) r.id = r.orderID ? String(r.orderID) : `api-${i}`;
                });
                currentRequests = requests;
                broadcast('queue', currentRequests);

                const slices = roundRobinSlices(requests, concurrency);
                const slots = await Promise.all(
                    Array.from({ length: concurrency }, (_, i) =>
                        launchBrowserInstance(i, { totalSlots: concurrency })
                    )
                );
                await Promise.all(
                    slots.map((slot, i) =>
                        billingWorker(requests, broadcast, source, apiConfig, {
                            page: slot.page,
                            context: slot.context,
                            getPageOrRestart: slot.restartPage,
                            requestSlice: slices[i],
                            slotIndex: i,
                            slotLabel: `Slot ${i}`
                        })
                    )
                );
                await closeAllBrowserInstances();
            }
            broadcast('log', { message: '--- Automation Run Complete ---', type: 'success' });
        } catch (e) {
            console.error('CRITICAL AUTOMATION ERROR:', e);
            broadcast('log', { message: `Critical Error: ${e.message}`, type: 'error' });
            try {
                await closeAllBrowserInstances();
            } catch (e2) {
                console.warn('Close all instances:', e2.message);
            }
        } finally {
            isRunning = false;
            broadcast('automationState', { isRunning: false });
        }
    })();
});

function start(port) {
    const p = port != null ? port : PORT;
    return app.listen(p, () => {
        console.log(`Server running on http://localhost:${p}`);
    });
}

module.exports = { app, start };

if (require.main === module) {
    start(PORT);
}
