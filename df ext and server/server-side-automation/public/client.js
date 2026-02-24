const termEl = document.getElementById('terminal');
const queueBody = document.getElementById('queue-body');
const statusBadge = document.getElementById('connection-status');

// Connect to SSE
const evtSource = new EventSource('/events');

evtSource.onopen = () => {
    statusBadge.textContent = 'Connected';
    statusBadge.className = 'badge connected';
    log('System connected to server.');
};

evtSource.onerror = () => {
    statusBadge.textContent = 'Disconnected';
    statusBadge.className = 'badge disconnected';
};

// Handle Log Events
evtSource.addEventListener('log', (e) => {
    const data = JSON.parse(e.data);
    log(data.message, data.type);
});

let lastRequests = [];
let sortDir = {}; // track direction for each field
let selectedIds = new Set(); // which clients are selected to run (stable id per request)

// Handle Queue Updates (Full Refresh) — keep selection by id
evtSource.addEventListener('queue', (e) => {
    const next = JSON.parse(e.data);
    lastRequests = next;
    renderQueue(lastRequests);
    updateStats(lastRequests);
    updateSelectAllCheckbox();
});

function sortQueue(field) {
    if (!lastRequests.length) return;

    // Toggle direction
    sortDir[field] = sortDir[field] === 'asc' ? 'desc' : 'asc';
    const dir = sortDir[field] === 'asc' ? 1 : -1;

    lastRequests.sort((a, b) => {
        let valA = a[field] || '';
        let valB = b[field] || '';

        // Handle numeric/date fields if needed, but string comparison is usually fine for these
        if (typeof valA === 'string') valA = valA.toLowerCase();
        if (typeof valB === 'string') valB = valB.toLowerCase();

        if (valA < valB) return -1 * dir;
        if (valA > valB) return 1 * dir;
        return 0;
    });

    renderQueue(lastRequests);
}

function triggerProcess(source = 'file') {
    const apiBaseUrl = document.getElementById('api-base-url').value.trim();
    const apiKey = document.getElementById('api-key').value.trim();

    log(`Sending request to start automation (Source: ${source})...`, 'info');

    // Switch to POST to carry body data nicely
    fetch('/process-billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            source,
            apiBaseUrl,
            apiKey
        })
    })
        .then(r => {
            console.log('[Client] Response status:', r.status, r.statusText);
            if (!r.ok) {
                return r.json().then(data => {
                    console.error('[Client] Error response:', data);
                    throw new Error(data.error || `HTTP ${r.status}: ${r.statusText}`);
                });
            }
            return r.json();
        })
        .then(d => {
            console.log('[Client] Success response:', d);
            if (d.error) {
                log(`Error: ${d.error}`, 'error');
            } else {
                const msg = d.source === 'api' ? 'Automation started [API Mode]' : `Triggered: ${d.count || 0} requests [File Mode]`;
                log(msg, 'success');
            }
        })
        .catch(e => {
            console.error('[Client] Fetch error:', e);
            log(`Error triggering: ${e.message || e}`, 'error');
        });
}

function downloadCloudRequests() {
    const apiBaseUrl = document.getElementById('api-base-url').value.trim();
    const apiKey = document.getElementById('api-key').value.trim();

    log('Fetching pending requests from Cloud (Preview)...', 'info');
    document.getElementById('queue-body').innerHTML = ''; // Clear previous

    fetch('/fetch-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiBaseUrl, apiKey })
    })
        .then(r => r.json())
        .then(d => {
            if (d.error) {
                log(`Fetch Error: ${d.error}`, 'error');
            } else {
                log(`Fetched ${d.count} requests from API.`, 'success');
            }
        })
        .catch(e => {
            log(`Fetch Failed: ${e.message}`, 'error');
        });
}

function downloadAllClients() {
    const apiBaseUrl = document.getElementById('api-base-url').value.trim() || 'http://localhost:3000';

    log('Fetching all clients from ' + apiBaseUrl + '/api/bill...', 'info');

    fetch('/fetch-all-clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiBaseUrl })
    })
        .then(r => r.json())
        .then(d => {
            if (d.error) {
                log(`Fetch Error: ${d.error}`, 'error');
            } else {
                log(d.message || `Loaded ${d.count} clients.`, 'success');
            }
        })
        .catch(e => {
            log(`Fetch Failed: ${e.message}`, 'error');
        });
}

function runCurrentQueue() {
    const ids = [...selectedIds];
    const runOnlySelected = ids.length > 0;
    if (runOnlySelected) {
        log(`Starting automation for ${ids.length} selected client(s)...`, 'info');
    } else {
        log('Starting automation with current queue (all)...', 'info');
    }

    const apiBaseUrl = document.getElementById('api-base-url').value.trim();
    const apiKey = document.getElementById('api-key').value.trim();

    const body = { source: 'queue', apiBaseUrl, apiKey };
    if (runOnlySelected) body.selectedIds = ids;

    fetch('/process-billing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    })
        .then(r => {
            if (!r.ok) {
                return r.json().then(data => {
                    throw new Error(data.error || `HTTP ${r.status}`);
                });
            }
            return r.json();
        })
        .then(d => {
            log(d.message || 'Run started.', 'success');
        })
        .catch(e => {
            log(`Error: ${e.message}`, 'error');
        });
}

function log(msg, type = 'info') {
    const div = document.createElement('div');
    div.className = `line ${type}`;
    div.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`;
    termEl.appendChild(div);
    termEl.scrollTop = termEl.scrollHeight;
}

function requestId(req, idx) {
    return req.id != null ? String(req.id) : (req.orderID != null ? String(req.orderID) : `row-${idx}`);
}

function updateSelectAllCheckbox() {
    const all = document.getElementById('queue-select-all');
    if (!all) return;
    const n = lastRequests.length;
    if (n === 0) {
        all.checked = false;
        all.indeterminate = false;
        return;
    }
    const count = selectedIds.size;
    all.checked = count === n;
    all.indeterminate = count > 0 && count < n;
}

function onSelectAllChange(checked) {
    if (checked) {
        lastRequests.forEach((req, i) => selectedIds.add(requestId(req, i)));
    } else {
        selectedIds.clear();
    }
    renderQueue(lastRequests);
}

function renderQueue(requests) {
    queueBody.innerHTML = '';
    requests.forEach((req, idx) => {
        const tr = document.createElement('tr');
        const id = requestId(req, idx);

        let statusClass = 'status-pending';
        if (req.status === 'processing') statusClass = 'status-processing';
        if (req.status === 'success') statusClass = 'status-success';
        if (req.status === 'failed') statusClass = 'status-failed';
        if (req.status === 'skipped') statusClass = 'status-skipped';

        const checked = selectedIds.has(id) ? ' checked' : '';
        tr.innerHTML = `
            <td class="col-check"><input type="checkbox" class="queue-row-check" data-id="${id}"${checked}></td>
            <td>${idx + 1} <span style="font-size: 0.8em; color: #777;">(${req.orderID || req.id || '-'})</span></td>
            <td>${req.name}</td>
            <td>${req.start ? `${req.start} -> ${req.end}` : req.date || '-'}</td>
            <td><span class="status-badge ${statusClass}">${req.status || 'Pending'}</span></td>
            <td style="font-size:0.85em; color:#ccc">${req.message || '-'}</td>
        `;
        queueBody.appendChild(tr);
    });
    queueBody.querySelectorAll('.queue-row-check').forEach(cb => {
        cb.addEventListener('change', function () {
            const id = this.getAttribute('data-id');
            if (selectedIds.has(id)) selectedIds.delete(id);
            else selectedIds.add(id);
            updateSelectAllCheckbox();
        });
    });
    const allCb = document.getElementById('queue-select-all');
    if (allCb && !allCb.onSelectAllBound) {
        allCb.onSelectAllBound = true;
        allCb.addEventListener('change', function () {
            onSelectAllChange(this.checked);
        });
    }
}

function updateStats(requests) {
    document.getElementById('stat-total').textContent = requests.length;
    document.getElementById('stat-pending').textContent = requests.filter(r => !r.status || r.status === 'pending').length;
    document.getElementById('stat-success').textContent = requests.filter(r => r.status === 'success').length;
    document.getElementById('stat-failed').textContent = requests.filter(r => r.status === 'failed').length;
}
