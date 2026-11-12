/**
 * Guards for the calibration rebuild: the package walks Kalshi's settled-market tape in short turns and builds the table
 * the scan reads, the same table the retired command-line study built in one run.
 *
 * Real boundaries: the walk's state, samples and tables are in a real PostgreSQL carrying this package's own migrations,
 * and Kalshi is a stand-in answering /series, /markets and /candlesticks over HTTP, read through fetch. Nothing is
 * skipped: without OSHAL_TEST_POSTGRES the suite fails.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | A rebuild in many short turns gives exactly the table a straight run of the retired study gives over the same tape (series order, fifteen-minute series left out, unusable markets left out, paged market lists, 60 a series and 400 a category, a failed price read passed over); a turn cut short carries on where it stopped; a failed series list stops a turn and the next turn finishes it; a table under thirty days old is kept and an older one rebuilt; the scan reads the rebuilt table before the shipped one. The background tick takes a calibration turn with the time it has left, finishes a small tape inside one tick, and GET /calibration and /status then say the table was rebuilt; a tick with no market reader takes no turn.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const Module = require('node:module');
const { Pool, Client } = require('../../scripts/toolchain/node_modules/pg');
const { samplesOf, usableSettled, buildCalibrationTable } = require('../lib/kalshi-calibration-build');
const walk = require('../lib/kalshi-calibration-walk');
const store = require('../lib/kalshi-calibration-store');

const PKG = path.join(__dirname, '..');
const NOW = Date.parse('2026-11-11T12:00:00Z');
const HOUR = 3600;

/** A database of the test's own with every migration of this package; dropped afterwards. */
async function database(t) {
  const dsn = process.env.OSHAL_TEST_POSTGRES;
  assert.ok(dsn, 'OSHAL_TEST_POSTGRES is required: the rebuild is proven on a real PostgreSQL and is never skipped');
  const url = new URL(dsn);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && ['35689', '32768'].includes(url.port), 'only a disposable local PostgreSQL is allowed');
  const admin = new Client({ connectionString: dsn });
  await admin.connect();
  const db = `kalshi_calibration_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE DATABASE ${db}`);
  url.pathname = `/${db}`;
  const pool = new Pool({ connectionString: url.toString(), max: 2 });
  for (const file of fs.readdirSync(path.join(PKG, 'migrations')).filter((name) => name.endsWith('.sql')).sort()) {
    await pool.query(fs.readFileSync(path.join(PKG, 'migrations', file), 'utf8'));
  }
  t.after(async () => { await pool.end(); await admin.query(`DROP DATABASE ${db}`); await admin.end(); });
  return pool;
}

/** One wire market. `kind` makes it unusable in one way, or usable when absent; `open` is hours before close. */
function wireMarket(series, n, kind, open = 30) {
  const close = NOW / 1000 - (n + 2) * 86400;
  const market = { ticker: `${series}-M${n}`, event_ticker: `${series}-E${n}`, status: 'finalized', result: n % 3 === 0 ? 'no' : 'yes',
    volume: 10 + n, open_time: new Date((close - open * HOUR) * 1000).toISOString(), close_time: new Date(close * 1000).toISOString() };
  if (kind === 'multi') market.mve_collection_ticker = 'KXMVE';
  if (kind === 'void') market.result = '';
  if (kind === 'quiet') market.volume = 0;
  if (kind === 'unopened') delete market.open_time;
  return market;
}

/** The tape: series per category and settled markets per series, in Kalshi's order. Economics is big enough to hit its cap. */
function tape() {
  const series = {
    Politics: [{ ticker: 'POL1', frequency: 'daily' }, { ticker: 'POL15', frequency: 'fifteen_min' }, { ticker: 'POL2', frequency: 'weekly' }],
    Sports: [{ ticker: 'SPO1', frequency: 'daily' }],
    Economics: Array.from({ length: 8 }, (_, i) => ({ ticker: `ECO${i}`, frequency: 'monthly' })),
  };
  const markets = {
    POL1: [wireMarket('POL1', 0, 'multi'), wireMarket('POL1', 1), wireMarket('POL1', 2, 'void'), wireMarket('POL1', 3, undefined, 3),
      wireMarket('POL1', 4, 'quiet'), wireMarket('POL1', 5), wireMarket('POL1', 6, 'unopened'), wireMarket('POL1', 7)],
    POL15: [wireMarket('POL15', 1)],
    POL2: [wireMarket('POL2', 1), wireMarket('POL2', 2)],
    SPO1: [wireMarket('SPO1', 1), wireMarket('SPO1', 2, undefined, 8)],
  };
  for (const s of series.Economics) markets[s.ticker] = Array.from({ length: 70 }, (_, n) => wireMarket(s.ticker, n));
  return { series, markets };
}

/** Hourly candles for a market: some hours carry only a bid and ask, a few carry nothing usable. */
function candlesFor(ticker, startTs, endTs) {
  const seed = [...ticker].reduce((sum, ch) => sum + ch.charCodeAt(0), 0), out = [];
  for (let ts = startTs + HOUR, i = 0; ts <= endTs; ts += HOUR, i += 1) {
    const price = ((seed * 7 + i * 13) % 97) / 100 + 0.01;
    if (i % 5 === 0) out.push({ end_period_ts: ts, price: {}, yes_bid: { close_dollars: String(price - 0.01) }, yes_ask: { close_dollars: String(price + 0.01) } });
    else if (i % 11 === 0) out.push({ end_period_ts: ts, price: { close_dollars: '0.999' }, yes_bid: {}, yes_ask: {} });
    else out.push({ end_period_ts: ts, price: { close_dollars: price.toFixed(4) }, yes_bid: {}, yes_ask: {} });
  }
  return out;
}

/** A stand-in Kalshi over HTTP. `failPrices` names markets whose price history answers 500; `failSeriesOnce` a category. */
async function kalshi(t, data, options = {}) {
  const asked = [], failed = new Set();
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://stand-in'), p = url.pathname.replace('/trade-api/v2', '');
    const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    asked.push(p);
    if (p === '/series') {
      const category = url.searchParams.get('category');
      if (options.failSeriesOnce === category && !failed.has(category)) { failed.add(category); return send(503, {}); }
      return send(200, { series: data.series[category] || [] });
    }
    if (p === '/markets') {
      const all = data.markets[url.searchParams.get('series_ticker')] || [], from = Number(url.searchParams.get('cursor') || 0);
      // Pages of three, so a series' list arrives in several answers.
      const size = Math.min(3, Number(url.searchParams.get('limit'))), page = all.slice(from, from + size);
      return send(200, { markets: page, cursor: from + size < all.length ? String(from + size) : '' });
    }
    const candles = p.match(/^\/series\/([^/]+)\/markets\/([^/]+)\/candlesticks$/);
    if (candles) {
      if ((options.failPrices || []).includes(candles[2])) return send(500, {});
      return send(200, { candlesticks: candlesFor(candles[2], Number(url.searchParams.get('start_ts')), Number(url.searchParams.get('end_ts'))) });
    }
    return send(404, {});
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/trade-api/v2`;
  const get = async (pathAndQuery) => {
    const response = await fetch(`${base}${pathAndQuery}`, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Kalshi GET ${pathAndQuery.split('?')[0]}: HTTP ${response.status}`);
    return response.json();
  };
  // The fields of the kernel's normalizeMarket and getCandles that the walk reads (crates/host-process/bridge/prediction_markets.js).
  const normalize = (m) => ({ ticker: String(m.ticker || ''), seriesTicker: String(m.event_ticker || '').split('-')[0], result: String(m.result || ''),
    volume: Number(m.volume) || 0, openTime: m.open_time ? new Date(m.open_time) : null, closeTime: m.close_time ? new Date(m.close_time) : null,
    isMultivariate: Boolean(m.mve_collection_ticker || m.mve_selected_legs) });
  const num = (section, field) => (section && section[field] != null ? Number(section[field]) : null);
  const candles = async (series, ticker, startTs, endTs, minutes) => (await get(`/series/${series}/markets/${ticker}/candlesticks?start_ts=${startTs}&end_ts=${endTs}&period_interval=${minutes}`))
    .candlesticks.map((c) => ({ endPeriodTs: Number(c.end_period_ts), close: num(c.price, 'close_dollars'), yesBidClose: num(c.yes_bid, 'close_dollars'), yesAskClose: num(c.yes_ask, 'close_dollars') }));
  return { io: { get, normalize, candles }, asked };
}

/** The retired study run straight over the same tape: every category's series, its markets, then each kept market's prices. */
function retiredStudy(data, normalize, failPrices = []) {
  const samples = [];
  for (const category of walk.CATEGORIES) {
    const selected = [];
    let taken = 0;
    for (const s of (data.series[category] || []).filter((x) => x.frequency !== 'fifteen_min')) {
      if (taken >= 400) break;
      for (const m of usableSettled((data.markets[s.ticker] || []).slice(0, 300).map(normalize)).slice(0, 60)) {
        if (taken >= 400) break;
        selected.push(m); taken += 1;
      }
    }
    for (const m of selected) {
      if (failPrices.includes(m.ticker)) continue;
      const closeS = Math.floor(m.closeTime.getTime() / 1000);
      const candles = candlesFor(m.ticker, closeS - 26 * HOUR, closeS).map((c) => ({ endPeriodTs: c.end_period_ts,
        close: c.price.close_dollars != null ? Number(c.price.close_dollars) : null,
        yesBidClose: c.yes_bid.close_dollars != null ? Number(c.yes_bid.close_dollars) : null,
        yesAskClose: c.yes_ask.close_dollars != null ? Number(c.yes_ask.close_dollars) : null }));
      samples.push(...samplesOf(m, category, candles));
    }
  }
  return { table: buildCalibrationTable(samples, new Date(NOW)), selected: samples.length };
}

/** A clock that moves one millisecond each time it is read, so a budget counts reads. */
function ticking() { let at = 0; return () => { at += 1; return at; }; }

/** Run turns until the walk finishes; returns every turn's result. */
async function rebuild(pool, io, budgetMs) {
  const turns = [];
  for (let i = 0; i < 5000; i += 1) {
    const turn = await store.rebuildTurn(pool, io, { budgetMs, nowMs: NOW, now: ticking() });
    turns.push(turn);
    if (!turn.ran || turn.done) return turns;
  }
  throw new Error('the walk did not finish');
}

test('a rebuild in many short turns gives the table a straight run of the retired study gives', async (t) => {
  const pool = await database(t), data = tape(), { io, asked } = await kalshi(t, data, { failPrices: ['POL1-M5'] });
  const turns = await rebuild(pool, io, 4);
  const last = turns[turns.length - 1], expected = retiredStudy(data, io.normalize, ['POL1-M5']);
  assert.ok(turns.length > 50, `a turn starts only a few requests: ${turns.length} turns`);
  assert.equal(last.done, true);
  assert.deepEqual((await store.latestTable(pool)).table, JSON.parse(JSON.stringify(expected.table)));
  assert.equal(asked.filter((p) => /candlesticks/.test(p) && p.includes('POL15')).length, 0, 'a fifteen-minute series is never read');
  assert.equal(asked.filter((p) => /candlesticks/.test(p) && /ECO/.test(p)).length, 400, 'a category keeps 400 markets');
  assert.ok(turns.some((turn) => (turn.failures || []).some((f) => f.startsWith('prices of POL1-M5'))), 'a failed price read is named');
  const counts = (await pool.query('SELECT count(*)::int AS n FROM kalshi_calibration_samples')).rows[0].n;
  assert.equal(counts, expected.selected);
});

test('a turn cut short carries on where it stopped, and a failed series list is asked again the next turn', async (t) => {
  const data = tape();
  const poolA = await database(t), standA = await kalshi(t, data);
  await rebuild(poolA, standA.io, 1_000_000);
  const poolB = await database(t), standB = await kalshi(t, data, { failSeriesOnce: 'Sports' });
  const turns = await rebuild(poolB, standB.io, 7);
  assert.ok(turns.some((turn) => /^series of Sports: /.test(turn.error || '')), 'the failed list stopped a turn');
  const a = await store.latestTable(poolA), b = await store.latestTable(poolB);
  assert.deepEqual(b.table, a.table, 'one long turn and many short ones with a failure give the same table');
  const walkRow = (await poolB.query('SELECT finished_at, last_error, samples FROM kalshi_calibration_walks')).rows;
  assert.equal(walkRow.length, 1); assert.ok(walkRow[0].finished_at); assert.equal(walkRow[0].last_error, null);
});

test('a table under thirty days old is kept, an older one is rebuilt, and only the newest walk is kept', async (t) => {
  const pool = await database(t), data = tape(), { io } = await kalshi(t, data);
  await rebuild(pool, io, 1_000_000);
  const first = await store.latestTable(pool);
  const fresh = await store.rebuildTurn(pool, io, { budgetMs: 1_000_000, nowMs: NOW + 29 * 86400000 });
  assert.deepEqual([fresh.ran, fresh.reason, fresh.builtAt], [false, 'fresh', first.generatedAt]);
  const later = NOW + 31 * 86400000, turn = await store.rebuildTurn(pool, io, { budgetMs: 1_000_000, nowMs: later });
  assert.equal(turn.done, true);
  const second = await store.latestTable(pool);
  assert.equal(second.generatedAt, new Date(later).toISOString());
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM kalshi_calibration_tables')).rows[0].n, 1);
  const walks = (await pool.query('SELECT DISTINCT walk_id FROM kalshi_calibration_samples')).rows;
  assert.deepEqual(walks.length, 1, 'the older walk\'s samples are gone');
});

test('the scan reads the rebuilt table before the shipped one, and says when it could not', async (t) => {
  const pool = await database(t), shipped = { table: { generatedAt: '2026-07-13T00:00:00.000Z', sampleCounts: {}, horizons: {} }, mtime: '2026-07-13T00:00:00.000Z' };
  const none = await store.calibrationTableFor(pool, () => shipped);
  assert.deepEqual([none.source, none.mtime], ['shipped', shipped.mtime]);
  const { io } = await kalshi(t, tape());
  await rebuild(pool, io, 1_000_000);
  const rebuilt = await store.calibrationTableFor(pool, () => shipped);
  assert.deepEqual([rebuilt.source, rebuilt.mtime, rebuilt.table.generatedAt], ['rebuilt', new Date(NOW).toISOString(), new Date(NOW).toISOString()]);
  const errors = [], broken = { query: async () => { throw new Error('relation does not exist'); } };
  const fallback = await store.calibrationTableFor(broken, () => shipped, (error) => errors.push(error.message));
  assert.deepEqual([fallback.source, errors], ['shipped', ['relation does not exist']]);
});

test('no statement sorts, merges on conflict or picks distinct rows in the database', () => {
  const source = fs.readFileSync(path.join(PKG, 'lib', 'kalshi-calibration-store.js'), 'utf8').split("'use strict';")[1];
  const statements = source.match(/'(SELECT|INSERT|UPDATE|DELETE)[^']*'/g) || [];
  assert.ok(statements.length >= 8);
  for (const sql of statements) assert.doesNotMatch(sql, /ORDER BY|ON CONFLICT|DISTINCT|GROUP BY/i, sql);
});

/** The package's routes with the platform stood in, as tests/kalshi-grade.test.js loads them. */
function loadRoutes(predictionMarkets) {
  const routes = [], quiet = { info() {}, warn() {}, error() {}, debug() {}, child() { return quiet; } };
  const add = (method) => (route, ...handlers) => { routes.push({ method, route, handler: handlers[handlers.length - 1] }); };
  const stubs = {
    '@/shared/logger': { createChildLogger: () => quiet },
    '@/features/prediction-markets': predictionMarkets,
    '@/app/routes/connectors-routes': { getValidAccessToken: async () => null },
    '@/app/routes/trading-routes-helpers': { callerSub: (req) => (req.oidc && req.oidc.user && req.oidc.user.sub) || null, servePage: () => () => {} },
    '@/shared/middleware/authz': { isOperator: () => false },
    '@/app/routes/jarvis-task-store': { saveTaskPending: async () => false, finishTask: async () => {} },
    '@/app/routes/notify-routes': { buildNotificationRouter: () => ({ notify: async () => ({ delivered: false }) }) },
    express: { Router: () => ({ routes, get: add('get'), post: add('post'), put: add('put'), delete: add('delete'), patch: add('patch'), use: add('use') }) },
  };
  for (const key of Object.keys(require.cache)) if (key.startsWith(path.join(PKG, 'routes'))) delete require.cache[key];
  const load = Module._load;
  Module._load = function stubbed(request, ...rest) {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    if (request.startsWith('@/')) return {};
    return load.call(this, request, ...rest);
  };
  try { return require('../routes/kalshi-routes.js'); } finally { Module._load = load; }
}

function reply() {
  const r = { code: 200, body: null };
  r.status = (code) => { r.code = code; return r; };
  r.json = (body) => { r.body = body; return r; };
  r.set = () => r;
  return r;
}

const PERSON = { oidc: { user: { sub: 'person-1' } } };

test('the background tick walks the tape with the time it has left, and the pages then read the rebuilt table', async (t) => {
  const pool = await database(t), data = tape(), { io, asked } = await kalshi(t, data);
  // A snapshot written just now: the scan is not due, so the tick grades and then takes its calibration turn.
  await pool.query(`INSERT INTO kalshi_scan_snapshots (id, payload, generated_at) VALUES (1, '{"hands":[]}'::jsonb, now())`);
  const was = process.env.OSHAL_EGRESS;
  process.env.OSHAL_EGRESS = 'kernel';
  t.after(() => { if (was === undefined) delete process.env.OSHAL_EGRESS; else process.env.OSHAL_EGRESS = was; });
  const feed = { kalshiGet: io.get, normalizeMarket: io.normalize, getCandles: io.candles, exchangeTradingActive: async () => null,
    getScorecard: async () => ({}), kalshiLiveOrdersEnabled: () => false, listMarketsFiltered: async () => ({ markets: [], paged: 0 }),
    getSeriesMeta: async () => null, rankHands: () => [], mayStrategyStake: async () => ({ mayStake: false, reason: 'paper' }) };
  const router = loadRoutes(feed).createKalshiRoutes({ pool, appPackageDir: PKG });
  const route = (method, at) => router.routes.find((r) => r.method === method && r.route === at).handler;
  const before = reply();
  await route('get', '/calibration')(PERSON, before);
  assert.equal(before.body.source, 'shipped', 'until a rebuild finishes the shipped table is read');
  const tick = reply();
  await route('post', '/scan/tick')(PERSON, tick);
  assert.equal(tick.code, 200, JSON.stringify(tick.body));
  assert.deepEqual([tick.body.ran, tick.body.reason], [false, 'not_due']);
  assert.equal(tick.body.calibration.ran, true);
  assert.equal(tick.body.calibration.done, true, 'a small tape is walked inside one tick');
  assert.ok(asked.some((p) => /candlesticks/.test(p)));
  const after = reply();
  await route('get', '/calibration')(PERSON, after);
  assert.deepEqual([after.body.source, after.body.mtime], ['rebuilt', tick.body.calibration.generatedAt]);
  const status = reply();
  await route('get', '/status')(PERSON, status);
  assert.deepEqual([status.body.calibration.source, status.body.calibration.generatedAt], ['rebuilt', tick.body.calibration.generatedAt]);
  const again = reply();
  await route('post', '/scan/tick')(PERSON, again);
  assert.deepEqual([again.body.calibration.ran, again.body.calibration.reason], [false, 'fresh'], 'a fresh table is not walked again');
});

test('the tick gives a calibration turn only the time it has left, and none when it could not run', async () => {
  const { cron } = { cron: require('../routes/kalshi-scan-cron.js') };
  assert.equal(cron.CALIBRATION_UNTIL_MS, 40_000);
  assert.equal(cron.CALIBRATION_LEAST_MS, 3_000);
  const source = fs.readFileSync(path.join(PKG, 'src-routes', 'kalshi-scan-cron.ts'), 'utf8');
  assert.match(source, /const budgetMs = CALIBRATION_UNTIL_MS - \(Date\.now\(\) - startedMs\);\n  if \(!calibrate \|\| budgetMs < CALIBRATION_LEAST_MS\) return undefined;/);
  assert.match(source, /\['already_running', 'app_inactive', 'unavailable'\]\.includes\(outcome\.reason\)\) return outcome;/);
});
