/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Backtest-overfitting statistics for the quant's math core: the probabilistic Sharpe ratio (Bailey and Lopez de Prado 2012), the expected best Sharpe ratio among many tries and the deflated Sharpe ratio (2014), the minimum backtest length, and the probability of backtest overfitting by combinatorially symmetric cross-validation (Bailey, Borwein, Lopez de Prado and Zhu 2015).
 */
'use strict';
const { fail, finite, positive, integer, numbers } = require('./checks');
const { normalCdf, normalInv } = require('./distributions');
const { ols } = require('./regression');

const EULER_GAMMA = 0.5772156649015329;
/** The most cross-validation splits one call may score: 16 blocks give 12,870. */
const MAX_BLOCKS = 16;

/**
 * @description The probabilistic Sharpe ratio: the probability that the true Sharpe ratio is above a benchmark, given how
 * many observations there were and the returns' skew and kurtosis. All Sharpe ratios here are per period (not annualized).
 * @param {{sharpe:number, benchmark?:number, observations:number, skew?:number, kurtosis?:number}} input - Per-period SR, benchmark SR, T, skew, kurtosis (3 for a bell curve).
 * @returns {{probability:number, z:number}} The probability and its z-value.
 */
function probabilisticSharpe({ sharpe, benchmark = 0, observations, skew = 0, kurtosis = 3 }) {
  finite(sharpe, 'sharpe'); finite(benchmark, 'benchmark'); integer(observations, 'observations', 3, 1e8); finite(skew, 'skew'); positive(kurtosis, 'kurtosis');
  const spread = 1 - skew * sharpe + ((kurtosis - 1) / 4) * sharpe * sharpe;
  if (!(spread > 0)) throw fail('These skew and kurtosis values give the Sharpe ratio no defined uncertainty.');
  const z = (sharpe - benchmark) * Math.sqrt(observations - 1) / Math.sqrt(spread);
  return { probability: normalCdf(z), z };
}

/**
 * @description The Sharpe ratio the best of N independent tries would show by luck alone, given how much the tries' Sharpe
 * ratios varied: sqrt(V) ((1 - g) Z^-1(1 - 1/N) + g Z^-1(1 - 1/(N e))), g the Euler-Mascheroni constant.
 * @param {{trials:number, variance:number}} input - Number of tries (2 or more) and the variance of their Sharpe ratios.
 * @returns {number} The expected maximum Sharpe ratio (same units as the variance's root).
 */
function expectedMaxSharpe({ trials, variance }) {
  integer(trials, 'trials', 2, 1e9); positive(variance, 'variance');
  return Math.sqrt(variance) * ((1 - EULER_GAMMA) * normalInv(1 - 1 / trials) + EULER_GAMMA * normalInv(1 - 1 / (trials * Math.E)));
}

/**
 * @description The deflated Sharpe ratio: the probabilistic Sharpe ratio measured against the best Sharpe ratio luck alone
 * would give after N tries. Below about 0.95, the backtest does not show skill once the search is counted.
 * @param {{sharpe:number, observations:number, skew?:number, kurtosis?:number, trials:number, trialsVariance:number}} input - Per-period SR and the trials' SR variance (per period).
 * @returns {{deflatedSharpe:number, expectedMaxSharpe:number, z:number}} The probability and the luck benchmark.
 */
function deflatedSharpe({ sharpe, observations, skew = 0, kurtosis = 3, trials, trialsVariance }) {
  const benchmark = expectedMaxSharpe({ trials, variance: trialsVariance });
  const psr = probabilisticSharpe({ sharpe, benchmark, observations, skew, kurtosis });
  return { deflatedSharpe: psr.probability, expectedMaxSharpe: benchmark, z: psr.z };
}

/**
 * @description The minimum backtest length: after N tries, how many years of history are needed before the best one's
 * annual Sharpe ratio can no longer be explained by luck alone (Bailey, Borwein, Lopez de Prado and Zhu 2014).
 * @param {{trials:number, sharpe:number}} input - Number of tries and the annual Sharpe ratio to tell apart from luck.
 * @returns {{years:number}} Years of data needed.
 */
function minimumBacktestLength({ trials, sharpe }) {
  integer(trials, 'trials', 2, 1e9); positive(sharpe, 'sharpe');
  const z = (1 - EULER_GAMMA) * normalInv(1 - 1 / trials) + EULER_GAMMA * normalInv(1 - 1 / (trials * Math.E));
  return { years: (z * z) / (sharpe * sharpe) };
}

/**
 * @description Every way to choose k of n items (as index lists).
 * @param {number} n - Items.
 * @param {number} k - Chosen.
 * @returns {number[][]} The combinations.
 */
function combinations(n, k) {
  const out = [], pick = [];
  const walk = (start) => {
    if (pick.length === k) { out.push(pick.slice()); return; }
    for (let i = start; i <= n - (k - pick.length); i += 1) { pick.push(i); walk(i + 1); pick.pop(); }
  };
  walk(0);
  return out;
}

/**
 * @description Per-block sums, sums of squares and counts of each strategy's returns.
 * @param {number[][]} matrix - Rows are periods, columns strategies.
 * @param {number} blocks - Block count.
 * @returns {{sum:number[][], sq:number[][], count:number}} Block statistics.
 */
function blockStats(matrix, blocks) {
  const n = matrix[0].length, size = Math.floor(matrix.length / blocks), skip = matrix.length - size * blocks;
  const sum = Array.from({ length: blocks }, () => new Array(n).fill(0)), sq = Array.from({ length: blocks }, () => new Array(n).fill(0));
  for (let b = 0; b < blocks; b += 1) {
    for (let t = skip + b * size; t < skip + (b + 1) * size; t += 1) {
      for (let j = 0; j < n; j += 1) { const r = matrix[t][j]; sum[b][j] += r; sq[b][j] += r * r; }
    }
  }
  return { sum, sq, count: size };
}

/**
 * @description Each strategy's Sharpe ratio over a set of blocks.
 * @param {object} st - Block statistics.
 * @param {number[]} chosen - Block indexes.
 * @returns {number[]} Sharpe ratios per strategy (0 when a strategy never varies).
 */
function sharpeOver(st, chosen) {
  const n = st.sum[0].length, count = st.count * chosen.length;
  return Array.from({ length: n }, (_, j) => {
    let s = 0, q = 0;
    for (const b of chosen) { s += st.sum[b][j]; q += st.sq[b][j]; }
    const m = s / count, v = (q - count * m * m) / (count - 1);
    return v > 0 ? m / Math.sqrt(v) : 0;
  });
}

/**
 * @description The rank (1 worst .. n best, ties averaged) of one value among a list.
 * @param {number[]} values - All values.
 * @param {number} index - Which one.
 * @returns {number} Its rank.
 */
function rankOf(values, index) {
  const v = values[index];
  let below = 0, equal = 0;
  for (const x of values) { if (x < v) below += 1; else if (x === v) equal += 1; }
  return below + (equal + 1) / 2;
}

/**
 * @description The probability of backtest overfitting (PBO) by combinatorially symmetric cross-validation: split the history
 * into S blocks; for every half-and-half split, pick the strategy that looked best in one half and see where it ranks in the
 * other. PBO is how often the in-sample winner lands in the bottom half out of sample. Near 0: the winner keeps winning;
 * near 0.5 or above: picking the best backtest is no better than chance.
 * @param {number[][]} matrix - Rows are periods, columns are the strategies tried (2-500), each a return per period.
 * @param {{blocks?:number}} [options] - Even block count S (2-16, default 16, at most periods / 4).
 * @returns {{pbo:number, splits:number, strategies:number, degradationSlope:number|null, probabilityOfLossOutOfSample:number, medianLogit:number}} The estimate.
 */
function backtestOverfitting(matrix, { blocks = MAX_BLOCKS } = {}) {
  if (!Array.isArray(matrix) || matrix.length < 8) throw fail('PBO needs at least 8 periods of strategy returns.');
  const n = numbers(matrix[0], 'strategy returns', 2).length;
  if (n > 500) throw fail('PBO accepts at most 500 strategies.');
  matrix.forEach((row) => { numbers(row, 'strategy returns'); if (row.length !== n) throw fail('Every period needs one return per strategy.'); });
  if (blocks % 2 !== 0) throw fail('blocks must be even.');
  integer(blocks, 'blocks', 2, Math.min(MAX_BLOCKS, Math.floor(matrix.length / 4) - (Math.floor(matrix.length / 4) % 2)));
  const st = blockStats(matrix, blocks), all = Array.from({ length: blocks }, (_, i) => i), logits = [], isBest = [], oosBest = [];
  for (const train of combinations(blocks, blocks / 2)) {
    const test = all.filter((b) => !train.includes(b)), inSample = sharpeOver(st, train), outSample = sharpeOver(st, test);
    const best = inSample.indexOf(Math.max(...inSample)), w = rankOf(outSample, best) / (n + 1);
    logits.push(Math.log(w / (1 - w))); isBest.push(inSample[best]); oosBest.push(outSample[best]);
  }
  const sorted = [...logits].sort((a, b) => a - b), slope = new Set(isBest).size > 2 ? ols(oosBest, [isBest]).coefficients[1].estimate : null;
  return { pbo: logits.filter((l) => l <= 0).length / logits.length, splits: logits.length, strategies: n, degradationSlope: slope, probabilityOfLossOutOfSample: oosBest.filter((x) => x < 0).length / oosBest.length, medianLogit: sorted[Math.floor(sorted.length / 2)] };
}

module.exports = { EULER_GAMMA, probabilisticSharpe, expectedMaxSharpe, deflatedSharpe, minimumBacktestLength, combinations, backtestOverfitting };
