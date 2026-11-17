/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Statistics and money arithmetic for the quant's math core: moments (mean, spread, skew, fat-tail kurtosis), correlation, quantiles, simple and log returns and compounding, annualizing and the square-root-of-time rule, present value, expected value, volatility drag, the Sharpe ratio with its standard error, and the Jarque-Bera bell-curve test.
 */
'use strict';
const { fail, finite, positive, numbers, paired } = require('./checks');
const { chiSquare } = require('./distributions');

/** Trading sessions in a year, the convention every annualized figure here uses unless told otherwise. */
const SESSIONS_PER_YEAR = 252;

/**
 * @description The sum of a series.
 * @param {number[]} values - Series.
 * @returns {number} The sum.
 */
function sum(values) {
  let s = 0;
  for (const v of values) s += v;
  return s;
}

/**
 * @description The arithmetic mean.
 * @param {number[]} values - Series (at least one value).
 * @returns {number} The mean.
 */
function mean(values) {
  return sum(numbers(values, 'values')) / values.length;
}

/**
 * @description The variance; sample variance (n - 1) by default.
 * @param {number[]} values - Series.
 * @param {number} [ddof] - Delta degrees of freedom (1 sample, 0 population).
 * @returns {number} The variance.
 */
function variance(values, ddof = 1) {
  numbers(values, 'values', ddof + 1);
  const m = mean(values);
  let s = 0;
  for (const v of values) s += (v - m) ** 2;
  return s / (values.length - ddof);
}

/**
 * @description The standard deviation; sample (n - 1) by default.
 * @param {number[]} values - Series.
 * @param {number} [ddof] - Delta degrees of freedom.
 * @returns {number} The standard deviation.
 */
function stdev(values, ddof = 1) {
  return Math.sqrt(variance(values, ddof));
}

/**
 * @description Mean, sample variance, and the shape of a distribution: skew (g1) and kurtosis (b2, 3 for a bell curve), both
 * the moment estimators (the same as scipy.stats' defaults). Excess kurtosis above 0 means fatter tails than the bell curve.
 * @param {number[]} values - Series (at least four values).
 * @returns {{n:number, mean:number, variance:number, sd:number, skew:number, kurtosis:number, excessKurtosis:number}} The moments.
 */
function moments(values) {
  numbers(values, 'values', 4);
  const n = values.length, m = mean(values);
  let m2 = 0, m3 = 0, m4 = 0;
  for (const v of values) { const d = v - m; m2 += d * d; m3 += d * d * d; m4 += d * d * d * d; }
  m2 /= n; m3 /= n; m4 /= n;
  if (!(m2 > 0)) throw fail('The values never change, so their spread and shape are undefined.');
  const kurtosis = m4 / (m2 * m2);
  return { n, mean: m, variance: m2 * n / (n - 1), sd: Math.sqrt(m2 * n / (n - 1)), skew: m3 / m2 ** 1.5, kurtosis, excessKurtosis: kurtosis - 3 };
}

/**
 * @description The sample covariance of two paired series.
 * @param {number[]} a - Series.
 * @param {number[]} b - Series of the same length.
 * @returns {number} The covariance.
 */
function covariance(a, b) {
  paired(a, b, 'Both series');
  const ma = mean(a), mb = mean(b);
  let s = 0;
  for (let i = 0; i < a.length; i += 1) s += (a[i] - ma) * (b[i] - mb);
  return s / (a.length - 1);
}

/**
 * @description Pearson's correlation: how closely two series move together, from -1 to 1.
 * @param {number[]} a - Series.
 * @param {number[]} b - Series of the same length.
 * @returns {number} The correlation.
 */
function correlation(a, b) {
  const sa = stdev(a), sb = stdev(b);
  if (!(sa > 0 && sb > 0)) throw fail('A series that never changes has no correlation.');
  return covariance(a, b) / (sa * sb);
}

/**
 * @description Ranks from 1, ties sharing their average rank.
 * @param {number[]} values - Series.
 * @returns {number[]} Ranks in the original order.
 */
function ranks(values) {
  const order = values.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]);
  const out = new Array(values.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j += 1;
    for (let k = i; k <= j; k += 1) out[order[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return out;
}

/**
 * @description Spearman's rank correlation: correlation of the ranks, which ignores the size of outliers.
 * @param {number[]} a - Series.
 * @param {number[]} b - Series of the same length.
 * @returns {number} The rank correlation.
 */
function spearman(a, b) {
  paired(a, b, 'Both series');
  return correlation(ranks(a), ranks(b));
}

/**
 * @description A quantile by linear interpolation between order statistics (numpy's default, type 7).
 * @param {number[]} values - Series.
 * @param {number} p - Probability in [0, 1].
 * @returns {number} The quantile.
 */
function quantile(values, p) {
  numbers(values, 'values');
  if (!(finite(p, 'p') >= 0 && p <= 1)) throw fail('p must be from 0 to 1.');
  const s = [...values].sort((x, y) => x - y), h = (s.length - 1) * p, lo = Math.floor(h);
  return lo + 1 < s.length ? s[lo] + (h - lo) * (s[lo + 1] - s[lo]) : s[lo];
}

/**
 * @description Simple returns from prices: p[t] / p[t-1] - 1.
 * @param {number[]} prices - Positive prices, oldest first.
 * @returns {number[]} One fewer returns.
 */
function simpleReturns(prices) {
  numbers(prices, 'prices', 2);
  if (prices.some((p) => !(p > 0))) throw fail('Prices must be above zero.');
  return prices.slice(1).map((p, i) => p / prices[i] - 1);
}

/**
 * @description Log returns from prices: ln(p[t] / p[t-1]). Log returns add up over time; simple returns compound.
 * @param {number[]} prices - Positive prices, oldest first.
 * @returns {number[]} One fewer returns.
 */
function logReturns(prices) {
  return simpleReturns(prices).map((r) => Math.log1p(r));
}

/**
 * @description Compound simple returns into one total return.
 * @param {number[]} returns - Simple returns.
 * @returns {number} The total return.
 */
function compound(returns) {
  numbers(returns, 'returns');
  return returns.reduce((value, r) => value * (1 + r), 1) - 1;
}

/**
 * @description The geometric (compound) annual rate of a series of simple returns.
 * @param {number[]} returns - Simple returns per period.
 * @param {number} [periodsPerYear] - Periods in a year (252 trading days).
 * @returns {number} The annual rate.
 */
function annualizedReturn(returns, periodsPerYear = SESSIONS_PER_YEAR) {
  return (1 + compound(returns)) ** (positive(periodsPerYear, 'periodsPerYear') / returns.length) - 1;
}

/**
 * @description The square-root-of-time rule: a volatility measured over one horizon restated for another. Exact only
 * when returns are independent from one period to the next; trending or mean-reverting prices break it.
 * @param {number} sigma - Volatility over fromPeriods.
 * @param {number} fromPeriods - Horizon the volatility was measured over (e.g. 1 day).
 * @param {number} toPeriods - Horizon to restate it for (e.g. 252 days).
 * @returns {number} sigma * sqrt(toPeriods / fromPeriods).
 */
function scaleVolatility(sigma, fromPeriods, toPeriods) {
  return finite(sigma, 'sigma') * Math.sqrt(positive(toPeriods, 'toPeriods') / positive(fromPeriods, 'fromPeriods'));
}

/**
 * @description Annualized volatility of per-period returns: the sample standard deviation times sqrt(periods per year).
 * @param {number[]} returns - Returns per period.
 * @param {number} [periodsPerYear] - Periods in a year.
 * @returns {number} The annual volatility (0.2 is 20%).
 */
function annualizedVolatility(returns, periodsPerYear = SESSIONS_PER_YEAR) {
  return scaleVolatility(stdev(returns), 1, periodsPerYear);
}

/**
 * @description The compound annual growth rate between two values.
 * @param {number} start - Starting value (positive).
 * @param {number} end - Ending value (positive).
 * @param {number} years - Years between them (positive).
 * @returns {number} The annual rate.
 */
function cagr(start, end, years) {
  return (positive(end, 'end') / positive(start, 'start')) ** (1 / positive(years, 'years')) - 1;
}

/**
 * @description The discount factor for a rate and time under a compounding convention.
 * @param {number} rate - Annual rate (0.05 is 5%).
 * @param {number} years - Time in years.
 * @param {string|number} compounding - 'annual', 'continuous' or periods per year.
 * @returns {number} The factor that turns a future amount into today's value.
 */
function discountFactor(rate, years, compounding) {
  finite(rate, 'rate'); finite(years, 'years');
  if (compounding === 'continuous') return Math.exp(-rate * years);
  const m = compounding === 'annual' || compounding == null ? 1 : positive(compounding, 'compounding');
  if (!(1 + rate / m > 0)) throw fail('The rate is too negative for that compounding.');
  return (1 + rate / m) ** (-m * years);
}

/**
 * @description Present value: what an amount received later is worth today at a given rate.
 * @param {{amount:number, rate:number, years:number, compounding?:string|number}} input - Amount, annual rate, years, compounding.
 * @returns {number} Today's value.
 */
function presentValue({ amount, rate, years, compounding = 'annual' }) {
  return finite(amount, 'amount') * discountFactor(rate, years, compounding);
}

/**
 * @description Net present value of dated cash flows (money in positive, money out negative).
 * @param {{rate:number, cashflows:Array<{t:number, amount:number}>, compounding?:string|number}} input - Rate and flows by year.
 * @returns {number} The net present value.
 */
function netPresentValue({ rate, cashflows, compounding = 'annual' }) {
  if (!Array.isArray(cashflows) || !cashflows.length) throw fail('cashflows needs at least one {t, amount}.');
  return cashflows.reduce((s, f) => s + finite(f && f.amount, 'amount') * discountFactor(rate, finite(f.t, 't'), compounding), 0);
}

/**
 * @description Present value of a level payment received at the end of each of n periods.
 * @param {{payment:number, rate:number, periods:number}} input - Payment, rate per period, number of periods.
 * @returns {number} Today's value.
 */
function annuityPresentValue({ payment, rate, periods }) {
  finite(payment, 'payment'); finite(rate, 'rate'); positive(periods, 'periods');
  if (!(rate > -1)) throw fail('rate must be above -100%.');
  return rate === 0 ? payment * periods : payment * (1 - (1 + rate) ** -periods) / rate;
}

/**
 * @description Expected value of a set of outcomes: the probability-weighted average, with the spread around it.
 * @param {Array<{probability:number, value:number}>} outcomes - Outcomes whose probabilities add up to 1.
 * @returns {{expectedValue:number, variance:number, sd:number, probabilityOfLoss:number}} The figures.
 */
function expectedValue(outcomes) {
  if (!Array.isArray(outcomes) || !outcomes.length) throw fail('outcomes needs at least one {probability, value}.');
  for (const o of outcomes) { finite(o && o.value, 'value'); if (!(finite(o.probability, 'probability') >= 0)) throw fail('A probability cannot be negative.'); }
  const total = sum(outcomes.map((o) => o.probability));
  if (Math.abs(total - 1) > 1e-9) throw fail(`The probabilities add up to ${Math.round(total * 1e9) / 1e9}, not 1.`);
  const ev = sum(outcomes.map((o) => o.probability * o.value));
  const v = sum(outcomes.map((o) => o.probability * (o.value - ev) ** 2));
  return { expectedValue: ev, variance: v, sd: Math.sqrt(v), probabilityOfLoss: sum(outcomes.filter((o) => o.value < 0).map((o) => o.probability)) };
}

/**
 * @description Volatility drag: how much the compound (geometric) growth falls short of the average (arithmetic) return,
 * about half the variance per period. Two years of +50% then -50% average 0% but lose 25%.
 * @param {number[]} returns - Simple returns per period.
 * @returns {{arithmeticMean:number, geometricMean:number, drag:number, halfVariance:number}} Per-period figures.
 */
function volatilityDrag(returns) {
  numbers(returns, 'returns', 2);
  const arithmeticMean = mean(returns), geometricMean = (1 + compound(returns)) ** (1 / returns.length) - 1;
  return { arithmeticMean, geometricMean, drag: arithmeticMean - geometricMean, halfVariance: variance(returns) / 2 };
}

/**
 * @description The Sharpe ratio: average return above cash per unit of volatility, annualized, with its standard error under
 * independent returns (Lo 2002) so a person can see how uncertain it is.
 * @param {number[]} returns - Simple returns per period (at least 3).
 * @param {{riskFree?:number, periodsPerYear?:number}} [options] - Annual risk-free rate (0 unless supplied) and periods per year.
 * @returns {{sharpe:number, perPeriod:number, standardError:number, tStat:number, n:number, riskFree:number}} The figures.
 */
function sharpeRatio(returns, { riskFree = 0, periodsPerYear = SESSIONS_PER_YEAR } = {}) {
  numbers(returns, 'returns', 3);
  const rf = (1 + finite(riskFree, 'riskFree')) ** (1 / positive(periodsPerYear, 'periodsPerYear')) - 1;
  const excess = returns.map((r) => r - rf), sd = stdev(excess);
  if (!(sd > 0)) throw fail('Returns that never vary have no Sharpe ratio.');
  const perPeriod = mean(excess) / sd, n = returns.length, k = Math.sqrt(periodsPerYear);
  return { sharpe: perPeriod * k, perPeriod, standardError: Math.sqrt((1 + perPeriod * perPeriod / 2) / n) * k, tStat: perPeriod * Math.sqrt(n), n, riskFree };
}

/**
 * @description The Jarque-Bera test of whether returns follow a bell curve, from their skew and excess kurtosis.
 * A small p-value means they do not (usually: fat tails).
 * @param {number[]} values - Series (at least 4 values).
 * @returns {{statistic:number, pValue:number, skew:number, excessKurtosis:number, n:number}} The test.
 */
function jarqueBera(values) {
  const m = moments(values);
  const statistic = (m.n / 6) * (m.skew ** 2 + m.excessKurtosis ** 2 / 4);
  return { statistic, pValue: chiSquare(statistic, 2).pValue, skew: m.skew, excessKurtosis: m.excessKurtosis, n: m.n };
}

module.exports = {
  SESSIONS_PER_YEAR, sum, mean, variance, stdev, moments, covariance, correlation, ranks, spearman, quantile,
  simpleReturns, logReturns, compound, annualizedReturn, scaleVolatility, annualizedVolatility, cagr,
  discountFactor, presentValue, netPresentValue, annuityPresentValue, expectedValue, volatilityDrag, sharpeRatio, jarqueBera,
};
