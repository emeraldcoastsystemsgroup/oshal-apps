/* trading/ui/view-account.js — the single-ACCOUNT detail view of the Trading surface (ADR-136 D1).
 *
 * Paints ONE account into #main: the account header (name, kind + trading-state pills, the strategy
 * it runs with an inline change control, Buy a stock, Start/Stop trading), the KPI strip, the open
 * positions, the focus pane (chart + signal model + ticket, filled when a position is clicked) and
 * the Trade journal / Performance sub-tabs. Classic script, plain globals, loaded after app.js.
 *
 * Contract: app.js render() calls renderAccountView(token) with STATUS fetched for BOOK/MODE and
 * DISP = the human label. Sibling globals CALLED here, never defined: loadKpisAndPositions(),
 * annotatePositionSignals(), loadPerfSummary(), focus() [shared-positions.js]; openTicket()
 * [ticket.js]; toggleBook(), fillStrategyPickers(), setBookStrategy(), resetBookStrategy(),
 * eventPlanActive(), eventStatusPill(), eventEntryExitText() [view-strategies.js]. Every paint after
 * an await checks stale(token) — a stale response from a previous account must never paint this one.
 */

/* ── the view ──────────────────────────────────────────────────────────────── */
async function renderAccountView(token) {
  try {
    const b = bookOf(BOOK);
    const name = esc(DISP);
    const viewOnly = STATUS.bookEnabled === false;
    const banner = viewOnly
      ? '<div class="livebanner viewonly">VIEW-ONLY account (' + name + ') — balances and positions only. Trading is off; the engine cannot buy here. Use &ldquo;Start trading&rdquo; to arm it.</div>'
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
    main.innerHTML = banner + accountHeader(b, viewOnly) +
      '<div id="eventPlanCard"></div>' +                                // an event playbook on this account (ADR-136 D6), filled async
      '<div id="ticketHost"></div>' +                                   // the direct-trade ticket lands here (openTicket)
      '<div id="kpis" class="kpis"></div>' +
      '<div id="positionsHero"><div class="panel">' + spinner('Loading positions…') + '</div></div>' +
      '<div class="panel" id="focus"><div class="foot" style="padding:22px 6px;text-align:center">Select a position above to open its chart, signal model and order ticket.</div></div>' +
      '<div id="viewTabs"></div>';
    renderStrategyLine(token, b);          // async — fills #stratLine when /lab/apply answers
    loadEventPlanCard(token);              // async — fills #eventPlanCard when /events/plans answers
    await loadKpisAndPositions();          // KPI strip + STATE.positions + the positions hero
    if (stale(token)) return;
    annotatePositionSignals();             // annotate each position with its stored signal (async, DB)
    loadPerfSummary();                     // total-return / vs-S&P KPI tiles without opening the tab
    if (PENDING_FOCUS) { const s = PENDING_FOCUS; PENDING_FOCUS = null; focus(s); const f = $('focus'); if (f) f.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
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
function accountHeader(b, viewOnly) {
  const kind = b ? b.kind : MODE;
  // The account TYPE (CASH/MARGIN/IRA…) lives on the discovered-account row, not the book row.
  const acct = b && b.bookId ? ACCOUNTS.find(a => a.book && a.book.bookId === b.bookId) : null;
  const type = (acct && acct.accountType) || (b && (b.accountType || b.type));
  const pills = '<span class="pill">' + esc(kind) + '</span>' +
    (type ? ' <span class="pill">' + esc(type) + '</span>' : '') +
    (viewOnly ? ' <span class="pill">view-only</span>' : ' <span class="pill ok">trading</span>');
  const buy = '<button class="btn buy" onclick="openTicket()"' +
    (viewOnly ? ' disabled title="Trading is off for this account — Start trading to arm it"' : ' title="Place a direct order on ' + esc(DISP) + '"') +
    '>Buy a stock</button>';
  const toggle = (MODE === 'live' && b && b.bookId)
    ? ' <button class="btn ghost" onclick="acctToggleTrading()">' + (viewOnly ? 'Start trading…' : 'Stop trading') + '</button>'
    : '';
  return '<div class="panel acct-head"><h2>' + esc(DISP) + '</h2>' + pills +
    '<span class="spacer"></span>' + buy + toggle +
    '<div id="stratLine" class="sub" style="flex-basis:100%">Loading strategy…</div></div>';
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
