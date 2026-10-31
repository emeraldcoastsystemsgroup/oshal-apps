/** CHANGE LOG
 * 3 | maintainer@emeraldcoastsystemsgroup.com | On the first real run SPY read 3% off its high while the momentum leaders were 40-50% off theirs: the market condition now measures the leaders and the average stock, says so in its label, and a stock far below its high carries a caution even when it ranks well.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Lead the list with the signal the history test rates best, and carry every signal's percentile so a person can rank by another. The fixed composite failed its own test on real prices, so it no longer leads.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The Quant desk's daily list: rank every scorable stock on the fixed composite and say why in plain sentences, with cautions from SEC filings and the earnings calendar, where the person's own holdings rank, and how the market itself looks. A ranking, never a buy or sell instruction.
 */
'use strict';
const { currentFactors, addComposite, factorsAt, percentiles, PRICE_SIGNALS, round } = require('./factors');
const { sectorOf } = require('../paper/universe');

/** Funds are reference points or cash, not companies to rank. */
const FUNDS = Object.freeze(new Set(['SPY', 'VOO', 'IVV', 'VTI', 'QQQ', 'IWM', 'DIA', 'EFA', 'EEM', 'VEA', 'VWO', 'DBC', 'GLD', 'SLV', 'IEF', 'TLT', 'AGG', 'BND', 'SHY', 'BIL', 'SGOV', 'VNQ', 'XLE', 'XLF', 'XLK', 'XLV', 'XLI', 'XLP', 'XLU', 'XLY', 'XLB', 'XOP', 'XBI', 'IBB', 'FBT', 'ARKG', 'GNOM']));

const pct = (n, d = 0) => `${(Math.abs(n) * 100).toFixed(d)}%`;

/**
 * @description Today's factors in stored form.
 * @param {object} f - Factors.
 * @returns {object} Rounded factors.
 */
function storedFactors(f) {
  return Object.fromEntries(Object.entries(f).map(([k, v]) => [k, k === 'trend' ? v : round(v, k === 'composite' ? 1 : 4)]));
}

/**
 * @description Why a stock sits where it does, in sentences a person can check.
 * @param {object} row - A scored row (f factors, pct percentiles, fund, congress).
 * @returns {string[]} The reasons, strongest evidence first.
 */
function reasonsFor(row) {
  const { f, pct: p } = row, out = [];
  out.push(`${f.mom12 >= 0 ? 'Up' : 'Down'} ${pct(f.mom12)} over the 12 months before last month, better than ${Math.round(p.momentum ?? 0)}% of the list.`);
  out.push(f.vsMa200 >= 0 ? `${pct(f.vsMa200)} above its 200-day average.` : `${pct(f.vsMa200)} below its 200-day average.`);
  out.push(f.fromHigh >= -0.005 ? 'At its 52-week high.' : `${pct(f.fromHigh)} below its 52-week high.`);
  out.push(`Price swings smaller than ${Math.round(p.lowvol ?? 0)}% of the list.`);
  if (row.fund && row.fund.revenueYoYPct != null && row.fund.netMarginPct != null) out.push(`Latest annual filing: revenue ${row.fund.revenueYoYPct >= 0 ? 'up' : 'down'} ${Math.abs(row.fund.revenueYoYPct).toFixed(0)}%, net margin ${row.fund.netMarginPct.toFixed(0)}%.`);
  if (row.congress) out.push(`Bought by ${row.congress.buyers} member${row.congress.buyers === 1 ? '' : 's'} of Congress, latest disclosed ${row.congress.latest}.`);
  return out;
}

/**
 * @description What to watch before relying on the rank.
 * @param {object} row - A scored row.
 * @returns {string[]} The cautions.
 */
function cautionsFor(row) {
  const out = [];
  if (row.earnings) out.push(`Earnings ${row.earnings}.`);
  if (row.fund && row.fund.netMarginPct != null && row.fund.netMarginPct < 0) out.push('Lost money in its latest annual filing.');
  if (row.chg1d != null && row.chg1d <= -0.05) out.push(`Fell ${pct(row.chg1d, 1)} in the last session.`);
  if (row.f.vsMa200 < 0) out.push('In a downtrend: below its 200-day average.');
  if (row.f.fromHigh <= -0.3) out.push(`Already ${pct(row.f.fromHigh)} below its 52-week high: the 12-month figure is older than this fall.`);
  return out;
}

/**
 * @description How the market itself looks, from SPY and the breadth of the list.
 * @param {object|undefined} spy - SPY's digest.
 * @param {Array<object>} rows - Scored rows.
 * @returns {object|null} The market condition.
 */
function marketCondition(spy, rows) {
  if (!spy) return null;
  const { c } = spy.recent, f = factorsAt(c, c.length - 1);
  if (!f) return null;
  const share = (test) => (rows.length ? round((rows.filter(test).length / rows.length) * 100, 0) : null);
  const leaders = [...rows].sort((a, b) => b.f.mom12 - a.f.mom12).slice(0, 25).map((r) => r.f.fromHigh).sort((a, b) => a - b);
  const leadersFromHigh = leaders.length ? leaders[Math.floor(leaders.length / 2)] : null;
  const base = f.vsMa200 < 0 ? 'Downtrend' : f.fromHigh <= -0.05 ? 'Pullback in an uptrend' : 'Uptrend';
  const label = leadersFromHigh != null && leadersFromHigh <= -0.2 ? `${base}, but its leaders are falling hard` : base;
  const moves = rows.map((r) => r.chg1d).filter((v) => v != null);
  return {
    label, leadersFromHigh: round(leadersFromHigh), listOneDay: moves.length ? round(moves.reduce((s, v) => s + v, 0) / moves.length) : null, fell5PctShare: share((r) => r.chg1d != null && r.chg1d <= -0.05),
    spy: c.at(-1), oneDay: round(c.at(-1) / c.at(-2) - 1), oneMonth: round(f.rev1), threeMonths: round(f.mom3), vsMa50: round(f.vsMa50), vsMa200: round(f.vsMa200), fromHigh: round(f.fromHigh),
    above200Pct: share((r) => r.f.vsMa200 > 0), above50Pct: share((r) => r.f.vsMa50 > 0),
  };
}

/**
 * @description Score one symbol's digest, or record why it could not be scored.
 * @param {Array<object>} digests - Stored digests.
 * @param {string} session - The session being scored.
 * @returns {{rows:Array<object>, excluded:Object<string,string[]>}} Unranked rows and exclusions by reason.
 */
function scorable(digests, session) {
  const rows = [], excluded = {};
  for (const digest of digests) {
    if (FUNDS.has(digest.symbol)) continue;
    const { factors, excluded: reason } = currentFactors(digest, session);
    if (factors) rows.push({ symbol: digest.symbol, factors, digest });
    else (excluded[reason] = excluded[reason] || []).push(digest.symbol);
  }
  return { rows, excluded };
}

/**
 * @description One finished row of the list.
 * @param {object} row - Unfinished row.
 * @param {number} rank - 1-based rank.
 * @param {object} extras - The ranking signal and maps of fundamentals, Congress buying, earnings and holdings by symbol.
 * @returns {object} The row.
 */
function finishRow(row, rank, extras) {
  const { c } = row.digest.recent;
  const out = {
    rank, symbol: row.symbol, sector: sectorOf(row.symbol) || null, price: c.at(-1), chg1d: round(c.at(-1) / c.at(-2) - 1),
    score: Math.round(row.pct[extras.rankBy] ?? 0), f: storedFactors(row.factors), pct: Object.fromEntries(Object.entries(row.pct).map(([k, v]) => [k, Math.round(v)])),
    fund: extras.funds.get(row.symbol) || null, congress: extras.congress.get(row.symbol) || null, earnings: extras.earnings.get(row.symbol) || null, held: extras.holdings.has(row.symbol),
  };
  out.reasons = reasonsFor(out);
  out.cautions = cautionsFor(out);
  return out;
}

/**
 * @description Where each holding of the person's sits on today's list.
 * @param {Map<string, object>} holdings - Holdings by symbol.
 * @param {Array<object>} rows - Ranked rows.
 * @param {Object<string,string[]>} excluded - Exclusions by reason.
 * @returns {Array<object>} One entry per holding, largest first.
 */
function holdingRanks(holdings, rows, excluded) {
  const bySymbol = new Map(rows.map((r) => [r.symbol, r])), why = new Map(Object.entries(excluded).flatMap(([reason, names]) => names.map((n) => [n, reason])));
  return [...holdings.values()].map((h) => {
    const row = bySymbol.get(h.symbol);
    const status = row ? 'ranked' : FUNDS.has(h.symbol) ? 'fund' : (why.get(h.symbol) || 'no-data');
    return { symbol: h.symbol, marketValue: h.marketValue, accounts: h.accounts, status, rank: row ? row.rank : null, of: rows.length, score: row ? row.score : null, reasons: row ? row.reasons : [], cautions: row ? row.cautions : [] };
  }).sort((a, b) => (b.marketValue || 0) - (a.marketValue || 0));
}

/**
 * @description Build today's list.
 * @param {object} input - {session, at, digests, rankBy, funds:Map, congress:Map, earnings:Map, holdings:Map, noData:string[]}.
 * @returns {object} The ranked rows, holdings, market condition and what was left out.
 */
function buildToday(input) {
  const { session, at, digests } = input;
  const { rows, excluded } = scorable(digests, session);
  addComposite(rows);
  const rankBy = input.rankBy || 'composite';
  for (const signal of PRICE_SIGNALS) {
    const map = percentiles(rows.map((r) => ({ key: r.symbol, value: signal.score(r.factors) })));
    for (const row of rows) if (map.has(row.symbol)) row.pct[signal.id] = map.get(row.symbol);
  }
  const ranked = rows.filter((r) => r.pct[rankBy] != null).sort((a, b) => b.pct[rankBy] - a.pct[rankBy] || a.symbol.localeCompare(b.symbol));
  const finished = ranked.map((r, i) => finishRow(r, i + 1, { ...input, rankBy }));
  const spy = digests.find((d) => d.symbol === 'SPY');
  return {
    session, at, rankBy, scored: finished.length, rows: finished,
    holdings: holdingRanks(input.holdings, finished, excluded),
    market: marketCondition(spy, finished),
    leftOut: { ...Object.fromEntries(Object.entries(excluded).map(([k, v]) => [k, v.sort()])), 'no-data': [...(input.noData || [])].sort() },
    coverage: { secFilings: finished.filter((r) => r.fund).length, congress: finished.filter((r) => r.congress).length },
  };
}

module.exports = { FUNDS, reasonsFor, cautionsFor, marketCondition, holdingRanks, buildToday };
