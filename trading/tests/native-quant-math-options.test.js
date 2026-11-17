/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Guards the quant's option math on textbook values: Black-Scholes (100, 100, 1 year, 5%, 20%) is a 10.4506 call and a 5.5735 put, put-call parity holds, every Greek matches a finite difference of the price, the CRR binomial tree converges to Black-Scholes and prices the American put's early-exercise premium, implied volatility round-trips and refuses an impossible price, Monte Carlo agrees within its error, delta hedging's error shrinks with rebalancing, and the smile fit recovers a known curve.
 */
'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { options: o } = require('../routes/quant/math');

const BASE = Object.freeze({ S: 100, K: 100, T: 1, r: 0.05, sigma: 0.2 });

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

test('Black-Scholes(100, 100, 1y, 5%, 20%): call 10.4506, put 5.5735, and put-call parity holds', () => {
  const call = o.blackScholes({ ...BASE, type: 'call' }), put = o.blackScholes({ ...BASE, type: 'put' });
  near(call.price, 10.4506, 5e-5, 'call'); near(put.price, 5.5735, 5e-5, 'put');
  near(call.price, 10.450583572185565, 1e-12, 'call to scipy precision'); near(put.price, 5.573526022256971, 1e-12, 'put to scipy precision');
  near(o.putCallParity({ ...BASE, call: call.price, put: put.price }).gap, 0, 1e-12, 'parity gap');
  const off = o.putCallParity({ ...BASE, call: call.price + 0.5, put: put.price });
  near(off.gap, 0.5, 1e-12, 'a mispriced call shows as a parity gap');
  const withYield = { ...BASE, q: 0.03 };
  near(o.putCallParity({ ...withYield, call: o.blackScholes({ ...withYield, type: 'call' }).price, put: o.blackScholes({ ...withYield, type: 'put' }).price }).gap, 0, 1e-12, 'parity with a dividend yield');
});

test('every Greek matches a finite difference of the Black-Scholes price', () => {
  for (const type of ['call', 'put']) {
    const price = (over) => o.blackScholes({ ...BASE, q: 0.02, type, ...over }).price, g = o.blackScholes({ ...BASE, q: 0.02, type }), h = 1e-4;
    near(g.delta, (price({ S: BASE.S + h }) - price({ S: BASE.S - h })) / (2 * h), 1e-7, `${type} delta`);
    near(g.gamma, (price({ S: BASE.S + 1e-2 }) - 2 * price({}) + price({ S: BASE.S - 1e-2 })) / 1e-4, 1e-6, `${type} gamma`);
    near(g.vega, (price({ sigma: BASE.sigma + h }) - price({ sigma: BASE.sigma - h })) / (2 * h), 1e-6, `${type} vega`);
    near(g.rho, (price({ r: BASE.r + h }) - price({ r: BASE.r - h })) / (2 * h), 1e-6, `${type} rho`);
    near(g.theta, -(price({ T: BASE.T + h }) - price({ T: BASE.T - h })) / (2 * h), 1e-6, `${type} theta (per year)`);
  }
  const call = o.blackScholes({ ...BASE, type: 'call' });
  near(call.delta, 0.636830651175619, 1e-12, 'textbook call delta N(0.35)');
  near(call.gamma, 0.018762017345846895, 1e-12, 'gamma');
});

test('the CRR binomial tree converges to Black-Scholes, and the American put is worth more than the European', () => {
  const bs = o.blackScholes({ ...BASE, type: 'call' }).price;
  const errors = [50, 200, 1000].map((steps) => Math.abs(o.binomialPrice({ ...BASE, type: 'call', steps }).price - bs));
  assert.ok(errors[0] > errors[1] && errors[1] > errors[2], `the error shrinks with steps: ${errors}`);
  near(o.binomialPrice({ ...BASE, type: 'call', steps: 2000 }).price, bs, 2e-3, 'CRR 2000 steps');
  const amCall = o.binomialPrice({ ...BASE, type: 'call', american: true, steps: 500 });
  near(amCall.earlyExercisePremium, 0, 1e-12, 'an American call on a stock without dividends is never exercised early');
  const amPut = o.binomialPrice({ ...BASE, type: 'put', american: true, steps: 5000 });
  near(amPut.price, 6.0902194, 1e-6, 'American put, numpy CRR 5000 steps');
  near(amPut.price, 6.0903, 2e-4, 'American put, converged reference');
  near(amPut.european, o.blackScholes({ ...BASE, type: 'put' }).price, 2e-3, 'the same tree prices the European put');
  assert.ok(amPut.earlyExercisePremium > 0.5 && amPut.earlyExercisePremium < 0.53, `early-exercise premium ${amPut.earlyExercisePremium}`);
});

test('implied volatility round-trips across strikes and refuses a price no volatility can give', () => {
  for (const K of [70, 90, 100, 115, 140]) {
    for (const type of ['call', 'put']) {
      const price = o.blackScholes({ ...BASE, K, sigma: 0.37, type }).price;
      near(o.impliedVolatility({ ...BASE, K, price, type }).impliedVolatility, 0.37, 1e-9, `IV ${type} K=${K}`);
    }
  }
  const tooHigh = o.impliedVolatility({ ...BASE, price: 150, type: 'call' });
  assert.equal(tooHigh.impliedVolatility, null);
  assert.match(tooHigh.reason, /no-arbitrage range/);
  assert.equal(o.impliedVolatility({ ...BASE, price: 1, type: 'call' }).impliedVolatility, null, 'below intrinsic value');
});

test('Monte Carlo agrees with Black-Scholes within its standard error', () => {
  const mc = o.monteCarloPrice({ ...BASE, type: 'call', paths: 200000, seed: 3 });
  const bs = o.blackScholes({ ...BASE, type: 'call' }).price;
  assert.ok(Math.abs(mc.price - bs) < 3 * mc.standardError, `MC ${mc.price} +/- ${mc.standardError} vs ${bs}`);
  assert.deepEqual(o.monteCarloPrice({ ...BASE, paths: 1000, seed: 9 }), o.monteCarloPrice({ ...BASE, paths: 1000, seed: 9 }), 'same seed, same answer');
});

test('delta hedging: profit averages zero at the right volatility and its spread halves when rebalancing quadruples', () => {
  const runs = [16, 64, 256].map((steps) => o.deltaHedge({ ...BASE, type: 'call', steps, paths: 1500, seed: 5, mu: 0.1 }));
  for (const run of runs) assert.ok(Math.abs(run.meanPnl) < 4 * run.sdPnl / Math.sqrt(run.paths), `mean ${run.meanPnl}`);
  near(runs[0].sdPnl / runs[1].sdPnl, 2, 0.3, 'x4 rebalancing halves the error');
  near(runs[1].sdPnl / runs[2].sdPnl, 2, 0.3, 'again');
  const wrong = o.deltaHedge({ ...BASE, type: 'call', steps: 64, paths: 1500, seed: 5, trueSigma: 0.3 });
  assert.ok(wrong.meanPnl < -1, `selling at 20% volatility a stock that moves 30% loses: ${wrong.meanPnl}`);
  assert.throws(() => o.deltaHedge({ ...BASE, steps: 1000, paths: 20000 }), /2,000,000/);
});

test('the volatility smile fit recovers a known curve from supplied points', () => {
  const S = 100, T = 0.5, r = 0.03, F = S * Math.exp(r * T), curve = (K) => { const k = Math.log(K / F); return 0.22 - 0.25 * k + 0.6 * k * k; };
  const points = [70, 85, 100, 115, 130].map((strike) => ({ strike, iv: curve(strike) }));
  const fit = o.volatilitySmile({ S, T, r, points });
  near(fit.atm, 0.22, 1e-10, 'level'); near(fit.skew, -0.25, 1e-10, 'skew'); near(fit.curvature, 0.6, 1e-9, 'curvature');
  const three = o.volatilitySmile({ S, T, r, points: points.slice(1, 4) });
  near(three.skew, -0.25, 1e-9, 'three points give the exact quadratic');
  assert.throws(() => o.volatilitySmile({ S, T, points: points.slice(0, 2) }), /at least 3/);
});

test('option inputs are checked', () => {
  assert.throws(() => o.blackScholes({ ...BASE, sigma: 0 }), /sigma/);
  assert.throws(() => o.blackScholes({ ...BASE, T: -1 }), /years to expiry/);
  assert.throws(() => o.blackScholes({ ...BASE, type: 'straddle' }), /call' or 'put/);
  assert.throws(() => o.binomialPrice({ ...BASE, steps: 6000 }), /1 to 5000/);
});
