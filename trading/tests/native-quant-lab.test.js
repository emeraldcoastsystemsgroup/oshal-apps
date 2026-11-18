/** CHANGE LOG
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.62.1: the kept-prices guard goes with the process copy it guarded, which never hit on the native kernel (every non-GET call from a caller who can write runs in a fresh process).
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.61.3: archived day prices are kept in the process ten minutes per name and window, shared by every caller (public market data): the same names read nothing, a new name reads only itself, a shorter window is its own copy, a name the archive lacks is asked again, and the answer is the same kept or read. On blue the World archive read was the whole cost of a stock answer without Schwab (1.8 to 2.0 s the first time a name was read after a while).
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guards the quant lab (the quant's tools) on made-up markets: all fifty ideas explained, the calculator on supplied numbers, a stock's five views over Schwab candles, the World archive used and labelled when no Schwab login is connected (and what its short history cannot support said plainly), a name without prices never given invented ones, every question bounded in names, days, paths and time, portfolios, pairs, Monte Carlo, the desk's backtest overfitting, and no order path.
 */
'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { labHandlers } = require('../routes/quant/lab-routes');
const { CONCEPTS } = require('../routes/quant/lab-concepts');
const { monthlyTable } = require('../routes/quant/history');
const store = require('../routes/quant/store');
const { NOW, candles, labContext } = require('./support/native-quant-lab-doubles');
const { memoryPool } = require('./support/native-quant-doubles');
const { randomSource } = require('../routes/quant/math/random');

/**
 * @description The lab's handlers over a made-up context.
 * @param {object} shape - labContext options.
 * @param {object} [extra] - Extra deps (readBudgetMs).
 * @returns {{h:object, reads:Array<object>}} Handlers and the read log.
 */
function lab(shape, extra = {}) {
  const { ctx, reads, fetch } = labContext(shape);
  return { h: labHandlers(ctx, { time: () => NOW, fetch, ...extra }), reads };
}
const post = (body) => ({ body });

test('explain answers all fifty ideas by id, name or alias, and suggests names when unsure', async () => {
  const { h } = lab({ schwab: true });
  assert.equal(CONCEPTS.length, 50, 'Roger named fifty ideas');
  for (const c of CONCEPTS) {
    for (const ask of [c.id, c.name, ...c.aliases]) assert.equal((await h.explain('alice', { params: { concept: ask } })).body.concept.id, c.id, ask);
    for (const field of ['plain', 'use', 'tool', 'pitfalls']) assert.ok(c[field].length > 20, `${c.id} ${field}`);
    assert.match(c.tool, /trading_quant_|trading_strategy_backtest/, `${c.id} names its tool`);
  }
  assert.equal((await h.explain('alice', { params: { concept: 'bid ask spread' } })).body.concept.id, 'order-book-spread');
  const unsure = (await h.explain('alice', { params: { concept: 'quantum entanglement' } })).body;
  assert.equal(unsure.ok, false); assert.equal(unsure.concepts.length, 50);
  assert.match(CONCEPTS.find((c) => c.id === 'order-book-spread').pitfalls, /depth of the book behind them is not available/);
});

test('calculate applies the math to supplied numbers, takes "5%" and text numbers, and names the kinds for an unknown one', async () => {
  const { h, reads } = lab({ schwab: true });
  const bs = (await h.calculate('alice', post({ kind: 'black-scholes', S: '100', K: 100, T: 1, r: '5%', sigma: 0.2 }))).body;
  assert.equal(bs.result.price, 10.4506); assert.equal(bs.researchOnly, true);
  assert.equal((await h.calculate('alice', post({ kind: 'kelly', inputs: { p: 0.6, b: 1 } }))).body.result.fraction, 0.2, 'numbers may sit under inputs');
  assert.equal((await h.calculate('alice', post({ kind: 'var', sd: 0.01 }))).body.result.normal.valueAtRisk, 0.0164485);
  assert.equal((await h.calculate('alice', post({ kind: 'expected-value', outcomes: [{ probability: 0.6, value: 100 }, { probability: 0.4, value: -100 }] }))).body.result.expectedValue, 20);
  assert.equal((await h.calculate('alice', post({ kind: 'glosten-milgrom', high: 110, low: 90, informed: 0.2 }))).body.result.spread, 4);
  assert.throws(() => require('../routes/quant/lab-calculate').calculate({ kind: 'astrology' }), (err) => err.status === 400 && /black-scholes/.test(err.message));
  assert.equal(reads.length, 0, 'the calculator reads no prices');
});

test("a stock's five views run over the caller's own Schwab candles", async () => {
  const { h, reads } = lab({ schwab: true });
  const risk = (await h.stock('alice', post({ symbol: 'aapl', view: 'risk', confidence: 0.99, horizonDays: 10 }))).body;
  assert.equal(risk.source, 'schwab'); assert.equal(risk.symbol, 'AAPL'); assert.equal(risk.sessions, 505);
  assert.ok(risk.result.valueAtRisk.cornishFisher.valueAtRisk > 0 && risk.result.valueAtRisk.horizonDays === 10);
  assert.ok(risk.result.volatility.squareRootOfTime.year > risk.result.volatility.daily * 15);
  const vol = (await h.stock('alice', post({ symbol: 'AAPL', view: 'volatility' }))).body.result;
  assert.ok(vol.garch.persistence > 0 && vol.gjr.model === 'gjr' && vol.forecast.averageVolatility > 0, 'GARCH and GJR fitted on five years');
  assert.ok(vol.parkinson.annual > 0 && vol.garmanKlass.annual > 0, 'highs and lows from Schwab feed the range estimators');
  const liq = (await h.stock('alice', post({ symbol: 'AAPL', view: 'liquidity', shares: 10000 }))).body.result;
  assert.equal(liq.quoted.spreadBps, 4); assert.ok(liq.impact.impactBps > 0); assert.match(liq.orderBookDepth, /not available/);
  assert.ok(reads.some((r) => r.name === 'trading.quotes'), 'the Level 1 quote is read');
  const fac = (await h.stock('alice', post({ symbol: 'AAPL', view: 'factors', apt: ['XLE'] }))).body.result;
  assert.ok(fac.beta && fac.capm.beta && fac.threeFactorProxy.loadings.length === 3 && fac.apt.loadings[0].name === 'XLE');
  assert.match(fac.note, /proxies/);
  assert.equal((await h.stock('alice', post({ symbol: 'SPY', view: 'factors' }))).body.result.beta.beta, 1, "SPY's own beta against itself");
  const beh = (await h.stock('alice', post({ symbol: 'AAPL', view: 'behavior' }))).body.result;
  assert.ok(beh.adf.statistic < 0 && typeof beh.verdict === 'string' && beh.varianceRatios.length === 3);
});

test('without Schwab the views read the World archive, label it, and say what its short history cannot support', async () => {
  const { h, reads } = lab({ schwab: false, archiveDays: 25 });
  const vol = (await h.stock('alice', post({ symbol: 'SPY', view: 'volatility' }))).body;
  assert.equal(vol.source, 'world-archive'); assert.match(vol.sourceNote, /not official exchange closes/);
  assert.match(vol.result.garch.unavailable, /needs at least 250 daily returns; this history has 24/);
  assert.match(vol.result.parkinson.unavailable, /Schwab/);
  assert.ok(!reads.some((r) => r.name === 'trading.bars'), 'no Schwab read without a Schwab login');
  assert.equal(reads.filter((r) => r.name === 'prices.series')[0].input.interval, 'day');
  const risk = (await h.stock('alice', post({ symbol: 'SPY', view: 'risk' }))).body;
  assert.equal(risk.sessions, 25); assert.match(risk.result.fatTails.unavailable, /needs at least 50/);
});

test('a name with no prices says why, and no number is invented for it', async () => {
  const { h } = lab({ schwab: false, archiveMissing: ['ZZZZ'] });
  const none = (await h.stock('alice', post({ symbol: 'ZZZZ', view: 'risk' }))).body;
  assert.equal(none.ok, false); assert.equal(none.result, undefined);
  assert.match(none.missing[0].reason, /no recorded prices/);
});

test('every question is bounded: names, days, paths, horizon, view and method', async () => {
  const { h } = lab({ schwab: true });
  const refused = async (call, pattern) => assert.rejects(call, (err) => err.status === 400 && pattern.test(err.message));
  await refused(h.portfolio('alice', post({ symbols: 'A,B,C,D,E,F,G', method: 'risk-parity' })), /At most 6 tickers/);
  await refused(h.stock('alice', post({ symbol: 'AAPL', view: 'risk', days: 5000 })), /days must be a whole number from 20 to 2520/);
  await refused(h.simulate('alice', post({ symbol: 'AAPL', horizonDays: 21, paths: 50000 })), /paths must be a whole number from 100 to 20000/);
  await refused(h.simulate('alice', post({ symbol: 'AAPL', horizonDays: 2000 })), /horizonDays/);
  await refused(h.stock('alice', post({ symbol: 'AAPL', view: 'astrology' })), /view must be one of/);
  await refused(h.portfolio('alice', post({ symbols: 'A,B', method: 'yolo' })), /method must be one of/);
  await refused(h.stock('alice', post({ symbol: 'not a ticker!', view: 'risk' })), /is not a ticker/);
});

test('a slow Schwab read is answered without, inside the read budget', async () => {
  const { h } = lab({ schwab: true, barsDelayMs: 600 }, { readBudgetMs: 100 });
  const started = Date.now(), body = (await h.stock('alice', post({ symbol: 'AAPL', view: 'risk' }))).body;
  assert.ok(Date.now() - started < 500, `answered in ${Date.now() - started} ms`);
  assert.equal(body.ok, false); assert.match(body.missing[0].reason, /had not answered within the time/);
});

test('portfolios: risk parity, the frontier, Black-Litterman views, Kelly and volatility targeting', async () => {
  const { h } = lab({ schwab: true });
  const names = 'AAPL,MSFT,XOM,JNJ';
  const rp = (await h.portfolio('alice', post({ symbols: names, method: 'risk-parity' }))).body.result;
  for (const c of Object.values(rp.riskContributions)) assert.ok(Math.abs(c - 0.25) < 1e-4);
  const fr = (await h.portfolio('alice', post({ symbols: names, method: 'frontier' }))).body.result;
  assert.ok(Math.abs(Object.values(fr.minimumVariance).reduce((a, b) => a + b, 0) - 1) < 1e-3 && fr.points.length === 5);
  const plain = (await h.portfolio('alice', post({ symbols: names, method: 'black-litterman' }))).body.result;
  const viewed = (await h.portfolio('alice', post({ symbols: names, method: 'black-litterman', views: [{ symbol: 'XOM', expectedReturn: 0.2 }] }))).body.result;
  assert.ok(viewed.posterior.XOM > plain.posterior.XOM && viewed.viewsUsed === 1);
  assert.ok(Number.isFinite((await h.portfolio('alice', post({ symbols: names, method: 'kelly' }))).body.result.leverage));
  assert.ok((await h.portfolio('alice', post({ symbols: names, method: 'vol-target', targetVolatility: 0.05 }))).body.result.exposure < 1);
});

test('pairs: a tied pair is cointegrated and its Kalman hedge ratio is near the truth; an unrelated pair is not tied', async () => {
  const base = candles({ seed: 5, n: 800 }), rng = randomSource(6);
  let gap = 0;
  const tied = base.map((b) => { gap = 0.7 * gap + 0.01 * rng.normal(); const c = b.c * Math.exp(gap); return { ...b, o: c, h: c * 1.002, l: c * 0.998, c }; });
  const { h } = lab({ schwab: true, custom: { AAA: tied, BBB: base } });
  const pair = (await h.pair('alice', post({ a: 'AAA', b: 'BBB' }))).body;
  assert.ok(pair.cointegration.cointegratedAt, JSON.stringify(pair.cointegration));
  assert.ok(Math.abs(pair.kalman.latestHedgeRatio - 1) < 0.15 && pair.halfLife.halfLife > 0);
  const loose = (await h.pair('alice', post({ a: 'AAA', b: 'ZZZ' }))).body;
  assert.equal(loose.cointegration.cointegratedAt, null);
});

test('Monte Carlo: geometric Brownian motion and a bootstrap of real days; a short archive history is refused with its count', async () => {
  const { h } = lab({ schwab: true });
  const gbm = (await h.simulate('alice', post({ symbol: 'AAPL', horizonDays: 63 }))).body;
  assert.ok(gbm.end.percentiles.p5 < gbm.end.percentiles.p50 && gbm.end.percentiles.p50 < gbm.end.percentiles.p95 && gbm.theory.mean > 0);
  const boot = (await h.simulate('alice', post({ symbol: 'AAPL', horizonDays: 21, method: 'bootstrap', paths: 2000 }))).body;
  assert.equal(boot.end.paths, 2000);
  const short = (await lab({ schwab: false }).h.simulate('alice', post({ symbol: 'SPY', horizonDays: 21, method: 'bootstrap' }))).body;
  assert.equal(short.ok, false); assert.match(short.message, /needs at least 30 daily returns; this history has 24/);
});

test("backtest overfitting over the desk's own history: none yet, an older history, and a full one", async () => {
  const pool = memoryPool(), { ctx, fetch } = labContext({ schwab: true }), h = labHandlers({ ...ctx, pool }, { time: () => NOW, fetch });
  assert.match((await h.overfitting('alice')).body.message, /has not published a history test yet/);
  await store.putRecord(pool, 'alice', 'history', 'current', { at: 'then', signals: [] });
  assert.match((await h.overfitting('alice')).body.message, /predates the monthly results/);
  const rng = randomSource(3), months = Array.from({ length: 96 }, (_, i) => `20${String(18 + Math.floor(i / 12)).padStart(2, '0')}-${String((i % 12) + 1).padStart(2, '0')}`);
  const series = new Map(['momentum', 'trend', 'high52', 'lowvol', 'reversal', 'dip', 'composite'].map((id) => [id, months.map((month) => ({ month, list: 0.01, net: 0.01 + (id === 'momentum' ? 0.02 : 0) + 0.03 * rng.normal() }))]));
  await store.putRecord(pool, 'alice', 'history', 'current', { at: 'now', signals: [{ id: 'momentum', name: '12-month momentum' }], monthly: monthlyTable(series) });
  const report = (await h.overfitting('alice')).body;
  assert.equal(report.ready, true); assert.equal(report.trials, 7); assert.equal(report.months, 96);
  assert.equal([...report.signals].sort((a, b) => b.annualSharpe - a.annualSharpe)[0].id, 'momentum');
  assert.ok(report.pbo.pbo < 0.2, `a real edge is rarely an overfit pick (PBO ${report.pbo.pbo})`);
  assert.match(report.plain[2], /survivorship/);
});

test('the largest questions answer well inside two seconds', async () => {
  const { h } = lab({ schwab: true });
  for (const call of [() => h.stock('alice', post({ symbol: 'AAPL', view: 'volatility', days: 2520 })), () => h.portfolio('alice', post({ symbols: 'A,B,C,D,E,F', method: 'frontier', days: 2520 })), () => h.simulate('alice', post({ symbol: 'AAPL', horizonDays: 756, paths: 20000 }))]) {
    const started = Date.now();
    await call();
    assert.ok(Date.now() - started < 2000, `answered in ${Date.now() - started} ms`);
  }
});

test('the lab reads only market data and has no order path', () => {
  const dir = path.join(__dirname, '../routes/quant'), files = fs.readdirSync(dir).filter((f) => f.startsWith('lab-'));
  assert.ok(files.length >= 8);
  const intents = new Set();
  for (const file of files) {
    const src = fs.readFileSync(path.join(dir, file), 'utf8');
    for (const m of src.matchAll(/intent\(\s*['"]([^'"]+)['"]/g)) intents.add(m[1]);
    assert.doesNotMatch(src, /trading\.orders|mandate|protection|require\(['"][^'"]*(live\/|trading-native-management|trading-manual-order|portfolio-store)/, file);
  }
  assert.deepEqual([...intents].sort(), ['prices.series', 'trading.bars', 'trading.chains', 'trading.config', 'trading.quotes']);
});
