const termEl = document.getElementById('terminal');
const queueBody = document.getElementById('queue-body');
const statusBadge = document.getElementById('connection-status');
const slotsStrip = document.getElementById('slots-strip');

function escapeHtml(s) {
    if (s == null || s === '') return '';
    const div = document.createElement('div');
    div.textContent = String(s);
    return div.innerHTML;
}

let settingsUiLocked = false;

function setSettingsFormDisabled(locked) {
    settingsUiLocked = !!locked;
    const ids = ['setting-concurrent-browsers', 'btn-show-browser', 'btn-save-settings', 'btn-open-source-files'];
    ids.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.disabled = locked;
    });
}

function updateShowBrowserButtonUI(showBrowserVisible) {
    const btn = document.getElementById('btn-show-browser');
    if (!btn) return;
    if (showBrowserVisible) {
        btn.classList.add('btn-toggle--on');
        btn.textContent = 'Show browser: On';
        btn.setAttribute('aria-pressed', 'true');
    } else {
        btn.classList.remove('btn-toggle--on');
        btn.textContent = 'Show browser: Off';
        btn.setAttribute('aria-pressed', 'false');
    }
}

async function persistHeadlessFromShowBrowserButton() {
    const numEl = document.getElementById('setting-concurrent-browsers');
    const btn = document.getElementById('btn-show-browser');
    const concurrentBrowsers = parseInt(numEl && numEl.value, 10);
    const showOn = btn && btn.classList.contains('btn-toggle--on');
    const headless = !showOn;
    if (!Number.isFinite(concurrentBrowsers)) {
        log('Invalid browser slots value', 'error');
        return;
    }
    try {
        const r = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ concurrentBrowsers, headless })
        });
        const d = await r.json();
        if (!r.ok) {
            log(d.error || `Save failed (${r.status})`, 'error');
            return;
        }
        log(showOn ? 'Browser window will show on next run (HEADLESS=false)' : 'Headless mode saved (HEADLESS=true)', 'success');
    } catch (e) {
        log(`Save failed: ${e.message}`, 'error');
    }
}

async function loadSettings() {
    try {
        const r = await fetch('/api/settings');
        const s = await r.json();
        if (!r.ok) {
            log(`Settings load failed: ${s.error || r.status}`, 'error');
            return;
        }
        const num = document.getElementById('setting-concurrent-browsers');
        if (num) {
            if (s.minConcurrent != null) num.min = String(s.minConcurrent);
            if (s.maxConcurrent != null) num.max = String(s.maxConcurrent);
            num.value = String(s.concurrentBrowsers);
        }
        updateShowBrowserButtonUI(!s.headless);
        setSettingsFormDisabled(s.isRunning);
        const c = Math.max(0, parseInt(s.concurrentBrowsers, 10) || 0);
        if (c > 0) renderSlotBoxes(c);
    } catch (e) {
        log(`Settings load failed: ${e.message}`, 'error');
    }
}

async function saveSettings() {
    const numEl = document.getElementById('setting-concurrent-browsers');
    const btn = document.getElementById('btn-show-browser');
    const concurrentBrowsers = parseInt(numEl && numEl.value, 10);
    const headless = btn ? !btn.classList.contains('btn-toggle--on') : true;
    if (!Number.isFinite(concurrentBrowsers)) {
        log('Invalid browser slots value', 'error');
        return;
    }
    try {
        const r = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ concurrentBrowsers, headless })
        });
        const d = await r.json();
        if (!r.ok) {
            log(d.error || `Save failed (${r.status})`, 'error');
            return;
        }
        log('Settings saved to .env', 'success');
        renderSlotBoxes(d.concurrentBrowsers);
    } catch (e) {
        log(`Save failed: ${e.message}`, 'error');
    }
}

async function openEnvFolder() {
    try {
        const r = await fetch('/api/open-env-folder', { method: 'POST' });
        const d = await r.json();
        if (!r.ok) {
            log(d.error || 'Could not open folder', 'error');
            return;
        }
        log('Opened source files folder', 'success');
    } catch (e) {
        log(`Open folder failed: ${e.message}`, 'error');
    }
}

async function exportExcel() {
    try {
        const r = await fetch('/api/export-queue.xlsx');
        if (!r.ok) {
            let msg = `Export failed (${r.status})`;
            try {
                const err = await r.json();
                if (err.error) msg = err.error;
            } catch (_) { /* not JSON */ }
            log(msg, 'error');
            return;
        }
        const blob = await r.blob();
        const disp = r.headers.get('Content-Disposition') || '';
        let name = 'billing-queue.xlsx';
        const m = /filename="([^"]+)"/.exec(disp);
        if (m) name = m[1];
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        a.click();
        URL.revokeObjectURL(a.href);
        log(`Downloaded ${name}`, 'success');
    } catch (e) {
        log(`Export failed: ${e.message}`, 'error');
    }
}

// Connect to SSE
const evtSource = new EventSource('/events');

let badgeTripleClicks = 0;
let badgeTripleTimer = null;
const BADGE_TRIPLE_WINDOW_MS = 700;

function toggleAdvancedSettingsBar() {
    const bar = document.getElementById('settings-bar');
    if (!bar) return;
    const hide = !bar.classList.contains('settings-bar--hidden');
    if (hide) {
        bar.classList.add('settings-bar--hidden');
        log('Advanced settings hidden. Triple-click Connected to show again.', 'info');
    } else {
        bar.classList.remove('settings-bar--hidden');
        log('Advanced settings shown. Triple-click Connected to hide.', 'info');
    }
}

function initConnectionBadgeTripleClick() {
    if (!statusBadge) return;
    statusBadge.addEventListener('click', () => {
        if (statusBadge.disabled || !statusBadge.classList.contains('badge--connected')) {
            return;
        }
        badgeTripleClicks += 1;
        clearTimeout(badgeTripleTimer);
        badgeTripleTimer = setTimeout(() => {
            badgeTripleClicks = 0;
        }, BADGE_TRIPLE_WINDOW_MS);
        if (badgeTripleClicks >= 3) {
            badgeTripleClicks = 0;
            clearTimeout(badgeTripleTimer);
            toggleAdvancedSettingsBar();
        }
    });
}

evtSource.onopen = () => {
    statusBadge.textContent = 'Connected';
    statusBadge.className = 'badge-status badge--connected';
    statusBadge.disabled = false;
    log('Connected to server.');
};

evtSource.onerror = () => {
    statusBadge.textContent = 'Disconnected';
    statusBadge.className = 'badge-status badge--disconnected';
    statusBadge.disabled = true;
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
    const s = String(stage).trim().toLowerCase();
    if (s === 'idle') return 'slot-stage--idle';
    if (s === 'success') return 'slot-stage--success';
    if (s === 'skipped') return 'slot-stage--skipped';
    if (s === 'failed') return 'slot-stage--failed';
    if (s === 'billing' || s.includes('billing')) return 'slot-stage--billing';
    if (s === 'starting' || s === 'navigating' || s === 'login') return 'slot-stage--progress';
    return 'slot-stage--progress';
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

evtSource.addEventListener('automationState', (e) => {
    const data = JSON.parse(e.data);
    setSettingsFormDisabled(data.isRunning);
});

evtSource.addEventListener('slotStatus', (e) => {
    const data = JSON.parse(e.data);
    updateSlotStatus(data.slotIndex, data.clientName, data.stage);
});

let lastRequests = [];
let sortDir = {}; // track direction for each field
let selectedIds = new Set(); // which clients are selected to run (stable id per request)
let queueStatusFilter = 'all';
/** Index in getFilteredQueue() for shift-click range selection; -1 = none */
let queueAnchorVisibleIndex = -1;

function requestIdForReq(req) {
    const i = lastRequests.indexOf(req);
    if (i < 0) {
        return req.id != null ? String(req.id) : (req.orderID != null ? String(req.orderID) : 'unknown');
    }
    return requestId(req, i);
}

function normalizedRowStatus(req) {
    return String(req.status || 'pending').toLowerCase();
}

function getFilteredQueue() {
    if (queueStatusFilter === 'all') return lastRequests.slice();
    return lastRequests.filter((r) => normalizedRowStatus(r) === queueStatusFilter);
}

// Drag-to-select over checkboxes
let dragSelectActive = false;
let dragSelectValue = false; // true = selecting, false = deselecting
let dragSelectLastRow = null;

// Handle Queue Updates (Full Refresh) — keep selection by id
evtSource.addEventListener('queue', (e) => {
    const next = JSON.parse(e.data);
    lastRequests = next;
    queueAnchorVisibleIndex = -1;
    renderQueue();
    updateStats(lastRequests);
    updateSelectAllCheckbox();
});

function sortQueue(field) {
    if (!lastRequests.length) return;
    queueAnchorVisibleIndex = -1;

    // Toggle direction
    sortDir[field] = sortDir[field] === 'asc' ? 'desc' : 'asc';
    const dir = sortDir[field] === 'asc' ? 1 : -1;

    lastRequests.sort((a, b) => {
        let valA = field === 'start' ? (a.start || a.date || '') : (a[field] || '');
        let valB = field === 'start' ? (b.start || b.date || '') : (b[field] || '');

        // Handle numeric/date fields if needed, but string comparison is usually fine for these
        if (typeof valA === 'string') valA = valA.toLowerCase();
        if (typeof valB === 'string') valB = valB.toLowerCase();

        if (valA < valB) return -1 * dir;
        if (valA > valB) return 1 * dir;
        return 0;
    });

    renderQueue();
}

const SERVERS = {
    main: 'https://customer.thedietfantasy.com',
    brooklyn: 'https://brooklyn.thedietfantasy.com'
};
const SERVER_STORAGE_KEY = 'df_automation_server';

function getSelectedApiBase() {
    const sel = document.getElementById('serverSelect');
    const id = (sel && sel.value) || localStorage.getItem(SERVER_STORAGE_KEY) || 'main';
    if (sel && sel.value !== id) sel.value = id;
    return (SERVERS[id] || SERVERS.main).replace(/\/$/, '');
}

function persistServerSelection() {
    const sel = document.getElementById('serverSelect');
    if (sel) localStorage.setItem(SERVER_STORAGE_KEY, sel.value);
}

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
    const apiBaseUrl = getSelectedApiBase();
    const date = getBillDate();
    const sel = document.getElementById('serverSelect');
    const account = (sel && sel.value === 'brooklyn') ? 'brooklyn' : 'regular';
    const label = account === 'brooklyn' ? 'Brooklyn' : 'Regular';
    const urlWithQuery = `${apiBaseUrl}/api/bill?date=${date}&account=${account}`;
    log(`Fetching ${label} clients from ${urlWithQuery}...`, 'info');

    fetch('/fetch-all-clients', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiBaseUrl, date, account })
    })
        .then(r => r.json())
        .then(d => {
            if (d.error) {
                log(`Fetch Error: ${d.error}`, 'error');
            } else {
                log(d.message || `Loaded ${d.count} ${label} clients.`, 'success');
                if (d.savedToCache) {
                    const cap = d.cacheLimit != null ? ` (max ${d.cacheLimit} stored on disk)` : '';
                    log(`Saved locally for next time${cap}. Restarts load this list automatically.`, 'info');
                }
            }
        })
        .catch(e => {
            log(`Fetch Failed: ${e.message}`, 'error');
        });
}

function loadSavedQueueFromDisk() {
    log('Loading saved client list from disk…', 'info');
    fetch('/api/load-queue-cache', { method: 'POST' })
        .then(async (r) => {
            const d = await r.json().catch(() => ({}));
            if (!r.ok) {
                throw new Error(d.error || `HTTP ${r.status}`);
            }
            return d;
        })
        .then((d) => {
            log(d.message || `Loaded ${d.count} saved client(s).`, 'success');
        })
        .catch((e) => {
            log(`Load saved list failed: ${e.message}`, 'error');
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

    const apiBaseUrl = getSelectedApiBase();
    const body = { source: 'queue', apiBaseUrl, apiKey: '' };
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
    const visible = getFilteredQueue();
    const n = visible.length;
    if (n === 0) {
        all.checked = false;
        all.indeterminate = false;
        return;
    }
    let selectedVisible = 0;
    for (const req of visible) {
        if (selectedIds.has(requestIdForReq(req))) selectedVisible += 1;
    }
    all.checked = selectedVisible === n;
    all.indeterminate = selectedVisible > 0 && selectedVisible < n;
}

function onSelectAllChange(checked) {
    const visible = getFilteredQueue();
    if (checked) {
        visible.forEach((req) => selectedIds.add(requestIdForReq(req)));
    } else {
        visible.forEach((req) => selectedIds.delete(requestIdForReq(req)));
    }
    renderQueue();
    updateSelectAllCheckbox();
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
        dragSelectLastRow = row;
        const id = row.getAttribute('data-row-id');
        if (id) {
            if (dragSelectValue) selectedIds.add(id);
            else selectedIds.delete(id);
        }
        renderQueue();
        updateSelectAllCheckbox();
        e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
        if (!dragSelectActive) return;
        const row = e.target.closest('tbody#queue-body tr');
        if (!row || row.closest('tbody') !== queueBody) return;
        if (row === dragSelectLastRow) return;
        dragSelectLastRow = row;
        const id = row.getAttribute('data-row-id');
        if (id) {
            if (dragSelectValue) selectedIds.add(id);
            else selectedIds.delete(id);
        }
        renderQueue();
        updateSelectAllCheckbox();
    });

    document.addEventListener('mouseup', () => {
        dragSelectActive = false;
        dragSelectLastRow = null;
    });
}

function setupQueueRowInteractions() {
    queueBody.addEventListener('click', (e) => {
        const cell = e.target.closest('.queue-client-cell');
        if (!cell) return;
        const tr = cell.closest('tr');
        if (!tr) return;
        const id = tr.getAttribute('data-row-id');
        if (!id) return;
        const visibleIdx = parseInt(tr.getAttribute('data-visible-index'), 10);
        const visible = getFilteredQueue();

        if (
            e.shiftKey &&
            queueAnchorVisibleIndex >= 0 &&
            Number.isFinite(visibleIdx) &&
            queueAnchorVisibleIndex < visible.length &&
            visibleIdx < visible.length
        ) {
            const from = Math.min(queueAnchorVisibleIndex, visibleIdx);
            const to = Math.max(queueAnchorVisibleIndex, visibleIdx);
            for (let i = from; i <= to; i++) {
                selectedIds.add(requestIdForReq(visible[i]));
            }
            queueAnchorVisibleIndex = visibleIdx;
        } else {
            if (selectedIds.has(id)) selectedIds.delete(id);
            else selectedIds.add(id);
            queueAnchorVisibleIndex = Number.isFinite(visibleIdx) ? visibleIdx : -1;
        }
        renderQueue();
        updateSelectAllCheckbox();
    });
    queueBody.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const cell = e.target.closest('.queue-client-cell');
        if (!cell) return;
        e.preventDefault();
        const id = cell.closest('tr') && cell.closest('tr').getAttribute('data-row-id');
        if (!id) return;
        if (selectedIds.has(id)) selectedIds.delete(id);
        else selectedIds.add(id);
        renderQueue();
        updateSelectAllCheckbox();
    });
}

function renderQueue() {
    const visible = getFilteredQueue();
    queueBody.innerHTML = '';
    visible.forEach((req, visibleIdx) => {
        const id = requestIdForReq(req);
        const tr = document.createElement('tr');
        tr.setAttribute('data-row-id', id);
        tr.setAttribute('data-visible-index', String(visibleIdx));

        const globalIdx = lastRequests.indexOf(req);
        const rowNum = globalIdx >= 0 ? globalIdx + 1 : '—';

        let statusClass = 'status-pending';
        if (req.status === 'processing') statusClass = 'status-processing';
        if (req.status === 'success') statusClass = 'status-success';
        if (req.status === 'failed') statusClass = 'status-failed';
        if (req.status === 'skipped') statusClass = 'status-skipped';
        if (req.status === 'warning') statusClass = 'status-warning';

        const checked = selectedIds.has(id) ? ' checked' : '';
        if (selectedIds.has(id)) tr.classList.add('row-selected');
        tr.innerHTML = `
            <td class="col-check"><input type="checkbox" class="queue-row-check"${checked}></td>
            <td>${rowNum} <span class="td-muted">(${escapeHtml(String(req.orderID || req.id || '—'))})</span></td>
            <td class="queue-client-cell" tabindex="0" title="Click to toggle. Shift+click another row to select everyone in between.">${escapeHtml(req.name || '')}</td>
            <td>${escapeHtml(req.start ? `${req.start} → ${req.end}` : req.date || '—')}</td>
            <td><span class="status-badge ${statusClass}">${escapeHtml(req.status || 'pending')}</span></td>
            <td class="td-muted">${escapeHtml(req.message || '—')}</td>
        `;
        const cb = tr.querySelector('.queue-row-check');
        if (cb) cb.setAttribute('data-id', id);
        queueBody.appendChild(tr);
    });
    queueBody.querySelectorAll('.queue-row-check').forEach((cb) => {
        cb.addEventListener('change', function () {
            const rid = this.getAttribute('data-id');
            if (selectedIds.has(rid)) selectedIds.delete(rid);
            else selectedIds.add(rid);
            const tr = this.closest('tr');
            tr?.classList.toggle('row-selected', selectedIds.has(rid));
            const v = tr && parseInt(tr.getAttribute('data-visible-index'), 10);
            if (Number.isFinite(v)) queueAnchorVisibleIndex = v;
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
setupQueueRowInteractions();

(function initQueueStatusFilter() {
    const sel = document.getElementById('queue-status-filter');
    if (!sel) return;
    sel.addEventListener('change', () => {
        queueStatusFilter = sel.value || 'all';
        queueAnchorVisibleIndex = -1;
        renderQueue();
        updateSelectAllCheckbox();
    });
})();

(function initSettingsBar() {
    const saveBtn = document.getElementById('btn-save-settings');
    const openBtn = document.getElementById('btn-open-source-files');
    const showBtn = document.getElementById('btn-show-browser');
    const exportBtn = document.getElementById('btn-export-excel');
    if (saveBtn) saveBtn.addEventListener('click', () => saveSettings());
    if (openBtn) openBtn.addEventListener('click', () => openEnvFolder());
    if (showBtn) {
        showBtn.addEventListener('click', async () => {
            if (settingsUiLocked) return;
            const next = !showBtn.classList.contains('btn-toggle--on');
            updateShowBrowserButtonUI(next);
            await persistHeadlessFromShowBrowserButton();
        });
    }
    if (exportBtn) exportBtn.addEventListener('click', () => exportExcel());
    loadSettings();
})();

(function initServerSelect() {
    const sel = document.getElementById('serverSelect');
    if (!sel) return;
    const saved = localStorage.getItem(SERVER_STORAGE_KEY) || 'main';
    sel.value = saved;
    sel.addEventListener('change', persistServerSelection);
})();

initConnectionBadgeTripleClick();
