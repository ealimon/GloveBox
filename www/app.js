(() => {
'use strict';

/* ------------------------------------------------------------------ */
/* Constants & helpers                                                 */
/* ------------------------------------------------------------------ */
const KEY = 'glovebox_v2';
const LEGACY_KEY = 'carLogs';          // v1.0 storage; left untouched as a safety net
const SERVICES = ['Oil Change', 'Tire Rotation', 'Brakes', 'Air Filter', 'Inspection', 'Repair'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => String(s || '').trim().toLowerCase();
const fmtNum = (n) => Number(n).toLocaleString();
const fmtMoney = (n) => Number(n).toLocaleString(undefined, { style: 'currency', currency: 'USD' });

function todayStr() {
    // Local date (toISOString would give the UTC date, wrong near midnight)
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseDate(str) {
    const [y, m, d] = str.split('-').map(Number);
    return new Date(y, m - 1, d);
}
function fmtDate(str) {
    return parseDate(str).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}
function addMonths(str, months) {
    const [y, m, d] = str.split('-').map(Number);
    const first = new Date(y, m - 1 + months, 1);
    const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    first.setDate(Math.min(d, lastDay));
    return first;
}
function daysUntil(date) {
    const t = new Date(); t.setHours(0, 0, 0, 0);
    return Math.round((date - t) / 86400000);
}

/* ------------------------------------------------------------------ */
/* Data layer                                                          */
/* ------------------------------------------------------------------ */
function cleanLog(l, usedIds) {
    if (!l || typeof l !== 'object') return null;
    const carName = String(l.carName || '').trim();
    const type = String(l.type || '').trim();
    const mileage = Number(l.mileage);
    if (!carName || !type || !Number.isFinite(mileage) || mileage < 0) return null;
    let id = Number(l.id);
    if (!Number.isFinite(id)) id = Date.now();
    while (usedIds.has(id)) id++;
    usedIds.add(id);
    const cost = l.cost === '' || l.cost == null ? null : Number(l.cost);
    return {
        id, carName, type, mileage,
        date: DATE_RE.test(l.date) ? l.date : todayStr(),
        cost: Number.isFinite(cost) && cost >= 0 ? cost : null,
        notes: String(l.notes || '').trim(),
    };
}

function normalize(d) {
    d = d && typeof d === 'object' ? d : {};
    const usedIds = new Set();
    const logs = (Array.isArray(d.logs) ? d.logs : []).map((l) => cleanLog(l, usedIds)).filter(Boolean);
    const reminderIds = new Set();
    const reminders = (Array.isArray(d.reminders) ? d.reminders : []).map((r) => {
        if (!r || typeof r !== 'object') return null;
        const carName = String(r.carName || '').trim();
        const type = String(r.type || '').trim();
        const distance = Number(r.distance) > 0 ? Number(r.distance) : null;
        const months = Number(r.months) > 0 ? Number(r.months) : null;
        if (!carName || !type || (!distance && !months)) return null;
        let id = Number(r.id);
        if (!Number.isFinite(id)) id = Date.now();
        while (reminderIds.has(id)) id++;
        reminderIds.add(id);
        return { id, carName, type, distance, months };
    }).filter(Boolean);
    const odometers = {};
    if (d.odometers && typeof d.odometers === 'object') {
        Object.keys(d.odometers).forEach((k) => {
            const v = Number(d.odometers[k]);
            if (Number.isFinite(v) && v >= 0) odometers[norm(k)] = v;
        });
    }
    return {
        version: 2,
        unit: d.unit === 'km' ? 'km' : 'mi',
        lastCar: String(d.lastCar || ''),
        logs, reminders, odometers,
    };
}

function loadState() {
    const raw = localStorage.getItem(KEY);
    if (raw) {
        try {
            return normalize(JSON.parse(raw));
        } catch (e) {
            console.error('Stored data was unreadable, keeping a copy', e);
            try { localStorage.setItem(KEY + '_corrupt_backup', raw); } catch (_) { /* ignore */ }
        }
    }
    // First run of v1.1: migrate v1.0 data
    let legacy = [];
    try { legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || '[]'); } catch (e) { console.error(e); }
    const s = normalize({ logs: Array.isArray(legacy) ? legacy : [] });
    if (s.logs.length) s.lastCar = s.logs[s.logs.length - 1].carName;
    return s;
}

let state;
try { state = loadState(); } catch (e) { console.error(e); state = normalize({}); }

function save() {
    try {
        localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
        console.error(e);
        alert("Couldn't save your data - device storage may be full or restricted.");
    }
}

/* ------------------------------------------------------------------ */
/* Derived data                                                        */
/* ------------------------------------------------------------------ */
let filterCar = '';      // normalized car name, '' = all
let editingId = null;

const sortedLogs = () => state.logs.slice().sort((a, b) =>
    b.date.localeCompare(a.date) || b.mileage - a.mileage || b.id - a.id);

function cars() {
    const seen = new Map();
    state.logs.forEach((l) => { if (!seen.has(norm(l.carName))) seen.set(norm(l.carName), l.carName); });
    state.reminders.forEach((r) => { if (!seen.has(norm(r.carName))) seen.set(norm(r.carName), r.carName); });
    return Array.from(seen, ([key, name]) => ({ key, name })).sort((a, b) => a.name.localeCompare(b.name));
}

function odometer(carKey) {
    const fromLogs = state.logs.reduce((m, l) => (norm(l.carName) === carKey ? Math.max(m, l.mileage) : m), 0);
    return Math.max(fromLogs, state.odometers[carKey] || 0);
}

function lastService(carName, type) {
    return sortedLogs().find((l) => norm(l.carName) === norm(carName) && norm(l.type) === norm(type)) || null;
}

function reminderStatus(r) {
    const last = lastService(r.carName, r.type);
    const out = { r, last, status: 'ok', parts: [], dueDate: null };
    if (!last) { out.status = 'nolog'; return out; }
    const odo = odometer(norm(r.carName));
    let rank = 0; // 0 ok, 1 soon, 2 overdue
    if (r.distance) {
        const remaining = last.mileage + r.distance - odo;
        const soonAt = Math.max(500, r.distance * 0.1);
        if (remaining <= 0) { rank = Math.max(rank, 2); out.parts.push(`${fmtNum(-remaining)} ${state.unit} overdue`); }
        else { if (remaining <= soonAt) rank = Math.max(rank, 1); out.parts.push(`in ${fmtNum(remaining)} ${state.unit}`); }
    }
    if (r.months) {
        out.dueDate = addMonths(last.date, r.months);
        const days = daysUntil(out.dueDate);
        const when = fmtDate(`${out.dueDate.getFullYear()}-${String(out.dueDate.getMonth() + 1).padStart(2, '0')}-${String(out.dueDate.getDate()).padStart(2, '0')}`);
        if (days < 0) { rank = Math.max(rank, 2); out.parts.push(`${-days} day${days === -1 ? '' : 's'} overdue (${when})`); }
        else { if (days <= 30) rank = Math.max(rank, 1); out.parts.push(days === 0 ? `due today (${when})` : `by ${when}`); }
    }
    out.status = ['ok', 'soon', 'overdue'][rank];
    return out;
}

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */
const STATUS_STYLE = {
    overdue: 'bg-red-50 text-red-700 border-red-200',
    soon: 'bg-amber-50 text-amber-700 border-amber-200',
    ok: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    nolog: 'bg-slate-50 text-slate-500 border-slate-200',
};

function render() {
    const carList = cars();
    if (filterCar && !carList.some((c) => c.key === filterCar)) filterCar = '';

    document.querySelectorAll('[data-unit]').forEach((el) => { el.textContent = state.unit; });
    $('unitSelect').value = state.unit;

    // Car / service pickers
    $('carOptions').innerHTML = carList.map((c) => `<option value="${esc(c.name)}">`).join('');
    $('serviceOptions').innerHTML = SERVICES.map((s) => `<option value="${esc(s)}">`).join('');
    const remCar = $('remCar');
    const prevRemCar = remCar.value;
    remCar.innerHTML = carList.length
        ? carList.map((c) => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('')
        : '<option value="">Add a service log first</option>';
    if (carList.some((c) => c.name === prevRemCar)) remCar.value = prevRemCar;

    renderFilter(carList);
    renderSummary();
    renderHistory();
    renderReminders();
}

function renderFilter(carList) {
    const el = $('carFilter');
    if (carList.length < 2) { el.innerHTML = ''; return; }
    const chip = (key, label) => {
        const active = key === filterCar;
        return `<button data-action="filter" data-car="${esc(key)}" class="whitespace-nowrap text-xs font-bold uppercase tracking-wider px-3.5 py-2 rounded-full border ${active ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200'}">${esc(label)}</button>`;
    };
    el.innerHTML = chip('', 'All') + carList.map((c) => chip(c.key, c.name)).join('');
}

function visibleLogs() {
    return sortedLogs().filter((l) => !filterCar || norm(l.carName) === filterCar);
}

function renderSummary() {
    const logs = visibleLogs();
    const el = $('summary');
    if (!state.logs.length) { el.innerHTML = ''; return; }
    const costs = logs.filter((l) => l.cost != null);
    const total = costs.reduce((s, l) => s + l.cost, 0);
    let odoBlock = '';
    if (filterCar) {
        odoBlock = `
        <div class="col-span-2 flex items-center gap-2 pt-3 border-t border-slate-100">
            <label for="odoInput" class="text-xs font-bold uppercase text-slate-500 shrink-0">Current ${esc(state.unit)}</label>
            <input id="odoInput" type="number" inputmode="numeric" min="0" step="1" value="${odometer(filterCar)}" class="min-w-0 flex-1 p-2 bg-slate-50 border border-slate-200 rounded-lg outline-none focus:border-blue-500">
            <button data-action="set-odo" class="text-xs font-bold uppercase tracking-wider text-blue-600 bg-blue-50 px-3 py-2.5 rounded-lg">Update</button>
        </div>`;
    }
    el.innerHTML = `
    <div class="bg-white rounded-xl border border-slate-100 p-4 grid grid-cols-2 gap-3 shadow-sm">
        <div><p class="text-xs font-bold uppercase text-slate-500">Services</p><p class="text-xl font-bold">${logs.length}</p></div>
        <div><p class="text-xs font-bold uppercase text-slate-500">Total spent</p><p class="text-xl font-bold">${costs.length ? esc(fmtMoney(total)) : '&mdash;'}</p></div>
        ${odoBlock}
    </div>`;
}

function renderHistory() {
    const all = state.logs.length;
    $('logCount').textContent = `${all} ${all === 1 ? 'Log' : 'Logs'} Total`;
    const logs = visibleLogs();
    const list = $('logList');
    if (!logs.length) {
        list.innerHTML = '<div class="text-center py-12 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400 italic text-base">No records found.</div>';
        return;
    }
    // Newest entry per car+service gets a "since" counter
    const newest = new Set();
    const newestIds = new Set();
    sortedLogs().forEach((l) => {
        const k = norm(l.carName) + '|' + norm(l.type);
        if (!newest.has(k)) { newest.add(k); newestIds.add(l.id); }
    });
    list.innerHTML = logs.map((l) => {
        const since = newestIds.has(l.id) ? odometer(norm(l.carName)) - l.mileage : 0;
        return `
        <div class="bg-white p-5 rounded-xl shadow-sm border border-slate-100 log-card">
            <div class="flex justify-between items-start gap-2">
                <div class="overflow-hidden min-w-0">
                    <span class="text-sm font-black uppercase bg-slate-900 text-white px-3.5 py-1.5 rounded-lg tracking-wide italic inline-block shadow-sm max-w-full truncate align-bottom">${esc(l.carName)}</span>
                    <p class="font-bold text-slate-800 mt-2.5 text-xl leading-snug tracking-tight break-words">${esc(l.type)}</p>
                    <p class="text-base text-slate-600 font-medium mt-1">${esc(fmtDate(l.date))} &bull; ${esc(fmtNum(l.mileage))} ${esc(state.unit)}${l.cost != null ? ' &bull; ' + esc(fmtMoney(l.cost)) : ''}</p>
                    ${since > 0 ? `<p class="text-sm text-blue-600 font-semibold mt-1">${esc(fmtNum(since))} ${esc(state.unit)} since</p>` : ''}
                    ${l.notes ? `<p class="text-sm text-slate-500 mt-1 break-words">${esc(l.notes)}</p>` : ''}
                </div>
                <div class="flex shrink-0">
                    <button data-action="edit" data-id="${l.id}" class="text-slate-400 hover:text-blue-600 transition-colors p-2" aria-label="Edit entry">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536M9 13l6.768-6.768a2 2 0 112.828 2.828L11.828 15.83a2 2 0 01-.89.514L7 17l.656-3.938A2 2 0 018.17 12.17L9 13z"/></svg>
                    </button>
                    <button data-action="delete" data-id="${l.id}" class="text-slate-400 hover:text-red-500 transition-colors p-2" aria-label="Delete entry">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                    </button>
                </div>
            </div>
        </div>`;
    }).join('');
}

function renderReminders() {
    const statuses = state.reminders.map(reminderStatus);
    const list = $('reminderList');
    list.innerHTML = statuses.length ? statuses.map((s) => {
        const r = s.r;
        const every = [r.distance ? `${fmtNum(r.distance)} ${state.unit}` : '', r.months ? `${r.months} mo` : ''].filter(Boolean).join(' / ');
        const detail = s.status === 'nolog' ? 'Log this service to start tracking' : s.parts.join(' &bull; ');
        return `
        <div class="border rounded-xl p-3.5 flex justify-between items-center gap-2 ${STATUS_STYLE[s.status]}">
            <div class="min-w-0">
                <p class="font-bold break-words">${esc(r.carName)} &middot; ${esc(r.type)}</p>
                <p class="text-base">Every ${esc(every)}</p>
                <p class="text-base font-semibold">${detail}</p>
            </div>
            <button data-action="delete-reminder" data-id="${r.id}" class="p-2 opacity-70" aria-label="Delete reminder">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
        </div>`;
    }).join('') : '<p class="text-base text-slate-400 italic">No reminders yet.</p>';

    const due = statuses.filter((s) => s.status === 'overdue' || s.status === 'soon')
        .sort((a, b) => (a.status === 'overdue' ? 0 : 1) - (b.status === 'overdue' ? 0 : 1));
    const banner = $('dueBanner');
    if (!due.length) { banner.classList.add('hidden'); banner.innerHTML = ''; return; }
    banner.classList.remove('hidden');
    banner.innerHTML = `
    <div class="bg-white rounded-2xl border border-slate-100 shadow-sm p-4 space-y-2">
        <h2 class="text-base font-black uppercase tracking-widest text-slate-500">Needs Attention</h2>
        ${due.map((s) => `<div class="border rounded-lg px-3 py-2 ${STATUS_STYLE[s.status]}"><span class="font-bold">${esc(s.r.carName)} &middot; ${esc(s.r.type)}</span><br><span class="text-base">${s.parts.join(' &bull; ')}</span></div>`).join('')}
    </div>`;
}

/* ------------------------------------------------------------------ */
/* Form: add / edit service logs                                       */
/* ------------------------------------------------------------------ */
function buildServiceOptions() {
    $('serviceType').innerHTML = SERVICES.map((s) => `<option>${esc(s)}</option>`).join('')
        + '<option value="custom">Custom (Enter manually)...</option>';
}

function toggleCustomServiceInput() {
    const custom = $('serviceType').value === 'custom';
    $('customServiceContainer').classList.toggle('hidden', !custom);
    $('customService').required = custom;
    if (custom) $('customService').focus(); else $('customService').value = '';
}

function resetForm() {
    editingId = null;
    $('logForm').reset();
    $('carName').value = state.lastCar || '';
    $('date').value = todayStr();
    toggleCustomServiceInput();
    $('formTitle').textContent = 'Add New Entry';
    $('submitBtn').textContent = 'Save Service Log';
    $('cancelEditBtn').classList.add('hidden');
}

function startEdit(id) {
    const log = state.logs.find((l) => l.id === id);
    if (!log) return;
    editingId = id;
    $('carName').value = log.carName;
    if (SERVICES.includes(log.type)) {
        $('serviceType').value = log.type;
    } else {
        $('serviceType').value = 'custom';
    }
    toggleCustomServiceInput();
    if ($('serviceType').value === 'custom') $('customService').value = log.type;
    $('mileage').value = log.mileage;
    $('date').value = log.date;
    $('cost').value = log.cost == null ? '' : log.cost;
    $('notes').value = log.notes;
    $('formTitle').textContent = 'Edit Entry';
    $('submitBtn').textContent = 'Update Service Log';
    $('cancelEditBtn').classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function onSubmitLog(e) {
    e.preventDefault();
    let type = $('serviceType').value;
    if (type === 'custom') type = $('customService').value.trim() || 'Custom Service';
    const carName = $('carName').value.trim();
    const mileage = parseFloat($('mileage').value);
    if (!carName) { alert('Please enter a car nickname.'); return; }
    if (!Number.isFinite(mileage) || mileage < 0) { alert('Please enter a valid mileage.'); return; }
    const costRaw = $('cost').value;
    const entry = {
        carName, type, mileage,
        date: $('date').value || todayStr(),
        cost: costRaw === '' ? null : Math.max(0, parseFloat(costRaw)),
        notes: $('notes').value.trim(),
    };
    if (editingId != null) {
        const i = state.logs.findIndex((l) => l.id === editingId);
        if (i >= 0) state.logs[i] = Object.assign({ id: editingId }, entry);
    } else {
        let id = Date.now();
        const ids = new Set(state.logs.map((l) => l.id));
        while (ids.has(id)) id++;
        state.logs.push(Object.assign({ id }, entry));
    }
    state.lastCar = carName;
    save();
    resetForm();
    render();
    syncNotifications();
}

function onSubmitReminder(e) {
    e.preventDefault();
    const carName = $('remCar').value;
    const type = $('remType').value.trim();
    const distance = parseFloat($('remDistance').value);
    const months = parseFloat($('remMonths').value);
    if (!carName) { alert('Add a service log for your car first.'); return; }
    if (!type) { alert('Enter a service name.'); return; }
    if (!(distance > 0) && !(months > 0)) { alert('Enter a distance, a number of months, or both.'); return; }
    let id = Date.now();
    const ids = new Set(state.reminders.map((r) => r.id));
    while (ids.has(id)) id++;
    state.reminders.push({ id, carName, type, distance: distance > 0 ? distance : null, months: months > 0 ? months : null });
    save();
    $('reminderForm').reset();
    render();
    syncNotifications(true);
}

/* ------------------------------------------------------------------ */
/* Local notifications (native iOS only)                               */
/* ------------------------------------------------------------------ */
const notifPlugin = () => window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.LocalNotifications;

async function syncNotifications(askPermission) {
    const LN = notifPlugin();
    if (!LN) return;
    try {
        let perm = await LN.checkPermissions();
        if (perm.display !== 'granted') {
            if (!askPermission || perm.display === 'denied') return;
            perm = await LN.requestPermissions();
            if (perm.display !== 'granted') return;
        }
        const pending = await LN.getPending();
        if (pending.notifications && pending.notifications.length) {
            await LN.cancel({ notifications: pending.notifications.map((n) => ({ id: n.id })) });
        }
        const now = Date.now();
        const notifications = [];
        let nextId = 1;
        state.reminders.forEach((r) => {
            if (!r.months) return;
            const last = lastService(r.carName, r.type);
            if (!last) return;
            const due = addMonths(last.date, r.months);
            due.setHours(9, 0, 0, 0);
            const week = new Date(due.getTime() - 7 * 86400000);
            if (week.getTime() > now) {
                notifications.push({ id: nextId++, title: 'Service due in a week', body: `${r.carName}: ${r.type}`, schedule: { at: week } });
            }
            if (due.getTime() > now) {
                notifications.push({ id: nextId++, title: 'Service due today', body: `${r.carName}: ${r.type}`, schedule: { at: due } });
            }
        });
        if (notifications.length) await LN.schedule({ notifications });
    } catch (err) {
        console.error('Notification sync failed', err);
    }
}

/* ------------------------------------------------------------------ */
/* Export / backup / restore                                           */
/* ------------------------------------------------------------------ */
async function shareOrDownload(fileName, data, mime, title) {
    const plugins = window.Capacitor && window.Capacitor.Plugins;
    if (plugins && plugins.Filesystem && plugins.Share) {
        // Native: write to app cache, then hand off to the iOS Share Sheet
        // so the user can save to Files, AirDrop, email, etc.
        try {
            const { uri } = await plugins.Filesystem.writeFile({ path: fileName, data, directory: 'CACHE', encoding: 'utf8' });
            await plugins.Share.share({ title, url: uri, dialogTitle: 'Save or share' });
        } catch (err) {
            // Dismissing the share sheet rejects on some versions; only report real failures
            if (!/cancel/i.test(String(err && err.message ? err.message : err))) {
                console.error('Export failed', err);
                alert("Couldn't export: " + (err && err.message ? err.message : err));
            }
        }
        return;
    }
    // Desktop browser fallback
    const blob = new Blob([data], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.hidden = true; a.href = url; a.download = fileName;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

function csvCell(v) {
    let s = String(v == null ? '' : v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;   // block spreadsheet formula injection
    return '"' + s.replace(/"/g, '""') + '"';
}

function exportCSV() {
    if (!state.logs.length) { alert('No logs to export!'); return; }
    const rows = [['Date', 'Car', 'Service', 'Mileage', 'Unit', 'Cost', 'Notes']];
    sortedLogs().reverse().forEach((l) => rows.push([l.date, l.carName, l.type, l.mileage, state.unit, l.cost == null ? '' : l.cost.toFixed(2), l.notes]));
    const csv = rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
    shareOrDownload(`GloveBox_Maintenance_History_${Date.now()}.csv`, csv, 'text/csv', 'GloveBox Maintenance History');
}

function exportBackup() {
    const payload = Object.assign({ app: 'GloveBox', exportedAt: new Date().toISOString() }, state);
    shareOrDownload(`GloveBox_Backup_${todayStr()}.json`, JSON.stringify(payload, null, 2), 'application/json', 'GloveBox Backup');
}

let restoreMode = 'merge';
function pickRestore(mode) {
    restoreMode = mode;
    $('restoreFile').value = '';
    $('restoreFile').click();
}

async function onRestoreFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    let incoming;
    try {
        const parsed = JSON.parse(await file.text());
        // Accept v2 backups, or a bare array of v1.0 logs
        incoming = normalize(Array.isArray(parsed) ? { logs: parsed } : parsed);
    } catch (err) {
        alert("That file isn't a valid GloveBox backup.");
        return;
    }
    if (!incoming.logs.length && !incoming.reminders.length) { alert('That backup has no entries.'); return; }
    const msg = restoreMode === 'replace'
        ? `Replace ALL current data with ${incoming.logs.length} log(s) and ${incoming.reminders.length} reminder(s) from this backup?`
        : `Add ${incoming.logs.length} log(s) and ${incoming.reminders.length} reminder(s) from this backup to your current data?`;
    if (!confirm(msg)) return;

    if (restoreMode === 'replace') {
        state = incoming;
    } else {
        const sig = (l) => [l.date, norm(l.carName), norm(l.type), l.mileage].join('|');
        const have = new Set(state.logs.map(sig));
        const ids = new Set(state.logs.map((l) => l.id));
        incoming.logs.forEach((l) => {
            if (have.has(sig(l))) return;
            while (ids.has(l.id)) l.id++;
            ids.add(l.id);
            state.logs.push(l);
        });
        const rsig = (r) => [norm(r.carName), norm(r.type)].join('|');
        const haveR = new Set(state.reminders.map(rsig));
        incoming.reminders.forEach((r) => { if (!haveR.has(rsig(r))) { r.id = Date.now() + state.reminders.length; state.reminders.push(r); } });
        Object.keys(incoming.odometers).forEach((k) => { state.odometers[k] = Math.max(state.odometers[k] || 0, incoming.odometers[k]); });
    }
    save();
    resetForm();
    render();
    syncNotifications(true);
}

/* ------------------------------------------------------------------ */
/* Events                                                              */
/* ------------------------------------------------------------------ */
document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    switch (btn.dataset.action) {
        case 'filter': filterCar = btn.dataset.car; render(); break;
        case 'edit': startEdit(id); break;
        case 'cancel-edit': resetForm(); break;
        case 'delete':
            if (confirm('Delete this record?')) {
                state.logs = state.logs.filter((l) => l.id !== id);
                if (editingId === id) resetForm();
                save(); render(); syncNotifications();
            }
            break;
        case 'delete-reminder':
            state.reminders = state.reminders.filter((r) => r.id !== id);
            save(); render(); syncNotifications();
            break;
        case 'set-odo': {
            const v = parseFloat($('odoInput').value);
            if (!Number.isFinite(v) || v < 0) { alert('Enter a valid mileage.'); break; }
            state.odometers[filterCar] = v;
            save(); render();
            break;
        }
        case 'export-csv': exportCSV(); break;
        case 'export-json': exportBackup(); break;
        case 'restore-merge': pickRestore('merge'); break;
        case 'restore-replace': pickRestore('replace'); break;
        case 'clear':
            if (confirm('DANGER: This will permanently delete ALL logs and reminders from this device. Proceed?')) {
                state = normalize({ unit: state.unit });
                try { localStorage.removeItem(LEGACY_KEY); } catch (_) { /* ignore */ }
                save(); resetForm(); render(); syncNotifications();
            }
            break;
    }
});

$('logForm').addEventListener('submit', onSubmitLog);
$('reminderForm').addEventListener('submit', onSubmitReminder);
$('serviceType').addEventListener('change', toggleCustomServiceInput);
$('restoreFile').addEventListener('change', onRestoreFile);
$('unitSelect').addEventListener('change', (e) => {
    state.unit = e.target.value === 'km' ? 'km' : 'mi';
    save(); render();
});

/* ------------------------------------------------------------------ */
/* Init                                                                */
/* ------------------------------------------------------------------ */
buildServiceOptions();
resetForm();
render();
save();                       // persists the v1 -> v2 migration
syncNotifications();

// PWA offline support (browsers only; the native iOS app bundles its files)
if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker not registered', err));
}
})();
