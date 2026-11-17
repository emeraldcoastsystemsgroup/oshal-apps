/** CHANGE LOG
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 1.61.3: the not-ready answers say how the desk publishes its history test (its evening run, or Run now on the Quant desk, with a connected Schwab login) instead of naming trading_quant_run: bot-fast had taken a tool name in an answer as a cue to start the desk's own pass for a question.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Backtest overfitting over the Quant desk's own history test: each signal's monthly excess over the list, its probabilistic and deflated Sharpe ratios (the deflation counts every signal the desk tried), and the probability of backtest overfitting (PBO) across them by combinatorially symmetric cross-validation. Reads the stored history only; never rereads prices.
 */
'use strict';
const M = require('./math');
const { attempt, pct } = require('./lab-format');

/**
 * @description The months on which every signal held a list, and each signal's excess over the list on them.
 * @param {{months:string[], list:Array<number|null>, nets:Object<string, Array<number|null>>}} monthly - The history test's table.
 * @returns {{ids:string[], months:string[], excess:number[][]}} Signals and their aligned monthly excess returns.
 */
function excessTable(monthly) {
  const ids = Object.keys(monthly.nets || {});
  const keep = monthly.months.map((_, t) => monthly.list[t] != null && ids.every((id) => monthly.nets[id][t] != null));
  const months = monthly.months.filter((_, t) => keep[t]), list = monthly.list.filter((_, t) => keep[t]);
  return { ids, months, excess: ids.map((id) => monthly.nets[id].filter((_, t) => keep[t]).map((x, k) => x - list[k])) };
}

/**
 * @description The even block count for cross-validation: at most 16, and at least four months per block.
 * @param {number} months - Months available.
 * @returns {number} Blocks (0 when there are too few months).
 */
function blocksFor(months) {
  const most = Math.min(16, Math.floor(months / 4));
  return most >= 2 ? most - (most % 2) : 0;
}

/**
 * @description Each signal's Sharpe ratio record: monthly and annual, the chance it is above zero (PSR), and deflated for the
 * number of signals tried (DSR).
 * @param {string[]} ids - Signal ids.
 * @param {number[][]} excess - Monthly excess per signal.
 * @param {Object<string, string>} names - Signal names by id.
 * @returns {Array<object>} One row per signal.
 */
function sharpeRows(ids, excess, names) {
  const srs = excess.map((x) => M.stats.mean(x) / M.stats.stdev(x)), variance = M.stats.variance(srs);
  return ids.map((id, i) => {
    const m = attempt(() => M.stats.moments(excess[i]));
    const shape = m.unavailable ? { skew: 0, kurtosis: 3 } : { skew: m.skew, kurtosis: m.kurtosis };
    const psr = attempt(() => M.overfitting.probabilisticSharpe({ sharpe: srs[i], observations: excess[i].length, ...shape }).probability);
    const dsr = variance > 0 ? attempt(() => M.overfitting.deflatedSharpe({ sharpe: srs[i], observations: excess[i].length, ...shape, trials: ids.length, trialsVariance: variance })) : { unavailable: 'The signals\' Sharpe ratios do not vary.' };
    return { id, name: names[id] || id, monthlySharpe: srs[i], annualSharpe: srs[i] * Math.sqrt(12), probabilityAboveZero: psr, deflatedSharpe: dsr.unavailable ? dsr : dsr.deflatedSharpe, luckBenchmarkAnnual: dsr.unavailable ? null : dsr.expectedMaxSharpe * Math.sqrt(12) };
  });
}

/**
 * @description The overfitting report over a stored history test.
 * @param {object|null} history - The desk's stored history record.
 * @returns {object} {ready, signals, pbo, plain} or {ready:false, message}.
 */
function overfittingReport(history) {
  if (!history) return { ready: false, message: 'The Quant desk has not published a history test yet: it publishes one after its evening run, or Run now on the Quant desk, with a connected Schwab login. Its signals are what this measures.' };
  if (!history.monthly) return { ready: false, message: 'The desk\'s stored history test predates the monthly results this check reads; the desk\'s next run (tonight\'s, or Run now on the Quant desk) republishes them from the stored prices.' };
  const { ids, months, excess } = excessTable(history.monthly);
  if (ids.length < 2 || months.length < 8) return { ready: false, message: `The history test shares ${months.length} months across ${ids.length} signals; overfitting needs at least 8 months and 2 signals.` };
  const names = Object.fromEntries((history.signals || []).map((s) => [s.id, s.name])), blocks = blocksFor(months.length);
  const rows = sharpeRows(ids, excess, names);
  const pbo = blocks ? attempt(() => M.overfitting.backtestOverfitting(months.map((_, t) => excess.map((x) => x[t])), { blocks })) : { unavailable: 'Too few months for cross-validation.' };
  const best = [...rows].sort((a, b) => b.annualSharpe - a.annualSharpe)[0];
  return {
    ready: true, at: history.at, months: months.length, from: months[0], to: months[months.length - 1], trials: ids.length, measure: 'Each signal\'s monthly return minus the list\'s average (the desk\'s own verdict basis).',
    signals: rows, pbo,
    plain: [`The desk tried ${ids.length} signals over ${months.length} months. The best, ${best.name}, shows an annual Sharpe ratio of ${best.annualSharpe.toFixed(2)} over the list; after counting all ${ids.length} tries, the chance its edge is real is ${typeof best.deflatedSharpe === 'number' ? pct(best.deflatedSharpe, 0) : 'not measurable'} (deflated Sharpe ratio).`,
      pbo.unavailable ? pbo.unavailable : `Probability of backtest overfitting: ${pct(pbo.pbo, 0)} (picking the best-looking signal in one half of history put it in the bottom half of the other ${pct(pbo.pbo, 0)} of the time).`,
      'The list is today\'s companies, so survivorship flatters every signal; the forward scoreboard is the only record free of hindsight.'],
  };
}

module.exports = { excessTable, blocksFor, sharpeRows, overfittingReport };
