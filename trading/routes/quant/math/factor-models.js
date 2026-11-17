/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Factor models for the quant's math core: beta, the CAPM's expected return and Jensen's alpha, multi-factor regressions (Fama-French three-factor, arbitrage pricing theory) with Newey-West t-statistics, Fama-MacBeth risk premia, quantile sorts for anomalies such as low volatility, and the Fama-French 2x3 construction of the size (SMB) and value (HML) factors from a cross-section.
 */
'use strict';
const { fail, finite, positive, integer, numbers, paired } = require('./checks');
const { mean, variance, covariance, correlation, quantile, SESSIONS_PER_YEAR } = require('./stats');
const { ols, oneSampleT } = require('./regression');

/**
 * @description The CAPM's expected return: the risk-free rate plus beta times the market's expected excess return.
 * Only market risk (beta) is paid for; risk a portfolio can diversify away earns nothing extra.
 * @param {{riskFree:number, beta:number, marketReturn:number}} input - Rates in the same units.
 * @returns {{expectedReturn:number, marketPremium:number}} The figures.
 */
function capmExpectedReturn({ riskFree, beta, marketReturn }) {
  finite(riskFree, 'riskFree'); finite(beta, 'beta'); finite(marketReturn, 'marketReturn');
  return { expectedReturn: riskFree + beta * (marketReturn - riskFree), marketPremium: marketReturn - riskFree };
}

/**
 * @description Beta: how much a stock moves for each 1% the market moves, cov(stock, market) / var(market).
 * @param {number[]} asset - Asset returns.
 * @param {number[]} market - Market returns, same dates.
 * @returns {{beta:number, alpha:number, correlation:number, r2:number}} Beta, per-period intercept, correlation and the share of variance the market explains.
 */
function betaOf(asset, market) {
  paired(asset, market, 'asset and market returns', 3);
  const v = variance(market);
  if (!(v > 0)) throw fail('Market returns that never vary give no beta.');
  const beta = covariance(asset, market) / v, rho = correlation(asset, market);
  return { beta, alpha: mean(asset) - beta * mean(market), correlation: rho, r2: rho * rho };
}

/**
 * @description Excess returns over a per-period risk-free rate derived from an annual one.
 * @param {number[]} returns - Returns.
 * @param {number} riskFree - Annual rate.
 * @param {number} periodsPerYear - Periods per year.
 * @returns {number[]} Excess returns.
 */
function excess(returns, riskFree, periodsPerYear) {
  const rf = (1 + finite(riskFree, 'riskFree')) ** (1 / positive(periodsPerYear, 'periodsPerYear')) - 1;
  return returns.map((r) => r - rf);
}

/**
 * @description A factor regression of an asset's excess return on factor returns (each already excess or long-short):
 * the CAPM with one market factor, Fama-French with market, size (SMB) and value (HML), or any APT factor set. The intercept
 * (alpha) is the return the factors do not explain; Newey-West t-statistics allow autocorrelation and changing volatility.
 * @param {number[]} assetReturns - Asset returns per period.
 * @param {Object<string, number[]>} factors - Factor return series by name, same dates (the market factor already in excess of cash).
 * @param {{riskFree?:number, periodsPerYear?:number, hacLags?:number|'auto'}} [options] - Annual risk-free rate (0), periods per year (252), HAC lags.
 * @returns {{alpha:object, alphaAnnual:number, loadings:Array<object>, r2:number|null, n:number}} The fit.
 */
function factorRegression(assetReturns, factors, { riskFree = 0, periodsPerYear = SESSIONS_PER_YEAR, hacLags = 'auto' } = {}) {
  numbers(assetReturns, 'asset returns', 10);
  const names = Object.keys(factors || {});
  if (!names.length) throw fail('Give at least one factor series.');
  const fit = ols(excess(assetReturns, riskFree, periodsPerYear), names.map((n) => factors[n]), { names, hacLags });
  const [alpha, ...loadings] = fit.coefficients;
  return { alpha, alphaAnnual: (1 + alpha.estimate) ** periodsPerYear - 1, loadings, r2: fit.r2, n: fit.n, errors: fit.errors };
}

/**
 * @description The CAPM fitted to data: the asset's excess return on the market's excess return. Beta is the slope;
 * Jensen's alpha is the intercept, the return beyond what the asset's market risk earns.
 * @param {number[]} assetReturns - Asset returns.
 * @param {number[]} marketReturns - Market returns.
 * @param {{riskFree?:number, periodsPerYear?:number, hacLags?:number|'auto'}} [options] - As factorRegression.
 * @returns {{beta:object, alpha:object, alphaAnnual:number, r2:number|null, n:number}} The fit.
 */
function capmRegression(assetReturns, marketReturns, options = {}) {
  paired(assetReturns, marketReturns, 'asset and market returns', 10);
  const fit = factorRegression(assetReturns, { market: excess(marketReturns, options.riskFree || 0, options.periodsPerYear || SESSIONS_PER_YEAR) }, options);
  return { beta: fit.loadings[0], alpha: fit.alpha, alphaAnnual: fit.alphaAnnual, r2: fit.r2, n: fit.n };
}

/**
 * @description Fama-MacBeth (1973) risk premia, the classic test of arbitrage pricing theory: each period, regress the
 * cross-section of returns on the assets' factor exposures; a factor is priced when the average slope is reliably non-zero.
 * @param {Array<{returns:number[], exposures:number[][]}>} periods - Per period: asset returns and each asset's exposures (assets x factors).
 * @param {{names?:string[]}} [options] - Factor names.
 * @returns {{premia:Array<{name:string, mean:number, t:number, pValue:number}>, periods:number}} Average premia with t-statistics.
 */
function famaMacBeth(periods, { names = [] } = {}) {
  if (!Array.isArray(periods) || periods.length < 3) throw fail('Fama-MacBeth needs at least 3 periods.');
  const slopes = periods.map(({ returns, exposures }) => {
    numbers(returns, 'returns', 3);
    if (!Array.isArray(exposures) || exposures.length !== returns.length) throw fail('Give one exposure row per asset.');
    const k = exposures[0].length;
    return ols(returns, Array.from({ length: k }, (_, j) => exposures.map((row) => row[j]))).coefficients.map((c) => c.estimate);
  });
  const labels = ['const', ...slopes[0].slice(1).map((_, j) => names[j] || `factor${j + 1}`)];
  return { premia: labels.map((name, j) => ({ name, ...oneSampleT(slopes.map((s) => s[j])) })), periods: periods.length };
}

/**
 * @description Sort each period's assets into quantile buckets by a signal and average the next period's returns per bucket.
 * The top-minus-bottom spread and its t-statistic say whether the signal separated winners from losers (for example the
 * low-volatility anomaly: do the calmest stocks do as well as the wildest?).
 * @param {Array<Array<{value:number, ret:number}>>} crossSections - Per period: each asset's signal value and its next-period return.
 * @param {{buckets?:number}} [options] - Buckets (2-10, default 5).
 * @returns {{bucketMeans:number[], spread:object, periods:number}} Average return per bucket (low signal first) and the top-minus-bottom test.
 */
function quantileSort(crossSections, { buckets = 5 } = {}) {
  integer(buckets, 'buckets', 2, 10);
  if (!Array.isArray(crossSections) || crossSections.length < 3) throw fail('A sort needs at least 3 periods.');
  const perBucket = Array.from({ length: buckets }, () => []), spreads = [];
  for (const items of crossSections) {
    if (!Array.isArray(items) || items.length < buckets * 2) continue;
    const sorted = [...items].sort((a, b) => a.value - b.value), size = sorted.length / buckets;
    const means = Array.from({ length: buckets }, (_, b) => mean(sorted.slice(Math.round(b * size), Math.round((b + 1) * size)).map((x) => x.ret)));
    means.forEach((m, b) => perBucket[b].push(m));
    spreads.push(means[buckets - 1] - means[0]);
  }
  if (spreads.length < 3) throw fail('Too few periods had enough assets to sort.');
  return { bucketMeans: perBucket.map((b) => mean(b)), spread: oneSampleT(spreads), periods: spreads.length };
}

/**
 * @description The weighted average return of a group (value-weighted by size unless equal weights are asked for).
 * @param {Array<{size:number, ret:number}>} group - Assets.
 * @param {boolean} equal - Equal weights.
 * @returns {number} The return.
 */
function groupReturn(group, equal) {
  const w = group.map((x) => (equal ? 1 : x.size)), total = w.reduce((s, v) => s + v, 0);
  return group.reduce((s, x, i) => s + (w[i] / total) * x.ret, 0);
}

/**
 * @description The Fama-French (1993) 2x3 construction: split by size at the median and by book-to-market at the 30th and 70th
 * percentiles, then SMB = average of the three small portfolios minus the three big, HML = average of the two high
 * book-to-market portfolios minus the two low. Run on a home-made cross-section, it shows what the size and value factors are.
 * @param {Array<Array<{size:number, bookToMarket:number, ret:number}>>} crossSections - Per period: market value, book-to-market and that period's return for each stock.
 * @param {{equalWeight?:boolean}} [options] - Equal instead of value weights.
 * @returns {{smb:number[], hml:number[], smbMean:object, hmlMean:object}} Factor returns per period and their mean tests.
 */
function famaFrenchFactors(crossSections, { equalWeight = false } = {}) {
  if (!Array.isArray(crossSections) || crossSections.length < 3) throw fail('Give at least 3 periods.');
  const smb = [], hml = [];
  for (const items of crossSections) {
    if (!Array.isArray(items) || items.length < 12) throw fail('Each period needs at least 12 stocks for six portfolios.');
    items.forEach((x) => { positive(x.size, 'size'); finite(x.bookToMarket, 'bookToMarket'); finite(x.ret, 'ret'); });
    const sizeCut = quantile(items.map((x) => x.size), 0.5), bm = items.map((x) => x.bookToMarket), lo = quantile(bm, 0.3), hi = quantile(bm, 0.7);
    const cell = (small, band) => items.filter((x) => (x.size <= sizeCut) === small && (band === 'L' ? x.bookToMarket <= lo : band === 'H' ? x.bookToMarket > hi : x.bookToMarket > lo && x.bookToMarket <= hi));
    const r = {};
    for (const small of [true, false]) for (const band of ['L', 'M', 'H']) { const g = cell(small, band); if (!g.length) throw fail('A size/value portfolio came out empty; give more stocks.'); r[(small ? 'S' : 'B') + band] = groupReturn(g, equalWeight); }
    smb.push((r.SL + r.SM + r.SH) / 3 - (r.BL + r.BM + r.BH) / 3);
    hml.push((r.SH + r.BH) / 2 - (r.SL + r.BL) / 2);
  }
  return { smb, hml, smbMean: oneSampleT(smb), hmlMean: oneSampleT(hml) };
}

module.exports = { capmExpectedReturn, betaOf, factorRegression, capmRegression, famaMacBeth, quantileSort, famaFrenchFactors };
