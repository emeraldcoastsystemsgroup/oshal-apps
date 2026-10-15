/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: the trading bots' specialist facts carry the native paper book. The SHIPPED routes/trading-book-facts.js, with the legacy book store stood in as the native bridge answers it (no listed books), reports paper.present true, today's recorded equity and books.paper 1 once the person's native paper book has ticked, keeps paper.present false for a person without one, and never reads another person's book. Red on the previous source, which reported paper.present false while the native book held its cash.
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
const STAND_INS = {
  '@/shared/logger': { createChildLogger: () => silent },
  '@/app/trading-books-store': { listBooks: async () => [] },
  '@/app/trading-daily-equity-store': { loadDailyEquitySeries: async () => [] },
};
const standIn = (request) => new Proxy(STAND_INS[request] || {}, {
  get: (target, key) => (key in target ? target[key] : key === '__esModule' ? true : () => undefined),
});

/** Load the shipped facts reader with the platform imports stood in. */
function shippedFacts() {
  const original = Module._load;
  Module._load = function load(request, ...rest) {
    return request.startsWith('@/') ? standIn(request) : original.call(this, request, ...rest);
  };
  try {
    const dir = path.join(__dirname, '..', 'routes');
    for (const key of Object.keys(require.cache)) if (key.startsWith(dir)) delete require.cache[key];
    return require('../routes/trading-book-facts');
  } finally {
    Module._load = original;
  }
}

test('the paper slot carries the person\'s native paper book, and only theirs', async () => {
  const sql = createSqlDouble();
  const prices = createIntentDouble({ UPCO: { price: 100, step: 0.005 } }, { now: NOW });
  const h = paperHandlers({ pool: sql.pool, intent: prices.intent }, () => NOW);
  await h.arm({ oshalCallerSub: 'facts-alice', body: { universe: ['UPCO'] }, headers: {} });
  await h.tick({ oshalCallerSub: 'facts-alice', body: {}, headers: {} });
  const { readTradingBookFacts, TRADING_FACT_KEYS } = shippedFacts();
  const ctx = { pool: sql.pool, intent: prices.intent };

  const alice = await readTradingBookFacts(ctx, { sub: 'facts-alice' }, { now: () => NOW.getTime() });
  assert.deepEqual(Object.keys(alice).sort(), [...TRADING_FACT_KEYS].sort(), 'the declared key set is unchanged');
  assert.equal(alice['paper.present'], true);
  assert.equal(alice['books.paper'], 1);
  assert.equal(alice['paper.equity_recorded_today'], true);
  assert.ok(alice['paper.equity_today'] > 0, 'today\'s recorded equity, not null');
  assert.equal(alice['paper.realized_today_trades'], 0);

  const bob = await readTradingBookFacts(ctx, { sub: 'facts-bob' }, { now: () => NOW.getTime() });
  assert.deepEqual([bob['paper.present'], bob['books.paper'], bob['paper.equity_today']], [false, 0, null], 'no book: absent, never another person\'s');

  const legacy = await readTradingBookFacts({ pool: sql.pool }, { sub: 'facts-alice' }, { now: () => NOW.getTime() });
  assert.equal(legacy['paper.present'], false, 'a host without the native paper engine keeps the legacy answer');
});
