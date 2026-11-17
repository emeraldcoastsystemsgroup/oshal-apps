/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Downside risk for the quant's math core: value at risk and expected shortfall four ways (bell curve, history, Cornish-Fisher for skew and fat tails, Student's t), the Kupiec test of whether a VaR model's misses match its promise, a rolling VaR backtest, fat-tail measures and drawdowns. Losses are reported as positive fractions (0.03 is a 3% loss).
 */
'use strict';
const { fail, finite, positive, probability, integer, numbers } = require('./checks');
const { mean, stdev, moments, quantile } = require('./stats');
const { normalInv, normalPdf, normalCdf, studentTInv, studentTPdf, chiSquare } = require('./distributions');
const { goldenSection } = require('./optimize');

/**
 * @description Check the common VaR inputs.
 * @param {{sd:number, confidence:number, horizon:number}} input - Spread per period, confidence, periods.
 * @returns {void}
 */
function checkVaR({ sd, confidence, horizon }) {
  positive(sd, 'sd'); probability(confidence, 'confidence'); positive(horizon, 'horizon');
}

/**
 * @description Bell-curve (parametric) VaR and expected shortfall over a horizon, scaled by the square root of time.
 * At 95% the VaR is 1.645 standard deviations (less the mean); expected shortfall is the average loss beyond it.
 * @param {{mean?:number, sd:number, confidence?:number, horizon?:number}} input - Per-period mean and sd, confidence (0.95), periods (1).
 * @returns {{valueAtRisk:number, expectedShortfall:number, z:number}} Positive losses.
 */
function normalVaR({ mean: mu = 0, sd, confidence = 0.95, horizon = 1 }) {
  checkVaR({ sd, confidence, horizon });
  const z = normalInv(confidence), m = finite(mu, 'mean') * horizon, s = sd * Math.sqrt(horizon);
  return { valueAtRisk: z * s - m, expectedShortfall: s * normalPdf(z) / (1 - confidence) - m, z };
}

/**
 * @description Cornish-Fisher VaR: the bell-curve quantile bent by the returns' skew and excess kurtosis, so lopsided or
 * fat-tailed returns get a truer VaR. Over h periods skew shrinks by sqrt(h) and excess kurtosis by h (independent returns).
 * @param {{mean?:number, sd:number, skew:number, excessKurtosis:number, confidence?:number, horizon?:number}} input - Per-period moments.
 * @returns {{valueAtRisk:number, z:number, normalZ:number}} The adjusted VaR and quantiles.
 */
function cornishFisherVaR({ mean: mu = 0, sd, skew, excessKurtosis, confidence = 0.95, horizon = 1 }) {
  checkVaR({ sd, confidence, horizon });
  const s = finite(skew, 'skew') / Math.sqrt(horizon), k = finite(excessKurtosis, 'excessKurtosis') / horizon, q = normalInv(1 - confidence);
  const z = q + (q * q - 1) * s / 6 + (q ** 3 - 3 * q) * k / 24 - (2 * q ** 3 - 5 * q) * s * s / 36;
  return { valueAtRisk: -(finite(mu, 'mean') * horizon + z * sd * Math.sqrt(horizon)), z, normalZ: q };
}

/**
 * @description Student's t VaR and expected shortfall with nu degrees of freedom, scaled to the same standard deviation.
 * Fewer degrees of freedom mean fatter tails; nu above about 30 is close to the bell curve.
 * @param {{mean?:number, sd:number, nu:number, confidence?:number, horizon?:number}} input - Per-period mean and sd, nu (> 2).
 * @returns {{valueAtRisk:number, expectedShortfall:number}} Positive losses.
 */
function studentTVaR({ mean: mu = 0, sd, nu, confidence = 0.95, horizon = 1 }) {
  checkVaR({ sd, confidence, horizon });
  if (!(finite(nu, 'nu') > 2)) throw fail('nu must be above 2 for the variance to exist.');
  const alpha = 1 - confidence, t = studentTInv(alpha, nu), unit = Math.sqrt((nu - 2) / nu), s = sd * Math.sqrt(horizon), m = finite(mu, 'mean') * horizon;
  const tailMean = (studentTPdf(t, nu) / alpha) * ((nu + t * t) / (nu - 1));
  return { valueAtRisk: -(m + s * unit * t), expectedShortfall: s * unit * tailMean - m };
}

/**
 * @description Historical VaR and expected shortfall: the loss exceeded on the worst (1 - confidence) share of past periods,
 * and the average of those worst periods. No bell-curve assumption, but only as good as the history it saw.
 * @param {number[]} returns - Past returns (at least 20).
 * @param {{confidence?:number}} [options] - Confidence (0.95).
 * @returns {{valueAtRisk:number, expectedShortfall:number, tail:number}} Positive losses and how many periods formed the tail.
 */
function historicalVaR(returns, { confidence = 0.95 } = {}) {
  numbers(returns, 'returns', 20); probability(confidence, 'confidence');
  const cut = quantile(returns, 1 - confidence), tail = returns.filter((r) => r <= cut);
  return { valueAtRisk: -cut, expectedShortfall: -mean(tail), tail: tail.length };
}

/**
 * @description The log-likelihood term x ln(p) that is zero when x is zero.
 * @param {number} x - Count.
 * @param {number} p - Probability.
 * @returns {number} The term.
 */
function xlogp(x, p) {
  return x === 0 ? 0 : x * Math.log(p);
}

/**
 * @description Kupiec's proportion-of-failures test: did a VaR model miss about as often as its confidence promised?
 * A small p-value says the model's misses are too many (or too few) to be luck.
 * @param {{exceptions:number, observations:number, confidence:number}} input - Misses, periods, the VaR's confidence.
 * @returns {{rate:number, expectedRate:number, statistic:number, pValue:number}} The test.
 */
function kupiec({ exceptions, observations, confidence }) {
  integer(observations, 'observations', 1, 1e9); integer(exceptions, 'exceptions', 0, observations); probability(confidence, 'confidence');
  const p = 1 - confidence, x = exceptions, n = observations, rate = x / n;
  const statistic = Math.max(0, -2 * (xlogp(n - x, 1 - p) + xlogp(x, p) - xlogp(n - x, 1 - rate) - xlogp(x, rate)));
  return { rate, expectedRate: p, statistic, pValue: chiSquare(statistic, 1).pValue };
}

/**
 * @description Backtest a VaR model honestly: each day's VaR is set from the window before it only, then compared with the
 * day's real return; the misses go through Kupiec's test.
 * @param {number[]} returns - Daily returns.
 * @param {{window?:number, confidence?:number, method?:string}} [options] - Look-back (250), confidence (0.99), 'normal' or 'historical'.
 * @returns {{exceptions:number, observations:number, expected:number, kupiec:object, method:string}} The backtest.
 */
function varBacktest(returns, { window = 250, confidence = 0.99, method = 'normal' } = {}) {
  integer(window, 'window', 20, 5000); numbers(returns, 'returns', window + 20);
  if (!['normal', 'historical'].includes(method)) throw fail("method must be 'normal' or 'historical'.");
  let exceptions = 0;
  for (let t = window; t < returns.length; t += 1) {
    const past = returns.slice(t - window, t);
    const v = method === 'normal' ? normalVaR({ mean: mean(past), sd: stdev(past), confidence }).valueAtRisk : historicalVaR(past, { confidence }).valueAtRisk;
    if (returns[t] < -v) exceptions += 1;
  }
  const observations = returns.length - window;
  return { exceptions, observations, expected: observations * (1 - confidence), kupiec: kupiec({ exceptions, observations, confidence }), method };
}

/**
 * @description The degrees of freedom of a unit-variance Student's t that best fits standardized returns (maximum likelihood
 * over nu from 2.05 to 200). Daily stock returns usually land near 3 to 6: much fatter tails than the bell curve.
 * @param {number[]} returns - Returns (at least 50).
 * @returns {{nu:number, logLikelihood:number}} The fit.
 */
function fitStudentT(returns) {
  numbers(returns, 'returns', 50);
  const m = mean(returns), s = stdev(returns), z = returns.map((r) => (r - m) / s);
  const nll = (nu) => {
    const k = Math.sqrt(nu / (nu - 2));
    return -z.reduce((acc, x) => acc + Math.log(studentTPdf(x * k, nu) * k), 0);
  };
  const best = goldenSection(nll, 2.05, 200, { tolerance: 1e-6 });
  return { nu: best.x, logLikelihood: -best.f };
}

/**
 * @description Fat tails in plain numbers: skew, excess kurtosis, how often moves beyond 3 standard deviations happened
 * against the bell curve's 0.27%, and the fitted Student's t degrees of freedom.
 * @param {number[]} returns - Returns (at least 50).
 * @returns {{skew:number, excessKurtosis:number, beyond3sd:number, normalBeyond3sd:number, timesNormal:number, studentTNu:number}} The report.
 */
function tailReport(returns) {
  const m = moments(numbers(returns, 'returns', 50)), sd = Math.sqrt(m.variance);
  const beyond = returns.filter((r) => Math.abs(r - m.mean) > 3 * sd).length / returns.length, normal = 2 * normalCdf(-3);
  return { skew: m.skew, excessKurtosis: m.excessKurtosis, beyond3sd: beyond, normalBeyond3sd: normal, timesNormal: beyond / normal, studentTNu: fitStudentT(returns).nu };
}

/**
 * @description Drawdowns of a value or price series: the deepest fall from a peak, where it started, bottomed and recovered,
 * and the longest time spent below a previous peak.
 * @param {number[]} values - Positive values, oldest first.
 * @returns {{maxDrawdown:number, peak:number, trough:number, recovery:number|null, longestUnderwater:number}} Indexes and the fall (negative fraction).
 */
function drawdowns(values) {
  numbers(values, 'values', 2);
  if (values.some((v) => !(v > 0))) throw fail('Values must be above zero.');
  let peak = 0, worst = 0, at = { peak: 0, trough: 0 }, under = 0, longest = 0;
  values.forEach((v, i) => {
    if (v >= values[peak]) { peak = i; under = 0; } else { under += 1; longest = Math.max(longest, under); }
    const dd = v / values[peak] - 1;
    if (dd < worst) { worst = dd; at = { peak, trough: i }; }
  });
  const recovery = values.findIndex((v, i) => i > at.trough && v >= values[at.peak]);
  return { maxDrawdown: worst, peak: at.peak, trough: at.trough, recovery: worst < 0 && recovery >= 0 ? recovery : null, longestUnderwater: longest };
}

module.exports = { normalVaR, cornishFisherVaR, studentTVaR, historicalVaR, kupiec, varBacktest, fitStudentT, tailReport, drawdowns };
