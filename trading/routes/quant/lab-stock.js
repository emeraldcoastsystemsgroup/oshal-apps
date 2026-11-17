/** CHANGE LOG
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The factors view also runs the official daily Fama-French three factors (Kenneth R. French Data Library) on the days they share with the stock's prices, attributed and dated, next to the ETF proxies.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The quant lab's one-stock views over real daily prices: risk (returns, volatility and the square-root-of-time rule, Sharpe, volatility drag, drawdown, value at risk four ways, fat tails, a VaR backtest), behavior (random-walk, mean-reversion and momentum tests), volatility (EWMA, high-low estimators, GARCH and GJR-GARCH, a forecast and volatility targeting), liquidity (the Level 1 spread, Roll, Corwin-Schultz, Amihud, square-root impact) and factors (beta, CAPM, ETF-proxy Fama-French and APT regressions). A figure the history cannot support says so.
 */
'use strict';
const M = require('./math');
const { attempt, needs, pct } = require('./lab-format');

const VIEWS = Object.freeze(['risk', 'behavior', 'volatility', 'liquidity', 'factors']);
/** Sessions read for each view unless the question asks for another length. */
const DEFAULT_SESSIONS = Object.freeze({ risk: 504, behavior: 756, volatility: 1260, liquidity: 63, factors: 504 });
/** The ETF proxies for the Fama-French factors: market, small companies, value and growth halves of the large caps. */
const PROXIES = Object.freeze({ market: 'SPY', small: 'IWM', value: 'IWD', growth: 'IWF' });
const YEAR = 252;

/**
 * @description Value at risk four ways for one return series.
 * @param {number[]} r - Daily returns.
 * @param {{confidence:number, horizonDays:number}} o - Confidence and horizon.
 * @returns {object} Normal, Cornish-Fisher, Student t and historical VaR.
 */
function varFigures(r, { confidence, horizonDays }) {
  const mu = M.stats.mean(r), sd = M.stats.stdev(r), m = attempt(() => M.stats.moments(r));
  const nu = r.length >= 50 ? attempt(() => M.risk.fitStudentT(r).nu) : null;
  return {
    confidence, horizonDays,
    normal: attempt(() => M.risk.normalVaR({ mean: mu, sd, confidence, horizon: horizonDays })),
    cornishFisher: m.unavailable ? m : attempt(() => M.risk.cornishFisherVaR({ mean: mu, sd, skew: m.skew, excessKurtosis: m.excessKurtosis, confidence, horizon: horizonDays })),
    studentT: typeof nu === 'number' && nu > 2 ? attempt(() => ({ nu, ...M.risk.studentTVaR({ mean: mu, sd, nu, confidence, horizon: horizonDays }) })) : needs(r.length, 50, 'A Student t fit'),
    historicalOneDay: needs(r.length, 20, 'Historical VaR') || M.risk.historicalVaR(r, { confidence }),
  };
}

/**
 * @description The risk view: what the stock returned, how much it swung, and how bad a bad day or stretch has been.
 * @param {object} s - Columns (dates, closes).
 * @param {{confidence?:number, horizonDays?:number, riskFree?:number}} o - Options.
 * @returns {object} The figures and plain sentences.
 */
function riskView(s, { confidence = 0.95, horizonDays = 1, riskFree = 0 } = {}) {
  const r = M.stats.simpleReturns(s.closes), n = r.length, sd = M.stats.stdev(r);
  const scale = (days) => M.stats.scaleVolatility(sd, 1, days), vr = varFigures(r, { confidence, horizonDays });
  const out = {
    returns: { total: M.stats.compound(r), annualized: M.stats.annualizedReturn(r), averageDaily: M.stats.mean(r), logTotal: Math.log(s.closes.at(-1) / s.closes[0]) },
    volatility: { daily: sd, squareRootOfTime: { week: scale(5), month: scale(21), year: scale(YEAR) } },
    sharpe: attempt(() => M.stats.sharpeRatio(r, { riskFree })), volatilityDrag: attempt(() => M.stats.volatilityDrag(r)),
    drawdown: M.risk.drawdowns(s.closes), valueAtRisk: vr,
    bellCurveTest: attempt(() => M.stats.jarqueBera(r)), fatTails: needs(n, 50, 'A fat-tail report') || attempt(() => M.risk.tailReport(r)),
    varBacktest: needs(n, 270, 'A VaR backtest (250 days to fit, then the days after)') || attempt(() => M.risk.varBacktest(r, { window: 250, confidence: 0.99 })),
  };
  const normal = vr.normal.valueAtRisk, cf = vr.cornishFisher.valueAtRisk;
  out.plain = [
    `Over ${n} trading days it returned ${pct(out.returns.total)} (${pct(out.returns.annualized)} a year compounded), swinging ${pct(sd)} a day, about ${pct(scale(YEAR))} a year by the square-root-of-time rule.`,
    `Worst fall from a high: ${pct(out.drawdown.maxDrawdown)}.`,
    `At ${Math.round(confidence * 100)}% confidence over ${horizonDays} day${horizonDays > 1 ? 's' : ''}, a bell curve puts the loss limit at ${pct(normal)}; allowing for skew and fat tails (Cornish-Fisher) it is ${pct(cf)}.`,
  ];
  if (out.fatTails && out.fatTails.timesNormal) out.plain.push(`Moves beyond 3 standard deviations happened ${out.fatTails.timesNormal.toFixed(1)} times as often as a bell curve predicts.`);
  return out;
}

/**
 * @description Momentum and trend figures from closes (12-1 and 6-1 month returns, 1-month reversal, distance from the 200-day average).
 * @param {number[]} c - Closes.
 * @returns {object} The figures, each null when the history is too short.
 */
function momentumFigures(c) {
  const at = (back) => (c.length > back ? c[c.length - 1 - back] : null), last = c[c.length - 1];
  const ma200 = c.length >= 200 ? M.stats.mean(c.slice(-200)) : null;
  return {
    twelveMinusOne: at(252) && at(21) ? at(21) / at(252) - 1 : null, sixMinusOne: at(126) && at(21) ? at(21) / at(126) - 1 : null,
    lastMonth: at(21) ? last / at(21) - 1 : null, versus200DayAverage: ma200 ? last / ma200 - 1 : null,
  };
}

/**
 * @description The behavior view: does the stock wander like a random walk, get pulled back to a level, or trend?
 * @param {object} s - Columns.
 * @returns {object} The tests, momentum figures and a verdict in words.
 */
function behaviorView(s) {
  const logP = s.closes.map(Math.log), r = M.stats.simpleReturns(s.closes), n = r.length;
  const ratios = [2, 5, 10].filter((q) => q <= Math.floor(n / 4)).map((q) => attempt(() => M.timeseries.varianceRatio(logP, q)));
  const out = {
    varianceRatios: ratios.length ? ratios : needs(n, 8, 'A variance ratio'),
    ljungBox: needs(n, 30, 'The Ljung-Box test') || attempt(() => M.regression.ljungBox(r, Math.min(10, Math.floor(n / 5)))),
    lag1Autocorrelation: attempt(() => M.regression.autocorrelation(r, 1)),
    adf: needs(n, 20, 'The Dickey-Fuller test') || attempt(() => M.timeseries.adf(logP)),
    halfLife: needs(n, 20, 'A half-life') || attempt(() => M.timeseries.halfLife(logP)),
    hurst: needs(n, 50, 'The Hurst exponent') || attempt(() => M.timeseries.hurst(logP)),
    momentum: momentumFigures(s.closes), zScore60: attempt(() => M.timeseries.zScore(s.closes, Math.min(60, s.closes.length))),
  };
  const sig = ratios.filter((v) => v && v.pValue < 0.05), reverting = out.adf && out.adf.rejectsRandomWalkAt;
  out.verdict = reverting ? 'mean-reverting: the price is pulled back toward a level (Dickey-Fuller rejects a random walk)'
    : sig.some((v) => v.ratio > 1) ? 'trending: moves have tended to continue (variance ratio above 1)'
      : sig.some((v) => v.ratio < 1) ? 'choppy: moves have tended to reverse (variance ratio below 1)' : 'consistent with a random walk: no test finds memory in its moves';
  out.plain = [`Over ${n} trading days the price looks ${out.verdict}.`, 'Random-walk tests find patterns after the fact; a pattern that passed here can still fail on new prices.'];
  return out;
}

/**
 * @description The volatility view: how much it swings now, what GARCH expects next, and the exposure that would target a volatility.
 * @param {object} s - Columns (closes, and highs/lows/opens when Schwab supplied them).
 * @param {{horizonDays?:number, targetVolatility?:number}} o - Forecast horizon (21) and target (0.15).
 * @returns {object} Estimators, models, forecast and targeting.
 */
function volatilityView(s, { horizonDays = 21, targetVolatility = 0.15 } = {}) {
  const r = M.stats.simpleReturns(s.closes), n = r.length, ranges = Array.isArray(s.highs) && s.source === 'schwab';
  const out = {
    closeToClose: { annual: M.stats.annualizedVolatility(r) }, ewma: needs(n, 20, 'EWMA volatility') || attempt(() => M.volatility.ewmaVolatility(r)),
    parkinson: ranges ? attempt(() => M.volatility.parkinsonVolatility(s.highs, s.lows)) : { unavailable: 'Needs daily highs and lows, which come from a Schwab connection.' },
    garmanKlass: ranges ? attempt(() => M.volatility.garmanKlassVolatility(s)) : { unavailable: 'Needs daily open, high, low and close from a Schwab connection.' },
  };
  const short = needs(n, 250, 'A GARCH fit');
  out.garch = short || attempt(() => M.volatility.fitGarch(r));
  out.gjr = short || attempt(() => M.volatility.fitGarch(r, { model: 'gjr' }));
  out.asymmetry = out.garch.unavailable || out.gjr.unavailable ? null : M.volatility.asymmetryTest(out.garch, out.gjr);
  out.forecast = out.garch.unavailable ? null : M.volatility.forecastGarch(out.garch, horizonDays);
  const expected = out.forecast ? out.forecast.averageVolatility : out.ewma.annual || out.closeToClose.annual;
  out.targeting = { targetVolatility, forecastVolatility: expected, ...M.volatility.volatilityTarget({ targetVolatility, forecastVolatility: expected }) };
  if (out.garch.dailyVariances) delete out.garch.dailyVariances;
  if (out.forecast) out.forecast = { averageVolatility: out.forecast.averageVolatility, nextDayVolatility: out.forecast.nextDayVolatility, longRunVolatility: out.forecast.longRunVolatility, horizonDays };
  out.plain = [`It has swung ${pct(out.closeToClose.annual)} a year over ${n} days.`,
    out.forecast ? `GARCH expects about ${pct(out.forecast.averageVolatility)} a year over the next ${horizonDays} days (long-run level ${pct(out.forecast.longRunVolatility)}).` : `${short ? short.unavailable : 'GARCH could not be fitted.'}`,
    `To run at ${pct(targetVolatility, 0)} volatility you would hold ${pct(out.targeting.exposure, 0)} of capital in it.`];
  return out;
}

/**
 * @description The liquidity view: what trading it costs. The quoted spread from the best bid and ask (Level 1), spread
 * estimates from daily bars, Amihud's price impact per dollar, and the square-root law for an order of a given size.
 * No order-book depth is read: Level 1 and daily bars are what is available.
 * @param {object} s - Columns.
 * @param {{quote?:object|null, shares?:number|null}} o - A Level 1 quote when one was read, and an order size to cost.
 * @returns {object} The figures.
 */
function liquidityView(s, { quote = null, shares = null } = {}) {
  const r = M.stats.simpleReturns(s.closes), dv = s.closes.slice(1).map((c, i) => c * (s.volumes ? s.volumes[i + 1] : 0));
  const adv = s.volumes ? M.stats.quantile(s.volumes.slice(1), 0.5) : 0, sd = M.stats.stdev(r);
  const out = {
    quoted: quote && quote.bidPrice > 0 && quote.askPrice > 0 ? { ...attempt(() => M.microstructure.quotedSpread({ bid: quote.bidPrice, ask: quote.askPrice, bidSize: quote.bidSize, askSize: quote.askSize })), delayed: quote.delayed ?? null, at: quote.quoteAt || null } : { unavailable: 'No live bid and ask was read (they come from a Schwab connection).' },
    roll: needs(s.closes.length, 20, 'Roll\'s estimate') || attempt(() => M.microstructure.rollSpread(s.closes)),
    corwinSchultz: s.source === 'schwab' && s.highs ? attempt(() => M.microstructure.corwinSchultz(s)) : { unavailable: 'Needs daily highs and lows from a Schwab connection.' },
    amihud: adv > 0 ? attempt(() => M.microstructure.amihud(r, dv)) : { unavailable: 'No trading volume was recorded.' },
    medianDailyVolume: adv, dailyVolatility: sd, orderBookDepth: 'Not read: the order book beyond the best bid and ask is not available, so these are Level 1 and daily-bar estimates.',
  };
  out.impact = shares && adv > 0 ? attempt(() => M.microstructure.squareRootImpact({ sigmaDaily: sd, shares, dailyVolume: adv })) : { unavailable: shares ? 'No trading volume was recorded.' : 'Give shares to cost an order.' };
  out.plain = [out.quoted.spreadBps != null ? `The best bid and ask are ${out.quoted.spreadBps.toFixed(1)} basis points apart.` : out.quoted.unavailable,
    out.corwinSchultz.spread != null ? `From daily highs and lows the effective spread estimate is ${pct(out.corwinSchultz.spread)}.` : out.corwinSchultz.unavailable,
    out.impact.impactBps != null ? `Trading ${shares} shares (${pct(out.impact.participation)} of a typical day's volume) would move the price about ${out.impact.impactBps.toFixed(1)} basis points by the square-root law.` : out.impact.unavailable,
    'Only the best bid and ask are read; the order book behind them is not, so these are estimates.'];
  return out;
}

/**
 * @description The factors view: beta and the CAPM against SPY, then a three-factor regression on ETF proxies (market SPY,
 * size IWM minus SPY, value IWD minus IWF), and any extra ETFs as APT factors. Proxies stand in for the official
 * Fama-French factors, and the answer says so.
 * @param {string} symbol - The stock.
 * @param {{dates:string[], closes:number[][]}} aligned - Shared dates and closes, the stock first, then the names in `names`.
 * @param {string[]} names - The other names in order.
 * @param {{riskFree?:number, apt?:string[]}} o - Annual rate and APT ETF names.
 * @returns {object} The regressions.
 */
function factorsView(symbol, aligned, names, { riskFree = 0, apt = [] } = {}) {
  const ret = (closes) => M.stats.simpleReturns(closes), col = (name) => aligned.closes[names.indexOf(name) + 1];
  const asset = ret(aligned.closes[0]), has = (name) => names.includes(name);
  // SPY's own factors view measures SPY against itself (beta 1), not against a missing copy.
  const spy = has(PROXIES.market) ? ret(col(PROXIES.market)) : symbol === PROXIES.market ? asset : null;
  if (!spy) return { unavailable: 'SPY prices are needed for beta and the factor models.' };
  const rf = (1 + riskFree) ** (1 / YEAR) - 1, minus = (a, b) => a.map((x, i) => x - b[i]);
  const factors = { market: spy.map((x) => x - rf) };
  if (has(PROXIES.small)) factors.size = minus(ret(col(PROXIES.small)), spy);
  if (has(PROXIES.value) && has(PROXIES.growth)) factors.value = minus(ret(col(PROXIES.value)), ret(col(PROXIES.growth)));
  const out = { beta: M.factorModels.betaOf(asset, spy), capm: attempt(() => M.factorModels.capmRegression(asset, spy, { riskFree })),
    threeFactorProxy: Object.keys(factors).length > 1 ? attempt(() => M.factorModels.factorRegression(asset, factors, { riskFree })) : { unavailable: 'Size and value need IWM, IWD and IWF prices.' },
    proxies: Object.fromEntries(Object.entries(factors).map(([k]) => [k, k === 'market' ? 'SPY minus cash' : k === 'size' ? 'IWM minus SPY' : 'IWD minus IWF'])),
    note: 'ETF proxies, not the official Fama-French factors.' };
  const extra = apt.filter(has);
  if (extra.length) out.apt = attempt(() => M.factorModels.factorRegression(asset, Object.fromEntries(extra.map((n) => [n, ret(col(n))])), { riskFree }));
  out.plain = [`${symbol} moves about ${out.beta.beta.toFixed(2)} times as much as SPY (beta); the market explains ${pct(out.beta.r2, 0)} of its daily moves.`];
  return out;
}

/**
 * @description The official Fama-French three-factor regression: the stock's daily return over the library's T-bill rate
 * on Mkt-RF, SMB and HML, on the days both cover. The library publishes with a lag, so the window ends at its last date.
 * @param {object} s - The stock's columns (dates, closes).
 * @param {{rows:Array<Array>, asOf:string, attribution:string, source:string}} ff - The cached factor file.
 * @returns {object} Loadings with Newey-West t-statistics, or why there are none.
 */
function officialFactorsView(s, ff) {
  const daily = new Map();
  for (let i = 1; i < s.dates.length; i += 1) daily.set(s.dates[i], s.closes[i] / s.closes[i - 1] - 1);
  const rows = ff.rows.filter((r) => daily.has(r[0])), cite = { asOf: ff.asOf, attribution: ff.attribution, source: ff.source };
  if (rows.length < 60) return { unavailable: `The official factors run to ${ff.asOf} and share ${rows.length} days with these prices; 60 are needed.`, ...cite };
  const fit = attempt(() => M.factorModels.factorRegression(rows.map((r) => daily.get(r[0]) - r[4]), { market: rows.map((r) => r[1]), size: rows.map((r) => r[2]), value: rows.map((r) => r[3]) }));
  return { ...fit, days: rows.length, from: rows[0][0], to: rows[rows.length - 1][0], ...cite };
}

module.exports = { VIEWS, DEFAULT_SESSIONS, PROXIES, riskView, behaviorView, volatilityView, liquidityView, factorsView, officialFactorsView, momentumFigures };
