/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                     | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-10-12 06:30:00 | maintainer@emeraldcoastsystemsgroup.com    | K4 regression: GET /api/world/pulls answered 500 'read failed' on the first load after the kernel starts. The kernel journal shows the first world.pulls read run past the World archive's 1.6 s bound ('unavailable: World archive read timed out', duration_ms 1602) and the next ones answer in 404 ms and then ~50 ms. Drives the compiled route with a service double that fails the way the kernel's world port does: one cold timeout is retried and answered; two timeouts answer 503 archive_unavailable in plain words; any other failure keeps its 500 and is never retried.
 * 2026-10-13 09:00:00 | maintainer@emeraldcoastsystemsgroup.com    | Sweep 12: GET /sentiment answered 500 'read failed' on the same cold archive timeout (kernel journal 'World archive read timed out'); the /pulls retry was never applied to it. The compiled GET /sentiment is driven the same way: one cold timeout is retried and answered, two answer 503 archive_unavailable, any other failure keeps its 500 unretried.
 */

'use strict';

const assert = require('node:assert');
const Module = require('node:module');
const path = require('node:path');
const { test } = require('node:test');

const ROUTE_PATH = path.join(__dirname, '..', 'routes', 'world-routes.js');
const TIMEOUT = () => new Error('unavailable: World archive read timed out');
const STATS = { entity: 'world:ticker:aapl', days: 90, archivedItems: 12, bySource: [{ feedId: 'reuters', pulls: 3, fetched: 30, newItems: 12 }] };

/** Load the compiled routes with a pullStats double and return the GET /pulls handler. */
function pullsRoute(pullStats, logs, route = '/pulls') {
  const gets = {};
  const router = { get(p, ...handlers) { gets[p] = handlers[handlers.length - 1]; }, post() {}, patch() {}, delete() {}, use() {} };
  const originalLoad = Module._load;
  Module._load = function mockedLoad(request, parent, isMain) {
    if (request === 'express') return { Router: () => router };
    if (request === '@/shared/logger') return { createChildLogger: () => ({ info() {}, warn: (...a) => logs.push(['warn', ...a]), error: (...a) => logs.push(['error', ...a]), debug() {} }) };
    if (request === '@/features/world-data/world-intelligence-service') return { createWorldIntelligenceService: () => ({ pullStats, sentimentBreakdown: pullStats }) };
    if (request === '@/features/world-data/world-types') return { WorldContributionSchema: { safeParse: () => ({ success: false }) } };
    if (request === '@/features/world-data/outlet-ratings') return { buildOutletSeedContribution: () => ({}) };
    if (request === '@/features/world-data/news-fetcher') return { ingestFeeds: async () => ({}), backtest: async () => ({}) };
    if (request === './world-app-html') return { WORLD_APP_HTML: '<html></html>' };
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    delete require.cache[require.resolve(ROUTE_PATH)];
    require(ROUTE_PATH).createWorldRoutes();
  } finally {
    Module._load = originalLoad;
  }
  assert.ok(gets[route], `the compiled routes register GET ${route}`);
  return gets[route];
}

/** Call the handler and wait for its answer. */
function call(handler) {
  return new Promise((resolve) => {
    const res = { statusCode: 200, status(c) { this.statusCode = c; return this; }, json(body) { resolve({ status: this.statusCode, body }); return this; } };
    handler({ query: { entity: 'world:ticker:aapl', days: '90', surface: '1' }, headers: {}, header: () => undefined }, res);
  });
}

test('a first read that runs past the archive bound is retried once and answered', async () => {
  const logs = []; let reads = 0;
  const handler = pullsRoute(async () => { reads += 1; if (reads === 1) throw TIMEOUT(); return STATS; }, logs);
  const r = await call(handler);
  assert.equal(r.status, 200);
  assert.deepStrictEqual(r.body, STATS);
  assert.equal(reads, 2);
  assert.ok(logs.some((l) => l[0] === 'warn' && /cold read/.test(l[2])), 'the retry is logged');
});

test('an archive that still does not answer is a plain 503, not 500 read failed', async () => {
  const logs = []; let reads = 0;
  const handler = pullsRoute(async () => { reads += 1; throw TIMEOUT(); }, logs);
  const r = await call(handler);
  assert.equal(r.status, 503);
  assert.deepStrictEqual(r.body, { error: 'archive_unavailable', message: 'The World archive did not answer in time. Try again in a moment.' });
  assert.equal(reads, 2, 'retried exactly once');
  assert.ok(logs.some((l) => l[0] === 'error' && l[2] === 'world pulls read failed'));
});

test('any other failure keeps its 500 and is not retried', async () => {
  const logs = []; let reads = 0;
  const handler = pullsRoute(async () => { reads += 1; throw new Error('refused: world.pulls not granted'); }, logs);
  const r = await call(handler);
  assert.equal(r.status, 500);
  assert.deepStrictEqual(r.body, { error: 'read failed' });
  assert.equal(reads, 1);
});

test('GET /sentiment retries one cold archive timeout and answers (sweep 12)', async () => {
  const logs = []; let reads = 0;
  const BREAKDOWN = { naive: 0.1, bySource: [] };
  const handler = pullsRoute(async () => { reads += 1; if (reads === 1) throw TIMEOUT(); return BREAKDOWN; }, logs, '/sentiment');
  const r = await call(handler);
  assert.equal(r.status, 200);
  assert.deepStrictEqual(r.body, BREAKDOWN);
  assert.equal(reads, 2);
});

test('GET /sentiment says the archive did not answer after a second timeout, and keeps 500 for any other failure (sweep 12)', async () => {
  let reads = 0;
  const timedOut = await call(pullsRoute(async () => { reads += 1; throw TIMEOUT(); }, [], '/sentiment'));
  assert.equal(timedOut.status, 503);
  assert.equal(timedOut.body.error, 'archive_unavailable');
  assert.equal(reads, 2);
  reads = 0;
  const refused = await call(pullsRoute(async () => { reads += 1; throw new Error('refused: world.sentiment not granted'); }, [], '/sentiment'));
  assert.equal(refused.status, 500);
  assert.equal(reads, 1);
});
