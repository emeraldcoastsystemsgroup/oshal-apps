/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | With thousands of names the screen and the concierge read one page of the list at a time: filter by industry, theme or search, rank by any signal, sort by any column. Reasons are worked out only for the rows being read.
 */
'use strict';
const { explain } = require('./rank');

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;
const WEAKEST = 10;
/** The columns a person can sort by: a row's own numbers, then its factors. */
const ROW_SORTS = Object.freeze(new Set(['rank', 'score', 'price', 'chg1d']));
const FACTOR_SORTS = Object.freeze(new Set(['mom12', 'vsMa200', 'fromHigh', 'vol']));

/**
 * @description The list ranked by one signal.
 * @param {Array<object>} rows - Stored rows.
 * @param {string} by - Signal id.
 * @returns {Array<object>} Rows with that ranking's rank and score, best first.
 */
function rankedBy(rows, by) {
  return rows.filter((r) => r.pct[by] != null).sort((a, b) => b.pct[by] - a.pct[by] || a.symbol.localeCompare(b.symbol)).map((r, i) => ({ ...r, rank: i + 1, score: r.pct[by] }));
}

/**
 * @description The rows in a group that match a search.
 * @param {Array<object>} rows - Rows.
 * @param {{group?:string, q?:string}} filter - An industry or theme name, and text to find in a ticker or company name.
 * @returns {Array<object>} The rows that match.
 */
function filtered(rows, { group, q }) {
  const text = String(q || '').trim().toUpperCase();
  return rows.filter((r) => (!group || r.group === group || r.themes.includes(group)) && (!text || r.symbol.includes(text) || String(r.name || '').toUpperCase().includes(text)));
}

/**
 * @description Rows sorted by a column. Unknown columns keep rank order, and a stock missing a value sorts last either way.
 * @param {Array<object>} rows - Rows in rank order.
 * @param {string} sort - Column.
 * @param {number} dir - 1 ascending, -1 descending.
 * @returns {Array<object>} A sorted copy.
 */
function sorted(rows, sort, dir) {
  if (sort === 'symbol') return [...rows].sort((a, b) => a.symbol.localeCompare(b.symbol) * dir);
  const read = ROW_SORTS.has(sort) ? (r) => r[sort] : FACTOR_SORTS.has(sort) ? (r) => r.f[sort] : null;
  if (!read) return dir < 0 ? [...rows].reverse() : rows;
  return [...rows].sort((a, b) => { const x = read(a), y = read(b); if (x == null || y == null) return (x == null) - (y == null); return (x - y) * dir || a.rank - b.rank; });
}

/**
 * @description The person's holdings as ranked by the chosen signal.
 * @param {Array<object>} holdings - Stored holdings.
 * @param {Array<object>} ranked - Rows in rank order.
 * @returns {Array<object>} Holdings with this ranking's rank.
 */
function holdingsBy(holdings, ranked) {
  const bySymbol = new Map(ranked.map((r) => [r.symbol, r]));
  return holdings.map((h) => { const r = bySymbol.get(h.symbol); return r ? { ...h, rank: r.rank, score: r.score, of: ranked.length } : h; });
}

/**
 * @description One page of the list for the screen, with everything around it.
 * @param {object} today - The published summary.
 * @param {Array<object>} rows - Stored rows.
 * @param {object} query - {by, group, q, sort, dir, offset, limit}.
 * @returns {object} The page, the matching total, the weakest of the selection, and the summary.
 */
function screenPage(today, rows, query) {
  const by = query.by && rows.some((r) => r.pct[query.by] != null) ? String(query.by) : today.rankBy;
  const ranked = rankedBy(rows, by), matching = filtered(ranked, query);
  const offset = Math.max(0, Number.parseInt(query.offset, 10) || 0), limit = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(query.limit, 10) || DEFAULT_LIMIT));
  const page = sorted(matching, query.sort, Number(query.dir) < 0 ? -1 : 1).slice(offset, offset + limit);
  return { ...today, by, of: ranked.length, total: matching.length, offset, limit, rows: page.map(explain), weakest: matching.slice(-WEAKEST).map(explain), holdings: holdingsBy(today.holdings, ranked) };
}

/**
 * @description The list as the concierge reads it: the top and bottom of a selection, small enough for its reply limit.
 * @param {object} today - The published summary.
 * @param {Array<object>} rows - Stored rows.
 * @param {{group?:string, q?:string}} filter - The selection.
 * @param {{top:number, bottom:number}} size - How many rows.
 * @returns {object} Brief rows, with how many matched.
 */
function briefPage(today, rows, filter, { top, bottom }) {
  const brief = (row) => { const r = explain(row); return { rank: r.rank, symbol: r.symbol, name: r.name, group: r.group, themes: r.themes, score: r.score, price: r.price, chg1d: r.chg1d, held: r.held, reasons: r.reasons, cautions: r.cautions }; };
  const matching = filtered(rankedBy(rows, today.rankBy), filter);
  return { total: matching.length, top: matching.slice(0, top).map(brief), weakest: matching.slice(-bottom).map(brief) };
}

/**
 * @description Why a name is not on the list, in words.
 * @param {string} symbol - Ticker.
 * @param {object|null} today - The published summary.
 * @returns {string} The reason.
 */
function whyNotListed(symbol, today) {
  const reason = today && Object.entries(today.leftOut || {}).find(([, names]) => names.includes(symbol));
  const words = { 'thinly-traded': 'it trades under $5 million a day, too little to rank', 'too-new': 'it has under a year of prices', 'price-jump': 'a one-day move in the last year was too large to trust', 'no-price-for-session': 'it has no price for that session', 'no-data': 'Schwab had no price history for it' };
  if (reason) return `${symbol} was read but is not ranked: ${words[reason[0]] || reason[0]}.`;
  return `${symbol} is not on today's list: it may be a fund that serves as a reference point, or outside the pool.`;
}

module.exports = { DEFAULT_LIMIT, rankedBy, filtered, sorted, screenPage, briefPage, whyNotListed };
