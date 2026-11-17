/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Random-walk and mean-reversion tests for the quant's math core: the augmented Dickey-Fuller test with MacKinnon (2010) critical values, Engle-Granger cointegration of a pair, the half-life of mean reversion, the Hurst exponent and the Lo-MacKinlay variance ratio. Each says plainly whether the series looks like a random walk.
 */
'use strict';
const { fail, integer, numbers } = require('./checks');
const { ols } = require('./regression');
const { mean, stdev } = require('./stats');
const { normalCdf } = require('./distributions');

/**
 * MacKinnon (2010) response-surface critical values: crit(T) = b0 + b1/T + b2/T^2 + b3/T^3, for 1%, 5% and 10%.
 * Keyed by number of variables (1 = unit-root test, 2 = Engle-Granger pair) and deterministic terms
 * ('n' none, 'c' constant, 'ct' constant and trend).
 */
const MACKINNON_2010 = Object.freeze({
  1: {
    n: [[-2.56574, -2.2358, -3.627, 0], [-1.941, -0.2686, -3.365, 31.223], [-1.61682, 0.2656, -2.714, 25.364]],
    c: [[-3.43035, -6.5393, -16.786, -79.433], [-2.86154, -2.8903, -4.234, -40.04], [-2.56677, -1.5384, -2.809, 0]],
    ct: [[-3.95877, -9.0531, -28.428, -134.155], [-3.41049, -4.3904, -9.036, -45.374], [-3.12705, -2.5856, -3.925, -22.38]],
  },
  2: {
    c: [[-3.89644, -10.9519, -22.527, 0], [-3.33613, -6.1101, -6.823, 0], [-3.04445, -4.2412, -2.72, 0]],
    ct: [[-4.32762, -15.4387, -35.679, 0], [-3.78057, -9.5106, -12.074, 0], [-3.49631, -7.0815, -7.538, 21.892]],
  },
});

/**
 * @description MacKinnon (2010) critical values at 1%, 5% and 10%.
 * @param {number} variables - 1 for a unit-root test, 2 for a cointegrated pair.
 * @param {string} trend - 'n', 'c' or 'ct'.
 * @param {number} nobs - Observations in the test regression.
 * @returns {{'1%':number, '5%':number, '10%':number}} Critical values (reject when the statistic is below).
 */
function criticalValues(variables, trend, nobs) {
  const table = MACKINNON_2010[variables] && MACKINNON_2010[variables][trend];
  if (!table) throw fail(`No critical values for ${variables} variables with trend ${trend}.`);
  const at = (b) => b[0] + b[1] / nobs + b[2] / nobs ** 2 + b[3] / nobs ** 3;
  return { '1%': at(table[0]), '5%': at(table[1]), '10%': at(table[2]) };
}

/**
 * @description The ADF regression for a fixed lag count, fitted from a given first observation so different lag counts share a sample.
 * @param {number[]} y - Series.
 * @param {number} lags - Lagged differences p.
 * @param {string} trend - 'n', 'c' or 'ct'.
 * @param {number} start - First index of Delta y used (at least lags + 1).
 * @returns {object} The OLS fit; its first slope is the coefficient on y[t-1].
 */
function adfRegression(y, lags, trend, start) {
  const dy = y.slice(1).map((v, i) => v - y[i]), rows = [];
  for (let t = start; t < y.length; t += 1) rows.push(t);
  const columns = [rows.map((t) => y[t - 1])];
  for (let i = 1; i <= lags; i += 1) columns.push(rows.map((t) => dy[t - 1 - i]));
  if (trend === 'ct') columns.push(rows.map((t) => t));
  return ols(rows.map((t) => dy[t - 1]), columns, { intercept: trend !== 'n' });
}

/**
 * @description The Akaike information criterion of a regression, for choosing a lag count.
 * @param {object} fit - OLS fit.
 * @returns {number} AIC.
 */
function aic(fit) {
  const sse = fit.residuals.reduce((s, e) => s + e * e, 0);
  return fit.n * Math.log(sse / fit.n) + 2 * fit.k;
}

/**
 * @description The augmented Dickey-Fuller test: does the series wander like a random walk (unit root), or is it pulled back to
 * a level (mean-reverting)? The statistic is the t-value of y[t-1]; below the 5% critical value, a random walk is rejected.
 * @param {number[]} y - Series (log prices or a spread), at least 20 values.
 * @param {{lags?:number|'aic', maxLags?:number, trend?:string, variables?:number}} [options] - Lagged differences (or AIC choice up to maxLags), trend 'n'/'c'/'ct'.
 * @returns {{statistic:number, lags:number, nobs:number, criticalValues:object, rejectsRandomWalkAt:string|null, gamma:number}} The test.
 */
function adf(y, { lags = 'aic', maxLags = null, trend = 'c', variables = 1 } = {}) {
  numbers(y, 'series', 20);
  if (!['n', 'c', 'ct'].includes(trend)) throw fail("trend must be 'n', 'c' or 'ct'.");
  let p = lags;
  if (lags === 'aic') {
    const top = maxLags == null ? Math.min(12, Math.floor(12 * (y.length / 100) ** 0.25)) : integer(maxLags, 'maxLags', 0, 24);
    let best = Infinity;
    for (let q = 0; q <= top; q += 1) {
      const score = aic(adfRegression(y, q, trend, top + 1));
      if (score < best) { best = score; p = q; }
    }
  } else integer(lags, 'lags', 0, Math.floor(y.length / 3));
  const fit = adfRegression(y, p, trend, p + 1), g = fit.coefficients[trend === 'n' ? 0 : 1];
  const crit = criticalValues(variables, trend, fit.n), statistic = g.t;
  const rejectsRandomWalkAt = ['1%', '5%', '10%'].find((level) => statistic < crit[level]) || null;
  return { statistic, lags: p, nobs: fit.n, criticalValues: crit, rejectsRandomWalkAt, gamma: g.estimate };
}

/**
 * @description Engle-Granger cointegration: two prices that each wander can still be tied together if a fixed mix of them
 * does not wander. Fits y = a + b x, then tests the leftover spread for a unit root with the pair's critical values.
 * @param {number[]} y - First series (log prices).
 * @param {number[]} x - Second series of the same length.
 * @param {{lags?:number|'aic'}} [options] - Lags of the residual test.
 * @returns {{hedgeRatio:number, intercept:number, spread:number[], adf:object, cointegratedAt:string|null}} The test.
 */
function engleGranger(y, x, { lags = 'aic' } = {}) {
  numbers(y, 'y', 30); numbers(x, 'x', 30);
  if (y.length !== x.length) throw fail('Both series must be the same length.');
  const fit = ols(y, [x]), [a, b] = fit.coefficients.map((c) => c.estimate);
  const test = adf(fit.residuals, { lags, trend: 'n' });
  const crit = criticalValues(2, 'c', y.length - 1);
  const cointegratedAt = ['1%', '5%', '10%'].find((level) => test.statistic < crit[level]) || null;
  return { hedgeRatio: b, intercept: a, spread: fit.residuals, adf: { ...test, criticalValues: crit, rejectsRandomWalkAt: cointegratedAt }, cointegratedAt };
}

/**
 * @description The half-life of mean reversion: fit Delta y[t] = a + b y[t-1]; a pull back of b per period halves a gap
 * in ln(0.5) / ln(1 + b) periods. A b at or above zero means no pull back at all.
 * @param {number[]} y - Series (a price, log price or spread).
 * @returns {{halfLife:number|null, phi:number, b:number, t:number, pValue:number, meanLevel:number|null}} The estimate.
 */
function halfLife(y) {
  numbers(y, 'series', 10);
  const fit = ols(y.slice(1).map((v, i) => v - y[i]), [y.slice(0, -1)]), [a, b] = fit.coefficients;
  const phi = 1 + b.estimate, reverting = b.estimate < 0 && phi > 0;
  return { halfLife: reverting ? Math.log(0.5) / Math.log(phi) : null, phi, b: b.estimate, t: b.t, pValue: b.pValue, meanLevel: reverting ? -a.estimate / b.estimate : null };
}

/**
 * @description The Hurst exponent from how the spread of tau-period changes grows with tau: about 0.5 for a random walk,
 * below 0.5 for a mean-reverting series, above 0.5 for a trending one.
 * @param {number[]} y - Series (log prices), at least 50 values.
 * @param {{maxLag?:number}} [options] - Largest tau (default min(100, n/4)).
 * @returns {{hurst:number, lags:number, r2:number}} The estimate.
 */
function hurst(y, { maxLag = null } = {}) {
  numbers(y, 'series', 50);
  const top = maxLag == null ? Math.min(100, Math.floor(y.length / 4)) : integer(maxLag, 'maxLag', 3, Math.floor(y.length / 2));
  const xs = [], ys = [];
  for (let tau = 2; tau <= top; tau += 1) {
    const diffs = y.slice(tau).map((v, i) => v - y[i]), sd = stdev(diffs);
    if (sd > 0) { xs.push(Math.log(tau)); ys.push(Math.log(sd)); }
  }
  if (xs.length < 3) throw fail('The series does not move enough to measure.');
  const fit = ols(ys, [xs]);
  return { hurst: fit.coefficients[1].estimate, lags: xs.length, r2: fit.r2 };
}

/**
 * @description The Lo-MacKinlay (1988) variance ratio: under a random walk the variance of q-period returns is q times the
 * one-period variance (ratio 1). Above 1 suggests trending, below 1 mean reversion. z is the plain test; zRobust allows
 * volatility that changes over time, and its p-value is the one to read.
 * @param {number[]} logPrices - Log prices, oldest first.
 * @param {number} q - Aggregation (2 or more).
 * @returns {{ratio:number, z:number, zRobust:number, pValue:number, q:number}} The test.
 */
function varianceRatio(logPrices, q) {
  numbers(logPrices, 'logPrices', 20);
  integer(q, 'q', 2, Math.floor((logPrices.length - 1) / 4));
  const n = logPrices.length - 1, r = logPrices.slice(1).map((v, i) => v - logPrices[i]), mu = (logPrices[n] - logPrices[0]) / n;
  const dev2 = r.map((x) => (x - mu) ** 2), total = dev2.reduce((s, v) => s + v, 0), varA = total / (n - 1);
  let varC = 0;
  for (let t = q; t <= n; t += 1) varC += (logPrices[t] - logPrices[t - q] - q * mu) ** 2;
  varC /= q * (n - q + 1) * (1 - q / n);
  const ratio = varC / varA, z = (ratio - 1) / Math.sqrt((2 * (2 * q - 1) * (q - 1)) / (3 * q * n));
  let theta = 0;
  for (let j = 1; j < q; j += 1) {
    let num = 0;
    for (let t = j; t < n; t += 1) num += dev2[t] * dev2[t - j];
    theta += (2 * (q - j) / q) ** 2 * (n * num / total ** 2);
  }
  // theta is the asymptotic variance of sqrt(n) (ratio - 1), so the ratio's own variance is theta / n.
  const zRobust = (ratio - 1) / Math.sqrt(theta / n);
  return { ratio, z, zRobust, pValue: 2 * normalCdf(-Math.abs(zRobust)), q };
}

/**
 * @description How far the latest value sits from its recent average, in standard deviations (a spread's entry gauge).
 * @param {number[]} y - Series.
 * @param {number} [window] - Look-back (60).
 * @returns {{z:number, mean:number, sd:number, window:number}} The z-score.
 */
function zScore(y, window = 60) {
  numbers(y, 'series', 3);
  const w = y.slice(-integer(window, 'window', 3, y.length)), m = mean(w), sd = stdev(w);
  if (!(sd > 0)) throw fail('The series does not move over that window.');
  return { z: (y[y.length - 1] - m) / sd, mean: m, sd, window: w.length };
}

module.exports = { MACKINNON_2010, criticalValues, adf, engleGranger, halfLife, hurst, varianceRatio, zScore };
