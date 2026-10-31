/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The browse and walkthrough routes over a stored snapshot: GET /markets lists every walked market still open with a verdict headline, filters by word, category and verdict, sorts by closes/edge/volume and bounds by limit; GET /markets/:ticker answers from the snapshot first, else reads the market live from Kalshi and prices it against the shipped calibration table, 404 when Kalshi has none, 503 when the runtime has no market reader; GET /scan no longer ships the browse rows but counts them; every route refuses an anonymous caller. The scan engine's runScan stores one browse row per walked market beside the hands.
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

const PKG = path.resolve(__dirname, '..');
const logger = { info() {}, warn() {}, error() {}, debug() {} };
const inert = new Proxy(function inertFramework() {}, {
  get: (_t, key) => (key === '__esModule' || key === 'then' || typeof key === 'symbol' ? undefined : inert), apply: () => inert, construct: () => inert,
});
function load(file, ports, loaded = new Map()) {
  const compiled = path.resolve(PKG, 'routes', file);
  if (loaded.has(compiled)) return loaded.get(compiled).exports;
  const subject = new Module(compiled, module);
  loaded.set(compiled, subject);
  subject.filename = compiled;
  subject.require = (request) => {
    if (Object.hasOwn(ports, request)) return ports[request];
    if (request.startsWith('@/')) return inert;
    if (request.startsWith('./')) return load(`${request.slice(2).replace(/\.js$/, '')}.js`, ports, loaded);
    return require(request);
  };
  subject._compile(fs.readFileSync(compiled, 'utf8'), compiled);
  return subject.exports;
}

const NOW = Date.now();
const soon = (h) => new Date(NOW + h * 3600000).toISOString();
function hand(ticker, over = {}) {
  return { ticker, eventTicker: ticker.split('-')[0], title: `Market ${ticker}`, category: 'Weather', closeTime: soon(6), side: 'yes', price: 0.4, marketProb: 0.4,
    trueProb: 0.47, calibrationN: 300, feePerContract: 0.017, edgeNet: 0.053, evPerContract: 0.053, kellyFraction: 0.1, stakeFraction: 0.01,
    confidence: 0.9, riskFlags: [], strength: 'strong', spread: 0.02, liquidity: 1000, volume: 500, ...over };
}
function row(ticker, over = {}) {
  return { ticker, eventTicker: ticker.split('-')[0], seriesTicker: ticker.split('-')[0], title: `Market ${ticker}`, category: 'Weather', closeTime: soon(6),
    yesBid: 0.38, yesAsk: 0.4, noBid: 0.58, noAsk: 0.6, lastPrice: 0.39, volume: 500, openInterest: 200, liquidity: 1000, hand: hand(ticker), notEvaluable: null, ...over };
}
const SNAPSHOT = {
  generatedAt: new Date(NOW - 600000).toISOString(), exchangeActive: true, calibrationGeneratedAt: '2026-07-13T05:39:26.578Z', calibrationFileMtime: null,
  openPaged: 4000, evaluable: 4, strategy: 'calibration', mayStake: false, gateReason: 'unproven', scorecard: [], scanMs: 1234,
  hands: [hand('KXA-1')],
  markets: [
    row('KXA-1'),
    row('KXB-2', { category: 'Politics', volume: 9000, closeTime: soon(30), hand: hand('KXB-2', { strength: 'fold', edgeNet: -0.03, stakeFraction: 0, side: 'no', price: 0.6, trueProb: 0.55, category: 'Politics' }) }),
    row('KXC-3', { category: 'Sports', closeTime: soon(1), hand: null, notEvaluable: 'it is a parlay leg (a multivariate market), which the evaluator never prices' }),
    row('KXD-4', { closeTime: new Date(NOW - 60000).toISOString() }),
  ],
};
function snapshotPool() {
  return { query: async (text) => (/FROM kalshi_scan_snapshots/.test(String(text)) ? { rows: [{ payload: SNAPSHOT, generated_at: SNAPSHOT.generatedAt }], rowCount: 1 } : { rows: [], rowCount: 0 }) };
}
function routerOf() {
  const routes = {};
  const router = new Proxy({}, { get: (_t, verb) => (verb === 'use' ? () => {} : (p, ...handlers) => { routes[`${String(verb).toUpperCase()} ${p}`] = handlers[handlers.length - 1]; }) });
  return { routes, router };
}
function reply() {
  const r = { code: 200, body: null };
  r.status = (c) => { r.code = c; return r; }; r.json = (b) => { r.body = b; return r; }; r.set = () => r;
  return r;
}
function build(predictionMarkets = {}, pool = snapshotPool()) {
  const { routes, router } = routerOf();
  const kalshi = load('kalshi-routes.js', {
    express: { Router: () => router },
    '@/shared/logger': { createChildLogger: () => logger },
    '@/features/prediction-markets': predictionMarkets,
    '@/app/routes/connectors-routes': { getValidAccessToken: async () => null },
    '@/app/routes/trading-routes-helpers': { callerSub: (req) => (req.oidc && req.oidc.user && req.oidc.user.sub) || null, servePage: () => () => {} },
    '@/shared/middleware/authz': { isOperator: () => false },
    '@/app/routes/jarvis-task-store': {}, '@/app/routes/notify-routes': {},
  });
  kalshi.createKalshiRoutes({ pool, appPackageDir: PKG });
  return routes;
}
const person = (query = {}, params = {}) => ({ oidc: { user: { sub: 'person-1' } }, query, params });

test('GET /markets lists every open walked market with a verdict headline, and counts what closed', async () => {
  const routes = build();
  const res = reply();
  await routes['GET /markets'](person(), res);
  assert.equal(res.code, 200);
  assert.equal(res.body.total, 3, 'the market that closed since the scan is not listed');
  assert.equal(res.body.closedSinceScan, 1);
  assert.deepEqual(res.body.counts, { playable: 1, fold: 1, notEvaluable: 1 });
  assert.deepEqual(res.body.categories, ['Politics', 'Sports', 'Weather']);
  assert.deepEqual(res.body.markets.map((m) => m.ticker), ['KXA-1', 'KXB-2', 'KXC-3'], 'priced markets first by default, strongest on top, the unpriced last');
  const byClose = reply(); await routes['GET /markets'](person({ sort: 'closes' }), byClose);
  assert.deepEqual(byClose.body.markets.map((m) => m.ticker), ['KXC-3', 'KXA-1', 'KXB-2'], 'closing soonest on request');
  const a = res.body.markets.find((m) => m.ticker === 'KXA-1');
  assert.equal(a.verdict, 'strong'); assert.equal(a.side, 'yes');
  assert.match(a.headline, /^Strong: YES at 40\.0¢ .* \(paper only\)\.$/);
  assert.match(res.body.markets.find((m) => m.ticker === 'KXC-3').headline, /^No verdict: it is a parlay leg/);
});

test('GET /markets filters by word, category and verdict, sorts by edge or volume, and bounds by limit', async () => {
  const routes = build();
  let res = reply(); await routes['GET /markets'](person({ q: 'kxb' }), res);
  assert.deepEqual(res.body.markets.map((m) => m.ticker), ['KXB-2']);
  res = reply(); await routes['GET /markets'](person({ category: 'Weather' }), res);
  assert.deepEqual(res.body.markets.map((m) => m.ticker), ['KXA-1']);
  res = reply(); await routes['GET /markets'](person({ verdict: 'fold' }), res);
  assert.deepEqual(res.body.markets.map((m) => m.ticker), ['KXB-2']);
  res = reply(); await routes['GET /markets'](person({ verdict: 'playable' }), res);
  assert.deepEqual(res.body.markets.map((m) => m.ticker), ['KXA-1']);
  res = reply(); await routes['GET /markets'](person({ verdict: 'not-evaluable' }), res);
  assert.deepEqual(res.body.markets.map((m) => m.ticker), ['KXC-3']);
  res = reply(); await routes['GET /markets'](person({ sort: 'edge' }), res);
  assert.deepEqual(res.body.markets.map((m) => m.ticker), ['KXA-1', 'KXB-2', 'KXC-3']);
  res = reply(); await routes['GET /markets'](person({ sort: 'volume', limit: '1' }), res);
  assert.deepEqual(res.body.markets.map((m) => m.ticker), ['KXB-2']);
  assert.equal(res.body.matched, 3); assert.equal(res.body.shown, 1);
});

test('a snapshot written before 1.7.0 says the next scan fills the browse rows', async () => {
  const { markets, ...old } = SNAPSHOT;
  const pool = { query: async (text) => (/FROM kalshi_scan_snapshots/.test(String(text)) ? { rows: [{ payload: old, generated_at: old.generatedAt }], rowCount: 1 } : { rows: [], rowCount: 0 }) };
  const routes = build({}, pool);
  const res = reply(); await routes['GET /markets'](person(), res);
  assert.equal(res.code, 200);
  assert.equal(res.body.needsRescan, true);
  assert.equal(res.body.total, 0);
  assert.equal(res.body.awaitingFirstScan, false);
});

test('GET /markets/:ticker answers from the snapshot with the full walkthrough', async () => {
  const routes = build();
  const res = reply();
  await routes['GET /markets/:ticker'](person({}, { ticker: 'kxb-2' }), res);
  assert.equal(res.code, 200);
  assert.equal(res.body.source, 'snapshot');
  assert.equal(res.body.market.ticker, 'KXB-2');
  assert.equal(res.body.why.verdict, 'fold');
  assert.match(res.body.why.headline, /^Fold: NO at 60\.0¢ against a 55% calibrated chance is −3\.0¢/);
  assert.ok(res.body.why.reasons.length >= 6);
  assert.match(res.body.why.question, /why is NO at 60\.0¢ a bad bet\?$/);
});

test('GET /markets/:ticker reads a market the scan did not walk live and prices it against the shipped table', async () => {
  const calls = [];
  const live = {
    kalshiGet: async (p) => { calls.push(p); if (p.includes('NONE')) throw new Error('kalshi GET /markets/NONE 404 {"error":"not found"}'); return { market: { ticker: 'KXLIVE-9', event_ticker: 'KXLIVE-9A', title: 'Live market', yes_bid: 30, yes_ask: 33, no_bid: 66, no_ask: 70, volume: 100, liquidity: 60000, open_interest: 40, close_time: soon(5), status: 'open' } }; },
    normalizeMarket: (m) => ({ ticker: m.ticker, eventTicker: m.event_ticker, seriesTicker: 'KXLIVE', title: m.title, status: 'open', result: '', yesBid: m.yes_bid / 100, yesAsk: m.yes_ask / 100, noBid: m.no_bid / 100, noAsk: m.no_ask / 100, lastPrice: 0.31, volume: m.volume, liquidity: m.liquidity / 100, openInterest: m.open_interest, openTime: null, closeTime: new Date(m.close_time), isMultivariate: false }),
    getSeriesMeta: async () => ({ ticker: 'KXLIVE', category: 'Economics', feeType: 'quadratic', feeMultiplier: 1, frequency: '' }),
    evaluateMarket: (m, series) => hand(m.ticker, { category: series.category, side: 'no', price: m.noAsk, trueProb: 0.6, edgeNet: -0.1, stakeFraction: 0, strength: 'fold' }),
  };
  const routes = build(live);
  let res = reply(); await routes['GET /markets/:ticker'](person({}, { ticker: 'KXLIVE-9' }), res);
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(res.body.source, 'live');
  assert.deepEqual(calls, ['/markets/KXLIVE-9']);
  assert.equal(res.body.market.category, 'Economics');
  assert.equal(res.body.why.verdict, 'fold');
  assert.match(res.body.why.reasons.join('\n'), /calibration table generated 2026-07-13/);
  res = reply(); await routes['GET /markets/:ticker'](person({}, { ticker: 'NONE-1' }), res);
  assert.equal(res.code, 404); assert.match(res.body.error, /no market NONE-1/);
  res = reply(); await routes['GET /markets/:ticker'](person({}, { ticker: 'bad ticker!' }), res);
  assert.equal(res.code, 400);
  const noReader = build({});
  res = reply(); await noReader['GET /markets/:ticker'](person({}, { ticker: 'KXLIVE-9' }), res);
  assert.equal(res.code, 503); assert.match(res.body.error, /no Kalshi market reader/);
});

test('GET /scan no longer ships the browse rows but says how many were scanned; anonymous callers are refused', async () => {
  const routes = build();
  let res = reply(); await routes['GET /scan']({ ...person(), query: {} }, res);
  assert.equal(res.code, 200);
  assert.equal(res.body.markets, undefined);
  assert.equal(res.body.marketsScanned, 4);
  assert.equal(res.body.hands.length, 1);
  for (const key of ['GET /markets', 'GET /markets/:ticker', 'GET /scan']) {
    res = reply(); await routes[key]({ oidc: null, query: {}, params: { ticker: 'KXA-1' } }, res);
    assert.equal(res.code, 401, key);
  }
});

test('runScan stores one browse row per walked market beside the hands', async () => {
  const markets = [
    { ticker: 'KXA-1', eventTicker: 'KXA', seriesTicker: 'KXA', title: 'A', status: 'open', result: '', yesBid: 0.38, yesAsk: 0.4, noBid: 0.58, noAsk: 0.6, lastPrice: 0.39, volume: 500, liquidity: 1000, openInterest: 200, openTime: null, closeTime: new Date(NOW + 6 * 3600000), isMultivariate: false },
    { ticker: 'KXP-1', eventTicker: 'KXP', seriesTicker: 'KXP', title: 'Parlay', status: 'open', result: '', yesBid: 0.1, yesAsk: 0.2, noBid: 0.7, noAsk: 0.8, lastPrice: 0.1, volume: 5, liquidity: 10, openInterest: 1, openTime: null, closeTime: new Date(NOW + 6 * 3600000), isMultivariate: true },
  ];
  const engine = load('kalshi-scan-engine.js', {
    '@/shared/logger': { createChildLogger: () => logger },
    '@/features/prediction-markets': {
      exchangeTradingActive: async () => true,
      listMarketsFiltered: async () => ({ markets, paged: 2 }),
      getSeriesMeta: async (t) => ({ ticker: t, category: 'Weather', feeType: 'quadratic', feeMultiplier: 1, frequency: '' }),
      rankHands: () => [hand('KXA-1')],
      evaluateMarket: (m) => (m.ticker === 'KXA-1' ? hand('KXA-1') : null),
      mayStrategyStake: async () => ({ mayStake: false, reason: 'unproven' }),
      getScorecard: async () => [],
    },
  });
  const pool = { query: async () => ({ rows: [], rowCount: 0 }) };
  const payload = await engine.runScan(pool, { scanMaxMarketsKept: 10, scanMaxMarketsPaged: 10 }, PKG);
  assert.equal(payload.hands.length, 1);
  assert.deepEqual(payload.markets.map((m) => [m.ticker, m.hand ? m.hand.strength : null, m.notEvaluable]),
    [['KXA-1', 'strong', null], ['KXP-1', null, 'it is a parlay leg (a multivariate market), which the evaluator never prices']]);
  assert.equal(payload.markets[0].closeTime, markets[0].closeTime.toISOString());
});
