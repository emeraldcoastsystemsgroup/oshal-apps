/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Linear regression and hypothesis tests for the quant's math core: ordinary least squares with classical and Newey-West (autocorrelation- and heteroskedasticity-robust) standard errors, t-statistics and p-values, R-squared; one-sample and Welch two-sample t-tests; autocorrelation and the Ljung-Box test.
 */
'use strict';
const { fail, integer, numbers } = require('./checks');
const { transpose, multiply, matVec, inverse } = require('./linalg');
const { mean, variance } = require('./stats');
const { twoSidedT, chiSquare } = require('./distributions');

/**
 * @description The design matrix rows: an optional leading 1 then each regressor's value.
 * @param {number[][]} columns - Regressors as series of equal length.
 * @param {number} n - Observations.
 * @param {boolean} intercept - Whether to lead with a constant.
 * @returns {number[][]} Rows (n x k).
 */
function designRows(columns, n, intercept) {
  return Array.from({ length: n }, (_, t) => (intercept ? [1] : []).concat(columns.map((c) => c[t])));
}

/**
 * @description The Newey-West rule-of-thumb lag count for n observations: floor(4 (n / 100)^(2/9)).
 * @param {number} n - Observations.
 * @returns {number} Lags.
 */
function neweyWestLags(n) {
  return Math.floor(4 * (n / 100) ** (2 / 9));
}

/**
 * @description The Newey-West "meat": sum of e_t^2 x_t x_t' plus Bartlett-weighted cross products up to L lags.
 * @param {number[][]} rows - Design rows.
 * @param {number[]} e - Residuals.
 * @param {number} lags - Lag count L (0 gives White's heteroskedasticity-robust estimator).
 * @returns {number[][]} The k x k matrix.
 */
function hacMeat(rows, e, lags) {
  const k = rows[0].length, s = Array.from({ length: k }, () => new Array(k).fill(0));
  for (let l = 0; l <= lags; l += 1) {
    const w = l === 0 ? 1 : 1 - l / (lags + 1);
    for (let t = l; t < rows.length; t += 1) {
      const f = w * e[t] * e[t - l], a = rows[t], b = rows[t - l];
      for (let i = 0; i < k; i += 1) {
        for (let j = 0; j < k; j += 1) s[i][j] += l === 0 ? f * a[i] * a[j] : f * (a[i] * b[j] + b[i] * a[j]);
      }
    }
  }
  return s;
}

/**
 * @description Check and shape the inputs of a regression.
 * @param {number[]} y - Dependent series.
 * @param {number[][]} columns - Regressors.
 * @param {boolean} intercept - Constant included.
 * @returns {{n:number, k:number}} Sizes.
 */
function regressionShape(y, columns, intercept) {
  numbers(y, 'y', 3);
  if (!Array.isArray(columns)) throw fail('Regressors must be a list of series.');
  for (const c of columns) { numbers(c, 'each regressor', 3); if (c.length !== y.length) throw fail('Every regressor must have as many values as y.'); }
  const k = columns.length + (intercept ? 1 : 0);
  if (!k) throw fail('A regression needs a constant or at least one regressor.');
  if (y.length <= k) throw fail(`A regression with ${k} coefficients needs more than ${k} observations.`);
  return { n: y.length, k };
}

/**
 * @description Ordinary least squares: y = b0 + b1 x1 + ... + e, with classical and (optionally) Newey-West standard errors.
 * Newey-West errors stay honest when returns are autocorrelated or their volatility changes; no small-sample correction.
 * @param {number[]} y - Dependent series.
 * @param {number[][]} columns - Regressors as series.
 * @param {{intercept?:boolean, names?:string[], hacLags?:number|'auto'|null}} [options] - Constant (default true), names, HAC lags.
 * @returns {object} {coefficients:[{name, estimate, se, t, pValue}], r2, adjR2, n, k, sigma, residuals, fitted, errors}.
 */
function ols(y, columns, { intercept = true, names = [], hacLags = null } = {}) {
  const { n, k } = regressionShape(y, columns, intercept);
  const rows = designRows(columns, n, intercept), xt = transpose(rows), bread = inverse(multiply(xt, rows));
  const beta = matVec(bread, matVec(xt, y)), fitted = rows.map((r) => r.reduce((s, x, j) => s + x * beta[j], 0));
  const residuals = y.map((v, t) => v - fitted[t]), sse = residuals.reduce((s, e) => s + e * e, 0);
  const sigma2 = sse / (n - k), lags = hacLags === 'auto' ? neweyWestLags(n) : hacLags;
  const cov = lags == null ? bread.map((row) => row.map((x) => x * sigma2)) : multiply(multiply(bread, hacMeat(rows, residuals, integer(lags, 'hacLags', 0, n - 2))), bread);
  const labels = (intercept ? ['const'] : []).concat(columns.map((_, i) => names[i] || `x${i + 1}`));
  const coefficients = beta.map((b, j) => {
    const se = Math.sqrt(Math.max(0, cov[j][j])), t = se > 0 ? b / se : null;
    return { name: labels[j], estimate: b, se, t, pValue: t == null ? null : twoSidedT(t, n - k) };
  });
  const sst = intercept ? variance(y) * (n - 1) : y.reduce((s, v) => s + v * v, 0);
  const r2 = sst > 0 ? 1 - sse / sst : null;
  return { coefficients, r2, adjR2: r2 == null ? null : 1 - (1 - r2) * (n - (intercept ? 1 : 0)) / (n - k), n, k, sigma: Math.sqrt(sigma2), residuals, fitted, errors: lags == null ? 'classical' : `newey-west(${lags})` };
}

/**
 * @description One-sample t-test of whether a mean differs from a hypothesized value (two-sided).
 * @param {number[]} values - Sample (at least 2).
 * @param {number} [mu0] - Hypothesized mean (0).
 * @returns {{mean:number, t:number, df:number, pValue:number}} The test.
 */
function oneSampleT(values, mu0 = 0) {
  numbers(values, 'values', 2);
  const m = mean(values), se = Math.sqrt(variance(values) / values.length);
  if (!(se > 0)) throw fail('Values that never vary cannot be tested.');
  const t = (m - mu0) / se, df = values.length - 1;
  return { mean: m, t, df, pValue: twoSidedT(t, df) };
}

/**
 * @description Welch's two-sample t-test of whether two means differ, without assuming equal spreads (two-sided).
 * @param {number[]} a - First sample (at least 2).
 * @param {number[]} b - Second sample (at least 2).
 * @returns {{difference:number, t:number, df:number, pValue:number}} The test.
 */
function welchT(a, b) {
  numbers(a, 'a', 2); numbers(b, 'b', 2);
  const va = variance(a) / a.length, vb = variance(b) / b.length;
  if (!(va + vb > 0)) throw fail('Samples that never vary cannot be tested.');
  const t = (mean(a) - mean(b)) / Math.sqrt(va + vb), df = (va + vb) ** 2 / (va ** 2 / (a.length - 1) + vb ** 2 / (b.length - 1));
  return { difference: mean(a) - mean(b), t, df, pValue: twoSidedT(t, df) };
}

/**
 * @description The sample autocorrelation at one lag: how much a value echoes the value lag periods before.
 * @param {number[]} values - Series.
 * @param {number} lag - Lag (1 or more, below the length).
 * @returns {number} The autocorrelation.
 */
function autocorrelation(values, lag) {
  numbers(values, 'values', 3);
  integer(lag, 'lag', 1, values.length - 2);
  const m = mean(values);
  let num = 0, den = 0;
  for (let t = 0; t < values.length; t += 1) {
    den += (values[t] - m) ** 2;
    if (t >= lag) num += (values[t] - m) * (values[t - lag] - m);
  }
  if (!(den > 0)) throw fail('A series that never changes has no autocorrelation.');
  return num / den;
}

/**
 * @description The Ljung-Box test that the first h autocorrelations are all zero (as a random walk's returns would be).
 * @param {number[]} values - Series (returns).
 * @param {number} [lags] - h (10).
 * @returns {{statistic:number, pValue:number, lags:number, autocorrelations:number[]}} The test.
 */
function ljungBox(values, lags = 10) {
  numbers(values, 'values', lags + 3);
  const n = values.length, rho = Array.from({ length: lags }, (_, i) => autocorrelation(values, i + 1));
  const statistic = n * (n + 2) * rho.reduce((s, r, i) => s + r * r / (n - i - 1), 0);
  return { statistic, pValue: chiSquare(statistic, lags).pValue, lags, autocorrelations: rho };
}

module.exports = { neweyWestLags, ols, oneSampleT, welchT, autocorrelation, ljungBox };
