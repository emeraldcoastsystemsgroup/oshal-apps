/* trading/ui/view-quant.js — Research, Quant desk: the ranked list with reasons, where the person's holdings rank, how the
 * market looks, and the scoreboard that says whether any of it works. Classic script over app.js's $, esc, money, api, jbody.
 * Research only: nothing on this screen can place an order. Sort headers and the Why disclosures keep every number readable at phone width.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Show how the average stock and the momentum leaders moved beside SPY, and chart the leading signal with and without the biggest winners.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Rank by any signal, led by the one with the best evidence and showing its verdict; the history table shows each signal without the biggest winners and states the limit plainly.
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: the Quant desk screen and the keeper that keeps its nightly job on while the person has the desk turned on.
 */

let QD = { today: null, board: null, status: null, rankBy: null, sort: { key: 'rank', dir: 1 }, showAll: false, running: false, keeperRefused: null };
const QD_SCHEDULE = { app: 'intelligent-trades', name: 'quant-desk' };
const QD_ACTIVATION = { class: 'person', configuration: { runBudgetMicros: 1000000, dailyBudgetMicros: 10000000, timeoutMs: 60000 } };
const QD_VERDICT_CLASS = { 'Holds up': 'pos', 'Promising': 'pos', 'Fails': 'neg' };
const QD_TOP_ROWS = 25;

const qdPct = (n, d = 1) => (n == null ? '—' : (n >= 0 ? '+' : '') + (n * 100).toFixed(d) + '%');
const qdPlain = (n, d = 1) => (n == null ? '—' : (n * 100).toFixed(d) + '%');
const qdCls = (n) => (n == null ? '' : n > 0 ? 'pos' : n < 0 ? 'neg' : '');

/**
 * @description Keep the nightly job activated in the person's own session while the desk is on, however it was turned on.
 * @returns {Promise<string>} What the pass did.
 */
async function quantScheduleKeep() {
  if (QD.keeperRefused) return 'refused';
  try {
    const status = await api('/quant/status');
    if (!status.enabled) return 'off';
    const row = await paperScheduleRow(QD_SCHEDULE);
    if (!row) return 'unlisted';
    if (paperScheduleActive(row)) return 'active';
    try { await paperKernel('/api/v1/agent/schedules/' + encodeURIComponent(row.id) + '/activate', { method: 'POST', body: JSON.stringify(QD_ACTIVATION) }); }
    catch (e) { QD.keeperRefused = e.message || 'refused'; return 'refused'; }
    return 'activated';
  } catch { return 'unavailable'; }
}

/**
 * @description Turn the desk on or off: the setting, then the person's own nightly job.
 * @param {boolean} enabled - The new state.
 * @returns {Promise<void>}
 */
async function qdSetEnabled(enabled) {
  await api('/quant/settings', jbody('POST', { enabled }));
  if (enabled) { QD.keeperRefused = null; await quantScheduleKeep(); }
  else {
    const row = await paperScheduleRow(QD_SCHEDULE);
    if (row && paperScheduleActive(row)) await paperKernel('/api/v1/agent/schedules/' + encodeURIComponent(row.id) + '/deactivate', { method: 'POST', body: '{}' });
  }
}

/**
 * @description Run bounded passes while this page stays on the desk, until the list is finished.
 * @param {HTMLElement} host - The tab body.
 * @returns {Promise<void>}
 */
async function qdRun(host) {
  if (QD.running) return;
  QD.running = true;
  const say = (text, bad) => { const el = $('qdMsg'); if (el) { el.className = bad ? 'err' : 'sub'; el.textContent = text; } };
  try {
    for (let i = 0; i < 80 && $('tabbody') === host; i += 1) {
      const out = await api('/quant/run', jbody('POST', {}));
      if (out.status === 'needs-schwab') { say(out.message, true); return; }
      const p = out.progress || {};
      if (out.status === 'done') { say('Finished for ' + esc(p.session || '') + '.'); await qdLoad(host); return; }
      say(p.phase === 'scan' ? 'Reading ten years of daily prices: ' + (p.read || 0) + ' of ' + (p.total || '?') + ' stocks…' : p.phase === 'enrich' ? 'Reading SEC filings and earnings dates…' : 'Scoring the list…');
      if (p.publishedAt && !(QD.today && QD.today.ready)) { await qdLoad(host); say('Reading SEC filings and earnings dates…'); }
      if (out.status === 'busy') await new Promise((r) => setTimeout(r, 8000));
    }
  } catch (e) { say(e.message, true); } finally { QD.running = false; }
}

/** @description The list's sort value for a row. @param {object} r - Row. @param {string} key - Column. @returns {number|string} Value. */
function qdSortValue(r, key) {
  if (key === 'symbol') return r.symbol;
  if (key in r && typeof r[key] === 'number') return r[key];
  return r.f[key] ?? -Infinity;
}

/**
 * @description The ranked table, sorted as the person asked.
 * @param {Array<object>} rows - Rows.
 * @param {string} id - data hook.
 * @returns {string} HTML.
 */
function qdTable(rows, id) {
  const cols = [['rank', 'Rank'], ['symbol', 'Stock'], ['score', 'Score'], ['price', 'Price'], ['chg1d', 'Last day'], ['mom12', '12-mo momentum'], ['vsMa200', 'vs 200-day'], ['fromHigh', 'From high'], ['vol', 'Volatility']];
  const { key, dir } = QD.sort;
  const sorted = [...rows].sort((a, b) => { const x = qdSortValue(a, key), y = qdSortValue(b, key); return (x < y ? -1 : x > y ? 1 : 0) * dir; });
  const head = cols.map(([k, l]) => '<th' + (k === 'rank' || k === 'symbol' ? '' : ' style="text-align:right"') + (k === key ? ' aria-sort="' + (dir > 0 ? 'ascending' : 'descending') + '"' : '') + '><button class="btn ghost" data-qd-sort="' + k + '" style="padding:2px 4px;font-size:inherit">' + l + (k === key ? (dir > 0 ? ' ▲' : ' ▼') : '') + '</button></th>').join('') + '<th>Why</th>';
  const body = sorted.map((r) => '<tr><td>' + r.rank + '</td><td><button class="btn ghost" data-qd-research="' + esc(r.symbol) + '" style="padding:2px 4px;font-weight:700">' + esc(r.symbol) + '</button>' + (r.held ? ' <span class="sub">you hold</span>' : '') + '</td><td style="text-align:right">' + r.score + '</td><td style="text-align:right">' + money(r.price) + '</td><td style="text-align:right" class="' + qdCls(r.chg1d) + '">' + qdPct(r.chg1d) + '</td><td style="text-align:right" class="' + qdCls(r.f.mom12) + '">' + qdPct(r.f.mom12, 0) + '</td><td style="text-align:right" class="' + qdCls(r.f.vsMa200) + '">' + qdPct(r.f.vsMa200, 0) + '</td><td style="text-align:right">' + qdPct(r.f.fromHigh, 0) + '</td><td style="text-align:right">' + qdPlain(r.f.vol, 0) + '</td><td style="min-width:150px"><details><summary>Why</summary><ul style="margin:6px 0;padding-left:16px">' + r.reasons.map((x) => '<li>' + esc(x) + '</li>').join('') + r.cautions.map((x) => '<li class="neg">' + esc(x) + '</li>').join('') + '</ul></details></td></tr>').join('');
  return '<div style="overflow:auto" data-quant-table="' + id + '"><table><thead><tr>' + head + '</tr></thead><tbody>' + body + '</tbody></table></div>';
}

/**
 * @description Today's rows ranked by the signal the person chose, led by the one with the best evidence.
 * @returns {Array<object>} Rows with this ranking's rank and score.
 */
function qdRanked() {
  const t = QD.today, by = QD.rankBy || t.rankBy;
  return t.rows.filter((r) => r.pct[by] != null).sort((a, b) => b.pct[by] - a.pct[by] || a.symbol.localeCompare(b.symbol)).map((r, i) => ({ ...r, rank: i + 1, score: r.pct[by] }));
}

/** @description The signal choices with their verdicts. @returns {string} HTML. */
function qdRankControl() {
  const signals = (QD.board && QD.board.history && QD.board.history.signals) || [], by = QD.rankBy || QD.today.rankBy;
  const lead = signals.find((s) => s.id === by);
  return '<label class="sub">Rank by <select data-qd-rank>' + signals.map((s) => '<option value="' + esc(s.id) + '"' + (s.id === by ? ' selected' : '') + '>' + esc(s.name) + ' (' + esc(s.verdict) + ')</option>').join('') + '</select></label>' + (lead ? '<p class="sub" data-quant-lead>History test verdict for this ranking: <b class="' + (QD_VERDICT_CLASS[lead.verdict] || '') + '">' + esc(lead.verdict) + '</b>. Score is the stock’s percentile on this signal. A rank is research, not a recommendation.</p>' : '');
}

/** @description Market condition tiles. @param {object} m - Market condition. @returns {string} HTML. */
function qdMarket(m) {
  if (!m) return '';
  const kpi = (l, n, cls, s) => '<div class="kpi"><div class="n ' + (cls || '') + '">' + n + '</div><div class="l">' + l + '</div>' + (s ? '<div class="s">' + s + '</div>' : '') + '</div>';
  return '<div class="panel" data-quant-market><h2>The market: ' + esc(m.label) + '</h2><div class="kpis">' + kpi('SPY last session', qdPct(m.oneDay), qdCls(m.oneDay), money(m.spy)) + kpi('SPY 1 month', qdPct(m.oneMonth), qdCls(m.oneMonth)) + kpi('From its high', qdPct(m.fromHigh), qdCls(m.fromHigh)) + kpi('vs 200-day average', qdPct(m.vsMa200), qdCls(m.vsMa200)) + kpi('Average stock last session', qdPct(m.listOneDay), qdCls(m.listOneDay), (m.fell5PctShare ?? '—') + '% fell 5% or more') + kpi('Momentum leaders from high', qdPct(m.leadersFromHigh), qdCls(m.leadersFromHigh), 'median of the top 25') + kpi('List above 200-day', m.above200Pct + '%', '', 'above 50-day: ' + m.above50Pct + '%') + '</div></div>';
}

/** @description Where the person's holdings rank. @param {object} t - Today's list. @returns {string} HTML. */
function qdHoldings(t) {
  if (!t.holdings || !t.holdings.length) return '';
  const label = { fund: 'Fund, not ranked', 'too-new': 'Under a year of prices', 'no-data': 'No price data', 'price-jump': 'Price jump to check', 'no-price-for-session': 'No price this session' };
  const ranked = new Map(qdRanked().map((r) => [r.symbol, r]));
  const rows = t.holdings.map((held) => ({ ...held, ...(ranked.has(held.symbol) ? { rank: ranked.get(held.symbol).rank, score: ranked.get(held.symbol).score, of: ranked.size } : {}) })).map((h) => '<tr><td><button class="btn ghost" data-qd-research="' + esc(h.symbol) + '" style="padding:2px 4px;font-weight:700">' + esc(h.symbol) + '</button></td><td style="text-align:right">' + money(h.marketValue) + '</td><td>' + (h.rank ? '#' + h.rank + ' of ' + h.of : esc(label[h.status] || h.status)) + '</td><td style="text-align:right">' + (h.score ?? '—') + '</td><td style="min-width:150px">' + (h.reasons.length ? '<details><summary>Why</summary><ul style="margin:6px 0;padding-left:16px">' + h.reasons.map((x) => '<li>' + esc(x) + '</li>').join('') + h.cautions.map((x) => '<li class="neg">' + esc(x) + '</li>').join('') + '</ul></details>' : '') + '</td></tr>').join('');
  return '<div class="panel" data-quant-holdings><h2>Where your holdings rank</h2><div style="overflow:auto"><table><thead><tr><th>Stock</th><th style="text-align:right">Value</th><th>Rank</th><th style="text-align:right">Score</th><th>Why</th></tr></thead><tbody>' + rows + '</tbody></table></div></div>';
}

/** @description The composite's growth next to SPY and the list. @param {Array<Array>} curve - [month, composite, spy, list]. @returns {string} SVG. */
function qdCurve(curve, signal) {
  if (!curve || curve.length < 2) return '';
  const name = (signal && signal.name) || 'Leading signal';
  const w = 640, h = 180, values = curve.flatMap((r) => r.slice(1)), lo = Math.log(Math.min(...values)), hi = Math.log(Math.max(...values));
  const x = (i) => 40 + (i / (curve.length - 1)) * (w - 50), y = (v) => h - 22 - ((Math.log(v) - lo) / Math.max(1e-9, hi - lo)) * (h - 34);
  const line = (k, color, width) => '<polyline fill="none" stroke="' + color + '" stroke-width="' + width + '" points="' + curve.map((r, i) => x(i).toFixed(1) + ',' + y(r[k]).toFixed(1)).join(' ') + '"/>';
  const last = curve.at(-1), times = (v) => v.toFixed(1) + '×';
  return '<svg role="img" aria-label="' + esc(name) + ' top ten grew ' + times(last[1]) + ', without the biggest winners ' + times(last[3]) + ', SPY ' + times(last[2]) + '" viewBox="0 0 ' + w + ' ' + h + '" style="width:100%;max-width:' + w + 'px;height:auto">' + line(3, 'var(--muted)', 1.5) + line(2, 'var(--sell)', 1.5) + line(1, 'var(--buy)', 2.5) + '<text x="40" y="' + (h - 6) + '" font-size="11" fill="var(--muted)">' + esc(curve[0][0]) + '</text><text x="' + (w - 10) + '" y="' + (h - 6) + '" font-size="11" fill="var(--muted)" text-anchor="end">' + esc(last[0]) + '</text></svg><p class="sub">Growth of $1, log scale. Green: ' + esc(name) + ' top ten ' + times(last[1]) + ', an upper limit. Grey: the same without the biggest winners ' + times(last[3]) + '. Red: SPY ' + times(last[2]) + '.</p>';
}

/** @description The history test. @param {object} board - History test. @returns {string} HTML. */
function qdHistory(board) {
  if (!board || !board.signals) return '';
  const row = (s) => '<tr' + (s.id === (QD.today && QD.today.rankBy) ? ' data-quant-leader' : '') + '><td><b>' + esc(s.name) + '</b><div class="sub">' + esc(s.what) + '. ' + esc(s.source) + '.</div></td><td class="' + (QD_VERDICT_CLASS[s.verdict] || '') + '"><b>' + esc(s.verdict) + '</b></td><td style="text-align:right">' + qdPct(s.annual) + '</td><td style="text-align:right">' + qdPct(s.listAnnual) + '</td><td style="text-align:right">' + qdPct(s.spyAnnual) + '</td><td style="text-align:right">' + (s.t ?? '—') + '</td><td style="text-align:right">' + (s.withoutWinners ? qdPct(s.withoutWinners.annual) + '<div class="sub">list ' + qdPct(s.withoutWinners.listAnnual) + ', t ' + (s.withoutWinners.t ?? '—') + '</div>' : '—') + '</td><td style="text-align:right">' + qdPct(s.maxDrawdown, 0) + '</td><td style="text-align:right">' + (s.stress.year2022 ? qdPct(s.stress.year2022.net, 0) : '—') + '</td><td style="text-align:right">' + qdPct(s.stress.fallingMonths.net) + '</td></tr>';
  const m = board.signals[0];
  return '<div class="panel" data-quant-history><h2>Do these signals work? The history test</h2><p class="sub">Each signal’s top ' + board.topN + ' stocks every month from ' + esc(m.from || '?') + ' to ' + esc(m.to || '?') + ', ' + m.months + ' months, bought the session after the signal, after ' + board.costBpsPerSide + ' basis points of cost per trade. “List” is the average of the same ' + board.symbols + ' stocks. The verdict compares with the list.</p><div style="overflow:auto"><table><thead><tr><th>Signal</th><th>Verdict</th><th style="text-align:right">Per year</th><th style="text-align:right">List</th><th style="text-align:right">SPY</th><th style="text-align:right">t-stat</th><th style="text-align:right">Without biggest winners</th><th style="text-align:right">Worst fall</th><th style="text-align:right">2022</th><th style="text-align:right">When SPY fell 4%+</th></tr></thead><tbody>' + board.signals.map(row).join('') + row(board.marketTiming) + '</tbody></table></div><p class="sub">SPY in 2022: ' + (m.stress.year2022 ? qdPct(m.stress.year2022.spy, 0) : '—') + '. SPY’s worst fall: ' + qdPct(m.spyMaxDrawdown, 0) + '. SPY’s average when it fell 4% or more: ' + qdPct(m.stress.fallingMonths.spy) + '. The market trend rule is judged against SPY and was invested ' + (board.marketTiming.inMarketPct ?? '—') + '% of months.</p>' +  qdCurve(board.curve, board.curveSignal) + '<ul class="sub" style="padding-left:16px">' + board.limits.map((x) => '<li>' + esc(x) + '</li>').join('') + '</ul></div>';
}

/** @description The forward scoreboard. @param {object} f - Forward board. @returns {string} HTML. */
function qdForward(f) {
  if (!f) return '';
  const cell = (r) => '<td style="text-align:right">' + (r.windows ? qdPct(r.vsSpy) + '<div class="sub">' + r.windows + ' window' + (r.windows === 1 ? '' : 's') + '</div>' : '—') + '</td>';
  const rows = f.signals.map((s) => { const m = s.horizons.find((h) => h.h === 21); return '<tr><td><b>' + esc(s.name) + '</b><div class="sub">' + esc(s.source) + '</div></td><td class="' + (QD_VERDICT_CLASS[m.verdict] || '') + '">' + esc(m.verdict) + (m.windows < m.needed ? ' <span class="sub">' + m.windows + ' of ' + m.needed + '</span>' : '') + '</td>' + s.horizons.map(cell).join('') + '</tr>'; }).join('');
  const latest = f.latest ? '<p class="sub">Latest graded picks, made after ' + esc(f.latest.session) + ' and held ' + f.latest.h + ' sessions (SPY ' + qdPct(f.latest.spy) + '). Best: ' + f.latest.best.map(([s, r]) => esc(s) + ' ' + qdPct(r, 0)).join(', ') + '. Worst: ' + f.latest.worst.map(([s, r]) => esc(s) + ' ' + qdPct(r, 0)).join(', ') + '.</p>' : '<p class="sub">Nothing has been graded yet: a pick’s first grade comes 6 sessions after it is made.</p>';
  return '<div class="panel" data-quant-forward><h2>The scoreboard: picks since ' + esc(f.firstSession || 'today') + '</h2><p class="sub">Every pick is recorded before its outcome exists and graded against SPY. Unlike the history test, this cannot be flattered by hindsight. Verdicts wait for 12 windows that do not overlap, about a year at 21 sessions.</p><div style="overflow:auto"><table><thead><tr><th>Signal</th><th>21-session verdict</th><th style="text-align:right">5 sessions vs SPY</th><th style="text-align:right">21 sessions vs SPY</th><th style="text-align:right">63 sessions vs SPY</th></tr></thead><tbody>' + rows + '</tbody></table></div>' + latest + '</div>';
}

/** @description The control panel: on or off, run now, and what the last run covered. @returns {string} HTML. */
function qdControls() {
  const s = QD.status || {}, t = QD.today, on = s.enabled === true;
  const covered = t && t.ready ? 'Scored ' + t.scored + ' stocks for the close of ' + esc(t.session) + '. SEC filings for ' + t.coverage.secFilings + ', Congress buying on ' + t.coverage.congress + '.' : 'No list yet.';
  return '<div class="panel"><h2>Quant desk</h2><p class="sub">Scores a broad list of stocks after each close, says why, and keeps an honest record of whether its picks beat the market. A ranking is research, not advice. Nothing here places an order.</p><p data-quant-covered>' + covered + '</p><p class="sub" data-quant-state>Nightly scoring: <b>' + (on ? 'on' : 'off') + '</b>' + (on ? ', weekdays from 5 pm New York time while your Schwab login is connected.' : '.') + '</p><button class="btn primary" data-qd="' + (on ? 'off' : 'on') + '">' + (on ? 'Turn off nightly scoring' : 'Turn on nightly scoring') + '</button> <button class="btn" data-qd="run">Run now</button><div id="qdMsg" class="sub" role="status" style="margin-top:8px"></div></div>';
}

/** @description Paint the desk from the loaded records. @param {HTMLElement} host - Tab body. @returns {void} */
function qdPaint(host) {
  const t = QD.today, ready = t && t.ready;
  const rows = ready ? qdRanked() : [];
  const top = QD.showAll ? rows : rows.slice(0, QD_TOP_ROWS);
  host.innerHTML = qdControls() + (ready ? qdMarket(t.market) + qdHoldings(t) + '<div class="panel" data-quant-top><h2>' + (QD.showAll ? 'The whole list' : 'Top ' + QD_TOP_ROWS + ' of ' + rows.length) + '</h2>' + qdRankControl() + qdTable(top, 'top') + (rows.length > QD_TOP_ROWS ? '<button class="btn" data-qd="all" style="margin-top:8px">' + (QD.showAll ? 'Show the top ' + QD_TOP_ROWS : 'Show all ' + rows.length) + '</button>' : '') + '</div>' + (QD.showAll ? '' : '<div class="panel" data-quant-weak><h2>Weakest 10</h2>' + qdTable(rows.slice(-10), 'weak') + '</div>') : '') + qdHistory(QD.board && QD.board.history) + qdForward(QD.board && QD.board.forward);
}

/** @description Read the desk's records and paint them. @param {HTMLElement} host - Tab body. @returns {Promise<void>} */
async function qdLoad(host) {
  const [status, today, board] = await Promise.all([api('/quant/status'), api('/quant/today'), api('/quant/scoreboard')]);
  if ($('tabbody') !== host) return;
  QD = { ...QD, status, today, board };
  qdPaint(host);
}

/** @description Research sub-tab entry. @returns {Promise<void>} */
async function loadQuantDesk() {
  const host = $('tabbody');
  if (!host) return;
  host.innerHTML = '<div class="panel">' + spinner('Reading the Quant desk…') + '</div>';
  host.onchange = (e) => { const pick = e.target.closest('[data-qd-rank]'); if (pick) { QD.rankBy = pick.value; QD.sort = { key: 'rank', dir: 1 }; qdPaint(host); } };
  host.onclick = async (e) => {
    const sort = e.target.closest('[data-qd-sort]'), research = e.target.closest('[data-qd-research]'), act = e.target.closest('[data-qd]');
    if (sort) { const k = sort.dataset.qdSort; QD.sort = { key: k, dir: QD.sort.key === k ? -QD.sort.dir : (k === 'rank' || k === 'symbol' ? 1 : -1) }; qdPaint(host); return; }
    if (research) { researchSymbol(research.dataset.qdResearch); return; }
    if (!act) return;
    try {
      if (act.dataset.qd === 'all') { QD.showAll = !QD.showAll; qdPaint(host); return; }
      if (act.dataset.qd === 'run') { await qdRun(host); return; }
      await qdSetEnabled(act.dataset.qd === 'on');
      await qdLoad(host);
    } catch (err) { const el = $('qdMsg'); if (el) { el.className = 'err'; el.textContent = err.message; } }
  };
  try { await qdLoad(host); }
  catch (e) { if ($('tabbody') === host) host.innerHTML = '<div class="panel err">' + esc(e.message) + '</div>'; }
}
