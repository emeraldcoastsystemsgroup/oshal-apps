/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: Intelligent Trades with no Schwab and no market-data connector (the native kernel, 2026-10-13: the landing said "$0 · No accounts yet - connect a Schwab login" while the person's paper book held $100,000, and every chart, the movers board and the watchlist's Today column were empty). Over the SHIPPED route files with the platform imports answered as the kernel bridge answers them: GET /accounts lists the native paper book and GET /summary carries its equity, day change and held names (or says it is not started); GET /api/trading-charts/bars draws the World archive's stored prices as a line per timeframe; the movers board ranks the archive's day closes and the watchlist carries their day change; the paper book's Allocation/Exits say it needs no broker. A host without the archive and a connected paper rail keep the existing answers. Red on the parent sources.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | The movers board names symbols from a stubbed SEC ticker table (no network), and keeps working with blank names when the directory read fails.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createSqlDouble, createIntentDouble } = require('./support/paper-doubles');
const { standIns, loadShipped, nativeLandingPool, worldArchive } = require('./support/native-landing-host');
const { paperHandlers } = require('../routes/trading-paper-routes');
const { etParts } = require('../routes/paper/market');

const NOW = new Date('2026-10-05T14:35:15Z');
const UNIVERSE = ['UPCO', 'DNCO', 'FLAT', 'SPY'];
const MARKET = { UPCO: { price: 100, step: 0.0004 }, DNCO: { price: 50, step: -0.0006 }, FLAT: { price: 20, step: 0.00001 }, SPY: { price: 600, step: 0.0001 } };

/**
 * @description Register the shipped accounts, book-read, research and chart routes on a recording router.
 * @param {object} ctx - Route context.
 * @param {{paperRail?:boolean}} [opts] - Whether the paper rail is connected.
 * @returns {{api:Map<string, Function>, charts:Map<string, Function>}} GET handlers by path.
 */
function shipped(ctx, opts = {}) {
  const recorder = () => { const routes = new Map(); return { routes, router: { get: (p, fn) => routes.set(p, fn), post() {}, patch() {}, delete() {}, use() {} } }; };
  const api = recorder(); const charts = recorder();
  const express = { Router: () => charts.router };
  loadShipped(standIns({ universe: UNIVERSE, paperRail: opts.paperRail, express }), (load) => {
    load('trading-accounts-routes.js').registerTradingAccountRoutes(api.router, ctx);
    load('trading-routes-book-read-builders.js').registerTradingBookReadRoutes(api.router, ctx, path.join(__dirname, '..', 'tools'));
    load('trading-research-routes.js').registerTradingResearchRoutes(api.router, ctx);
    load('trading-charts-routes.js').createTradingChartsRoutes(ctx);
  });
  return { api: api.routes, charts: charts.routes };
}

/**
 * @description Call one GET handler like the runner's simulated request.
 * @param {Map<string, Function>} routes - Handlers.
 * @param {string} p - Route path.
 * @param {string} sub - Caller.
 * @param {object} [query] - Query.
 * @returns {Promise<{code:number, body:object}>} The answer.
 */
async function call(routes, p, sub, query = {}) {
  const out = { code: 200, body: null };
  const res = { status(c) { out.code = c; return res; }, json(b) { out.body = b; return res; }, type() { return res; }, send(b) { out.body = b; return res; },
    setHeader() {} };
  await routes.get(p)({ oshalCallerSub: sub, userSub: sub, query, params: {}, headers: {}, body: {} }, res);
  return out;
}

/** Arm and tick one person's paper book at the synthetic market's prices; returns the bought quantity. */
async function armAndTick(sql, sub) {
  const prices = createIntentDouble({ UPCO: { price: 100, step: 0.005 } }, { now: NOW });
  const h = paperHandlers({ pool: sql.pool, intent: prices.intent }, () => NOW);
  await h.arm({ oshalCallerSub: sub, body: { universe: ['UPCO'] }, headers: {} });
  const ticked = await h.tick({ oshalCallerSub: sub, body: {}, headers: {} });
  return ticked.body.orders[0].qty;
}

test('the landing lists the native paper book with its balances, day change and holdings', async () => {
  const sql = createSqlDouble();
  const archive = worldArchive(MARKET, NOW);
  const { api } = shipped({ pool: nativeLandingPool(sql), intent: archive.intent });

  const roster0 = await call(api, '/accounts', 'land-alice');
  assert.equal(roster0.code, 200);
  assert.deepEqual(roster0.body.books.map((b) => [b.ref, b.kind, b.bookId, b.label, b.nativePaper]),
    [['paper', 'paper', null, 'Paper (reference book)', { opened: false, armed: false }]], 'the paper book is listed before it is started');
  const summary0 = await call(api, '/summary', 'land-alice');
  assert.equal(summary0.code, 200);
  assert.deepEqual([summary0.body.totalValue, summary0.body.accounts.length, summary0.body.accounts[0].notOpened], [0, 1, true]);
  assert.match(summary0.body.accounts[0].message, /Start paper autopilot/);
  assert.equal(summary0.body.accounts[0].equity, undefined, 'a book not started has no invented balances');

  const qty = await armAndTick(sql, 'land-alice');
  // The route measures the day against the real clock: today's snapshot is the tick's, the prior session closed at 99,000.
  const today = etParts(new Date()).date;
  for (const r of sql.db.equity) if (r.user_sub === 'land-alice') r.session_date = today;
  sql.db.equity.push({ user_sub: 'land-alice', session_date: '2000-01-03', equity: 99000, cash: 99000, recorded_at: '2000-01-03T21:00:00Z' });
  const roster = await call(api, '/accounts', 'land-alice');
  assert.deepEqual(roster.body.books[0].nativePaper, { opened: true, armed: true });
  const summary = await call(api, '/summary', 'land-alice');
  const row = summary.body.accounts[0];
  assert.deepEqual([row.ref, row.source, row.equity, row.cash, row.dayChange], ['paper', 'native-paper', 100000, 100000 - qty * 100, 1000]);
  assert.equal(summary.body.totalValue, 100000, 'the hero total counts the paper book');
  assert.equal(summary.body.totalDayChange, 1000);
  assert.deepEqual(summary.body.positionsRollup, [{ symbol: 'UPCO', qty, marketValue: qty * 100, perBook: [{ ref: 'paper', qty, marketValue: qty * 100 }] }]);

  const bob = await call(api, '/summary', 'land-bob');
  assert.deepEqual([bob.body.totalValue, bob.body.accounts[0].notOpened, bob.body.positionsRollup], [0, true, []], 'another person sees only their own book');
});

test('a host without the archive, or with a connected paper rail, keeps the existing roster and summary', async () => {
  const sql = createSqlDouble();
  await armAndTick(sql, 'keep-alice');
  for (const [ctx, opts] of [[{ pool: nativeLandingPool(sql) }, {}], [{ pool: nativeLandingPool(sql), intent: worldArchive(MARKET, NOW).intent }, { paperRail: true }]]) {
    const { api } = shipped(ctx, opts);
    const roster = await call(api, '/accounts', 'keep-alice');
    assert.deepEqual([roster.code, roster.body.books], [200, []]);
    const summary = await call(api, '/summary', 'keep-alice');
    assert.deepEqual([summary.body.totalValue, summary.body.accounts, summary.body.positionsRollup], [0, [], []]);
  }
});

test('chart bars draw the World archive as a line for every timeframe, never invented candles', async () => {
  const archive = worldArchive(MARKET, NOW);
  const { charts } = shipped({ pool: nativeLandingPool(createSqlDouble()), intent: archive.intent });
  for (const tf of ['5Min', '15Min', '1Hour', '1Day', '1Week']) {
    const r = await call(charts, '/bars', 'chart-alice', { symbol: 'UPCO', timeframe: tf });
    assert.equal(r.code, 200, `${tf} ${JSON.stringify(r.body)}`);
    assert.deepEqual([r.body.timeframe, r.body.bars, r.body.source], [tf, [], 'world-archive']);
    assert.ok(r.body.line.length > 1, `${tf} has a line`);
    assert.ok(r.body.line.every((p, i, all) => p.v > 0 && (i === 0 || p.t > all[i - 1].t)), `${tf} ascending, one point per time`);
    assert.equal(r.body.line[r.body.line.length - 1].v, 100, `${tf} ends at the latest stored price`);
    assert.match(r.body.note, /not live candles/);
  }
  const days = (await call(charts, '/bars', 'chart-alice', { symbol: 'UPCO', timeframe: '1Day' })).body.line;
  const weeks = (await call(charts, '/bars', 'chart-alice', { symbol: 'UPCO', timeframe: '1Week' })).body.line;
  assert.ok(weeks.length < days.length && weeks.length >= 5, 'a week is the last day of each week');
  assert.ok(days.every((p) => p.t % 86400 === 0), 'a day sits on its session date');
  const untracked = await call(charts, '/bars', 'chart-alice', { symbol: 'ZZZZ', timeframe: '1Day' });
  assert.deepEqual([untracked.code, untracked.body.error], [404, 'not_in_price_archive']);
  assert.match(untracked.body.message, /no stored prices for ZZZZ/);
  assert.equal((await call(charts, '/bars', '', { symbol: 'UPCO' })).code, 401);
  const { charts: noArchive } = shipped({ pool: nativeLandingPool(createSqlDouble()) });
  const refused = await call(noArchive, '/bars', 'chart-alice', { symbol: 'UPCO', timeframe: '1Day' });
  assert.deepEqual([refused.code, refused.body.error], [503, 'market_data_not_connected'], 'a host without the archive keeps the refusal');
  assert.ok(archive.calls.every((c) => c.name === 'prices.series' && c.input.symbols.length <= 50), 'only bounded price reads');
});

test('the movers board and the watchlist read the archive\'s stored day closes', async (t) => {
  const original = global.fetch;
  t.after(() => { global.fetch = original; });
  global.fetch = async (url) => {
    assert.match(String(url), /^https:\/\/www\.sec\.gov\/files\/company_tickers\.json$/);
    return { ok: true, status: 200, json: async () => ({ 0: { cik_str: 1, ticker: 'UPCO', title: 'Upward Company Inc' }, 1: { cik_str: 2, ticker: 'SPY', title: 'SPDR S&P 500 ETF Trust' } }) };
  };
  const archive = worldArchive(MARKET, NOW);
  const { api } = shipped({ pool: nativeLandingPool(createSqlDouble(), { 'mv-alice': ['UPCO', 'ZZZZ'] }), intent: archive.intent });
  const winners = await call(api, '/reports/movers', 'mv-alice', { kind: 'winners', limit: '3' });
  assert.equal(winners.code, 200, JSON.stringify(winners.body));
  assert.deepEqual(winners.body.rows.map((r) => r.symbol), ['UPCO', 'SPY', 'FLAT']);
  assert.match(winners.body.source, /World price archive/);
  assert.match(winners.body.note, /Not live quotes/);
  assert.ok(winners.body.rows.every((r) => r.price > 0 && Number.isFinite(r.changePct)));
  assert.equal(winners.body.rows.find((r) => r.symbol === 'UPCO').name, 'Upward Company Inc', 'named from the SEC directory');
  assert.equal(winners.body.rows.find((r) => r.symbol === 'FLAT').name, null, 'a ticker the directory does not list stays unnamed');
  const losers = await call(api, '/reports/movers', 'mv-alice', { kind: 'losers', limit: '1' });
  assert.deepEqual(losers.body.rows.map((r) => r.symbol), ['DNCO']);
  const volatile = await call(api, '/reports/movers', 'mv-alice', { kind: 'volatile', limit: '4' });
  assert.ok(volatile.body.rows.length > 0 && volatile.body.rows.every((r) => r.volatilityPct != null));

  const list = await call(api, '/watchlist', 'mv-alice');
  assert.equal(list.code, 200, JSON.stringify(list.body));
  const upco = list.body.items.find((i) => i.symbol === 'UPCO');
  assert.deepEqual([upco.quote.price, upco.quote.source], [100, 'world-archive']);
  assert.ok(upco.quote.dayChangePct > 0, 'Today is the latest stored price against the previous session');
  assert.equal(list.body.items.find((i) => i.symbol === 'ZZZZ').quote, null, 'an untracked ticker has no price and no change');
});

test('the paper book\'s Allocation and Exits say it needs no broker', async () => {
  const { api } = shipped({ pool: nativeLandingPool(createSqlDouble()), intent: worldArchive(MARKET, NOW).intent });
  const r = await call(api, '/exposure', 'exp-alice', { book: 'paper', mode: 'paper' });
  assert.deepEqual([r.code, r.body.error], [409, 'broker_not_configured']);
  assert.match(r.body.message, /paper book needs no broker/);
  assert.doesNotMatch(r.body.message, /Connect one in Settings/);
  const { api: legacy } = shipped({ pool: nativeLandingPool(createSqlDouble()) });
  assert.match((await call(legacy, '/exposure', 'exp-alice', { book: 'paper' })).body.message, /Connect one in Settings/, 'a host without the archive keeps the old words');
});

test('the movers board keeps working with blank names when the SEC directory cannot be read', async (t) => {
  const original = global.fetch;
  t.after(() => { global.fetch = original; });
  global.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
  const archive = worldArchive(MARKET, NOW);
  const { api } = shipped({ pool: nativeLandingPool(createSqlDouble(), { 'mv-bob': ['UPCO'] }), intent: archive.intent });
  const winners = await call(api, '/reports/movers', 'mv-bob', { kind: 'winners', limit: '3' });
  assert.equal(winners.code, 200, JSON.stringify(winners.body));
  assert.ok(winners.body.rows.length > 0 && winners.body.rows.every((r) => r.name === null));
});
