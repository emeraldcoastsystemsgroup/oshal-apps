/* trading/ui/view-account.js — the single-ACCOUNT detail view of the Trading surface (ADR-136 D1).
 *
 * Paints ONE account into #main: the account header (name, kind + trading-state pills, the strategy
 * it runs with an inline change control, Buy a stock, Start/Stop trading), the KPI strip, the open
 * positions, the focus pane (chart + signal model + ticket, filled when a position is clicked) and
 * the Trade journal / Performance sub-tabs. Classic script, plain globals, loaded after app.js.
 *
 * Contract: app.js render() calls renderAccountView(token) with STATUS fetched for BOOK/MODE and
 * DISP = the human label. Sibling globals CALLED here, never defined: loadKpisAndPositions(),
 * annotatePositionSignals(), loadPerfSummary(), focus(), renderPortfolioTable() [shared-positions.js];
 * openTicket(), tktProtWords() [ticket.js]; toggleBook(), fillStrategyPickers(), setBookStrategy(),
 * resetBookStrategy(), eventPlanActive(), eventStatusPill(), eventEntryExitText() [view-strategies.js];
 * PENDING_TICKET [view-research.js — consumed here, read through typeof]. Every paint after an await
 * checks stale(token) — a stale response from a previous account must never paint this one.
 *
 * ADR-138: the 'Protected lots' card (GET /lots) lists this account's ring-fenced purchases with a
 * Release action, and publishes window.PINNED_BY_SYMBOL so the positions table can mark 'pinned N'.
 *
 * ADR-136 D4: the 'Timed orders' card (GET /dated) lists this account's scheduled operator orders with
 * a Cancel action (POST /dated/:id/cancel) until they fire; fired/expired/cancelled rows stay as history.
 */

/* ── the view ──────────────────────────────────────────────────────────────── */
async function renderAccountView(token) {
  try {
    const b = bookOf(BOOK);
    const name = esc(DISP);
    // "Autopilot off" (was "view-only"): the AUTOPILOT won't autonomously trade this account — but
    // the operator can always buy/sell manually (2026-09-04 fix). Only autonomous trading is gated.
    const autopilotOff = STATUS.bookEnabled === false;
    const banner = autopilotOff
      ? '<div class="livebanner viewonly">AUTOPILOT OFF for ' + name + ' — the engine will not trade this account on its own. You can still buy and sell manually with <b>Buy a stock</b>; use &ldquo;Start trading&rdquo; to let the autopilot run it too.</div>'
      : (MODE === 'live')
        ? '<div class="livebanner">LIVE account (' + name + ') — orders place REAL trades with REAL money. Each order asks you to confirm.</div>'
        : '';
    // "configured" reflects THIS book (the server's reader binding), not the legacy paper/live rails.
    if (STATUS.bookConfigured === false) {
      main.innerHTML = banner + '<div class="panel"><h2>Broker not connected for ' + name + '</h2><div class="sub err">' +
        (MODE === 'live'
          ? 'This account\'s Schwab connection is not available. Re-connect Schwab from the cockpit: Settings → Connections.'
          : 'Set the Alpaca paper keys.') +
        '</div></div>';
      return;
    }
    window.PINNED_BY_SYMBOL = null; ACCT_LOTS = []; ACCT_DATED = [];  // another account's pins/timed orders must never show here
    main.innerHTML = banner + accountHeader(b, autopilotOff) +
      '<div id="eventPlanCard"></div>' +                                // an event playbook on this account (ADR-136 D6), filled async
      '<div id="ticketHost"></div>' +                                   // the direct-trade ticket lands here (openTicket)
      '<div id="kpis" class="kpis"></div>' +
      '<div id="positionsHero"><div class="panel">' + spinner('Loading positions…') + '</div></div>' +
      '<div id="lotsCard"></div>' +                                     // protected lots (ADR-138), filled async
      '<div id="datedCard"></div>' +                                    // timed orders (ADR-136 D4), filled async; empty when none
      '<div class="panel" id="focus"><div class="foot" style="padding:22px 6px;text-align:center">Select a position above to open its chart, signal model and order ticket.</div></div>' +
      '<div id="viewTabs"></div>';
    wireAccountHeader();
    renderStrategyLine(token, b);          // async — fills #stratLine when /lab/apply answers
    loadEventPlanCard(token);              // async — fills #eventPlanCard when /events/plans answers
    loadLotsCard(token);                   // async — fills #lotsCard + PINNED_BY_SYMBOL when /lots answers
    loadDatedCard(token);                  // async — fills #datedCard when /dated answers (ADR-136 D4)
    await loadKpisAndPositions();          // KPI strip + STATE.positions + the positions hero
    if (stale(token)) return;
    annotatePositionSignals();             // annotate each position with its stored signal (async, DB)
    loadPerfSummary();                     // total-return / vs-S&P KPI tiles without opening the tab
    if (PENDING_FOCUS) { const s = PENDING_FOCUS; PENDING_FOCUS = null; focus(s); const f = $('focus'); if (f) f.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    if (typeof PENDING_TICKET !== 'undefined' && PENDING_TICKET) { const s = PENDING_TICKET; PENDING_TICKET = null; openTicket(s); const th = $('ticketHost'); if (th) th.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    subTabs('viewTabs', [['journal','Trade journal'],['perf','Performance']], SUB || 'journal', (k) => {
      if (k === 'journal') loadJournal();
      else if (k === 'perf') loadPerformance();
    });
  } catch (e) {
    if (!stale(token)) main.innerHTML = '<div class="panel err">' + esc(e.message) + '</div>';
  }
}

/* ── account header ────────────────────────────────────────────────────────── */
/* Name, kind + state pills, the actions, and the strategy line (its own full-width row, filled async). */
function accountHeader(b, autopilotOff) {
  const kind = b ? b.kind : MODE;
  // The account TYPE (CASH/MARGIN/IRA…) lives on the discovered-account row, not the book row.
  const acct = b && b.bookId ? ACCOUNTS.find(a => a.book && a.book.bookId === b.bookId) : null;
  const type = (acct && acct.accountType) || (b && (b.accountType || b.type));
  const pills = '<span class="pill">' + esc(kind) + '</span>' +
    (type ? ' <span class="pill">' + esc(type) + '</span>' : '') +
    (autopilotOff ? ' <span class="pill">autopilot off</span>' : ' <span class="pill ok">autopilot on</span>');
  // Buy is ALWAYS available — a manual order is the operator's own action (2026-09-04 fix).
  const buy = '<button class="btn buy" onclick="openTicket()" title="Place a direct order on ' + esc(DISP) + '">Buy a stock</button>';
  const toggle = (MODE === 'live' && b && b.bookId)
    ? ' <button class="btn ghost" onclick="acctToggleTrading()">' + (viewOnly ? 'Start trading…' : 'Stop trading') + '</button>'
    : '';
  const research = ' <button class="btn ghost" id="acctResearchBtn" title="Quote, chart, fundamentals, news and filings for one stock">Research a stock</button>';
  return '<div class="panel acct-head"><h2>' + esc(DISP) + '</h2>' + pills +
    '<span class="spacer"></span>' + research + buy + toggle +
    '<div id="stratLine" class="sub" style="flex-basis:100%">Loading strategy…</div></div>';
}
/* The header's id'd controls — wired after the paint (no ids or labels pass through onclick strings). */
function wireAccountHeader() {
  const rb = $('acctResearchBtn'); if (rb) rb.onclick = () => navigate('research', { sub: 'stock' });
}

/* Start/Stop trading on the selected account. toggleBook() (view-strategies.js) owns the confirm
   wording and the PATCH; BOOKS is refreshed so the header's state + button reflect the result. */
async function acctToggleTrading() {
  const b = bookOf(BOOK); if (!b) return;
  const enable = STATUS.bookEnabled !== undefined ? STATUS.bookEnabled === false : !b.enabled;
  await toggleBook(b.bookId, enable);   // toggleBook reloads BOOKS and re-renders this view itself
}

/* ── strategy line ─────────────────────────────────────────────────────────── */
/* WHAT this account runs — an applied lab strategy or the production baseline — with the inline
   change control right there. GET /lab/apply is scoped to BOOK by api(). Never blank: on a fetch
   error the line says so in red (the Set control is withheld — its options come from the lab). */
async function renderStrategyLine(token, b) {
  const el = $('stratLine'); if (!el) return;
  const bid = b && b.bookId ? esc(b.bookId) : '';
  const labLink = ' <a href="#" onclick="navigate(\'strategies\',{sub:\'lab\'});return false">Strategy Lab →</a>';
  let text, active = null, failed = false;
  try {
    const j = await api('/lab/apply');
    if (stale(token)) return;
    active = j.active || null;
    text = active ? runningText(active, j.activeSummary) : baselineText(j.envDefaults || {});
  } catch (e) {
    if (stale(token)) return;
    failed = true;
    text = '<span class="err">strategy state unavailable</span>';
  }
  // The picker carries the SAME id shape the roster uses (stratPick-<bookId>) so fillStrategyPickers()
  // populates it and setBookStrategy(bookId) reads it; labels are resolved from BOOKS at call time.
  const control = (bid && !failed)
    ? ' &nbsp; <select id="stratPick-' + bid + '" style="width:auto;display:inline-block;padding:4px 8px;min-width:170px"><option value="">' + (active ? 'switch strategy…' : 'Production baseline (current)') + '</option></select> ' +
      '<button class="btn sm" onclick="setBookStrategy(\'' + bid + '\')">Set</button>' +
      (active ? ' <button class="btn sm ghost" onclick="resetBookStrategy(\'' + bid + '\')">Reset to baseline</button>' : '')
    : '';
  el.innerHTML = text + control + labLink;
  if (control && typeof fillStrategyPickers === 'function') fillStrategyPickers();
}
/* 'Running <strategy> [@ N% of the account] since <date> · <summary>' */
function runningText(a, summary) {
  const pctTxt = (a.applyPct != null && Number(a.applyPct) !== 100) ? ' @ ' + esc(a.applyPct) + '% of the account' : '';
  return 'Running <b>' + esc(a.strategyName) + '</b>' + pctTxt + ' since ' + esc(fmtDate(a.appliedAt || a.createdAt)) +
    (summary ? ' · ' + esc(summary) : '');
}
/* The engine defaults, one line — the same knobs the legacy strategy strip showed. */
function baselineText(env) {
  const rot = env.rotation && env.rotation.enabled
    ? 'rotation ' + env.rotation.rank + '/' + env.rotation.everyDays + 'd/top' + env.rotation.topN + '/' + env.rotation.weighting
    : 'scan sleeve (rotation off)';
  const core = (env.core && env.core.symbols) || 'none';
  return '<span class="ok">Production baseline</span> · ' + esc(
    'posture ' + (env.posture || '?') + ' · tp ' + (env.takeProfitPct != null ? env.takeProfitPct + '%' : '—') +
    ' · ' + rot + ' · core ' + core + ' · universe ' + (env.universeCount || '?'));
}

/* ── event playbook card (ADR-136 D6) ─────────────────────────────────────── */
/* GET /events/plans is scoped to BOOK by api(): `plans` are THIS account's. One small panel per plan
   that is not finished (closed/cancelled/missed). Empty when there are none; silent when the route
   is missing or fails (an older server has no /events — the card is supplementary, never an error). */
async function loadEventPlanCard(token) {
  const el = $('eventPlanCard'); if (!el) return;
  let j;
  try { j = await api('/events/plans'); } catch { return; }   // older server / route down: stay empty
  if (stale(token)) return;
  const plans = (j.plans || []).filter(p => !['closed', 'cancelled', 'missed'].includes(p.status));
  el.innerHTML = plans.map(eventPlanCardHtml).join('');
  el.querySelectorAll('a[data-act="manage"]').forEach(a => a.onclick = (e) => { e.preventDefault(); navigate('strategies', { sub: 'events' }); });
}
/* Name, issuer/ticker, status pill, the one-line entry/exit, Manage → — and the view-only warning when
   an ARMED plan sits on an account that cannot buy. Helpers come from view-strategies.js. */
function eventPlanCardHtml(p) {
  const q = p.params || {};
  const active = eventPlanActive(p);
  const tick = q.ticker || p.ticker;
  const who = (q.issuer || tick) ? ' <span class="foot">' + esc(q.issuer || '') + (tick ? ' (' + esc(tick) + ')' : '') + '</span>' : '';
  return '<div class="panel" style="padding:10px 14px">' +
    '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><span class="foot" style="margin:0">' +
      (active ? 'EVENT PLAYBOOK ARMED ON THIS ACCOUNT' : 'EVENT PLAYBOOK (DRAFT)') + '</span> ' + eventStatusPill(p.status) +
      ' <a href="#" data-act="manage" style="margin-left:auto">Manage →</a></div>' +
    '<div style="margin-top:4px"><strong>' + esc(p.name) + '</strong>' + who + '</div>' +
    '<div class="foot">' + esc(eventEntryExitText(p)) + '</div>' +
    (active && STATUS.bookEnabled === false ? '<div class="sub warn" style="margin-top:4px">&#9888; This account is view-only — the plan cannot buy until you Start trading.</div>' : '') +
    '</div>';
}

/* ── protected lots card (ADR-138) ─────────────────────────────────────────── */
/* ── timed orders (ADR-136 D4) ─────────────────────────────────────────────── */
/* The timed orders of the CURRENT paint — Cancel resolves an id against this array (never an onclick string). */
let ACCT_DATED = [];
/* GET /dated is scoped to BOOK by api(). A failure is said in red, never a silent blank; no rows = no card. */
async function loadDatedCard(token) {
  const el = $('datedCard'); if (!el) return;
  let j;
  try { j = await api('/dated'); }
  catch (e) {
    if (stale(token)) return;
    el.innerHTML = '<div class="panel"><h2>Timed orders</h2><div class="err" style="font-size:13px">Timed orders unavailable: ' + esc(e.message) + '</div></div>';
    return;
  }
  if (stale(token) || !$('datedCard')) return;
  ACCT_DATED = j.dated || [];
  el.innerHTML = datedCardHtml(ACCT_DATED);
  el.onclick = (e) => { const b = e.target.closest('button[data-dated]'); if (!b || !el.contains(b)) return; e.preventDefault(); cancelDated(b.getAttribute('data-dated')); };
}
function datedCardHtml(rows) {
  if (!rows.length) return '';
  const pending = rows.filter(r => r.status === 'pending').length;
  const head = '<div class="panel"><div class="panel head2" style="padding:0;margin:0 0 8px;background:none;border:0;box-shadow:none"><h2 style="margin:0">Timed orders</h2>' +
    '<span class="foot" style="margin-left:auto">' + pending + ' pending' + (rows.length - pending ? ' · ' + (rows.length - pending) + ' done' : '') + '</span></div>';
  return head + '<div style="overflow-x:auto"><table><thead><tr><th>Fires (ET)</th><th>Order</th><th>Status</th><th></th></tr></thead><tbody>' + rows.map(datedRowHtml).join('') + '</tbody></table></div>' +
    '<div class="foot" style="margin-top:8px">A timed order is placed by the trading leg at its time (5-minute ticks, 9:00 AM–4:55 PM ET on trading days). Once fired it is an ordinary order in the Trade journal. A window missed by more than the grace expires unfired.</div></div>';
}
function datedRowHtml(r) {
  const k = r.status === 'fired' ? 'filled' : (r.status === 'pending' ? 'pending' : ((r.status === 'error' || r.status === 'expired') ? 'rejected' : ''));
  const detail = r.status === 'fired' ? (r.firedStatus ? ' <span class="foot" style="margin:0">(' + esc(r.firedStatus) + ')</span>' : '') : (r.error ? ' <span class="foot" style="margin:0">— ' + esc(r.error) + '</span>' : '');
  return '<tr><td>' + esc(r.fireAtWords || fmtDate(r.fireAt)) + '</td>' +
    '<td><strong>' + esc(String(r.side || '').toUpperCase()) + ' ' + esc(r.qty) + ' ' + esc(r.symbol) + '</strong> <span class="foot" style="margin:0">' + esc(String(r.orderType || '').replace(/_/g, ' ')) + '</span></td>' +
    '<td><span class="pill ' + k + '">' + esc(r.status) + '</span>' + detail + '</td>' +
    '<td style="text-align:right">' + (r.status === 'pending' ? '<button class="btn ghost sm" data-dated="' + esc(r.datedId) + '">Cancel…</button>' : '') + '</td></tr>';
}
/* POST /dated/:id/cancel after a confirm() naming the order; the card reloads on success, says why on failure. */
async function cancelDated(id) {
  const r = ACCT_DATED.find(x => String(x.datedId) === String(id)); if (!r) return;
  if (!confirm('Cancel the timed order ' + String(r.side).toUpperCase() + ' ' + r.qty + ' ' + r.symbol + ' on ' + DISP + ' (fires ' + (r.fireAtWords || fmtDate(r.fireAt)) + ')?\nIt will not be placed.')) return;
  const token = RENDER_TOKEN;
  try { await api('/dated/' + encodeURIComponent(id) + '/cancel', jbody('POST', {})); }
  catch (e) {
    const el = $('datedCard');
    if (el && !stale(token)) el.insertAdjacentHTML('afterbegin', '<div class="err" style="font-size:13px;margin:0 0 6px">Could not cancel: ' + esc(e.message || 'unknown error') + '</div>');
    return;
  }
  if (!stale(token)) loadDatedCard(token);
}

/* The lots of the CURRENT paint — the delegated Release handler resolves a lotId against this array,
   so the confirm() names symbol/shares from the model at call time, never from an onclick string. */
let ACCT_LOTS = [];
/* GET /lots is scoped to BOOK by api(). Publishes pinnedBySymbol for the positions table's 'pinned N'
   pill and repaints that table if it is already up. A failure is said in red — the operator must know
   when the protected lots (and their pins) cannot be shown; never a silent blank. */
async function loadLotsCard(token) {
  const el = $('lotsCard'); if (!el) return;
  let j;
  try { j = await api('/lots'); }
  catch (e) {
    if (stale(token)) return;
    el.innerHTML = '<div class="panel"><h2>Protected lots</h2><div class="err" style="font-size:13px">Protected lots unavailable: ' + esc(e.message) + '</div></div>';
    return;
  }
  if (stale(token) || !$('lotsCard')) return;
  ACCT_LOTS = j.lots || [];
  window.PINNED_BY_SYMBOL = j.pinnedBySymbol || {};
  el.innerHTML = lotsCardHtml(ACCT_LOTS);
  wireLotsCard(el);
  if ((STATE.positions || []).length && typeof renderPortfolioTable === 'function') renderPortfolioTable();
}
function lotsCardHtml(lots) {
  const active = lots.filter(l => l.status !== 'closed' && l.status !== 'released').length, done = lots.length - active;
  const head = '<div class="panel"><div class="panel head2" style="padding:0;margin:0 0 8px;background:none;border:0;box-shadow:none"><h2 style="margin:0">Protected lots</h2>' +
    (lots.length ? '<span class="foot" style="margin-left:auto">' + active + ' active' + (done ? ' · ' + done + ' closed/released' : '') + '</span>' : '') + '</div>';
  if (!lots.length) return head + '<div class="foot" style="margin:0">No protected lots on this account.</div></div>';
  return head + '<div style="overflow-x:auto"><table><thead><tr><th>Symbol</th><th class="num">Shares</th><th class="num">Avg</th><th>Protection</th><th>Status</th><th></th></tr></thead><tbody>' +
    lots.map(lotRowHtml).join('') + '</tbody></table></div>' +
    '<div class="foot" style="margin-top:8px">Protected lots are ring-fenced from the autopilot — only their own rules sell them. Release hands the shares back to the account\'s strategy.</div></div>';
}
/* Shares reads filled/ordered until the fill completes; Release is offered while the lot is live. */
function lotRowHtml(l) {
  const qty = Number(l.qty || 0), filled = l.filledQty != null ? Number(l.filledQty) : 0;
  const shares = filled === qty ? String(qty) : filled + '/' + qty;
  const releasable = l.status !== 'closed' && l.status !== 'released';
  return '<tr><td><strong>' + esc(l.symbol) + '</strong></td>' +
    '<td class="num" title="filled / ordered">' + esc(shares) + '</td>' +
    '<td class="num">' + (l.filledAvgPrice != null ? money(l.filledAvgPrice) : '—') + '</td>' +
    '<td style="font-size:12.5px">' + esc(lotRulesWords(l)) + '</td>' +
    '<td>' + lotStatusPill(l.status) + '</td>' +
    '<td style="text-align:right">' + (releasable ? '<button class="btn ghost sm" data-lot="' + esc(l.lotId) + '">Release…</button>' : '') + '</td></tr>';
}
/* The lot's rules in the SAME words the ticket used (tktProtWords, off the fill price), plus the exit
   prices the server actually placed once it has them. */
function lotRulesWords(l) {
  const r = l.rules || {}, x = l.exits || {}, base = l.filledAvgPrice != null ? Number(l.filledAvgPrice) : null;
  const words = typeof tktProtWords === 'function' ? tktProtWords(r, base > 0 ? base : null)
    : Object.keys(r).map(k => k + ' ' + r[k]).join(' · ');
  const placed = [x.tpPx != null ? 'take profit ' + money(x.tpPx) : '', x.stopPx != null ? 'stop ' + money(x.stopPx) : ''].filter(Boolean);
  return (words || 'no exit rules (hold only)') + (placed.length ? ' — placed: ' + placed.join(', ') : '');
}
function lotStatusPill(s) {
  const k = (s === 'open' || s === 'exits_placed') ? 'filled' : (s === 'pending_fill' ? 'pending' : (s === 'error' ? 'rejected' : ''));
  return '<span class="pill ' + k + '">' + esc(String(s || 'unknown').replace(/_/g, ' ')) + '</span>';
}
/* One handler on the card host (assignment, so a reload never stacks a second listener). */
function wireLotsCard(el) {
  el.onclick = (e) => {
    const b = e.target.closest('button[data-lot]'); if (!b || !el.contains(b)) return;
    e.preventDefault(); releaseLot(b.getAttribute('data-lot'));
  };
}
/* POST /lots/:id/release {confirm:true} after a confirm() naming the lot; the card reloads on success. */
async function releaseLot(lotId) {
  const l = ACCT_LOTS.find(x => String(x.lotId) === String(lotId)); if (!l) return;
  const shares = l.filledQty != null && Number(l.filledQty) > 0 ? l.filledQty : l.qty;
  if (!confirm('Release the protected lot of ' + shares + ' ' + l.symbol + ' on ' + DISP + '?\nIts rules stop applying and the shares return to the account\'s strategy — the autopilot may then sell them.')) return;
  const token = RENDER_TOKEN;
  try { await api('/lots/' + encodeURIComponent(lotId) + '/release', jbody('POST', { confirm: true })); }
  catch (e) { if (!stale(token)) alert('Release failed: ' + e.message); return; }
  if (stale(token)) return;
  loadLotsCard(token);
}

/* ── performance — sub-tab (moved from the legacy page) ────────────────────── */
/* The chart handle. Declared via window so a sibling module that also moved the legacy `let PCHART`
   cannot collide with a second top-level let (that SyntaxError would kill this whole script). */
if (typeof PCHART === 'undefined') window.PCHART = null;
function loadPerformance() {
  const host = $('tabbody'); if (!host) return;
  const periods = ['1W','1M','3M','1Y'];
  host.innerHTML = '<div class="panel"><div class="panel head2"><h2 style="margin:0">Performance vs market</h2>' +
    '<div class="switch" id="perfTf" style="margin-left:auto">' + periods.map(p=>'<button data-p="'+p+'"'+(p===PERF_PERIOD?' class="on"':'')+'>'+p+'</button>').join('') + '</div></div>' +
    '<div id="perfSum" class="foot" style="margin-bottom:8px">&nbsp;</div><div id="perfC" style="height:300px;width:100%"></div><div id="perfMsg" class="foot"></div></div>';
  $('perfTf').querySelectorAll('button').forEach(b => b.onclick = () => { PERF_PERIOD = b.getAttribute('data-p'); loadPerformance(); });
  drawPerformance();
}
async function drawPerformance() {
  const token = RENDER_TOKEN, gen = tabGen();
  const el = $('perfC'), msg = $('perfMsg'), sum = $('perfSum'); if (!el) return;
  msg.textContent = 'loading…';
  try {
    const j = await api('/performance?period=' + PERF_PERIOD);
    if (stale(token) || tabStale(gen)) return;
    const p = j.portfolio || [], spy = j.spy || [];
    if (!p.length) { msg.textContent = 'No equity history yet for this period.'; return; }
    if (PCHART) { try { PCHART.remove(); } catch {} PCHART = null; }
    if (!window.LightweightCharts) { msg.innerHTML = '<span class="err">chart lib missing</span>'; return; }
    const css = getComputedStyle(document.documentElement); const line = (v,d)=> (css.getPropertyValue(v).trim()||d);
    PCHART = LightweightCharts.createChart(el, { width: el.clientWidth, height: 300,
      layout:{ background:{ type:'solid', color:'transparent' }, textColor: line('--muted','#8a99a3') },
      grid:{ vertLines:{ color: line('--line','#26333f') }, horzLines:{ color: line('--line','#26333f') } },
      rightPriceScale:{ borderColor: line('--line','#26333f') }, timeScale:{ borderColor: line('--line','#26333f') }, crosshair:{ mode:0 } });
    const me = PCHART.addLineSeries({ color: line('--buy','#34c79a'), lineWidth: 2, title: 'You' });
    me.setData(p.map(d => ({ time: d.t, value: Number(d.pct.toFixed(3)) })));
    if (spy.length) { const sp = PCHART.addLineSeries({ color: line('--muted','#8a99a3'), lineWidth: 1, lineStyle: 2, title: 'S&P 500' });
      sp.setData(spy.filter(d=>d.t).map(d => ({ time: d.t, value: Number(d.pct.toFixed(3)) }))); }
    PCHART.timeScale().fitContent();
    const s = j.summary || {};
    sum.innerHTML = '<strong style="font-size:14px;color:'+(s.totalReturnPct>=0?'var(--buy)':'var(--sell)')+'">' + pct(s.totalReturnPct) + '</strong> you · ' +
      '<span style="color:var(--muted)">' + pct(s.spyReturnPct) + ' S&P</span> · ' +
      '<strong style="color:'+(s.vsSpyPct>=0?'var(--buy)':'var(--sell)')+'">' + pct(s.vsSpyPct) + ' vs market</strong> <span class="foot">(' + PERF_PERIOD + ', cumulative)</span>';
    msg.textContent = '';
    try { new ResizeObserver(()=>{ if (PCHART && el.clientWidth) PCHART.applyOptions({ width: el.clientWidth }); }).observe(el); } catch {}
  } catch (e) { if (!stale(token)) msg.innerHTML = '<span class="err">' + esc(e.message) + '</span>'; }
}

/* ── trade journal — sub-tab (moved from the legacy page) ──────────────────── */
async function loadJournal() {
  const token = RENDER_TOKEN, gen = tabGen();
  const host = $('tabbody'); if (!host) return;
  let trades = [];
  try { trades = (await api('/journal')).trades || []; } catch (e) { if (!stale(token) && !tabStale(gen)) host.innerHTML='<div class="panel err">'+esc(e.message)+'</div>'; return; }
  if (stale(token) || tabStale(gen)) return;
  host.innerHTML = '<div class="panel"><h2>Trade journal — what the bot did &amp; why (' + esc(DISP) + ')</h2>' +
    (trades.length ? trades.map((t,i) => renderTrade(t,i)).join('') : '<div class="foot">No trades on ' + esc(DISP) + ' yet.</div>') + '</div>';
  host.querySelectorAll('button[data-exp]').forEach(b => b.onclick = () => { const el = $('exp_' + b.getAttribute('data-exp')); el.style.display = el.style.display === 'none' ? 'block' : 'none'; });
  // "Focus →" opens the position's chart/signal model/ticket in #focus above (same wiring as the positions table).
  host.querySelectorAll('button[data-fsym]').forEach(b => b.onclick = () => { focus(b.getAttribute('data-fsym')); const f=$('focus'); if (f) f.scrollIntoView({ behavior:'smooth', block:'start' }); });
}
function renderTrade(t, i) {
  const sig = (t.signals || [])[0];
  const sigLine = sig ? '<span class="pill">' + esc(sig.source) + '</span> ' + esc(sig.author || '') + ' — ' + esc(sig.title || (sig.body||'').slice(0,90)) + (sig.url ? ' · <a href="'+esc(sig.url)+'" target="_blank">source</a>' : '') : '<span class="foot">algo / no signal</span>';
  const px = (t.order_type === 'limit' || t.order_type === 'stop_limit') ? (' @ ' + money(t.limit_price)) : (t.order_type === 'stop') ? (' stop ' + money(t.stop_price)) : (t.order_type === 'trailing_stop') ? (' trail ' + (t.trail_percent ? t.trail_percent + '%' : money(t.trail_price))) : '';
  const fill = Number(t.filled_qty) > 0 ? (' · filled ' + t.filled_qty + (t.filled_avg_price ? ' @ ' + money(t.filled_avg_price) : '')) : '';
  // A sell isn't inherently "bad" — what matters is whether the CLOSE made money. Color the card by
  // realized P&L when we closed a position, and show the gain/loss plainly. Buys (opens) stay neutral.
  const rp = (t.realized_pnl != null && t.realized_pnl !== '') ? Number(t.realized_pnl) : null;
  const showRp = rp != null && (t.side === 'sell' || rp !== 0);
  const borderColor = showRp ? (rp >= 0 ? 'var(--buy)' : 'var(--sell)') : (t.side==='buy'?'var(--buy)':'var(--sell)');
  const rpBadge = showRp ? ' <strong class="' + (rp>=0?'ok':'err') + '" title="Realized profit/loss on this close">' + (rp>=0?'+':'') + money(rp) + (rp>=0?' profit':' loss') + '</strong>' : '';
  return '<div class="sig" style="border-left-color:' + borderColor + '">' +
    '<div><span class="pill ' + t.side + '">' + t.side + '</span> <strong>' + esc(t.symbol) + '</strong> · ' + t.qty + ' sh · ' + esc(t.order_type) + px +
      ' <span class="pill ' + esc(t.status) + '">' + esc(t.status) + '</span>' + rpBadge +
      ' <span class="foot">' + fmtDate(t.created_at) + ' · conf ' + Math.round((t.confidence||0)*100) + '%' + fill + '</span>' +
      ' <button class="btn ghost sm" data-fsym="' + esc(t.symbol) + '" style="float:right">Focus →</button></div>' +
    '<div class="foot" style="margin-top:4px">SIGNAL: ' + sigLine + '</div>' +
    '<div style="margin-top:4px"><button class="btn ghost sm" data-exp="' + i + '">Why?</button></div>' +
    '<div id="exp_' + i + '" style="display:none"><div class="why"><div class="rat">' + esc(t.rationale) + '</div>' +
      (t.signals||[]).map(s => '<div class="sig"><strong>' + esc(s.title || (s.body||'').slice(0,80)) + '</strong><div class="foot">' + esc(s.source) + (s.author?(' · '+esc(s.author)):'') + ' · ' + fmtDate(s.observed_at) + '</div>' + (s.body ? '<div class="rat" style="margin-top:4px">' + esc(s.body) + '</div>' : '') + '</div>').join('') +
    '</div></div></div>';
}
