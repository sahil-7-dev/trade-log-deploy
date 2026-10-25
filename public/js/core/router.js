// ═══════════════════════════════════════════════════════════════════════════
// Router: page registry, sidebar navigation, HTML partial loading, URL hash
// routing and lazy rendering.
//
// Adding a page = public/pages/<id>.html + public/js/pages/<id>.js that calls
//   registerPage('<id>', { title, subtitle, icon, section, order, render(ctx) })
// The sidebar, routing (#/<id>), command palette and rendering pick it up.
//
// Only the page on screen renders. renderAll() (after any data change, and
// every price refresh) re-renders the visible page and marks the rest stale;
// a stale page re-renders when it's opened. Charts belong to their page.
// ═══════════════════════════════════════════════════════════════════════════

const PAGES = {};
const NAV_SECTIONS = ['Trading', 'Investing', 'Money', 'Tools'];
// Modal markup, one file per modal under public/partials/modals/
const MODAL_PARTIALS = ['trade', 'close-trade', 'trade-detail', 'calculator', 'invest', 'close-position',
  'funds', 'profile', 'import', 'report', 'shortcuts'];

let activePage = 'dashboard';
const stalePages = new Set();
let renderCtx = null;

function registerPage(id, def) {
  PAGES[id] = { id, section: 'Tools', order: 99, nav: true, render: () => {}, ...def };
}

// Back-compat for code that looked titles up directly
const PAGE_TITLES = new Proxy({}, { get: (_, id) => PAGES[id] && PAGES[id].title });

// ─── Partials ────────────────────────────────────────────────────────────────
async function loadPartials() {
  const get = async (url) => {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return res.text();
  };
  const pageIds = Object.keys(PAGES);
  // Vercel's cleanUrls and \`npx serve\` serve "pages/x" directly (and redirect
  // "x.html" to it), so the short form saves a redirect per file. Plain static
  // servers — VS Code Live Server, python -m http.server — only know "x.html".
  // One probe decides which form this server understands.
  let ext = '';
  try {
    const probe = await fetch(`pages/${pageIds[0]}`, { cache: 'no-cache' });
    // must be the real partial, not a 404 page or an SPA fallback to index.html
    if (!probe.ok || !(await probe.text()).includes(`id="page-${pageIds[0]}"`)) ext = '.html';
  } catch (e) { ext = '.html'; }
  const [pages, modals] = await Promise.all([
    Promise.all(pageIds.map(id => get(`pages/${id}${ext}`))),
    Promise.all(MODAL_PARTIALS.map(m => get(`partials/modals/${m}${ext}`))),
  ]);
  document.getElementById('page-root').innerHTML = pages.join('\n');
  document.getElementById('modal-root').innerHTML = modals.join('\n');
}

// ─── Navigation ──────────────────────────────────────────────────────────────
function buildNav() {
  const nav = document.getElementById('nav');
  if (!nav) return;
  const list = Object.values(PAGES).filter(p => p.nav).sort((a, b) => a.order - b.order);
  nav.innerHTML = NAV_SECTIONS.map(section => {
    const items = list.filter(p => p.section === section);
    if (!items.length) return '';
    return `<div class="nav-section">${section}</div>` + items.map(p => `
      <a class="nav-item" data-action="show-page" data-page="${p.id}" href="#/${p.id}" title="${esc(p.title)}">
        <span class="icon" aria-hidden="true">${p.icon || '•'}</span>
        <span class="nav-label">${esc(p.title)}</span>
        <span class="nav-badge" id="nav-badge-${p.id}" hidden></span>
      </a>`).join('');
  }).join('');
}

function setNavBadge(pageId, text) {
  const el = document.getElementById('nav-badge-' + pageId);
  if (!el) return;
  el.hidden = !text;
  el.textContent = text || '';
}

// el: optional nav element (kept for older callers); push: update the URL
function showPage(id, el, { push = true } = {}) {
  if (!PAGES[id] || !document.getElementById('page-' + id)) id = 'dashboard';
  // Free the page we're leaving: its charts are destroyed and it re-renders
  // (cheaply) when opened again — memory stays flat however many pages exist.
  if (activePage !== id) { destroyPageCharts(activePage); stalePages.add(activePage); }
  activePage = id;
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === 'page-' + id));
  document.querySelectorAll('.nav-item[data-page]').forEach(n => {
    const on = n.dataset.page === id;
    n.classList.toggle('active', on);
    if (on) n.setAttribute('aria-current', 'page'); else n.removeAttribute('aria-current');
  });
  const page = PAGES[id];
  setText('page-title', page.title);
  setText('page-crumb', page.subtitle || '');
  document.title = `${page.title} · TradeLog`;
  if (push && location.hash !== '#/' + id) history.pushState(null, '', '#/' + id);
  if (stalePages.has(id) && renderCtx) renderPage(id);
  if (page.onShow) page.onShow(renderCtx);
  const content = document.querySelector('.content');
  if (content) content.scrollTop = 0;
  closeSidebar(); // no-op on desktop; closes the mobile drawer after navigating
}

function pageFromHash() {
  const id = (location.hash.match(/^#\/([\w-]+)/) || [])[1];
  return id && PAGES[id] ? id : null;
}
window.addEventListener('popstate', () => { const id = pageFromHash(); if (id) showPage(id, null, { push: false }); });

function toggleSidebar() {
  document.querySelector('.sidebar').classList.toggle('mobile-open');
  document.querySelector('.sidebar-backdrop').classList.toggle('open');
}
function closeSidebar() {
  const s = document.querySelector('.sidebar');
  if (s) s.classList.remove('mobile-open');
  const b = document.querySelector('.sidebar-backdrop');
  if (b) b.classList.remove('open');
}
// Desktop: collapse the sidebar to an icon rail (remembered per browser)
function toggleSidebarCollapsed(force) {
  const on = force ?? !document.body.classList.contains('sidebar-collapsed');
  document.body.classList.toggle('sidebar-collapsed', on);
  try { localStorage.setItem('sidebar_collapsed', on ? '1' : '0'); } catch (e) { /* convenience only */ }
  setTimeout(() => Object.values(chartInstances).forEach(c => c.resize()), 220);
}
ACTIONS['toggle-sidebar-collapsed'] = () => toggleSidebarCollapsed();

// ─── CURRENCY ─────────────────────────────────────────────────────────────────
function setCurrency(c, btn) {
  currency = c;
  document.querySelectorAll('.currency-toggle button').forEach(b => b.classList.toggle('active', b.dataset.currency === c));
  if (btn) btn.classList.add('active');
  renderAll();
}

// ─── RENDERING ───────────────────────────────────────────────────────────────
// ctx: { ranged, stats } — the date-ranged trades and their stats, computed
// once per render and shared by every page.
function renderAll() {
  recomputeBalances(); // balances follow the history (core/balances.js)
  const ranged = tradesInRange();
  renderCtx = { ranged, stats: computeStats(ranged) };
  renderShared(renderCtx);
  Object.keys(PAGES).forEach(id => stalePages.add(id));
  renderPage(activePage);
  RENDER_HOOKS.forEach(fn => {
    try { fn(renderCtx.stats, ranged); } catch (e) { log.error('[renderAll] hook failed:', e); }
  });
}

function renderPage(id) {
  const page = PAGES[id];
  if (!page || !renderCtx) return;
  destroyPageCharts(id);
  renderingPage = id;
  try { page.render(renderCtx); }
  catch (e) { log.error(`[render ${id}]`, e); }
  finally { renderingPage = null; }
  stalePages.delete(id);
}

// Things outside any page: sidebar net worth, nav badges, top bar
function renderShared(ctx) {
  // Sidebar: total net worth across both accounts (it used to show the
  // investing account only, which left the trading balance out)
  const nw = computeNetWorth();
  setHtml('sidebar-equity', bv(fmtVal(nw.total)));
  setHtml('sidebar-change', nw.returnPct != null
    ? `${bv(fmt(nw.gains))} · ${nw.returnPct >= 0 ? '+' : ''}${nw.returnPct.toFixed(1)}% return`
    : nw.gains ? bv(fmt(nw.gains)) + ' gains' : 'No data');
  const change = document.getElementById('sidebar-change');
  if (change) change.style.color = nw.gains < 0 ? 'var(--red)' : '';
  const openCount = TRADES.filter(t => t.status === 'Open').length;
  setNavBadge('trades', openCount ? `${openCount} open` : '');
  setText('page-crumb', (PAGES[activePage] && PAGES[activePage].subtitle) || '');
}
