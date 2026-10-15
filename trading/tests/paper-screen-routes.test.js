/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: the package's SHIPPED screen routes (routes/trading-routes-book-read-builders.js and routes/trading-routes-order-flow-builders.js, the files the kernel loads) answer GET /status, /account, /positions, /performance, /ledger, /orders, /journal and /realized from the person's native paper book once they have one, and keep their existing answers (409 broker_not_configured, an empty ledger) for a person without one and for a host without kernel prices (TRADE-01). The platform imports those files name are replaced by small local stand-ins shaped like the native kernel's bridge (a broker reader with no configured() probe, an unresolved book); nothing outside this package is loaded.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const Module = require('node:module');
const { createSqlDouble, createIntentDouble } = require('./support/paper-doubles');
const { paperHandlers } = require('../routes/trading-paper-routes');

const NOW = new Date('2026-10-05T14:35:15Z');
const silent = { info() {}, warn() {}, error() {}, debug() {}, child() { return silent; } };
/** Stand-ins for the platform modules the compiled builders import, shaped like the native bridge's answers. */
const STAND_INS = {
  '@/shared/logger': { createChildLogger: () => silent },
  '@/app/routes/trading-routes-helpers': { callerSub: (req) => req.oshalCallerSub || null, resolveBook: async () => 'default', resolveMode: () => 'paper',
    guardrails: () => ({}), servePage: () => () => undefined, TradingError: class TradingError extends Error {} },
  '@/features/trading': { getBrokerReader: () => ({ getPositions: async () => [], getAccount: async () => ({}) }), liveTradingEnabled: () => false,
    getMarketData: () => ({}) },
  '@/app/trading-schema': { ensureTradingSchema: async () => undefined },
};
const standIn = (request) => new Proxy(STAND_INS[request] || {}, {
  get: (target, key) => (key in target ? target[key] : key === '__esModule' ? true : () => undefined),
});

/**
 * @description Load the shipped builders with the platform imports stood in, and collect their GET handlers.
 * @param {object} ctx - Route context.
 * @returns {Map<string, Function>} Path → handler.
 */
function shippedRoutes(ctx) {
  const original = Module._load;
  Module._load = function load(request, ...rest) {
    return request.startsWith('@/') ? standIn(request) : original.call(this, request, ...rest);
  };
  try {
    const dir = path.join(__dirname, '..', 'routes');
    for (const key of Object.keys(require.cache)) if (key.startsWith(dir)) delete require.cache[key];
    const reads = require('../routes/trading-routes-book-read-builders');
    const flow = require('../routes/trading-routes-order-flow-builders');
    const routes = new Map();
    const router = { get: (p, fn) => routes.set(p, fn), post() {}, patch() {}, delete() {}, use() {} };
    reads.registerTradingBookReadRoutes(router, ctx, __dirname);
    flow.registerTradingOrderFlowRoutes(router, ctx, async () => { throw new Error('no order placement in a read test'); });
    return routes;
  } finally {
    Module._load = original;
  }
}

/**
 * @description A pool over the SQL double that answers the legacy trading tables (undeclared on the native host) with no rows.
 * @param {object} sql - SQL double.
 * @returns {object} Pool.
 */
function nativePool(sql) {
  const legacy = (text) => /oshal_trading_/.test(String(text));
  return { query: (text, values) => (legacy(text) ? Promise.resolve({ rows: [{}], rowCount: 0 }) : sql.pool.query(text, values)), connect: () => sql.pool.connect() };
}

/**
 * @description Call one route handler like the runner's simulated request does.
 * @param {Map<string, Function>} routes - Routes.
 * @param {string} p - Path.
 * @param {string} sub - Caller.
 * @param {object} [query] - Query.
 * @returns {Promise<{code:number, body:object}>} The answer.
 */
async function call(routes, p, sub, query = {}) {
  const out = { code: 200, body: null };
  const res = { status(c) { out.code = c; return res; }, json(b) { out.body = b; return res; } };
  await routes.get(p)({ oshalCallerSub: sub, query, headers: {}, body: {} }, res);
  return out;
}

test('the shipped screen routes answer from the native paper book once the person has one', async () => {
  const sql = createSqlDouble();
  const prices = createIntentDouble({ UPCO: { price: 100, step: 0.005 }, SPY: { price: 600, step: 0.001 } }, { now: NOW });
  const ctx = { pool: nativePool(sql), intent: prices.intent };
  const routes = shippedRoutes(ctx);

  const before = await call(routes, '/account', 'screen-alice');
  assert.deepEqual([before.code, before.body.error], [409, 'broker_not_configured'], 'no paper account yet: the existing answer stands');
  const status0 = await call(routes, '/status', 'screen-alice');
  assert.deepEqual([status0.body.bookConfigured, status0.body.nativePaper.available, status0.body.nativePaper.opened], [false, true, false]);

  const h = paperHandlers({ pool: sql.pool, intent: prices.intent }, () => NOW);
  await h.arm({ oshalCallerSub: 'screen-alice', body: { universe: ['UPCO'] }, headers: {} });
  const ticked = await h.tick({ oshalCallerSub: 'screen-alice', body: {}, headers: {} });
  const qty = ticked.body.orders[0].qty;

  const status = await call(routes, '/status', 'screen-alice');
  assert.deepEqual([status.code, status.body.bookConfigured, status.body.bookEnabled, status.body.mode], [200, true, true, 'paper']);
  const account = await call(routes, '/account', 'screen-alice');
  assert.deepEqual([account.code, account.body.source, account.body.account.cash], [200, 'native-paper', 100000 - qty * 100]);
  const positions = await call(routes, '/positions', 'screen-alice');
  assert.deepEqual(positions.body.positions.map((p) => [p.symbol, p.qty]), [['UPCO', qty]]);
  const ledger = await call(routes, '/ledger', 'screen-alice');
  assert.deepEqual([ledger.code, ledger.body.configured, ledger.body.orders.length], [200, true, 1]);
  const orders = await call(routes, '/orders', 'screen-alice');
  assert.equal(orders.body.orders[0].filled_avg_price, 100);
  const journal = await call(routes, '/journal', 'screen-alice');
  assert.match(journal.body.trades[0].rationale, /MTF score/);
  const perf = await call(routes, '/performance', 'screen-alice', { period: '1W' });
  assert.deepEqual([perf.code, perf.body.period, perf.body.source], [200, '1W', 'native-paper']);
  const realized = await call(routes, '/realized', 'screen-alice');
  assert.deepEqual([realized.code, realized.body.source], [200, 'native-paper']);

  const bob = await call(routes, '/account', 'screen-bob');
  assert.deepEqual([bob.code, bob.body.error], [409, 'broker_not_configured'], 'another person keeps the existing answer');
  const bobLedger = await call(routes, '/ledger', 'screen-bob');
  assert.deepEqual([bobLedger.body.configured, bobLedger.body.positions.length], [false, 0]);
});

test('a host without the kernel price intents keeps every existing answer', async () => {
  const sql = createSqlDouble();
  const prices = createIntentDouble({ UPCO: { price: 100, step: 0.005 } }, { now: NOW });
  const h = paperHandlers({ pool: sql.pool, intent: prices.intent }, () => NOW);
  await h.arm({ oshalCallerSub: 'legacy-alice', body: { universe: ['UPCO'] }, headers: {} });
  await h.tick({ oshalCallerSub: 'legacy-alice', body: {}, headers: {} });
  const routes = shippedRoutes({ pool: nativePool(sql) });
  assert.equal((await call(routes, '/account', 'legacy-alice')).code, 409);
  assert.equal((await call(routes, '/positions', 'legacy-alice')).code, 409);
  const status = await call(routes, '/status', 'legacy-alice');
  assert.deepEqual([status.body.bookConfigured, status.body.nativePaper], [false, undefined]);
});
