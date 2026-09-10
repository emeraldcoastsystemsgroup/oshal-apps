/* trading/ui/view-accounts.js — VIEW 'accounts': the LANDING page of the Trading surface (ADR-136 D1).
 *
 * Every account is a tile (one per book, plus one per discovered-but-unbooked Schwab account), a hero
 * total across all of them, the cross-account positions rollup, and the discovered-accounts roster
 * with the Discover button. Click a tile → the 'account' view for that book. Trading control
 * (Start/Stop) calls toggleBook() and book creation calls makeBook() — both defined in
 * view-strategies.js, called here as globals (never defined here).
 *
 * Classic script (no import/export): app.js loads first and provides BOOK/MODE/BOOKS/ACCOUNTS,
 * api(), jbody(), esc/money/pct/dollarPctCell/spinner/fmtDate, bookLabel/bookOf, loadBooks(),
 * navigate()/openAccount(), stale(). The Watchlist panel (ADR-138) is the shared one from
 * view-research.js — loadWatchlistPanel(hostId, false), whose rows navigate through researchSymbol();
 * called here as a global, never defined here. Numbers are never invented: '…' while loading, 'n/a' for a null
 * day change, the row's error in red when the broker read failed, and 'balances unavailable' (never
 * zeros) when GET /summary itself fails. The hero total is labelled for what it covers: the server
 * drops every account whose read failed from totalValue, so when any row errored the hero says
 * 'Total of the N accounts that answered' and names what is not included.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — ADR-136 D1 landing view: hero total, one tile per book (+ notTrading discovered accounts), positions rollup, discovered-accounts roster + Discover action. Replaces the legacy "All accounts" summary tab and the discovered-accounts half of the old Accounts tab.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Adversarial-review fixes: 'Create book…' (tile) and 'create one →' (roster row) call makeBook(accountId, label) directly instead of navigating to a roster that has no create control; hero labels a partial total honestly ('Total of the N accounts that answered' + red 'Not included: …' line) whenever a summary row errored or a tile ended unavailable; a failed GET /accounts still paints the Paper tile beside the error panel; the re-connect copy points at the cockpit's Settings → Connections; matchSummaryRow never lets a notTrading row attach to a booked tile.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | ADR-136 D6 event playbooks: ONE GET /events/plans after the tiles paint (allPlans, not a call per tile) marks every tile whose book has an active IPO plan with an 'IPO plan armed' pill under the strategy line; errors (older server) leave the tiles untouched.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | ADR-138 watchlist: a compact Watchlist panel below the tiles (symbols + quotes, Research → researchSymbol, ✕ remove, add box) painted through the shared loadWatchlistPanel() from view-research.js; independent of GET /accounts so it still fills when the accounts service is down.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | Strict-CSP cleanup (ADR-136 D2 tail): the Discover button no longer carries a handler attribute - wireDiscovered() binds it by id right after the skeleton paints, alongside the delegated #discovered listener it already owned.
 */

/* The tile models of the CURRENT paint, in display order — the delegated click handler resolves a
   tile's data-i index against this array (no book refs or ids ever pass through onclick strings). */
let ACCT_TILES = [];
/* Book refs with an ACTIVE event playbook (armed … exits placed) — filled by markEventPlanTiles() from
   one GET /events/plans; tileHtml() reads it so every repaint keeps the pill. */
let ACCT_EVENT_REFS = new Set();

/**
 * @description The static skeleton of the landing page: hero, tiles host, rollup panel, roster panel.
 * Every dynamic region is an id'd host the async steps fill in place.
 * @returns {string} HTML for #main.
 */
function accountsSkeleton() {
  return '<div class="panel"><div class="hero-total"><span class="n" id="heroTotal">…</span><span class="sub" id="heroSub">Total value · all accounts</span> <span id="heroDay" class="sub"></span></div>' +
      '<div class="err" id="heroMissing" style="font-size:12px;margin-top:6px" hidden></div></div>' +
    '<div class="tiles" id="tiles"><div style="grid-column:1/-1">' + spinner('Loading accounts…') + '</div></div>' +
    '<div class="panel" id="wlHost">' + spinner('Loading watchlist…') + '</div>' +
    '<div class="panel"><h2>Positions across all accounts</h2><div id="rollup">' + spinner('Reading every account…') + '</div></div>' +
    '<div class="panel">' +
      '<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px"><h2 style="margin:0">Connected Schwab accounts</h2>' +
        '<button class="btn ghost sm" style="margin-left:auto" id="discoverBtn">Discover accounts</button></div>' +
      '<div class="foot" style="margin:0 0 10px">Log into Schwab once from the cockpit (Settings → Connections) and every account under that login pulls in here. Re-run discovery after connecting a new login — and check <strong>all accounts</strong> on Schwab’s consent screen.</div>' +
      '<div id="discovered">' + spinner('Loading accounts…') + '</div>' +
    '</div>';
}

/**
 * @description Build one tile model per book in BOOKS. Labels, strategy and trading state come from
 * the roster; balances start in the 'loading' state until GET /summary answers.
 * @returns {Array<object>} Tile models (state: 'loading' | 'ok' | 'error' | 'unavailable').
 */
function tileModelsFromBooks() {
  return BOOKS.map((b, i) => {
    const acct = ACCOUNTS.find((a) => a.book && a.book.bookId === b.bookId) || null;
    return {
      ref: b.ref, kind: b.kind, bookId: b.bookId, enabled: b.enabled !== false, notTrading: false, order: i,
      label: b.ref === 'paper' ? 'Paper (reference book)' : bookLabel(b.ref),
      strategy: b.strategy || null,
      accountType: (acct && acct.accountType) || null,
      accountMasked: b.accountMasked || (acct && acct.accountMasked) || null,
      state: 'loading', note: '', equity: null, cash: null, dayChange: null, dayChangePct: null,
    };
  });
}

/**
 * @description Find the /summary row for a tile. A BOOKED tile matches a booked row on bookId, then
 * ref, then accountMasked — never a notTrading row. A notTrading tile matches a notTrading row on
 * accountMasked ONLY. The final check asserts the two sides agree on notTrading, so a discovered
 * account's read-only row can never stand in for a book's balances. Each row is consumed at most once.
 * @param {Array<object>} rows - summary.accounts.
 * @param {Array<boolean>} used - Per-index consumed flags (mutated).
 * @param {object} m - Tile model.
 * @returns {object|null} The matched row, or null.
 */
function matchSummaryRow(rows, used, m) {
  const booked = (r, k) => !used[k] && !r.notTrading;
  let i = -1;
  if (!m.notTrading) {
    i = rows.findIndex((r, k) => booked(r, k) && m.bookId && r.bookId != null && String(r.bookId) === String(m.bookId));
    if (i < 0) i = rows.findIndex((r, k) => booked(r, k) && r.ref != null && r.ref === m.ref);
    if (i < 0 && m.accountMasked) i = rows.findIndex((r, k) => booked(r, k) && r.accountMasked != null && r.accountMasked === m.accountMasked);
  } else if (m.accountMasked) {
    i = rows.findIndex((r, k) => !used[k] && r.notTrading && r.accountMasked != null && r.accountMasked === m.accountMasked);
  }
  if (i < 0) return null;
  if (Boolean(rows[i].notTrading) !== Boolean(m.notTrading)) return null;
  used[i] = true;
  return rows[i];
}

/**
 * @description Copy one summary row's balances onto a tile model, or mark why there are none.
 * @param {object} m - Tile model (mutated).
 * @param {object|null} row - Matched summary row.
 * @returns {void}
 */
function applySummaryRow(m, row) {
  if (!row) { m.state = 'unavailable'; m.note = 'no balance data for this account'; return; }
  if (row.error) { m.state = 'error'; m.note = String(row.error); return; }
  m.state = 'ok';
  m.equity = row.equity != null ? Number(row.equity) : null;
  m.cash = row.cash != null ? Number(row.cash) : null;
  m.dayChange = row.dayChange != null ? Number(row.dayChange) : null;
  m.dayChangePct = row.dayChangePct != null ? Number(row.dayChangePct) : null;
  if (!m.accountType && row.accountType) m.accountType = row.accountType;
}

/**
 * @description Merge GET /summary into the tile models: fill each book's balances, then append one
 * tile per notTrading row (a discovered account with no book yet).
 * @param {Array<object>} models - Tile models from tileModelsFromBooks() (mutated).
 * @param {object} j - The /summary payload.
 * @returns {void}
 */
function mergeSummaryIntoTiles(models, j) {
  const rows = (j && j.accounts) || [];
  const used = [];
  models.forEach((m) => applySummaryRow(m, matchSummaryRow(rows, used, m)));
  rows.forEach((r, k) => {
    if (used[k] || !r.notTrading) return;
    const acct = ACCOUNTS.find((a) => !a.book && a.accountMasked && a.accountMasked === r.accountMasked) || null;
    const m = {
      ref: null, kind: r.kind || 'live', bookId: null, enabled: false, notTrading: true, order: models.length + k,
      accountId: acct ? acct.accountId : null,
      label: r.label || (acct && acct.nickname) || ('Account ' + (r.accountMasked || '?')),
      strategy: null, accountType: r.accountType || (acct && acct.accountType) || null, accountMasked: r.accountMasked || null,
      state: 'loading', note: '', equity: null, cash: null, dayChange: null, dayChangePct: null,
    };
    applySummaryRow(m, r);
    models.push(m);
  });
}

/**
 * @description Display order: paper last; live tiles by equity descending once known; tiles without
 * a number after those with one; roster order breaks ties.
 * @param {Array<object>} models - Tile models.
 * @returns {Array<object>} A sorted copy.
 */
function sortTiles(models) {
  return models.slice().sort((a, b) => {
    const ap = a.ref === 'paper' ? 1 : 0, bp = b.ref === 'paper' ? 1 : 0;
    if (ap !== bp) return ap - bp;
    const ae = a.state === 'ok' && a.equity != null, be = b.state === 'ok' && b.equity != null;
    if (ae && be && a.equity !== b.equity) return b.equity - a.equity;
    if (ae !== be) return ae ? -1 : 1;
    return a.order - b.order;
  });
}

/**
 * @description The 'Strategy: …' line — the named strategy (+ apply % when partial) or the
 * production baseline every book runs until one is set.
 * @param {object|null} s - book.strategy.
 * @returns {string} HTML.
 */
function tileStrategyText(s) {
  if (!s || !s.name) return 'Strategy: <span class="ok">Production baseline</span>';
  const pctPart = s.applyPct != null && Number(s.applyPct) !== 100 ? ' @ ' + esc(s.applyPct) + '%' : '';
  return 'Strategy: ' + esc(s.name) + pctPart;
}

/**
 * @description Render one account tile. Buttons carry data-act; the tile carries data-i — the
 * delegated handler in wireTiles() does the routing, so no ref or id is interpolated into JS.
 * @param {object} m - Tile model.
 * @param {number} i - Index into ACCT_TILES.
 * @returns {string} HTML.
 */
function tileHtml(m, i) {
  const loading = m.state === 'loading';
  const pill = m.notTrading ? '<span class="pill" style="margin:0" title="Discovered account — no trading book yet">NO BOOK</span>'
    : (m.enabled ? '<span class="pill ok" style="margin:0">TRADING</span>' : '<span class="pill foot" style="margin:0">VIEW-ONLY</span>');
  const num = (v) => loading ? '…' : (m.state === 'ok' && v != null ? money(v) : '—');
  const day = loading ? '…' : (m.state !== 'ok' ? '—' : (m.dayChange == null ? '<span class="foot">n/a</span>' : dollarPctCell(m.dayChange, m.dayChangePct)));
  const note = (m.state === 'error' || m.state === 'unavailable') ? '<div class="err" style="font-size:12px">' + esc(m.note) + '</div>' : '';
  const strat = m.notTrading
    ? '<span class="foot">No book yet — create one to trade this account (it starts disabled).</span>'
    : tileStrategyText(m.strategy) +
      (m.ref && ACCT_EVENT_REFS.has(m.ref) ? '<div style="margin-top:4px"><span class="pill warn" style="margin:0;border-color:var(--warn)" title="An event playbook (IPO plan) is armed on this account">IPO plan armed</span></div>' : '');
  const actions = m.notTrading
    ? '<button class="btn sm ghost" data-act="create">Create book…</button>'
    : '<button class="btn sm primary" data-act="open">Open account →</button>' +
      (m.kind === 'live' && m.bookId ? '<button class="btn sm ghost" data-act="toggle">' + (m.enabled ? 'Stop trading' : 'Start trading…') + '</button>' : '');
  return '<div class="tile' + (m.enabled ? '' : ' view-only') + '" data-i="' + i + '" role="button" tabindex="0">' +
    '<div class="t-name"><span>' + esc(m.label) + '</span>' + pill + '</div>' + note +
    '<div class="t-eq">' + num(m.equity) + '</div>' +
    '<div class="t-row"><span>Day P&amp;L</span><b>' + day + '</b></div>' +
    '<div class="t-row"><span>Cash</span><b>' + num(m.cash) + '</b></div>' +
    '<div class="t-row"><span>Type</span><b>' + esc(m.accountType || m.kind) + '</b></div>' +
    '<div class="t-strat">' + strat + '</div>' +
    '<div class="t-actions">' + actions + '</div>' +
  '</div>';
}

/**
 * @description Paint (or repaint) the tiles host from the models, in display order.
 * @param {Array<object>} models - Tile models.
 * @returns {void}
 */
function paintTiles(models) {
  const host = $('tiles'); if (!host) return;
  ACCT_TILES = sortTiles(models);
  host.innerHTML = ACCT_TILES.length
    ? ACCT_TILES.map(tileHtml).join('')
    : '<div class="panel" style="grid-column:1/-1;margin:0"><div class="foot" style="margin:0">No accounts yet — connect a Schwab login, then hit Discover accounts below.</div></div>';
}

/**
 * @description ONE call after the tiles paint (never a fetch per tile): GET /events/plans returns
 * allPlans for the user; every book with an active plan (eventPlanActive, view-strategies.js) goes
 * into ACCT_EVENT_REFS and the tiles repaint with the 'IPO plan armed' pill. Any error — an older
 * server without the route included — leaves the tiles exactly as they are.
 * @param {number} token - RENDER_TOKEN at dispatch time.
 * @returns {Promise<void>}
 */
async function markEventPlanTiles(token) {
  let j;
  try { j = await api('/events/plans'); } catch { return; }   // route missing / down: no badge, no noise
  if (stale(token)) return;
  const refs = new Set((j.allPlans || j.plans || []).filter((p) => eventPlanActive(p) && p.bookRef).map((p) => p.bookRef));
  if (!refs.size) return;
  ACCT_EVENT_REFS = refs;
  paintTiles(ACCT_TILES);
}

/**
 * @description The label a new book is offered under — account type + masked number ('CASH …8271'),
 * falling back to the caller's display name when neither is known. Shared by the tile and the roster
 * row so both create-book paths name the account the same way.
 * @param {string|null} accountType - e.g. 'CASH', 'MARGIN', 'IRA'.
 * @param {string|null} accountMasked - e.g. '…8271'.
 * @param {string|null} fallback - Display name to use when both are missing.
 * @returns {string} The label.
 */
function discoveredLabel(accountType, accountMasked, fallback) {
  const parts = [accountType, accountMasked].filter((x) => x != null && x !== '');
  return parts.length ? parts.join(' ') : (fallback || 'this account');
}

/**
 * @description Create a trading book for a discovered account by calling makeBook() from
 * view-strategies.js (prompts for a label, POSTs /accounts/books, reloads BOOKS, re-renders this
 * view). Fails loudly — never silently — when the account id is unknown or the module did not load.
 * @param {string|null} accountId - The discovered account's id (from ACCOUNTS).
 * @param {string} label - Human label offered as the book's default name.
 * @returns {void}
 */
function requestBook(accountId, label) {
  if (!accountId) { alert('This account is not in the discovered roster yet — run Discover accounts, then create its book.'); return; }
  if (typeof makeBook !== 'function') { alert('Book creation is unavailable — the Strategies module did not load.'); return; }
  makeBook(accountId, label);
}

/**
 * @description Route a click/keypress on a tile: inner buttons act on the tile's model; the tile
 * itself opens the account — or, for an unbooked account, starts book creation (the one thing an
 * unbooked account can do here).
 * @param {Element} tile - The .tile element.
 * @param {string} action - 'open' | 'toggle' | 'create'.
 * @returns {void}
 */
function tileAction(tile, action) {
  const m = ACCT_TILES[Number(tile.getAttribute('data-i'))]; if (!m) return;
  if (action === 'create' || m.notTrading) { requestBook(m.accountId, discoveredLabel(m.accountType, m.accountMasked, m.label)); return; }
  if (action === 'toggle') {
    if (typeof toggleBook === 'function') toggleBook(m.bookId, !m.enabled);
    else alert('Trading control is unavailable — the Strategies module did not load.');
    return;
  }
  openAccount(m.ref, m.kind);
}

/**
 * @description One delegated listener on #tiles (survives every repaint). Inner buttons stop the
 * tile's own click; Enter/Space on a focused tile opens it.
 * @returns {void}
 */
function wireTiles() {
  const host = $('tiles'); if (!host) return;
  host.addEventListener('click', (e) => {
    const tile = e.target.closest('.tile'); if (!tile || !host.contains(tile)) return;
    const btn = e.target.closest('[data-act]');
    if (btn) { e.stopPropagation(); e.preventDefault(); tileAction(tile, btn.getAttribute('data-act')); return; }
    tileAction(tile, 'open');
  });
  host.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (!e.target.classList || !e.target.classList.contains('tile')) return;
    e.preventDefault(); tileAction(e.target, 'open');
  });
}

/**
 * @description What the hero total actually covers. The server sums only the accounts whose read
 * succeeded, so an `error` row (or a tile that ended 'unavailable') means totalValue is a PARTIAL
 * figure: answered = rows without error; missing = labels of every tile that has no balances.
 * @param {object} j - The /summary payload.
 * @param {Array<object>} models - Tile models after mergeSummaryIntoTiles().
 * @returns {{partial: boolean, answered: number, missing: Array<string>}} Coverage.
 */
function heroCoverage(j, models) {
  const rows = (j && j.accounts) || [];
  const errored = rows.filter((r) => r.error).length;
  const answered = rows.length - errored;
  const missing = models.filter((m) => m.state === 'error' || m.state === 'unavailable').map((m) => m.label);
  if (errored && !missing.length) missing.push(errored + (errored === 1 ? ' account whose read failed' : ' accounts whose reads failed'));
  return { partial: errored > 0 || missing.length > 0, answered, missing };
}

/**
 * @description Fill the hero: the total, the day change (or 'n/a'), and an HONEST label — 'Total
 * value · all accounts' only when every account answered; otherwise 'Total of the N accounts that
 * answered' plus a red 'Not included: …' line naming the accounts the server left out.
 * @param {object|null} j - The /summary payload, or null when it failed.
 * @param {Error|null} err - The failure, when j is null.
 * @param {Array<object>} models - Tile models after the summary merge (coverage source).
 * @returns {void}
 */
function paintHero(j, err, models) {
  const t = $('heroTotal'), d = $('heroDay'), s = $('heroSub'), miss = $('heroMissing'); if (!t || !d) return;
  if (err || !j) {
    t.innerHTML = '<span class="err" style="font-size:16px">balances unavailable</span>';
    d.innerHTML = err ? '<span class="err">' + esc(err.message) + '</span>' : '';
    if (miss) { miss.hidden = true; miss.textContent = ''; }
    return;
  }
  const cov = heroCoverage(j, models || []);
  t.textContent = j.totalValue != null ? money(j.totalValue) : '—';
  d.innerHTML = j.totalDayChange == null ? 'day change n/a' : dollarPctCell(j.totalDayChange, null) + ' today';
  if (s) s.textContent = cov.partial ? 'Total of the ' + cov.answered + (cov.answered === 1 ? ' account' : ' accounts') + ' that answered' : 'Total value · all accounts';
  if (miss) { miss.hidden = !cov.partial; miss.textContent = cov.partial ? 'Not included: ' + cov.missing.join(', ') : ''; }
}

/**
 * @description The cross-account positions rollup (top 60 by market value), or the empty/error line.
 * @param {object|null} j - The /summary payload.
 * @param {Error|null} err - The failure, when j is null.
 * @returns {void}
 */
function paintRollup(j, err) {
  const host = $('rollup'); if (!host) return;
  if (err || !j) { host.innerHTML = '<div class="err">' + esc(err ? err.message : 'summary unavailable') + '</div>'; return; }
  const rows = (j.positionsRollup || []).slice(0, 60);
  if (!rows.length) { host.innerHTML = '<div class="foot" style="margin:0">No open positions across accounts.</div>'; return; }
  host.innerHTML = '<table><thead><tr><th>Symbol</th><th class="num">Qty</th><th class="num">Market value</th><th>Held in</th></tr></thead><tbody>' +
    rows.map((p) =>
      '<tr><td><strong>' + esc(p.symbol) + '</strong></td><td class="num">' + esc(p.qty) + '</td><td class="num">' + money(p.marketValue) + '</td>' +
      '<td class="foot">' + (p.perBook || []).map((x) => esc(bookLabel(x.ref)) + ' (' + esc(x.qty) + ')').join(' · ') + '</td></tr>').join('') +
    '</tbody></table>';
}

/**
 * @description One row of the discovered-accounts roster. The book column links into the account
 * view when a book exists (kind resolved through bookOf — the roster's book stub carries none);
 * otherwise it offers 'create one →', which carries the row's ACCOUNTS index (data-i) so the
 * delegated handler resolves the accountId from the model — never from an onclick string.
 * @param {object} a - A discovered account from GET /accounts.
 * @param {number} i - Index into ACCOUNTS.
 * @returns {string} HTML.
 */
function discoveredRow(a, i) {
  const book = a.book || null;
  const seen = a.lastSeenAt || a.lastSeen;
  const bookCell = book
    ? '<a href="#" data-open-ref="' + esc(book.ref) + '">' + esc(bookLabel(book.ref)) + '</a>' + (book.enabled ? '' : ' <span class="foot">(disabled)</span>')
    : '<span class="foot">no book — <a href="#" data-act="create" data-i="' + i + '">create one →</a></span>';
  return '<tr><td><strong>' + esc(a.accountMasked || '?') + '</strong>' + (a.nickname ? ' <span class="foot">' + esc(a.nickname) + '</span>' : '') + '</td>' +
    '<td>' + esc(a.broker || '—') + (a.connectionMissing ? ' <span class="err" title="This Schwab login is no longer connected. Re-connect Schwab from the cockpit: Settings → Connections.">login missing — reconnect Schwab</span>' : '') + '</td>' +
    '<td>' + esc(a.accountType || '—') + '</td>' +
    '<td class="foot">' + (seen ? esc(fmtDate(seen)) : '—') + '</td>' +
    '<td>' + bookCell + '</td></tr>';
}

/**
 * @description Paint the discovered-accounts table from ACCOUNTS.
 * @returns {void}
 */
function paintDiscovered() {
  const host = $('discovered'); if (!host) return;
  const rows = ACCOUNTS.map(discoveredRow).join('');
  host.innerHTML = '<table><thead><tr><th>Account</th><th>Broker</th><th>Type</th><th>Last seen</th><th>Book</th></tr></thead><tbody>' +
    (rows || '<tr><td colspan="5" class="foot">No accounts discovered yet — hit “Discover accounts” (needs a connected Schwab login).</td></tr>') +
    '</tbody></table>';
}

/**
 * @description Binds the Discover button and one delegated listener on #discovered for the book links
 * and the create-book action. 'create one →' resolves its ACCOUNTS entry by data-i and calls makeBook()
 * through requestBook(). No action reaches the markup as a handler attribute (strict CSP).
 * @returns {void}
 */
function wireDiscovered() {
  // Strict CSP: the Discover button carries no handler attribute - it is bound here, right after the
  // skeleton paints (renderAccountsView calls this on every entry, so the binding is never missed).
  const db = $('discoverBtn'); if (db) db.onclick = discoverAccounts;
  const host = $('discovered'); if (!host) return;
  host.addEventListener('click', (e) => {
    const a = e.target.closest('a'); if (!a || !host.contains(a)) return;
    e.preventDefault();
    if (a.getAttribute('data-act') === 'create') {
      const acct = ACCOUNTS[Number(a.getAttribute('data-i'))]; if (!acct) return;
      requestBook(acct.accountId, discoveredLabel(acct.accountType, acct.accountMasked, acct.nickname));
      return;
    }
    const ref = a.getAttribute('data-open-ref'); if (!ref) return;
    const b = bookOf(ref);
    openAccount(ref, b ? b.kind : (ref === 'paper' ? 'paper' : 'live'));
  });
}

/**
 * @description Discover accounts: re-enumerate every connected Schwab login's accounts, report the
 * outcome, then re-render the landing page so the roster and tiles reflect it.
 * @returns {Promise<void>}
 */
async function discoverAccounts() {
  const btn = $('discoverBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Discovering…'; }
  try {
    const r = await api('/accounts/discover', jbody('POST', {}));
    const errs = (r && r.errors) || [];
    alert('Discovery: ' + (r.accounts != null ? r.accounts : '?') + ' account(s) across ' + (r.connections != null ? r.connections : '?') + ' login(s)' +
      (errs.length ? '\nErrors:\n' + errs.join('\n') : ''));
  } catch (e) {
    alert('Discovery failed: ' + e.message);
  }
  navigate('accounts', { sub: null });
}

/**
 * @description The one tile the landing page can still offer when GET /accounts fails: the paper
 * reference book, which needs no roster to open (openAccount('paper','paper')). Balances are marked
 * unavailable — never zeros. Trading state comes from the last roster boot loaded, if any.
 * @returns {object} A tile model.
 */
function paperFallbackTile() {
  const known = bookOf('paper');
  return {
    ref: 'paper', kind: 'paper', bookId: known ? known.bookId : null, enabled: known ? known.enabled !== false : true,
    notTrading: false, order: 0, accountId: null, label: 'Paper (reference book)', strategy: known ? known.strategy || null : null,
    accountType: 'paper', accountMasked: null, state: 'unavailable', note: 'balances unavailable — accounts service down',
    equity: null, cash: null, dayChange: null, dayChangePct: null,
  };
}

/**
 * @description Degraded paint when GET /accounts itself fails: an error panel explaining that the
 * accounts service is unavailable, the Paper tile so the page is still usable, and every other host
 * marked unavailable (no summary attempt — it lives behind the same service).
 * @param {Error} err - The loadBooks() failure.
 * @returns {void}
 */
function paintAccountsUnavailable(err) {
  const msg = err && err.message ? err.message : 'unknown error';
  main.insertAdjacentHTML('afterbegin', '<div class="panel err">The accounts service is unavailable (GET /accounts failed: ' + esc(msg) + '). ' +
    'Live accounts, books and balances cannot be listed right now; the Paper reference book is still open below. Use Refresh to retry.</div>');
  paintTiles([paperFallbackTile()]);
  paintHero(null, err, []);
  paintRollup(null, err);
  const host = $('discovered'); if (host) host.innerHTML = '<div class="err">Discovered accounts unavailable: ' + esc(msg) + '</div>';
}

/**
 * @description Fill the Watchlist panel (ADR-138) through the shared loader in view-research.js. Rows
 * there call researchSymbol(sym) (inline = false). Says so plainly when that module did not load —
 * never a spinner that spins forever.
 * @returns {void}
 */
function paintWatchlistHost() {
  const host = $('wlHost'); if (!host) return;
  if (typeof loadWatchlistPanel === 'function') { loadWatchlistPanel('wlHost', false); return; }
  host.innerHTML = '<h2>Watchlist</h2><div class="foot" style="margin:0">Watchlist unavailable — the Research module did not load.</div>';
}

/**
 * @description VIEW 'accounts' — the landing page. Paints the skeleton, refreshes the roster, shows
 * one tile per book immediately, then fills balances from GET /summary. Every async step checks
 * stale(token) before painting so a navigation away can never be overpainted. A failed roster load
 * degrades to paintAccountsUnavailable() instead of blanking the page. The watchlist is its own
 * route, so it is kicked off before the roster load and fills either way.
 * @param {number} token - RENDER_TOKEN at dispatch time.
 * @returns {Promise<void>}
 */
async function renderAccountsView(token) {
  main.innerHTML = accountsSkeleton();
  wireTiles(); wireDiscovered();
  paintWatchlistHost();
  try {
    await loadBooks();
  } catch (e) {
    if (!stale(token)) paintAccountsUnavailable(e);
    return;
  }
  if (stale(token)) return;
  ACCT_EVENT_REFS = new Set();
  const models = tileModelsFromBooks();
  paintTiles(models);
  paintDiscovered();
  markEventPlanTiles(token);             // async — one call; repaints the tiles with the IPO pill when any plan is active
  let summary = null;
  try {
    summary = await api('/summary');
  } catch (e) {
    if (stale(token)) return;
    models.forEach((m) => { m.state = 'unavailable'; m.note = 'balances unavailable'; });
    paintTiles(models); paintHero(null, e, models); paintRollup(null, e);
    return;
  }
  if (stale(token)) return;
  mergeSummaryIntoTiles(models, summary);
  paintTiles(models); paintHero(summary, null, models); paintRollup(summary, null);
}
