/* trading/ui/view-research.js — VIEW 'research' (ADR-136 D1/D2, ADR-138): one stock, or the market.
 *
 * Classic script; depends on app.js globals (BOOK/MODE/DISP/SUB/STATUS/UNIVERSE/FOC_TF/RENDER_TOKEN,
 * api(), jbody(), esc/money/pct/fmtDate/spinner/st, subTabs(), tabGen()/tabStale(), stale(),
 * navigate()/openAccount(), acctContextBar()/wireAcctContextBar(), selectTab() shim).
 * Sub-tabs: Research a stock (default, ADR-138), Recommendations, Algorithms, Capture & signals.
 * The three legacy loaders moved VERBATIM from the single-file page and still paint into #tabbody,
 * which subTabs() provides. Recommendations and scans read the selected account's data rail; captured
 * signals and analyst decisions are filed on that account (api() scopes every call to BOOK).
 * focus() and loadKpisAndPositions() are account-view globals (shared-positions.js) reached by the
 * "Focus →" buttons and the post-order refresh; drawFocusChart(sym) draws the stock tab's chart.
 *
 * Cross-view hand-offs (declared HERE, exactly once):
 *   PENDING_RESEARCH — a symbol to research once the stock tab paints. researchSymbol(sym) sets it and
 *                      navigates here; loadStockTab() consumes it. Any view may call researchSymbol().
 *   PENDING_TICKET   — a symbol to open the direct-trade ticket on once the ACCOUNT view paints. The
 *                      stock tab's Buy button sets it and calls openAccount(BOOK, MODE); view-account.js
 *                      consumes it (guarded by typeof so a missing module never throws).
 * The watchlist panel (GET/POST/DELETE /watchlist) is defined here and shared with the Accounts landing
 * page (view-accounts.js calls loadWatchlistPanel(hostId, false) — rows there navigate via researchSymbol).
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Log opened at 1.10.3 - this file predates the log and its earlier history is in git. Sub-tab race close-out (ADR-136 D2 tail): loadScoreboard and loadFeed now capture RENDER_TOKEN and tabGen() before their first await and bail after it, matching loadMovers and loadWatchlistPanel; loadAlgos is a plain function because it awaits nothing (its caller ignores the return). No handler attribute existed here and none is introduced - every action stays a delegated data-* listener.
 */

let PENDING_RESEARCH = null;
let PENDING_TICKET = null;
/* The last symbol researched this session — the stock tab re-opens on it after a sub-tab round trip. */
let RS_SYM = '';
/* The #rsSym element the symbol-search autocomplete is currently attached to (symbol-search.js), so a
   sub-tab switch can detach it before the tab body is discarded — no orphan timer/dropdown. */
let RS_SEARCH = null;
/* Market-movers active pill (winners | losers | volatile | active); the fetch also guards on it. */
let MV_KIND = 'winners';

/* ── research a stock — tab (ADR-138) ─────────────────────────── */
/* Navigate to the stock tab on a symbol from ANY view. navigate() re-renders through render(), which
   paints the tab and lets loadStockTab() consume PENDING_RESEARCH. */
function researchSymbol(sym) {
  PENDING_RESEARCH = String(sym || '').trim().toUpperCase() || null;
  navigate('research', { sub: 'stock' });
}
function loadStockTab() {
  const host = $('tabbody'); if (!host) return;
  const sym = PENDING_RESEARCH || RS_SYM || '';
  PENDING_RESEARCH = null;
  host.innerHTML = '<div class="panel"><div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
    '<input id="rsSym" maxlength="64" autocomplete="off" spellcheck="false" placeholder="Ticker or company name" style="max-width:220px;text-transform:uppercase" value="' + esc(sym) + '" />' +
    '<button class="btn primary" id="rsGo">Research</button>' +
    '<span class="sub">Quote, chart, fundamentals, earnings, news, SEC filings and major events for one stock.</span></div>' +
    '<div id="rsBody"><div class="foot">Enter a ticker to research it.</div></div></div>' +
    '<div class="panel" id="rsWatch">' + spinner('Loading watchlist…') + '</div>';
  const inp = $('rsSym'), go = $('rsGo');
  if (inp) {
    inp.oninput = () => { inp.value = inp.value.toUpperCase(); };
    inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); researchLoad(inp.value); } };
  }
  if (go) go.onclick = () => researchLoad(inp ? inp.value : '');
  // Ticker/name autocomplete: a pick fills the box and researches that symbol. Manual typing + the
  // Research button still work. Tracked in RS_SEARCH so the sub-tab switch can detach it cleanly.
  if (inp && typeof attachSymbolSearch === 'function') {
    RS_SEARCH = inp;
    attachSymbolSearch(inp, (hit) => { const el = $('rsSym'); if (el) el.value = hit.symbol; researchLoad(hit.symbol); });
  }
  loadWatchlistPanel('rsWatch', true);
  if (sym) researchLoad(sym); else if (inp) inp.focus();
}
/* GET /research/:symbol → the whole page for one stock. Captures the render token AND the sub-tab
   generation before the await: a slow answer for a previous symbol/tab/view never paints this one. */
async function researchLoad(sym) {
  const token = RENDER_TOKEN, gen = tabGen();
  const body = $('rsBody'); if (!body) return;
  sym = String(sym || '').trim().toUpperCase();
  if (!/^[A-Z.\-]{1,10}$/.test(sym)) { body.innerHTML = '<div class="err" style="font-size:13px">Enter a ticker symbol (letters, up to 10).</div>'; return; }
  RS_SYM = sym;
  body.innerHTML = spinner('Researching ' + sym + '…');
  let j;
  try { j = await api('/research/' + encodeURIComponent(sym)); }
  catch (e) { if (!stale(token) && !tabStale(gen) && RS_SYM === sym) body.innerHTML = '<div class="err" style="font-size:13px">' + esc(e.message) + '</div>'; return; }
  if (stale(token) || tabStale(gen) || RS_SYM !== sym) return;
  body.innerHTML = researchTopHtml(j) +
    '<div class="research-grid"><div>' + researchChartHtml() + researchFundHtml(j) + researchEarnHtml(j) + '</div>' +
    '<div>' + researchNewsHtml(j) + researchFilingsHtml(j) + researchEventsHtml(j) + '</div></div>';
  researchWire(j);
  drawFocusChart(j.symbol || sym);
}
/* sections[name] === 'ok' is the ONLY thing that makes a section show data — anything else says so. */
const rsOk = (j, name) => !!(j && j.sections && j.sections[name] === 'ok');
const rsUnavail = () => '<div class="foot" style="margin:0">unavailable</div>';
/* A date for a list: date-only strings stay as they are (no timezone drift), timestamps localize. */
const rsDay = (s) => {
  if (s == null || s === '') return '—';
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(s))) return String(s);
  try { const d = new Date(s); return isNaN(d.getTime()) ? String(s) : d.toLocaleDateString(); } catch { return String(s); }
};
/* $1.23B / $456.7M / $12,345 — financial statement figures, never a 13-digit money() string. */
const rsBig = (v) => {
  if (v == null || !isFinite(Number(v))) return '—';
  const n = Number(v), a = Math.abs(n);
  const s = a >= 1e9 ? (a / 1e9).toFixed(2) + 'B' : (a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a.toLocaleString(undefined, { maximumFractionDigits: 0 }));
  return (n < 0 ? '-$' : '$') + s;
};
function researchTopHtml(j) {
  const q = j.quote, sym = esc(j.symbol);
  const quote = q && q.price != null
    ? '<div class="det-price">' + money(q.price) + '</div><div class="det-meta"><span>as of ' + esc(fmtDate(q.asOf)) + '</span></div>'
    : '<div class="det-meta"><span class="foot" style="margin:0">quote unavailable</span></div>';
  return '<div class="det-head" style="margin-top:12px"><div class="det-id"><h2>' + sym + (j.book ? ' <span class="pill">' + esc(bookLabel(j.book)) + '</span>' : '') + '</h2>' + quote + '</div>' +
    '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
    '<button class="btn buy" data-act="buy" data-sym="' + sym + '" title="Open the order ticket for ' + sym + ' on ' + esc(DISP) + '">Buy ' + sym + '</button>' +
    '<button class="btn ghost" data-act="watch" data-sym="' + sym + '">+ Watchlist</button> <span id="rsActMsg" class="sub"></span></div></div>';
}
function researchChartHtml() {
  const tfs = ['5Min', '1Hour', '1Day', '1Week'];
  return '<div class="panel head2" style="padding:0;margin:0 0 8px;background:none;border:0;box-shadow:none"><h2 style="margin:0;font-size:13px">Chart</h2>' +
    '<div class="tf-switch" id="rsTf" style="margin-left:auto">' + tfs.map(t => '<button data-tf="' + t + '"' + (t === FOC_TF ? ' class="on"' : '') + '>' + t + '</button>').join('') + '</div></div>' +
    '<div class="det-chart" id="focChart"></div>';
}
function researchFundHtml(j) {
  const f = j.fundamentals;
  const head = '<div class="panel" style="margin-top:14px"><h2>Fundamentals' + (f && f.fiscalYear ? ' <span class="foot" style="margin:0">FY' + esc(f.fiscalYear) + '</span>' : '') + '</h2>';
  if (!rsOk(j, 'fundamentals') || !f) return head + rsUnavail() + '</div>';
  const p = (v) => v == null ? '—' : '<span class="' + (Number(v) >= 0 ? 'ok' : 'err') + '">' + pct(v) + '</span>';
  return head + (f.summary ? '<div class="sub" style="margin-bottom:10px">' + esc(f.summary) + '</div>' : '') +
    '<div class="det-stats" style="margin:0">' + st('Revenue', rsBig(f.revenue)) + st('Revenue YoY', p(f.revenueYoYPct)) +
    st('Net income', rsBig(f.netIncome)) + st('Net margin', f.netMarginPct == null ? '—' : Number(f.netMarginPct).toFixed(1) + '%') + '</div></div>';
}
/* Next expected report + WHERE that date came from — 'calendar' or 'estimated from cadence', always
   said plainly — and the past result dates the estimate rests on. */
function researchEarnHtml(j) {
  const e = j.earnings, head = '<div class="panel" style="margin-top:14px"><h2>Earnings</h2>';
  if (!rsOk(j, 'earnings') || !e) return head + rsUnavail() + '</div>';
  const src = e.source === 'world-calendar' ? 'calendar' : (e.source === 'cadence-estimate' ? 'estimated from cadence' : 'source unknown');
  const next = e.nextExpected
    ? '<div><span class="foot" style="margin:0">NEXT EXPECTED</span> <b>' + esc(rsDay(e.nextExpected)) + '</b> <span class="pill">' + esc(src) + '</span></div>'
    : '<div class="foot" style="margin:0">Next report date unknown.</div>';
  const past = (e.pastResults || []).length
    ? '<div style="margin-top:8px"><div class="foot" style="margin:0 0 2px">PAST RESULTS</div><div class="sub">' + e.pastResults.map(x => esc(rsDay(x))).join('<br />') + '</div></div>'
    : '';
  return head + next + past + '</div>';
}
function researchNewsHtml(j) {
  const items = j.news || [], head = '<div class="panel"><h2>News</h2>';
  if (!rsOk(j, 'news')) return head + rsUnavail() + '</div>';
  if (!items.length) return head + '<div class="foot" style="margin:0">No recent headlines.</div></div>';
  return head + items.slice(0, 25).map(n =>
    '<div class="news-item"><div>' + (n.url ? '<a href="' + esc(n.url) + '" target="_blank" rel="noopener">' + esc(n.headline) + '</a>' : '<b>' + esc(n.headline) + '</b>') + '</div>' +
    (n.summary ? '<div class="sub" style="margin-top:2px">' + esc(n.summary) + '</div>' : '') +
    '<div class="foot" style="margin-top:2px">' + esc(n.source || '') + (n.createdAt ? ' · ' + esc(fmtDate(n.createdAt)) : '') + '</div></div>').join('') + '</div>';
}
/* 10-K / 10-Q links, then the recent 8-Ks with their items in plain words (itemsPlain, else the codes). */
function researchFilingsHtml(j) {
  const f = j.filings || {}, head = '<div class="panel"><h2>SEC filings</h2>';
  if (!rsOk(j, 'filings')) return head + rsUnavail() + '</div>';
  const row = (label, x) => '<div class="filing-row"><span class="foot" style="margin:0;min-width:64px">' + label + '</span>' +
    (x ? '<a href="' + esc(x.url) + '" target="_blank" rel="noopener">' + esc(x.form || label) + '</a> <span class="sub">' + esc(rsDay(x.date)) + '</span>' : '<span class="foot" style="margin:0">none on file</span>') + '</div>';
  const eights = (f.recent8K || []).map(k => {
    const items = (k.itemsPlain && k.itemsPlain.length) ? k.itemsPlain : (k.items || []);
    return '<div class="filing-row"><a href="' + esc(k.url) + '" target="_blank" rel="noopener">8-K</a><span class="sub">' + esc(rsDay(k.date)) + '</span><span class="sub">' + items.map(esc).join('; ') + '</span></div>';
  }).join('');
  return head + row('Annual', f.latest10K) + row('Quarterly', f.latest10Q) +
    '<div class="foot" style="margin:8px 0 2px">RECENT 8-K (material events)</div>' + (eights || '<div class="foot" style="margin:0">None recently.</div>') + '</div>';
}
function researchEventsHtml(j) {
  const ev = j.events || [], head = '<div class="panel"><h2>Major events</h2>';
  if (!rsOk(j, 'events')) return head + rsUnavail() + '</div>';
  if (!ev.length) return head + '<div class="foot" style="margin:0">No major events on record.</div></div>';
  return head + ev.map(e => '<div class="filing-row"><span class="sub" style="min-width:86px">' + esc(rsDay(e.date)) + '</span><span class="pill">' + esc(e.kind || 'event') + '</span>' +
    (e.url ? '<a href="' + esc(e.url) + '" target="_blank" rel="noopener">' + esc(e.label) + '</a>' : '<span>' + esc(e.label) + '</span>') + '</div>').join('') + '</div>';
}
/* Timeframe switch redraws through the shared FOC_TF; Buy hands the symbol to the ACCOUNT view's ticket
   (PENDING_TICKET → openAccount); + Watchlist posts and refreshes the panel below. */
function researchWire(j) {
  const body = $('rsBody'); if (!body) return;
  const tf = $('rsTf');
  if (tf) tf.querySelectorAll('button').forEach(b => b.onclick = () => {
    FOC_TF = b.getAttribute('data-tf'); tf.querySelectorAll('button').forEach(x => x.className = ''); b.className = 'on'; drawFocusChart(j.symbol);
  });
  body.querySelectorAll('button[data-act]').forEach(b => b.onclick = () => {
    const act = b.getAttribute('data-act'), sym = b.getAttribute('data-sym');
    if (act === 'buy') { PENDING_TICKET = sym; openAccount(BOOK, MODE); }
    else if (act === 'watch') watchlistAdd(sym, $('rsActMsg'), 'rsWatch', true);
  });
}

/* ── watchlist panel (shared: stock tab + Accounts landing page) ── */
/* GET /watchlist → the rows. `inline` = clicking a symbol researches it in THIS tab (stock tab);
   otherwise the row navigates via researchSymbol() (landing page). One delegated listener per host. */
async function loadWatchlistPanel(hostId, inline) {
  const token = RENDER_TOKEN, gen = tabGen();
  const host = $(hostId); if (!host) return;
  wlWire(host, hostId, inline);
  let items = null, err = null;
  try { items = (await api('/watchlist')).items || []; } catch (e) { err = e; }
  if (stale(token) || tabStale(gen) || !$(hostId)) return;
  host.innerHTML = wlShellHtml(err ? '<div class="err" style="font-size:13px">' + esc(err.message) + '</div>' : wlRowsHtml(items));
}
function wlShellHtml(bodyHtml) {
  return '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px"><h2 style="margin:0">Watchlist</h2>' +
    '<input class="wl-add" maxlength="10" autocomplete="off" spellcheck="false" placeholder="Add a ticker" style="width:auto;max-width:150px;margin-left:auto;text-transform:uppercase" />' +
    '<button class="btn ghost sm" data-wl="add">Add</button> <span class="sub wl-msg"></span></div>' +
    '<div class="wl-body">' + bodyHtml + '</div>';
}
function wlRowsHtml(items) {
  if (!items.length) return '<div class="foot" style="margin:0">Nothing on the watchlist yet — add a ticker to follow it here.</div>';
  return '<div style="overflow-x:auto"><table><thead><tr><th>Symbol</th><th class="num">Last</th><th class="num">Today</th><th class="num">Added</th><th></th></tr></thead><tbody>' + items.map(it => {
    const q = it.quote || null, ch = q && q.dayChangePct != null ? Number(q.dayChangePct) : null, sym = esc(it.symbol);
    return '<tr><td><a href="#" data-wl="research" data-sym="' + sym + '"><strong>' + sym + '</strong></a>' + (it.note ? ' <span class="foot" style="margin:0">' + esc(it.note) + '</span>' : '') + '</td>' +
      '<td class="num">' + (q && q.price != null ? money(q.price) : '—') + '</td>' +
      '<td class="num ' + (ch == null ? '' : (ch >= 0 ? 'ok' : 'err')) + '">' + (ch == null ? '—' : pct(ch)) + '</td>' +
      '<td class="num foot" style="margin:0">' + (it.addedAt ? esc(rsDay(it.addedAt)) : '—') + '</td>' +
      '<td style="text-align:right;white-space:nowrap"><button class="btn ghost sm" data-wl="research" data-sym="' + sym + '">Research</button> ' +
      '<button class="icon-btn" data-wl="remove" data-sym="' + sym + '" title="Remove from watchlist" aria-label="Remove" style="width:28px;min-height:26px;font-size:13px">&times;</button></td></tr>';
  }).join('') + '</tbody></table></div>';
}
/* Delegated: the host outlives every repaint of its rows; wiring once per host element (data-wl-wired). */
function wlWire(host, hostId, inline) {
  if (host.getAttribute('data-wl-wired')) return;
  host.setAttribute('data-wl-wired', '1');
  const add = () => { const inp = host.querySelector('.wl-add'); watchlistAdd(inp ? inp.value : '', host.querySelector('.wl-msg'), hostId, inline); };
  host.addEventListener('click', (e) => {
    const el = e.target.closest('[data-wl]'); if (!el || !host.contains(el)) return;
    e.preventDefault();
    const act = el.getAttribute('data-wl'), sym = el.getAttribute('data-sym');
    if (act === 'add') add();
    else if (act === 'remove') watchlistRemove(sym, hostId, inline);
    else if (act === 'research') { if (inline) wlResearchInline(sym); else researchSymbol(sym); }
  });
  host.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('wl-add')) { e.preventDefault(); add(); } });
}
/* Stock tab: research the row's symbol right here; if the tab body is gone, navigate instead. */
function wlResearchInline(sym) {
  const inp = $('rsSym');
  if (!inp || !$('rsBody')) { researchSymbol(sym); return; }
  inp.value = sym; researchLoad(sym);
  inp.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
async function watchlistAdd(sym, msgEl, hostId, inline) {
  sym = String(sym || '').trim().toUpperCase();
  const say = (k, t) => { if (msgEl) { msgEl.className = 'sub ' + k; msgEl.textContent = t; } };
  if (!/^[A-Z.\-]{1,10}$/.test(sym)) { say('err', 'Enter a ticker symbol (letters, up to 10).'); return; }
  say('', 'Adding ' + sym + '…');
  try { await api('/watchlist', jbody('POST', { symbol: sym })); }
  catch (e) { say('err', e.message); return; }
  say('ok', sym + ' added to the watchlist.');
  if (hostId) loadWatchlistPanel(hostId, inline);
}
async function watchlistRemove(sym, hostId, inline) {
  if (!sym) return;
  try { await api('/watchlist/' + encodeURIComponent(sym), { method: 'DELETE' }); }
  catch (e) { const host = $(hostId), m = host && host.querySelector('.wl-msg'); if (m) { m.className = 'sub err'; m.textContent = e.message; } return; }
  loadWatchlistPanel(hostId, inline);
}

/* ── recommendations — tab ───────────────────────────────────── */
function loadReco() {
  const host = $('tabbody'); if (!host) return;
  host.innerHTML = '<div class="panel"><div class="panel head2"><h2 style="margin:0">Market analysis &amp; recommendations</h2>' +
    '<button class="btn ghost sm" id="recoBtn" style="margin-left:auto">Re-analyze</button></div>' +
    '<div id="recoBody"><div class="spin"><span class="dot"></span> Analyzing the market…</div></div></div>';
  $('recoBtn').onclick = doAnalyze; doAnalyze();
}
async function doAnalyze() {
  const body = $('recoBody'); if (!body) return;
  body.innerHTML = '<div class="spin"><span class="dot"></span> Scanning the universe…</div>';
  try {
    const j = await api('/recommendations');
    const list = (arr, kind) => arr.length ? arr.map((r) => {
      const e = r.ensemble || {}; const conf = Math.round((Math.abs(e.score) || 0) * 100);
      const pills = (r.signals || []).map((s) => '<span class="pill ' + (s.dir === 'up' ? 'buy' : 'sell') + '" style="font-size:9px">' + s.algo + '</span>').join(' ');
      return '<div class="sig" style="border-left-color:' + (kind === 'buy' ? 'var(--buy)' : 'var(--sell)') + '">' +
        '<div><span class="pill ' + kind + '">' + kind.toUpperCase() + '</span> <strong>' + esc(r.symbol) + '</strong> ' + money(r.price) +
        ' <span class="foot">conviction ' + conf + '%</span>' +
        ' <button class="btn ghost sm" data-fsym="' + esc(r.symbol) + '" style="float:right">Focus →</button></div>' +
        '<div class="foot" style="margin-top:4px">' + pills + '</div></div>';
    }).join('') : '<div class="foot">none</div>';
    body.innerHTML =
      '<div class="foot" style="margin-bottom:10px">Assessed <strong>' + (j.assessed ? j.assessed.symbols : 0) + '</strong> symbols · ' + ((j.buys||[]).length) + ' buys, ' + ((j.sells||[]).length) + ' sells, ' + (j.holds||0) + ' hold · ' + fmtDate(j.asOf) + '</div>' +
      '<div class="grid2">' +
      '<div><div class="foot" style="color:var(--buy);margin-bottom:4px">TOP BUYS</div>' + list(j.buys||[],'buy') + '</div>' +
      '<div><div class="foot" style="color:var(--sell);margin-bottom:4px">TOP SELLS / SHORTS</div>' + list(j.sells||[],'sell') + '</div></div>';
    body.querySelectorAll('button[data-fsym]').forEach((b) => b.onclick = () => { const s=b.getAttribute('data-fsym'); focus(s); window.scrollTo({top:0,behavior:'smooth'}); });
  } catch (e) { body.innerHTML = '<div class="foot err">' + esc(e.message) + '</div>'; }
}

/* ── algorithms — tab ────────────────────────────────────────── */
/* Not async: the tab paint is synchronous and loadScoreboard() owns its own capture/bail. */
function loadAlgos() {
  const host = $('tabbody'); if (!host) return;
  host.innerHTML = '<div class="panel"><h2>Algorithms — deterministic engine</h2>' +
    '<div class="sub" style="margin-bottom:10px">Scan a watchlist: momentum / gravity / donchian / mean-rev and their ensemble — reproducible from market data, no LLM. Focus any name to chart it and place the trade.</div>' +
    '<div style="display:flex;gap:8px;align-items:center;margin-bottom:12px;flex-wrap:wrap"><input id="scanSyms" placeholder="HD,LOW,GNRC,BLDR,SPY" value="HD,LOW,GNRC,BLDR,SPY" style="max-width:340px"><button class="btn primary" id="scanBtn">Scan</button> <span id="scanMsg" class="sub"></span></div>' +
    '<div id="scoreboard"></div><div id="scanOut"></div></div>';
  $('scanBtn').onclick = doScan; loadScoreboard();
}
async function loadScoreboard() {
  const token = RENDER_TOKEN, gen = tabGen();
  const host = $('scoreboard'); if (!host) return;
  try {
    const a = (await api('/algo-stats')).algos || [];
    if (stale(token) || tabStale(gen)) return;
    host.innerHTML = a.length
      ? '<div class="foot" style="margin-bottom:4px">PER-ALGO LIVE HIT-RATE (resolved predictions)</div><table><thead><tr><th>Algorithm</th><th class="num">resolved</th><th class="num">open</th><th class="num">hit %</th></tr></thead><tbody>'
        + a.map((r) => '<tr><td>' + esc(r.algo) + '</td><td class="num">' + (r.resolved||0) + '</td><td class="num">' + (r.open||0) + '</td><td class="num">' + (r.hit_rate_pct==null?'—':r.hit_rate_pct+'%') + '</td></tr>').join('') + '</tbody></table>'
      : '<div class="foot">No resolved predictions yet — Scan now, then again after the horizon.</div>';
  } catch (e) { if (!stale(token) && !tabStale(gen)) host.innerHTML = '<div class="foot err">' + esc(e.message) + '</div>'; }
}
async function doScan() {
  const msg = $('scanMsg'), out = $('scanOut');
  const syms = ($('scanSyms').value || 'HD,LOW,GNRC,BLDR,SPY').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  msg.className = 'sub'; msg.innerHTML = '<span class="dot"></span> Scanning…';
  try {
    const j = await api('/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbols: syms }) });
    msg.textContent = 'resolved ' + (j.resolved || 0) + ' prior predictions';
    const rows = (j.scanned || []).filter((s) => !s.error);
    const cell = (s, a) => { const v = (s.signals || []).find((x) => x.algo === a); return v ? '<span class="pill ' + (v.dir === 'up' ? 'buy' : 'sell') + '">' + v.dir + '</span>' : '<span class="foot">—</span>'; };
    out.innerHTML = '<table style="margin-top:8px"><thead><tr><th>Symbol</th><th class="num">price</th><th>momentum</th><th>gravity</th><th>donchian</th><th>mean-rev</th><th>ensemble</th><th></th></tr></thead><tbody>' +
      rows.map((s) => { const e = s.ensemble || { action: 'hold' };
        const ep = '<span class="pill ' + (e.action === 'buy' ? 'buy' : e.action === 'sell' ? 'sell' : 'hold') + '">' + e.action + (e.score != null ? ' ' + e.score : '') + '</span>';
        return '<tr><td><strong>' + esc(s.symbol) + '</strong></td><td class="num">' + money(s.price) + '</td><td>' + cell(s, 'momentum') + '</td><td>' + cell(s, 'gravity') + '</td><td>' + cell(s, 'donchian') + '</td><td>' + cell(s, 'meanrev') + '</td><td>' + ep + '</td><td><button class="btn ghost sm" data-fsym="' + esc(s.symbol) + '">Focus →</button></td></tr>'; }).join('') + '</tbody></table>';
    out.querySelectorAll('button[data-fsym]').forEach((b) => b.onclick = () => { const sy=b.getAttribute('data-fsym'); if(!UNIVERSE[sy]) UNIVERSE[sy]={symbol:sy}; focus(sy); window.scrollTo({top:0,behavior:'smooth'}); });
  } catch (e) { msg.className = 'sub err'; msg.textContent = e.message; }
}

/* ── market movers — tab ─────────────────────────────────────── */
/* GET /reports/movers?kind=winners|losers|volatile|active — the day's leaders for the selected book's
   universe. Every number is the server's; nothing is computed or invented here. Row → research the
   stock; the small Buy hands the symbol to the account view's ticket (PENDING_TICKET + openAccount),
   the same rail the single-stock Buy uses. */
function loadMoversTab() {
  const host = $('tabbody'); if (!host) return;
  host.innerHTML = '<div class="panel"><div class="panel head2"><h2 style="margin:0">Market movers</h2>' +
    '<button class="btn ghost sm" id="mvRefresh" style="margin-left:auto">Refresh</button></div>' +
    '<div class="mv-tabs" id="mvTabs">' + mvTabsHtml() + '</div>' +
    '<div id="mvMeta" class="foot" style="margin:0 0 8px"></div>' +
    '<div id="mvBody">' + spinner('Loading movers…') + '</div></div>';
  const tabs = $('mvTabs');
  if (tabs) tabs.querySelectorAll('button').forEach(b => b.onclick = () => { MV_KIND = b.getAttribute('data-mv'); loadMovers(); });
  const rb = $('mvRefresh'); if (rb) rb.onclick = () => loadMovers();
  loadMovers();
}
function mvTabsHtml() {
  const kinds = [['winners', 'Winners'], ['losers', 'Losers'], ['volatile', 'Most volatile'], ['active', 'Most active']];
  return kinds.map(k => '<button data-mv="' + k[0] + '"' + (k[0] === MV_KIND ? ' class="on"' : '') + '>' + k[1] + '</button>').join('');
}
/* Fetch the active kind and paint. Captures RENDER_TOKEN + the sub-tab generation AND the kind before
   the await, so a slow answer for a previous account/tab/pill never paints over the current one. */
async function loadMovers() {
  const token = RENDER_TOKEN, gen = tabGen(), kind = MV_KIND;
  const body = $('mvBody'), meta = $('mvMeta'); if (!body) return;
  body.innerHTML = spinner('Loading ' + esc(kind) + '…');
  const tabs = $('mvTabs'); if (tabs) tabs.querySelectorAll('button').forEach(b => b.className = b.getAttribute('data-mv') === kind ? 'on' : '');
  let j;
  try { j = await api('/reports/movers?kind=' + encodeURIComponent(kind) + '&limit=15'); }
  catch (e) {
    if (!stale(token) && !tabStale(gen) && MV_KIND === kind) { body.innerHTML = '<div class="err" style="font-size:13px">' + esc(e.message) + '</div>'; if (meta) meta.innerHTML = ''; }
    return;
  }
  if (stale(token) || tabStale(gen) || MV_KIND !== kind) return;
  if (meta) meta.innerHTML = mvMetaHtml(j);
  body.innerHTML = mvTableHtml(j);
  mvWire(body);
}
/* Honest provenance line: the source in plain words, the as-of time and how many symbols were scanned,
   with the server's own note underneath. Never dresses end-of-session data up as intraday. */
function mvMetaHtml(j) {
  const src = mvSourceWords(j.source), bits = [];
  if (src) bits.push(esc(src));
  if (j.asOf) bits.push('as of ' + esc(fmtDate(j.asOf)));
  if (j.universeCount != null) bits.push(esc(String(j.universeCount)) + ' symbols scanned');
  let html = bits.join(' &middot; ');
  if (j.note && String(j.note) !== String(src)) html += '<span style="display:block;margin-top:2px">' + esc(j.note) + '</span>';
  return html;
}
function mvSourceWords(source) {
  const s = String(source || '').toLowerCase();
  if (/iex|eod|end.?of|prev|close/.test(s)) return 'End-of-last-session data (free IEX feed), not intraday.';
  if (s === 'live' || s === 'intraday' || s === 'realtime') return 'Intraday data.';
  return source ? 'Source: ' + source : '';
}
function mvTableHtml(j) {
  const rows = (j && j.rows) || [];
  if (!rows.length) return '<div class="foot" style="margin:0">' + esc((j && j.note) || 'No data.') + '</div>';
  return '<div style="overflow-x:auto"><table><thead><tr><th>Symbol</th><th>Name</th><th class="num">Last</th><th class="num">Change %</th><th class="num">Volume</th><th class="num">Volatility %</th><th></th></tr></thead><tbody>' +
    rows.map(mvRowHtml).join('') + '</tbody></table></div>';
}
function mvRowHtml(r) {
  const sym = esc(String(r.symbol || ''));
  const ch = r.changePct == null ? null : Number(r.changePct);
  const vol = r.volatilityPct == null ? null : Number(r.volatilityPct);
  return '<tr class="mv-row" data-sym="' + sym + '">' +
    '<td><strong>' + sym + '</strong></td>' +
    '<td>' + esc(r.name || '') + '</td>' +
    '<td class="num">' + (r.price == null ? '&mdash;' : money(r.price)) + '</td>' +
    '<td class="num ' + (ch == null ? '' : (ch >= 0 ? 'ok' : 'err')) + '">' + (ch == null ? '&mdash;' : pct(ch)) + '</td>' +
    '<td class="num">' + (r.dayVolume == null ? '&mdash;' : mvVol(r.dayVolume)) + '</td>' +
    '<td class="num">' + (vol == null ? '&mdash;' : vol.toFixed(2) + '%') + '</td>' +
    '<td class="num"><button class="btn buy sm" data-mvbuy="' + sym + '">Buy</button></td></tr>';
}
/* Compact share-volume: 1.2B / 456.7M / 89K — a display format over the server's own dayVolume. */
function mvVol(n) {
  const v = Number(n); if (!isFinite(v)) return '&mdash;';
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(2) + 'B';
  if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return (v / 1e3).toFixed(0) + 'K';
  return v.toLocaleString();
}
/* A row researches its symbol; the Buy button stops the row click and opens the ticket on the account. */
function mvWire(body) {
  if (!body) return;
  body.querySelectorAll('button[data-mvbuy]').forEach(b => b.onclick = (e) => {
    e.stopPropagation(); PENDING_TICKET = b.getAttribute('data-mvbuy'); openAccount(BOOK, MODE);
  });
  body.querySelectorAll('tr.mv-row').forEach(tr => tr.onclick = () => researchSymbol(tr.getAttribute('data-sym')));
}

/* ── signal capture + feed — tab ─────────────────────────────── */
function renderCapture() {
  const host = $('tabbody'); if (!host) return;
  host.innerHTML =
    '<div class="panel"><h2>Capture a signal</h2>' +
    '<div class="sub" style="margin-bottom:12px">Snapshot what you read — a tweet, a headline. Stored immutably so any trade can be traced back to it.</div>' +
    '<div class="grid2">' +
      '<label class="f">Source<select id="sgSource"><option value="x">X / Twitter</option><option value="news">News</option><option value="inbox">Inbox</option><option value="manual">Manual</option></select></label>' +
      '<label class="f">Symbols (comma-sep)<input id="sgSymbols" placeholder="AAPL, SPY"></label>' +
      '<label class="f">Author / publisher<input id="sgAuthor" placeholder="@source"></label>' +
      '<label class="f">Link (optional)<input id="sgUrl" placeholder="https://…"></label>' +
    '</div>' +
    '<label class="f">Headline / title<input id="sgTitle" placeholder="Short form"></label>' +
    '<label class="f">Body<textarea id="sgBody" placeholder="Paste the artifact text…"></textarea></label>' +
    '<button class="btn primary" id="sgBtn">Capture signal</button> <span id="sgMsg" class="sub"></span></div>' +
    '<div id="feed"></div>';
  $('sgBtn').onclick = captureSignal;
}
async function captureSignal() {
  const msg = $('sgMsg'); const btn = $('sgBtn');
  const body = { source: $('sgSource').value, symbols: $('sgSymbols').value.split(',').map(s=>s.trim()).filter(Boolean),
    author: $('sgAuthor').value.trim(), url: $('sgUrl').value.trim(), title: $('sgTitle').value.trim(), body: $('sgBody').value.trim() };
  if (!body.body && !body.title) { msg.className='sub err'; msg.textContent='Add a headline or body.'; return; }
  btn.disabled = true; msg.className='sub'; msg.innerHTML='<span class="dot"></span> Capturing…';
  try { await api('/signals', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
    msg.className='sub ok'; msg.textContent='Captured.'; $('sgBody').value=''; $('sgTitle').value=''; await loadFeed();
  } catch (e) { msg.className='sub err'; msg.textContent=e.message; } finally { btn.disabled=false; }
}
async function loadFeed() {
  const token = RENDER_TOKEN, gen = tabGen();
  const host = $('feed'); if (!host) return;
  let signals = [];
  try { signals = (await api('/signals')).signals || []; } catch (e) { if (!stale(token) && !tabStale(gen)) host.innerHTML='<div class="panel err">'+esc(e.message)+'</div>'; return; }
  if (stale(token) || tabStale(gen)) return;
  host.innerHTML = '<div class="panel"><h2>Signal feed</h2>' +
    (signals.length ? signals.map(s =>
      '<div class="sig"><div><strong>' + esc(s.title || (s.body||'').slice(0,80)) + '</strong> ' +
      (s.symbols && s.symbols.length ? '<span class="pill">' + s.symbols.map(esc).join(', ') + '</span>' : '') + '</div>' +
      '<div class="foot">' + esc(s.source) + (s.author ? ' · ' + esc(s.author) : '') + ' · ' + fmtDate(s.observed_at) +
      (s.url ? ' · <a href="' + esc(s.url) + '" target="_blank">source</a>' : '') + '</div>' +
      '<div style="margin-top:6px"><button class="btn ghost sm" data-sig="' + s.signal_id + '">Reason over this →</button> <span class="sub" id="dm_' + s.signal_id + '"></span></div>' +
      '<div id="dec_' + s.signal_id + '"></div></div>'
    ).join('') : '<div class="foot">No signals captured yet for ' + esc(DISP) + '.</div>') + '</div>';
  host.querySelectorAll('button[data-sig]').forEach(b => b.onclick = () => decide(b.getAttribute('data-sig')));
}
async function decide(signalId) {
  const msg = $('dm_' + signalId); const host = $('dec_' + signalId);
  msg.className='sub'; msg.innerHTML='<span class="dot"></span> Analyst is reasoning… (~20s)';
  try {
    const j = await api('/decide', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ signalIds:[signalId] }) });
    msg.textContent=''; const d = j.decision; const actionable = d.action !== 'hold' && d.symbol && d.qty > 0;
    host.innerHTML = '<div class="why"><div><span class="pill ' + d.action + '">' + d.action + '</span> ' +
      (actionable ? '<strong>' + esc(d.symbol) + '</strong> · ' + d.qty + ' sh · ' + esc(d.orderType||'market') + (d.limitPrice?(' @ '+money(d.limitPrice)):'') : 'no trade') +
      ' <span class="foot">confidence ' + Math.round((d.confidence||0)*100) + '%</span></div>' +
      '<div class="rat" style="margin-top:8px">' + esc(d.rationale) + '</div>' +
      (actionable ? '<div style="margin-top:10px"><button class="btn ' + (d.side==='sell'?'ghost':'buy') + ' sm" id="exec_' + j.decisionId + '">' + (MODE==='live'?'Place LIVE order':'Place paper order') + '</button> <span class="sub" id="em_' + j.decisionId + '"></span></div>' : '') + '</div>';
    if (actionable) $('exec_' + j.decisionId).onclick = () => execute(j.decisionId, d);
  } catch (e) { msg.className='sub err'; msg.textContent=e.message; }
}
async function execute(decisionId, d) {
  const msg = $('em_' + decisionId); const btn = $('exec_' + decisionId);
  const label = d.side + ' ' + d.qty + ' ' + d.symbol + (d.orderType==='limit'?(' @ '+money(d.limitPrice)):' at market');
  if (STATUS.bookEnabled === false && d.side === 'buy') { alert('This account is view-only — buys are off. Use Start trading on the account page to arm it.'); return; }
  if (MODE === 'live' && !confirm('Place a LIVE order on ' + (DISP||BOOK) + ' to ' + label + '?\nThis trades REAL money in account ' + (DISP||BOOK) + '.')) return;
  btn.disabled = true; msg.className='sub'; msg.innerHTML='<span class="dot"></span> Placing…';
  // ONE requestId per decision (never per click): the engine's reservation arbiter keys on it, so a retry
  // after a lost response is refused as a duplicate instead of placing a second real order.
  const requestId = 'cap-' + String(decisionId).slice(0, 8);
  try { const j = await api('/orders', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ decisionId, requestId, confirm: MODE==='live' }) });
    const ord = (j && j.order) || {}; const bad = /reject|cancel|fail/i.test(String(ord.status || ''));
    msg.className = bad ? 'sub err' : 'sub ok';
    msg.textContent = (bad ? 'Not placed (' : 'Order ') + (ord.status || 'submitted') + (bad ? ')' : '') + (ord.id ? ' (' + String(ord.id).slice(0,8) + ')' : '') + (ord.rejectReason ? ' — ' + ord.rejectReason : '') + '.';
    if (bad) btn.disabled = false;                         // a venue rejection may legitimately be retried (same requestId)
    // The refresh is best-effort and MUST NOT mask the result (this view has no KPI strip).
    try { UNIVERSE = {}; await loadKpisAndPositions(); } catch (re) { /* nothing to paint here */ }
  } catch (e) {
    const dup = /duplicate|already/i.test(e.message || '');
    msg.className = dup ? 'sub warn' : 'sub err';
    msg.textContent = dup ? 'Already submitted for this decision — check the Trade journal before placing again.' : e.message;
    if (!dup) btn.disabled = false;
  }
}

/* ── view entry ──────────────────────────────────────────────── */
async function renderResearchView(token) {
  main.innerHTML = '<div class="panel"><h2>Research</h2><div class="sub">Research one stock — quote, chart, fundamentals, earnings, news, filings, events — or the market: recommendations, algorithm scans and captured signals. Buys, signals and decisions from this page act on the account shown below.</div></div>' +
    acctContextBar('buys, signals and decisions from this page act on this account') + '<div id="viewTabs"></div>';
  if (stale(token)) return;
  wireAcctContextBar();
  subTabs('viewTabs', [['stock','Research a stock'],['movers','Market movers'],['reco','Recommendations'],['algos','Algorithms'],['capture','Capture & signals']], SUB || 'stock', (k) => {
    // The stock tab's autocomplete outlives an in-place research but not a sub-tab switch — detach it
    // as the previous tab body is discarded so no debounce timer or dropdown leaks.
    if (RS_SEARCH && typeof detachSymbolSearch === 'function') { detachSymbolSearch(RS_SEARCH); RS_SEARCH = null; }
    if (k === 'stock') loadStockTab();
    else if (k === 'movers') loadMoversTab();
    else if (k === 'reco') loadReco();
    else if (k === 'algos') loadAlgos();
    else if (k === 'capture') { renderCapture(); loadFeed(); }
  });
}
