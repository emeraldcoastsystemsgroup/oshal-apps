/**
 * Guards for where and whether the background scan runs.
 *
 * Live on the native kernel (2026-10-11) the Kalshi surface said "last error: SQL connection requires an
 * active admitted request": the scan ran from a one-minute setInterval the route factory started, outside
 * every request. After that it would have said "calibration table missing — run
 * scripts/oshal-kalshi-calibration.ts", because the table was read from <cwd>/config-seed, which the native
 * runtime does not have, and the script it names is not there either. These guards fail if a timer comes
 * back, if the schedule stops pointing at the request-bound tick, or if a scan that cannot run here stops
 * saying why before it touches SQL.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Initial: no timer at load or factory time; the manifest's background-scan schedule is a person-activated POST to /api/kalshi/scan/tick, which the router mounts; with the native runtime's prediction-markets shape (no market reader) the tick answers 503 kalshi_scan_unavailable naming the missing reader and sends no SQL; the calibration table is read from the package's data directory first and a missing one names where it was looked for.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The page tells the person whether the scan will run: GET /scan names the background-scan schedule, and the page's scanJobState says the scan cannot run here (no cadence), is off until the person turns on the job's offer on the Jobs screen, is on, or is unknown when the host lists no jobs. The ~30s first-walk promise is gone from the page.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | The package ships its calibration table (generatedAt 2026-07-13, all three horizons, a provenance block) and a scan may run against it; a missing table's reason, which the page prints as the gate reason, names no file path; before the first scan GET /scan carries the table's generatedAt; the page says the table's age in days. Live on 2026-10-11 the banner read "no kalshi-calibration.json at /package/data/kalshi-calibration.json or /package/config-seed/..." and the scan never ran.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const PKG = path.resolve(__dirname, '..');
const quiet = { debug() {}, info() {}, warn() {}, error() {} };
const timers = [];
const real = { setInterval: global.setInterval, setTimeout: global.setTimeout };

/** The native runtime's prediction-markets module: exchange state and order refusals, no market reader. */
const NATIVE_PREDICTION_MARKETS = {
  exchangeTradingActive: async () => null, kalshiLiveOrdersEnabled: () => false, parseKalshiSecret: () => null,
  validateOrderRequest: () => null, getScorecard: async () => ({}), getCandles: async () => { throw new Error('unavailable'); },
};

/** Router stand-in recording every mount. */
function fakeRouter() {
  const routes = [];
  const add = (method) => (route, ...handlers) => { routes.push({ method, route, handler: handlers[handlers.length - 1] }); };
  return { routes, get: add('get'), post: add('post'), put: add('put'), delete: add('delete'), patch: add('patch'), use: add('use') };
}

/**
 * @description Load the compiled routes and their compiled siblings fresh, with the framework aliases stood in.
 * @param {object} predictionMarkets - The prediction-markets module the runtime provides.
 * @returns {{routes: object, cron: object, engine: object}} The loaded modules.
 */
function loadPackage(predictionMarkets) {
  const stubs = {
    '@/shared/logger': { createChildLogger: () => quiet },
    '@/features/prediction-markets': predictionMarkets,
    '@/app/routes/connectors-routes': { getValidAccessToken: async () => null },
    '@/app/routes/trading-routes-helpers': { callerSub: (req) => (req.oidc && req.oidc.user && req.oidc.user.sub) || null, servePage: () => () => {} },
    '@/shared/middleware/authz': { isOperator: () => false },
    '@/app/routes/jarvis-task-store': { saveTaskPending: async () => false, finishTask: async () => {} },
    '@/app/routes/notify-routes': { buildNotificationRouter: () => ({ notify: async () => ({ delivered: false }) }) },
    express: { Router: fakeRouter },
  };
  for (const key of Object.keys(require.cache)) if (key.startsWith(path.join(PKG, 'routes'))) delete require.cache[key];
  const load = Module._load;
  Module._load = function stubbed(request, ...rest) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    if (request.startsWith('@/')) return {};
    return load.call(this, request, ...rest);
  };
  global.setInterval = (...args) => { timers.push('setInterval'); return real.setInterval(...args); };
  global.setTimeout = (...args) => { timers.push('setTimeout'); return real.setTimeout(...args); };
  try {
    const routes = require('../routes/kalshi-routes.js');
    return { routes, cron: require('../routes/kalshi-scan-cron.js'), engine: require('../routes/kalshi-scan-engine.js') };
  } finally {
    Module._load = load;
    global.setInterval = real.setInterval;
    global.setTimeout = real.setTimeout;
  }
}

/** A pool that records every statement and answers no rows. */
function recordingPool() {
  const sql = [];
  return { sql, query: async (text) => { sql.push(String(text)); return { rows: [], rowCount: 0 }; }, connect: async () => { sql.push('CONNECT'); throw new Error('no client'); } };
}

/** A response recorder. */
function reply() {
  const r = { code: 200, body: null, headers: {} };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  r.set = (k, v) => { r.headers[k] = v; return r; };
  return r;
}

/** The manifest's `schedules:` entry with this id, read as text (this suite installs no YAML parser). */
function manifestSchedule(id) {
  const text = fs.readFileSync(path.join(PKG, 'oshal-app.yaml'), 'utf8');
  const block = text.split(/\n(?=\S)/).find((part) => part.startsWith('schedules:'));
  assert.ok(block, 'the manifest declares schedules:');
  const entry = block.split(/\n  - /).find((part) => part.startsWith(`id: ${id}\n`));
  assert.ok(entry, `schedule ${id} is declared`);
  const field = (name) => { const m = new RegExp(`\\n\\s*${name}: *(.+)`).exec(entry); return m ? m[1].trim().replace(/^"|"$/g, '') : null; };
  return { runsAs: field('runsAs'), target: field('target'), route: field('route'), method: field('method'), cron: field('cron') };
}

test('loading the package and building its router starts no timer', async () => {
  const { routes } = loadPackage(NATIVE_PREDICTION_MARKETS);
  global.setInterval = (...args) => { timers.push('setInterval'); const t = real.setInterval(...args); t.unref?.(); return t; };
  global.setTimeout = (...args) => { timers.push('setTimeout'); const t = real.setTimeout(...args); t.unref?.(); return t; };
  try {
    routes.createKalshiRoutes({ pool: recordingPool(), appPackageDir: PKG });
    // The old poller armed its timers after an awaited settings read: give any such start time to happen.
    await new Promise((resolve) => real.setTimeout(resolve, 50));
  } finally {
    global.setInterval = real.setInterval;
    global.setTimeout = real.setTimeout;
  }
  assert.deepEqual(timers, [], 'a timer tick runs outside any admitted request and is refused its SQL');
});

test('the manifest schedules the tick as a person-activated call to the mounted route', () => {
  const { routes, cron } = loadPackage(NATIVE_PREDICTION_MARKETS);
  const router = routes.createKalshiRoutes({ pool: recordingPool(), appPackageDir: PKG });
  const schedule = manifestSchedule('background-scan');
  assert.equal(schedule.runsAs, 'user');
  assert.equal(schedule.target, 'service-route');
  assert.equal(schedule.method, 'POST');
  assert.equal(schedule.route, cron.KALSHI_SCAN_SCHEDULE.route);
  assert.equal(schedule.route, '/api/kalshi/scan/tick');
  assert.ok(router.routes.some((r) => r.method === 'post' && r.route === '/scan/tick'));
});

test('on the native runtime the tick says no market reader is connected, before any SQL', async () => {
  const { routes } = loadPackage(NATIVE_PREDICTION_MARKETS);
  const pool = recordingPool();
  const router = routes.createKalshiRoutes({ pool, appPackageDir: PKG });
  const before = pool.sql.length;
  const tick = router.routes.find((r) => r.method === 'post' && r.route === '/scan/tick').handler;

  const anonymous = reply();
  await tick({ oidc: null }, anonymous);
  assert.equal(anonymous.code, 401);

  const res = reply();
  await tick({ oidc: { user: { sub: 'person-1' } } }, res);
  assert.equal(res.code, 503);
  assert.equal(res.body.error, 'kalshi_scan_unavailable');
  assert.match(res.body.detail, /No Kalshi market feed is connected on this installation/);
  assert.match(res.body.detail, /listMarketsFiltered/);
  assert.equal(pool.sql.length, before, 'nothing was read or written');

  const manual = reply();
  await router.routes.find((r) => r.method === 'post' && r.route === '/scan/run').handler({ oidc: { user: { sub: 'person-1' } } }, manual);
  assert.equal(manual.code, 503, '"Scan now" says why it cannot run instead of 202 and a silent failure');
  assert.match(manual.body.error, /No Kalshi market feed is connected/);
  assert.equal(pool.sql.length, before);
});

test('the calibration table is read from the package directory first; a missing one says so in words, with no path', () => {
  const reader = { ...NATIVE_PREDICTION_MARKETS, listMarketsFiltered: async () => ({}), getSeriesMeta: async () => ({}), rankHands: () => [], mayStrategyStake: async () => ({}) };
  const { engine } = loadPackage(reader);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kalshi-pkg-'));
  try {
    const missing = engine.scanUnavailableReason(dir);
    assert.match(missing, /^No calibration table is installed with Kalshi on this installation\./);
    assert.ok(!missing.includes(dir) && !missing.includes('/package/') && !/\.json/.test(missing), 'a person reads this: no file paths');
    assert.ok(!missing.includes('scripts/oshal-kalshi-calibration.ts'), 'never name a script this runtime does not have');
    fs.mkdirSync(path.join(dir, 'data'));
    fs.writeFileSync(path.join(dir, 'data', 'kalshi-calibration.json'), JSON.stringify({ generatedAt: '2026-07-13T05:39:26.578Z', sampleCounts: { Sports: 1 }, horizons: {} }));
    const loaded = engine.loadCalibration(dir);
    assert.equal(loaded.table.generatedAt, '2026-07-13T05:39:26.578Z');
    assert.equal(loaded.path, path.join(dir, 'data', 'kalshi-calibration.json'));
    assert.equal(engine.scanUnavailableReason(dir), null, 'with a reader and a table, a scan may run');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('GET /scan names the schedule that runs the scan, so the page can find the person\'s own job', async () => {
  const { routes, cron } = loadPackage(NATIVE_PREDICTION_MARKETS);
  const router = routes.createKalshiRoutes({ pool: recordingPool(), appPackageDir: PKG });
  const res = reply();
  await router.routes.find((r) => r.method === 'get' && r.route === '/scan').handler({ oidc: { user: { sub: 'person-1' } }, query: {} }, res);
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.scan.schedule, { ...cron.KALSHI_SCAN_SCHEDULE });
  assert.match(res.body.scan.unavailable, /No Kalshi market feed is connected/);
});

/** @description One named function from the page's main script, by balanced braces. */
function pageFunction(html, name) {
  const start = html.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `the page defines ${name}`);
  let depth = 0;
  for (let i = html.indexOf('{', start); i < html.length; i += 1) {
    if (html[i] === '{') depth += 1;
    if (html[i] === '}') { depth -= 1; if (depth === 0) return html.slice(start, i + 1); }
  }
  throw new Error(`unbalanced ${name}`);
}

test('the page says whether the background scan will run: cannot here, off until the person turns the job on, on, or unknown', () => {
  const html = fs.readFileSync(path.join(PKG, 'tools', 'kalshi.html'), 'utf8');
  assert.doesNotMatch(html, /~30s|shortly after start/, 'no first walk is promised: nothing scans until a job runs');
  const vm = require('node:vm');
  const ctx = {};
  const esc = "function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }";
  vm.runInNewContext(`${esc}\n${pageFunction(html, 'scanJobState')}\nthis.f = scanJobState;`, ctx);
  const offer = 'Keep my Kalshi edge scan fresh and tell Jarvis about new playable hands.';
  const row = (status, activation) => ({ app: 'kalshi', name: 'background-scan', status, activation, offer });

  const cannot = ctx.f({ unavailable: 'No Kalshi market feed is connected on this installation.', enabled: true, intervalMinutes: 60 }, { listed: true, row: row('active', { class: 'person' }) });
  assert.equal(cannot.on, false);
  assert.match(cannot.why, /cannot run on this installation/);
  assert.doesNotMatch(cannot.cadence, /every/, 'no cadence for a scan that cannot run');

  const off = ctx.f({ enabled: true, intervalMinutes: 60 }, { listed: true, row: row('not-activated', null) });
  assert.equal(off.on, false);
  assert.match(off.why, /Background scan is off/);
  assert.ok(off.why.includes(offer), 'names the offer the person turns on');
  assert.match(off.why, /href="\/swarm-admin\/jobs"/);
  assert.doesNotMatch(off.cadence, /every 60m/);

  const on = ctx.f({ enabled: true, intervalMinutes: 60 }, { listed: true, row: row('active', { class: 'person' }) });
  assert.equal(on.on, true);
  assert.match(on.cadence, /every 60m/);

  const unknown = ctx.f({ enabled: true, intervalMinutes: 60 }, { listed: false });
  assert.equal(unknown.on, false);
  assert.match(unknown.cadence, /unknown/);

  const settingsOff = ctx.f({ enabled: false, intervalMinutes: 60 }, { listed: true, row: row('active', { class: 'person' }) });
  assert.match(settingsOff.cadence, /OFF in Settings/);
});

/** The prediction-markets shape with a market reader, as the native bridge provides it. */
const WITH_READER = { ...NATIVE_PREDICTION_MARKETS, listMarketsFiltered: async () => ({}), getSeriesMeta: async () => ({}), rankHands: () => [], mayStrategyStake: async () => ({}) };

test('the package ships its calibration table with its provenance, so a scan may run', () => {
  const { engine } = loadPackage(WITH_READER);
  const loaded = engine.loadCalibration(PKG);
  assert.equal(loaded.path, path.join(PKG, 'data', 'kalshi-calibration.json'), 'the package\'s own copy, not a platform path');
  assert.equal(loaded.table.generatedAt, '2026-07-13T05:39:26.578Z');
  assert.deepEqual(Object.keys(loaded.table.horizons).sort(), ['1', '24', '6']);
  assert.ok(Object.values(loaded.table.sampleCounts).every((n) => Number.isInteger(n) && n > 0));
  assert.match(loaded.table.provenance.copiedFrom, /config-seed\/kalshi-calibration\.json/);
  assert.match(loaded.table.provenance.refresh, /not refreshed/);
  assert.equal(engine.scanUnavailableReason(PKG), null, 'with the bridge\'s reader and the shipped table, a scan may run');
});

test('before the first scan GET /scan carries the table\'s age, and a missing table\'s gate reason has no path', async () => {
  const { routes } = loadPackage(WITH_READER);
  const read = async (dir) => {
    const res = reply();
    await routes.createKalshiRoutes({ pool: recordingPool(), appPackageDir: dir }).routes
      .find((r) => r.method === 'get' && r.route === '/scan').handler({ oidc: { user: { sub: 'person-1' } }, query: {} }, res);
    assert.equal(res.code, 200, JSON.stringify(res.body));
    return res.body;
  };
  const shipped = await read(PKG);
  assert.equal(shipped.awaitingFirstScan, true);
  assert.equal(shipped.calibrationGeneratedAt, '2026-07-13T05:39:26.578Z');
  assert.equal(shipped.scan.unavailable, null);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kalshi-empty-'));
  try {
    const missing = await read(dir);
    assert.equal(missing.calibrationGeneratedAt, null);
    for (const text of [missing.gateReason, missing.scan.unavailable, missing.scan.lastError]) {
      assert.match(text, /No calibration table is installed/);
      assert.ok(!text.includes('/package/') && !text.includes(dir), `no file path in "${text}"`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the page says how old the calibration table is, and that none is installed when it is missing', () => {
  const html = fs.readFileSync(path.join(PKG, 'tools', 'kalshi.html'), 'utf8');
  const vm = require('node:vm');
  const ctx = {};
  vm.runInNewContext(`${pageFunction(html, 'calibrationLabel')}\nthis.f = calibrationLabel;`, ctx);
  const now = Date.parse('2026-10-11T12:00:00Z');
  assert.match(ctx.f('2026-07-13T05:39:26.578Z', now), /^calibration table from .*2026 \(90 days old\)$/);
  assert.match(ctx.f(null, now), /none installed/);
  assert.match(html, /calibrationLabel\(p\.calibrationGeneratedAt, Date\.now\(\)\)/, 'the header line uses it');
});
