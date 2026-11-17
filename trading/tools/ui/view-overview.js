/* trading/ui/view-overview.js — the first screen of Intelligent Trades (VIEW 'accounts', the Overview tab).
 *
 * A portfolio overview in the shape of a brokerage's first screen: the total of the connected accounts with today's change,
 * the value over time with range buttons (1W, 1M, 3M, YTD, 1Y, All) and daily change bars under it, one card per account
 * (value, day change, a small trendline with its daily bars, its running or parked chip), each account's percent change on
 * one chart with the S&P 500 (SPY) and Treasury bills (BIL), and one sortable holdings table across accounts. One line says
 * whether it is trading and opens the Trading status tab, where the explanation cards (view-home.js) live unchanged.
 *
 * Reads: GET /paper/values (every recorded daily value) and GET /paper/today (labels, chips, the last check's holdings) are
 * saved records; the job list is the kernel's; the roster boot() already started gives current holdings; the benchmark is the
 * daily price series the charts already read (GET /api/trading-charts/bars). Nothing here can change an order, a strategy,
 * an approval, a schedule or a job: a card opens the existing account details page and every other control only redraws.
 * Values are never invented: a day with no record is a gap, a figure that is not known reads as a dash, and the bars are the
 * change in value (deposits and withdrawals included), never called a gain.
 *
 * Classic script: app.js provides main/$/api/esc/stale/navigate/render/openSettings, ACCOUNTS, BOOKS_READY and loadBooks;
 * view-home.js provides homeJobs/homeCardsOf/homeBareFact/homeOpenAddress; view-accounts.js provides rosterPanelHtml/
 * wireDiscovered/paintDiscovered; native-account-details.js provides nativeDetailsHref; portfolio-series.js, portfolio-charts.js
 * and account-story.js provide PortfolioSeries, PortfolioCharts and AccountStory. When the saved-record reads cannot be made,
 * renderOverviewView answers false and view-accounts.js draws the former landing with one line saying why.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.58.0, coordinator's added scope: the line under "Is it trading?" and each account card show when the account's approval ends, from GET /paper/today's saved approval. Within 14 days, or before the account's next trade, it says so plainly ("Approval ends Nov 30, before the Dec 1 trade.") with a link to Strategy settings and approval on that account's Manage strategy page, where an approval is renewed today. The link only navigates. A card is now an article whose name link covers it, so the approval link is not inside another link.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.58.0: Intelligent Trades opens on a portfolio overview (Roger, 2026-11-16: "for the landing page i should see my accounts my positions my trendlines over time per account with daily bars and comparisons"). The "Is it trading?" cards move to their own tab, Trading status, unchanged.
 */

/* What the last paint used: both reads, the job rows, the range, the benchmark answers, the table's sort and the roster's state. */
const OVERVIEW = { values: null, today: null, jobs: null, range: '1M', bench: {}, failed: null, sort: { key: 'value', dir: -1 }, rosterSeen: false,
  rosterSettled: false, rosterFailed: false, accountsAt: null, view: null, accounts: [], tips: {}, resizeWired: false, resizeTimer: null };
const OVERVIEW_RANGES = [['1W', '1W', 'one week'], ['1M', '1M', 'one month'], ['3M', '3M', 'three months'], ['YTD', 'YTD', 'this year'], ['1Y', '1Y', 'one year'], ['ALL', 'All', 'everything recorded']];
const OVERVIEW_BENCHMARKS = [{ symbol: 'SPY', label: 'S&P 500 (SPY)', css: 'pf-bench-a' }, { symbol: 'BIL', label: 'Treasury bills (BIL)', css: 'pf-bench-b' }];
const OVERVIEW_COLUMNS = [['symbol', 'Symbol', ''], ['account', 'Account', ''], ['qty', 'Shares', 'num'], ['value', 'Value', 'num'], ['weight', 'Weight', 'num'], ['day', 'Day change', 'num'], ['gain', 'Gain', 'num']];

const pfFinite = (v) => typeof v === 'number' && Number.isFinite(v);
const pfTone = (v) => (pfFinite(v) ? (v > 0 ? 'up' : v < 0 ? 'down' : 'flat') : 'flat');
const pfClock = (at) => { const d = new Date(at); return Number.isFinite(d.getTime()) ? d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'an unknown time'; };

/**
 * @description The Accounts screen's two tabs: the portfolio overview, and the trading status cards that say whether each
 *   account is running or parked.
 * @param {'overview'|'status'} active The tab shown.
 * @returns {string} HTML.
 */
function accountsTabsHtml(active) {
  const tab = (key, label) => '<button type="button" role="tab" data-accounts-tab="' + key + '" aria-selected="' + (key === active) + '"' + (key === active ? ' class="on"' : '') + '>' + label + '</button>';
  return '<div class="tabbar pf-tabs" role="tablist" aria-label="Accounts">' + tab('overview', 'Overview') + tab('status', 'Trading status') + '</div>';
}

/**
 * @description Wire the two tabs. Each opens its view through navigate(), so the address names the tab and Back works.
 * @returns {void}
 */
function wireAccountsTabs() {
  main.querySelectorAll('[data-accounts-tab]').forEach((button) => {
    button.onclick = () => {
      const status = button.getAttribute('data-accounts-tab') === 'status';
      if (status !== (SUB === 'status')) navigate('accounts', { sub: status ? 'status' : null });
    };
  });
}

/**
 * @description Whether both saved-record answers have the shape this screen reads.
 * @param {object} values GET /paper/values.
 * @param {object} today GET /paper/today.
 * @returns {boolean} true when both can be read.
 */
function overviewReadable(values, today) {
  return Boolean(values && values.ok === true && Array.isArray(values.accounts) && today && today.ok === true && Array.isArray(today.connected) && Array.isArray(today.paper));
}

/**
 * @description The skeleton: the tabs, the trading line, the total, the account cards, the comparison, the holdings, one
 *   tooltip and the hidden connected-login list that ⚙ Settings shows.
 * @returns {string} HTML for #main.
 */
function overviewSkeleton() {
  return accountsTabsHtml('overview') + '<div class="pf-root" id="pfRoot" data-ds-work>' +
    '<div id="pfStrip"></div><section class="panel pf-hero" id="pfHero" aria-label="All connected accounts"></section>' +
    '<section class="pf-section" aria-labelledby="pfCardsTitle"><h2 class="pf-h2" id="pfCardsTitle">Accounts</h2><div class="pf-cards" id="pfCards"></div><p class="foot" id="pfCardsFoot"></p></section>' +
    '<section class="panel pf-panel" id="pfCompare" aria-labelledby="pfCompareTitle"></section>' +
    '<section class="panel pf-panel" id="pfPositions" aria-labelledby="pfPositionsTitle"></section>' +
    '<div class="pf-tip" id="pfTip" role="tooltip" hidden></div></div>' + rosterPanelHtml();
}

/**
 * @description The options the account-story chips are computed with, from the last read and the job rows.
 * @returns {object} The clock, the session facts and the two job rows.
 */
function overviewStatusOptions() {
  const today = OVERVIEW.today, jobs = OVERVIEW.jobs || {};
  return { now: Date.now(), latestSession: today.latestCompletedSession, marketOpen: today.marketOpen, watcher: jobs.watcher || null, paperJob: jobs.paperJob || null,
    upcoming: OVERVIEW.values.upcoming || null };
}

/**
 * @description One account as the overview shows it: its label, colour slot, status chips, recorded series and current value.
 * @param {object} parts {key, accountId, connectionKey, slot, fact, roster, series}.
 * @param {object} options overviewStatusOptions().
 * @returns {object} The account.
 */
function overviewAccount(parts, options) {
  const identity = { accountId: parts.accountId, connectionKey: parts.connectionKey };
  const card = AccountStory.connected(parts.fact || homeBareFact({ ...identity, ...(parts.roster || {}) }, OVERVIEW.accountsAt), options);
  const latest = parts.series && parts.series.latest;
  const live = parts.roster && pfFinite(parts.roster.equity) ? { value: parts.roster.equity, at: OVERVIEW.accountsAt, source: 'broker' } : null;
  const approval = parts.fact && parts.fact.monitor ? PortfolioSeries.approvalNotice(parts.fact.monitor.approval, parts.fact.plan, options) : null;
  return { ...identity, key: parts.key, slot: parts.slot, chip: card.chip, parked: card.parked, series: parts.series || null, roster: parts.roster || null, approval,
    label: (parts.fact && parts.fact.label) || (parts.roster && parts.roster.accountMasked ? 'Account ' + parts.roster.accountMasked : 'Connected account'),
    current: latest ? { value: latest.value, at: latest.at, day: latest.day, source: 'recorded' } : live };
}

/**
 * @description Every connected account the person has: those with recorded values, those with a saved profile or monitor,
 *   and those the broker's roster lists. A colour slot follows the account, never its rank; past six accounts there is none.
 * @param {object} view PortfolioSeries.overview().
 * @returns {Array<object>} The accounts, largest current value first.
 */
function overviewAccounts(view) {
  const facts = new Map(OVERVIEW.today.connected.map((f) => [f.connectionKey + '|' + f.accountId, f]));
  const roster = new Map(ACCOUNTS.filter((a) => a.nativeReadOnly && a.accountId && a.connectionKey && !a.error).map((a) => [a.connectionKey + '|' + a.accountId, a]));
  const series = new Map(view.accounts.map((a) => [a.key, a]));
  const ids = new Map();
  for (const a of [...OVERVIEW.values.accounts, ...OVERVIEW.today.connected, ...roster.values()]) ids.set(a.connectionKey + '|' + a.accountId, { accountId: a.accountId, connectionKey: a.connectionKey });
  const options = overviewStatusOptions();
  const list = [...ids.entries()].map(([key, id], i) => overviewAccount({ ...id, key, slot: i < 6 ? i + 1 : 0, fact: facts.get(key), roster: roster.get(key), series: series.get(key) }, options));
  return list.sort((a, b) => ((b.current && b.current.value) || 0) - ((a.current && a.current.value) || 0) || a.label.localeCompare(b.label));
}

/**
 * @description Recompute the range's series and redraw every part of the screen.
 * @returns {void}
 */
function overviewPaint() {
  if (!$('pfRoot')) return;
  OVERVIEW.view = PortfolioSeries.overview(OVERVIEW.values, OVERVIEW.range);
  OVERVIEW.accounts = overviewAccounts(OVERVIEW.view);
  OVERVIEW.tips = {};
  paintOverviewStrip();
  paintOverviewHero();
  paintOverviewCards();
  paintOverviewCompare();
  paintOverviewPositions();
  drawOverviewCharts();
}

/**
 * @description The one line that says whether it is trading, from the same cards and headline as the Trading status tab, so
 *   the two can never disagree, and the button that opens that tab.
 * @returns {void}
 */
function paintOverviewStrip() {
  const { cards, options } = homeCardsOf(OVERVIEW.today, OVERVIEW.jobs, OVERVIEW.accountsAt);
  const top = AccountStory.headline(cards, options);
  const approvals = OVERVIEW.accounts.filter((a) => a.approval).sort((a, b) => Number(b.approval.warn) - Number(a.approval.warn) || a.approval.endDay.localeCompare(b.approval.endDay));
  $('pfStrip').innerHTML = '<section class="panel pf-strip" aria-label="Is it trading"><p><span>Is it trading?</span> <strong>' + esc(top.answer) + '</strong> ' + esc(top.sentence) + '</p>' +
    '<button type="button" class="btn" data-pf-go="status">See why</button>' +
    (approvals.length ? '<ul class="pf-approvals">' + approvals.map((a) => '<li class="' + (a.approval.warn ? 'is-warn' : '') + '" data-pf-approval-row="' + esc(a.key) + '"><strong>' + esc(a.label) + '</strong> ' +
      esc(a.approval.text) + (a.approval.warn ? ' ' + overviewApprovalLink(a) : '') + '</li>').join('') + '</ul>' : '') + '</section>';
}

/**
 * @description The link to the place an approval is renewed today: Strategy settings and approval, on the account's Manage
 *   strategy page. It only navigates; renewing stays the owner's own confirmed action there.
 * @param {object} a An overviewAccount().
 * @returns {string} HTML.
 */
function overviewApprovalLink(a) {
  return '<a class="pf-approval-link" href="' + esc(nativeAccountHref(a)) + '" data-pf-approval="' + esc(a.key) + '">Strategy settings and approval</a>';
}

/**
 * @description A signed change with its percent, toned by direction, or a dash.
 * @param {number|null} change Dollars.
 * @param {number|null} pct Percent.
 * @returns {string} HTML.
 */
function overviewDelta(change, pct) {
  if (!pfFinite(change)) return '<span class="pf-delta">—</span>';
  return '<span class="pf-delta is-' + pfTone(change) + '">' + esc(PortfolioCharts.signedMoney(change)) + (pfFinite(pct) ? ' (' + esc(PortfolioCharts.signedPercent(pct)) + ')' : '') + '</span>';
}

/**
 * @description The words for a day's change: Today when it is New York's date, otherwise the day.
 * @param {string|null} day The day of the change.
 * @returns {string} Words.
 */
function overviewDayWords(day) {
  return day && day === OVERVIEW.values.today ? 'Today' : 'On ' + PortfolioCharts.dayWords(day);
}

/**
 * @description The range buttons. They scope the total, the cards and the comparison below them.
 * @returns {string} HTML.
 */
function overviewRangesHtml() {
  return '<div class="pf-ranges" role="group" aria-label="Range">' + OVERVIEW_RANGES.map(([key, label, words]) => '<button type="button" data-pf-range="' + key + '" aria-pressed="' +
    (key === OVERVIEW.range) + '" title="' + esc(words) + '">' + label + '</button>').join('') + '</div>';
}

/**
 * @description The total's head: its value, today's change and the change over the range, each labelled for what it is.
 * @param {object} total The total in the range (PortfolioSeries described series).
 * @param {number} counted How many accounts the total adds up.
 * @returns {string} HTML.
 */
function overviewHeroHead(total, counted) {
  const latest = total.latest, at = OVERVIEW.view.accounts.map((a) => a.latest && a.latest.day === latest.day ? a.latest.at : null).filter(Boolean).sort().at(-1);
  const range = OVERVIEW_RANGES.find((r) => r[0] === OVERVIEW.range);
  return '<p class="pf-eyebrow">All connected accounts · ' + counted + (counted === 1 ? ' account' : ' accounts') + '</p>' +
    '<p class="pf-total" data-pf-total>' + esc(PortfolioCharts.money(latest.value)) + '</p>' +
    '<p class="pf-deltas"><span>' + overviewDelta(total.day && total.day.change, total.day && total.day.pct) + ' <span class="pf-when">' + esc(overviewDayWords(total.day && total.day.day)) + '</span></span>' +
    '<span>' + overviewDelta(total.span.change, total.span.pct) + ' <span class="pf-when">change in value, ' + esc(range[2]) + '</span></span></p>' +
    '<p class="foot pf-asof">Recorded ' + esc(at ? pfClock(at) : PortfolioCharts.dayWords(latest.day)) + '.</p>';
}

/**
 * @description The notes under the total's charts: where the history starts, an account that stops early, accounts with no
 *   recorded value, and what a daily bar counts.
 * @param {object} total The total in the range.
 * @returns {string} HTML.
 */
function overviewHeroNotes(total) {
  const notes = [], view = OVERVIEW.view, label = (key) => (OVERVIEW.accounts.find((a) => a.key === key) || { label: 'An account' }).label;
  if (total.coverage.short) notes.push('History starts ' + PortfolioCharts.dayWords(total.coverage.starts, true) + ', so this range begins there.');
  if (view.lagging.length) notes.push('The total stops at ' + PortfolioCharts.dayWords(total.latest.day) + ': ' + view.lagging.map(label).join(', ') + (view.lagging.length === 1 ? ' has' : ' have') + ' no value recorded after that.');
  const missing = OVERVIEW.accounts.filter((a) => !a.series).map((a) => a.label);
  if (missing.length) notes.push('Not included: ' + missing.join(', ') + ' (no recorded history yet).');
  notes.push('A daily bar is the change in value from the market day before, deposits and withdrawals included. A day with no record is left blank.');
  return notes.map((n) => '<p class="foot pf-note">' + esc(n) + '</p>').join('');
}

/**
 * @description The total's table twin: the recorded total and its change on each day of the range, newest first.
 * @param {object} total The total in the range.
 * @returns {string} HTML.
 */
function overviewHeroTable(total) {
  const changes = new Map(total.changes.map((c) => [c.day, c]));
  const rows = total.points.slice().reverse().map((p) => '<tr><td>' + esc(PortfolioCharts.dayWords(p.day, true)) + '</td><td class="num">' + esc(PortfolioCharts.money(p.value)) + '</td><td class="num">' + overviewDelta(changes.get(p.day) && changes.get(p.day).change, changes.get(p.day) && changes.get(p.day).pct) + '</td></tr>').join('');
  return '<details class="pf-twin"><summary>Recorded values</summary><div class="pf-table-scroll"><table class="pf-table"><thead><tr><th>Day</th><th class="num">Total</th><th class="num">Change</th></tr></thead><tbody>' + rows + '</tbody></table></div></details>';
}

/**
 * @description The total panel: the head, the range buttons, the value chart and its daily bars, their notes and table, or
 *   what is shown instead when there is no recorded history or no connected account.
 * @returns {void}
 */
function paintOverviewHero() {
  const host = $('pfHero'), total = OVERVIEW.view.total, counted = OVERVIEW.view.accounts.length;
  if (!OVERVIEW.accounts.length) { host.innerHTML = overviewEmptyHtml(); return; }
  if (!total.latest) { host.innerHTML = overviewNoHistoryHtml(); return; }
  const trend = total.points.filter((p) => pfFinite(p.value)).length >= 2;
  host.innerHTML = '<div class="pf-hero-top"><div class="pf-hero-head">' + overviewHeroHead(total, counted) + '</div>' + overviewRangesHtml() + '</div>' +
    (trend ? '<div class="pf-chart" id="pfValueChart"></div><p class="pf-sub">Daily change</p><div class="pf-chart" id="pfBarsChart"></div>'
      : '<div class="details-empty pf-collecting"><strong>History starts ' + esc(PortfolioCharts.dayWords(total.latest.day, true)) + '</strong><p>A trend needs a second recorded market day in this range.</p></div>') +
    overviewHeroNotes(total) + (trend ? overviewHeroTable(total) : '');
}

/**
 * @description What the total panel says before any account is known: reading the broker's list, or connect an account.
 * @returns {string} HTML.
 */
function overviewEmptyHtml() {
  if (!OVERVIEW.rosterSettled) return '<div class="pf-empty" role="status"><p class="pf-eyebrow">All connected accounts</p><p>Reading your accounts from your broker…</p></div>';
  if (OVERVIEW.rosterFailed) return '<div class="pf-empty" data-pf-empty="unread" role="status"><p class="pf-eyebrow">All connected accounts</p><h2>Your accounts could not be read just now</h2>' +
    '<p>The list of accounts at your broker could not be read, and no account has a recorded value yet. Press Refresh to try again.</p></div>';
  const paper = OVERVIEW.today.paper.filter((p) => p.opened).length;
  return '<div class="pf-empty" data-pf-empty><svg class="pf-empty-art" viewBox="0 0 120 64" aria-hidden="true"><polyline points="4,52 30,40 52,46 78,22 116,10"/><line x1="4" x2="116" y1="60" y2="60"/></svg>' +
    '<h2>Connect your brokerage account</h2><p>Your accounts, their positions and the value of each one over time appear here, with the daily change and a comparison with the S&amp;P 500.</p>' +
    '<p class="foot">Connect a Charles Schwab login in the cockpit under Settings, Connections. Then open ⚙ Settings here and press Discover accounts.' +
    (paper ? ' Your paper ' + (paper === 1 ? 'account trades' : 'accounts trade') + ' simulated money and ' + (paper === 1 ? 'is' : 'are') + ' under Trading status.' : '') + '</p>' +
    '<button type="button" class="btn primary" data-pf-go="settings">Open Settings</button></div>';
}

/**
 * @description The total panel for connected accounts that have no recorded value yet: the value the broker reports now,
 *   and when history starts.
 * @returns {string} HTML.
 */
function overviewNoHistoryHtml() {
  const live = OVERVIEW.accounts.filter((a) => a.current && a.current.source === 'broker'), all = live.length === OVERVIEW.accounts.length;
  const sum = live.reduce((n, a) => n + a.current.value, 0);
  return '<p class="pf-eyebrow">All connected accounts · ' + OVERVIEW.accounts.length + (OVERVIEW.accounts.length === 1 ? ' account' : ' accounts') + '</p>' +
    (live.length ? '<p class="pf-total" data-pf-total>' + esc(PortfolioCharts.money(sum)) + '</p><p class="foot pf-asof">' + (all ? 'Read from your broker at ' : 'Of the accounts your broker listed at ') + esc(pfClock(OVERVIEW.accountsAt)) + '.</p>' : '') +
    '<div class="details-empty pf-collecting"><strong>No value history yet</strong><p>A value is recorded each day an account’s watcher checks it. Earlier values are not reconstructed.</p></div>';
}

/**
 * @description One account card: its colour key, name, chips, value, today's and the range's change, and a small trendline
 *   with its daily bars. The whole card opens the existing account details page.
 * @param {object} a An overviewAccount().
 * @returns {string} HTML.
 */
function overviewCardHtml(a) {
  const tone = { 'RUNNING': 'is-running', 'NEEDS YOU': 'is-blocked', 'NOT RUNNING': 'is-blocked' }[a.chip] || '', s = a.series;
  const range = OVERVIEW.range === 'ALL' ? 'all' : OVERVIEW.range;
  const deltas = s ? '<span class="pf-card-deltas"><span>' + overviewDelta(s.day && s.day.change, s.day && s.day.pct) + ' <span class="pf-when">' + esc(overviewDayWords(s.day && s.day.day)) + '</span></span><span>' +
    overviewDelta(s.span.change, s.span.pct) + ' <span class="pf-when">' + esc(range) + '</span></span></span>' : '';
  const trend = s && s.points.filter((p) => pfFinite(p.value)).length >= 2;
  const foot = !a.current ? 'No value recorded yet.' : a.current.source === 'recorded' ? 'Recorded ' + pfClock(a.current.at) + '.' : 'No history recorded yet. Read from your broker at ' + pfClock(a.current.at) + '.';
  const approval = a.approval ? '<p class="pf-approval' + (a.approval.warn ? ' is-warn' : '') + '">' + esc(a.approval.text) + (a.approval.warn ? ' ' + overviewApprovalLink(a) : '') + '</p>' : '';
  // The name link covers the card (its ::after), so a tap anywhere opens the account's details; the approval link sits above it.
  return '<article class="panel pf-card" data-pf-account="' + esc(a.key) + '">' +
    '<span class="pf-card-head"><span class="pf-key pf-k' + a.slot + '" aria-hidden="true"></span><a class="pf-card-name pf-card-link" href="' + esc(nativeDetailsHref(a)) + '" data-pf-details="' + esc(a.key) + '" title="Account details">' + esc(a.label) + '</a>' +
    '<span class="story-chips"><span class="story-chip ' + tone + '">' + esc(a.chip) + '</span>' + (a.parked ? '<span class="story-chip">' + esc(a.parked) + '</span>' : '') + '</span></span>' +
    '<span class="pf-card-value">' + esc(PortfolioCharts.money(a.current && a.current.value)) + '</span>' + deltas +
    (trend ? '<span class="pf-spark-host" data-pf-spark="' + esc(a.key) + '"></span>' : '') + approval + '<span class="foot pf-card-foot">' + esc(foot) + '</span></article>';
}

/**
 * @description The account cards, and a line saying paper accounts are not in these figures.
 * @returns {void}
 */
function paintOverviewCards() {
  $('pfCards').innerHTML = OVERVIEW.accounts.map(overviewCardHtml).join('');
  $('pfCardsTitle').hidden = !OVERVIEW.accounts.length;
  const paper = OVERVIEW.today.paper.filter((p) => p.opened).length, notes = [];
  if (OVERVIEW.accounts.length && paper) notes.push('Paper accounts trade simulated money and are not counted here; they are under Trading status.');
  if (OVERVIEW.accounts.length && OVERVIEW.rosterFailed) notes.push('The list of accounts at your broker could not be read just now, so an account with no saved record may be missing here.');
  if (OVERVIEW.values.cut) notes.push('More values are recorded than one read returns, so the oldest days may be missing.');
  $('pfCardsFoot').textContent = notes.join(' ');
}

/**
 * @description The lines the comparison draws: up to six accounts with a recorded change in the range, then each benchmark
 *   that could be read, normalised on the comparison's first day.
 * @returns {{lines:Array<object>,failed:Array<string>,more:number}} The lines, the benchmarks that could not be read, and accounts left out.
 */
function overviewCompareLines() {
  const days = OVERVIEW.view.compareDays, accounts = OVERVIEW.accounts.filter((a) => a.slot && a.series && a.series.span.change !== null);
  const lines = accounts.map((a) => ({ key: a.key, label: a.label, css: 'pf-s' + a.slot, points: a.series.percent.points, base: a.series.percent.base, last: a.series.span.pct }));
  const failed = [];
  for (const b of OVERVIEW_BENCHMARKS) {
    const answer = OVERVIEW.bench[b.symbol], series = answer && PortfolioSeries.benchmarkSeries(answer.closes, days);
    if (series) lines.push({ key: b.symbol, label: b.label, css: b.css, points: series.points, base: series.base, last: (series.points.filter((p) => pfFinite(p.pct)).at(-1) || {}).pct, benchmark: true });
    else if (answer) failed.push(b.label);
  }
  return { lines, failed, more: OVERVIEW.accounts.filter((a) => !a.slot && a.series).length };
}

/**
 * @description The comparison panel: its legend with each line's change over the range, the chart host, its notes and its
 *   table twin.
 * @returns {void}
 */
function paintOverviewCompare() {
  const host = $('pfCompare'), { lines, failed, more } = overviewCompareLines(), days = OVERVIEW.view.compareDays;
  const title = '<h2 id="pfCompareTitle">Accounts compared with the market</h2>';
  OVERVIEW.compareLines = [];
  if (!lines.some((l) => !l.benchmark)) { host.innerHTML = title + '<p class="foot">A comparison needs two recorded market days for an account in this range.</p>'; host.hidden = !OVERVIEW.accounts.length; return; }
  host.hidden = false;
  const reading = OVERVIEW_BENCHMARKS.filter((b) => !OVERVIEW.bench[b.symbol]).length;
  const notes = ['Each account counts from its first recorded value in this range' + (lines.some((l) => l.benchmark) ? '; ' + lines.filter((l) => l.benchmark).map((l) => l.key).join(' and ') + ' from the close of ' + PortfolioCharts.dayWords(lines.find((l) => l.benchmark).base, true) : '') + '.',
    'An account’s change in value includes deposits and withdrawals; SPY and BIL are price change only.'];
  if (reading) notes.push('Reading S&P 500 and Treasury bill prices…');
  if (failed.length) notes.push(failed.join(' and ') + ' prices could not be read just now.');
  if (more) notes.push('Accounts after the sixth are not drawn.');
  host.innerHTML = title + '<ul class="pf-legend">' + lines.map((l) => '<li data-pf-legend="' + esc(l.key) + '"><span class="pf-line-key ' + esc(l.css) + '-key" aria-hidden="true"></span>' + esc(l.label) + ' <strong>' + esc(PortfolioCharts.signedPercent(l.last)) + '</strong></li>').join('') + '</ul>' +
    '<div class="pf-chart" id="pfCompareChart"></div>' + notes.map((n) => '<p class="foot pf-note">' + esc(n) + '</p>').join('') + overviewCompareTable(days, lines);
  OVERVIEW.compareLines = lines;
}

/**
 * @description The comparison's table twin: each line's percent change on each day, newest first.
 * @param {Array<string>} days The comparison's days.
 * @param {Array<object>} lines The lines.
 * @returns {string} HTML.
 */
function overviewCompareTable(days, lines) {
  const maps = lines.map((l) => new Map(l.points.map((p) => [p.day, p.pct])));
  const rows = days.slice().reverse().map((day) => '<tr><td>' + esc(PortfolioCharts.dayWords(day, true)) + '</td>' + maps.map((m) => '<td class="num">' + esc(PortfolioCharts.signedPercent(m.get(day))) + '</td>').join('') + '</tr>').join('');
  return '<details class="pf-twin"><summary>Comparison values</summary><div class="pf-table-scroll"><table class="pf-table"><thead><tr><th>Day</th>' + lines.map((l) => '<th class="num">' + esc(l.label) + '</th>').join('') + '</tr></thead><tbody>' + rows + '</tbody></table></div></details>';
}

/**
 * @description The holdings across accounts: the broker's current list when the roster has it, otherwise each account's last
 *   check. A weight is a share of the same source's total; a day change and a gain show where they are reported.
 * @returns {{rows:Array<object>,source:string,at:string|null}} The rows and where they come from.
 */
function overviewPositions() {
  const labelOf = (key) => (OVERVIEW.accounts.find((a) => a.key === key) || { label: 'Connected account' }).label;
  const rosterRows = ACCOUNTS.filter((a) => a.nativeReadOnly && a.accountId && !a.error && Array.isArray(a.positions));
  const fromRoster = OVERVIEW.rosterSettled && rosterRows.length > 0;
  const sources = fromRoster ? rosterRows.map((a) => ({ key: a.connectionKey + '|' + a.accountId, equity: a.equity, positions: a.positions, at: OVERVIEW.accountsAt }))
    : OVERVIEW.today.connected.filter((f) => f.holdings && Array.isArray(f.holdings.positions)).map((f) => ({ key: f.connectionKey + '|' + f.accountId, equity: f.holdings.equity, positions: f.holdings.positions, at: f.holdings.at }));
  const total = sources.every((s) => pfFinite(s.equity)) ? sources.reduce((n, s) => n + s.equity, 0) : null;
  const rows = sources.flatMap((s) => s.positions.filter((p) => p && p.symbol).map((p) => ({ symbol: String(p.symbol), key: s.key, account: labelOf(s.key), qty: pfFinite(p.qty) ? p.qty : null,
    value: pfFinite(p.marketValue) ? p.marketValue : null, weight: total > 0 && pfFinite(p.marketValue) ? p.marketValue / total * 100 : null,
    day: pfFinite(p.dayPl) ? p.dayPl : null, gain: pfFinite(p.unrealizedPl) ? p.unrealizedPl : null })));
  const times = sources.map((s) => (typeof s.at === 'number' ? new Date(s.at).toISOString() : s.at)).filter(Boolean).sort();
  return { rows, source: fromRoster ? 'broker' : 'saved', at: times.at(-1) || null };
}

/**
 * @description Sort holdings by a column; a figure that is not known goes last in either direction.
 * @param {Array<object>} rows The holdings.
 * @param {{key:string,dir:number}} sort The column and direction (1 rising, -1 falling).
 * @returns {Array<object>} A sorted copy.
 */
function overviewSortRows(rows, sort) {
  return rows.slice().sort((a, b) => {
    const x = a[sort.key], y = b[sort.key];
    if (x === null || y === null) return x === null && y === null ? a.symbol.localeCompare(b.symbol) : x === null ? 1 : -1;
    return (typeof x === 'string' ? x.localeCompare(y) : x - y) * sort.dir || a.symbol.localeCompare(b.symbol);
  });
}

/**
 * @description The holdings panel: one sortable table across accounts, with where its figures come from.
 * @returns {void}
 */
function paintOverviewPositions() {
  const host = $('pfPositions'), { rows, source, at } = overviewPositions(), sort = OVERVIEW.sort, shares = new Intl.NumberFormat('en-US', { maximumFractionDigits: 6 });
  host.hidden = !OVERVIEW.accounts.length;
  const head = '<div class="pf-panel-head"><h2 id="pfPositionsTitle">Positions</h2><span class="pill">' + rows.length + (rows.length === 1 ? ' holding' : ' holdings') + '</span></div>';
  const where = source === 'broker' ? 'Read from your broker at ' + pfClock(at) + '.' : at ? 'From each account’s last check (newest ' + pfClock(at) + ').' : 'No holdings are saved for these accounts yet.';
  if (!rows.length) { host.innerHTML = head + '<p class="foot">' + esc(source === 'broker' ? 'No open positions. ' + where : where) + '</p>'; return; }
  const th = ([key, label, cls]) => '<th class="' + cls + '" aria-sort="' + (sort.key === key ? (sort.dir > 0 ? 'ascending' : 'descending') : 'none') + '"><button type="button" data-pf-sort="' + key + '">' + label + (sort.key === key ? (sort.dir > 0 ? ' ↑' : ' ↓') : '') + '</button></th>';
  const cell = (v, kind, label) => '<td class="num' + (kind === 'tone' && pfFinite(v) ? ' is-' + pfTone(v) : '') + '"' + (label ? ' data-label="' + label + '"' : '') + (v === null ? ' title="Not reported"' : '') + '>' +
    esc(v === null ? '—' : kind === 'qty' ? shares.format(v) : kind === 'pct' ? v.toFixed(2) + '%' : kind === 'tone' ? PortfolioCharts.signedMoney(v) : PortfolioCharts.money(v)) + '</td>';
  host.innerHTML = head + '<div class="pf-table-scroll"><table class="pf-table pf-holdings"><thead><tr>' + OVERVIEW_COLUMNS.map(th).join('') + '</tr></thead><tbody>' +
    overviewSortRows(rows, sort).map((r) => '<tr data-pf-row="' + esc(r.symbol) + '"><td><strong>' + esc(r.symbol) + '</strong></td><td>' + esc(r.account) + '</td>' + cell(r.qty, 'qty', 'Shares') + cell(r.value, 'money') + cell(r.weight, 'pct', 'Weight') + cell(r.day, 'tone', 'Day change') + cell(r.gain, 'tone', 'Gain') + '</tr>').join('') +
    '</tbody></table></div><p class="foot pf-note">' + esc(where + ' Weight is a share of all these accounts. Day change and gain (since purchase, price only) show where your broker reports them.') + '</p>';
}

/**
 * @description The tooltip lines for one day of the total's charts.
 * @param {number} i The day's index in the range.
 * @returns {Array<string>} Lines, the value first.
 */
function overviewTotalTip(i) {
  const p = OVERVIEW.view.total.points[i], c = OVERVIEW.view.total.changes[i];
  return [PortfolioCharts.dayWords(p.day, true), p.value === null ? 'No record' : PortfolioCharts.money(p.value),
    c && c.change !== null ? 'Change ' + PortfolioCharts.signedMoney(c.change) + (pfFinite(c.pct) ? ' (' + PortfolioCharts.signedPercent(c.pct) + ')' : '') : 'Change unknown'];
}

/**
 * @description Draw every chart at the width of its box: the total's value line and daily bars, each card's trendline and the
 *   comparison. Called after a paint and when the window's width changes.
 * @returns {void}
 */
function drawOverviewCharts() {
  const view = OVERVIEW.view, width = (id) => ($(id) ? $(id).clientWidth : 0), total = view && view.total;
  if ($('pfValueChart')) $('pfValueChart').innerHTML = PortfolioCharts.valueChart(total.points, { width: width('pfValueChart'), chart: 'total', label: 'Total value of all connected accounts' });
  if ($('pfBarsChart')) $('pfBarsChart').innerHTML = PortfolioCharts.barsChart(total.changes, { width: width('pfBarsChart'), chart: 'total', label: 'Daily change in total value' });
  OVERVIEW.tips.total = overviewTotalTip;
  main.querySelectorAll('[data-pf-spark]').forEach((host) => {
    const a = OVERVIEW.accounts.find((x) => x.key === host.getAttribute('data-pf-spark'));
    if (a && a.series) host.innerHTML = PortfolioCharts.sparkline(a.series.points, a.series.changes, { width: host.clientWidth, slot: a.slot || 0, label: a.label + ' value over the range' });
  });
  drawOverviewCompare();
}

/**
 * @description Draw the comparison at the width of its box (alone when the benchmark prices arrive, so the other charts stay
 *   as they are under the pointer).
 * @returns {void}
 */
function drawOverviewCompare() {
  const view = OVERVIEW.view, chart = $('pfCompareChart'), lines = OVERVIEW.compareLines || [];
  if (chart) {
    const tip = (i) => [PortfolioCharts.dayWords(view.compareDays[i], true), ...lines.map((l) => { const p = l.points.find((x) => x.day === view.compareDays[i]); return l.label + ' ' + PortfolioCharts.signedPercent(p ? p.pct : null); })];
    chart.innerHTML = PortfolioCharts.compareChart(view.compareDays, lines, { width: chart.clientWidth, chart: 'compare', label: 'Percent change of each account and the benchmarks' });
    OVERVIEW.tips.compare = tip;
  }
}

/**
 * @description Show the tooltip and move the crosshair for the day under the pointer.
 * @param {PointerEvent} e The event.
 * @returns {void}
 */
function overviewPointer(e) {
  const tip = $('pfTip'), hit = e.target && e.target.closest ? e.target.closest('.pf-hit') : null;
  main.querySelectorAll('.pf-cross').forEach((line) => { line.setAttribute('visibility', 'hidden'); });
  if (!hit || !tip) { if (tip) tip.hidden = true; return; }
  const lines = (OVERVIEW.tips[hit.getAttribute('data-pf-chart')] || (() => []))(Number(hit.getAttribute('data-pf-i')));
  if (!lines.length) { tip.hidden = true; return; }
  tip.replaceChildren(...lines.map((text, k) => { const row = document.createElement(k === 1 ? 'strong' : 'span'); row.textContent = text; return row; }));
  const x = Number(hit.getAttribute('x')) + Number(hit.getAttribute('width')) / 2, cross = hit.ownerSVGElement && hit.ownerSVGElement.querySelector('.pf-cross');
  if (cross) { cross.setAttribute('x1', x); cross.setAttribute('x2', x); cross.setAttribute('visibility', 'visible'); }
  tip.hidden = false;
  const box = tip.getBoundingClientRect(), left = Math.min(e.clientX + 14, innerWidth - box.width - 8), top = e.clientY - box.height - 12;
  tip.style.left = Math.max(8, left) + 'px'; tip.style.top = (top < 8 ? e.clientY + 18 : top) + 'px';
}

/**
 * @description Wire the screen with delegated listeners (the surface carries no handler attribute): the tabs, See why, the
 *   range buttons, the holdings sort, a card's tap, Open Settings, the tooltip, and one width listener for the charts.
 * @returns {void}
 */
function wireOverview() {
  wireAccountsTabs();
  const root = $('pfRoot');
  root.onclick = (e) => {
    const go = e.target.closest('[data-pf-go]'), range = e.target.closest('[data-pf-range]'), sort = e.target.closest('[data-pf-sort]'), card = e.target.closest('[data-pf-details],[data-pf-approval]');
    if (go) { if (go.getAttribute('data-pf-go') === 'settings') openSettings(); else navigate('accounts', { sub: 'status' }); return; }
    if (range) { OVERVIEW.range = range.getAttribute('data-pf-range'); overviewPaint(); return; }
    if (sort) { const key = sort.getAttribute('data-pf-sort'); OVERVIEW.sort = { key, dir: OVERVIEW.sort.key === key ? -OVERVIEW.sort.dir : (key === 'symbol' || key === 'account' ? 1 : -1) }; paintOverviewPositions(); return; }
    if (!card || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || e.button) return;
    e.preventDefault();
    const settings = card.hasAttribute('data-pf-approval'), a = OVERVIEW.accounts.find((x) => x.key === card.getAttribute(settings ? 'data-pf-approval' : 'data-pf-details'));
    if (!a) return;
    if (!settings) { homeOpenAddress(a, 'accounts', 'details'); return; }
    homeOpenAddress(a, 'strategies', 'accounts');
    homeReveal('#nativeStrategySettings', false);
  };
  root.onpointermove = overviewPointer;
  root.onpointerdown = overviewPointer;
  root.onpointerleave = () => { const tip = $('pfTip'); if (tip) tip.hidden = true; };
  wireDiscovered();
  if (OVERVIEW.resizeWired) return;
  OVERVIEW.resizeWired = true;
  window.addEventListener('resize', () => { clearTimeout(OVERVIEW.resizeTimer); OVERVIEW.resizeTimer = setTimeout(() => { if ($('pfRoot') && OVERVIEW.view) drawOverviewCharts(); }, 120); });
}

/**
 * @description When the broker's account list arrives, fill the connected-login list ⚙ Settings shows and redraw: an account
 *   with no saved record gets its card, and the holdings come from the broker's current list. The first render uses the read
 *   boot() started; a later render reads the roster again, so Refresh and Discover accounts are reflected.
 * @param {number} token RENDER_TOKEN at dispatch time.
 * @returns {Promise<void>}
 */
async function overviewAwaitRoster(token) {
  if (OVERVIEW.rosterSeen) BOOKS_READY = loadBooks().catch(() => null);   // null: the roster could not be read; said on the screen
  OVERVIEW.rosterSeen = true;
  const roster = await BOOKS_READY;
  if (stale(token) || !$('pfRoot')) return;
  OVERVIEW.rosterSettled = true;
  OVERVIEW.rosterFailed = !roster;
  if (roster) OVERVIEW.accountsAt = Date.now();
  paintDiscovered();
  overviewPaint();
}

/**
 * @description Read the benchmarks' daily prices through the charts' existing read, once per paint of the screen, and redraw
 *   the comparison when they arrive. A failed read is said under the chart; nothing is drawn for it.
 * @param {number} token RENDER_TOKEN at dispatch time.
 * @returns {Promise<void>}
 */
async function overviewBenchmarks(token) {
  OVERVIEW.bench = {};
  const first = OVERVIEW.view && OVERVIEW.view.accounts[0];
  if (!first) return;
  const read = async (symbol) => {
    try {
      const r = await fetch('/api/trading-charts/bars?' + new URLSearchParams({ symbol, timeframe: '1Day', connection: first.connectionKey }), { credentials: 'include' });
      return { closes: r.ok ? PortfolioSeries.closesOf(await r.json().catch(() => null)) : null };
    } catch {
      return { closes: null };   // the price read failed: the comparison says so and draws no line for it
    }
  };
  const answers = await Promise.all(OVERVIEW_BENCHMARKS.map((b) => read(b.symbol)));
  if (stale(token) || !$('pfRoot')) return;
  OVERVIEW_BENCHMARKS.forEach((b, i) => { OVERVIEW.bench[b.symbol] = answers[i]; });
  paintOverviewCompare();
  drawOverviewCompare();
}

/**
 * @description VIEW 'accounts', the Overview tab. Reads the saved values and the saved records together, then the job list,
 *   and paints; the roster and the benchmark prices fill in after. A bookmark that names an account, a page without its
 *   modules, or a read that fails is left to the former landing (answers false).
 * @param {number} token RENDER_TOKEN at dispatch time.
 * @returns {Promise<boolean>} true when this screen took the render.
 */
async function renderOverviewView(token) {
  OVERVIEW.failed = null;
  const ready = typeof PortfolioSeries !== 'undefined' && typeof PortfolioCharts !== 'undefined' && typeof AccountStory !== 'undefined' && typeof homeCardsOf === 'function';
  if (!ready || new URLSearchParams(location.search).get('account')) return false;
  let values, today;
  try { [values, today] = await Promise.all([api('/paper/values'), api('/paper/today')]); }
  catch (e) { OVERVIEW.failed = e.message || 'the read failed'; return false; }
  if (stale(token)) return true;
  if (!overviewReadable(values, today)) { OVERVIEW.failed = 'the answer could not be read'; return false; }
  const jobs = await homeJobs();
  if (stale(token)) return true;
  Object.assign(OVERVIEW, { values, today, jobs, rosterSettled: OVERVIEW.rosterSeen && OVERVIEW.rosterSettled });
  main.innerHTML = overviewSkeleton();
  wireOverview();
  overviewPaint();
  overviewAwaitRoster(token);
  overviewBenchmarks(token);
  return true;
}
