/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guards the quant's random-walk and mean-reversion tests: the augmented Dickey-Fuller statistic matches an independent numpy regression and MacKinnon's critical values (checked against a Monte Carlo of the Dickey-Fuller distribution during development), a random walk is not rejected and a mean-reverting series is, Engle-Granger finds a cointegrated pair and not two unrelated walks, the half-life matches theory, the Hurst exponent and the variance ratio read a random walk as one, and a Kalman filter tracks a drifting hedge ratio far better than one fixed ratio.
 */
'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { timeseries: ts, kalman, random, stats } = require('../routes/quant/math');

/**
 * @description Assert two numbers agree within a tolerance.
 * @param {number} actual - Computed.
 * @param {number} expected - Reference.
 * @param {number} tol - Tolerance.
 * @param {string} label - Name.
 * @returns {void}
 */
function near(actual, expected, tol, label) {
  assert.ok(Math.abs(actual - expected) <= tol, `${label}: ${actual} vs ${expected} (tolerance ${tol})`);
}

/**
 * @description A random walk and an AR(1) series from one seeded source.
 * @param {number} seed - Seed.
 * @param {number} n - Length.
 * @param {number} phi - AR coefficient of the mean-reverting series.
 * @returns {{walk:number[], reverting:number[]}} The two series.
 */
function walkAndReverting(seed, n, phi) {
  const rng = random.randomSource(seed), walk = [0], reverting = [0];
  for (let t = 1; t < n; t += 1) { walk.push(walk[t - 1] + rng.normal()); reverting.push(phi * reverting[t - 1] + rng.normal()); }
  return { walk, reverting };
}

test('ADF: the statistic matches an independent numpy regression; a random walk is not rejected and an AR(1) is', () => {
  const rng = random.randomSource(42);
  for (let t = 0; t < 300; t += 1) { rng.normal(); rng.normal(); rng.normal(); }
  const walk = [0], reverting = [0];
  for (let t = 1; t < 1000; t += 1) { walk.push(walk[t - 1] + rng.normal()); reverting.push(0.9 * reverting[t - 1] + rng.normal()); }
  near(ts.adf(walk, { lags: 0 }).statistic, -1.6418502211641997, 1e-9, 'walk, no lags (numpy)');
  near(ts.adf(walk, { lags: 3 }).statistic, -1.7093332383851678, 1e-9, 'walk, 3 lags (numpy)');
  near(ts.adf(reverting, { lags: 3 }).statistic, -8.040857259755404, 1e-9, 'AR(1), 3 lags (numpy)');
  const w = ts.adf(walk), r = ts.adf(reverting);
  assert.equal(w.rejectsRandomWalkAt, null, 'a random walk looks like one');
  assert.equal(r.rejectsRandomWalkAt, '1%', 'a mean-reverting series does not');
});

test('MacKinnon critical values: the asymptotic table and the small-sample adjustment', () => {
  near(ts.criticalValues(1, 'c', 1e12)['5%'], -2.86154, 1e-9, 'constant, 5%');
  near(ts.criticalValues(1, 'ct', 1e12)['1%'], -3.95877, 1e-9, 'trend, 1%');
  near(ts.criticalValues(1, 'n', 1e12)['10%'], -1.61682, 1e-9, 'none, 10%');
  near(ts.criticalValues(2, 'c', 1e12)['5%'], -3.33613, 1e-9, 'Engle-Granger pair, 5%');
  near(ts.criticalValues(1, 'c', 250)['5%'], -2.86154 - 2.8903 / 250 - 4.234 / 250 ** 2 - 40.04 / 250 ** 3, 1e-12, 'T = 250');
  assert.ok(ts.criticalValues(1, 'c', 50)['5%'] < ts.criticalValues(1, 'c', 5000)['5%'], 'short samples need a more negative statistic');
});

test('Engle-Granger: a cointegrated pair is found and two unrelated random walks are not', () => {
  const rng = random.randomSource(17), x = [100], tied = [], loose = [50];
  for (let t = 1; t < 1000; t += 1) x.push(x[t - 1] + rng.normal());
  let gap = 0;
  for (let t = 0; t < 1000; t += 1) { gap = 0.8 * gap + rng.normal(); tied.push(5 + 1.5 * x[t] + gap); if (t) loose.push(loose[t - 1] + rng.normal()); }
  const eg = ts.engleGranger(tied, x);
  near(eg.hedgeRatio, 1.5, 0.05, 'hedge ratio');
  assert.equal(eg.cointegratedAt, '1%');
  assert.equal(ts.engleGranger(loose, x).cointegratedAt, null, 'two unrelated walks are not tied together');
});

test('half-life of mean reversion: ln(0.5) / ln(phi) for an AR(1)', () => {
  const { reverting, walk } = walkAndReverting(23, 20000, 0.9);
  const hl = ts.halfLife(reverting);
  near(hl.halfLife, Math.log(0.5) / Math.log(0.9), 0.6, 'phi 0.9: about 6.6 periods');
  near(hl.phi, 0.9, 0.01, 'phi');
  assert.ok(ts.halfLife(walk).halfLife == null || ts.halfLife(walk).halfLife > 500, 'a random walk has no useful half-life');
});

test('Hurst exponent: about 0.5 for a random walk, below for mean reversion, above for trending returns', () => {
  for (const seed of [1, 2, 3]) {
    const { walk, reverting } = walkAndReverting(seed, 6000, 0.9);
    near(ts.hurst(walk).hurst, 0.5, 0.06, `random walk seed ${seed}`);
    assert.ok(ts.hurst(reverting).hurst < 0.3, `mean reverting seed ${seed}`);
  }
  const rng = random.randomSource(5), trend = [0];
  let e = 0;
  for (let t = 1; t < 6000; t += 1) { e = 0.6 * e + rng.normal(); trend.push(trend[t - 1] + e); }
  assert.ok(ts.hurst(trend, { maxLag: 10 }).hurst > 0.6, 'returns that echo trend');
});

test('variance ratio: 1 for a random walk, above 1 when returns echo', () => {
  const { walk } = walkAndReverting(31, 4000, 0.9), vr = ts.varianceRatio(walk, 5);
  near(vr.ratio, 1, 0.1, 'walk ratio');
  assert.ok(vr.pValue > 0.05, 'not rejected');
  const rng = random.randomSource(32), echo = [0];
  let e = 0;
  for (let t = 1; t < 4000; t += 1) { e = 0.3 * e + rng.normal(); echo.push(echo[t - 1] + e); }
  const v2 = ts.varianceRatio(echo, 5);
  assert.ok(v2.ratio > 1.3 && v2.pValue < 1e-6, `trending returns: ratio ${v2.ratio}, p ${v2.pValue}`);
  near(ts.zScore([1, 2, 3, 4, 10], 5).z, (10 - 4) / stats.stdev([1, 2, 3, 4, 10]), 1e-12, 'z-score of the latest value');
});

test('a Kalman filter tracks a drifting hedge ratio that one fixed ratio cannot', () => {
  const rng = random.randomSource(12), n = 1500, x = [100];
  for (let t = 1; t < n; t += 1) x.push(x[t - 1] + rng.normal());
  const beta = x.map((_, t) => 1 + t / n), y = x.map((v, t) => beta[t] * v + 5 + 0.5 * rng.normal());
  const k = kalman.dynamicHedgeRatio(y, x, { delta: 1e-5 });
  const rmse = (est) => Math.sqrt(stats.mean(est.slice(n / 2).map((b, i) => (b - beta[i + n / 2]) ** 2)));
  assert.ok(rmse(k.hedgeRatios) < 0.02, `Kalman tracking error ${rmse(k.hedgeRatios)}`);
  near(k.hedgeRatios.at(-1), beta.at(-1), 0.03, 'the latest ratio');
  assert.ok(rmse(beta.map(() => k.staticHedgeRatio)) > 10 * rmse(k.hedgeRatios), 'a fixed ratio is far worse');
  assert.ok(Number.isFinite(k.zScore), 'the spread has a z-score');
  near(k.observationVariance, 0.25, 0.15, 'the noise level is learned from the data');
  const level = kalman.kalmanFilter({ observations: [1, 1, 1, 1, 1], design: [[1], [1], [1], [1], [1]], F: [[1]], Q: [[0]], R: 1, x0: [0], P0: [[1e6]] });
  near(level.states.at(-1)[0], 1, 1e-5, 'a constant observed five times is learned');
});
