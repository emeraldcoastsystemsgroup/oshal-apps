/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Monte Carlo for the quant's math core: geometric Brownian motion paths with their exact theoretical moments, a block bootstrap of real returns (keeps their fat tails and short-run clustering), and bootstrap confidence intervals for any statistic. Seeded, with caps on paths x steps so a run stays inside one short call.
 */
'use strict';
const { fail, finite, positive, integer, numbers } = require('./checks');
const { mean, stdev, quantile } = require('./stats');
const { randomSource } = require('./random');

/** The most simulated points (paths x steps) one call may make. */
const MAX_POINTS = 2000000;
const BANDS = Object.freeze([0.05, 0.25, 0.5, 0.75, 0.95]);

/**
 * @description The exact moments of geometric Brownian motion at time T: E[S_T] = S0 e^(mu T),
 * Var = S0^2 e^(2 mu T)(e^(sigma^2 T) - 1), and the median S0 e^((mu - sigma^2/2) T), which sits below the mean (volatility drag).
 * @param {{S0:number, mu:number, sigma:number, T:number}} input - Start, annual drift, annual volatility, years.
 * @returns {{mean:number, variance:number, sd:number, median:number}} The moments.
 */
function gbmMoments({ S0, mu, sigma, T }) {
  positive(S0, 'S0'); finite(mu, 'mu'); positive(sigma, 'sigma'); positive(T, 'T');
  const m = S0 * Math.exp(mu * T), v = S0 * S0 * Math.exp(2 * mu * T) * (Math.exp(sigma * sigma * T) - 1);
  return { mean: m, variance: v, sd: Math.sqrt(v), median: S0 * Math.exp((mu - sigma * sigma / 2) * T) };
}

/**
 * @description Summarize simulated end values against the start.
 * @param {number[]} ends - End values.
 * @param {number} start - Start value.
 * @returns {object} Mean, sd, percentiles, probability of ending below the start.
 */
function summarizeEnds(ends, start) {
  return {
    mean: mean(ends), sd: stdev(ends), standardError: stdev(ends) / Math.sqrt(ends.length),
    percentiles: Object.fromEntries(BANDS.map((p) => [`p${Math.round(p * 100)}`, quantile(ends, p)])),
    probabilityOfLoss: ends.filter((x) => x < start).length / ends.length, paths: ends.length,
  };
}

/**
 * @description Simulate geometric Brownian motion (the textbook model of a stock: log returns normal and independent) and
 * summarize where the price may end. Steps only matter for the checkpoints; the end value is exact for any step count.
 * @param {{S0:number, mu:number, sigma:number, T:number, steps?:number, paths?:number, seed?:number}} input - Start, annual drift and volatility, years, steps (1-2520), paths (100-200000), seed.
 * @returns {{end:object, theory:object, checkpoints:Array<object>}} Simulated end values, the exact moments, and percentile bands along the way.
 */
function simulateGbm({ S0, mu, sigma, T, steps = 1, paths = 10000, seed = 1 }) {
  const theory = gbmMoments({ S0, mu, sigma, T });
  integer(steps, 'steps', 1, 2520); integer(paths, 'paths', 100, 200000);
  if (steps * paths > MAX_POINTS) throw fail(`steps x paths must stay at or below ${MAX_POINTS}.`);
  const rng = randomSource(seed), dt = T / steps, drift = (mu - sigma * sigma / 2) * dt, vol = sigma * Math.sqrt(dt);
  const every = Math.max(1, Math.floor(steps / 12)), values = new Float64Array(paths).fill(S0), checkpoints = [];
  for (let s = 1; s <= steps; s += 1) {
    for (let p = 0; p < paths; p += 1) values[p] *= Math.exp(drift + vol * rng.normal());
    if (s % every === 0 || s === steps) {
      const arr = Array.from(values);
      checkpoints.push({ step: s, years: s * dt, ...Object.fromEntries(BANDS.map((q) => [`p${Math.round(q * 100)}`, quantile(arr, q)])) });
    }
  }
  return { end: summarizeEnds(Array.from(values), S0), theory, checkpoints };
}

/**
 * @description Block bootstrap of real returns: build many possible futures by stitching together random blocks of past
 * days, so fat tails and short-run clustering survive (a block of 1 is the plain bootstrap). Answers "from what this stock
 * actually did, where could it be in h days?" without assuming a bell curve.
 * @param {number[]} returns - Past simple returns (at least 30).
 * @param {{horizon:number, paths?:number, block?:number, seed?:number}} input - Days ahead (1-2520), paths (100-100000), block length (1-60), seed.
 * @returns {object} The end-of-horizon return distribution (start value 1).
 */
function bootstrapPaths(returns, { horizon, paths = 5000, block = 5, seed = 1 }) {
  numbers(returns, 'returns', 30);
  integer(horizon, 'horizon', 1, 2520); integer(paths, 'paths', 100, 100000); integer(block, 'block', 1, Math.min(60, returns.length));
  if (horizon * paths > MAX_POINTS) throw fail(`horizon x paths must stay at or below ${MAX_POINTS}.`);
  const rng = randomSource(seed), ends = new Array(paths);
  for (let p = 0; p < paths; p += 1) {
    let value = 1, taken = 0;
    while (taken < horizon) {
      const start = rng.below(returns.length - block + 1);
      for (let k = 0; k < block && taken < horizon; k += 1, taken += 1) value *= 1 + returns[start + k];
    }
    ends[p] = value;
  }
  return { ...summarizeEnds(ends, 1), horizon, block };
}

/**
 * @description A bootstrap confidence interval for any statistic of a sample (percentile method): resample with
 * replacement, recompute, and read the middle of the results.
 * @param {number[]} values - Sample (at least 10).
 * @param {(sample:number[]) => number} statistic - The statistic.
 * @param {{resamples?:number, confidence?:number, seed?:number}} [options] - Resamples (100-20000), confidence (0.95), seed.
 * @returns {{estimate:number, standardError:number, low:number, high:number, resamples:number}} The interval.
 */
function bootstrapStatistic(values, statistic, { resamples = 2000, confidence = 0.95, seed = 1 } = {}) {
  numbers(values, 'values', 10); integer(resamples, 'resamples', 100, 20000);
  if (typeof statistic !== 'function') throw fail('statistic must be a function.');
  if (values.length * resamples > MAX_POINTS * 5) throw fail('Too much resampling for one call.');
  const rng = randomSource(seed), stats = [];
  for (let b = 0; b < resamples; b += 1) stats.push(statistic(values.map(() => values[rng.below(values.length)])));
  const tail = (1 - confidence) / 2;
  return { estimate: statistic(values), standardError: stdev(stats), low: quantile(stats, tail), high: quantile(stats, 1 - tail), resamples };
}

module.exports = { MAX_POINTS, gbmMoments, simulateGbm, bootstrapPaths, bootstrapStatistic };
