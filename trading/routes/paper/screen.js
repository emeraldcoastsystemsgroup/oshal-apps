/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: the existing trading screen reads (status, account, positions, ledger, performance, orders, journal, realized) answered from the person's native paper book, in the payload shapes those routes already return. It applies only when all of these hold: the host is the native kernel (the route context carries the kernel intent call), the selected book is the paper book, the book has no connected broker rail, and the person has a native paper account. Anything else, including a read that fails, answers null so the route keeps its existing behaviour exactly - a live or broker-connected book never reaches this module.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Review fixes to /performance. SPY is normalized to its close on the book's first equity snapshot date in the period and drawn from that date on, so a book younger than the period is compared with SPY over the same days (before, SPY ran over the whole period and a flat book armed today showed several percent behind the S&P). When the kernel has no SPY day closes for that date (the World archive does not carry SPY today), the summary says so in `benchmark` and the S&P figures stay null.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | withSpyCloses: the route can fill an unavailable SPY benchmark from day closes it read elsewhere (the native World archive only holds SPY since the 2026-10-12 cutover, so 1M/3M/1Y had no base close and the screen showed +0.00% S&P). An unavailable benchmark now carries its baseDate; SPY alignment is one pure helper both sources share; this module still names only the prices intents.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | statusFields reports the paper book's own limits as guardrails (max shares, max dollars per order) and its price source; Settings said "No guardrail config returned by /status" and "Paper data not configured", and the ticket showed "max —".
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | /performance keeps the portfolio series in time order: the current equity updates today's close-stamped snapshot instead of being appended with an earlier timestamp, which made the Reports chart throw "Value is null" on every period.
 *
 * @module paper/screen
 */
'use strict';

const store = require('./store');
const { etParts } = require('./market');
const { PAPER_SCHEDULE } = require('./tick');
const { railConfigured } = require('../trading-rail-guard');

const PERIOD_DAYS = Object.freeze({ '1W': 7, '1M': 31, '3M': 92, '1Y': 366 });
const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;

/**
 * @description Whether this route context is the native kernel's (it carries the kernel intent call and a SQL pool).
 * @param {object} ctx - Route context.
 * @returns {boolean} True on the native kernel.
 */
function nativeHost(ctx) {
  return Boolean(ctx && typeof ctx.intent === 'function' && ctx.pool && typeof ctx.pool.query === 'function');
}

/**
 * @description Whether the selected book is the paper book (an unresolved book on the native host is the paper book).
 * @param {object|string|null} book - The resolved book.
 * @returns {boolean} True for the paper book.
 */
function paperBook(book) {
  const kind = book && typeof book === 'object' ? book.kind : undefined;
  return kind === undefined || kind === null || kind === 'paper';
}

/**
 * @description Whether a book's broker reader is connected; a reader that cannot even be built is not connected.
 * @param {() => object} getReader - Builds the book's broker reader.
 * @returns {boolean} True only when the reader exists and its configured() probe answers true.
 */
function readerConnected(getReader) {
  try { return railConfigured(getReader()); } catch { return false; }
}

/**
 * @description The native paper state for a screen read, or null when the existing route behaviour must stand.
 * @param {object} ctx - Route context.
 * @param {string} sub - Caller subject.
 * @param {object|string|null} book - The resolved book.
 * @param {boolean} railConnected - Whether the book's broker rail is connected.
 * @returns {Promise<object|null>} {config, account, positions} or null.
 */
async function paperState(ctx, sub, book, railConnected) {
  if (railConnected || !sub || !nativeHost(ctx) || !paperBook(book)) return null;
  try {
    const account = await store.loadAccount(ctx.pool, sub);
    if (!account) return null;
    const [config, positions] = await Promise.all([store.loadConfig(ctx.pool, sub), store.loadPositions(ctx.pool, sub)]);
    return { config, account, positions };
  } catch {
    return null;
  }
}

/**
 * @description The broker-shaped account snapshot of a paper book.
 * @param {object} state - Paper state.
 * @returns {object} {equity, cash, buyingPower, portfolioValue, currency}.
 */
function accountOf(state) {
  return { equity: round2(state.account.equity), cash: round2(state.account.cash), buyingPower: round2(state.account.cash),
    portfolioValue: round2(state.account.equity), currency: 'USD', source: 'native-paper' };
}

/**
 * @description The broker-shaped positions of a paper book, valued at their last recorded price.
 * @param {object} state - Paper state.
 * @returns {Array<object>} Positions.
 */
function positionsOf(state) {
  return state.positions.map((p) => {
    const price = p.lastPrice || p.avgCost;
    const cost = p.avgCost * p.qty;
    const unrealizedPl = round2((price - p.avgCost) * p.qty);
    return { symbol: p.symbol, qty: p.qty, side: 'long', avgEntryPrice: p.avgCost, currentPrice: price, marketValue: round2(price * p.qty),
      costBasis: round2(cost), unrealizedPl, unrealizedPlpc: cost > 0 ? unrealizedPl / cost : 0, priceAt: p.lastPriceAt };
  });
}

/**
 * @description One fill in the order-ledger row shape the surface already reads.
 * @param {object} o - Stored fill.
 * @returns {object} The order row.
 */
function orderRow(o) {
  return { order_id: o.order_id, decision_id: o.decision_id, broker: 'native-paper', broker_order_id: null, symbol: o.symbol, side: o.side,
    qty: o.qty, order_type: 'market', limit_price: null, status: 'filled', filled_qty: o.qty, filled_avg_price: o.fill_price,
    realized_pnl: o.realized_pl, reject_reason: null, reason: o.reason, created_at: o.created_at, updated_at: o.created_at };
}

/**
 * @description The day P&L against the last recorded equity before today's New York session date.
 * @param {Array<{date:string, equity:number}>} series - Daily equity, oldest first.
 * @param {number} equity - Current equity.
 * @param {Date} now - Instant.
 * @returns {object|null} {priorCloseEquity, dayPL, dayPLPct} or null before a prior day exists.
 */
function dayOf(series, equity, now) {
  const today = etParts(now).date;
  const prior = series.filter((r) => r.date < today).pop();
  if (!prior || !(prior.equity > 0)) return null;
  const dayPL = round2(equity - prior.equity);
  return { priorCloseEquity: prior.equity, dayPL, dayPLPct: (dayPL / prior.equity) * 100 };
}

/**
 * @description GET /status additions for the native paper book: whether it exists, is armed, and its schedule.
 * @param {object} ctx - Route context.
 * @param {string} sub - Caller subject.
 * @param {object|string|null} book - Resolved book.
 * @param {boolean} railConnected - Whether the book's broker rail is connected.
 * @returns {Promise<object>} Fields to merge into the status payload ({} when the native paper book does not apply).
 */
async function statusFields(ctx, sub, book, railConnected) {
  if (railConnected || !sub || !nativeHost(ctx) || !paperBook(book)) return {};
  const state = await paperState(ctx, sub, book, railConnected);
  const nativePaper = { available: true, armed: Boolean(state && state.config && state.config.armed), opened: Boolean(state), schedule: PAPER_SCHEDULE,
    config: state ? state.config : null };
  if (!state) return { nativePaper };
  // The paper book's own limits are the guardrails its manual orders and fills obey (routes/paper/manual.js).
  const guardrails = { maxQty: state.config.maxShares, maxNotionalUsd: state.config.maxNotional, allowList: [] };
  return { nativePaper, bookConfigured: true, bookEnabled: nativePaper.armed, mode: 'paper', book: 'paper', guardrails,
    paperDataSource: 'World price archive (native paper book)' };
}

/**
 * @description The screen payload for one existing read, or null when the route's own behaviour stands.
 * @param {object} ctx - Route context.
 * @param {string} sub - Caller subject.
 * @param {object|string|null} book - Resolved book.
 * @param {boolean} railConnected - Whether the book's broker rail is connected.
 * @param {'account'|'positions'|'ledger'|'orders'|'journal'|'realized'|'performance'} read - Which read.
 * @param {{period?:string, now?:Date}} [opts] - Read options.
 * @returns {Promise<object|null>} The payload.
 */
async function screenRead(ctx, sub, book, railConnected, read, opts = {}) {
  const state = await paperState(ctx, sub, book, railConnected);
  if (!state) return null;
  const now = opts.now || new Date();
  const base = { mode: 'paper', book: 'paper', source: 'native-paper' };
  try {
    if (read === 'account') return { ...base, account: accountOf(state), settlement: null };
    if (read === 'positions') return { ...base, positions: positionsOf(state) };
    if (read === 'orders') return { ...base, orders: (await store.listOrders(ctx.pool, sub)).slice(0, 100).map(orderRow) };
    if (read === 'ledger') return { ...base, ...(await ledgerOf(ctx, sub, state, now)) };
    if (read === 'journal') return { ...base, trades: await journalOf(ctx, sub) };
    if (read === 'realized') return { ...base, ...realizedOf(await store.listOrders(ctx.pool, sub), now) };
    if (read === 'performance') return { ...base, ...(await performanceOf(ctx, sub, state, opts.period, now)) };
  } catch {
    return null;
  }
  return null;
}

/**
 * @description The /ledger payload: account, positions, the 25 newest fills, the day P&L and the engine's posture per holding.
 * @param {object} ctx - Route context.
 * @param {string} sub - Caller subject.
 * @param {object} state - Paper state.
 * @param {Date} now - Instant.
 * @returns {Promise<object>} Ledger fields.
 */
async function ledgerOf(ctx, sub, state, now) {
  const [orders, series] = await Promise.all([store.listOrders(ctx.pool, sub), store.equitySeries(ctx.pool, sub)]);
  const positions = positionsOf(state);
  // Every paper position is the native engine's own fill, so the engine manages each one.
  const governance = Object.fromEntries(positions.map((p) => [p.symbol, { symbol: p.symbol, exitsApply: true, ordersApply: true, reasons: [],
    heldQty: p.qty, governedQty: p.qty }]));
  return { configured: true, account: accountOf(state), positions, orders: orders.slice(0, 25).map(orderRow),
    day: dayOf(series, state.account.equity, now), governance };
}

/**
 * @description The /journal payload: each fill joined to the decision that produced it.
 * @param {object} ctx - Route context.
 * @param {string} sub - Caller subject.
 * @returns {Promise<Array<object>>} Trades, newest first.
 */
async function journalOf(ctx, sub) {
  const [orders, decisions] = await Promise.all([store.listOrders(ctx.pool, sub), store.listDecisions(ctx.pool, sub)]);
  const byId = new Map(decisions.map((d) => [d.decision_id, d]));
  return orders.slice(0, 100).map((o) => {
    const d = byId.get(o.decision_id) || {};
    return { ...orderRow(o), action: d.action || o.side, rationale: d.rationale || null, confidence: d.confidence ?? null,
      score: d.score ?? null, regime: d.regime ?? null, per_timeframe: d.per_timeframe || [], signal_ids: [], signals: [] };
  });
}

/**
 * @description The /realized tally from the paper book's own closing fills.
 * @param {Array<object>} orders - Stored fills.
 * @param {Date} now - Instant.
 * @returns {object} {basis, today, last30d}.
 */
function realizedOf(orders, now) {
  const today = etParts(now).date;
  const since = now.getTime() - 30 * 86400000;
  const closes = orders.filter((o) => o.side === 'sell' && o.realized_pl != null);
  const tally = (rows) => {
    const wins = rows.filter((o) => o.realized_pl > 0); const losses = rows.filter((o) => o.realized_pl < 0);
    const mean = (xs) => (xs.length ? round2(xs.reduce((s, o) => s + o.realized_pl, 0) / xs.length) : 0);
    return { trades: rows.length, wins: wins.length, losses: losses.length, net: round2(rows.reduce((s, o) => s + o.realized_pl, 0)),
      avg_win: mean(wins), avg_loss: mean(losses), biggest_win: wins.length ? Math.max(...wins.map((o) => o.realized_pl)) : 0,
      biggest_loss: losses.length ? Math.min(...losses.map((o) => o.realized_pl)) : 0, unpriced: 0,
      winRatePct: wins.length + losses.length ? Math.round((wins.length / (wins.length + losses.length)) * 100) : null };
  };
  return { basis: 'engine', today: tally(closes.filter((o) => etParts(new Date(o.created_at)).date === today)),
    last30d: tally(closes.filter((o) => Date.parse(o.created_at) >= since)) };
}

/** Epoch seconds of a New York session date's close; both lines are drawn on these instants. */
const closeT = (date) => Math.floor(Date.parse(`${date}T21:00:00Z`) / 1000);

/**
 * @description SPY's line from a list of day closes, normalized to the last close on or before the base date and
 * drawn from there on with the base date at 0%. Pure: the caller supplies the closes and names where they came from.
 * @param {Array<{date:string, price:number}>} points - Ascending day closes, date YYYY-MM-DD.
 * @param {string} baseDate - YYYY-MM-DD (New York) of the portfolio's base snapshot.
 * @param {string} source - Where the closes came from ('world-archive' | 'schwab').
 * @returns {{spy:Array<{t:number,pct:number}>, benchmark:object}|null} The line, or null with no close on or before the base date.
 */
function spyFromCloses(points, baseDate, source) {
  const before = points.filter((p) => p.date <= baseDate);
  const base = before.length ? before[before.length - 1].price : 0;
  if (!(base > 0)) return null;
  const after = points.filter((p) => p.date > baseDate);
  const spy = [{ t: closeT(baseDate), pct: 0 }, ...after.map((p) => ({ t: closeT(p.date), pct: (p.price / base - 1) * 100 }))];
  return { spy, benchmark: { symbol: 'SPY', available: true, baseDate, baseClose: base, source } };
}

/**
 * @description SPY's line aligned to the book's own window from the World price archive's day buckets.
 * @param {object} ctx - Route context (its intent call reads SPY's day closes).
 * @param {string} baseDate - YYYY-MM-DD (New York) of the portfolio's base snapshot.
 * @param {number} days - Days of day buckets to read (the period, bounded by the kernel's 365).
 * @returns {Promise<{spy:Array<{t:number,pct:number}>, benchmark:object}>} The line and whether it is available.
 */
async function spyAligned(ctx, baseDate, days) {
  // baseDate travels with an unavailable benchmark so the route can fill it from another price source.
  const unavailable = (reason) => ({ spy: [], benchmark: { symbol: 'SPY', available: false, baseDate, reason } });
  let points;
  try {
    const answer = await ctx.intent('prices.series', { symbol: 'SPY', interval: 'day', days: Math.min(365, days + 1) });
    points = ((answer && answer.series && answer.series.SPY) || [])
      .map((p) => ({ date: String(p.bucket || '').slice(0, 10), price: Number(p.price) }))
      .filter((p) => p.date && p.price > 0);
  } catch {
    return unavailable('The kernel price read for SPY failed.');
  }
  if (!points.length) return unavailable('The World price archive has no SPY prices.');
  return spyFromCloses(points, baseDate, 'world-archive')
    || unavailable(`The World price archive has no SPY close on or before ${baseDate}.`);
}

/**
 * @description Fill an unavailable SPY benchmark of a paper /performance payload from day closes another source
 * supplied (the route reads them; this module names no broker read). An available benchmark is kept as it is.
 * @param {object} perf - The paper /performance payload.
 * @param {Array<{date:string, price:number}>} points - Ascending day closes, date YYYY-MM-DD.
 * @param {string} source - Where the closes came from.
 * @returns {object} The payload with SPY's line and the summary's SPY figures, or the payload unchanged.
 */
function withSpyCloses(perf, points, source) {
  const benchmark = perf && perf.summary && perf.summary.benchmark;
  if (!benchmark || benchmark.available !== false || !benchmark.baseDate || !perf.portfolio.length) return perf;
  const filled = spyFromCloses(points.filter((p) => p.date && p.price > 0), benchmark.baseDate, source);
  if (!filled) return perf;
  const endPct = perf.portfolio[perf.portfolio.length - 1].pct;
  const spyPct = filled.spy[filled.spy.length - 1].pct;
  return { ...perf, spy: filled.spy, summary: { ...perf.summary, spyReturnPct: round2(spyPct),
    vsSpyPct: round2(endPct - spyPct), benchmark: filled.benchmark } };
}

/**
 * @description The /performance payload from the paper book's daily equity against SPY over the same days.
 * @param {object} ctx - Route context (its intent call reads SPY's day closes).
 * @param {string} sub - Caller subject.
 * @param {object} state - Paper state.
 * @param {string} periodReq - 1W | 1M | 3M | 1Y.
 * @param {Date} now - Instant.
 * @returns {Promise<object>} {period, portfolio, spy, summary}.
 */
async function performanceOf(ctx, sub, state, periodReq, now) {
  const period = PERIOD_DAYS[String(periodReq || '1M').toUpperCase()] ? String(periodReq).toUpperCase() : '1M';
  const days = PERIOD_DAYS[period];
  const cutoff = new Date(now.getTime() - days * 86400000).toISOString().slice(0, 10);
  const series = (await store.equitySeries(ctx.pool, sub)).filter((r) => r.date >= cutoff && r.equity > 0);
  const equity = state.account.equity;
  const base = series.length ? series[0].equity : state.account.startingCash;
  // Both lines start on the same date: the first snapshot in the period, or today for a book with none yet.
  const baseDate = series.length ? series[0].date : etParts(now).date;
  const portfolio = series.map((r) => ({ t: closeT(r.date), pct: (r.equity / base - 1) * 100 }));
  // The current equity is the latest point. Today's snapshot is stamped at the session close (21:00 UTC), after the
  // current instant during the session: append-only put a point earlier than the one before it, and the chart refused
  // the out-of-order series ("Value is null"). Today's point carries the current equity instead.
  const nowT = Math.floor(now.getTime() / 1000), current = (equity / base - 1) * 100;
  if (portfolio.length && portfolio[portfolio.length - 1].t >= nowT) portfolio[portfolio.length - 1].pct = current;
  else portfolio.push({ t: nowT, pct: current });
  const { spy, benchmark } = await spyAligned(ctx, baseDate, days);
  const endPct = portfolio[portfolio.length - 1].pct;
  const spyPct = spy.length ? spy[spy.length - 1].pct : null;
  const inceptionBase = state.account.startingCash;
  return { period, portfolio, spy, summary: { totalReturnPct: round2(endPct), spyReturnPct: spyPct == null ? null : round2(spyPct),
    vsSpyPct: spyPct == null ? null : round2(endPct - spyPct), baseValue: round2(base), equity: round2(equity),
    inceptionReturnPct: inceptionBase > 0 ? round2((equity / inceptionBase - 1) * 100) : null, inceptionBase: round2(inceptionBase), benchmark } };
}

module.exports = { nativeHost, paperBook, readerConnected, paperState, statusFields, screenRead, positionsOf, accountOf, realizedOf, dayOf, withSpyCloses };
