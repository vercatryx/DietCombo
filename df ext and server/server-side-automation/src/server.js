const express = require('express');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { launchBrowser, closeBrowser } = require('./core/browser');
const { performLoginSequence } = require('./core/auth');
const { billingWorker, fetchRequestsFromApi } = require('./core/billingWorker');

// Load .env from this app's directory (not cwd) so UNITEUS_* etc. are predictable
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

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

    req.on('close', () => {
        clients = clients.filter(c => c.id !== clientId);
    });
}

function broadcast(type, data) {
    clients.forEach(client => {
        client.res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    });
}

app.get('/events', eventsHandler);

// State
let isRunning = false;
let currentRequests = null;

// Routes
app.post('/fetch-requests', async (req, res) => {
    const { apiBaseUrl, apiKey } = req.body;
    const apiConfig = (apiBaseUrl) ? { baseUrl: apiBaseUrl, key: apiKey } : null;

    try {
        console.log('[Server] Fetching requests from API (Preview Mode)...');
        const requests = await fetchRequestsFromApi(apiConfig);

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

        res.json({ success: true, count: requests.length, message: `Loaded ${requests.length} requests.` });
    } catch (e) {
        console.error('[Server] Fetch Preview Error:', e);
        res.status(500).json({ error: e.message });
    }
});

// Pull all clients from GET /api/bill (no auth). Maps to worker shape: name, url, date, endDate, amount, orderNumbers, proofURL(s).
app.post('/fetch-all-clients', async (req, res) => {
    const apiBaseUrl = (req.body && req.body.apiBaseUrl) ? req.body.apiBaseUrl.trim() : 'http://localhost:3000';
    const url = `${apiBaseUrl.replace(/\/$/, '')}/api/bill`;
    try {
        console.log('[Server] Fetching all clients from', url);
        const { data } = await axios.get(url, { timeout: 30000 });
        if (!Array.isArray(data)) {
            return res.status(500).json({ error: 'Expected array from /api/bill' });
        }
        const requests = data.map((r, i) => ({
            id: `bill-${i + 1}`,
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
        currentRequests = requests;
        broadcast('queue', currentRequests);
        res.json({ success: true, count: requests.length, message: `Loaded ${requests.length} clients from /api/bill.` });
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
            const jsonPath = path.join(__dirname, '../billing_requests.json');
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
            currentRequests = requests;
            broadcast('queue', currentRequests);
        } else if (source === 'queue') {
            // -- SOURCE: QUEUE (current in-memory list, e.g. from "Download from /api/bill") --
            let queueList = Array.isArray(currentRequests) ? currentRequests : [];
            if (queueList.length === 0) {
                return res.status(400).json({ error: 'Queue is empty. Use "Download from /api/bill" or "Download from Cloud" first.' });
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
    broadcast('log', { message: `--- Starting Automation Run (${source}) ---`, type: 'info' });

    // API config for update-status: used for 'api' source and for 'queue' when apiBaseUrl (+ optional apiKey) provided
    const apiConfig = (apiBaseUrl && (source === 'api' || source === 'queue')) ? { baseUrl: apiBaseUrl, key: apiKey } : null;

    const workerRequests = (source === 'file' || source === 'queue') ? requests : null;

    (async () => {
        try {
            await launchBrowser();
            // Pass apiConfig to worker (null for queue => no update-status calls)
            await billingWorker(workerRequests, broadcast, source, apiConfig);
            broadcast('log', { message: '--- Automation Run Complete ---', type: 'success' });
        } catch (e) {
            console.error('CRITICAL AUTOMATION ERROR:', e);
            broadcast('log', { message: `Critical Error: ${e.message}`, type: 'error' });
        } finally {
            isRunning = false;
        }
    })();
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
