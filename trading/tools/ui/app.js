/* trading/ui/app.js — the SHELL runtime for the Trading surface (ADR-136 D1/D2).
 *
 * Classic script on purpose (not an ES module): every view module is plain global functions, which
 * is exactly what the pre-split single-file page was, so existing tab code moves in verbatim. Load
 * order in trading.html: app.js → view modules → boot().
 *
 * INFORMATION ARCHITECTURE (operator direction 2026-09-03):
 *   VIEW 'accounts'   — the landing page: every account as a tile; click one → 'account'.
 *   VIEW 'account'    — ONE account's detail (KPIs, Buy a stock, positions, focus pane, journal, perf).
 *   VIEW 'strategies' — the per-account strategy roster FIRST (never buried), then Lab/Studio/Tuning.
 *   VIEW 'research'   — market-wide: Recommendations, Algorithms, Capture & signals.
 *   VIEW 'reports'    — Performance + Trade journal across accounts.
 * URL contract: ?view=<view>&book=<ref>&sub=<subtab>. Legacy ?tab= deep links map onto it.
 *
 * View modules define: renderAccountsView(token), renderAccountView(token), renderStrategiesView(token),
 * renderResearchView(token), renderReportsView(token). Each paints into #main and may call
 * subTabs(hostId, TABS, active, onSelect) — which provides the legacy #tabbody host the moved code
 * renders into. stale(token) tells an async loader the operator navigated away: stop painting.
 */

const $ = (id) => document.getElementById(id);
const main = $('main');

/* ── state ─────────────────────────────────────────────────────────────────── */
let MODE = 'paper';          // kind of the selected book: 'paper' | 'live'
/* ADR-134: the BOOK is the unit every fetch scopes to. Legacy refs 'paper'/'live' ARE the two
   classic books; discovered-account books carry 'b-xxxxxxxx' refs. The server's resolveBook
   accepts all three shapes. */
let BOOK = 'paper';
let BOOKS = [];              // [{bookId, ref, kind, enabled, label, accountMasked, strategy…}] from GET /accounts
let ACCOUNTS = [];           // discovered broker accounts from GET /accounts (tiles + roster)
let STATUS = { liveEnabled:false, paperConfigured:false, liveConfigured:false, bookConfigured:undefined, bookEnabled:undefined, guardrails:{} };
let STATE = { equity:0, positions:[], posSort:{ key:'marketValue', dir:-1 } };
let UNIVERSE = {};           // symbol -> { symbol, price, changePct, conviction, stance, held, avg, signals }
let CURRENT = null;          // focused symbol (account view)
let RENDER_TOKEN = 0;        // bumped on every navigation; async loaders bail if it moved under them
let SUB_GEN = 0;             // bumped on every sub-tab switch; the #tabbody carries it as data-gen
let PENDING_FOCUS = null;    // a symbol to focus once the account view has painted (Focus → from other views)
let DISP = 'paper';          // human label of the selected book, for dialogs and headers
let FOC_TF = '1Day';
let PERF_PERIOD = '1M';
let VIEW = 'accounts';
let SUB = null;              // active sub-tab within the view (null = the view's default)
const VIEWS = ['accounts','account','strategies','research','reports'];
/* Legacy ?tab= deep links (and the moved code's selectTab('…') calls) → where that content lives now. */
const LEGACY_TAB = {
  journal:['account','journal'], perf:['account','perf'],
  lab:['strategies','lab'], studio:['strategies','studio'], tuning:['strategies','tuning'], accounts:['strategies','roster'],
  reco:['research','reco'], algos:['research','algos'], capture:['research','capture'],
  summary:['accounts', null],
};
let TAB = 'journal';         // legacy alias some moved code reads; kept in sync with SUB

(function initFromUrl() {
  try {
    const q = new URLSearchParams(location.search);
    const legacy = q.get('tab') || (location.hash.match(/tab=([a-z]+)/i) || [])[1];
    const view = q.get('view');
    if (view && VIEWS.includes(view)) { VIEW = view; SUB = q.get('sub') || null; }
    else if (legacy && LEGACY_TAB[legacy]) { VIEW = LEGACY_TAB[legacy][0]; SUB = LEGACY_TAB[legacy][1]; }
    const book = q.get('book');
    if (book) { BOOK = book; MODE = book === 'paper' ? 'paper' : 'live'; }
    if (VIEW === 'account' && !q.get('book')) VIEW = 'accounts';
  } catch { /* defaults stand */ }
})();

/* ── formatting helpers (shared by every view) ─────────────────────────────── */
const money = (n) => (n < 0 ? '-$' : '$') + Math.abs(Number(n||0)).toLocaleString(undefined, { maximumFractionDigits: 2 });
const pct = (n) => (n>=0?'+':'') + Number(n||0).toFixed(2) + '%';
const fmtDate = (iso) => { try { return new Date(iso).toLocaleString(); } catch { return iso || '—'; } };
/* Escapes for text AND attribute values (quotes included — a label with an apostrophe must not break
   an attribute). NEVER interpolate esc()'d labels into inline onclick JS strings: pass ids and look the
   label up at call time instead (the roster/tiles do exactly that). */
const esc = (s) => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
const cls = (n) => Number(n)>0?'pos':(Number(n)<0?'neg':'');
const gColor = (g) => g>=58 ? '#34c79a' : g>=46 ? '#e3bd6a' : '#ec7672';
/* one detail stat tile + a combined "$ amount (with %)" cell, colored by sign */
const st = (l, v) => '<div class="st"><div class="l">' + l + '</div><div class="v">' + v + '</div></div>';
const dollarPctCell = (d, p) => {
  const ref = d!=null ? d : (p!=null ? p : 0);
  const klass = ref>=0 ? 'ok' : 'err';
  const dPart = d!=null ? money(d) : '—';
  const pPart = p!=null ? ' <span style="font-size:11px;font-weight:700">' + pct(p) + '</span>' : '';
  return '<span class="' + klass + '">' + dPart + pPart + '</span>';
};
const spinner = (msg) => '<div class="spin"><span class="dot"></span> ' + esc(msg || 'Loading…') + '</div>';
/* JSON POST/PATCH options; api() injects book+mode into the body. */
const jbody = (method, obj) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj || {}) });

/* ── API ───────────────────────────────────────────────────────────────────── */
async function api(path, opts) {
  const sep = path.includes('?') ? '&' : '?';
  // book= scopes every read/write to the selected book (server-side resolveBook maps the legacy
  // 'paper'/'live' aliases to the classic books).
  opts = Object.assign({ credentials: 'include' }, opts || {});
  // CRITICAL (surface-audit 2026-09-03): trading POST routes historically read the book from the
  // request BODY while this helper only put it in the QUERY — an order placed with a live/account
  // book selected was recorded and executed on the LEGACY PAPER book. Inject book (and mode) into
  // JSON bodies too, without clobbering an explicit book the caller already set. Routes now also
  // read the query first; both ends hold.
  if (opts.body && typeof opts.body === 'string' && (opts.headers && /application\/json/i.test(opts.headers['Content-Type'] || ''))) {
    try {
      const parsed = JSON.parse(opts.body);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        if (parsed.book === undefined) parsed.book = BOOK;
        if (parsed.mode === undefined) parsed.mode = MODE;
        opts.body = JSON.stringify(parsed);
      }
    } catch { /* non-object body — leave it */ }
  }
  const r = await fetch('/api/trading' + path + sep + 'book=' + encodeURIComponent(BOOK) + '&mode=' + MODE, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.message || j.error || ('HTTP ' + r.status));
  return j;
}

/* ── books ─────────────────────────────────────────────────────────────────── */
function bookOf(ref) { return BOOKS.find(b => b.ref === ref) || null; }
/* Human label: the account nickname/type + masked number when known; never a bare 'live'. */
function bookLabel(ref) {
  const b = bookOf(ref);
  if (!b) return ref === 'paper' ? 'Paper (reference book)' : (ref === 'live' ? 'Live (legacy account)' : ref);
  if (b.label && b.label !== b.ref) return b.label + (b.accountMasked && !b.label.includes(b.accountMasked) ? ' ' + b.accountMasked : '');
  if (ref === 'paper') return 'Paper (reference book)';
  if (ref === 'live') return 'Live' + (b.accountMasked ? ' ' + b.accountMasked : ' (legacy account)');
  return b.ref + (b.accountMasked ? ' ' + b.accountMasked : '');
}
async function loadBooks() {
  const j = await api('/accounts');
  BOOKS = j.books || [];
  ACCOUNTS = j.accounts || [];
  const b = bookOf(BOOK); if (b) MODE = b.kind;
  return j;
}

/* ── navigation ────────────────────────────────────────────────────────────── */
function syncUrl() {
  try {
    const p = new URLSearchParams(location.search);
    ['tab','view','book','sub'].forEach(k => p.delete(k));
    p.set('view', VIEW);
    p.set('book', BOOK);            // every view acts on the selected account — keep it in the URL
    if (SUB) p.set('sub', SUB);
    history.replaceState(null, '', location.pathname + '?' + p.toString());
  } catch { /* history unavailable in some embeds */ }
}
/* The ONE way to move between views. Clears the per-symbol cache + focus and bumps RENDER_TOKEN so
   a stale in-flight response from the previous screen can never paint this one (surface-audit). */
function navigate(view, opts) {
  opts = opts || {};
  VIEW = VIEWS.includes(view) ? view : 'accounts';
  SUB = opts.sub === undefined ? null : opts.sub;
  if (opts.book) {
    BOOK = opts.book;
    const b = bookOf(opts.book);
    MODE = opts.kind || (b && b.kind) || (opts.book === 'paper' ? 'paper' : 'live');
  }
  UNIVERSE = {}; CURRENT = null;
  RENDER_TOKEN += 1;
  if (typeof closeTicket === 'function') closeTicket();   // a ticket minted on one account never survives a switch
  syncUrl();
  render();
}
function openAccount(ref, kind) { navigate('account', { book: ref, kind, sub: (VIEW === 'account' && SUB) ? SUB : null }); }
/* Legacy shims — the moved view code still calls these. */
function setBook(ref, kind) { openAccount(ref, kind); }
function setMode(m) { setBook(m, m); }
function selectTab(k) {
  const m = LEGACY_TAB[k]; if (!m) return;
  if (m[0] === 'account') navigate('account', { book: BOOK, kind: MODE, sub: m[1] });
  else navigate(m[0], { sub: m[1] });
}
/* Sub-tab bar inside a view. Renders the bar + the #tabbody host the legacy loaders paint into. */
function subTabs(hostId, tabs, active, onSelect) {
  const host = $(hostId); if (!host) return;
  if (!tabs.some(([k]) => k === active)) { active = tabs[0][0]; SUB = active; syncUrl(); }   // a sub from another view → this view's default
  SUB_GEN += 1;
  host.innerHTML = '<div class="tabbar">' + tabs.map(([k,l]) => '<button data-tab="' + k + '"' + (k===active?' class="on"':'') + '>' + l + '</button>').join('') + '</div><div id="tabbody" data-gen="' + SUB_GEN + '"></div>';
  host.querySelectorAll('.tabbar button').forEach(b => b.onclick = () => {
    SUB = b.getAttribute('data-tab'); TAB = SUB; syncUrl();
    host.querySelectorAll('.tabbar button').forEach(x => x.className = x === b ? 'on' : '');
    const body = $('tabbody'); if (body) { body.innerHTML = ''; SUB_GEN += 1; body.setAttribute('data-gen', String(SUB_GEN)); }
    onSelect(SUB);
  });
  TAB = active;
  onSelect(active);
}
/* Sub-tab generation: a loader captures tabGen() before its await and bails via tabStale(gen) after,
   so a slow response for the PREVIOUS sub-tab never paints over the one the operator switched to. */
function tabGen() { const b = $('tabbody'); return b ? b.getAttribute('data-gen') : null; }
function tabStale(gen) { return tabGen() !== gen; }
function stale(token) { return token !== RENDER_TOKEN; }
/* "Acting on: <account>" — the account context bar for the platform views (Strategies / Research /
   Reports). Switching re-renders the view through navigate(), so the token bumps, the URL updates
   and DISP follows — never a silent in-place rewrite of BOOK. */
function acctContextBar(note) {
  const opts = BOOKS.map(b => '<option value="' + esc(b.ref) + '"' + (b.ref === BOOK ? ' selected' : '') + '>' + esc(bookLabel(b.ref)) + (b.enabled ? '' : ' — view only') + '</option>').join('') +
    (bookOf(BOOK) ? '' : '<option value="' + esc(BOOK) + '" selected>' + esc(bookLabel(BOOK)) + '</option>');
  return '<div class="panel" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 14px">' +
    '<span class="foot" style="margin:0">ACTING ON</span> <select id="ctxBook" style="width:auto;min-width:220px;padding:6px 9px">' + opts + '</select>' +
    (bookOf(BOOK) && bookOf(BOOK).enabled === false ? ' <span class="pill">view-only</span>' : (MODE === 'live' ? ' <span class="pill" style="color:var(--warn);border-color:var(--warn)">live</span>' : '')) +
    (note ? ' <span class="sub" style="margin-left:6px">' + note + '</span>' : '') +
    ' <a href="#" style="margin-left:auto" onclick="openAccount(BOOK, MODE);return false">Open this account →</a></div>';
}
function wireAcctContextBar() {
  const sel = $('ctxBook'); if (!sel) return;
  sel.onchange = () => { const b = bookOf(sel.value); navigate(VIEW, { book: sel.value, kind: b ? b.kind : (sel.value === 'paper' ? 'paper' : 'live'), sub: SUB }); };
}

/* ── header ────────────────────────────────────────────────────────────────── */
function renderNav() {
  const navView = VIEW === 'account' ? 'accounts' : VIEW;
  document.querySelectorAll('#nav button').forEach(b => b.className = b.getAttribute('data-view') === navView ? 'on' : '');
  const ctx = $('acctCtx'); if (ctx) ctx.hidden = VIEW !== 'account';
  if (VIEW === 'account') {
    const sel = $('bookSel');
    if (sel) {
      sel.innerHTML = BOOKS.map(b => '<option value="' + esc(b.ref) + '">' + esc(bookLabel(b.ref)) + (b.enabled ? '' : ' — view only') + '</option>').join('');
      if (!bookOf(BOOK)) sel.innerHTML += '<option value="' + esc(BOOK) + '">' + esc(BOOK) + '</option>';
      sel.value = BOOK;
    }
    const dot = $('engineDot'); const b = bookOf(BOOK);
    if (dot) dot.style.background = b && b.enabled === false ? 'var(--muted)' : (MODE === 'live' ? 'var(--warn)' : 'var(--buy)');
    $('engineState').textContent = bookLabel(BOOK);
  }
}

/* ── main render ───────────────────────────────────────────────────────────── */
async function render() {
  const token = RENDER_TOKEN;
  DISP = bookLabel(BOOK);
  renderNav();
  main.innerHTML = spinner('Loading…');
  try {
    // /status is scoped to BOOK. Assign it only if THIS render is still current (a slow response for
    // the previous account must not overwrite the current account's view-only/guardrail truth). On a
    // non-account view a failed /status is not fatal — the view still renders with safe defaults.
    let s = null;
    try { s = await api('/status'); } catch (e) { if (VIEW === 'account') throw e; }
    if (stale(token)) return;
    STATUS = s || { liveEnabled:false, paperConfigured:false, liveConfigured:false, bookConfigured:undefined, bookEnabled:undefined, guardrails:{}, unavailable:true };
    const fn = ({ accounts: typeof renderAccountsView === 'function' && renderAccountsView,
                  account: typeof renderAccountView === 'function' && renderAccountView,
                  strategies: typeof renderStrategiesView === 'function' && renderStrategiesView,
                  research: typeof renderResearchView === 'function' && renderResearchView,
                  reports: typeof renderReportsView === 'function' && renderReportsView })[VIEW];
    if (!fn) { main.innerHTML = '<div class="panel err">This view is not available (module missing: ' + esc(VIEW) + ').</div>'; return; }
    await fn(token);
  } catch (e) {
    if (!stale(token)) main.innerHTML = '<div class="panel err">' + esc(e.message) + '</div>';
  }
}

/* ── settings modal ────────────────────────────────────────────────────────── */
function openSettings() {
  const g = STATUS.guardrails || {};
  const books = BOOKS.length ? BOOKS.map(b => '<div>' + esc(bookLabel(b.ref)) + ' · ' + esc(b.kind) + ' · ' + (b.enabled ? '<span class="ok">trading</span>' : '<span class="foot">view-only</span>') + '</div>').join('') : '<div class="foot">No accounts loaded.</div>';
  $('settingsBody').innerHTML =
    '<div class="foot" style="margin-bottom:8px">ACCOUNTS</div><div style="margin-bottom:14px">' + books + '</div>' +
    '<div class="foot" style="margin-bottom:8px">RAILS</div>' +
    '<div style="margin-bottom:14px">Paper data ' + (STATUS.paperConfigured?'<span class="ok">connected</span>':'<span class="err">not configured</span>') +
      ' · Live trading ' + (STATUS.liveEnabled ? '<span class="ok">enabled</span>' : '<span class="foot">disabled (TRADING_LIVE_ENABLED)</span>') + '</div>' +
    '<div class="foot" style="margin-bottom:8px">GUARDRAILS (every order, every account)</div>' +
    '<table><tbody>' + (Object.keys(g).length ? Object.entries(g).map(([k,v]) =>
      '<tr><td style="color:var(--muted)">' + esc(k) + '</td><td class="num">' + esc(typeof v==='object'?JSON.stringify(v):v) + '</td></tr>').join('')
      : '<tr><td class="foot">No guardrail config returned by /status.</td></tr>') + '</tbody></table>';
  $('settings').hidden = false;
}
function closeSettings() { $('settings').hidden = true; }

/* ── boot ──────────────────────────────────────────────────────────────────── */
function wireShell() {
  document.querySelectorAll('#nav button').forEach(b => b.onclick = () => navigate(b.getAttribute('data-view'), { sub: null }));
  const back = $('backBtn'); if (back) back.onclick = () => navigate('accounts', { sub: null });
  const sel = $('bookSel'); if (sel) sel.onchange = () => { const b = bookOf(sel.value); openAccount(sel.value, b ? b.kind : (sel.value === 'paper' ? 'paper' : 'live')); };
  $('refreshBtn').onclick = () => { RENDER_TOKEN += 1; render(); };
  $('settingsBtn').onclick = openSettings;
  $('settingsClose').onclick = closeSettings;
  $('settings').addEventListener('click', (e) => { if (e.target === $('settings')) closeSettings(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeSettings(); });
}
async function boot() {
  wireShell();
  try { await loadBooks(); } catch { /* accounts surface unavailable — views degrade to the paper book */ }
  // A bookmark naming a book that no longer exists must not brick the surface: fall back to paper.
  if (BOOK !== 'paper' && BOOK !== 'live' && !bookOf(BOOK)) { BOOK = 'paper'; MODE = 'paper'; if (VIEW === 'account') VIEW = 'accounts'; syncUrl(); }
  render();
}
/* The shell has no inline bootstrap script (CSP): boot once every classic script has been parsed. */
document.addEventListener('DOMContentLoaded', boot);
