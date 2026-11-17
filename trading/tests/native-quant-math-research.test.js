/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guards the quant's research math on published examples: the deflated Sharpe ratio's worked example (0.9004), the minimum backtest length (about 5 years after 45 tries at Sharpe 1), PBO near 0 for a real edge and high for noise, Monte Carlo GBM matching its exact moments, the bootstrap, Glosten-Milgrom's bid and ask, Kyle's lambda, Avellaneda-Stoikov's reservation price and spread, the square-root impact law, Almgren-Chriss (an even split with no risk aversion), Roll and Corwin-Schultz spreads recovered from simulated trading, Amihud, beta = cov/var, the CAPM, the Fama-French size and value construction, a low-volatility quantile sort and Fama-MacBeth premia.
 */
'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { overfitting: of, simulation: sim, microstructure: ms, factorModels: fm, random, stats, regression } = require('../routes/quant/math');

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

test('the deflated Sharpe ratio reproduces Bailey and Lopez de Prado (2014): 0.9004, and the minimum backtest length', () => {
  const dsr = of.deflatedSharpe({ sharpe: 2.5 / Math.sqrt(250), observations: 1250, skew: -3, kurtosis: 10, trials: 100, trialsVariance: 0.5 / 250 });
  near(dsr.expectedMaxSharpe, 0.1132, 1e-4, 'best Sharpe ratio luck gives after 100 tries (daily)');
  near(dsr.deflatedSharpe, 0.9004, 1e-4, 'deflated Sharpe ratio');
  near(of.probabilisticSharpe({ sharpe: 0.1, observations: 1000 }).probability, 0.999191, 1e-5, 'PSR of daily SR 0.1 over 1000 days against zero');
  assert.ok(of.probabilisticSharpe({ sharpe: 0.1, observations: 1000, skew: -2, kurtosis: 12 }).probability < of.probabilisticSharpe({ sharpe: 0.1, observations: 1000 }).probability, 'left skew and fat tails make a Sharpe ratio less certain');
  near(of.minimumBacktestLength({ trials: 45, sharpe: 1 }).years, 5, 0.01, '45 tries need about 5 years before Sharpe 1 means anything');
  assert.ok(of.expectedMaxSharpe({ trials: 1000, variance: 1 }) > of.expectedMaxSharpe({ trials: 10, variance: 1 }), 'more tries, a luckier best');
});

test('PBO: near 0 when one strategy has a real edge, high when every strategy is noise', () => {
  const rng = random.randomSource(9), noise = Array.from({ length: 1000 }, () => Array.from({ length: 20 }, () => 0.01 * rng.normal()));
  const pure = of.backtestOverfitting(noise);
  assert.equal(pure.splits, 12870, 'C(16, 8) splits');
  assert.ok(pure.pbo > 0.4, `noise: the in-sample winner is a coin flip or worse out of sample (PBO ${pure.pbo})`);
  assert.ok(pure.degradationSlope < 0, 'in-sample luck predicts nothing good out of sample');
  const edge = of.backtestOverfitting(noise.map((row) => row.map((x, j) => (j === 3 ? x + 0.004 : x))));
  assert.ok(edge.pbo < 0.05, `a real edge survives cross-validation (PBO ${edge.pbo})`);
  assert.equal(of.combinations(6, 3).length, 20);
  assert.throws(() => of.backtestOverfitting(noise, { blocks: 5 }), /even/);
});

test('Monte Carlo GBM matches its exact moments, and the median sits below the mean', () => {
  const run = sim.simulateGbm({ S0: 100, mu: 0.08, sigma: 0.25, T: 1, paths: 50000, seed: 4 });
  near(run.theory.mean, 100 * Math.exp(0.08), 1e-9, 'E[S_T] = S0 e^(mu T)');
  assert.ok(Math.abs(run.end.mean - run.theory.mean) < 3 * run.end.standardError, `simulated mean ${run.end.mean}`);
  near(run.end.sd / run.theory.sd, 1, 0.02, 'simulated spread');
  near(run.end.percentiles.p50, run.theory.median, 0.6, 'median S0 e^((mu - sigma^2/2) T)');
  assert.ok(run.theory.median < run.theory.mean, 'volatility drag: the typical path ends below the average');
  const stepped = sim.simulateGbm({ S0: 100, mu: 0.08, sigma: 0.25, T: 1, steps: 252, paths: 4000, seed: 4 });
  assert.equal(stepped.checkpoints.at(-1).step, 252);
  assert.throws(() => sim.simulateGbm({ S0: 100, mu: 0, sigma: 0.2, T: 1, steps: 2520, paths: 1000 }), /2000000/);
});

test('the bootstrap: a resampled mean is centered on the sample mean with the textbook standard error', () => {
  const rng = random.randomSource(5), r = Array.from({ length: 1000 }, () => 0.0004 + 0.01 * rng.normal());
  const b = sim.bootstrapStatistic(r, stats.mean, { resamples: 3000, seed: 3 });
  near(b.standardError, stats.stdev(r) / Math.sqrt(1000), 0.1 * stats.stdev(r) / Math.sqrt(1000), 'bootstrap standard error');
  assert.ok(b.low < b.estimate && b.estimate < b.high, 'the interval holds the estimate');
  const paths = sim.bootstrapPaths(r, { horizon: 21, paths: 5000, block: 5, seed: 2 });
  near(paths.mean, (1 + stats.mean(r)) ** 21, 0.005, 'a month of resampled days');
  assert.deepEqual(sim.bootstrapPaths(r, { horizon: 5, paths: 200, seed: 8 }), sim.bootstrapPaths(r, { horizon: 5, paths: 200, seed: 8 }), 'same seed, same answer');
});

test('market makers: Glosten-Milgrom quotes, Kyle lambda, Avellaneda-Stoikov inventory shading', () => {
  const gm = ms.glostenMilgrom({ high: 110, low: 90, informed: 0.2 });
  near(gm.ask, 102, 1e-12, 'ask = E[value | buy]'); near(gm.bid, 98, 1e-12, 'bid = E[value | sell]');
  near(gm.spread, 0.2 * 20, 1e-12, 'with a 50/50 prior the spread is the informed share times the value gap');
  near(ms.glostenMilgrom({ high: 110, low: 90, informed: 0 }).spread, 0, 1e-12, 'no informed traders, no spread');
  near(ms.kyleLambda({ valueSd: 2, noiseSd: 4 }).lambda, 0.25, 1e-15, 'lambda = sd(value) / (2 sd(noise))');
  const as = ms.avellanedaStoikov({ mid: 100, inventory: 2, riskAversion: 0.1, sigma: 2, timeLeft: 1, k: 1.5 });
  near(as.reservationPrice, 99.2, 1e-12, 'long 2: quotes shade down to sell inventory');
  near(as.spread, 0.4 + 20 * Math.log(1 + 0.1 / 1.5), 1e-12, 'optimal spread');
  near(ms.avellanedaStoikov({ mid: 100, inventory: -2, riskAversion: 0.1, sigma: 2, timeLeft: 1, k: 1.5 }).reservationPrice, 100.8, 1e-12, 'short: shade up');
  const rng = random.randomSource(3), flow = Array.from({ length: 400 }, () => rng.normal() * 1000), dp = flow.map((f) => 0.0005 * f + 0.2 * rng.normal());
  near(ms.estimateKyleLambda(dp, flow).lambda, 0.0005, 3e-5, 'lambda estimated from signed flow');
});

test('the cost of size: the square-root law and Almgren-Chriss', () => {
  const impact = ms.squareRootImpact({ sigmaDaily: 0.02, shares: 10000, dailyVolume: 1e6 });
  near(impact.impactBps, 20, 1e-9, '1% of a day at 2% volatility costs 20 basis points');
  near(ms.squareRootImpact({ sigmaDaily: 0.02, shares: 40000, dailyVolume: 1e6 }).impact / impact.impact, 2, 1e-12, 'four times the size, twice the impact');
  const terms = { shares: 1e6, intervals: 5, sigma: 0.95, eta: 2.5e-6, gamma: 2.5e-7, epsilon: 0.0625 };
  const even = ms.almgrenChriss({ ...terms, riskAversion: 0 });
  even.trades.forEach((n) => near(n, 200000, 1e-6, 'no risk aversion: an even split'));
  near(even.expectedCost, 662500, 1e-6, 'its expected cost');
  const urgent = ms.almgrenChriss({ ...terms, riskAversion: 1e-6 });
  near(urgent.kappa, Math.acosh(1 + (1e-6 * 0.95 ** 2) / (2.5e-6 - 2.5e-7 / 2) / 2), 1e-12, 'kappa for lambda 1e-6 (about 0.6 a day, as in the paper)');
  assert.ok(urgent.trades[0] > urgent.trades[1] && urgent.trades[1] > urgent.trades[4], 'risk aversion trades sooner');
  assert.ok(urgent.variance < even.variance && urgent.expectedCost > even.expectedCost, 'less risk, more cost');
  near(urgent.holdings[0], 1e6, 1e-6, 'starts with the whole order'); near(urgent.holdings[5], 0, 1e-6, 'ends with nothing');
});

test('spreads: the quoted spread, Roll and Corwin-Schultz recover a simulated spread, Amihud by hand', () => {
  const q = ms.quotedSpread({ bid: 99.98, ask: 100.02, bidSize: 300, askSize: 100 });
  near(q.spreadBps, 4, 1e-9, 'four basis points'); near(q.microprice, 100.01, 1e-9, 'leans toward the thin ask side');
  assert.throws(() => ms.quotedSpread({ bid: 100.1, ask: 100 }), /crossed/);
  const rng = random.randomSource(12), mids = [100], trades = [];
  for (let t = 1; t < 5000; t += 1) mids.push(mids[t - 1] + 0.05 * rng.normal());
  for (const p of mids) trades.push(p + (rng.uniform() < 0.5 ? -0.05 : 0.05));
  near(ms.rollSpread(trades).spread, 0.1, 0.01, 'Roll: bid-ask bounce reveals a 10-cent spread');
  assert.equal(ms.rollSpread(Array.from({ length: 50 }, (_, i) => 100 + i)).spread, null, 'no bounce, no Roll estimate');
  const highs = [], lows = [], closes = [];
  let mid = 100;
  for (let d = 0; d < 500; d += 1) {
    let hi = -Infinity, lo = Infinity, last = mid;
    for (let k = 0; k < 390; k += 1) { mid *= Math.exp(0.015 / Math.sqrt(390) * rng.normal()); last = mid * (1 + (rng.uniform() < 0.5 ? -0.005 : 0.005)); hi = Math.max(hi, last); lo = Math.min(lo, last); }
    highs.push(hi); lows.push(lo); closes.push(last);
  }
  const cs = ms.corwinSchultz({ highs, lows, closes });
  near(cs.spread, 0.01, 0.002, 'Corwin-Schultz: a 1% spread from daily highs and lows');
  assert.ok(cs.spreadZeroedDaily > cs.spread, 'flooring each day first biases it up');
  near(ms.amihud([0.01, -0.02], [1e6, 4e6]).illiquidity, (0.01 + 0.005) / 2, 1e-15, 'Amihud: mean |r| per $1M');
});

test('beta = cov / var = the regression slope; the CAPM; Fama-French size and value; a low-volatility sort; Fama-MacBeth', () => {
  const rng = random.randomSource(14), m = Array.from({ length: 500 }, () => 0.0005 + 0.01 * rng.normal()), a = m.map((x) => 0.0002 + 1.3 * x + 0.005 * rng.normal());
  const b = fm.betaOf(a, m);
  near(b.beta, stats.covariance(a, m) / stats.variance(m), 1e-12, 'cov / var');
  near(b.beta, regression.ols(a, [m]).coefficients[1].estimate, 1e-12, 'the same as the slope');
  near(b.beta, 1.3, 0.05, 'true beta');
  near(fm.capmExpectedReturn({ riskFree: 0.04, beta: 1.3, marketReturn: 0.09 }).expectedReturn, 0.04 + 1.3 * 0.05, 1e-15, 'rf + beta (Rm - rf)');
  const capm = fm.capmRegression(a, m, { riskFree: 0.04 });
  near(capm.beta.estimate, b.beta, 1e-12, 'regression beta'); assert.ok(capm.alpha.pValue > 0.05, 'a small alpha is not distinguishable from zero');
  const sections = Array.from({ length: 60 }, () => Array.from({ length: 100 }, () => {
    const size = Math.exp(rng.normal() * 1.5 + 10), bookToMarket = Math.exp(rng.normal() * 0.5);
    return { size, bookToMarket, ret: 0.01 * rng.normal() + (size < Math.exp(10) ? 0.01 : 0) + (bookToMarket > Math.exp(0.26) ? 0.005 : 0) };
  }));
  const ff = fm.famaFrenchFactors(sections, { equalWeight: true });
  near(ff.smbMean.mean, 0.01, 0.002, 'SMB recovers the small-stock premium'); near(ff.hmlMean.mean, 0.005, 0.0015, 'HML recovers the value premium');
  const sorts = Array.from({ length: 120 }, () => Array.from({ length: 200 }, () => { const v = 0.1 + 0.5 * rng.uniform(); return { value: v, ret: 0.01 - 0.02 * v + 0.03 * rng.normal() }; }));
  const low = fm.quantileSort(sorts);
  assert.ok(low.bucketMeans[0] > low.bucketMeans[4] && low.spread.t < -5, 'calm stocks beat wild ones here, and the sort shows it');
  const panel = Array.from({ length: 120 }, () => { const ex = Array.from({ length: 50 }, () => [rng.normal(), rng.normal()]); return { exposures: ex, returns: ex.map((e) => 0.002 + 0.01 * e[0] + 0.02 * rng.normal()) }; });
  const fmb = fm.famaMacBeth(panel, { names: ['priced', 'unpriced'] });
  near(fmb.premia[1].mean, 0.01, 0.001, 'the priced factor earns its premium'); assert.ok(fmb.premia[1].t > 20, 'reliably');
  assert.ok(Math.abs(fmb.premia[2].mean) < 0.002, `the unpriced one earns about nothing: ${fmb.premia[2].mean}`);
  const reg3 = fm.factorRegression(a, { market: m, size: m.map(() => 0.001 * rng.normal()), value: m.map(() => 0.001 * rng.normal()) });
  assert.deepEqual(reg3.loadings.map((l) => l.name), ['market', 'size', 'value']);
});
