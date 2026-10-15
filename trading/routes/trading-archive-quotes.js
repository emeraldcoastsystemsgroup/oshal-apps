/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: the last stored price of a ticker from the kernel's World price archive (the prices.latest intent the native paper engine already reads), for Research and the watchlist when the book has no market-data rail. Each quote carries the archive's own timestamp and says it is a stored price, not a live quote; a ticker the archive does not track is missing, never priced. sectionReason turns a failed research read into the sentence the page prints.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | The archive's stored series for the screens that showed nothing without a market-data rail: archiveChart (a price line per chart timeframe from prices.series - raw points for 5Min/15Min, hour buckets for 1Hour, day buckets for 1Day, the last day of each week for 1Week; a line of stored prices, never invented candles), archiveDailyBars (each ticker's day closes and session volume for the movers board) and archiveDayChanges (the latest stored price against the previous session's last stored price, for the watchlist's Today column). A ticker the archive does not track has no line, no bar and no change.
 *
 * @module trading-archive-quotes
 */
'use strict';

const { weekKey } = require('./paper/market');

/** The most tickers one prices.latest call may name (the kernel's bound). */
const LATEST_MAX = 200;
/** The most tickers one prices.series call may name (the kernel's bound). */
const SERIES_MAX = 50;
/** What the archive can draw for each chart timeframe, inside the kernel's bounds (raw ≤7 days and 400 points, hour ≤30 days, day ≤365). */
const CHART_READS = Object.freeze({
  '5Min': { input: { interval: 'raw', days: 2, limit: 400 } },
  '15Min': { input: { interval: 'raw', days: 7, limit: 400 } },
  '1Hour': { input: { interval: 'hour', days: 30 } },
  '1Day': { input: { interval: 'day', days: 365 } },
  '1Week': { input: { interval: 'day', days: 365 }, weekly: true },
});
/** What an archive chart is, in words the page prints next to it. */
const CHART_NOTE = 'Stored prices from oshal\'s World archive (Yahoo chart, collected on its own schedule): a line of recorded prices, not live candles.';
/** The source label every archive quote carries. */
const ARCHIVE_SOURCE = 'world-archive';
/** What an archive quote is, in words the page prints next to it. */
const ARCHIVE_NOTE = 'Last price stored by oshal\'s World archive (Yahoo chart, collected on its own schedule). It is not a live quote.';

/**
 * @description Whether this host can read the archive (the native kernel's ctx.intent).
 * @param {object} ctx - Route context.
 * @returns {boolean} True when ctx.intent exists.
 */
function archiveAvailable(ctx) {
  return Boolean(ctx && typeof ctx.intent === 'function');
}

/**
 * @description The archive's last stored price for each ticker it tracks.
 * @param {object} ctx - Route context with ctx.intent.
 * @param {string[]} symbols - Upper-case tickers.
 * @returns {Promise<Map<string, {price:number, asOf:string, source:string, note:string}>>} Priced tickers only.
 */
async function archiveQuotes(ctx, symbols) {
  const out = new Map();
  for (let i = 0; i < symbols.length; i += LATEST_MAX) {
    const answer = await ctx.intent('prices.latest', { symbols: symbols.slice(i, i + LATEST_MAX) });
    for (const row of (answer && answer.prices) || []) {
      const price = Number(row.price);
      const at = row.at ? new Date(row.at) : null;
      if (!row.symbol || !(price > 0) || !at || Number.isNaN(at.getTime())) continue;
      out.set(String(row.symbol).toUpperCase(), { price, asOf: at.toISOString(), source: ARCHIVE_SOURCE, note: ARCHIVE_NOTE });
    }
  }
  return out;
}

/**
 * @description One ticker's archive quote, or a sentence saying why there is none.
 * @param {object} ctx - Route context with ctx.intent.
 * @param {string} symbol - Upper-case ticker.
 * @param {Function} TradingError - The routes' error class (status, code, message).
 * @returns {Promise<object>} The quote; throws a TradingError when the archive does not track the ticker.
 */
async function archiveQuote(ctx, symbol, TradingError) {
  const quote = (await archiveQuotes(ctx, [symbol])).get(symbol);
  if (quote) return quote;
  throw new TradingError(404, 'not_in_price_archive', `No market-data source is connected, and oshal's World price archive has no stored price for ${symbol} (it tracks the default trading universe).`);
}

/**
 * @description The sentence a research section prints when its read failed.
 * @param {string} name - The section.
 * @param {unknown} err - What the read threw.
 * @param {Function} TradingError - The routes' error class.
 * @returns {string} A bounded sentence; a route's own TradingError speaks for itself.
 */
function sectionReason(name, err, TradingError) {
  if (err instanceof TradingError) return err.message;
  const detail = String((err && err.message) || err || 'unknown failure').replace(/\s+/g, ' ').slice(0, 200);
  return `The ${name} read failed: ${detail}`;
}

/**
 * @description Each ticker's stored points for one prices.series window, oldest first, in chunks the kernel allows.
 * @param {object} ctx - Route context with ctx.intent.
 * @param {string[]} symbols - Upper-case tickers.
 * @param {object} input - The window (interval, days, limit).
 * @returns {Promise<Map<string, Array<{t:number, price:number, volume:number|null, bucket:string|null}>>>} Points per ticker; a ticker with none is absent.
 */
async function archiveSeries(ctx, symbols, input) {
  const out = new Map();
  for (let i = 0; i < symbols.length; i += SERIES_MAX) {
    const answer = await ctx.intent('prices.series', { symbols: symbols.slice(i, i + SERIES_MAX), ...input });
    for (const [symbol, rows] of Object.entries((answer && answer.series) || {})) {
      const points = pointsOf(rows, input.interval === 'day');
      if (points.length) out.set(String(symbol).toUpperCase(), points);
    }
  }
  return out;
}

/**
 * @description Stored rows as ascending points with one point per second (the chart library refuses a repeated time).
 * A day bucket is placed on its New York session date (midnight UTC of that date, how a daily chart labels a day);
 * a raw point or an hour bucket on the instant of its last stored price.
 * @param {Array<object>} rows - prices.series rows ({at, price, volume?, bucket?}).
 * @param {boolean} daily - Whether the rows are day buckets.
 * @returns {Array<{t:number, price:number, volume:number|null, bucket:string|null}>} The points.
 */
function pointsOf(rows, daily) {
  const byT = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const price = Number(row && row.price);
    const day = daily && row && /^\d{4}-\d{2}-\d{2}/.test(String(row.bucket || '')) ? String(row.bucket).slice(0, 10) : null;
    const at = day ? Date.parse(`${day}T00:00:00Z`) : (row && row.at ? Date.parse(row.at) : NaN);
    if (!(price > 0) || !Number.isFinite(at)) continue;
    const volume = row.volume == null ? null : Number(row.volume);
    byT.set(Math.floor(at / 1000), { t: Math.floor(at / 1000), price, volume: Number.isFinite(volume) ? volume : null, bucket: row.bucket || null });
  }
  return [...byT.values()].sort((a, b) => a.t - b.t);
}

/**
 * @description One ticker's chart line from the archive for a chart timeframe.
 * @param {object} ctx - Route context with ctx.intent.
 * @param {string} symbol - Upper-case ticker.
 * @param {string} timeframe - 5Min | 15Min | 1Hour | 1Day | 1Week (anything else reads as 1Day).
 * @returns {Promise<{timeframe:string, line:Array<{t:number, v:number}>, source:string, note:string}>} The line (empty when untracked).
 */
async function archiveChart(ctx, symbol, timeframe) {
  const tf = CHART_READS[timeframe] ? timeframe : '1Day';
  let points = (await archiveSeries(ctx, [symbol], CHART_READS[tf].input)).get(symbol) || [];
  if (CHART_READS[tf].weekly) {
    const lastOfWeek = new Map();
    for (const p of points) lastOfWeek.set(weekKey(p.bucket || new Date(p.t * 1000).toISOString()), p);
    points = [...lastOfWeek.values()];
  }
  return { timeframe: tf, line: points.map((p) => ({ t: p.t, v: p.price })), source: ARCHIVE_SOURCE, note: CHART_NOTE };
}

/**
 * @description Each ticker's day closes (the last stored price of each New York day) and that day's reported volume.
 * @param {object} ctx - Route context with ctx.intent.
 * @param {string[]} symbols - Upper-case tickers.
 * @param {number} days - Days of day buckets (1-365).
 * @returns {Promise<Map<string, Array<{t:number, c:number, v:number}>>>} Bars per ticker, oldest first.
 */
async function archiveDailyBars(ctx, symbols, days) {
  const out = new Map();
  for (const [symbol, points] of await archiveSeries(ctx, symbols, { interval: 'day', days: Math.min(365, Math.max(2, days)) })) {
    out.set(symbol, points.map((p) => ({ t: p.t, c: p.price, v: p.volume == null ? 0 : p.volume })));
  }
  return out;
}

/**
 * @description The latest stored price against the previous session's last stored price, in percent.
 * @param {object} ctx - Route context with ctx.intent.
 * @param {string[]} symbols - Upper-case tickers.
 * @returns {Promise<Map<string, number>>} Change per ticker that has two stored sessions.
 */
async function archiveDayChanges(ctx, symbols) {
  const out = new Map();
  for (const [symbol, bars] of await archiveDailyBars(ctx, symbols, 10)) {
    if (bars.length < 2) continue;
    const last = bars[bars.length - 1].c; const prev = bars[bars.length - 2].c;
    if (prev > 0) out.set(symbol, (last / prev - 1) * 100);
  }
  return out;
}

module.exports = { archiveAvailable, archiveQuotes, archiveQuote, sectionReason, archiveChart, archiveDailyBars, archiveDayChanges,
  ARCHIVE_SOURCE, ARCHIVE_NOTE, CHART_NOTE };
