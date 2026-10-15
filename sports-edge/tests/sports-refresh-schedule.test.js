/**
 * Guards for where a refresh pass may run.
 *
 * The pass used to run from a setInterval the route factory started. On the native kernel a timer
 * callback is outside every admitted request, so its first query was refused ("Unbound application
 * request is unavailable in this native runtime"), lastError said so on GET /status, and nothing was
 * ever refreshed. The pass now runs only inside a request (POST /refresh/run), which the manifest's
 * `refresh-pass` schedule fires as the person who activated it. These guards fail if a timer comes
 * back at load or at factory time, or if the schedule stops pointing at the route that runs the pass.
 *
 * Plain node, no install: the framework aliases and express are stood in for at module load.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: no timer at module load or factory time, POST /refresh/run runs exactly one pass in the request and refuses an unauthenticated caller, and the manifest's refresh-pass schedule is a person-activated route call to that path.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | upcomingGames reads the scoreboard by month (ESPN answers every day range with HTTP 400 since 2026-10-11), merges months and keeps only the window.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | A month holding more than 100 NBA events: a stubbed scoreboard answers only its first 100 without a limit, and every in-window game must still be found. POST /refresh/run is bounded: a second call inside the interval answers not_due and reads nothing from ESPN (so no ratings rebuild), a non-operator cannot force a pass (403), an operator can, and the pass reads only the caller's followed teams.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');

/** Timers started while the package's modules load or its factory runs. */
const timers = [];
const realSetInterval = global.setInterval;
const realSetTimeout = global.setTimeout;

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
global.setInterval = (...args) => { timers.push('setInterval'); return realSetInterval(...args); };
global.setTimeout = (...args) => { timers.push('setTimeout'); return realSetTimeout(...args); };
let refresh;
let routes;
try {
  refresh = require('../routes/sports-refresh.js');
  routes = require('../routes/sports-routes.js');
} finally {
  global.setInterval = realSetInterval;
  global.setTimeout = realSetTimeout;
}

/** A pool that answers every query with no rows, recording the SQL it was asked to run. */
function emptyPool() {
  const sql = [];
  return { sql, query: async (text) => { sql.push(String(text)); return { rows: [], rowCount: 0 }; } };
}

/** The manifest's `schedules:` entry with this id, read as text (the job has no YAML parser installed). */
function manifestSchedule(id) {
  const text = fs.readFileSync(path.join(__dirname, '..', 'oshal-app.yaml'), 'utf8');
  const block = text.split(/\n(?=\S)/).find((part) => part.startsWith('schedules:'));
  assert.ok(block, 'the manifest declares schedules:');
  const entry = block.split(/\n  - /).find((part) => part.startsWith(`id: ${id}\n`));
  assert.ok(entry, `schedule ${id} is declared`);
  const field = (name) => { const m = new RegExp(`(?:^|\\n)\\s*${name}: *(.+)`).exec(entry); return m ? m[1].trim().replace(/^"|"$/g, '') : null; };
  return { runsAs: field('runsAs'), target: field('target'), route: field('route'), method: field('method'), cron: field('cron') };
}

test('loading the refresh and route modules starts no timer', () => {
  assert.deepEqual(timers, [], 'a module-level timer would run its pass outside any admitted request');
  assert.equal(typeof refresh.startSportsRefresh, 'undefined', 'the timer entry point is gone');
});

test('the route factory starts no timer and mounts POST /refresh/run', () => {
  global.setInterval = (...args) => { timers.push('setInterval'); return realSetInterval(...args); };
  global.setTimeout = (...args) => { timers.push('setTimeout'); return realSetTimeout(...args); };
  let router;
  try {
    router = routes.createSportsEdgeRoutes({ pool: emptyPool(), appPackageDir: path.join(__dirname, '..') });
  } finally {
    global.setInterval = realSetInterval;
    global.setTimeout = realSetTimeout;
  }
  assert.deepEqual(timers, []);
  assert.ok(router.routes.some((r) => r.method === 'post' && r.route === '/refresh/run'));
});

test('POST /refresh/run runs one pass inside the request and refuses an unauthenticated caller', async () => {
  const pool = emptyPool();
  const router = routes.createSportsEdgeRoutes({ pool, appPackageDir: path.join(__dirname, '..') });
  const handler = router.routes.find((r) => r.method === 'post' && r.route === '/refresh/run').handler;
  const answer = () => { const res = { code: 200, body: null }; res.status = (c) => { res.code = c; return res; }; res.json = (b) => { res.body = b; return res; }; return res; };

  const anonymous = answer();
  await handler({ oidc: null, body: {} }, anonymous);
  assert.equal(anonymous.code, 401);

  const saved = global.fetch;
  global.fetch = async () => { throw new Error('refused: test has no network'); };
  try {
    const res = answer();
    await handler({ oidc: { user: { sub: 'person-1' } }, body: {} }, res);
    assert.equal(res.code, 200, JSON.stringify(res.body));
    assert.equal(res.body.ran, true);
    assert.ok(pool.sql.some((q) => /sports_followed_teams/.test(q)), 'the pass read the caller\'s followed teams through the request pool');
    const status = refresh.refreshStatus();
    assert.ok(status.lastRun, 'the status panel sees the pass');
    assert.equal(status.schedule.route, '/api/sports-edge/refresh/run');
  } finally {
    global.fetch = saved;
  }
});

test('the manifest schedules the pass as a person-activated call to that route', () => {
  const schedule = manifestSchedule('refresh-pass');
  assert.equal(schedule.runsAs, 'user', 'each person\'s pass reads that person\'s own followed teams');
  assert.equal(schedule.target, 'service-route');
  assert.equal(schedule.method, 'POST');
  assert.equal(schedule.route, refresh.REFRESH_SCHEDULE.route);
  assert.match(schedule.cron, /^\S+ \S+ \S+ \S+ \S+$/);
});

test('upcoming games are read by MONTH: ESPN refuses a day range with HTTP 400', async () => {
  const asked = [];
  const now = Date.now();
  const at = (days) => new Date(now + days * 86400000).toISOString();
  const event = (id, date) => ({ id, date, name: id, competitions: [{ competitors: [
    { homeAway: 'home', team: { id: '1', abbreviation: 'KC' } }, { homeAway: 'away', team: { id: '2', abbreviation: 'LV' } }] }] });
  const fetchImpl = async (url) => {
    asked.push(url);
    const dates = new URL(url).searchParams.get('dates') || '';
    if (/^\d{8}-\d{8}$/.test(dates)) return { ok: false, status: 400, json: async () => ({ code: 400, message: 'Failed to get events endpoint.' }) };
    // Every month answers the same events; the merge must keep one of each and only those inside the window.
    return { ok: true, status: 200, json: async () => ({ events: [event('past', at(-3)), event('soon', at(2)), event('later', at(40))] }) };
  };
  const games = await refresh.upcomingGames('nfl', 21, { fetchImpl, attempts: 1 });
  assert.ok(asked.length >= 1 && asked.every((url) => /[?&]dates=\d{6}(&|$)/.test(url)), `month reads only: ${asked.join(' ')}`);
  assert.deepEqual(games.map((g) => g.eventId), ['soon']);
  assert.deepEqual(refresh.monthsCovering(new Date('2026-10-11T00:00:00Z'), new Date('2026-11-01T00:00:00Z')), ['202610', '202611']);
  assert.deepEqual(refresh.monthsCovering(new Date('2026-12-20T00:00:00Z'), new Date('2027-01-05T00:00:00Z')), ['202612', '202701']);
});

/**
 * A pool that keeps sports_settings in memory (the pass's interval stamp lives there) and answers
 * every other statement with no rows, recording each statement and its values.
 */
function settingsPool() {
  const settings = new Map();
  const sql = [];
  const query = async (text, values = []) => {
    sql.push({ text: String(text), values });
    if (/SELECT settings FROM sports_settings/.test(text)) {
      return { rows: settings.has(values[0]) ? [{ settings: settings.get(values[0]) }] : [], rowCount: 0 };
    }
    if (/INSERT INTO sports_settings/.test(text)) {
      const merged = { ...(settings.get(values[0]) || {}), ...JSON.parse(values[1]) };
      settings.set(values[0], merged);
      return { rows: [{ settings: merged }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  };
  return { sql, settings, query };
}

/** A response double that records the status and body. */
function answer() {
  const res = { code: 200, body: null };
  res.status = (c) => { res.code = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

test('NBA month reads ask for every event: a month holding more than 100 events is read whole', async () => {
  const now = Date.now();
  const fetchImpl = async (url) => {
    const params = new URL(url).searchParams;
    const month = params.get('dates');
    const y = Number(month.slice(0, 4)); const m = Number(month.slice(4, 6)) - 1;
    // 150 games spread over the month, earliest first, the way ESPN orders a month.
    const all = Array.from({ length: 150 }, (_, i) => ({
      id: `${month}-${i}`, date: new Date(Date.UTC(y, m, 1) + i * 4.4 * 3600000).toISOString(), name: `g${i}`,
      competitions: [{ competitors: [{ homeAway: 'home', team: { id: '1', abbreviation: 'BOS' } }, { homeAway: 'away', team: { id: '2', abbreviation: 'NY' } }] }],
    }));
    // ESPN's default page is 100 events; only an explicit limit returns the rest.
    const limit = Number(params.get('limit')) || 100;
    return { ok: true, status: 200, json: async () => ({ events: all.slice(0, limit) }) };
  };
  const games = await refresh.upcomingGames('nba', 30, { fetchImpl, attempts: 1 });
  const from = new Date(now); const to = new Date(now + 30 * 86400000);
  let expected = 0;
  for (const month of refresh.monthsCovering(from, to)) {
    const y = Number(month.slice(0, 4)); const m = Number(month.slice(4, 6)) - 1;
    for (let i = 0; i < 150; i += 1) {
      const t = Date.UTC(y, m, 1) + i * 4.4 * 3600000;
      if (t >= now - 6 * 3600000 && t <= to.getTime()) expected += 1;
    }
  }
  assert.ok(expected > 0);
  assert.equal(games.length, expected, 'every in-window game of the month, including those past the 100th event');
});

test('POST /refresh/run is bounded by the refresh interval and only an operator may force it', async () => {
  const pool = settingsPool();
  const router = routes.createSportsEdgeRoutes({ pool, appPackageDir: path.join(__dirname, '..') });
  const handler = router.routes.find((r) => r.method === 'post' && r.route === '/refresh/run').handler;
  const saved = global.fetch;
  let reads = 0;
  global.fetch = async () => { reads += 1; throw new Error('refused: test has no network'); };
  try {
    const first = answer();
    await handler({ oidc: { user: { sub: 'person-2' } }, body: {} }, first);
    assert.equal(first.code, 200, JSON.stringify(first.body));
    assert.equal(first.body.ran, true);
    const followed = pool.sql.filter((q) => /FROM sports_followed_teams/.test(q.text));
    assert.ok(followed.length >= 1);
    for (const q of followed) {
      assert.match(q.text, /WHERE user_sub = \$1/, 'the pass reads only the caller\'s followed teams');
      assert.deepEqual(q.values, ['person-2']);
    }

    reads = 0;
    const again = answer();
    await handler({ oidc: { user: { sub: 'person-2' } }, body: {} }, again);
    assert.equal(again.code, 200);
    assert.equal(again.body.ran, false);
    assert.equal(again.body.skipped, 'not_due');
    assert.ok(Date.parse(again.body.nextDueAt) > Date.now());
    assert.equal(reads, 0, 'a pass that is not due reads nothing from ESPN, so no ratings rebuild either');

    const forced = answer();
    await handler({ oidc: { user: { sub: 'person-2' } }, body: { force: true } }, forced);
    assert.equal(forced.code, 403, 'a non-operator cannot force a pass inside the interval');

    const operator = answer();
    await handler({ oidc: { user: { sub: 'person-2' } }, operator: true, body: { force: true } }, operator);
    assert.equal(operator.code, 200, JSON.stringify(operator.body));
    assert.equal(operator.body.ran, true);

    const other = answer();
    await handler({ oidc: { user: { sub: 'person-3' } }, body: {} }, other);
    assert.equal(other.body.ran, true, 'the interval is per person: another person\'s first pass is due');
  } finally {
    global.fetch = saved;
  }
});

test('the interval check: due with no stamp, not due inside the interval, due again just short of it', () => {
  const start = Date.parse('2026-10-11T03:17:00Z');
  assert.equal(refresh.nextDueAt(null, 180, start), null);
  assert.ok(refresh.nextDueAt('2026-10-11T03:17:00Z', 180, start + 60 * 60000));
  // The schedule fires every three hours; a fire a few seconds short of the interval is still due.
  assert.equal(refresh.nextDueAt('2026-10-11T03:17:05Z', 180, start + 180 * 60000), null);
});

test('GET /status reports the caller\'s stored last pass and the interval', async () => {
  const pool = settingsPool();
  pool.settings.set(refresh.passKey('person-4'), { lastPassAt: '2026-10-11T03:17:00.000Z' });
  const router = routes.createSportsEdgeRoutes({ pool, appPackageDir: path.join(__dirname, '..') });
  const handler = router.routes.find((r) => r.method === 'get' && r.route === '/status').handler;
  const res = answer();
  await handler({ oidc: { user: { sub: 'person-4' } } }, res);
  assert.equal(res.body.refresh.lastPassAt, '2026-10-11T03:17:00.000Z');
  assert.equal(res.body.refresh.intervalMinutes, 180);
});
