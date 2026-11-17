/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guards the quant's volatility models: GARCH(1,1) and GJR-GARCH recover the parameters of simulated series within tolerance (the fit is the likelihood's maximum: an independent scipy fit of the same series agreed to every printed digit during development), the forecast decays to the long-run level, the asymmetry test finds GJR data and not GARCH data, EWMA, Parkinson and Garman-Klass estimate a known volatility, and volatility targeting caps exposure.
 */
'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { volatility: v, random, stats } = require('../routes/quant/math');

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

test('GARCH(1,1) recovers the parameters of simulated series', () => {
  const truth = { omega: 1e-5, alpha: 0.08, beta: 0.89 };
  for (const seed of [7, 11, 2024]) {
    const fit = v.fitGarch(v.simulateGarch({ ...truth, n: 10000, seed }));
    assert.equal(fit.converged, true);
    near(fit.alpha, truth.alpha, 0.025, `alpha seed ${seed}`);
    near(fit.beta, truth.beta, 0.03, `beta seed ${seed}`);
    near(fit.persistence, 0.97, 0.012, `persistence seed ${seed}`);
    near(fit.longRunVolatility, Math.sqrt(truth.omega / 0.03 * 252), 0.05, `long-run volatility seed ${seed}`);
    assert.equal(fit.gamma, 0);
  }
});

test('GJR-GARCH recovers the extra weight on falls', () => {
  const truth = { omega: 1e-5, alpha: 0.03, beta: 0.88, gamma: 0.12 };
  for (const seed of [7, 11]) {
    const fit = v.fitGarch(v.simulateGarch({ ...truth, n: 10000, seed }), { model: 'gjr' });
    near(fit.alpha, truth.alpha, 0.025, `alpha seed ${seed}`);
    near(fit.gamma, truth.gamma, 0.04, `gamma seed ${seed}`);
    near(fit.beta, truth.beta, 0.03, `beta seed ${seed}`);
    near(fit.persistence, truth.alpha + truth.beta + truth.gamma / 2, 0.012, `persistence seed ${seed}`);
  }
});

test('the fit is the maximum of the likelihood: moving any parameter lowers it', () => {
  const r = v.simulateGarch({ omega: 1e-5, alpha: 0.08, beta: 0.89, n: 4000, seed: 7 }), fit = v.fitGarch(r);
  const e = r.map((x) => x - stats.mean(r)), start = stats.variance(e), best = v.logLikelihood(e, fit, start);
  near(best, fit.logLikelihood, 1e-6, 'reported likelihood');
  near(fit.alpha, 0.0608999145, 2e-4, 'alpha matches an independent scipy maximum of this series');
  near(fit.beta, 0.912392330, 2e-4, 'beta matches it too');
  for (const [k, step] of [['omega', 1e-6], ['alpha', 0.01], ['beta', 0.01]]) {
    for (const sign of [-1, 1]) assert.ok(v.logLikelihood(e, { ...fit, [k]: fit[k] + sign * step }, start) < best, `${k} ${sign > 0 ? 'up' : 'down'}`);
  }
});

test('the forecast decays from tomorrow toward the long-run volatility', () => {
  const fit = v.fitGarch(v.simulateGarch({ omega: 1e-5, alpha: 0.08, beta: 0.89, n: 4000, seed: 11 }));
  const f = v.forecastGarch(fit, 2520), day = f.dailyVariances, longRun = fit.omega / (1 - fit.persistence);
  near(day[0], fit.nextVariance, 1e-15, 'day one is tomorrow');
  near(day.at(-1), longRun, Math.abs(fit.nextVariance - longRun) * 1e-6 + 1e-12, 'far out is the long run');
  const gap = day.map((x) => x - longRun);
  for (let h = 1; h < 50; h += 1) near(gap[h], gap[h - 1] * fit.persistence, 1e-15, `decays at the persistence rate, day ${h}`);
});

test('the asymmetry test finds GJR data and not plain GARCH data', () => {
  const gjrData = v.simulateGarch({ omega: 1e-5, alpha: 0.02, beta: 0.88, gamma: 0.15, n: 6000, seed: 3 });
  const plain = v.simulateGarch({ omega: 1e-5, alpha: 0.08, beta: 0.89, n: 6000, seed: 3 });
  assert.ok(v.asymmetryTest(v.fitGarch(gjrData), v.fitGarch(gjrData, { model: 'gjr' })).pValue < 0.001, 'asymmetry found');
  assert.ok(v.asymmetryTest(v.fitGarch(plain), v.fitGarch(plain, { model: 'gjr' })).pValue > 0.05, 'none invented');
});

test('EWMA, Parkinson and Garman-Klass estimate a known daily volatility', () => {
  const rng = random.randomSource(21), sigma = 0.015, opens = [], highs = [], lows = [], closes = [], returns = [];
  let price = 100;
  for (let d = 0; d < 1500; d += 1) {
    let hi = price, lo = price;
    const open = price;
    for (let k = 0; k < 390; k += 1) { price *= Math.exp(sigma / Math.sqrt(390) * rng.normal() - sigma * sigma / 780); hi = Math.max(hi, price); lo = Math.min(lo, price); }
    opens.push(open); highs.push(hi); lows.push(lo); closes.push(price); returns.push(price / open - 1);
  }
  near(v.ewmaVolatility(returns).daily, sigma, 0.004, 'EWMA (recent days only, so noisier)');
  near(v.parkinsonVolatility(highs, lows).daily, sigma, 0.0012, 'Parkinson');
  near(v.garmanKlassVolatility({ opens, highs, lows, closes }).daily, sigma, 0.0008, 'Garman-Klass');
  near(v.parkinsonVolatility(highs, lows).annual, v.parkinsonVolatility(highs, lows).daily * Math.sqrt(252), 1e-15, 'annualized by sqrt(252)');
  assert.throws(() => v.parkinsonVolatility([1, 2], [2, 1]), /high is below its low/);
});

test('volatility targeting scales exposure by target over forecast and respects the cap', () => {
  near(v.volatilityTarget({ targetVolatility: 0.1, forecastVolatility: 0.2 }).exposure, 0.5, 1e-15, 'half when twice as volatile');
  const capped = v.volatilityTarget({ targetVolatility: 0.15, forecastVolatility: 0.1 });
  assert.deepEqual(capped, { exposure: 1, capped: true }, 'never borrows unless allowed');
  near(v.volatilityTarget({ targetVolatility: 0.15, forecastVolatility: 0.1, maxLeverage: 2 }).exposure, 1.5, 1e-15, 'with leverage allowed');
  assert.throws(() => v.fitGarch([0.01, 0.02]), /at least 100/);
});
