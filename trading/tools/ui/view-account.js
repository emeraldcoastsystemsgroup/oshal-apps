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
 * The card's footnote states the leg's as-built cadence — a fire at its own MINUTE, 7:00 AM–7:59 PM ET
 * on trading days, and the venue's pre/post rule outside 9:30–4:00 (extended-hours limit day order only).
 *
 * ADR-134 D8: the header's CASH/MARGIN pill now comes from the book row itself (GET /accounts books[]
 * .accountType — one source) and a CASH account gets a small "Unsettled buys" select (default / refuse /
 * warn) that PATCHes settlementPolicy; 'off' is deliberately not offered (env-only).
 *
 * ADR-136 exposure: the 'Allocation' and 'Exits' cards (GET /exposure) sit between the positions hero
 * and the protected lots. Allocation is the asset-kind + SECTOR mix, and both taxonomies are labelled
 * with the source they actually came from — the engine's own sectorOf() map (the buckets the per-sector
 * sizing cap enforces) and the Alpaca asset directory for stock-vs-ETF — so no bucket on this page is
 * an invention of the surface. Exits shows what is WORKING AT THE VENUE first (the broker's own order
 * record) and the autopilot's exit RULES second, explicitly labelled as rules rather than resting
 * orders, greyed for a core hold and marked not-in-force outside the regular session or under a halt.
 * renderExposureCards() follows renderStrategyLine()'s spelling, not the load* one: it is a view-scoped
 * async painter that takes the render token and re-checks stale(token) before it paints.
 * Both cards repeat the payload's `sections` map: the route degrades a failed side read to 'unavailable'
 * instead of fabricating, and a card that painted that fallback silently would turn the honesty back into
 * a lie. A failed protected-lot read SUPPRESSES the rules table outright - the autopilot itself skips the
 * fire on that read, so a stop drawn over shares it may not sell would be the most reassuring lie here.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Log opened at 1.10.1 — this file predates the log and its earlier history is in git. ADR-136 D4 follow-up: the Timed orders card footnote states the as-built cadence (the leg places the order at its own MINUTE, 7:00 AM–7:59 PM ET on trading days) and the venue pre/post rule outside 9:30–4:00, replacing the retired five-minute-tick, 9:00 AM-to-4:55 PM wording that no longer described the leg.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Strict-CSP cleanup (ADR-136 D2 tail): the five handler attributes in this file are gone. The header panel is #acctHead with ONE delegated listener; Buy / Start-Stop / Research / Strategy Lab / Set / Reset are data-act values dispatched through acctHeaderAction(), which resolves the book id from BOOK at CLICK time instead of baking it into markup. #stratLine sits inside #acctHead, so the async-painted strategy controls need no separate wiring.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | wireAccountHeader carries JSDoc (@description/@returns) rather than a prose block comment - the repo rule applies to the rewritten function, not only to the new ones.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | ADR-136 surface expansion: the Allocation and Exits cards. Allocation paints the asset-kind and per-SECTOR mix from GET /exposure against the engine's own per-sector cap (value, % of equity, cap %, headroom, a tilt pill when TRADING_SECTOR_TILT leans a sector) and names both sources in the foot, including how many names sit outside the engine's sector map. Exits paints the venue's OWN working orders first and the autopilot's exit rules second, with the rule block marked not-in-force off-hours (the engine runs only the close-anchored dip rule then), under TRADING_HALT, when the venue clock is blind, and per core hold. A failed section says so in red - never a blank panel and never an invented row.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | Exposure review round: the cards repeat EVERY degraded section, not just the asset directory. /exposure reports six side reads and four of them (protected-lot pins, protected-lot records, trailing peaks, strategy override) were previously painted as fact when they failed - worst case the pins, where the fallback is a no-op subtraction and the card would draw stops and trims over shares the autopilot is forbidden to sell while the foot claimed they were excluded. Now: a red 'Degraded' line on each card naming what could not be read and what that costs the figures below (a section the payload gains later is surfaced by both cards rather than dropped by both), and a failed protected-lot read suppresses the rules table entirely - the engine fails the same way, skipping the fire rather than acting on an unknown book. A failed peaks read is also called out in the rules foot, because every trailing stop is then anchored at average cost.
 * 7 | maintainer@emeraldcoastsystemsgroup.com   | ADR-159 reaches the Exits card and the book switch. (a) A rule row the engine will not exit - a holding its own filled orders cannot account for, or a TRADING_CORE_SYMBOLS ring-fence - is greyed, badged, and says the engine's own sentence about why, instead of printing a stop price for a stop that will never fire; that was the one row where the absence of protection mattered and it looked exactly like the fourteen where it did not. (b) A row whose posture could not be READ keeps its prices and carries a quiet 'not known' pill: the rules shown are still the engine's own functions evaluated here, and what is unknown is only whether the engine will act on the result - blanking the row would hide protection that is probably there. (c) The book switch clears window.GOVERNANCE_BY_SYMBOL beside PINNED_BY_SYMBOL, to null rather than {} so a row reads NOT KNOWN until this book's own answer lands instead of inheriting the last account's.
 * 6 | maintainer@emeraldcoastsystemsgroup.com   | Exposure review round 2: the five async card painters move out of renderAccountView into kickAccountCards(token, b). renderAccountView had grown to exactly the 50-line function limit, so the next line added to it would have broken the rule; the painters were already one list doing one job and read better named. No painter, token or ordering change - each still fills its own placeholder and re-checks stale(token) before it paints. The withheld-rules block also says that the SERVER withholds too (exits.rules comes back null when the protected-lot read failed), so the card is not the only thing standing between a consumer and stops drawn over ring-fenced shares.
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
    // Another account's pins, timed orders and engine posture must never show here. GOVERNANCE is
    // cleared to null rather than {} so a row reads NOT KNOWN until this book's own answer lands.
    window.PINNED_BY_SYMBOL = null; window.GOVERNANCE_BY_SYMBOL = null; ACCT_LOTS = []; ACCT_DATED = [];
    main.innerHTML = banner + accountHeader(b, autopilotOff) +
      '<div id="eventPlanCard"></div>' +                                // an event playbook on this account (ADR-136 D6), filled async
      '<div id="ticketHost"></div>' +                                   // the direct-trade ticket lands here (openTicket)
      '<div id="kpis" class="kpis"></div>' +
      '<div id="positionsHero"><div class="panel">' + spinner('Loading positions…') + '</div></div>' +
      '<div id="mixCard"></div>' +                                      // allocation mix (ADR-136 /exposure), filled async
      '<div id="exitsCard"></div>' +                                    // venue exits + autopilot rules (ADR-136 /exposure), filled async
      '<div id="lotsCard"></div>' +                                     // protected lots (ADR-138), filled async
      '<div id="datedCard"></div>' +                                    // timed orders (ADR-136 D4), filled async; empty when none
      '<div class="panel" id="focus"><div class="foot" style="padding:22px 6px;text-align:center">Select a position above to open its chart, signal model and order ticket.</div></div>' +
      '<div id="viewTabs"></div>';
    wireAccountHeader();
    kickAccountCards(token, b);            // the five async card painters, each filling its own placeholder
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

/**
 * @description Start every async card painter for this account view. Each one fetches its own read
 *   and fills its own placeholder, and each re-checks stale(token) after its await, so a slow answer
 *   can never land on an account the operator has already switched away from. Kept as one named list
 *   rather than five lines inside renderAccountView, which sits at the 50-line function limit.
 * @param token - The render token of the paint that created the placeholders.
 * @param b - The book row this view is painting (the strategy line needs it).
 * @returns Nothing - the painters run on their own.
 */
function kickAccountCards(token, b) {
  renderStrategyLine(token, b);   // #stratLine     <- /lab/apply
  loadEventPlanCard(token);       // #eventPlanCard <- /events/plans
  loadLotsCard(token);            // #lotsCard + PINNED_BY_SYMBOL <- /lots (ADR-138)
  renderExposureCards(token);     // #mixCard + #exitsCard <- /exposure (ADR-136)
  loadDatedCard(token);           // #datedCard     <- /dated (ADR-136 D4)
}

/* ── account header ────────────────────────────────────────────────────────── */
/* Name, kind + state pills, the actions, and the strategy line (its own full-width row, filled async). */
function accountHeader(b, autopilotOff) {
  const kind = b ? b.kind : MODE;
  // The account TYPE (cash/margin) rides the book row (ADR-134 D8, one source); the discovered-account
  // row is the fallback for an older server that has not been redeployed yet.
  const acct = b && b.bookId ? ACCOUNTS.find(a => a.book && a.book.bookId === b.bookId) : null;
  const type = (b && b.accountType) || (acct && acct.accountType) || (b && b.type);
  const pills = '<span class="pill">' + esc(kind) + '</span>' +
    (type ? ' <span class="pill">' + esc(type) + '</span>' : '') +
    (autopilotOff ? ' <span class="pill">autopilot off</span>' : ' <span class="pill ok">autopilot on</span>');
  // Buy is ALWAYS available — a manual order is the operator's own action (2026-09-04 fix).
  const buy = '<button class="btn buy" data-act="buy" title="Place a direct order on ' + esc(DISP) + '">Buy a stock</button>';
  const toggle = (MODE === 'live' && b && b.bookId)
    ? ' <button class="btn ghost" data-act="toggle">' + (autopilotOff ? 'Start trading…' : 'Stop trading') + '</button>'
    : '';
  const research = ' <button class="btn ghost" id="acctResearchBtn" data-act="research" title="Quote, chart, fundamentals, news and filings for one stock">Research a stock</button>';
  return '<div class="panel acct-head" id="acctHead"><h2>' + esc(DISP) + '</h2>' + pills + settlementControlHtml(b) +
    '<span class="spacer"></span>' + research + buy + toggle +
    '<div id="stratLine" class="sub" style="flex-basis:100%">Loading strategy…</div></div>';
}
/* CASH accounts only (ADR-134 D8): how a buy funded by UNSETTLED sale proceeds is treated on this account —
   the fleet default (TRADING_CASH_SETTLEMENT_POLICY), refuse, or warn. 'off' is env-only, so it is not offered. */
function settlementControlHtml(b) {
  if (!b || !b.bookId || String(b.accountType || '').toLowerCase() !== 'cash') return '';
  const cur = b.settlementPolicy || '';
  const opt = (v, l) => '<option value="' + v + '"' + (cur === v ? ' selected' : '') + '>' + l + '</option>';
  return ' <label class="foot" style="margin:0 0 0 6px;display:inline-flex;align-items:center;gap:4px" title="A cash account settles sales T+n; buying with unsettled proceeds risks a good-faith violation">Unsettled buys' +
    '<select id="acctSettle" style="width:auto;display:inline-block;padding:2px 6px;font-size:12px">' + opt('', 'server default') + opt('refuse', 'refuse') + opt('warn', 'warn only') + '</select></label>';
}
/**
 * @description Wire every action in the account header through ONE delegated listener on #acctHead.
 * Strict CSP ('script-src self') allows no handler attribute, so each button carries only a data-act
 * and acctHeaderAction resolves the book and its trading state from BOOK at click time - a header
 * painted before a state change can never send a stale enable flag to toggleBook(). #stratLine sits
 * INSIDE #acctHead, so the strategy controls renderStrategyLine() paints later need no re-wiring. The
 * <select> children (settlement policy, strategy picker) carry no data-act, so closest() ignores them.
 * @returns {void}
 */
function wireAccountHeader() {
  const head = $('acctHead');
  if (head) head.onclick = (e) => {
    const el = e.target.closest('[data-act]');
    if (!el || !head.contains(el)) return;
    e.preventDefault();
    acctHeaderAction(el.getAttribute('data-act'));
  };
  const ss = $('acctSettle'); if (ss) ss.onchange = () => setSettlementPolicy(ss.value || null);
}
/**
 * @description Run one header action. The book id is resolved from BOOK through bookOf() at CLICK
 * time (never baked into the markup), so a repaint or an account switch can never fire an action
 * against the account that was showing when the button was painted.
 * @param {string} act - The data-act value: research | buy | toggle | lab | set | reset.
 * @returns {void}
 */
function acctHeaderAction(act) {
  if (act === 'research') { navigate('research', { sub: 'stock' }); return; }
  if (act === 'buy') { openTicket(); return; }
  if (act === 'toggle') { acctToggleTrading(); return; }
  if (act === 'lab') { navigate('strategies', { sub: 'lab' }); return; }
  const b = bookOf(BOOK);
  if (!b || !b.bookId) return;
  if (act === 'set') setBookStrategy(b.bookId);
  else if (act === 'reset') resetBookStrategy(b.bookId);
}
/* PATCH /accounts/books/:id { settlementPolicy } then reload BOOKS so the header reflects the server's answer. */
async function setSettlementPolicy(policy) {
  const b = bookOf(BOOK); if (!b || !b.bookId) return;
  const token = RENDER_TOKEN;
  try { await api('/accounts/books/' + encodeURIComponent(b.bookId), jbody('PATCH', { settlementPolicy: policy })); }
  catch (e) { if (!stale(token)) alert('Could not change the settlement policy: ' + (e.message || 'unknown error')); return; }
  try { await loadBooks(); } catch { /* the header re-render below shows what the server has */ }
  if (!stale(token)) navigate('account', { book: BOOK, kind: MODE, sub: SUB });
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
  const labLink = ' <a href="#" data-act="lab">Strategy Lab →</a>';
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
  // Set/Reset/Lab are data-act only: the delegated #acctHead listener resolves the book id when clicked.
  const control = (bid && !failed)
    ? ' &nbsp; <select id="stratPick-' + bid + '" style="width:auto;display:inline-block;padding:4px 8px;min-width:170px"><option value="">' + (active ? 'switch strategy…' : 'Production baseline (current)') + '</option></select> ' +
      '<button class="btn sm" data-act="set">Set</button>' +
      (active ? ' <button class="btn sm ghost" data-act="reset">Reset to baseline</button>' : '')
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
    '<div class="foot" style="margin-top:8px">A timed order is placed by the trading leg at its minute (7:00 AM–7:59 PM ET on trading days; outside 9:30–4:00 only an extended-hours limit day order). Once fired it is an ordinary order in the Trade journal. A window missed by more than the grace expires unfired.</div></div>';
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

/* ── allocation + exits cards (ADR-136, GET /exposure) ─────────────────────────────────────── */
/* ONE read fills both cards. Every number here is the server's; the only thing this file decides is
   wording. Nothing auto-refreshes — /exposure costs a broker account+positions+orders read. */
async function renderExposureCards(token) {
  const mixEl = $('mixCard'), exitEl = $('exitsCard');
  if (!mixEl || !exitEl) return;
  let x;
  try { x = await api('/exposure'); }
  catch (e) {
    if (stale(token)) return;
    const msg = '<div class="err" style="font-size:13px">Unavailable: ' + esc(e.message) + '</div>';
    mixEl.innerHTML = '<div class="panel"><h2>Allocation</h2>' + msg + '</div>';
    exitEl.innerHTML = '<div class="panel"><h2>Exits</h2>' + msg + '</div>';
    return;
  }
  if (stale(token) || !$('mixCard')) return;
  mixEl.innerHTML = mixCardHtml(x);
  exitEl.innerHTML = exitsCardHtml(x);
}
/* Plain percentage — app.js pct() prefixes a sign, which reads as a change rather than a share. */
function pctFlat(n) { return Number(n || 0).toFixed(2) + '%'; }

/* Every degradable side read of /exposure, in the words an operator needs: what could not be read AND
   what that costs the numbers below. The route marks a failed read 'unavailable' rather than inventing
   a value; painting that fallback silently would turn its honesty back into a lie. */
const EXPOSURE_SECTION_WORDS = {
  pinnedLots: 'the protected-lot pins could not be read, so protected shares are NOT excluded from these figures — the autopilot itself skips a fire when this read fails',
  protectedLots: 'the protected-lot records could not be read, so a venue order belonging to a protected lot can read "unattributed" below',
  peaks: 'the stored trailing peaks could not be read, so every trailing stop below is anchored at average cost rather than the position\'s real high',
  strategy: 'the strategy override could not be read, so the posture and caps shown are the environment default — an override actually in force would NOT be reflected',
  workingOrders: 'the broker\'s working orders could not be read',
  assetKinds: 'the asset directory could not be read, so held shares read "kind unknown"'
};
/* Sections that belong to ONE card only. Anything else — including a section the payload gains later —
   is surfaced by both cards rather than dropped by both. */
const EXPOSURE_EXITS_ONLY = ['workingOrders', 'protectedLots', 'peaks'];
const EXPOSURE_MIX_ONLY = ['assetKinds'];
function exposureSectionDown(x, name) {
  const secs = (x && x.sections) || {};
  return !!secs[name] && secs[name] !== 'ok';
}
function exposureDownFor(x, card) {
  const secs = (x && x.sections) || {};
  const skip = card === 'mix' ? EXPOSURE_EXITS_ONLY : EXPOSURE_MIX_ONLY;
  return Object.keys(secs).filter(n => secs[n] !== 'ok' && skip.indexOf(n) < 0);
}
/* The red line at the top of a card: what the server could not read, said before any number is read. */
function exposureDegradedHtml(down) {
  if (!down.length) return '';
  return '<div class="err" style="font-size:13px;margin:0 0 8px">Degraded — ' +
    down.map(n => esc(EXPOSURE_SECTION_WORDS[n] || (n + ' could not be read'))).join('; ') + '.</div>';
}

/* Asset kind + sector mix. Both taxonomies name their source in the foot; a sector row is measured
   against the SAME cap the engine sizes with, so headroom here is the room a buy actually has. */
function mixCardHtml(x) {
  const mix = x.mix || {}, sectors = mix.bySector || [], kinds = mix.byKind || [];
  const head = '<div class="panel"><div class="panel head2" style="padding:0;margin:0 0 8px;background:none;border:0;box-shadow:none">' +
    '<h2 style="margin:0">Allocation</h2><span class="foot" style="margin-left:auto">' + esc(x.policy ? x.policy.posture : '') +
    ' · sector cap ' + (x.policy ? x.policy.maxSectorPct : '—') + '%</span></div>' +
    exposureDegradedHtml(exposureDownFor(x, 'mix'));
  if (!sectors.length) return head + '<div class="foot" style="margin:0">No positions in this account.</div></div>';
  const kindLine = '<div style="margin:0 0 10px">' + kinds.map(k =>
    '<span class="pill">' + esc(mixKindLabel(k.kind)) + ' ' + pctFlat(k.pctOfEquity) + '</span> ').join('') + '</div>';
  return head + kindLine +
    '<div style="overflow-x:auto"><table><thead><tr><th>Sector</th><th class="num">Value</th><th class="num">% of equity</th>' +
    '<th class="num">Cap</th><th class="num">Headroom</th><th>Names</th></tr></thead><tbody>' +
    sectors.map(mixSectorRowHtml).join('') + '</tbody></table></div>' + mixFootHtml(x);
}
/* 'unknown' is a real answer here (the directory was unreadable), so it is said, not hidden. */
function mixKindLabel(kind) {
  return kind === 'etf' ? 'ETFs' : kind === 'stock' ? 'Stocks' : kind === 'cash' ? 'Cash' : 'Kind unknown';
}
/* One sector: value, share of equity, its cap and the room left under it, plus a tilt pill when the
   operator has leaned this sector. 'pinned N' marks shares the autopilot cannot touch. */
function mixSectorRowHtml(sc) {
  const tilt = Number(sc.tilt || 1);
  const names = (sc.symbols || []).map(sy =>
    esc(sy.symbol) + (sy.pinnedQty ? ' <span class="foot" style="margin:0">(pinned ' + esc(sy.pinnedQty) + ')</span>' : '')).join(', ');
  return '<tr><td><strong>' + esc(sc.sector) + '</strong>' +
    (tilt !== 1 ? ' <span class="pill">tilt ×' + esc(tilt) + '</span>' : '') + '</td>' +
    '<td class="num">' + money(sc.value) + '</td>' +
    '<td class="num">' + pctFlat(sc.pctOfEquity) + '</td>' +
    '<td class="num">' + esc(sc.capPct) + '%</td>' +
    '<td class="num ' + (Number(sc.headroom) <= 0 ? 'err' : '') + '">' + money(sc.headroom) + '</td>' +
    '<td style="font-size:12.5px">' + names + '</td></tr>';
}
/* Where every column came from, in words — including the honest 'other' case and, when the live book
   is capped, the fact that headroom is measured against the CAPPED equity the engine sizes from. */
function mixFootHtml(x) {
  const b = x.basis || {}, src = x.sources || {}, eng = x.engine || {}, unc = (x.mix && x.mix.unclassified) || [];
  const capNote = b.capped
    ? ' Caps are measured against the ' + money(b.capEquity) + ' this book is sized to, not its full ' + money(b.equity) + ' equity.'
    : '';
  const kindNote = (x.sections && x.sections.assetKinds === 'unavailable')
    ? ' Stock-vs-ETF is unavailable (' + esc(src.assetKind || '') + '), so those shares read "kind unknown" rather than a guess.'
    : ' Stock vs ETF: ' + esc(src.assetKind || '') + '.';
  const uncNote = unc.length
    ? ' <span class="err">' + unc.length + ' held name(s) sit outside that map (' + esc(unc.join(', ')) +
      ') — they are grouped under "other" with no cap headroom, never assigned a sector.</span>'
    : '';
  return '<div class="foot" style="margin-top:8px">Sectors are ' + esc(src.sector || '') + '.' + capNote + kindNote + uncNote +
    ' The engine classifies ' + esc(eng.universeClassified) + ' of its ' + esc(eng.universeCount) + ' universe names.</div></div>';
}

/* Exits: the venue's own working orders FIRST (what is really resting at the broker), the autopilot's
   rules SECOND and plainly labelled as rules. The two must never be read as one list. */
function exitsCardHtml(x) {
  const head = '<div class="panel"><div class="panel head2" style="padding:0;margin:0 0 8px;background:none;border:0;box-shadow:none">' +
    '<h2 style="margin:0">Exits</h2><span class="foot" style="margin-left:auto">' + esc(exitsStateWords(x)) + '</span></div>';
  return head + exposureDegradedHtml(exposureDownFor(x, 'exits')) + exitsWorkingHtml(x) + exitsRulesHtml(x) + '</div>';
}
/* One line saying whether the autopilot's exit rules are in force RIGHT NOW, and why not when they
   are not — a blind clock, a halt and an off-hours session are three different answers. */
function exitsStateWords(x) {
  const e = x.engine || {};
  // The withheld case outranks the session: a pill saying the rules are in force above a block saying
  // they cannot be shown is the contradiction this card exists to avoid.
  if (exposureSectionDown(x, 'pinnedLots')) return 'protected-lot ledger unreadable — the exit rules are withheld';
  if (e.blind) return 'venue clock unreachable — the engine is standing down';
  if (e.reason === 'halt') return 'TRADING_HALT is on — no autopilot exit runs';
  if (e.rulesRunNow) return 'regular session — the rules below are in force';
  if (e.session === 'pre' || e.session === 'post') return 'off-hours — only the ' + esc(e.offHoursDipPct) + '% dip rule runs';
  return 'market closed — the rules below are not running';
}
/* Section 1 — the venue's answer. null means the order read failed: say so in red, never render an
   empty table that would read as "nothing is protecting this account". */
function exitsWorkingHtml(x) {
  const rows = x.exits ? x.exits.working : null;
  const head = '<h3 style="margin:6px 0 6px;font-size:14px">Working at the venue</h3>';
  if (rows == null) return head + '<div class="err" style="font-size:13px">Could not read the broker\'s working orders — this list is unknown, not empty.</div>';
  if (!rows.length) return head + '<div class="foot" style="margin:0">Nothing is resting at the broker for this account.</div>';
  return head + '<div style="overflow-x:auto"><table><thead><tr><th>Symbol</th><th>Order</th><th class="num">Price</th>' +
    '<th>Status</th><th>Placed</th><th>Origin</th></tr></thead><tbody>' + rows.map(workingRowHtml).join('') + '</tbody></table></div>' +
    '<div class="foot" style="margin-top:6px">Read from the broker\'s own order record — these orders are actually resting at the venue. ' +
    'Origin is only claimed where the order itself proves it; anything else reads "unattributed".</div>';
}
/* One venue order. Price is whichever leg the order type actually carries. */
function workingRowHtml(o) {
  const px = o.limitPrice != null ? money(o.limitPrice)
    : o.stopPrice != null ? money(o.stopPrice)
    : o.trailPercent != null ? esc(o.trailPercent) + '%' : '—';
  const filled = Number(o.filledQty) > 0 ? ' <span class="foot" style="margin:0">(' + esc(o.filledQty) + ' filled)</span>' : '';
  return '<tr><td><strong>' + esc(o.symbol) + '</strong></td>' +
    '<td>' + esc(String(o.side || '').toUpperCase()) + ' ' + esc(o.qty) + ' · ' + esc(String(o.type || '').replace(/_/g, ' ')) + filled + '</td>' +
    '<td class="num">' + px + '</td>' +
    '<td><span class="pill ' + esc(o.status) + '">' + esc(o.status) + '</span></td>' +
    '<td class="foot" style="margin:0">' + esc(o.submittedAt ? fmtDate(o.submittedAt) : '—') + '</td>' +
    '<td>' + esc(o.origin === 'protected-lot' ? 'Protected lot' : 'unattributed') + '</td></tr>';
}
/* Section 2 — the engine's RULES. The foot is the whole point of the section: these prices are not
   orders sitting at the broker, and a row can be exempt (core hold) or not in force (off-hours). */
function exitsRulesHtml(x) {
  const rows = (x.exits && x.exits.rules) || [], p = x.policy || {};
  const head = '<h3 style="margin:14px 0 6px;font-size:14px">Autopilot exit rules · ' + esc(p.posture || '') +
    ' <span class="foot" style="margin:0">(' + esc(p.source || '') + ')</span></h3>';
  // The pins decide WHICH shares the autopilot may act on. Without them these prices would be drawn over
  // shares it is forbidden to sell, under a foot claiming they were excluded — the engine's own answer to
  // this read failing is to skip the fire, so the card's answer is to show no rules.
  if (exposureSectionDown(x, 'pinnedLots')) {
    return head + '<div class="err" style="font-size:13px">The protected-lot ledger could not be read, so the ' +
      'autopilot\'s exit rules are not shown here, and the server withheld them too (<code>exits.rules</code> ' +
      'comes back null rather than a list): every price would be computed over shares it may not be allowed to ' +
      'sell. The engine behaves the same way — it skips the fire rather than act on a book it cannot verify.</div>';
  }
  if (!rows.length) return head + '<div class="foot" style="margin:0">No positions the autopilot manages in this account.</div>';
  return head + '<div style="overflow-x:auto"><table><thead><tr><th>Symbol</th><th class="num">Shares</th><th class="num">Avg</th>' +
    '<th class="num">Last</th><th class="num">Stop</th><th class="num">Take-profit</th><th>Trailing</th><th>Now</th></tr></thead><tbody>' +
    rows.map(exitRuleRowHtml).join('') + '</tbody></table></div>' +
    '<div class="foot" style="margin-top:6px">These are the exit RULES the engine evaluates on each fire — stop ' + esc(p.stopLossPct) +
    '%, take-profit ' + esc(p.takeProfitPct) + '%, trail arms at +' + esc(p.trailArmPct) + '% and gives back ' + esc(p.trailGivebackPct) +
    '%. They are NOT orders resting at the venue: nothing here is protecting the position while the engine is not running. ' +
    'Outside the regular session the engine runs only the close-anchored dip rule, so the whole block is marked not in force. ' +
    'Protected-lot shares are excluded (their own exits are real venue orders, listed above). ' +
    'A row badged <em>not managed</em> or <em>ring-fenced</em> is one the engine emits no exit for at all — the row says which, ' +
    'and no stop price is shown for it, because no stop would fire.' +
    (exposureSectionDown(x, 'peaks')
      ? ' <span class="err">The stored trailing peaks could not be read, so every trailing stop above is anchored ' +
        'at average cost rather than the position\'s real high.</span>'
      : '') + '</div>';
}
/* One rule row. A core hold and an out-of-session row are greyed and say WHY rather than showing a
   stop the engine would never fire. 'would fire now' is the engine's own reason for this position. */
function exitRuleRowHtml(r) {
  // ADR-159 — the engine's own reason comes FIRST when it has one. A holding it cannot account for
  // gets no exit at all, and printing a stop price for a stop that will never fire is exactly the
  // silence this mark exists to break. `governance` absent, or exitsApply null, means nobody could
  // look: the rules stay shown and the doubt is said out loud rather than resolved either way.
  var reasons = (r.governance && r.governance.reasons) || [];
  var withheld = reasons.filter(function (x) { return x.kind !== 'accountability-unknown'; });
  var blind = !r.governance || r.governance.exitsApply === null;
  // The sentence is the SERVER's whenever the server has one - this file must not keep a second
  // copy of wording that belongs to the engine. The short local line covers only the case where the
  // payload carries no posture at all, which is a server that predates it.
  var blindNote = (reasons.filter(function (x) { return x.kind === 'accountability-unknown'; })[0] || {}).detail
    || 'Whether the engine manages this position could not be read, so this row is not claiming that it does.';
  if (!r.ruleActive) {
    var why = withheld.length ? withheld.map(function (x) { return x.label + ' — ' + x.detail; }).join(' ')
      : (r.coreHold ? 'core hold — exempt from every autopilot exit' : 'rules not in force right now');
    return '<tr style="opacity:.6"><td><strong>' + esc(r.symbol) + '</strong>' + withheld.map(function (x) {
      return ' <span class="pill ' + (x.kind === 'unaccounted' ? 'unmanaged' : 'fenced') + '">' + esc(x.label) + '</span>'; }).join('') + '</td>' +
      '<td class="num">' + esc(r.qty) + '</td>' +
      '<td class="num">' + money(r.avgEntryPrice) + '</td><td class="num">' + (r.currentPrice != null ? money(r.currentPrice) : '—') + '</td>' +
      '<td colspan="4" class="foot" style="margin:0">' + esc(why) + '</td></tr>';
  }
  const trail = r.trailArmed ? ('armed · ' + money(r.trailStopPx)) : 'not armed';
  const now = r.wouldFireNow
    ? '<span class="pill sell">' + esc(String(r.wouldFireNow).replace(/_/g, ' ')) + '</span>'
    : (r.trimQty ? '<span class="pill">trim ' + esc(r.trimQty) + '</span>' : '<span class="foot" style="margin:0">—</span>');
  // Blind, not withheld: these rules ARE what the engine evaluates, and this row is the surface
  // running them. What could not be checked is whether the engine will act on the result at all, so
  // the row keeps its prices and carries the doubt as a pill rather than pretending either answer.
  const doubt = blind ? ' <span class="pill unknown" title="' + esc(blindNote) + '">not known</span>' : '';
  return '<tr><td><strong>' + esc(r.symbol) + '</strong>' + doubt + '</td><td class="num">' + esc(r.qty) + '</td>' +
    '<td class="num">' + money(r.avgEntryPrice) + '</td>' +
    '<td class="num">' + (r.currentPrice != null ? money(r.currentPrice) : '—') + '</td>' +
    '<td class="num">' + money(r.stopPx) + '</td>' +
    '<td class="num">' + money(r.takeProfitPx) + '</td>' +
    '<td>' + trail + '</td><td>' + now + '</td></tr>';
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
