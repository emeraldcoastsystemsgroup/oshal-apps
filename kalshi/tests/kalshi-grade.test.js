/**
 * Guards for grading: reality scores the predictions.
 *
 * Live 2026-11-10 the Scorecard stood at graded 0 with 3,430 and 1,395 predictions pending: the grader had been a
 * command-line script of the retired platform and nothing on the native kernel ran it. These guards fail if a
 * closed market's predictions stop getting their outcome, if the scores or the paper result change meaning, if a
 * market that is still open or has no result is graded, if a long list stops being finished by the runs that
 * follow, or if the job a person already turned on stops grading on the ticks where it does not scan.
 *
 * Real boundaries: the ledger is a real PostgreSQL carrying this package's own migrations, and Kalshi is a
 * stand-in answering GET /trade-api/v2/markets?tickers= over HTTP, read through fetch. Nothing is skipped: without
 * OSHAL_TEST_POSTGRES the suite fails.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Initial: the grades and their formulas, what stays ungraded, a result posted later, forty markets a lookup with a run out of time carried on by the next, the rotating start of the background run, an unreachable Kalshi, POST /grade and GET /grade through the mounted router, and a not-due tick that grades.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const Module = require('node:module');
const { randomUUID } = require('node:crypto');
const { Pool, Client } = require('../../scripts/toolchain/node_modules/pg');
const grade = require('../routes/kalshi-grade.js');

const PKG = path.resolve(__dirname, '..');
const quiet = { debug() {}, info() {}, warn() {}, error() {} };

/** A disposable database carrying this package's own migrations. */
async function ledger(t) {
  const dsn = process.env.OSHAL_TEST_POSTGRES;
  assert.ok(dsn, 'OSHAL_TEST_POSTGRES is required: grading is proven on a real PostgreSQL and is never skipped');
  const url = new URL(dsn);
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && ['35689', '32768'].includes(url.port), 'only a disposable local PostgreSQL is allowed');
  const admin = new Client({ connectionString: dsn });
  await admin.connect();
  const db = `kalshi_grade_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE DATABASE ${db}`);
  url.pathname = `/${db}`;
  const pool = new Pool({ connectionString: url.toString(), max: 2 });
  for (const file of fs.readdirSync(path.join(PKG, 'migrations')).filter((name) => name.endsWith('.sql')).sort()) {
    await pool.query(fs.readFileSync(path.join(PKG, 'migrations', file), 'utf8'));
  }
  t.after(async () => { await pool.end(); await admin.query(`DROP DATABASE ${db}`); await admin.end(); });
  return pool;
}

/** A stand-in Kalshi: `results` maps a ticker to 'yes', 'no' or '' (closed, no result); an absent ticker is not returned. */
async function kalshi(t, results, options = {}) {
  const lookups = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://stand-in');
    const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.method !== 'GET' || url.pathname !== '/trade-api/v2/markets') return send(404, {});
    const tickers = (url.searchParams.get('tickers') || '').split(',').filter(Boolean);
    lookups.push(tickers);
    if (options.failOn && options.failOn(lookups.length)) return send(503, { error: 'service unavailable' });
    return send(200, {
      cursor: '',
      markets: tickers.filter((ticker) => Object.prototype.hasOwnProperty.call(results, ticker))
        .map((ticker) => ({ ticker, status: results[ticker] ? 'finalized' : 'closed', result: results[ticker] })),
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/trade-api/v2`;
  const reader = async (pathAndQuery) => {
    const response = await fetch(`${base}${pathAndQuery}`, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Kalshi GET: HTTP ${response.status}`);
    return response.json();
  };
  return { reader, lookups, results };
}

/** Record one prediction the way the scan does; `closed` puts its market two hours past its close, else a day ahead. */
async function predict(pool, row) {
  await pool.query(
    `INSERT INTO kalshi_predictions (strategy, ticker, predicted_prob, market_prob, edge_net, stake_fraction, side, close_time)
     VALUES ($1, $2, $3, $4, 0.05, 0, $5, now() + ($6 || ' hours')::interval)`,
    [row.strategy || 'calibration', row.ticker, row.p, row.m, row.side || 'yes', row.closed === false ? '24' : '-2'],
  );
}

async function row(pool, strategy, ticker) {
  const { rows } = await pool.query(
    `SELECT settled, settled_yes, brier::float AS brier, market_brier::float AS market_brier, pnl_per_contract::float AS pnl, graded_at
       FROM kalshi_predictions WHERE strategy = $1 AND ticker = $2`, [strategy, ticker]);
  return rows[0];
}

const near = (actual, expected, what) => assert.ok(Math.abs(actual - expected) < 1e-6, `${what}: ${actual} is not ${expected}`);

test('a closed market grades its predictions: outcome, our Brier, the market\'s Brier and one contract at the recorded ask', async (t) => {
  const pool = await ledger(t);
  const stand = await kalshi(t, { 'T-YES': 'yes', 'T-NO': 'no', 'T-WAIT': '' });
  await predict(pool, { ticker: 'T-YES', p: 0.80, m: 0.60 });
  await predict(pool, { strategy: 'contrarian-extreme', ticker: 'T-YES', side: 'no', p: 0.30, m: 0.42 });
  await predict(pool, { ticker: 'T-NO', p: 0.70, m: 0.55 });
  await predict(pool, { ticker: 'T-WAIT', p: 0.60, m: 0.50 });
  await predict(pool, { ticker: 'T-GONE', p: 0.60, m: 0.50 });
  await predict(pool, { ticker: 'T-OPEN', p: 0.60, m: 0.50, closed: false });

  const run = await grade.gradeDue(pool, stand.reader, { after: '' });
  assert.deepEqual(
    { due: run.due, markets: run.markets, checked: run.checked, graded: run.graded, waiting: run.waiting, failedLookups: run.failedLookups, done: run.done },
    { due: 5, markets: 4, checked: 4, graded: 3, waiting: 2, failedLookups: 0, done: true },
  );
  assert.equal(run.error, undefined);
  assert.ok(!stand.lookups.flat().includes('T-OPEN'), 'a market still open is never asked about');

  // Our side YES at 60c, it settled YES: we were at 80%.
  const won = await row(pool, 'calibration', 'T-YES');
  assert.equal(won.settled, true); assert.equal(won.settled_yes, true); assert.ok(won.graded_at);
  near(won.brier, 0.04, 'our Brier'); near(won.market_brier, 0.16, 'the market\'s Brier');
  near(won.pnl, 1 - 0.60 - 0.017, 'a win pays $1 less the price and the 1.7c fee');
  // The contrarian sibling took NO at 42c on the same market and lost.
  const lost = await row(pool, 'contrarian-extreme', 'T-YES');
  assert.equal(lost.settled, true); assert.equal(lost.settled_yes, true);
  near(lost.brier, 0.09, 'our Brier'); near(lost.market_brier, 0.1764, 'the market\'s Brier');
  near(lost.pnl, -(0.42 + 0.018), 'a loss costs the price and the 1.8c fee');
  const no = await row(pool, 'calibration', 'T-NO');
  assert.equal(no.settled, true); assert.equal(no.settled_yes, false);
  near(no.brier, 0.49, 'our Brier'); near(no.market_brier, 0.3025, 'the market\'s Brier'); near(no.pnl, -(0.55 + 0.018), 'the loss');
  for (const ticker of ['T-WAIT', 'T-GONE', 'T-OPEN']) {
    const untouched = await row(pool, 'calibration', ticker);
    assert.equal(untouched.settled, false, `${ticker} has no result and stays ungraded`);
    assert.equal(untouched.graded_at, null); assert.equal(untouched.brier, null);
  }
  const summary = await grade.gradingSummary(pool);
  assert.deepEqual({ due: summary.due, open: summary.open, graded: summary.graded }, { due: 2, open: 1, graded: 3 });
  assert.ok(summary.lastGradedAt);
});

test('nothing is graded twice, and a result Kalshi posts later is picked up by the next run', async (t) => {
  const pool = await ledger(t);
  const stand = await kalshi(t, { 'T-YES': 'yes', 'T-LATE': '' });
  await predict(pool, { ticker: 'T-YES', p: 0.80, m: 0.60 });
  await predict(pool, { ticker: 'T-LATE', p: 0.20, m: 0.30, side: 'no' });
  assert.equal((await grade.gradeDue(pool, stand.reader, { after: '' })).graded, 1);
  const first = await row(pool, 'calibration', 'T-YES');
  const again = await grade.gradeDue(pool, stand.reader, { after: '' });
  assert.deepEqual({ due: again.due, graded: again.graded, waiting: again.waiting, done: again.done }, { due: 1, graded: 0, waiting: 1, done: true });
  assert.deepEqual(await row(pool, 'calibration', 'T-YES'), first, 'a graded prediction is never written again');
  stand.results['T-LATE'] = 'no';
  const later = await grade.gradeDue(pool, stand.reader, { after: '' });
  assert.equal(later.graded, 1);
  const late = await row(pool, 'calibration', 'T-LATE');
  assert.equal(late.settled_yes, false);
  near(late.brier, 0.64, 'our side NO won and we gave it 20%');
});

test('a long list is asked forty markets a lookup, and a run out of time is carried on by the next', async (t) => {
  const pool = await ledger(t);
  const tickers = Array.from({ length: 95 }, (_, i) => `M-${String(i).padStart(3, '0')}`);
  const stand = await kalshi(t, Object.fromEntries(tickers.map((ticker, i) => [ticker, i % 2 ? 'yes' : 'no'])));
  for (const ticker of tickers) await predict(pool, { ticker, p: 0.7, m: 0.6 });
  const clock = [0, 0, 100];
  const first = await grade.gradeDue(pool, stand.reader, { after: '', budgetMs: 50, nowMs: () => (clock.length > 1 ? clock.shift() : clock[0]) });
  assert.deepEqual(
    { markets: first.markets, checked: first.checked, graded: first.graded, done: first.done, lastTicker: first.lastTicker },
    { markets: 95, checked: 40, graded: 40, done: false, lastTicker: 'M-039' },
  );
  const rest = await grade.gradeDue(pool, stand.reader, { after: first.lastTicker });
  assert.deepEqual({ due: rest.due, checked: rest.checked, graded: rest.graded, done: rest.done }, { due: 55, checked: 55, graded: 55, done: true });
  assert.deepEqual(stand.lookups.map((batch) => batch.length), [40, 40, 15]);
  assert.equal((await grade.gradingSummary(pool)).graded, 95);
  const none = await grade.gradeDue(pool, stand.reader, { after: rest.lastTicker });
  assert.deepEqual({ due: none.due, checked: none.checked, done: none.done }, { due: 0, checked: 0, done: true });
});

test('the background run starts at a rotating place and still covers every market', async (t) => {
  const pool = await ledger(t);
  const tickers = Array.from({ length: 50 }, (_, i) => `R-${String(i).padStart(2, '0')}`);
  const stand = await kalshi(t, Object.fromEntries(tickers.map((ticker) => [ticker, 'yes'])));
  for (const ticker of tickers) await predict(pool, { ticker, p: 0.7, m: 0.6 });
  const at = 7 * 15 * 60 * 1000;
  const start = grade.rotatingStart(50, at);
  assert.ok(start > 0 && start < 50, `the seventh firing does not start at the top (${start})`);
  const run = await grade.gradeDue(pool, stand.reader, { nowMs: () => at });
  assert.deepEqual({ checked: run.checked, graded: run.graded, done: run.done }, { checked: 50, graded: 50, done: true });
  assert.equal(stand.lookups[0][0], tickers[start], 'the run began where the rotation said');
  const starts = new Set(Array.from({ length: 12 }, (_, step) => grade.rotatingStart(1000, step * 15 * 60 * 1000)));
  assert.ok(starts.size >= 10, 'twelve firings start in at least ten different places');
  assert.equal(grade.rotatingStart(0, at), 0);
});

test('when Kalshi cannot be reached the run says so and writes nothing; one failed lookup leaves its markets for the next run', async (t) => {
  const pool = await ledger(t);
  const tickers = Array.from({ length: 90 }, (_, i) => `F-${String(i).padStart(2, '0')}`);
  for (const ticker of tickers) await predict(pool, { ticker, p: 0.7, m: 0.6 });
  const down = await kalshi(t, Object.fromEntries(tickers.map((ticker) => [ticker, 'yes'])), { failOn: () => true });
  const refused = await grade.gradeDue(pool, down.reader, { after: '' });
  assert.match(refused.error, /HTTP 503/);
  assert.deepEqual({ graded: refused.graded, checked: refused.checked, done: refused.done }, { graded: 0, checked: 0, done: false });
  assert.equal((await grade.gradingSummary(pool)).graded, 0);
  assert.equal(down.lookups.length, 1, 'a Kalshi that is down is asked once, not once per batch');

  const flaky = await kalshi(t, Object.fromEntries(tickers.map((ticker) => [ticker, 'yes'])), { failOn: (n) => n === 2 });
  const partial = await grade.gradeDue(pool, flaky.reader, { after: '' });
  assert.deepEqual({ checked: partial.checked, graded: partial.graded, failedLookups: partial.failedLookups, done: partial.done }, { checked: 50, graded: 50, failedLookups: 1, done: false });
  assert.equal(partial.error, undefined);
  assert.equal((await grade.gradingSummary(pool)).due, 40, 'the failed lookup\'s forty markets are still due');
});

/** The compiled routes with the framework aliases stood in and the given prediction-markets module. */
function loadRoutes(predictionMarkets) {
  const routes = [];
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
/** A prediction-markets module with a market feed, so the tick counts the scan as able to run here. */
const withFeed = (reader) => ({
  kalshiGet: reader, exchangeTradingActive: async () => null, getScorecard: async () => ({}), kalshiLiveOrdersEnabled: () => false,
  listMarketsFiltered: async () => ({ markets: [], paged: 0 }), getSeriesMeta: async () => null, rankHands: () => [],
  mayStrategyStake: async () => ({ mayStake: false, reason: 'paper' }),
});

test('POST /grade grades for the signed-in person and returns the run and the standing; GET /grade reads it; no reader is a 503 in words', async (t) => {
  const pool = await ledger(t);
  const stand = await kalshi(t, { 'T-YES': 'yes' });
  await predict(pool, { ticker: 'T-YES', p: 0.80, m: 0.60 });
  await predict(pool, { ticker: 'T-OPEN', p: 0.60, m: 0.50, closed: false });
  const router = loadRoutes(withFeed(stand.reader)).createKalshiRoutes({ pool, appPackageDir: PKG });
  const route = (method, at) => router.routes.find((r) => r.method === method && r.route === at).handler;

  const anonymous = reply();
  await route('post', '/grade')({}, anonymous);
  assert.equal(anonymous.code, 401);
  assert.equal((await grade.gradingSummary(pool)).graded, 0, 'a caller who is not signed in grades nothing');

  const before = reply();
  await route('get', '/grade')(PERSON, before);
  assert.deepEqual({ due: before.body.due, open: before.body.open, graded: before.body.graded }, { due: 1, open: 1, graded: 0 });

  const done = reply();
  await route('post', '/grade')({ ...PERSON, body: { after: '' } }, done);
  assert.equal(done.code, 200, JSON.stringify(done.body));
  assert.deepEqual({ graded: done.body.run.graded, done: done.body.run.done }, { graded: 1, done: true });
  assert.deepEqual({ due: done.body.summary.due, open: done.body.summary.open, graded: done.body.summary.graded }, { due: 0, open: 1, graded: 1 });

  const bare = loadRoutes({ exchangeTradingActive: async () => null, getScorecard: async () => ({}) }).createKalshiRoutes({ pool, appPackageDir: PKG });
  const unavailable = reply();
  await bare.routes.find((r) => r.method === 'post' && r.route === '/grade').handler({ ...PERSON, body: {} }, unavailable);
  assert.equal(unavailable.code, 503);
  assert.equal(unavailable.body.error, 'kalshi_market_reader_unavailable');
});

test('the background job a person already turned on grades on a tick where no scan is due', async (t) => {
  const pool = await ledger(t);
  const stand = await kalshi(t, { 'T-YES': 'yes', 'T-NO': 'no' });
  await predict(pool, { ticker: 'T-YES', p: 0.80, m: 0.60 });
  await predict(pool, { ticker: 'T-NO', p: 0.70, m: 0.55 });
  // A snapshot written just now: the hourly scan is not due.
  await pool.query(`INSERT INTO kalshi_scan_snapshots (id, payload, generated_at) VALUES (1, '{"hands":[]}'::jsonb, now())`);
  const was = process.env.OSHAL_EGRESS;
  process.env.OSHAL_EGRESS = 'kernel';
  t.after(() => { if (was === undefined) delete process.env.OSHAL_EGRESS; else process.env.OSHAL_EGRESS = was; });
  const router = loadRoutes(withFeed(stand.reader)).createKalshiRoutes({ pool, appPackageDir: PKG });
  const res = reply();
  await router.routes.find((r) => r.method === 'post' && r.route === '/scan/tick').handler(PERSON, res);
  assert.equal(res.code, 200, JSON.stringify(res.body));
  assert.equal(res.body.ran, false);
  assert.equal(res.body.reason, 'not_due');
  assert.deepEqual({ due: res.body.grading.due, graded: res.body.grading.graded, done: res.body.grading.done }, { due: 2, graded: 2, done: true });
  assert.equal((await grade.gradingSummary(pool)).graded, 2, 'the tick wrote the grades');
  const { rows } = await pool.query('SELECT generated_at FROM kalshi_scan_snapshots WHERE id = 1');
  assert.ok(Date.now() - new Date(rows[0].generated_at).getTime() < 60_000, 'the tick did not scan');
});

test('the fee and the grade are the retired grader\'s: a ten-contract clip rounded up to the cent, per contract', () => {
  near(grade.feePerContract(0.60), 0.017, 'fee at 60c');
  near(grade.feePerContract(0.42), 0.018, 'fee at 42c');
  near(grade.feePerContract(0.50), 0.018, 'fee at 50c');
  near(grade.feePerContract(0.99), 0.001, 'fee at 99c');
  const g = grade.gradeOf({ side: 'no', predictedProb: 0.9, marketProb: 0.8 }, false);
  assert.equal(g.settledYes, false);
  near(g.brier, 0.01, 'our side NO won at 90%'); near(g.marketBrier, 0.04, 'the market had it at 80%');
  near(g.pnlPerContract, 1 - 0.8 - grade.feePerContract(0.8), 'the win');
  assert.equal(grade.GRADE_LOOKUP_SIZE, 40);
  assert.ok(grade.GRADE_BUDGET_MS <= 45_000, 'a run leaves the kernel\'s 60-second call room for a lookup in flight and its writes');
});
