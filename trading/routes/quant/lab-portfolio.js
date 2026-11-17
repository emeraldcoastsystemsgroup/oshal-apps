/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The quant lab's views over several real stocks: a portfolio (correlation, diversification, the efficient frontier, risk parity, Black-Litterman, Kelly and volatility targeting), a pair for statistical arbitrage (cointegration, half-life, spread z-score and a Kalman hedge ratio) and a Monte Carlo of where one stock could end (geometric Brownian motion or a bootstrap of its own days). Weights from past returns are fragile; every answer says so.
 */
'use strict';
const M = require('./math');
const { attempt, needs, pct } = require('./lab-format');

const METHODS = Object.freeze(['diversification', 'frontier', 'risk-parity', 'black-litterman', 'kelly', 'vol-target']);
const YEAR = 252;
const FRAGILE = 'Expected returns estimated from past prices are noisy, so optimized weights swing with a few more days of data; treat them as a sketch, not a plan.';

/**
 * @description Annualized mean returns, covariance and correlation of aligned closes.
 * @param {number[][]} closes - Each name's closes on shared dates.
 * @returns {{mu:number[], sigma:number[][], correlation:number[][], returns:number[][], n:number}} Inputs for the optimizers.
 */
function moments(closes) {
  const returns = closes.map((c) => M.stats.simpleReturns(c)), cov = M.portfolio.covarianceMatrix(returns);
  const sigma = cov.map((row) => row.map((x) => x * YEAR));
  return { mu: returns.map((r) => M.stats.mean(r) * YEAR), sigma, correlation: M.portfolio.correlationMatrix(sigma), returns, n: returns[0].length };
}

/**
 * @description Weights as a name-to-weight map, rounded for reading.
 * @param {string[]} names - Names.
 * @param {number[]} w - Weights.
 * @returns {Object<string, number>} The map.
 */
function named(names, w) {
  return Object.fromEntries(names.map((n, i) => [n, Math.round(w[i] * 10000) / 10000]));
}

/**
 * @description Black-Litterman with absolute views: each view says one name returns a stated rate a year.
 * @param {string[]} names - Names.
 * @param {object} m - Moments.
 * @param {number[]} market - Starting (market) weights.
 * @param {Array<{symbol:string, expectedReturn:number}>} views - Views.
 * @returns {object} Equilibrium, blended returns and weights by name.
 */
function blackLittermanByName(names, m, market, views) {
  const usable = (Array.isArray(views) ? views : []).filter((v) => names.includes(String(v && v.symbol).toUpperCase()) && Number.isFinite(Number(v.expectedReturn)));
  const P = usable.map((v) => names.map((n) => (n === String(v.symbol).toUpperCase() ? 1 : 0)));
  const bl = M.portfolio.blackLitterman({ sigma: m.sigma, marketWeights: market, views: P.length ? { P, Q: usable.map((v) => Number(v.expectedReturn)) } : null });
  return { equilibrium: named(names, bl.equilibrium), posterior: named(names, bl.posterior), weights: named(names, bl.weights), viewsUsed: usable.length };
}

/**
 * @description The portfolio view for one method over aligned closes.
 * @param {string[]} names - Names in order.
 * @param {number[][]} closes - Each name's closes on shared dates.
 * @param {{method:string, riskFree?:number, weights?:number[]|null, views?:Array<object>, targetVolatility?:number}} o - Method and options.
 * @returns {object} The result with correlations and plain sentences.
 */
function portfolioView(names, closes, { method, riskFree = 0, weights = null, views = [], targetVolatility = 0.15 }) {
  const m = moments(closes), equal = names.map(() => 1 / names.length), w = weights || equal;
  const risk = (x) => M.portfolio.portfolioRisk(x, m.sigma, m.mu);
  const base = { method, sessions: m.n + 1, correlation: m.correlation.map((row) => row.map((x) => Math.round(x * 1000) / 1000)), annualReturn: named(names, m.mu), annualVolatility: named(names, m.sigma.map((row, i) => Math.sqrt(row[i]))) };
  const run = {
    diversification: () => ({ weights: named(names, w), ...risk(w) }),
    frontier: () => ({ minimumVariance: named(names, M.portfolio.minimumVariance(m.sigma)), tangency: attempt(() => named(names, M.portfolio.tangency(m.mu, m.sigma, riskFree))), longOnly: named(names, M.portfolio.longOnlyMeanVariance(m.mu, m.sigma)), points: M.portfolio.efficientFrontier(m.mu, m.sigma, { points: 5 }).points.map((p) => ({ expectedReturn: p.expectedReturn, volatility: p.volatility, weights: named(names, p.weights) })) }),
    'risk-parity': () => { const rp = M.portfolio.riskParity(m.sigma); return { weights: named(names, rp), riskContributions: named(names, risk(rp).riskContributions), equalWeightContributions: named(names, risk(equal).riskContributions) }; },
    'black-litterman': () => blackLittermanByName(names, m, w, views),
    kelly: () => { const k = M.portfolio.kellyPortfolio(m.mu, m.sigma, riskFree); return { fullKelly: named(names, k), halfKelly: named(names, k.map((x) => x / 2)), leverage: k.reduce((s, x) => s + Math.abs(x), 0) }; },
    'vol-target': () => { const r = risk(w); return { weights: named(names, w), volatility: r.volatility, ...M.volatility.volatilityTarget({ targetVolatility, forecastVolatility: r.volatility }) }; },
  };
  if (!run[method]) throw M.checks.fail(`method must be one of ${METHODS.join(', ')}.`);
  const result = attempt(run[method]);
  const avgCorr = names.length > 1 ? M.stats.mean(m.correlation.flatMap((row, i) => row.filter((_, j) => j > i))) : null;
  return { ...base, result, plain: [`Across ${m.n} shared trading days the names' average correlation was ${avgCorr == null ? 'n/a' : avgCorr.toFixed(2)}.`, FRAGILE] };
}

/**
 * @description The pair view for statistical arbitrage: are two prices tied together (cointegrated), how fast does the gap
 * close, where is it now, and how has the hedge ratio drifted (Kalman filter)?
 * @param {string[]} names - [a, b].
 * @param {number[][]} closes - Both closes on shared dates.
 * @returns {object} The figures and a verdict.
 */
function pairView(names, closes) {
  const [ya, yb] = closes.map((c) => c.map(Math.log)), n = ya.length;
  const eg = needs(n - 1, 30, 'Engle-Granger cointegration') || attempt(() => M.timeseries.engleGranger(ya, yb));
  const spread = eg.spread || null, ra = M.stats.simpleReturns(closes[0]), rb = M.stats.simpleReturns(closes[1]);
  const out = {
    returnCorrelation: attempt(() => M.stats.correlation(ra, rb)),
    cointegration: eg.unavailable ? eg : { hedgeRatio: eg.hedgeRatio, statistic: eg.adf.statistic, criticalValues: eg.adf.criticalValues, cointegratedAt: eg.cointegratedAt },
    halfLife: spread ? attempt(() => M.timeseries.halfLife(spread)) : null,
    spreadZScore: spread ? attempt(() => M.timeseries.zScore(spread, Math.min(60, spread.length))) : null,
    kalman: needs(n - 1, 20, 'A Kalman hedge ratio') || attempt(() => { const k = M.kalman.dynamicHedgeRatio(ya, yb); return { latestHedgeRatio: k.hedgeRatios.at(-1), staticHedgeRatio: k.staticHedgeRatio, zScore: k.zScore }; }),
  };
  out.verdict = eg.cointegratedAt ? `tied together (cointegrated at ${eg.cointegratedAt})` : 'not shown to be tied together: a spread between them can wander without coming back';
  out.plain = [`${names[0]} and ${names[1]} over ${n} shared days: ${out.verdict}.`, 'Pairs that were cointegrated can break apart; a statistical-arbitrage spread needs its stop as much as its entry.'];
  return out;
}

/**
 * @description Monte Carlo of where one stock could be after a horizon, from its own past: geometric Brownian motion with
 * its historical drift and volatility, or a block bootstrap of its actual days (keeps fat tails).
 * @param {number[]} closes - Closes.
 * @param {{horizonDays:number, method?:string, paths?:number}} o - Days ahead, 'gbm' or 'bootstrap', paths.
 * @returns {object} The ending-price distribution in dollars and as a return.
 */
function simulateView(closes, { horizonDays, method = 'gbm', paths = 5000 }) {
  M.checks.integer(horizonDays, 'horizonDays', 1, 756);
  const r = M.stats.simpleReturns(closes), last = closes[closes.length - 1], logR = r.map((x) => Math.log1p(x));
  const sigma = M.stats.stdev(logR) * Math.sqrt(YEAR), mu = M.stats.mean(logR) * YEAR + sigma * sigma / 2;
  if (method === 'gbm') {
    const run = M.simulation.simulateGbm({ S0: last, mu, sigma, T: horizonDays / YEAR, steps: Math.min(horizonDays, 63), paths: Math.min(paths, 20000), seed: 1 });
    return { method, start: last, horizonDays, drift: mu, volatility: sigma, end: run.end, theory: run.theory, plain: [`Half the simulated paths end between ${run.end.percentiles.p25.toFixed(2)} and ${run.end.percentiles.p75.toFixed(2)}; ${pct(run.end.probabilityOfLoss, 0)} end below today's ${last.toFixed(2)}.`, 'The drift is the past average and is a poor forecast; the spread of outcomes is the useful part.'] };
  }
  if (method !== 'bootstrap') throw M.checks.fail("method must be 'gbm' or 'bootstrap'.");
  const boot = M.simulation.bootstrapPaths(r, { horizon: horizonDays, paths: Math.min(paths, 20000), block: Math.min(5, r.length), seed: 1 });
  const toPrice = (x) => x * last;
  return { method, start: last, horizonDays, end: { mean: toPrice(boot.mean), percentiles: Object.fromEntries(Object.entries(boot.percentiles).map(([k, v]) => [k, toPrice(v)])), probabilityOfLoss: boot.probabilityOfLoss, paths: boot.paths }, plain: [`Resampling its own ${r.length} days, ${pct(boot.probabilityOfLoss, 0)} of ${boot.paths} paths end below today's price after ${horizonDays} days.`] };
}

module.exports = { METHODS, FRAGILE, moments, portfolioView, pairView, simulateView };
