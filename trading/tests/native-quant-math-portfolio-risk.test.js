/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guards the quant's portfolio and risk math on closed forms: the two-asset minimum-variance weight, the efficient frontier's minimum and tangency points, long-only weights, risk parity's equal risk contributions, Black-Litterman returning the market's implied returns with no views, the Kelly fraction (bp - q) / b, the 95% bell-curve VaR of 1.645 standard deviations, Cornish-Fisher and Student's t for fat tails, the Kupiec test, a VaR backtest that catches a bell-curve model on fat-tailed returns, and drawdowns.
 */
'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { portfolio: p, risk, random, linalg } = require('../routes/quant/math');

const MU = Object.freeze([0.08, 0.12, 0.10]);
const SIGMA = Object.freeze([[0.04, 0.006, 0.01], [0.006, 0.09, 0.012], [0.01, 0.012, 0.0625]].map((r) => Object.freeze(r)));

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

test('the efficient frontier: two-asset closed form, minimum variance, and the tangency portfolio has the best Sharpe ratio', () => {
  const s1 = 0.2, s2 = 0.3, rho = 0.2, w1 = p.twoAssetMinimumVariance(s1, s2, rho);
  near(w1, 0.078 / 0.106, 1e-12, 'two-asset closed form');
  near(p.minimumVariance([[s1 * s1, rho * s1 * s2], [rho * s1 * s2, s2 * s2]])[0], w1, 1e-12, 'matrix form agrees');
  const sigma = SIGMA.map((r) => [...r]), mu = [...MU], frontier = p.efficientFrontier(mu, sigma, { points: 11 });
  const mv = p.minimumVariance(sigma);
  frontier.minimumVariance.weights.forEach((w, i) => near(w, mv[i], 1e-12, `frontier minimum ${i}`));
  for (const pt of frontier.points) {
    near(pt.weights.reduce((a, b) => a + b, 0), 1, 1e-12, 'fully invested');
    near(p.portfolioRisk(pt.weights, sigma, mu).volatility, pt.volatility, 1e-12, 'closed-form volatility');
    near(p.portfolioRisk(pt.weights, sigma, mu).expectedReturn, pt.expectedReturn, 1e-12, 'hits its target return');
  }
  const sharpe = (w) => { const r = p.portfolioRisk(w, sigma, mu); return (r.expectedReturn - 0.03) / r.volatility; };
  const best = sharpe(p.tangency(mu, sigma, 0.03));
  for (const pt of frontier.points) assert.ok(sharpe(pt.weights) <= best + 1e-12, 'no frontier point beats the tangency Sharpe ratio');
  p.longOnlyMeanVariance(mu, sigma, { riskAversion: 1e4 }).forEach((w, i) => near(w, mv[i], 1e-4, `long-only with high risk aversion is the minimum variance ${i}`));
  const bold = p.longOnlyMeanVariance([0.05, 0.3, 0.06], sigma, { riskAversion: 0.5 });
  assert.ok(bold.every((w) => w >= 0) && Math.abs(bold.reduce((a, b) => a + b, 0) - 1) < 1e-12, 'long-only stays long-only');
  near(bold[1], 1, 1e-9, 'a bold investor piles into the best asset without shorting');
});

test('risk parity gives every holding the same share of the risk', () => {
  const sigma = SIGMA.map((r) => [...r]), w = p.riskParity(sigma), risk3 = p.portfolioRisk(w, sigma);
  risk3.riskContributions.forEach((c) => near(c, 1 / 3, 1e-10, 'equal contribution'));
  p.riskParity([[0.04, 0, 0], [0, 0.09, 0], [0, 0, 0.16]]).forEach((x, i) => near(x, [5, 10 / 3, 2.5][i] / (5 + 10 / 3 + 2.5), 1e-12, `uncorrelated: weight in proportion to 1 / volatility ${i}`));
  const budget = p.riskParity(sigma, { budgets: [0.5, 0.25, 0.25] });
  p.portfolioRisk(budget, sigma).riskContributions.forEach((c, i) => near(c, [0.5, 0.25, 0.25][i], 1e-10, `risk budget ${i}`));
  near(p.portfolioRisk([0.5, 0.5], [[0.04, 0], [0, 0.04]]).diversificationRatio, Math.SQRT2, 1e-12, 'two independent equal assets diversify by sqrt(2)');
});

test('Black-Litterman with no views returns the market equilibrium, and a near-certain view is honoured', () => {
  const sigma = SIGMA.map((r) => [...r]), w = [0.5, 0.3, 0.2], none = p.blackLitterman({ sigma, marketWeights: w });
  none.posterior.forEach((x, i) => near(x, none.equilibrium[i], 1e-15, `posterior = equilibrium ${i}`));
  none.weights.forEach((x, i) => near(x, w[i], 1e-12, `weights = market weights ${i}`));
  linalg.matVec(sigma, w).forEach((x, i) => near(none.equilibrium[i], 2.5 * x, 1e-15, `pi = delta S w ${i}`));
  const view = p.blackLitterman({ sigma, marketWeights: w, views: { P: [[0, 1, -1]], Q: [0.05], omega: [[1e-12]] } });
  near(view.posterior[1] - view.posterior[2], 0.05, 1e-6, 'asset 2 beats asset 3 by 5%');
  const unsure = p.blackLitterman({ sigma, marketWeights: w, views: { P: [[0, 1, -1]], Q: [0.05], omega: [[10]] } });
  near(unsure.posterior[1] - unsure.posterior[2], none.equilibrium[1] - none.equilibrium[2], 1e-3, 'an unsure view barely moves it');
});

test('Kelly: f* = (bp - q) / b for a bet, (mu - r) / sigma^2 for an asset, S^-1 (mu - r) for several', () => {
  near(p.kellyBet({ p: 0.6, b: 1 }).fraction, 0.2, 1e-15, '60% at even money');
  near(p.kellyBet({ p: 0.55, b: 2 }).fraction, (2 * 0.55 - 0.45) / 2, 1e-15, '55% at 2 to 1');
  assert.ok(p.kellyBet({ p: 0.4, b: 1 }).fraction < 0, 'a losing bet says do not bet');
  const growth = (f, q = 0.6) => q * Math.log1p(f) + (1 - q) * Math.log1p(-f);
  for (const f of [0.1, 0.15, 0.25, 0.3]) assert.ok(growth(f) < growth(0.2), `growth is highest at Kelly, not ${f}`);
  const k = p.kellyContinuous({ mu: 0.1, sigma: 0.2, riskFree: 0.02, fraction: 1 });
  near(k.kelly, 2, 1e-12, 'continuous Kelly');
  near(k.growthAtKelly, 0.1, 1e-12, 'growth at Kelly: r + (mu - r)^2 / (2 sigma^2)');
  near(p.kellyContinuous({ mu: 0.1, sigma: 0.2, riskFree: 0.02, fraction: 1 }).growthAtFraction, 0.08, 1e-12, 'half Kelly keeps three quarters of the excess growth');
  const multi = p.kellyPortfolio([0.06, 0.1], [[0.04, 0], [0, 0.09]], 0.02);
  near(multi[0], 1, 1e-12, 'independent assets: each its own Kelly'); near(multi[1], 0.08 / 0.09, 1e-12, 'second');
});

test('value at risk: 1.645 sigma at 95% on a bell curve, and fat tails make it larger', () => {
  const n95 = risk.normalVaR({ sd: 0.01, confidence: 0.95 });
  near(n95.valueAtRisk, 0.01644853626951472, 1e-15, '95% VaR = 1.645 sigma');
  near(risk.normalVaR({ sd: 0.01, confidence: 0.99, horizon: 10 }).valueAtRisk, 0.023263478740408408 * Math.sqrt(10), 1e-12, '10-day 99% by the square-root-of-time rule');
  near(n95.expectedShortfall, 0.01 * 0.10313564037537128 / 0.05, 1e-12, 'expected shortfall = sigma phi(z) / 5%');
  const cfFlat = risk.cornishFisherVaR({ sd: 0.01, skew: 0, excessKurtosis: 0, confidence: 0.99 });
  near(cfFlat.valueAtRisk, 0.023263478740408408, 1e-12, 'no skew, no kurtosis: Cornish-Fisher is the bell curve');
  assert.ok(risk.cornishFisherVaR({ sd: 0.01, skew: -0.5, excessKurtosis: 4, confidence: 0.99 }).valueAtRisk > cfFlat.valueAtRisk, 'left skew and fat tails raise the 99% VaR');
  near(risk.studentTVaR({ sd: 0.01, nu: 1e7, confidence: 0.99 }).valueAtRisk, 0.023263478740408408, 1e-8, 'Student t with many degrees of freedom is the bell curve');
  assert.ok(risk.studentTVaR({ sd: 0.01, nu: 4, confidence: 0.99 }).valueAtRisk > 0.0262, 'four degrees of freedom: much fatter 99% tail');
  const rng = random.randomSource(4), r = Array.from({ length: 50000 }, () => 0.01 * rng.normal());
  near(risk.historicalVaR(r, { confidence: 0.95 }).valueAtRisk, 0.01645, 4e-4, 'history of a bell curve gives 1.645 sigma');
});

test('fat tails are measured, and a bell-curve VaR on fat-tailed returns fails its Kupiec backtest while historical VaR passes', () => {
  const rng = random.randomSource(9), r = Array.from({ length: 4000 }, () => 0.01 * Math.SQRT1_2 * rng.studentT(4));
  const tails = risk.tailReport(r);
  assert.ok(tails.excessKurtosis > 2, `excess kurtosis ${tails.excessKurtosis}`);
  assert.ok(tails.timesNormal > 2, `moves beyond 3 sd happen ${tails.timesNormal} times as often as the bell curve says`);
  near(tails.studentTNu, 4, 1, 'fitted degrees of freedom');
  near(risk.kupiec({ exceptions: 10, observations: 1000, confidence: 0.99 }).pValue, 1, 1e-12, 'exactly as promised');
  assert.ok(risk.kupiec({ exceptions: 25, observations: 1000, confidence: 0.99 }).pValue < 0.001, 'two and a half times the promised misses');
  assert.ok(risk.varBacktest(r, { confidence: 0.99, method: 'normal' }).kupiec.pValue < 0.01, 'bell-curve VaR misses too often on fat tails');
  assert.ok(risk.varBacktest(r, { confidence: 0.99, method: 'historical' }).kupiec.pValue > 0.05, 'historical VaR keeps its promise');
});

test('drawdowns: the deepest fall, when it bottomed and when it recovered', () => {
  const dd = risk.drawdowns([100, 120, 90, 60, 80, 130, 125]);
  near(dd.maxDrawdown, -0.5, 1e-15, '120 to 60');
  assert.deepEqual({ peak: dd.peak, trough: dd.trough, recovery: dd.recovery, longestUnderwater: dd.longestUnderwater }, { peak: 1, trough: 3, recovery: 5, longestUnderwater: 3 });
  assert.equal(risk.drawdowns([100, 90, 80]).recovery, null, 'not recovered yet');
  assert.throws(() => p.minimumVariance([[0.04, 0.04], [0.04, 0.04]]), /singular/);
  assert.throws(() => p.tangency([0.01, 0.01], [[0.04, 0], [0, 0.04]], 0.05), /No asset beats the risk-free rate/);
});
