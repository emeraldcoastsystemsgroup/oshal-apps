/** CHANGE LOG
 * 3 | maintainer@emeraldcoastsystemsgroup.com | The value curve follows the signal that leads the list, next to the same signal without the biggest winners, so the upper limit is never drawn alone.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The first run on real prices showed 12-month momentum at 63% a year, falling to 23% once the biggest eventual winners were removed: a list of today's survivors inflates exactly that kind of signal. Every signal is now also tested without the top fifth of lifetime winners, and only one that passes both holds up. The 2022 stress row is now the months actually held in 2022, and ties break by symbol.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The Quant desk's history test: each fixed signal's top names each month, held from the next session, after costs. The verdict compares with the same list's equal-weight average, because a list of today's survivors flatters any comparison with SPY.
 */
'use strict';
const { MONTH_COLUMNS, PRICE_SIGNALS, addComposite, round } = require('./factors');

const TOP_N = 10;
const COST_BPS_PER_SIDE = 10;
const MIN_LIST = 30;
const MIN_MONTHS = 36;
/** The share of the list removed for the harsher test: the biggest winners of the whole period, chosen with hindsight on purpose. */
const WINNERS_REMOVED = 0.2;
const BENCHMARK = 'SPY';
const MONTH_INDEX = Object.freeze(Object.fromEntries(MONTH_COLUMNS.map((name, i) => [name, i])));

/**
 * @description One month's rows across the list, keyed by month.
 * @param {Array<object>} digests - Stored symbol digests.
 * @returns {Map<string, Array<{symbol:string,factors:object,fwd:number}>>} Rows by YYYY-MM.
 */
function crossSections(digests) {
  const months = new Map();
  for (const digest of digests) {
    if (digest.symbol === BENCHMARK) continue;
    for (const row of digest.monthly || []) {
      const fwd = row[MONTH_INDEX.fwd];
      if (fwd == null) continue;
      const factors = Object.fromEntries(MONTH_COLUMNS.map((name, i) => [name, row[i]]));
      const key = String(row[MONTH_INDEX.date]).slice(0, 7);
      if (!months.has(key)) months.set(key, []);
      months.get(key).push({ symbol: digest.symbol, factors, fwd });
    }
  }
  return months;
}

/**
 * @description The benchmark's monthly rows by month.
 * @param {Array<object>} digests - Stored symbol digests.
 * @returns {Map<string, {fwd:number, vsMa200:number}>} SPY's forward return and trend by YYYY-MM.
 */
function benchmarkMonths(digests) {
  const spy = digests.find((d) => d.symbol === BENCHMARK);
  const out = new Map();
  for (const row of (spy && spy.monthly) || []) {
    if (row[MONTH_INDEX.fwd] != null) out.set(String(row[MONTH_INDEX.date]).slice(0, 7), { fwd: row[MONTH_INDEX.fwd], vsMa200: row[MONTH_INDEX.vsMa200] });
  }
  return out;
}

/**
 * @description Compound a list of monthly returns.
 * @param {number[]} returns - Monthly returns.
 * @returns {number} Total return.
 */
function compound(returns) {
  return returns.reduce((value, r) => value * (1 + r), 1) - 1;
}

/**
 * @description Annualize monthly returns.
 * @param {number[]} returns - Monthly returns.
 * @returns {number|null} Annual rate.
 */
function annualized(returns) {
  return returns.length ? (1 + compound(returns)) ** (12 / returns.length) - 1 : null;
}

/**
 * @description The deepest peak-to-trough fall of a monthly return series.
 * @param {number[]} returns - Monthly returns.
 * @returns {number} Maximum drawdown as a negative fraction.
 */
function maxDrawdown(returns) {
  let value = 1, peak = 1, worst = 0;
  for (const r of returns) {
    value *= 1 + r;
    peak = Math.max(peak, value);
    worst = Math.min(worst, value / peak - 1);
  }
  return worst;
}

/**
 * @description Mean and t-statistic of a series.
 * @param {number[]} values - Series.
 * @returns {{mean:number|null,t:number|null}} The mean and its t-statistic.
 */
function meanT(values) {
  if (values.length < 2) return { mean: values[0] ?? null, t: null };
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  return { mean, t: variance > 0 ? mean / Math.sqrt(variance / values.length) : null };
}

/**
 * @description The rule every signal is judged by.
 * @param {{months:number, mean:number|null, t:number|null, firstHalf:number|null, secondHalf:number|null}} s - Excess-return statistics.
 * @param {{mean:number|null, t:number|null}|null} [harsher] - The same statistics without the biggest winners, when tested.
 * @returns {string} "Holds up" (passes both tests), "Promising" (passes only with the winners), "Mixed", "Fails" or "Too little history".
 */
function verdictFor(s, harsher = null) {
  if (s.months < MIN_MONTHS || s.mean == null) return 'Too little history';
  if (s.mean <= 0) return 'Fails';
  if (s.t == null || s.t < 2 || s.firstHalf <= 0 || s.secondHalf <= 0) return 'Mixed';
  return harsher && !(harsher.mean > 0 && harsher.t >= 2) ? 'Promising' : 'Holds up';
}

/**
 * @description How a series behaved when the market was falling.
 * @param {Array<{month:string,net:number,spy:number}>} series - Monthly results.
 * @returns {object} Calendar 2022 and months SPY fell 4% or more, each next to SPY.
 */
function stress(series) {
  // A month's row is held during the following month, so 2022 is the signals from December 2021 to November 2022.
  const y2022 = series.filter((m) => m.month >= '2021-12' && m.month <= '2022-11');
  const falling = series.filter((m) => m.spy <= -0.04);
  const avg = (rows, key) => (rows.length ? rows.reduce((s, m) => s + m[key], 0) / rows.length : null);
  return {
    year2022: y2022.length ? { months: y2022.length, net: round(compound(y2022.map((m) => m.net))), spy: round(compound(y2022.map((m) => m.spy))) } : null,
    fallingMonths: { months: falling.length, net: round(avg(falling, 'net')), spy: round(avg(falling, 'spy')) },
  };
}

/**
 * @description Summarize one signal's monthly series against SPY and the list average.
 * @param {object} signal - Signal definition.
 * @param {Array<{month:string,net:number,spy:number,list:number}>} series - Monthly results.
 * @returns {object} The scoreboard row.
 */
function summarize(signal, series, harsherSeries = null) {
  const excess = series.map((m) => m.net - m.list), half = Math.floor(excess.length / 2);
  const { mean, t } = meanT(excess), firstHalf = meanT(excess.slice(0, half)).mean, secondHalf = meanT(excess.slice(half)).mean;
  const harsher = harsherSeries ? meanT(harsherSeries.map((m) => m.net - m.list)) : null;
  const verdict = verdictFor({ months: series.length, mean, t, firstHalf, secondHalf }, harsher);
  return {
    withoutWinners: harsher ? { annual: round(annualized(harsherSeries.map((m) => m.net))), listAnnual: round(annualized(harsherSeries.map((m) => m.list))), t: round(harsher.t, 2) } : null,
    id: signal.id, name: signal.name, what: signal.what, source: signal.source, verdict,
    months: series.length, from: series[0]?.month ?? null, to: series.at(-1)?.month ?? null,
    annual: round(annualized(series.map((m) => m.net))), spyAnnual: round(annualized(series.map((m) => m.spy))), listAnnual: round(annualized(series.map((m) => m.list))),
    excessVsListMonthly: round(mean, 5), t: round(t, 2), firstHalf: round(firstHalf, 5), secondHalf: round(secondHalf, 5),
    beatSpyPct: series.length ? round((series.filter((m) => m.net > m.spy).length / series.length) * 100, 1) : null,
    maxDrawdown: round(maxDrawdown(series.map((m) => m.net))), spyMaxDrawdown: round(maxDrawdown(series.map((m) => m.spy))),
    stress: stress(series),
  };
}

/**
 * @description Monthly results of each price signal's top names across the history.
 * @param {Map<string, Array<object>>} months - Cross-sections by month.
 * @param {Map<string, object>} spy - Benchmark by month.
 * @returns {Map<string, Array<object>>} Series by signal id.
 */
function signalSeries(months, spy) {
  const series = new Map(PRICE_SIGNALS.map((s) => [s.id, []]));
  const held = new Map();
  for (const month of [...months.keys()].sort()) {
    const rows = months.get(month), market = spy.get(month);
    if (!market || rows.length < MIN_LIST) continue;
    addComposite(rows);
    const list = rows.reduce((s, r) => s + r.fwd, 0) / rows.length;
    for (const signal of PRICE_SIGNALS) {
      const top = rows.map((r) => ({ r, score: signal.score(r.factors) })).filter((x) => x.score != null).sort((a, b) => b.score - a.score || a.r.symbol.localeCompare(b.r.symbol)).slice(0, TOP_N).map((x) => x.r);
      if (top.length < TOP_N) continue;
      const names = new Set(top.map((r) => r.symbol)), before = held.get(signal.id);
      const changed = before ? [...names].filter((s) => !before.has(s)).length / TOP_N : 1;
      held.set(signal.id, names);
      const gross = top.reduce((s, r) => s + r.fwd, 0) / TOP_N, net = gross - changed * 2 * (COST_BPS_PER_SIDE / 10000);
      series.get(signal.id).push({ month, net, spy: market.fwd, list });
    }
  }
  return series;
}

/**
 * @description The moving-average market rule: hold SPY at a month-end above its 200-day average, otherwise cash.
 * Cash earns nothing here, which is conservative. Judged against simply holding SPY.
 * @param {Map<string, object>} spy - Benchmark by month.
 * @returns {object} The scoreboard row.
 */
function marketTiming(spy) {
  const series = [];
  let invested = null, monthsIn = 0;
  for (const month of [...spy.keys()].sort()) {
    const { fwd, vsMa200 } = spy.get(month), now = vsMa200 > 0;
    const cost = invested === null || invested === now ? 0 : COST_BPS_PER_SIDE / 10000;
    invested = now;
    monthsIn += Number(now);
    series.push({ month, net: (now ? fwd : 0) - cost, spy: fwd, list: fwd });
  }
  return { ...summarize({ id: 'market-trend', name: 'Market trend rule', what: 'Hold SPY only while it closes a month above its 200-day average; otherwise cash', source: 'Faber, 2007' }, series), inMarketPct: series.length ? round((monthsIn / series.length) * 100, 1) : null };
}

/**
 * @description The list without its biggest winners of the whole period: hindsight used against the signal on purpose,
 * to offset the hindsight in a list of today's survivors.
 * @param {Array<object>} digests - Stored digests.
 * @returns {Array<object>} The digests that remain, with SPY.
 */
function withoutBiggestWinners(digests) {
  const growth = digests.filter((d) => d.symbol !== BENCHMARK).map((d) => ({ symbol: d.symbol, rate: annualized((d.monthly || []).map((r) => r[MONTH_INDEX.fwd]).filter((r) => r != null)) ?? -Infinity }));
  growth.sort((a, b) => b.rate - a.rate || a.symbol.localeCompare(b.symbol));
  const removed = new Set(growth.slice(0, Math.ceil(growth.length * WINNERS_REMOVED)).map((g) => g.symbol));
  return digests.filter((d) => !removed.has(d.symbol));
}

/**
 * @description The signal with the best evidence, for leading the list: by verdict, then t-statistic.
 * @param {Array<object>} signals - History rows.
 * @returns {object} The leading row.
 */
function leadingSignal(signals) {
  const order = ['Holds up', 'Promising', 'Mixed', 'Too little history', 'Fails'];
  return [...signals].sort((a, b) => order.indexOf(a.verdict) - order.indexOf(b.verdict) || (b.t ?? -99) - (a.t ?? -99))[0];
}

/**
 * @description Run the history test over every stored digest.
 * @param {Array<object>} digests - Stored symbol digests.
 * @param {string} at - ISO time of the run.
 * @returns {object} Rows per signal, the composite's value curve and the limits of the test.
 */
function historyTest(digests, at) {
  const months = crossSections(digests), spy = benchmarkMonths(digests), series = signalSeries(months, spy);
  const harsher = signalSeries(crossSections(withoutBiggestWinners(digests)), spy);
  const rows = PRICE_SIGNALS.map((s) => summarize(s, series.get(s.id), harsher.get(s.id)));
  const leader = leadingSignal(rows), harshBy = new Map(harsher.get(leader.id).map((m) => [m.month, m.net]));
  let value = 1, spyValue = 1, harshValue = 1;
  const curve = series.get(leader.id).map((m) => {
    value *= 1 + m.net; spyValue *= 1 + m.spy; harshValue *= 1 + (harshBy.get(m.month) ?? 0);
    return [m.month, round(value, 3), round(spyValue, 3), round(harshValue, 3)];
  });
  return {
    at, topN: TOP_N, costBpsPerSide: COST_BPS_PER_SIDE, symbols: digests.length,
    signals: rows, marketTiming: marketTiming(spy), curve, curveSignal: { id: leader.id, name: leader.name },
    limits: [
      `The list is today's companies, so failed and delisted ones are missing. Its average made ${rows[0].listAnnual == null ? 'more' : `${(rows[0].listAnnual * 100).toFixed(1)}% a year against SPY's ${(rows[0].spyAnnual * 100).toFixed(1)}%`}; a gap like that is a warning that hindsight is in these numbers, so read the Per year column as an upper limit.`,
      `"Holds up" must beat the list both as it stands and with the biggest ${Math.round(WINNERS_REMOVED * 100)}% of winners removed. "Promising" only beats it with them in. The real result is likely between the two.`,
      'Prices only: dividends are left out of the stocks and of SPY.',
      `With ${rows.length + 1} rules tested, one looking good by luck is plausible. Passing needs a t-statistic of at least 2 and a positive result in both halves of the history. Only the forward scoreboard is free of hindsight.`,
    ],
  };
}

module.exports = { TOP_N, COST_BPS_PER_SIDE, MIN_MONTHS, WINNERS_REMOVED, compound, annualized, maxDrawdown, meanT, verdictFor, crossSections, signalSeries, marketTiming, withoutBiggestWinners, leadingSignal, historyTest };
