// ═══════════════════════════════════════════════════════════════════════════
// Shared UI plumbing, loaded BEFORE every other script.
//
// app.js owns the single set of delegated click/change/input listeners (the
// strict CSP forbids inline handlers) and renderAll(). Feature files register
// into these tables instead of editing that one switch statement:
//   ACTIONS[name]          — data-action="name" clicks: (el, event) => void
//   CHANGE_HANDLERS[id]    — 'change' on the element with that id: (el) => void
//   INPUT_HANDLERS[id]     — 'input' on the element with that id: (el) => void
//   RENDER_HOOKS.push(fn)  — called at the end of renderAll(stats)
// Feature files only DEFINE things at load time; anything touching app.js
// state runs later, from these hooks — so load order between them is free.
// ═══════════════════════════════════════════════════════════════════════════

const ACTIONS = {};
const CHANGE_HANDLERS = {};
const INPUT_HANDLERS = {};
const RENDER_HOOKS = [];

// ─── CONFIRM DIALOG (replaces the browser's confirm()) ───────────────────────
// Returns a Promise<boolean>. Built lazily so there's no markup to keep in
// sync in index.html.
function confirmDialog({ title = 'Are you sure?', message = '', confirmText = 'Confirm', danger = false } = {}) {
  let overlay = document.getElementById('confirm-modal');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'confirm-modal';
    overlay.innerHTML = `
      <div class="modal" style="width:400px">
        <div class="modal-title" id="confirm-title"></div>
        <div id="confirm-message" style="font-size:12px;color:var(--muted);line-height:1.6;white-space:pre-line"></div>
        <div class="modal-actions">
          <button class="btn btn-ghost" id="confirm-cancel">Cancel</button>
          <button class="btn btn-primary" id="confirm-ok">Confirm</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
  }
  overlay.querySelector('#confirm-title').textContent = title;
  overlay.querySelector('#confirm-message').textContent = message;
  const ok = overlay.querySelector('#confirm-ok');
  ok.textContent = confirmText;
  ok.style.background = danger ? 'var(--red)' : '';
  ok.style.color = danger ? '#fff' : '';

  return new Promise(resolve => {
    const done = (result) => {
      overlay.classList.remove('open');
      ok.onclick = null;
      overlay.querySelector('#confirm-cancel').onclick = null;
      overlay.onclick = null;
      document.removeEventListener('keydown', onKey);
      resolve(result);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') done(false);
      if (e.key === 'Enter') done(true);
    };
    ok.onclick = () => done(true);
    overlay.querySelector('#confirm-cancel').onclick = () => done(false);
    overlay.onclick = (e) => { if (e.target === overlay) done(false); };
    document.addEventListener('keydown', onKey);
    overlay.classList.add('open');
    ok.focus();
  });
}

// ─── TOAST WITH AN ACTION BUTTON (e.g. "Undo") ───────────────────────────────
let actionToastTimer = null;
function toastAction(message, actionLabel, onAction, ms = 7000) {
  const el = document.getElementById('toast');
  if (!el) return;
  clearTimeout(actionToastTimer);
  el.textContent = '';
  const text = document.createElement('span');
  text.textContent = message;
  const btn = document.createElement('button');
  btn.className = 'toast-action';
  btn.textContent = actionLabel;
  btn.onclick = async () => {
    btn.disabled = true;
    clearTimeout(actionToastTimer);
    el.className = '';
    try { await onAction(); } catch (e) { toast(e.message || 'Undo failed', 'err'); }
  };
  el.append(text, btn);
  el.className = 'show ok with-action';
  actionToastTimer = setTimeout(() => { el.className = ''; }, ms);
}

// ─── SMALL SHARED HELPERS ────────────────────────────────────────────────────
const round2 = n => Math.round((parseFloat(n) || 0) * 100) / 100;
const sum = (arr, fn = x => x) => arr.reduce((s, x) => s + (fn(x) || 0), 0);
const uuid = () => (crypto.randomUUID ? crypto.randomUUID()
  : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    }));

// YYYY-MM-DD of a Date (or ISO string) in the user's own timezone
function localDateOf(d) {
  d = d instanceof Date ? d : new Date(d);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// Value for <input type="datetime-local"> in local time
function toDatetimeLocal(d) {
  d = d instanceof Date ? d : new Date(d);
  if (isNaN(d)) return '';
  return `${localDateOf(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
// 3d 4h / 5h 12m / 9m
function fmtDuration(ms) {
  if (!(ms > 0)) return '—';
  const m = Math.round(ms / 60000), h = Math.floor(m / 60), d = Math.floor(h / 24);
  if (d > 0) return `${d}d ${h % 24}h`;
  if (h > 0) return `${h}h ${m % 60}m`;
  return `${m}m`;
}

// Download any text as a file (CSV, JSON...)
function downloadFile(filename, text, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Set innerHTML / className by id, ignoring ids not on the page
function setHtml(id, html) { const el = document.getElementById(id); if (el) el.innerHTML = html; }
function setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }
function setValClass(id, positive) {
  const el = document.getElementById(id);
  if (el) el.className = 'stat-val ' + (positive ? 'green' : 'red');
}
