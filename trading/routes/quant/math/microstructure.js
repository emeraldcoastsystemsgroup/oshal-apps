/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Market microstructure for the quant's math core: the quoted spread, mid and size-weighted microprice from a Level 1 quote; spread estimators from daily bars (Roll 1984, Corwin-Schultz 2012) and Amihud's illiquidity (2002); how market makers set prices (Glosten-Milgrom 1985 against informed traders, Kyle's lambda 1985, Avellaneda-Stoikov 2008 with inventory risk); and the cost of trading size (the square-root impact law and the Almgren-Chriss 2000 execution schedule).
 */
'use strict';
const { fail, finite, positive, nonNegative, probability, integer, numbers, paired } = require('./checks');
const { mean, covariance } = require('./stats');
const { ols } = require('./regression');

/**
 * @description What a Level 1 quote says: the mid price, the quoted spread in dollars and basis points of the mid, and the
 * microprice, which leans toward the side with less size waiting (where the next trade is likelier to push the price).
 * @param {{bid:number, ask:number, bidSize?:number, askSize?:number}} quote - Best bid and ask, with sizes when known.
 * @returns {{mid:number, spread:number, spreadBps:number, microprice:number|null, imbalance:number|null}} The figures.
 */
function quotedSpread({ bid, ask, bidSize = null, askSize = null }) {
  positive(bid, 'bid'); positive(ask, 'ask');
  if (ask < bid) throw fail('The ask is below the bid (a crossed quote).');
  const mid = (bid + ask) / 2, sized = bidSize != null && askSize != null && bidSize + askSize > 0;
  if (sized) { nonNegative(bidSize, 'bidSize'); nonNegative(askSize, 'askSize'); }
  return { mid, spread: ask - bid, spreadBps: (ask - bid) / mid * 10000, microprice: sized ? (bid * askSize + ask * bidSize) / (bidSize + askSize) : null, imbalance: sized ? (bidSize - askSize) / (bidSize + askSize) : null };
}

/**
 * @description Roll's (1984) spread estimate from closing prices alone: trades bounce between bid and ask, which makes
 * consecutive price changes negatively correlated; spread = 2 sqrt(-cov(dp[t], dp[t-1])). When that covariance is positive
 * (often, over daily data) the estimate does not exist and the answer says so.
 * @param {number[]} prices - Closing prices (at least 20).
 * @returns {{spread:number|null, relativeSpread:number|null, autocovariance:number}} Dollars and fraction of the average price.
 */
function rollSpread(prices) {
  numbers(prices, 'prices', 20);
  const dp = prices.slice(1).map((p, i) => p - prices[i]), cov = covariance(dp.slice(1), dp.slice(0, -1));
  if (!(cov < 0)) return { spread: null, relativeSpread: null, autocovariance: cov };
  const spread = 2 * Math.sqrt(-cov);
  return { spread, relativeSpread: spread / mean(prices), autocovariance: cov };
}

/**
 * @description One Corwin-Schultz two-day spread estimate from two days' highs and lows.
 * @param {number} h1 - Day 1 high.
 * @param {number} l1 - Day 1 low.
 * @param {number} h2 - Day 2 high.
 * @param {number} l2 - Day 2 low.
 * @returns {number} The two-day spread estimate as a fraction; it can be negative when volatility swamps the spread.
 */
function corwinSchultzPair(h1, l1, h2, l2) {
  const k = 3 - 2 * Math.SQRT2, beta = Math.log(h1 / l1) ** 2 + Math.log(h2 / l2) ** 2;
  const gamma = Math.log(Math.max(h1, h2) / Math.min(l1, l2)) ** 2;
  const alpha = (Math.sqrt(2 * beta) - Math.sqrt(beta)) / k - Math.sqrt(gamma / k);
  return (2 * (Math.exp(alpha) - 1)) / (1 + Math.exp(alpha));
}

/**
 * @description Corwin and Schultz's (2012) spread estimate from daily highs and lows: a day's high-low range holds both
 * volatility and the spread; volatility grows over two days and the spread does not, which separates them. With closes,
 * the second day's range is shifted for an overnight gap, as in the paper. The two-day estimates are averaged first and
 * the average floored at zero; flooring each two-day estimate first (the paper's daily convention, also reported) biases
 * the average upward when the spread is small next to volatility.
 * @param {{highs:number[], lows:number[], closes?:number[]}} bars - Daily highs, lows and (optionally) closes.
 * @returns {{spread:number, spreadZeroedDaily:number, days:number, negative:number}} Relative spreads, the two-day estimates used, and how many were negative.
 */
function corwinSchultz({ highs, lows, closes = null }) {
  paired(highs, lows, 'highs and lows', 3);
  if (closes) paired(highs, closes, 'highs and closes', 3);
  if ([...highs, ...lows].some((x) => !(x > 0)) || highs.some((h, i) => h < lows[i])) throw fail('Highs and lows must be above zero, with each high at or above its low.');
  const out = [];
  for (let t = 1; t < highs.length; t += 1) {
    let h2 = highs[t], l2 = lows[t];
    if (closes) {
      const prev = closes[t - 1];
      if (prev > h2) { l2 += prev - h2; h2 = prev; } else if (prev < l2) { h2 -= l2 - prev; l2 = prev; }
    }
    out.push(corwinSchultzPair(highs[t - 1], lows[t - 1], h2, l2));
  }
  return { spread: Math.max(0, mean(out)), spreadZeroedDaily: mean(out.map((x) => Math.max(0, x))), days: out.length, negative: out.filter((x) => x < 0).length };
}

/**
 * @description Amihud's (2002) illiquidity: the average absolute daily return per dollar traded, here per million dollars.
 * Higher means each dollar of trading moves the price more.
 * @param {number[]} returns - Daily returns.
 * @param {number[]} dollarVolumes - Dollars traded each day (positive).
 * @returns {{illiquidity:number, days:number}} Average |return| per $1 million traded.
 */
function amihud(returns, dollarVolumes) {
  paired(returns, dollarVolumes, 'returns and dollar volumes', 1);
  const days = returns.map((r, i) => [r, dollarVolumes[i]]).filter(([, v]) => v > 0);
  if (!days.length) throw fail('No day had any trading.');
  return { illiquidity: mean(days.map(([r, v]) => (Math.abs(r) / v) * 1e6)), days: days.length };
}

/**
 * @description Kyle's (1985) lambda, the price impact of order flow when an insider trades against noise traders through a
 * market maker: lambda = sd(value) / (2 sd(noise flow)). Price moves lambda per unit of net buying.
 * @param {{valueSd:number, noiseSd:number}} input - Spread of the asset's true value and of uninformed order flow.
 * @returns {{lambda:number, informedShare:number}} Lambda and the insider's optimal trading intensity (noiseSd / valueSd).
 */
function kyleLambda({ valueSd, noiseSd }) {
  positive(valueSd, 'valueSd'); positive(noiseSd, 'noiseSd');
  return { lambda: valueSd / (2 * noiseSd), informedShare: noiseSd / valueSd };
}

/**
 * @description Estimate Kyle's lambda from data: regress price changes on signed order flow (buys positive, sells negative).
 * @param {number[]} priceChanges - Price change per interval.
 * @param {number[]} signedFlow - Net buying per interval.
 * @returns {{lambda:number, t:number|null, r2:number|null}} The slope with its t-statistic.
 */
function estimateKyleLambda(priceChanges, signedFlow) {
  paired(priceChanges, signedFlow, 'price changes and signed flow', 10);
  const fit = ols(priceChanges, [signedFlow]);
  return { lambda: fit.coefficients[1].estimate, t: fit.coefficients[1].t, r2: fit.r2 };
}

/**
 * @description Glosten-Milgrom (1985): a market maker who cannot tell informed traders from others sets the ask at the value
 * expected given a buy and the bid at the value expected given a sell. The spread is what the informed cost the market maker.
 * @param {{high:number, low:number, probabilityHigh?:number, informed:number}} input - The two possible values, the prior that it is high (0.5), the share of informed traders.
 * @returns {{bid:number, ask:number, spread:number, afterBuy:number, afterSell:number}} Quotes and the updated probability of the high value after each trade.
 */
function glostenMilgrom({ high, low, probabilityHigh = 0.5, informed }) {
  finite(high, 'high'); finite(low, 'low');
  if (!(high > low)) throw fail('high must be above low.');
  probability(probabilityHigh, 'probabilityHigh');
  if (!(finite(informed, 'informed') >= 0 && informed <= 1)) throw fail('informed must be from 0 to 1.');
  const buyIfHigh = informed + (1 - informed) / 2, buyIfLow = (1 - informed) / 2, p = probabilityHigh;
  const afterBuy = (p * buyIfHigh) / (p * buyIfHigh + (1 - p) * buyIfLow), afterSell = (p * (1 - buyIfHigh)) / (p * (1 - buyIfHigh) + (1 - p) * (1 - buyIfLow));
  const ask = afterBuy * high + (1 - afterBuy) * low, bid = afterSell * high + (1 - afterSell) * low;
  return { bid, ask, spread: ask - bid, afterBuy, afterSell };
}

/**
 * @description Avellaneda-Stoikov (2008): a market maker holding inventory q shades both quotes away from it. The reservation
 * price r = s - q gamma sigma^2 (T - t) is where it is indifferent; the total spread gamma sigma^2 (T - t) + (2/gamma) ln(1 + gamma/k)
 * widens with risk aversion, volatility and time left, and narrows when orders arrive more readily (larger k).
 * @param {{mid:number, inventory:number, riskAversion:number, sigma:number, timeLeft:number, k:number}} input - Mid price, shares held (+ long), gamma, price volatility per unit time, time left, order-arrival decay.
 * @returns {{reservationPrice:number, spread:number, bid:number, ask:number}} The quotes.
 */
function avellanedaStoikov({ mid, inventory, riskAversion, sigma, timeLeft, k }) {
  positive(mid, 'mid'); finite(inventory, 'inventory'); positive(riskAversion, 'riskAversion'); positive(sigma, 'sigma'); nonNegative(timeLeft, 'timeLeft'); positive(k, 'k');
  const risk = riskAversion * sigma * sigma * timeLeft, reservationPrice = mid - inventory * risk;
  const spread = risk + (2 / riskAversion) * Math.log1p(riskAversion / k);
  return { reservationPrice, spread, bid: reservationPrice - spread / 2, ask: reservationPrice + spread / 2 };
}

/**
 * @description The square-root law of market impact: buying or selling Q shares moves the price about
 * Y sigma sqrt(Q / V), with sigma the daily volatility and V the daily volume (Y near 1 in published studies).
 * @param {{sigmaDaily:number, shares:number, dailyVolume:number, coefficient?:number}} input - Daily volatility (fraction), order size, typical daily volume, Y.
 * @returns {{impact:number, impactBps:number, participation:number}} Expected price move as a fraction and in basis points.
 */
function squareRootImpact({ sigmaDaily, shares, dailyVolume, coefficient = 1 }) {
  positive(sigmaDaily, 'sigmaDaily'); positive(shares, 'shares'); positive(dailyVolume, 'dailyVolume'); positive(coefficient, 'coefficient');
  const impact = coefficient * sigmaDaily * Math.sqrt(shares / dailyVolume);
  return { impact, impactBps: impact * 10000, participation: shares / dailyVolume };
}

/**
 * @description Almgren-Chriss (2000): split a large order over N intervals to balance impact cost (trade slowly) against price
 * risk (trade fast). With no risk aversion the plan is an even split; more risk aversion trades sooner.
 * @param {{shares:number, intervals:number, tau?:number, sigma:number, eta:number, gamma?:number, epsilon?:number, riskAversion?:number}} input - Order size X, N intervals of length tau, price volatility ($ per share per sqrt(time)), temporary impact eta, permanent impact gamma, fixed cost epsilon, risk aversion lambda.
 * @returns {{holdings:number[], trades:number[], expectedCost:number, variance:number, kappa:number}} Shares still held at each time, shares traded per interval, and the plan's cost and its variance.
 */
function almgrenChriss({ shares, intervals, tau = 1, sigma, eta, gamma = 0, epsilon = 0, riskAversion = 0 }) {
  positive(shares, 'shares'); integer(intervals, 'intervals', 1, 10000); positive(tau, 'tau'); positive(sigma, 'sigma'); positive(eta, 'eta');
  nonNegative(gamma, 'gamma'); nonNegative(epsilon, 'epsilon'); nonNegative(riskAversion, 'riskAversion');
  const etaTilde = eta - (gamma * tau) / 2;
  if (!(etaTilde > 0)) throw fail('Temporary impact must exceed half the permanent impact per interval.');
  const kappaTilde2 = (riskAversion * sigma * sigma) / etaTilde, kappa = Math.acosh(1 + (kappaTilde2 * tau * tau) / 2) / tau, T = intervals * tau;
  const holdings = Array.from({ length: intervals + 1 }, (_, j) => (kappa > 1e-12 ? (shares * Math.sinh(kappa * (T - j * tau))) / Math.sinh(kappa * T) : shares * (1 - j / intervals)));
  const trades = holdings.slice(1).map((x, j) => holdings[j] - x);
  const expectedCost = 0.5 * gamma * shares * shares + epsilon * trades.reduce((s, n) => s + Math.abs(n), 0) + (etaTilde / tau) * trades.reduce((s, n) => s + n * n, 0);
  const variance = sigma * sigma * tau * holdings.slice(1).reduce((s, x) => s + x * x, 0);
  return { holdings, trades, expectedCost, variance, kappa };
}

module.exports = { quotedSpread, rollSpread, corwinSchultz, amihud, kyleLambda, estimateKyleLambda, glostenMilgrom, avellanedaStoikov, squareRootImpact, almgrenChriss };
