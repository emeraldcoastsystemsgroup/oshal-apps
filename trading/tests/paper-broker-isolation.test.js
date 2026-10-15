/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: the native paper engine cannot reach a broker (TRADE-01). Statically, no module under routes/paper/ nor routes/trading-paper-routes.js requires the platform's trading engine, a broker adapter, a network module or anything outside the package, and the only kernel intents it names are prices.latest and prices.series. At run time, a complete trading tick runs with fetch and every broker / network module trapped to throw, and still fills only by writing rows.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { createSqlDouble, createIntentDouble } = require('./support/paper-doubles');

const ROUTES = path.join(__dirname, '..', 'routes');
const ENGINE_FILES = [path.join(ROUTES, 'trading-paper-routes.js'),
  ...fs.readdirSync(path.join(ROUTES, 'paper')).map((f) => path.join(ROUTES, 'paper', f))];
/** Anything that could carry an order to a venue, or bytes off the box. */
const FORBIDDEN = /@\/features\/trading|@\/app\/trading|broker|alpaca|schwab|placeDecisionOrder|submitOrder|^https?$|^net$|^tls$|^node:(https?|net|tls|dgram|child_process)$|^(dgram|child_process)$|^undici$|^axios$/i;

test('no paper engine module requires a broker, the platform engine or a network module', () => {
  for (const file of ENGINE_FILES) {
    const src = fs.readFileSync(file, 'utf8');
    const required = [...src.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
    for (const name of required) {
      assert.ok(!FORBIDDEN.test(name), `${path.basename(file)} requires ${name}`);
      assert.ok(name.startsWith('./') || name.startsWith('../') || ['node:crypto', '@/shared/logger', 'express'].includes(name),
        `${path.basename(file)} requires ${name}, which is outside the package's allowed set`);
    }
    assert.doesNotMatch(src, /\bfetch\s*\(/, `${path.basename(file)} calls fetch`);
    assert.doesNotMatch(src, /getBrokerAdapter|getBrokerReader|placeDecisionOrder|submitOrder|createOrder/, `${path.basename(file)} names a broker call`);
  }
});

test('the only kernel intents the engine names are the two price reads', () => {
  const names = new Set();
  for (const file of ENGINE_FILES) {
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/intent\(\s*['"]([^'"]+)['"]/g)) names.add(m[1]);
  }
  assert.deepEqual([...names].sort(), ['prices.latest', 'prices.series']);
});

test('a full trading tick completes with every network and broker path trapped', async () => {
  const touched = [];
  const originalFetch = globalThis.fetch;
  const originalLoad = Module._load;
  globalThis.fetch = async (...args) => { touched.push(`fetch ${String(args[0])}`); throw new Error('network is forbidden in the paper engine'); };
  Module._load = function trap(request, ...rest) {
    if (FORBIDDEN.test(request)) { touched.push(`require ${request}`); throw new Error(`forbidden module ${request}`); }
    return originalLoad.call(this, request, ...rest);
  };
  try {
    for (const file of ENGINE_FILES) delete require.cache[file];
    const { paperHandlers } = require('../routes/trading-paper-routes');
    const sql = createSqlDouble();
    const now = new Date('2026-10-05T14:35:15Z');
    const prices = createIntentDouble({ UPCO: { price: 100, step: 0.005 } }, { now });
    const h = paperHandlers({ pool: sql.pool, intent: prices.intent }, () => now);
    await h.arm({ oshalCallerSub: 'iso-alice', body: { universe: ['UPCO'] }, headers: {} });
    const out = await h.tick({ oshalCallerSub: 'iso-alice', body: {}, headers: { 'x-oshal-trigger': 'schedule' } });
    assert.equal(out.status, 200, JSON.stringify(out.body));
    assert.equal(out.body.orders.length, 1);
    assert.equal(out.body.orders[0].status, 'filled');
    assert.equal(sql.db.orders.length, 1, 'the fill exists only as a row in the person\'s own book');
    assert.deepEqual([...new Set(prices.calls.map((c) => c.name))].sort(), ['prices.latest', 'prices.series']);
    assert.deepEqual(touched, []);
  } finally {
    globalThis.fetch = originalFetch;
    Module._load = originalLoad;
    for (const file of ENGINE_FILES) delete require.cache[file];
  }
});
