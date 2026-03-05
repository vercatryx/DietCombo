const termEl = document.getElementById('terminal');
const queueBody = document.getElementById('queue-body');
const statusBadge = document.getElementById('connection-status');
const slotsStrip = document.getElementById('slots-strip');

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

// Slot status: { slotIndex, slotLabel, clientName, stage }
let slotStates = [];

function stageToClass(stage) {
    if (!stage) return 'slot-stage--idle';
    const s = (stage || '').toLowerCase();
    if (s === 'idle') return 'slot-stage--idle';
    if (s === 'starting' || s === 'navigating' || s === 'login') return 'slot-stage--starting';
    if (s === 'billing') return 'slot-stage--billing';
    if (s === 'success') return 'slot-stage--success';
    if (s === 'skipped') return 'slot-stage--skipped';
    if (s === 'failed') return 'slot-stage--failed';
    return 'slot-stage--idle';
}

function renderSlotBoxes(count) {
    slotsStrip.innerHTML = '';
    slotStates = Array.from({ length: count }, () => ({ clientName: '', stage: 'Idle' }));
    for (let i = 0; i < count; i++) {
        const box = document.createElement('div');
        box.className = 'slot-box';
        box.setAttribute('data-slot-index', i);
        box.innerHTML = `
            <div class="slot-title">Slot ${i}</div>
            <div class="slot-client">—</div>
            <span class="slot-stage slot-stage--idle">Idle</span>
        `;
        slotsStrip.appendChild(box);
    }
}

function updateSlotStatus(slotIndex, clientName, stage) {
    if (slotIndex < 0 || slotIndex >= slotStates.length) return;
    slotStates[slotIndex] = { clientName: clientName || '', stage: stage || 'Idle' };
    const box = slotsStrip.querySelector(`[data-slot-index="${slotIndex}"]`);
    if (!box) return;
    const clientEl = box.querySelector('.slot-client');
    const stageEl = box.querySelector('.slot-stage');
    if (clientEl) clientEl.textContent = clientName || '—';
    if (stageEl) {
        stageEl.textContent = stage || 'Idle';
        stageEl.className = 'slot-stage ' + stageToClass(stage);
    }
}

evtSource.addEventListener('slotCount', (e) => {
    const data = JSON.parse(e.data);
    const count = Math.max(0, parseInt(data.count, 10) || 0);
    renderSlotBoxes(count);
});

evtSource.addEventListener('slotStatus', (e) => {
    const data = JSON.parse(e.data);
    updateSlotStatus(data.slotIndex, data.clientName, data.stage);
});

let lastRequests = [];
let sortDir = {}; // track direction for each field
let selectedIds = new Set(); // which clients are selected to run (stable id per request)

// Drag-to-select over checkboxes
let dragSelectActive = false;
let dragSelectValue = false; // true = selecting, false = deselecting
let dragSelectLastIndex = -1;

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

const DEFAULT_API_BASE = 'http://customer.thedietfantasy.com';

/** Return YYYY-MM-DD for the last Monday (including today if today is Monday). */
function getLastMondayISO() {
    const d = new Date();
    const day = d.getDay(); // 0 Sun .. 6 Sat
    const daysBack = (day + 6) % 7; // Mon=0, Tue=1, ..., Sun=6
    d.setDate(d.getDate() - daysBack);
    return d.toISOString().slice(0, 10);
}

function initBillDate() {
    const el = document.getElementById('bill-date');
    if (el && !el.value) el.value = getLastMondayISO();
}

function getBillDate() {
    const el = document.getElementById('bill-date');
    return (el && el.value) ? el.value : getLastMondayISO();
}

function downloadAllClients() {
    const date = getBillDate();
    const urlWithQuery = `${DEFAULT_API_BASE}/api/bill?date=${date}`;
    log('Fetching all clients from ' + urlWithQuery + '...', 'info');

    fetch('/fetch-all-clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiBaseUrl: DEFAULT_API_BASE, date })
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

    const body = { source: 'queue', apiBaseUrl: DEFAULT_API_BASE, apiKey: '' };
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

function setRowSelectedByIndex(rowIndex, selected) {
    if (rowIndex < 0 || rowIndex >= lastRequests.length) return;
    const id = requestId(lastRequests[rowIndex], rowIndex);
    if (selected) selectedIds.add(id);
    else selectedIds.delete(id);
}

function setupDragSelect() {
    queueBody.addEventListener('mousedown', (e) => {
        const cell = e.target.closest('.col-check');
        const row = e.target.closest('tbody tr');
        if (!cell || !row) return;
        const checkbox = row.querySelector('.queue-row-check');
        if (!checkbox) return;
        dragSelectActive = true;
        dragSelectValue = !checkbox.checked;
        dragSelectLastIndex = Array.from(queueBody.rows).indexOf(row);
        setRowSelectedByIndex(dragSelectLastIndex, dragSelectValue);
        renderQueue(lastRequests);
        updateSelectAllCheckbox();
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!dragSelectActive) return;
        const row = e.target.closest('tbody#queue-body tr');
        if (!row || row.closest('tbody') !== queueBody) return;
        const idx = Array.from(queueBody.rows).indexOf(row);
        if (idx === -1 || idx === dragSelectLastIndex) return;
        dragSelectLastIndex = idx;
        setRowSelectedByIndex(idx, dragSelectValue);
        renderQueue(lastRequests);
        updateSelectAllCheckbox();
    });

    document.addEventListener('mouseup', () => {
        dragSelectActive = false;
        dragSelectLastIndex = -1;
    });
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

initBillDate();
setupDragSelect();
