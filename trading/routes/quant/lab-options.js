/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The quant's option view over a real Schwab option chain (the kernel's trading.chains read): for each of the nearest expirations, the at-the-money implied volatility and the expected move it prices, the volatility smile fitted on out-of-the-money strikes, put-call parity checked on every strike quoted both ways, and the at-the-money contracts' market Greeks; then implied against the stock's own historical volatility. With no Schwab connection, or a kernel without the read, it says so and shows no chain.
 */
'use strict';
const M = require('./math');
const { attempt, pct } = require('./lab-format');

/** The nearest expirations summarized in one answer. */
const MAX_EXPIRATIONS = 6;

/**
 * @description A contract's mid price: halfway between a two-sided quote, else its mark, else its last trade.
 * @param {object|null} c - Contract row.
 * @returns {number|null} The price, or null when it has none.
 */
function mid(c) {
  if (!c) return null;
  if (c.bid > 0 && c.ask > 0) return (c.bid + c.ask) / 2;
  return c.mark > 0 ? c.mark : c.last > 0 ? c.last : null;
}

/**
 * @description The contract with the strike nearest a price.
 * @param {Array<object>} rows - Contracts.
 * @param {number} spot - Price.
 * @returns {object|null} The contract.
 */
function nearest(rows, spot) {
  return rows.reduce((best, c) => (best == null || Math.abs(c.strike - spot) < Math.abs(best.strike - spot) ? c : best), null);
}

/**
 * @description Put-call parity on every strike quoted both ways: the median gap and the largest.
 * @param {object} e - Expiration with calls and puts.
 * @param {number} spot - Underlying price.
 * @param {number} T - Years to expiry.
 * @param {number} rate - Annual rate.
 * @returns {object|null} The check, or null when no strike has both mids.
 */
function parityCheck(e, spot, T, rate) {
  const puts = new Map(e.puts.map((p) => [p.strike, p]));
  const gaps = e.calls.filter((c) => puts.has(c.strike) && mid(c) != null && mid(puts.get(c.strike)) != null)
    .map((c) => ({ strike: c.strike, gap: M.options.putCallParity({ S: spot, K: c.strike, T, r: rate, call: mid(c), put: mid(puts.get(c.strike)) }).gap }));
  if (!gaps.length) return null;
  const largest = gaps.reduce((a, g) => (Math.abs(g.gap) > Math.abs(a.gap) ? g : a));
  return { strikes: gaps.length, medianGap: M.stats.quantile(gaps.map((g) => g.gap), 0.5), largestGap: largest };
}

/**
 * @description One expiration in summary: at-the-money implied volatility and expected move, the smile, parity and the
 * at-the-money contracts with their market Greeks.
 * @param {object} e - Expiration {date, daysToExpiration, calls, puts}.
 * @param {number} spot - Underlying price.
 * @param {number} rate - Annual rate.
 * @returns {object} The summary.
 */
function expirationView(e, spot, rate) {
  const T = Math.max(Number(e.daysToExpiration) || 0, 0.5) / 365;
  const otm = [...e.puts.filter((p) => p.strike <= spot), ...e.calls.filter((c) => c.strike >= spot)].filter((c) => c.impliedVolatility > 0);
  const smile = otm.length >= 3 ? attempt(() => M.options.volatilitySmile({ S: spot, T, r: rate, points: otm.map((c) => ({ strike: c.strike, iv: c.impliedVolatility })) })) : { unavailable: 'Fewer than 3 out-of-the-money strikes carry an implied volatility.' };
  const call = nearest(e.calls, spot), put = nearest(e.puts, spot), ivs = [call, put].filter((c) => c && c.impliedVolatility > 0).map((c) => c.impliedVolatility);
  const atm = ivs.length ? M.stats.mean(ivs) : null, greeks = (c) => (c ? { strike: c.strike, bid: c.bid, ask: c.ask, impliedVolatility: c.impliedVolatility, delta: c.delta, gamma: c.gamma, theta: c.theta, vega: c.vega, openInterest: c.openInterest } : null);
  return {
    date: e.date, daysToExpiration: e.daysToExpiration, contracts: e.calls.length + e.puts.length, atmImpliedVolatility: atm, expectedMove: atm ? spot * atm * Math.sqrt(T) : null,
    smile: smile.unavailable ? smile : { atm: smile.atm, skew: smile.skew, curvature: smile.curvature, r2: smile.r2, points: smile.points.length },
    parity: parityCheck(e, spot, T, rate), atTheMoney: { call: greeks(call), put: greeks(put) },
  };
}

/**
 * @description The option view of a chain: the nearest expirations summarized, and implied against historical volatility.
 * @param {object} chain - trading.chains answer.
 * @param {{rate:number, historicalVolatility:number|null}} o - Annual rate and the stock's own annual volatility.
 * @returns {object} The view with plain sentences.
 */
function optionsView(chain, { rate, historicalVolatility }) {
  const spot = chain.underlying && (chain.underlying.price || chain.underlying.mark || chain.underlying.last);
  if (!(spot > 0)) return { ok: false, message: 'The chain came without an underlying price, so nothing can be measured against it.' };
  const expirations = (chain.expirations || []).slice(0, MAX_EXPIRATIONS).map((e) => expirationView(e, spot, rate));
  const first = expirations.find((e) => e.atmImpliedVolatility) || null;
  const plain = first ? [`The nearest expiration (${first.date}) prices ${pct(first.atmImpliedVolatility)} a year at the money, an expected move of about ${first.expectedMove.toFixed(2)} either way by then.`] : ['No expiration in the window carries an at-the-money implied volatility.'];
  if (first && historicalVolatility) plain.push(`The stock has actually swung ${pct(historicalVolatility)} a year lately, so options are pricing ${first.atmImpliedVolatility > historicalVolatility ? 'more' : 'less'} movement than it has shown.`);
  if (first && first.smile && first.smile.skew < 0) plain.push('Implied volatility rises for lower strikes (a negative skew): insurance against a fall costs more than a bet on a rise.');
  return { ok: true, symbol: chain.symbol, underlyingPrice: spot, delayed: chain.delayed ?? null, readAt: chain.readAt || null, contracts: chain.contracts, expirations, historicalVolatility, plain };
}

module.exports = { MAX_EXPIRATIONS, mid, nearest, parityCheck, expirationView, optionsView };
