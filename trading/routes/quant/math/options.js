/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Option pricing for the quant's math core: Black-Scholes(-Merton) with a dividend yield and its Greeks, put-call parity, implied volatility, the Cox-Ross-Rubinstein binomial tree (European and American, with the early-exercise premium), a Monte Carlo price, a discrete delta-hedging simulation and a volatility-smile fit on supplied strike and volatility points.
 */
'use strict';
const { fail, finite, positive, integer } = require('./checks');
const { normalCdf, normalPdf } = require('./distributions');
const { bracketRoot } = require('./optimize');
const { randomSource } = require('./random');
const { ols } = require('./regression');
const { mean, stdev } = require('./stats');

/**
 * @description Check one option's inputs.
 * @param {object} o - {S, K, T, r, sigma?, q?, type}.
 * @param {boolean} [needSigma] - Whether sigma is required.
 * @returns {{S:number, K:number, T:number, r:number, q:number, sigma:number, call:boolean}} Normalized inputs.
 */
function optionInputs({ S, K, T, r = 0, sigma, q = 0, type = 'call' }, needSigma = true) {
  if (!['call', 'put'].includes(type)) throw fail("type must be 'call' or 'put'.");
  positive(S, 'S (stock price)'); positive(K, 'K (strike)'); positive(T, 'T (years to expiry)');
  finite(r, 'r (risk-free rate)'); finite(q, 'q (dividend yield)');
  if (needSigma) positive(sigma, 'sigma (volatility)');
  return { S, K, T, r, q, sigma, call: type === 'call' };
}

/**
 * @description Black-Scholes(-Merton) price and Greeks of a European option with a continuous dividend yield.
 * Vega and rho are per 1.00 change (divide by 100 for one point); theta is per year (divide by 365 for a calendar day).
 * @param {{S:number, K:number, T:number, r?:number, sigma:number, q?:number, type?:string}} input - Price, strike, years, rate, volatility, yield, call/put.
 * @returns {{price:number, delta:number, gamma:number, vega:number, theta:number, rho:number, d1:number, d2:number}} The figures.
 */
function blackScholes(input) {
  const { S, K, T, r, q, sigma, call } = optionInputs(input);
  const sq = sigma * Math.sqrt(T), d1 = (Math.log(S / K) + (r - q + sigma * sigma / 2) * T) / sq, d2 = d1 - sq;
  const dq = Math.exp(-q * T), dr = Math.exp(-r * T), pdf = normalPdf(d1);
  const price = call ? S * dq * normalCdf(d1) - K * dr * normalCdf(d2) : K * dr * normalCdf(-d2) - S * dq * normalCdf(-d1);
  const decay = -S * dq * pdf * sigma / (2 * Math.sqrt(T));
  return {
    price, d1, d2,
    delta: call ? dq * normalCdf(d1) : -dq * normalCdf(-d1),
    gamma: dq * pdf / (S * sq),
    vega: S * dq * pdf * Math.sqrt(T),
    theta: call ? decay - r * K * dr * normalCdf(d2) + q * S * dq * normalCdf(d1) : decay + r * K * dr * normalCdf(-d2) - q * S * dq * normalCdf(-d1),
    rho: call ? K * T * dr * normalCdf(d2) : -K * T * dr * normalCdf(-d2),
  };
}

/**
 * @description Put-call parity: C - P = S e^(-qT) - K e^(-rT) for European options. A gap means one side is mispriced,
 * or the inputs (rate, dividend) are wrong.
 * @param {{S:number, K:number, T:number, r?:number, q?:number, call:number, put:number}} input - Market inputs and both prices.
 * @returns {{callMinusPut:number, forwardMinusStrike:number, gap:number, impliedForward:number}} The check.
 */
function putCallParity({ S, K, T, r = 0, q = 0, call, put }) {
  optionInputs({ S, K, T, r, q, type: 'call' }, false);
  finite(call, 'call price'); finite(put, 'put price');
  const forwardMinusStrike = S * Math.exp(-q * T) - K * Math.exp(-r * T), callMinusPut = call - put;
  return { callMinusPut, forwardMinusStrike, gap: callMinusPut - forwardMinusStrike, impliedForward: (callMinusPut) * Math.exp(r * T) + K };
}

/**
 * @description Implied volatility: the volatility at which Black-Scholes gives the market price. A price outside the
 * no-arbitrage bounds has none, and the answer says so instead of inventing one.
 * @param {{price:number, S:number, K:number, T:number, r?:number, q?:number, type?:string}} input - Option price and its terms.
 * @returns {{impliedVolatility:number|null, reason:string|null}} The volatility (0.25 is 25%) or why there is none.
 */
function impliedVolatility(input) {
  const o = optionInputs(input, false);
  positive(input.price, 'price');
  const fwdS = o.S * Math.exp(-o.q * o.T), pvK = o.K * Math.exp(-o.r * o.T);
  const lower = Math.max(0, o.call ? fwdS - pvK : pvK - fwdS), upper = o.call ? fwdS : pvK;
  if (!(input.price > lower && input.price < upper)) return { impliedVolatility: null, reason: `The price is outside the no-arbitrage range (${lower.toFixed(4)} to ${upper.toFixed(4)}).` };
  const root = bracketRoot((s) => blackScholes({ ...input, sigma: s }).price - input.price, 1e-6, 10, { tolerance: 1e-12 });
  return root == null ? { impliedVolatility: null, reason: 'No volatility from 0% to 1000% gives that price.' } : { impliedVolatility: root, reason: null };
}

/**
 * @description The Cox-Ross-Rubinstein binomial tree: the stock steps up by u or down by 1/u; the option is valued back from
 * expiry. American options may be exercised early, which puts can reward; the premium over the European value is reported.
 * @param {{S:number, K:number, T:number, r?:number, sigma:number, q?:number, type?:string, american?:boolean, steps?:number}} input - Terms, style and steps (1-5000).
 * @returns {{price:number, european:number, earlyExercisePremium:number, steps:number}} Prices from the same tree.
 */
function binomialPrice(input) {
  const { S, K, T, r, q, sigma, call } = optionInputs(input), steps = integer(input.steps ?? 500, 'steps', 1, 5000);
  const dt = T / steps, u = Math.exp(sigma * Math.sqrt(dt)), d = 1 / u, p = (Math.exp((r - q) * dt) - d) / (u - d), disc = Math.exp(-r * dt);
  if (!(p > 0 && p < 1)) throw fail('Too few steps for this rate and volatility: the tree would need a negative probability.');
  const payoff = (s) => Math.max(0, call ? s - K : K - s);
  const eu = new Float64Array(steps + 1), am = new Float64Array(steps + 1);
  for (let j = 0; j <= steps; j += 1) eu[j] = am[j] = payoff(S * u ** j * d ** (steps - j));
  const u2 = u * u;
  for (let i = steps - 1; i >= 0; i -= 1) {
    let s = S * d ** i;
    for (let j = 0; j <= i; j += 1, s *= u2) {
      eu[j] = disc * (p * eu[j + 1] + (1 - p) * eu[j]);
      am[j] = Math.max(disc * (p * am[j + 1] + (1 - p) * am[j]), payoff(s));
    }
  }
  const price = input.american ? am[0] : eu[0];
  return { price, european: eu[0], earlyExercisePremium: am[0] - eu[0], steps };
}

/**
 * @description A Monte Carlo price of a European option: average discounted payoff over simulated risk-neutral prices
 * (antithetic pairs), with its standard error. Converges to Black-Scholes as paths grow.
 * @param {{S:number, K:number, T:number, r?:number, sigma:number, q?:number, type?:string, paths?:number, seed?:number}} input - Terms, paths (2-1,000,000), seed.
 * @returns {{price:number, standardError:number, paths:number}} The estimate.
 */
function monteCarloPrice(input) {
  const { S, K, T, r, q, sigma, call } = optionInputs(input), paths = integer(input.paths ?? 100000, 'paths', 2, 1000000);
  const rng = randomSource(input.seed ?? 1), drift = (r - q - sigma * sigma / 2) * T, vol = sigma * Math.sqrt(T), disc = Math.exp(-r * T);
  const pay = (z) => { const s = S * Math.exp(drift + vol * z); return Math.max(0, call ? s - K : K - s); };
  const pairs = [];
  for (let i = 0; i < Math.floor(paths / 2); i += 1) { const z = rng.normal(); pairs.push(disc * (pay(z) + pay(-z)) / 2); }
  return { price: mean(pairs), standardError: stdev(pairs) / Math.sqrt(pairs.length), paths: pairs.length * 2 };
}

/**
 * @description Simulate one delta-hedged short option to expiry and return its hedging profit or loss.
 * @param {object} c - Prepared inputs.
 * @param {object} rng - Random source.
 * @returns {number} Profit or loss at expiry.
 */
function hedgedPath(c, rng) {
  const dt = c.T / c.steps;
  let s = c.S, delta = blackScholes({ ...c.terms, S: s, T: c.T }).delta, cash = c.premium - delta * s;
  for (let i = 1; i <= c.steps; i += 1) {
    // The price drifts at mu less the dividend yield; the shares held collect the dividend into cash.
    s *= Math.exp((c.mu - c.terms.q - c.trueSigma ** 2 / 2) * dt + c.trueSigma * Math.sqrt(dt) * rng.normal());
    cash = cash * Math.exp(c.terms.r * dt) + delta * s * c.terms.q * dt;
    const next = i < c.steps ? blackScholes({ ...c.terms, S: s, T: c.T - i * dt }).delta : (c.call ? Number(s > c.terms.K) : -Number(s < c.terms.K));
    cash -= (next - delta) * s;
    delta = next;
  }
  return cash + delta * s - Math.max(0, c.call ? s - c.terms.K : c.terms.K - s);
}

/**
 * @description Delta hedging: sell an option at its Black-Scholes price and hold delta shares, rebalanced `steps` times.
 * With the right volatility the profit averages zero and its spread shrinks as rebalancing gets more frequent; hedging at the
 * wrong volatility leaves a loss or gain. Research illustration on simulated prices only.
 * @param {{S:number, K:number, T:number, r?:number, q?:number, type?:string, sigma:number, trueSigma?:number, mu?:number, steps?:number, paths?:number, seed?:number}} input - Terms, pricing/hedging volatility, the volatility the stock really has, its drift, rebalances, paths.
 * @returns {{premium:number, meanPnl:number, sdPnl:number, steps:number, paths:number}} The hedger's results.
 */
function deltaHedge(input) {
  const o = optionInputs(input), steps = integer(input.steps ?? 52, 'steps', 1, 1000), paths = integer(input.paths ?? 1000, 'paths', 10, 20000);
  if (steps * paths > 2000000) throw fail('steps x paths must stay at or below 2,000,000.');
  const terms = { K: o.K, r: o.r, q: o.q, sigma: o.sigma, type: o.call ? 'call' : 'put' };
  const c = { S: o.S, T: o.T, steps, terms, call: o.call, premium: blackScholes(input).price, trueSigma: positive(input.trueSigma ?? o.sigma, 'trueSigma'), mu: finite(input.mu ?? o.r, 'mu') };
  const rng = randomSource(input.seed ?? 1), pnl = Array.from({ length: paths }, () => hedgedPath(c, rng));
  return { premium: c.premium, meanPnl: mean(pnl), sdPnl: stdev(pnl), steps, paths };
}

/**
 * @description The volatility smile: implied volatility usually differs by strike (puts below the price cost more).
 * Fits iv = a + b k + c k^2 on k = ln(K / F) from supplied points; a is the at-the-money level, b the skew, c the curvature.
 * @param {{S:number, T:number, r?:number, q?:number, points:Array<{strike:number, iv:number}>}} input - Spot, years and at least 3 (strike, implied volatility) points.
 * @returns {{atm:number, skew:number, curvature:number, r2:number|null, forward:number, points:Array<object>}} The fit.
 */
function volatilitySmile({ S, T, r = 0, q = 0, points }) {
  positive(S, 'S'); positive(T, 'T'); finite(r, 'r'); finite(q, 'q');
  if (!Array.isArray(points) || points.length < 3) throw fail('A smile needs at least 3 (strike, iv) points.');
  for (const p of points) { positive(p && p.strike, 'strike'); positive(p.iv, 'iv'); }
  const forward = S * Math.exp((r - q) * T), k = points.map((p) => Math.log(p.strike / forward));
  const fit = points.length > 3 ? ols(points.map((p) => p.iv), [k, k.map((x) => x * x)]) : null;
  const [a, b, c] = fit ? fit.coefficients.map((x) => x.estimate) : exactQuadratic(k, points.map((p) => p.iv));
  return { atm: a, skew: b, curvature: c, r2: fit ? fit.r2 : null, forward, points: points.map((p, i) => ({ strike: p.strike, iv: p.iv, k: k[i], fitted: a + b * k[i] + c * k[i] ** 2 })) };
}

/**
 * @description The quadratic through exactly three points (Lagrange form expanded).
 * @param {number[]} x - Three distinct abscissae.
 * @param {number[]} y - Three values.
 * @returns {number[]} [a, b, c] of a + b x + c x^2.
 */
function exactQuadratic(x, y) {
  const [x0, x1, x2] = x, [y0, y1, y2] = y, d = (x0 - x1) * (x0 - x2) * (x1 - x2);
  if (!(Math.abs(d) > 0)) throw fail('Three distinct strikes are needed.');
  const c = (x2 * (y1 - y0) + x1 * (y0 - y2) + x0 * (y2 - y1)) / d;
  const b = (x2 * x2 * (y0 - y1) + x1 * x1 * (y2 - y0) + x0 * x0 * (y1 - y2)) / d;
  return [y0 - b * x0 - c * x0 * x0, b, c];
}

module.exports = { blackScholes, putCallParity, impliedVolatility, binomialPrice, monteCarloPrice, deltaHedge, volatilitySmile };
