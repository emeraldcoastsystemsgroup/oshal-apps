/** CHANGE LOG
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Roger: legitimate companies that just took a 25% hit seem like a buy, and nothing surfaced them. The deep-dip signal ranks the furthest falls from the 52-week high so the history test can say whether buying them ever worked; the published literature on the 52-week high finds the opposite, and the verdict, not the hypothesis, leads the list.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | A wider pool brings thinly traded names whose wild swings would crowd the top of every list. A stock now has to trade at least $5 million a day to be ranked, today and in every month of the history test, judged only on what was known then. Dollar volume is used because a stock split changes price and share count together and leaves it alone. Monthly rows drop the columns no signal reads.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Ties break by symbol, so a result never depends on the order records were read in.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The Quant desk's price factors: fixed published definitions, never fitted, computed only from closes up to the day they are dated. A history row's forward return starts at the session after the signal, so no test can trade on a price it could not have seen.
 */
'use strict';

/** Sessions of history a factor needs: one year of momentum plus its dated close. */
const MIN_SESSIONS = 253;
/** Closes kept per symbol for today's factors and grading picks up to 63 sessions out. */
const RECENT_SESSIONS = 320;
/** A one-day move this large is treated as a data problem, not a return. */
const GLITCH = 0.75;
/** The least a stock must trade a day, in dollars, to be ranked or tested. Fixed in advance, not fitted. */
const MIN_DOLLAR_VOLUME = 5000000;
/** Sessions the typical day's trading is measured over. */
const VOLUME_SESSIONS = 63;

/** The columns of one monthly history row, in order. */
const MONTH_COLUMNS = Object.freeze(['month', 'mom12', 'rev1', 'vsMa200', 'fromHigh', 'vol', 'fwd']);

/**
 * @description The signals tested on history and tracked forward. Each is scored higher-is-better from one factor row.
 * The composite is an equal blend chosen in advance; nothing here is tuned to the results.
 */
const PRICE_SIGNALS = Object.freeze([
  { id: 'composite', name: 'Composite', what: 'Equal blend of momentum, trend, nearness to the 52-week high and low volatility', source: 'Fixed blend of the four below; not fitted', score: (f) => f.composite },
  { id: 'momentum', name: '12-month momentum', what: 'Return over the 12 months before the most recent month', source: 'Jegadeesh & Titman, 1993', score: (f) => f.mom12 },
  { id: 'trend', name: 'Moving-average trend', what: 'Distance above the 200-day moving average', source: 'Brock, Lakonishok & LeBaron, 1992', score: (f) => f.vsMa200 },
  { id: 'high52', name: 'Near the 52-week high', what: 'Closest to the highest close of the past year', source: 'George & Hwang, 2004', score: (f) => f.fromHigh },
  { id: 'lowvol', name: 'Low volatility', what: 'Smallest daily price swings over the past three months', source: 'Ang, Hodrick, Xing & Zhang, 2006', score: (f) => (f.vol == null ? null : -f.vol) },
  { id: 'reversal', name: '1-month reversal', what: 'Biggest losers of the past month', source: 'Jegadeesh, 1990', score: (f) => (f.rev1 == null ? null : -f.rev1) },
  { id: 'dip', name: 'Deep dip', what: 'Furthest below the highest close of the past year', source: 'George & Hwang, 2004, reversed: the dip-buying hypothesis', score: (f) => (f.fromHigh == null ? null : -f.fromHigh) },
]);

/** The factors the composite blends. */
const COMPOSITE_PARTS = Object.freeze(['momentum', 'trend', 'high52', 'lowvol']);

/**
 * @description Round to a fixed precision, keeping a missing value missing.
 * @param {number|null} n - Value.
 * @param {number} [d] - Decimals.
 * @returns {number|null} Rounded value.
 */
function round(n, d = 4) {
  if (n == null || !Number.isFinite(n)) return null;
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

/**
 * @description Average of a window of closes ending at an index.
 * @param {number[]} c - Closes.
 * @param {number} i - Last index.
 * @param {number} n - Window.
 * @returns {number} The average.
 */
function average(c, i, n) {
  let sum = 0;
  for (let k = i - n + 1; k <= i; k += 1) sum += c[k];
  return sum / n;
}

/**
 * @description Annualized volatility of daily returns over the 63 sessions ending at an index.
 * @param {number[]} c - Closes.
 * @param {number} i - Last index.
 * @returns {number} Annualized standard deviation (0.25 is 25%).
 */
function volatility(c, i) {
  const returns = [];
  for (let k = i - 62; k <= i; k += 1) returns.push(c[k] / c[k - 1] - 1);
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

/**
 * @description Every price factor dated at one session, from closes up to and including that session only.
 * @param {number[]} c - Closes, oldest first.
 * @param {number} i - The session's index.
 * @returns {object|null} The factors, or null without a full year of history.
 */
function factorsAt(c, i) {
  if (i < 252 || i >= c.length) return null;
  const p = c[i], ma50 = average(c, i, 50), ma200 = average(c, i, 200);
  let high = 0;
  for (let k = i - 251; k <= i; k += 1) high = Math.max(high, c[k]);
  return {
    mom12: c[i - 21] / c[i - 252] - 1,
    mom6: c[i - 21] / c[i - 126] - 1,
    mom3: p / c[i - 63] - 1,
    rev1: p / c[i - 21] - 1,
    vsMa50: p / ma50 - 1,
    vsMa200: p / ma200 - 1,
    trend: Number(p > ma50) + Number(p > ma200) + Number(ma50 > ma200),
    fromHigh: p / high - 1,
    vol: volatility(c, i),
  };
}

/**
 * @description Whether any one-day move between two indexes looks like a data problem.
 * @param {number[]} c - Closes.
 * @param {number} from - First index.
 * @param {number} to - Last index.
 * @returns {boolean} True when a jump is present.
 */
function hasGlitch(c, from, to) {
  for (let k = Math.max(1, from); k <= to; k += 1) if (Math.abs(c[k] / c[k - 1] - 1) > GLITCH) return true;
  return false;
}

/**
 * @description The typical day's trading in dollars: the median over the sessions ending at an index, using nothing later.
 * @param {number[]} c - Closes.
 * @param {number[]} v - Share volumes.
 * @param {number} i - Last index.
 * @returns {number} Dollars a day.
 */
function dollarVolumeAt(c, v, i) {
  const days = [];
  for (let k = Math.max(0, i - VOLUME_SESSIONS + 1); k <= i; k += 1) days.push(c[k] * v[k]);
  days.sort((a, b) => a - b);
  return days[Math.floor(days.length / 2)];
}

/**
 * @description Monthly history rows. The signal is the last session of a month; the position is entered at the next
 * session's close and held to the close of the first session of the following month. A month the stock traded too
 * little to be ranked has no row, so the test only ever holds what the list could have held then.
 * @param {string[]} dates - Session dates.
 * @param {number[]} c - Closes.
 * @param {number[]} v - Share volumes.
 * @returns {Array<Array<string|number|null>>} Rows in MONTH_COLUMNS order, with a null forward return where it is not known yet.
 */
function monthlyRows(dates, c, v) {
  const ends = [];
  for (let i = 0; i < dates.length - 1; i += 1) if (dates[i].slice(0, 7) !== dates[i + 1].slice(0, 7)) ends.push(i);
  const rows = [];
  for (let m = 0; m < ends.length; m += 1) {
    const i = ends[m], f = factorsAt(c, i);
    if (!f || dollarVolumeAt(c, v, i) < MIN_DOLLAR_VOLUME) continue;
    const entry = i + 1, exit = m + 1 < ends.length ? ends[m + 1] + 1 : null;
    const fwd = exit == null || hasGlitch(c, entry, exit) ? null : c[exit] / c[entry] - 1;
    rows.push([dates[i].slice(0, 7), round(f.mom12), round(f.rev1), round(f.vsMa200), round(f.fromHigh), round(f.vol), round(fwd, 5)]);
  }
  return rows;
}

/**
 * @description One symbol's stored digest from Schwab daily candles: recent closes and its monthly history rows.
 * @param {string} symbol - Ticker.
 * @param {Array<{t:number,c:number,v:number}>} bars - Daily candles (t in epoch seconds).
 * @param {string} latest - The last completed session; anything newer is an unfinished bar and is dropped.
 * @returns {object|null} The digest, or null when no usable candle remains.
 */
function digestBars(symbol, bars, latest) {
  const byDate = new Map();
  for (const bar of bars) {
    const close = Number(bar.c), date = new Date(Number(bar.t) * 1000).toISOString().slice(0, 10);
    if (close > 0 && date <= latest) byDate.set(date, [close, Number(bar.v) || 0]);
  }
  const dates = [...byDate.keys()].sort();
  if (!dates.length) return null;
  const closes = dates.map((d) => byDate.get(d)[0]), volumes = dates.map((d) => byDate.get(d)[1]);
  const tail = Math.max(0, dates.length - RECENT_SESSIONS);
  return {
    symbol, asOf: dates.at(-1), first: dates[0], sessions: dates.length, dollarVolume: Math.round(dollarVolumeAt(closes, volumes, closes.length - 1)),
    recent: { d: dates.slice(tail), c: closes.slice(tail) },
    monthly: monthlyRows(dates, closes, volumes),
  };
}

/**
 * @description Today's factors from a stored digest, or the reason it cannot be scored.
 * @param {object} digest - Stored digest.
 * @param {string} session - The session being scored.
 * @returns {{factors:object|null, excluded:string|null}} Factors or a reason.
 */
function currentFactors(digest, session) {
  const { d, c } = digest.recent;
  if (d.at(-1) !== session) return { factors: null, excluded: 'no-price-for-session' };
  if (c.length < MIN_SESSIONS) return { factors: null, excluded: 'too-new' };
  if (hasGlitch(c, c.length - 252, c.length - 1)) return { factors: null, excluded: 'price-jump' };
  if (!(digest.dollarVolume >= MIN_DOLLAR_VOLUME)) return { factors: null, excluded: 'thinly-traded' };
  return { factors: factorsAt(c, c.length - 1), excluded: null };
}

/**
 * @description Percentile position (0 worst, 100 best) of each value among those present.
 * @param {Array<{key:string, value:number|null}>} items - Scored items.
 * @returns {Map<string, number>} Percentile by key; a missing value gets none.
 */
function percentiles(items) {
  const present = items.filter((x) => x.value != null && Number.isFinite(x.value)).sort((a, b) => a.value - b.value || a.key.localeCompare(b.key));
  const out = new Map();
  const span = Math.max(1, present.length - 1);
  present.forEach((x, i) => out.set(x.key, (i / span) * 100));
  return out;
}

/**
 * @description Add the composite to a cross-section of factor rows: the equal average of its parts' percentiles.
 * A name missing any part gets no composite.
 * @param {Array<{symbol:string, factors:object}>} rows - One date's rows; each gains factors.composite and pct.
 * @returns {Array<object>} The same rows.
 */
function addComposite(rows) {
  const parts = PRICE_SIGNALS.filter((s) => COMPOSITE_PARTS.includes(s.id));
  const ranks = parts.map((s) => [s.id, percentiles(rows.map((r) => ({ key: r.symbol, value: s.score(r.factors) })))]);
  for (const row of rows) {
    row.pct = {};
    for (const [id, map] of ranks) if (map.has(row.symbol)) row.pct[id] = map.get(row.symbol);
    const values = COMPOSITE_PARTS.map((id) => row.pct[id]);
    row.factors.composite = values.every((v) => v != null) ? values.reduce((s, v) => s + v, 0) / values.length : null;
  }
  return rows;
}

module.exports = { MIN_SESSIONS, RECENT_SESSIONS, MIN_DOLLAR_VOLUME, MONTH_COLUMNS, PRICE_SIGNALS, COMPOSITE_PARTS, round, average, volatility, factorsAt, hasGlitch, dollarVolumeAt, monthlyRows, digestBars, currentFactors, percentiles, addComposite };
