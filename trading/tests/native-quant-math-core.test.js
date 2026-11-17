/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Roger asked for a quant read in fifty named ideas with working tools. Guards the math core's foundations on textbook and reference values (scipy, numpy): the bell curve and Student's t to machine precision, returns and compounding, the square-root-of-time rule, present value, expected value, volatility drag, the Sharpe ratio, correlation, the Jarque-Bera test, t-tests, and least squares with Newey-West errors; a number the math cannot use is refused with a reason.
 */
'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { distributions: d, stats: s, regression: reg, random } = require('../routes/quant/math');

/**
 * @description Assert two numbers agree within a tolerance, naming both in the failure.
 * @param {number} actual - Computed value.
 * @param {number} expected - Reference value.
 * @param {number} tol - Allowed absolute difference.
 * @param {string} label - What is compared.
 * @returns {void}
 */
function near(actual, expected, tol, label) {
  assert.ok(Math.abs(actual - expected) <= tol, `${label}: ${actual} vs ${expected} (tolerance ${tol})`);
}

test('the bell curve and Student t match scipy to machine precision', () => {
  near(d.normalCdf(1.96), 0.9750021048517795, 1e-15, 'Phi(1.96)');
  near(d.normalCdf(-1), 0.15865525393145707, 1e-15, 'Phi(-1)');
  near(d.normalCdf(-3.5), 0.00023262907903552502, 1e-15, 'Phi(-3.5)');
  near(d.normalInv(0.975), 1.959963984540054, 1e-12, 'z 97.5%');
  near(d.normalInv(0.95), 1.644853626951472, 1e-12, 'z 95% (the 1.645 of a 95% VaR)');
  near(d.normalInv(0.001), -3.090232306167813, 1e-12, 'z 0.1%');
  near(d.studentTCdf(2.1, 5), 0.9551233750577006, 1e-13, 't cdf');
  near(d.studentTCdf(-1.3, 3), 0.14223375436394853, 1e-13, 't cdf negative');
  near(d.studentTInv(0.975, 5), 2.5705818356363146, 1e-10, 't 97.5% df 5');
  near(d.studentTInv(0.995, 2.5), 7.163728138948783, 1e-9, 't 99.5% df 2.5');
  near(d.chiSquare(3.841458820694124, 1).pValue, 0.05, 1e-13, 'chi-square df 1');
  near(d.chiSquare(18.307038053275146, 10).pValue, 0.05, 1e-13, 'chi-square df 10');
  near(d.twoSidedT(2, 20), 0.05926553544657047, 1e-13, 'two-sided t p');
  near(d.logGamma(0.5), 0.5723649429247, 1e-12, 'ln Gamma(1/2)');
  for (const p of [1e-9, 0.01, 0.2, 0.5, 0.8, 0.99]) near(d.normalCdf(d.normalInv(p)), p, 1e-12 * Math.max(1, p * 1e3), `round trip ${p}`);
});

test('returns: simple and log returns, compounding, annualizing and the square-root-of-time rule', () => {
  const prices = [100, 110, 99, 108.9];
  const simple = s.simpleReturns(prices);
  assert.deepEqual(simple.map((r) => Math.round(r * 1e12) / 1e12), [0.1, -0.1, 0.1]);
  near(s.compound(simple), 0.089, 1e-12, 'compound');
  near(s.logReturns(prices).reduce((a, b) => a + b, 0), Math.log(108.9 / 100), 1e-12, 'log returns add up');
  near(s.cagr(100, 200, 10), 2 ** 0.1 - 1, 1e-15, 'doubling in 10 years');
  near(s.annualizedReturn(new Array(252).fill(0.001)), 1.001 ** 252 - 1, 1e-12, 'annualized');
  near(s.scaleVolatility(0.01, 1, 252), 0.01 * Math.sqrt(252), 1e-15, 'sqrt(252): 1% a day is 15.87% a year');
  near(s.scaleVolatility(0.2, 252, 21), 0.2 * Math.sqrt(21 / 252), 1e-15, 'a year to a month');
  near(s.annualizedVolatility([0.01, -0.01, 0.01, -0.01]), s.stdev([0.01, -0.01, 0.01, -0.01]) * Math.sqrt(252), 1e-15, 'annual vol');
});

test('present value, net present value, annuities and expected value', () => {
  near(s.presentValue({ amount: 110, rate: 0.1, years: 1 }), 100, 1e-12, '110 next year at 10%');
  near(s.presentValue({ amount: 100, rate: 0.05, years: 2, compounding: 'continuous' }), 100 * Math.exp(-0.1), 1e-12, 'continuous');
  near(s.presentValue({ amount: 100, rate: 0.12, years: 1, compounding: 12 }), 100 / 1.01 ** 12, 1e-12, 'monthly');
  near(s.netPresentValue({ rate: 0.1, cashflows: [{ t: 0, amount: -100 }, { t: 1, amount: 60 }, { t: 2, amount: 60.5 }] }), 4.5454545454545, 1e-9, 'npv');
  near(s.annuityPresentValue({ payment: 100, rate: 0.05, periods: 10 }), 772.1734929184817, 1e-9, 'annuity');
  const bet = s.expectedValue([{ probability: 0.6, value: 100 }, { probability: 0.4, value: -100 }]);
  near(bet.expectedValue, 20, 1e-12, 'EV of a 60/40 even-money bet');
  near(bet.sd, Math.sqrt(0.6 * 80 ** 2 + 0.4 * 120 ** 2), 1e-9, 'its spread');
  near(bet.probabilityOfLoss, 0.4, 1e-15, 'chance of losing');
  assert.throws(() => s.expectedValue([{ probability: 0.6, value: 1 }, { probability: 0.3, value: 2 }]), /add up to 0.9/);
});

test('volatility drag: +50% then -50% averages zero yet loses a quarter, about half the variance per period', () => {
  const drag = s.volatilityDrag([0.5, -0.5]);
  near(drag.arithmeticMean, 0, 1e-15, 'average');
  near((1 + drag.geometricMean) ** 2, 0.75, 1e-12, 'compound value');
  const rng = random.randomSource(3), daily = Array.from({ length: 20000 }, () => 0.0004 + 0.02 * rng.normal());
  const small = s.volatilityDrag(daily);
  near(small.drag, small.halfVariance, 0.05 * small.halfVariance, 'drag ~ sigma^2 / 2 for small returns');
});

test('the Sharpe ratio is annualized with sqrt(252) and carries a standard error', () => {
  const rng = random.randomSource(11), r = Array.from({ length: 2520 }, () => 0.0005 + 0.01 * rng.normal());
  const sr = s.sharpeRatio(r);
  near(sr.sharpe, (s.mean(r) / s.stdev(r)) * Math.sqrt(252), 1e-12, 'annualized');
  near(sr.standardError, Math.sqrt((1 + sr.perPeriod ** 2 / 2) / 2520) * Math.sqrt(252), 1e-12, 'Lo (2002) standard error');
  assert.ok(s.sharpeRatio(r, { riskFree: 0.05 }).sharpe < sr.sharpe, 'a risk-free rate lowers the excess return');
  assert.throws(() => s.sharpeRatio([0.01, 0.01, 0.01]), /never vary/);
});

test('moments, correlation, ranks and quantiles match scipy and numpy', () => {
  const x = [0.01, -0.02, 0.015, 0.003, -0.007, 0.012, -0.001, 0.004];
  const m = s.moments(x);
  near(m.skew, -0.7893200162079932, 1e-12, 'skew');
  near(m.excessKurtosis, -0.272506925207757, 1e-12, 'excess kurtosis');
  const jb = s.jarqueBera(x);
  near(jb.statistic, 0.8554547920775109, 1e-12, 'Jarque-Bera');
  near(jb.pValue, 0.651989125393596, 1e-12, 'its p-value');
  near(s.spearman([1, 2, 3, 4, 5, 6], [2, 1, 4, 3, 6, 5]), 0.8285714285714287, 1e-12, 'Spearman');
  near(s.quantile([3, 1, 4, 1, 5, 9, 2, 6], 0.3), 2.1, 1e-12, 'numpy quantile');
  near(s.correlation([1, 2, 3, 4], [2, 4, 6, 8.5]), 0.9988, 1e-3, 'correlation');
  const rng = random.randomSource(5), t = Array.from({ length: 20000 }, () => rng.studentT(5));
  assert.ok(s.jarqueBera(t).pValue < 1e-6, 'Student t draws are not a bell curve');
});

test('t-tests match scipy', () => {
  const x = [0.01, -0.02, 0.015, 0.003, -0.007, 0.012, -0.001, 0.004];
  const one = reg.oneSampleT(x);
  near(one.t, 0.49559462778335206, 1e-12, 't'); near(one.pValue, 0.6353585506406806, 1e-12, 'p');
  const two = reg.welchT(x, [0.02, 0.01, 0.03, 0.015, 0.025, 0.0]);
  near(two.t, -2.4536575478377793, 1e-12, 'Welch t'); near(two.df, 11.247323097042035, 1e-9, 'Welch df'); near(two.pValue, 0.031600166388798444, 1e-10, 'Welch p');
});

test('least squares recovers exact coefficients, and Newey-West errors match an independent numpy computation', () => {
  const x1 = [1, 2, 3, 4, 5, 6, 7], x2 = [2, 1, 4, 3, 6, 5, 8], y = x1.map((v, i) => 1 + 2 * v - 0.5 * x2[i]);
  const exact = reg.ols(y, [x1, x2], { names: ['a', 'b'] });
  assert.deepEqual(exact.coefficients.map((c) => Math.round(c.estimate * 1e10) / 1e10), [1, 2, -0.5]);
  near(exact.r2, 1, 1e-12, 'perfect fit');
  const rng = random.randomSource(42), a = [], b = [], z = [];
  let u = 0;
  for (let t = 0; t < 300; t += 1) { a.push(rng.normal()); b.push(rng.normal() + 0.3 * a[t]); u = 0.6 * u + rng.normal(); z.push(0.5 + 2 * a[t] - b[t] + u); }
  const fit = reg.ols(z, [a, b], { hacLags: 5 });
  const numpy = [[0.40429984, 0.09872829], [2.09163757, 0.05518825], [-0.98522423, 0.06106348]];
  fit.coefficients.forEach((c, i) => { near(c.estimate, numpy[i][0], 1e-7, `coefficient ${i}`); near(c.se, numpy[i][1], 1e-7, `Newey-West se ${i}`); });
  const classical = reg.ols(z, [a, b]);
  near(classical.coefficients[0].se, 0.06450574, 1e-7, 'classical se');
  assert.ok(fit.coefficients[0].se > classical.coefficients[0].se, 'autocorrelated errors widen the honest standard error');
  assert.equal(fit.errors, 'newey-west(5)');
});

test('autocorrelation and the Ljung-Box test separate noise from an echo', () => {
  const rng = random.randomSource(8), noise = Array.from({ length: 3000 }, () => rng.normal());
  const echo = [0];
  for (let t = 1; t < 3000; t += 1) echo.push(0.4 * echo[t - 1] + rng.normal());
  near(reg.autocorrelation(echo, 1), 0.4, 0.05, 'lag-1 echo');
  assert.ok(reg.ljungBox(noise, 10).pValue > 0.01, 'noise passes');
  assert.ok(reg.ljungBox(echo, 10).pValue < 1e-10, 'an echo fails');
});

test('inputs the math cannot use are refused with a reason, never repaired', () => {
  assert.throws(() => s.mean([1, NaN]), (err) => err.status === 400 && err.code === 'quant_input' && /finite numbers/.test(err.message));
  assert.throws(() => s.simpleReturns([100, 0, 5]), /above zero/);
  assert.throws(() => d.normalInv(1), /between 0 and 1/);
  assert.throws(() => reg.ols([1, 2, 3], [[1, 2, 3], [2, 1, 0]]), /3 coefficients needs more than 3 observations/);
  assert.throws(() => s.correlation([1, 1, 1], [1, 2, 3]), /never changes/);
});
