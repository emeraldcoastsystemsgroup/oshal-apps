/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: the native paper engine's only market input. It reads the kernel's prices.latest (at most 200 tickers a call) and prices.series (at most 50 a call; raw points, hour and day buckets) intents through ctx.intent, keeps a ticker the archive cannot price under `missing` instead of inventing a value, resamples day buckets into week and quarter closes for the regime timeframes, and says which quotes are fresh enough to trade on. It also owns the New York session clock and the five-minute tick window. No other network path exists here.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Review fixes. The session clock carries the NYSE early closes (13:00 New York on the day after Thanksgiving, and on July 3 and December 24 when they fall Monday to Thursday): before, a half day counted as open until 16:00, so the frozen 13:00 quote stayed fresh and ticks filled after the exchange had closed. The quarterly resample is gone: the kernel's 365-day cap on day buckets gives at most 5 quarters, which no algorithm can vote on (the decision rules dropped that timeframe).
 *
 * @module paper/market
 */
'use strict';

const LATEST_MAX = 200;
const SERIES_MAX = 50;
/** The three series reads and the timeframe each one feeds. */
const SERIES_READS = Object.freeze([
  { tf: '5Min', input: { interval: 'raw', days: 2, limit: 120 } },
  { tf: '1Hour', input: { interval: 'hour', days: 14 } },
  { tf: '1Day', input: { interval: 'day', days: 200 } },
]);
const SESSION_ZONE = 'America/New_York';
const TICK_MS = 5 * 60 * 1000;

/**
 * @description Split a list into chunks of at most n.
 * @param {Array} list - Items.
 * @param {number} n - Chunk size.
 * @returns {Array<Array>} The chunks.
 */
function chunks(list, n) {
  const out = [];
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n));
  return out;
}

/**
 * @description New York wall-clock parts of an instant.
 * @param {Date} now - The instant.
 * @returns {{date:string, weekday:number, minutes:number}} ET date (YYYY-MM-DD), weekday (0=Sun) and minutes after midnight.
 */
function etParts(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: SESSION_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(now).map((p) => [p.type, p.value]));
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, weekday, minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

/**
 * @description The weekday (0=Sun) of a calendar date.
 * @param {number} year - Year.
 * @param {number} month - Month 1-12.
 * @param {number} day - Day of month.
 * @returns {number} The weekday.
 */
function weekdayOf(year, month, day) {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * @description Whether a New York date is an NYSE early-close (13:00) session: the day after Thanksgiving
 * (the fourth Thursday of November), and July 3 and December 24 when they fall Monday to Thursday (on a
 * Friday they are the observed holiday instead, when every quote is stale anyway).
 * @param {string} date - YYYY-MM-DD in New York.
 * @returns {boolean} True on a half day.
 */
function earlyClose(date) {
  const [year, month, day] = date.split('-').map(Number);
  if (month === 11) {
    const firstThursday = 1 + ((4 - weekdayOf(year, 11, 1) + 7) % 7);
    return day === firstThursday + 22;
  }
  const weekday = weekdayOf(year, month, day);
  return ((month === 7 && day === 3) || (month === 12 && day === 24)) && weekday >= 1 && weekday <= 4;
}

/**
 * @description Minutes after New York midnight at which the regular session of a date closes.
 * @param {string} date - YYYY-MM-DD in New York.
 * @returns {number} 13:00 on an early close, otherwise 16:00.
 */
function sessionCloseMinutes(date) {
  return earlyClose(date) ? 13 * 60 : 16 * 60;
}

/**
 * @description Whether an instant falls inside the US regular session (Mon-Fri 09:30 New York to the close,
 * 16:00 or 13:00 on an early-close day). Full exchange holidays are not listed here: on a holiday every
 * quote is stale, and a stale quote never trades.
 * @param {Date} now - The instant.
 * @returns {boolean} True inside the regular session.
 */
function regularSession(now) {
  const { date, weekday, minutes } = etParts(now);
  return weekday >= 1 && weekday <= 5 && minutes >= 9 * 60 + 30 && minutes < sessionCloseMinutes(date);
}

/**
 * @description The five-minute window an instant belongs to; one tick per window per person.
 * @param {Date} now - The instant.
 * @returns {string} The window start as an ISO instant (e.g. 2026-10-05T14:35:00.000Z).
 */
function tickWindow(now) {
  return new Date(Math.floor(now.getTime() / TICK_MS) * TICK_MS).toISOString();
}

/**
 * @description The Monday (UTC date) that starts the week of a YYYY-MM-DD bucket.
 * @param {string} day - Bucket date.
 * @returns {string} The week key.
 */
function weekKey(day) {
  const d = new Date(`${day.slice(0, 10)}T00:00:00Z`);
  const offset = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - offset * 86400000).toISOString().slice(0, 10);
}

/**
 * @description Resample day buckets into the last close of each period.
 * @param {Array<{bucket:string, price:number}>} days - Day rows, oldest first.
 * @param {(day:string)=>string} keyOf - Period key.
 * @returns {number[]} One close per period, oldest first.
 */
function resample(days, keyOf) {
  const out = new Map();
  for (const row of days) if (row.bucket && row.price > 0) out.set(keyOf(row.bucket), Number(row.price));
  return [...out.values()];
}

/**
 * @description Read the latest quotes and the three series for a set of tickers through the kernel.
 * @param {(name:string, input:object)=>Promise<object>} intent - The package host's intent call.
 * @param {string[]} symbols - Upper-case tickers (deduplicated by the caller).
 * @returns {Promise<{quotes:Map<string,{price:number,at:string}>, closes:Map<string,Object<string,number[]>>, missing:string[], readAt:string|null}>} The market snapshot.
 */
async function readMarket(intent, symbols) {
  const quotes = new Map(); const missing = new Set(); let readAt = null;
  for (const group of chunks(symbols, LATEST_MAX)) {
    const answer = await intent('prices.latest', { symbols: group });
    readAt = answer && answer.readAt ? answer.readAt : readAt;
    for (const row of (answer && answer.prices) || []) {
      const price = Number(row.price);
      if (row.symbol && price > 0) quotes.set(String(row.symbol).toUpperCase(), { price, at: row.at || null });
    }
    for (const sym of (answer && answer.missing) || []) missing.add(String(sym).toUpperCase());
  }
  const priced = symbols.filter((s) => quotes.has(s));
  const closes = new Map(priced.map((s) => [s, {}]));
  for (const read of SERIES_READS) {
    for (const group of chunks(priced, SERIES_MAX)) {
      const answer = await intent('prices.series', { symbols: group, ...read.input });
      for (const [sym, points] of Object.entries((answer && answer.series) || {})) {
        const slot = closes.get(String(sym).toUpperCase());
        if (!slot || !Array.isArray(points)) continue;
        slot[read.tf] = points.map((p) => Number(p.price)).filter((v) => v > 0);
        if (read.tf === '1Day') slot['1Week'] = resample(points, weekKey);
      }
    }
  }
  return { quotes, closes, missing: [...missing].sort(), readAt };
}

/**
 * @description Whether a quote is recent enough to price a fill.
 * @param {{at:string|null}|undefined} quote - The latest quote.
 * @param {Date} now - The tick instant.
 * @param {number} maxAgeMinutes - Freshness bound.
 * @returns {boolean} True when the quote is at most maxAgeMinutes old.
 */
function quoteFresh(quote, now, maxAgeMinutes) {
  if (!quote || !quote.at) return false;
  const at = Date.parse(quote.at);
  return Number.isFinite(at) && now.getTime() - at <= maxAgeMinutes * 60000 && at <= now.getTime() + 60000;
}

module.exports = { readMarket, quoteFresh, regularSession, earlyClose, tickWindow, etParts, weekKey, resample, SERIES_READS, LATEST_MAX, SERIES_MAX };
