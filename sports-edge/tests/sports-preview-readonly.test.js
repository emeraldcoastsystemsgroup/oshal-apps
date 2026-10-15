/**
 * Guards for where a game preview may be written.
 *
 * The native kernel admits a package GET as a READER and refuses any SQL write it makes ("SQL
 * mutation requires original writer admission"). GET /preview/:eventId used to build the preview on
 * a cache miss and store it (INSERT INTO sports_previews, then the registered calls), so every
 * preview a person opened answered 502 "could not build the preview" live on 2026-10-11. GET now only
 * reads what is stored; POST /preview/:eventId/build builds, stores and registers the calls.
 *
 * The pool here is a reader double: it refuses every write statement exactly the way the kernel
 * does, and the network is cut, so a GET that tries to build fails these guards.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: GET /preview never writes or reads ESPN (empty store -> built:false; stored row -> the row and its calls), POST /preview/:eventId/build is mounted and serves a stored preview, and the page reads with GET and builds with POST.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | The page keeps a wide table inside its card: live at 412px the Calls table measured 463px, the page scrolled sideways and the Rebuild button could not be tapped.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

/** A minimal Express Router stand-in that records what is mounted. */
function fakeRouter() {
  const routes = [];
  const add = (method) => (route, ...handlers) => { routes.push({ method, route, handler: handlers[handlers.length - 1] }); };
  return { routes, get: add('get'), post: add('post'), put: add('put'), patch: add('patch'), delete: add('delete'), use: add('use') };
}

const quiet = { debug() {}, info() {}, warn() {}, error() {} };
const STUBS = {
  '@/shared/logger': { createChildLogger: () => quiet },
  '@/features/world-data': { createWorldIntelligenceService: () => null, ingestFeeds: async () => ({ newItems: 0 }) },
  '@/app/routes/trading-routes-helpers': {
    callerSub: (req) => (req.oidc && req.oidc.user && req.oidc.user.sub) || null,
    servePage: () => () => {},
  },
  '@/shared/middleware/authz': { isOperator: (req) => Boolean(req && req.operator) },
  express: { Router: fakeRouter },
};
const load = Module._load;
Module._load = function stubbed(request, ...rest) {
  if (Object.prototype.hasOwnProperty.call(STUBS, request)) return STUBS[request];
  return load.call(this, request, ...rest);
};
const routes = require('../routes/sports-routes.js');

const WRITE = /^\s*(INSERT|UPDATE|DELETE|UPSERT|MERGE)\b|\bON CONFLICT\b/i;

/**
 * A pool that behaves like a reader admission: schema declarations and reads pass, every write is
 * refused with the kernel's own message. `stored` is the sports_previews row it holds, if any.
 */
function readerPool(stored) {
  const sql = [];
  const query = async (text, values = []) => {
    sql.push(String(text));
    if (WRITE.test(String(text))) throw new Error('refused: SQL mutation requires original writer admission');
    if (/FROM sports_previews/.test(text) && stored && values[0] === stored.eventId) {
      return { rows: [{ payload: stored, generated_at: '2026-10-11T10:00:00.000Z' }], rowCount: 1 };
    }
    if (/FROM sports_predictions/.test(text) && stored) {
      return { rows: [{ strategy: 'ensemble', market: 'spread', side: 'home', edge: 0.02 }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  };
  return { sql, query };
}

/** A response double that records the status and body. */
function answer() {
  const res = { code: 200, body: null };
  res.status = (c) => { res.code = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

function handler(router, method, route) {
  const found = router.routes.find((r) => r.method === method && r.route === route);
  assert.ok(found, `${method.toUpperCase()} ${route} is mounted`);
  return found.handler;
}

/** Run fn with the network cut, counting every attempted request. */
async function offline(fn) {
  const saved = global.fetch;
  const asked = [];
  global.fetch = async (url) => { asked.push(String(url)); throw new Error('refused: test has no network'); };
  try { await fn(); } finally { global.fetch = saved; }
  return asked;
}

const person = { oidc: { user: { sub: 'person-1' } } };
const dir = path.join(__dirname, '..');

test('GET /preview with nothing stored answers built:false without building, writing or calling ESPN', async () => {
  const pool = readerPool(null);
  const router = routes.createSportsEdgeRoutes({ pool, appPackageDir: dir });
  const res = answer();
  const asked = await offline(() => handler(router, 'get', '/preview/:eventId')(
    { ...person, params: { eventId: '401872990' }, query: { league: 'nfl' } }, res));
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(res.body.built, false);
  assert.deepEqual(asked, [], 'a GET never reads ESPN to build a preview');
  assert.ok(!pool.sql.some((q) => WRITE.test(q) && /sports_previews|sports_predictions/.test(q)), 'a GET never writes a preview');
});

test('GET /preview with a stored preview answers it and its calls, read-only', async () => {
  const stored = { eventId: '401872990', league: 'nfl', homeTeam: 'KC', awayTeam: 'LV', edges: [], line: {} };
  const pool = readerPool(stored);
  const router = routes.createSportsEdgeRoutes({ pool, appPackageDir: dir });
  const res = answer();
  await offline(() => handler(router, 'get', '/preview/:eventId')(
    { ...person, params: { eventId: '401872990' }, query: { league: 'nfl' } }, res));
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(res.body.built, true);
  assert.equal(res.body.preview.eventId, '401872990');
  assert.equal(res.body.calls.length, 1);
});

test('POST /preview/:eventId/build is mounted, refuses anonymous and an unknown league, and serves a stored preview', async () => {
  const stored = { eventId: '401872990', league: 'nfl', homeTeam: 'KC', awayTeam: 'LV', edges: [], line: {} };
  const router = routes.createSportsEdgeRoutes({ pool: readerPool(stored), appPackageDir: dir });
  const build = handler(router, 'post', '/preview/:eventId/build');
  const anonymous = answer();
  await build({ oidc: null, params: { eventId: '1' }, body: { league: 'nfl' }, query: {} }, anonymous);
  assert.equal(anonymous.code, 401);
  const badLeague = answer();
  await build({ ...person, params: { eventId: '1' }, body: { league: 'mlb' }, query: {} }, badLeague);
  assert.equal(badLeague.code, 400);
  const res = answer();
  await offline(() => build({ ...person, params: { eventId: '401872990' }, body: { league: 'nfl' }, query: {} }, res));
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(res.body.built, true);
  assert.equal(res.body.preview.homeTeam, 'KC');
});

test('the page reads with GET and builds or rebuilds with POST /build', () => {
  const page = fs.readFileSync(path.join(dir, 'tools', 'sports-edge.html'), 'utf8');
  assert.match(page, /'\/preview\/' \+ encodeURIComponent\(eventId\) \+ '\/build'/, 'the page posts the build');
  assert.match(page, /jbody\('POST', API \+ '\/preview\//, 'the build is a POST');
  assert.doesNotMatch(page, /refresh=1/, 'no GET asks for a rebuild');
  // At 412px the Calls table measured 463px and widened the whole page, so Rebuild could not be tapped.
  assert.match(page, /\.card \{ overflow-x: auto; \}/, 'a wide table scrolls inside its card, never the page');
});
