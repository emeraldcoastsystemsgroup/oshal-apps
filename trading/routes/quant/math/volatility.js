/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Volatility models for the quant's math core: GARCH(1,1) and GJR-GARCH (bad news raises volatility more than good news) fitted by maximum likelihood, their forecasts and a likelihood-ratio test for the asymmetry; EWMA (RiskMetrics), Parkinson and Garman-Klass estimators from daily highs and lows; and volatility targeting.
 */
'use strict';
const { fail, finite, positive, integer, numbers } = require('./checks');
const { mean, variance } = require('./stats');
const { chiSquare } = require('./distributions');
const { nelderMead } = require('./optimize');
const { randomSource } = require('./random');

const LOG_2PI = Math.log(2 * Math.PI);
/** Persistence is kept just below 1 so the long-run variance stays finite. */
const MAX_PERSISTENCE = 0.9999;
/** Starting guesses typical of daily stock returns; the fit moves away from them freely. */
const START = Object.freeze({ garch: { alpha: 0.08, beta: 0.88, gamma: 0 }, gjr: { alpha: 0.03, beta: 0.88, gamma: 0.1 } });

/**
 * @description The conditional variances of a GARCH / GJR-GARCH model over demeaned returns, started at their sample variance.
 * @param {number[]} e - Demeaned returns.
 * @param {{omega:number, alpha:number, beta:number, gamma:number}} p - Parameters.
 * @param {number} start - Initial variance.
 * @returns {number[]} sigma^2 for each period (one more than e: the last is tomorrow's).
 */
function conditionalVariances(e, p, start) {
  const out = new Array(e.length + 1);
  out[0] = start;
  for (let t = 0; t < e.length; t += 1) {
    const shock = e[t] * e[t];
    out[t + 1] = p.omega + (p.alpha + (e[t] < 0 ? p.gamma : 0)) * shock + p.beta * out[t];
  }
  return out;
}

/**
 * @description The Gaussian log-likelihood of demeaned returns under the model.
 * @param {number[]} e - Demeaned returns.
 * @param {object} p - Parameters.
 * @param {number} start - Initial variance.
 * @returns {number} The log-likelihood (higher is better).
 */
function logLikelihood(e, p, start) {
  const v = conditionalVariances(e, p, start);
  let ll = 0;
  for (let t = 0; t < e.length; t += 1) {
    if (!(v[t] > 0)) return -Infinity;
    ll -= 0.5 * (LOG_2PI + Math.log(v[t]) + e[t] * e[t] / v[t]);
  }
  return ll;
}

/**
 * @description Map unconstrained numbers to valid parameters: omega > 0, alpha, beta, gamma >= 0 and persistence
 * alpha + beta + gamma/2 below 1 (a logistic for the persistence, a softmax for its split).
 * @param {number[]} theta - Unconstrained values.
 * @param {string} model - 'garch' or 'gjr'.
 * @param {number} scale - Sample variance (omega's scale).
 * @returns {{omega:number, alpha:number, beta:number, gamma:number, persistence:number}} Parameters.
 */
function toParameters(theta, model, scale) {
  const persistence = MAX_PERSISTENCE / (1 + Math.exp(-theta[1]));
  const logits = model === 'gjr' ? [0, theta[2], theta[3]] : [0, theta[2]], top = Math.max(...logits);
  const w = logits.map((l) => Math.exp(l - top)), total = w.reduce((s, x) => s + x, 0), share = w.map((x) => x / total);
  return { omega: scale * Math.exp(theta[0]), alpha: persistence * share[0], beta: persistence * share[1], gamma: model === 'gjr' ? 2 * persistence * share[2] : 0, persistence };
}

/**
 * @description The unconstrained start point matching the typical starting guesses.
 * @param {string} model - 'garch' or 'gjr'.
 * @returns {number[]} theta.
 */
function startTheta(model) {
  const s = START[model], p = s.alpha + s.beta + s.gamma / 2;
  const theta = [Math.log(1 - p), Math.log(p / (MAX_PERSISTENCE - p)), Math.log(s.beta / s.alpha)];
  return model === 'gjr' ? [...theta, Math.log(s.gamma / 2 / s.alpha)] : theta;
}

/**
 * @description Fit GARCH(1,1) or GJR-GARCH(1,1) by Gaussian maximum likelihood (Nelder-Mead, restarted once from its best point).
 * Volatility clusters: calm follows calm and storms follow storms; GJR adds that falls raise volatility more than rises.
 * @param {number[]} returns - Daily returns (at least 100; returns, not prices).
 * @param {{model?:string, periodsPerYear?:number}} [options] - 'garch' (default) or 'gjr'.
 * @returns {object} {model, omega, alpha, beta, gamma, persistence, longRunVolatility (annual), halfLifeDays, logLikelihood, n, mean, converged, lastVariance, nextVariance}.
 */
function fitGarch(returns, { model = 'garch', periodsPerYear = 252 } = {}) {
  numbers(returns, 'returns', 100);
  if (!['garch', 'gjr'].includes(model)) throw fail("model must be 'garch' or 'gjr'.");
  const mu = mean(returns), e = returns.map((r) => r - mu), scale = variance(e);
  if (!(scale > 0)) throw fail('Returns that never change have no volatility to model.');
  const objective = (theta) => -logLikelihood(e, toParameters(theta, model, scale), scale);
  let best = nelderMead(objective, startTheta(model), { maxIterations: 3000, tolerance: 1e-12 });
  best = nelderMead(objective, best.x, { step: 0.1, maxIterations: 3000, tolerance: 1e-12 });
  const p = toParameters(best.x, model, scale), v = conditionalVariances(e, p, scale);
  return {
    model, ...p, logLikelihood: -best.f, n: returns.length, mean: mu, converged: best.converged,
    longRunVolatility: Math.sqrt(p.omega / (1 - p.persistence) * periodsPerYear),
    halfLifeDays: Math.log(0.5) / Math.log(p.persistence), lastVariance: v[v.length - 2], nextVariance: v[v.length - 1],
  };
}

/**
 * @description The variance path the fitted model expects: tomorrow's variance decays toward the long-run level at the rate of persistence.
 * @param {object} fit - A fitGarch result.
 * @param {number} horizon - Days ahead (1 to 2520).
 * @param {{periodsPerYear?:number}} [options] - Annualization.
 * @returns {{dailyVariances:number[], averageVolatility:number, nextDayVolatility:number, longRunVolatility:number}} Annualized volatilities and daily variances.
 */
function forecastGarch(fit, horizon, { periodsPerYear = 252 } = {}) {
  integer(horizon, 'horizon', 1, 2520);
  const longRun = fit.omega / (1 - fit.persistence), daily = [];
  for (let h = 1; h <= horizon; h += 1) daily.push(longRun + fit.persistence ** (h - 1) * (fit.nextVariance - longRun));
  const avg = daily.reduce((s, x) => s + x, 0) / horizon;
  return { dailyVariances: daily, averageVolatility: Math.sqrt(avg * periodsPerYear), nextDayVolatility: Math.sqrt(fit.nextVariance * periodsPerYear), longRunVolatility: Math.sqrt(longRun * periodsPerYear) };
}

/**
 * @description Is the asymmetry real? Likelihood-ratio test of GJR-GARCH against GARCH (one extra parameter).
 * @param {object} garch - fitGarch with model 'garch'.
 * @param {object} gjr - fitGarch with model 'gjr' on the same returns.
 * @returns {{statistic:number, pValue:number}} The test; a small p-value says falls really do raise volatility more.
 */
function asymmetryTest(garch, gjr) {
  const statistic = Math.max(0, 2 * (gjr.logLikelihood - garch.logLikelihood));
  return { statistic, pValue: chiSquare(statistic, 1).pValue };
}

/**
 * @description Simulate returns from a GARCH / GJR-GARCH model (for tests and illustrations).
 * @param {{omega:number, alpha:number, beta:number, gamma?:number, n:number, seed:number, burn?:number}} input - True parameters, length, seed.
 * @returns {number[]} Returns with mean zero.
 */
function simulateGarch({ omega, alpha, beta, gamma = 0, n, seed, burn = 500 }) {
  positive(omega, 'omega'); finite(alpha, 'alpha'); finite(beta, 'beta'); finite(gamma, 'gamma');
  integer(n, 'n', 1, 1000000);
  const persistence = alpha + beta + gamma / 2;
  if (!(persistence < 1)) throw fail('alpha + beta + gamma/2 must be below 1.');
  const rng = randomSource(seed), out = [];
  let v = omega / (1 - persistence);
  for (let t = 0; t < n + burn; t += 1) {
    const e = Math.sqrt(v) * rng.normal();
    if (t >= burn) out.push(e);
    v = omega + (alpha + (e < 0 ? gamma : 0)) * e * e + beta * v;
  }
  return out;
}

/**
 * @description EWMA volatility (RiskMetrics): recent days weigh more, decaying by lambda each day.
 * @param {number[]} returns - Daily returns.
 * @param {{lambda?:number, periodsPerYear?:number}} [options] - Decay (0.94) and annualization.
 * @returns {{daily:number, annual:number, lambda:number}} Tomorrow's volatility.
 */
function ewmaVolatility(returns, { lambda = 0.94, periodsPerYear = 252 } = {}) {
  numbers(returns, 'returns', 20);
  if (!(finite(lambda, 'lambda') > 0 && lambda < 1)) throw fail('lambda must be between 0 and 1.');
  let v = returns.slice(0, 20).reduce((s, r) => s + r * r, 0) / 20;
  for (const r of returns) v = lambda * v + (1 - lambda) * r * r;
  return { daily: Math.sqrt(v), annual: Math.sqrt(v * periodsPerYear), lambda };
}

/**
 * @description Check daily high/low (and open/close) series for range estimators.
 * @param {Object<string, number[]>} series - Named series.
 * @returns {number} Their common length.
 */
function rangeSeries(series) {
  const lengths = Object.entries(series).map(([name, v]) => numbers(v, name, 2).length);
  if (new Set(lengths).size !== 1) throw fail('The daily series must all be the same length.');
  if (Object.values(series).some((v) => v.some((x) => !(x > 0)))) throw fail('Prices must be above zero.');
  if (series.highs.some((h, i) => h < series.lows[i])) throw fail('A high is below its low.');
  return lengths[0];
}

/**
 * @description Parkinson (1980) volatility from daily highs and lows: about five times as efficient as closes alone,
 * biased low when trading is not continuous.
 * @param {number[]} highs - Daily highs.
 * @param {number[]} lows - Daily lows.
 * @param {{periodsPerYear?:number}} [options] - Annualization.
 * @returns {{daily:number, annual:number}} The estimate.
 */
function parkinsonVolatility(highs, lows, { periodsPerYear = 252 } = {}) {
  const n = rangeSeries({ highs, lows });
  const v = highs.reduce((s, h, i) => s + Math.log(h / lows[i]) ** 2, 0) / (4 * Math.LN2 * n);
  return { daily: Math.sqrt(v), annual: Math.sqrt(v * periodsPerYear) };
}

/**
 * @description Garman-Klass (1980) volatility from daily open, high, low and close.
 * @param {{opens:number[], highs:number[], lows:number[], closes:number[]}} bars - Daily series.
 * @param {{periodsPerYear?:number}} [options] - Annualization.
 * @returns {{daily:number, annual:number}} The estimate.
 */
function garmanKlassVolatility({ opens, highs, lows, closes }, { periodsPerYear = 252 } = {}) {
  const n = rangeSeries({ opens, highs, lows, closes });
  let v = 0;
  for (let i = 0; i < n; i += 1) v += 0.5 * Math.log(highs[i] / lows[i]) ** 2 - (2 * Math.LN2 - 1) * Math.log(closes[i] / opens[i]) ** 2;
  v = Math.max(0, v / n);
  return { daily: Math.sqrt(v), annual: Math.sqrt(v * periodsPerYear) };
}

/**
 * @description Volatility targeting: hold more when expected volatility is low and less when it is high, so the position's
 * risk stays near a target. Exposure = target / forecast, capped.
 * @param {{targetVolatility:number, forecastVolatility:number, maxLeverage?:number}} input - Annual target, annual forecast, cap (1 = never borrow).
 * @returns {{exposure:number, capped:boolean}} Share of capital to hold.
 */
function volatilityTarget({ targetVolatility, forecastVolatility, maxLeverage = 1 }) {
  const raw = positive(targetVolatility, 'targetVolatility') / positive(forecastVolatility, 'forecastVolatility');
  positive(maxLeverage, 'maxLeverage');
  return { exposure: Math.min(raw, maxLeverage), capped: raw > maxLeverage };
}

module.exports = { conditionalVariances, logLikelihood, fitGarch, forecastGarch, asymmetryTest, simulateGarch, ewmaVolatility, parkinsonVolatility, garmanKlassVolatility, volatilityTarget };
