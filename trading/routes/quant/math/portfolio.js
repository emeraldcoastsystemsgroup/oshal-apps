/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Portfolio math for the quant's math core: covariance and correlation matrices, a portfolio's risk and each holding's share of it, diversification, the Markowitz efficient frontier (minimum variance, tangency, any target return, long-only), risk parity (equal risk contributions), Black-Litterman and the Kelly criterion (one bet, one asset, several assets).
 */
'use strict';
const { fail, finite, positive, probability, numbers } = require('./checks');
const { transpose, multiply, matVec, dot, inverse, add, scale } = require('./linalg');
const { mean, covariance } = require('./stats');

/**
 * @description Check a square symmetric covariance matrix and a vector that matches it.
 * @param {number[][]} sigma - Covariance matrix.
 * @param {number[]} [v] - Optional vector of the same size.
 * @returns {number} The size.
 */
function checkCovariance(sigma, v) {
  if (!Array.isArray(sigma) || !sigma.length || sigma.some((row) => !Array.isArray(row) || row.length !== sigma.length)) throw fail('The covariance matrix must be square.');
  sigma.forEach((row, i) => { numbers(row, 'covariance row'); if (!(row[i] > 0)) throw fail('Every asset needs a variance above zero.'); });
  for (let i = 0; i < sigma.length; i += 1) for (let j = 0; j < i; j += 1) if (Math.abs(sigma[i][j] - sigma[j][i]) > 1e-12 * (Math.abs(sigma[i][j]) + 1e-300)) throw fail('The covariance matrix must be symmetric.');
  if (v) { numbers(v, 'vector'); if (v.length !== sigma.length) throw fail('The vector must have one value per asset.'); }
  return sigma.length;
}

/**
 * @description The sample covariance matrix of several return series (one series per asset, same dates).
 * @param {number[][]} series - Returns per asset.
 * @returns {number[][]} The covariance matrix.
 */
function covarianceMatrix(series) {
  if (!Array.isArray(series) || series.length < 1) throw fail('Give at least one return series.');
  series.forEach((s) => numbers(s, 'returns', 3));
  if (new Set(series.map((s) => s.length)).size !== 1) throw fail('Every return series must cover the same dates.');
  return series.map((a) => series.map((b) => covariance(a, b)));
}

/**
 * @description The correlation matrix from a covariance matrix.
 * @param {number[][]} sigma - Covariance matrix.
 * @returns {number[][]} Correlations.
 */
function correlationMatrix(sigma) {
  checkCovariance(sigma);
  return sigma.map((row, i) => row.map((x, j) => x / Math.sqrt(sigma[i][i] * sigma[j][j])));
}

/**
 * @description A portfolio's expected return and volatility, each holding's share of the risk, the diversification ratio
 * (average holding volatility over portfolio volatility; above 1 means diversification is working) and the effective
 * number of independent bets.
 * @param {number[]} weights - Weights (they need not add to 1).
 * @param {number[][]} sigma - Covariance matrix.
 * @param {number[]} [mu] - Expected returns, optional.
 * @returns {{expectedReturn:number|null, volatility:number, riskContributions:number[], diversificationRatio:number, effectiveBets:number}} The figures.
 */
function portfolioRisk(weights, sigma, mu = null) {
  checkCovariance(sigma, weights);
  const sw = matVec(sigma, weights), variance = dot(weights, sw);
  if (!(variance > 0)) throw fail('These weights carry no risk to measure.');
  const vol = Math.sqrt(variance), contributions = weights.map((w, i) => (w * sw[i]) / variance);
  const avgVol = weights.reduce((s, w, i) => s + Math.abs(w) * Math.sqrt(sigma[i][i]), 0);
  return { expectedReturn: mu ? dot(weights, mu) : null, volatility: vol, riskContributions: contributions, diversificationRatio: avgVol / vol, effectiveBets: 1 / contributions.reduce((s, c) => s + c * c, 0) };
}

/**
 * @description The fully invested portfolio with the least volatility (short sales allowed): w = S^-1 1 / 1' S^-1 1.
 * @param {number[][]} sigma - Covariance matrix.
 * @returns {number[]} Weights adding to 1.
 */
function minimumVariance(sigma) {
  checkCovariance(sigma);
  const x = matVec(inverse(sigma), sigma.map(() => 1)), total = x.reduce((s, v) => s + v, 0);
  return x.map((v) => v / total);
}

/**
 * @description The two-asset minimum-variance weight in the first asset, in closed form.
 * @param {number} sigma1 - First asset's volatility.
 * @param {number} sigma2 - Second asset's volatility.
 * @param {number} rho - Their correlation.
 * @returns {number} Weight in the first asset (the rest in the second).
 */
function twoAssetMinimumVariance(sigma1, sigma2, rho) {
  positive(sigma1, 'sigma1'); positive(sigma2, 'sigma2');
  if (!(finite(rho, 'rho') > -1 && rho < 1)) throw fail('rho must be between -1 and 1.');
  return (sigma2 ** 2 - rho * sigma1 * sigma2) / (sigma1 ** 2 + sigma2 ** 2 - 2 * rho * sigma1 * sigma2);
}

/**
 * @description The tangency (maximum Sharpe ratio) portfolio: w proportional to S^-1 (mu - rf).
 * @param {number[]} mu - Expected returns.
 * @param {number[][]} sigma - Covariance matrix.
 * @param {number} [riskFree] - Risk-free rate in the same units as mu.
 * @returns {number[]} Weights adding to 1.
 */
function tangency(mu, sigma, riskFree = 0) {
  checkCovariance(sigma, mu);
  const x = matVec(inverse(sigma), mu.map((m) => m - finite(riskFree, 'riskFree'))), total = x.reduce((s, v) => s + v, 0);
  if (!(total > 0)) throw fail('No asset beats the risk-free rate on a risk-adjusted basis, so there is no tangency portfolio.');
  return x.map((v) => v / total);
}

/**
 * @description The Markowitz efficient frontier in closed form (Merton 1972; short sales allowed): for each target return
 * the least-volatility weights. Points below the minimum-variance return are the inefficient half and are left out.
 * @param {number[]} mu - Expected returns.
 * @param {number[][]} sigma - Covariance matrix.
 * @param {{points?:number, maxReturn?:number}} [options] - Points (2-101) up to maxReturn (default the best single asset).
 * @returns {{minimumVariance:object, points:Array<{expectedReturn:number, volatility:number, weights:number[]}>}} The frontier.
 */
function efficientFrontier(mu, sigma, { points = 21, maxReturn = null } = {}) {
  checkCovariance(sigma, mu);
  if (new Set(mu).size < 2) throw fail('The frontier needs assets with different expected returns.');
  const inv = inverse(sigma), one = mu.map(() => 1), a = dot(one, matVec(inv, one)), b = dot(one, matVec(inv, mu)), c = dot(mu, matVec(inv, mu)), d = a * c - b * b;
  const at = (m) => ({ expectedReturn: m, volatility: Math.sqrt((a * m * m - 2 * b * m + c) / d), weights: matVec(inv, one.map((_, i) => ((c - b * m) + (a * m - b) * mu[i]) / d)) });
  const lo = b / a, hi = maxReturn == null ? Math.max(...mu) : finite(maxReturn, 'maxReturn'), count = Math.min(101, Math.max(2, points));
  return { minimumVariance: at(lo), points: Array.from({ length: count }, (_, i) => at(lo + (Math.max(hi, lo) - lo) * i / (count - 1))) };
}

/**
 * @description Project a vector onto the long-only, fully invested simplex (weights at least 0, adding to 1).
 * @param {number[]} v - Vector.
 * @returns {number[]} The nearest such weights.
 */
function projectSimplex(v) {
  const u = [...v].sort((x, y) => y - x);
  let css = 0, theta = 0;
  for (let i = 0; i < u.length; i += 1) { css += u[i]; const t = (css - 1) / (i + 1); if (u[i] - t > 0) theta = t; }
  return v.map((x) => Math.max(0, x - theta));
}

/**
 * @description The long-only mean-variance portfolio: maximize w'mu - (lambda / 2) w'S w with weights at least 0 adding to 1
 * (projected gradient; lambda is risk aversion, larger is more cautious; lambda large gives the long-only minimum variance).
 * @param {number[]} mu - Expected returns.
 * @param {number[][]} sigma - Covariance matrix.
 * @param {{riskAversion?:number, iterations?:number}} [options] - lambda (default 4).
 * @returns {number[]} Weights.
 */
function longOnlyMeanVariance(mu, sigma, { riskAversion = 4, iterations = 5000 } = {}) {
  checkCovariance(sigma, mu);
  positive(riskAversion, 'riskAversion');
  const lipschitz = riskAversion * sigma.reduce((s, row) => s + row.reduce((t, x) => t + Math.abs(x), 0), 0);
  let w = mu.map(() => 1 / mu.length);
  for (let k = 0; k < iterations; k += 1) {
    const grad = matVec(sigma, w).map((x, i) => riskAversion * x - mu[i]);
    const next = projectSimplex(w.map((x, i) => x - grad[i] / lipschitz));
    if (next.every((x, i) => Math.abs(x - w[i]) < 1e-13)) { w = next; break; }
    w = next;
  }
  return w;
}

/**
 * @description Risk parity: weights whose risk contributions are equal (or match chosen budgets), by cyclical coordinate
 * descent (Griveau-Billion, Richard and Roncalli 2013). Ignores expected returns on purpose.
 * @param {number[][]} sigma - Covariance matrix.
 * @param {{budgets?:number[], iterations?:number}} [options] - Risk budgets (default equal).
 * @returns {number[]} Long-only weights adding to 1.
 */
function riskParity(sigma, { budgets = null, iterations = 1000 } = {}) {
  const n = checkCovariance(sigma), b = budgets ? numbers(budgets, 'budgets') : new Array(n).fill(1 / n);
  if (b.length !== n || b.some((x) => !(x > 0))) throw fail('Give one positive risk budget per asset.');
  const y = sigma.map((row, i) => 1 / Math.sqrt(row[i]));
  for (let k = 0; k < iterations; k += 1) {
    let moved = 0;
    for (let i = 0; i < n; i += 1) {
      const others = sigma[i].reduce((s, x, j) => (j === i ? s : s + x * y[j]), 0);
      const next = (-others + Math.sqrt(others * others + 4 * sigma[i][i] * b[i])) / (2 * sigma[i][i]);
      moved = Math.max(moved, Math.abs(next - y[i]) / y[i]);
      y[i] = next;
    }
    if (moved < 1e-14) break;
  }
  const total = y.reduce((s, v) => s + v, 0);
  return y.map((v) => v / total);
}

/**
 * @description Black-Litterman: start from the returns the market's own weights imply (pi = delta S w_mkt), then lean toward
 * the investor's views in proportion to their confidence. With no views it returns the market's implied returns exactly.
 * @param {{sigma:number[][], marketWeights:number[], riskAversion?:number, tau?:number, views?:{P:number[][], Q:number[], omega?:number[][]}}} input - Covariance, market weights, delta (2.5), tau (0.05), views.
 * @returns {{equilibrium:number[], posterior:number[], weights:number[]}} Implied returns, blended returns and the unconstrained weights they imply.
 */
function blackLitterman({ sigma, marketWeights, riskAversion = 2.5, tau = 0.05, views = null }) {
  checkCovariance(sigma, marketWeights);
  positive(riskAversion, 'riskAversion'); positive(tau, 'tau');
  const pi = matVec(sigma, marketWeights).map((x) => riskAversion * x);
  let posterior = pi;
  if (views && views.P && views.P.length) {
    const { P, Q } = views;
    P.forEach((row) => { numbers(row, 'view row'); if (row.length !== sigma.length) throw fail('Each view row needs one value per asset.'); });
    numbers(Q, 'Q'); if (Q.length !== P.length) throw fail('Give one expected return Q per view.');
    const ts = scale(sigma, tau), pt = transpose(P);
    const omega = views.omega || multiply(multiply(P, ts), pt).map((row, i) => row.map((x, j) => (i === j ? x : 0)));
    const tsInv = inverse(ts), ptOm = multiply(pt, inverse(omega)), fromViews = matVec(ptOm, Q);
    const left = inverse(add(tsInv, multiply(ptOm, P)));
    posterior = matVec(left, matVec(tsInv, pi).map((x, i) => x + fromViews[i]));
  }
  return { equilibrium: pi, posterior, weights: matVec(inverse(sigma), posterior).map((x) => x / riskAversion) };
}

/**
 * @description The Kelly criterion for a simple bet: win b times the stake with probability p, else lose the stake.
 * f* = (b p - q) / b is the share of the bankroll that maximizes long-run growth; zero or less means do not bet.
 * @param {{p:number, b:number}} input - Win probability and net odds.
 * @returns {{fraction:number, edge:number, growthRate:number}} Kelly fraction, expected profit per unit staked, log growth per bet at f*.
 */
function kellyBet({ p, b }) {
  probability(p, 'p'); positive(b, 'b');
  const q = 1 - p, f = (b * p - q) / b, stake = Math.max(0, f);
  return { fraction: f, edge: b * p - q, growthRate: p * Math.log1p(b * stake) + q * Math.log1p(-Math.min(stake, 1 - 1e-12)) };
}

/**
 * @description The Kelly fraction for a continuously traded asset: (mu - r) / sigma^2, and the growth rate at any fraction,
 * g(f) = r + f (mu - r) - f^2 sigma^2 / 2. Full Kelly is famously volatile; half Kelly keeps three quarters of the growth.
 * @param {{mu:number, sigma:number, riskFree?:number, fraction?:number}} input - Annual drift, annual volatility, rate, a fraction to evaluate.
 * @returns {{kelly:number, growthAtKelly:number, growthAtFraction:number|null}} The figures.
 */
function kellyContinuous({ mu, sigma, riskFree = 0, fraction = null }) {
  finite(mu, 'mu'); positive(sigma, 'sigma'); finite(riskFree, 'riskFree');
  const growth = (f) => riskFree + f * (mu - riskFree) - (f * f * sigma * sigma) / 2, kelly = (mu - riskFree) / (sigma * sigma);
  return { kelly, growthAtKelly: growth(kelly), growthAtFraction: fraction == null ? null : growth(finite(fraction, 'fraction')) };
}

/**
 * @description Kelly weights for several assets: S^-1 (mu - r). Usually large and leveraged; practitioners scale them down.
 * @param {number[]} mu - Expected returns.
 * @param {number[][]} sigma - Covariance matrix.
 * @param {number} [riskFree] - Rate.
 * @returns {number[]} Weights (they need not add to 1).
 */
function kellyPortfolio(mu, sigma, riskFree = 0) {
  checkCovariance(sigma, mu);
  return matVec(inverse(sigma), mu.map((m) => m - finite(riskFree, 'riskFree')));
}

/**
 * @description Mean of each series, for building inputs.
 * @param {number[][]} series - Returns per asset.
 * @returns {number[]} Means.
 */
function means(series) {
  return series.map((s) => mean(s));
}

module.exports = { covarianceMatrix, correlationMatrix, portfolioRisk, minimumVariance, twoAssetMinimumVariance, tangency, efficientFrontier, projectSimplex, longOnlyMeanVariance, riskParity, blackLitterman, kellyBet, kellyContinuous, kellyPortfolio, means };
