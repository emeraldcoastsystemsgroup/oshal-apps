/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The quant lab's calculator: the math core on numbers the person (or the quant) supplies, with no price read at all. Expected value, present value, returns, the square-root-of-time rule, volatility drag, bell-curve probabilities, Kelly, the CAPM, value at risk, Black-Scholes and the Greeks, binomial trees, implied volatility, put-call parity, delta hedging, the smile, market makers (Avellaneda-Stoikov, Glosten-Milgrom, Kyle), market impact and Almgren-Chriss, the deflated Sharpe ratio, the minimum backtest length, Monte Carlo, t-tests and correlation. Numbers may be sent as text ("0.05" or "5%").
 */
'use strict';
const M = require('./math');

/**
 * @description A number from JSON input: a number, a numeric string, or a percentage string ("5%" is 0.05).
 * @param {object} input - Tool input.
 * @param {string} key - Field.
 * @param {number} [fallback] - Value when the field is absent (undefined means required).
 * @returns {number} The number.
 */
function num(input, key, fallback) {
  const raw = input[key];
  if (raw == null || raw === '') {
    if (fallback !== undefined) return fallback;
    throw M.checks.fail(`${key} is required.`);
  }
  const text = typeof raw === 'string' ? raw.trim() : raw, percent = typeof text === 'string' && text.endsWith('%');
  const value = typeof text === 'number' ? text : Number(percent ? text.slice(0, -1) : text);
  if (!Number.isFinite(value)) throw M.checks.fail(`${key} must be a number.`);
  return percent ? value / 100 : value;
}

/**
 * @description A list of numbers from JSON input.
 * @param {object} input - Tool input.
 * @param {string} key - Field.
 * @param {number} [max] - Longest list accepted (5000).
 * @returns {number[]} The numbers.
 */
function nums(input, key, max = 5000) {
  const raw = input[key];
  if (!Array.isArray(raw) || raw.length > max) throw M.checks.fail(`${key} must be a list of at most ${max} numbers.`);
  return raw.map((_, i) => num(raw, i));
}

/**
 * @description An option's terms from input (rates and volatility as decimals; T in years).
 * @param {object} i - Tool input.
 * @returns {object} {S, K, T, r, q, sigma?, type}.
 */
function terms(i) {
  return { S: num(i, 'S'), K: num(i, 'K'), T: num(i, 'T'), r: num(i, 'r', 0), q: num(i, 'q', 0), sigma: i.sigma == null ? undefined : num(i, 'sigma'), type: i.type || 'call' };
}

/** Each kind: what it computes, and how. */
const KINDS = Object.freeze({
  'expected-value': { formula: 'EV = sum of probability x value', run: (i) => M.stats.expectedValue((i.outcomes || []).map((o) => ({ probability: num(o, 'probability'), value: num(o, 'value') }))) },
  'present-value': { formula: 'PV = amount / (1 + rate)^years (or e^-rate*years)', run: (i) => ({ presentValue: M.stats.presentValue({ amount: num(i, 'amount'), rate: num(i, 'rate'), years: num(i, 'years'), compounding: i.compounding || 'annual' }) }) },
  npv: { formula: 'NPV = sum of amount_t / (1 + rate)^t', run: (i) => ({ netPresentValue: M.stats.netPresentValue({ rate: num(i, 'rate'), cashflows: (i.cashflows || []).map((f) => ({ t: num(f, 't'), amount: num(f, 'amount') })) }) }) },
  annuity: { formula: 'PV = payment x (1 - (1 + r)^-n) / r', run: (i) => ({ presentValue: M.stats.annuityPresentValue({ payment: num(i, 'payment'), rate: num(i, 'rate'), periods: num(i, 'periods') }) }) },
  returns: { formula: 'simple r = p1/p0 - 1; log r = ln(p1/p0); compound = product(1 + r) - 1', run: (i) => { const p = nums(i, 'prices'); const r = M.stats.simpleReturns(p); return { simple: r, log: M.stats.logReturns(p), total: M.stats.compound(r), annualized: M.stats.annualizedReturn(r, num(i, 'periodsPerYear', 252)) }; } },
  'sqrt-time': { formula: 'sigma_T = sigma_1 x sqrt(T)', run: (i) => ({ volatility: M.stats.scaleVolatility(num(i, 'sigma'), num(i, 'fromDays', 1), num(i, 'toDays')) }) },
  'volatility-drag': { formula: 'geometric ~ arithmetic - sigma^2 / 2', run: (i) => (i.returns ? M.stats.volatilityDrag(nums(i, 'returns')) : { arithmeticMean: num(i, 'mean'), approximateGeometric: num(i, 'mean') - num(i, 'sigma') ** 2 / 2, drag: num(i, 'sigma') ** 2 / 2 }) },
  normal: { formula: 'P(X <= x) = N((x - mean) / sd)', run: (i) => (i.probability != null ? { z: M.distributions.normalInv(num(i, 'probability')) } : (() => { const z = (num(i, 'x') - num(i, 'mean', 0)) / M.checks.positive(num(i, 'sd', 1), 'sd'); const below = M.distributions.normalCdf(z); return { z, below, above: 1 - below }; })()) },
  kelly: { formula: 'f* = (b p - q) / b for a bet; (mu - r) / sigma^2 for an asset', run: (i) => (i.p != null ? M.portfolio.kellyBet({ p: num(i, 'p'), b: num(i, 'b') }) : M.portfolio.kellyContinuous({ mu: num(i, 'mu'), sigma: num(i, 'sigma'), riskFree: num(i, 'riskFree', 0), fraction: i.fraction == null ? null : num(i, 'fraction') })) },
  capm: { formula: 'E[R] = rf + beta (E[Rm] - rf)', run: (i) => M.factorModels.capmExpectedReturn({ riskFree: num(i, 'riskFree'), beta: num(i, 'beta'), marketReturn: num(i, 'marketReturn') }) },
  var: { formula: 'normal VaR = z sd sqrt(h) - mean h; Cornish-Fisher bends z by skew and kurtosis', run: (i) => { const base = { mean: num(i, 'mean', 0), sd: num(i, 'sd'), confidence: num(i, 'confidence', 0.95), horizon: num(i, 'horizon', 1) }; return { normal: M.risk.normalVaR(base), cornishFisher: M.risk.cornishFisherVaR({ ...base, skew: num(i, 'skew', 0), excessKurtosis: num(i, 'excessKurtosis', 0) }), studentT: i.nu == null ? null : M.risk.studentTVaR({ ...base, nu: num(i, 'nu') }) }; } },
  'black-scholes': { formula: 'C = S e^-qT N(d1) - K e^-rT N(d2)', run: (i) => M.options.blackScholes(terms(i)) },
  binomial: { formula: 'Cox-Ross-Rubinstein tree, u = e^(sigma sqrt(dt))', run: (i) => M.options.binomialPrice({ ...terms(i), american: i.american === true || i.american === 'true', steps: num(i, 'steps', 500) }) },
  'implied-volatility': { formula: 'the sigma at which Black-Scholes equals the price', run: (i) => M.options.impliedVolatility({ ...terms(i), price: num(i, 'price') }) },
  'put-call-parity': { formula: 'C - P = S e^-qT - K e^-rT', run: (i) => M.options.putCallParity({ ...terms(i), call: num(i, 'call'), put: num(i, 'put') }) },
  'delta-hedge': { formula: 'hold delta shares against the option, rebalanced steps times', run: (i) => M.options.deltaHedge({ ...terms(i), trueSigma: num(i, 'trueSigma', num(i, 'sigma')), steps: num(i, 'steps', 52), paths: Math.min(num(i, 'paths', 1000), 5000), seed: 1 }) },
  smile: { formula: 'iv = a + b k + c k^2, k = ln(K / F)', run: (i) => M.options.volatilitySmile({ S: num(i, 'S'), T: num(i, 'T'), r: num(i, 'r', 0), q: num(i, 'q', 0), points: (i.points || []).map((p) => ({ strike: num(p, 'strike'), iv: num(p, 'iv') })) }) },
  'market-maker': { formula: 'r = s - q gamma sigma^2 (T - t); spread = gamma sigma^2 (T - t) + (2 / gamma) ln(1 + gamma / k)', run: (i) => M.microstructure.avellanedaStoikov({ mid: num(i, 'mid'), inventory: num(i, 'inventory', 0), riskAversion: num(i, 'riskAversion'), sigma: num(i, 'sigma'), timeLeft: num(i, 'timeLeft', 1), k: num(i, 'k') }) },
  'glosten-milgrom': { formula: 'ask = E[V | buy], bid = E[V | sell]', run: (i) => M.microstructure.glostenMilgrom({ high: num(i, 'high'), low: num(i, 'low'), probabilityHigh: num(i, 'probabilityHigh', 0.5), informed: num(i, 'informed') }) },
  kyle: { formula: 'lambda = sd(value) / (2 sd(noise flow))', run: (i) => M.microstructure.kyleLambda({ valueSd: num(i, 'valueSd'), noiseSd: num(i, 'noiseSd') }) },
  impact: { formula: 'impact = Y sigma_daily sqrt(shares / daily volume)', run: (i) => M.microstructure.squareRootImpact({ sigmaDaily: num(i, 'sigmaDaily'), shares: num(i, 'shares'), dailyVolume: num(i, 'dailyVolume'), coefficient: num(i, 'coefficient', 1) }) },
  'almgren-chriss': { formula: 'x_j = X sinh(kappa (T - t_j)) / sinh(kappa T)', run: (i) => M.microstructure.almgrenChriss({ shares: num(i, 'shares'), intervals: num(i, 'intervals'), tau: num(i, 'tau', 1), sigma: num(i, 'sigma'), eta: num(i, 'eta'), gamma: num(i, 'gamma', 0), epsilon: num(i, 'epsilon', 0), riskAversion: num(i, 'riskAversion', 0) }) },
  'deflated-sharpe': { formula: 'PSR against the best Sharpe ratio luck gives after N tries', run: (i) => M.overfitting.deflatedSharpe({ sharpe: num(i, 'sharpe'), observations: num(i, 'observations'), skew: num(i, 'skew', 0), kurtosis: num(i, 'kurtosis', 3), trials: num(i, 'trials'), trialsVariance: num(i, 'trialsVariance') }) },
  'min-backtest-length': { formula: 'years ~ (expected max z after N tries)^2 / SR^2', run: (i) => M.overfitting.minimumBacktestLength({ trials: num(i, 'trials'), sharpe: num(i, 'sharpe') }) },
  'monte-carlo': { formula: 'S_T = S0 exp((mu - sigma^2/2) T + sigma sqrt(T) Z)', run: (i) => { const run = M.simulation.simulateGbm({ S0: num(i, 'S0'), mu: num(i, 'mu'), sigma: num(i, 'sigma'), T: num(i, 'years'), paths: Math.min(num(i, 'paths', 10000), 50000), seed: 1 }); return { end: run.end, theory: run.theory }; } },
  't-test': { formula: 't = (mean - mu0) / (sd / sqrt(n))', run: (i) => M.regression.oneSampleT(nums(i, 'values'), num(i, 'mu0', 0)) },
  correlation: { formula: 'cov(a, b) / (sd a sd b)', run: (i) => ({ pearson: M.stats.correlation(nums(i, 'a'), nums(i, 'b')), spearman: M.stats.spearman(nums(i, 'a'), nums(i, 'b')) }) },
});

/**
 * @description Run one calculator kind on supplied numbers, given flat ({kind, S, K, ...}) or under inputs ({kind, inputs: {...}}).
 * @param {object} input - {kind, ...that kind's numbers} or {kind, inputs}.
 * @returns {{kind:string, formula:string, result:object}} The result.
 */
function calculate(input) {
  const given = input && typeof input === 'object' ? input : {};
  const nested = given.inputs && typeof given.inputs === 'object' && !Array.isArray(given.inputs) ? given.inputs : {};
  const body = { ...nested, ...given };
  const kind = String(body.kind || '').toLowerCase().trim(), entry = KINDS[kind];
  if (!entry) throw M.checks.fail(`kind must be one of: ${Object.keys(KINDS).join(', ')}.`);
  return { kind, formula: entry.formula, result: entry.run(body) };
}

module.exports = { KINDS, num, nums, calculate };
