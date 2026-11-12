/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The calibration study as a walk that runs in short turns. The retired study (scripts/oshal-kalshi-calibration.ts) read Kalshi's tape in one twenty-minute command: for each of twelve categories its series (fifteen-minute series left out), then up to 300 settled markets per series of which 60 usable per series and 400 per category are kept, then each kept market's hourly prices for the 26 hours before it closed. This module asks the same questions one at a time and carries a cursor between turns, so the package can rebuild its table inside the kernel's 60-second calls. The arithmetic is lib/kalshi-calibration-build.js. Guard: tests/kalshi-calibration-walk.test.js.
 */
'use strict';

const { samplesOf, usableSettled, buildCalibrationTable } = require('./kalshi-calibration-build');

/** Kalshi's category taxonomy, in the retired study's order; a category with no series is passed over. */
const CATEGORIES = [
  'Politics', 'Sports', 'Economics', 'Crypto', 'Climate and Weather', 'Financials',
  'Companies', 'Entertainment', 'Science and Technology', 'Health', 'World', 'Transportation',
];
/** Usable settled markets kept per series and per category, as the retired study kept them. */
const PER_SERIES_CAP = 60;
const PER_CATEGORY_CAP = 400;
/** Settled markets asked for per series (the retired client's `listMarkets(params, 300)`). */
const SETTLED_PER_SERIES = 300;
/** Hours of hourly prices read before a market's close: the 24-hour horizon plus room for the candle before it. */
const CANDLE_HOURS = 26;
/** A table older than this is rebuilt. */
const REBUILD_AFTER_DAYS = 30;

/**
 * @description Where a new walk starts.
 * @returns {object} The cursor: category index, the category's series (null until read), the next series, how many
 * markets the category has kept, and the kept markets still to sample.
 */
function freshCursor() {
  return { ci: 0, series: null, si: 0, taken: 0, queue: [] };
}

/**
 * @description Whether a walk is finished: every category passed and nothing left to sample.
 * @param {object} cursor A walk's cursor.
 * @returns {boolean} True when the table can be built.
 */
function walkDone(cursor) {
  return cursor.ci >= CATEGORIES.length && cursor.queue.length === 0;
}

/**
 * @description The settled markets of one series, as the retired client listed them: pages of `/markets` until 300 are
 * held or Kalshi has no more.
 * @param {object} io The reads: `get(path)` (Kalshi's public API, throttled) and `normalize(market)`.
 * @param {string} seriesTicker The series.
 * @returns {Promise<{markets: object[], requests: number}>} Normalised markets and how many requests it took.
 */
async function settledMarkets(io, seriesTicker) {
  const markets = [];
  let cursor = '', requests = 0;
  while (markets.length < SETTLED_PER_SERIES) {
    const q = new URLSearchParams({ limit: String(Math.min(1000, SETTLED_PER_SERIES - markets.length)), status: 'settled', series_ticker: seriesTicker });
    if (cursor) q.set('cursor', cursor);
    const body = await io.get(`/markets?${q}`);
    requests += 1;
    const page = (body && Array.isArray(body.markets) ? body.markets : []).map(io.normalize);
    markets.push(...page);
    cursor = (body && body.cursor) || '';
    if (!cursor || page.length === 0) break;
  }
  return { markets, requests };
}

/** A kept market as the queue holds it: only what sampling needs, times as ISO strings so the cursor is plain JSON. */
function queued(market, category) {
  const iso = (value) => (value instanceof Date ? value.toISOString() : value ? String(value) : null);
  return { ticker: market.ticker, seriesTicker: market.seriesTicker, result: market.result, category,
    openTime: iso(market.openTime), closeTime: iso(market.closeTime) };
}

/**
 * @description Take one series' usable settled markets into the queue, within the per-series and per-category caps.
 * @param {object} cursor The walk's cursor (changed in place).
 * @param {object[]} markets The series' settled markets.
 * @param {string} category The category being walked.
 * @returns {void} Queued.
 */
function keepMarkets(cursor, markets, category) {
  for (const market of usableSettled(markets).slice(0, PER_SERIES_CAP)) {
    if (cursor.taken >= PER_CATEGORY_CAP) break;
    cursor.queue.push(queued(market, category));
    cursor.taken += 1;
  }
}

/**
 * @description One question to Kalshi, and the cursor after it: sample a queued market, or read the next series' settled
 * markets, or read the next category's series. A failed read of one series or one market is passed over, as the retired
 * study passed it over; a failed read of a category's series list is thrown, so the walk tries it again next turn.
 * @param {object} cursor The walk's cursor (changed in place).
 * @param {object} io The reads: `get(path)`, `normalize(market)` and `candles(series, ticker, startTs, endTs, minutes)`.
 * @returns {Promise<{samples: object[], requests: number, markets: number, skipped: number}>} What the step found.
 */
async function walkStep(cursor, io) {
  if (cursor.queue.length) {
    const market = cursor.queue[0];
    const closeS = Math.floor(Date.parse(market.closeTime) / 1000);
    let candles = null, failure = null;
    try { candles = await io.candles(market.seriesTicker, market.ticker, closeS - CANDLE_HOURS * 3600, closeS, 60); }
    catch (error) { failure = `prices of ${market.ticker}: ${String(error && error.message || error).slice(0, 160)}`; }
    cursor.queue.shift();
    return { samples: candles ? samplesOf(market, market.category, candles) : [], requests: 1, markets: 1, skipped: candles ? 0 : 1, failure };
  }
  if (cursor.ci >= CATEGORIES.length) return { samples: [], requests: 0, markets: 0, skipped: 0 };
  const category = CATEGORIES[cursor.ci];
  if (cursor.series === null) {
    const body = await io.get(`/series?category=${encodeURIComponent(category)}`);
    cursor.series = (body && Array.isArray(body.series) ? body.series : [])
      .filter((s) => s && s.ticker && String(s.frequency || '') !== 'fifteen_min').map((s) => String(s.ticker));
    cursor.si = 0; cursor.taken = 0;
    return { samples: [], requests: 1, markets: 0, skipped: 0 };
  }
  if (cursor.si >= cursor.series.length || cursor.taken >= PER_CATEGORY_CAP) {
    cursor.ci += 1; cursor.series = null; cursor.si = 0; cursor.taken = 0;
    return { samples: [], requests: 0, markets: 0, skipped: 0 };
  }
  const seriesTicker = cursor.series[cursor.si];
  cursor.si += 1;
  try {
    const { markets, requests } = await settledMarkets(io, seriesTicker);
    keepMarkets(cursor, markets, category);
    return { samples: [], requests, markets: 0, skipped: 0 };
  } catch (error) {
    return { samples: [], requests: 1, markets: 0, skipped: 1, failure: `settled markets of ${seriesTicker}: ${String(error && error.message || error).slice(0, 160)}` };
  }
}

/**
 * @description Walk until the time is spent or the walk is done. A step already started finishes; no step starts after
 * the budget. A read the walk passes over is named in `failures` (the first five); a category's series list that cannot
 * be read stops the turn with `error`, and what the turn found before it is kept.
 * @param {object} cursor The walk's cursor (changed in place).
 * @param {object} io The reads (see walkStep).
 * @param {{budgetMs: number, now?: () => number}} options How long to keep starting steps.
 * @returns {Promise<{samples: object[], requests: number, markets: number, skipped: number, failures: string[], done: boolean, error?: string}>} The turn.
 */
async function walkTurn(cursor, io, options) {
  const now = options.now || Date.now, startedAt = now();
  const turn = { samples: [], requests: 0, markets: 0, skipped: 0, failures: [], done: false };
  while (!walkDone(cursor) && now() - startedAt < options.budgetMs) {
    let step;
    try { step = await walkStep(cursor, io); }
    catch (error) { turn.error = `series of ${CATEGORIES[cursor.ci]}: ${String(error && error.message || error).slice(0, 160)}`; break; }
    turn.samples.push(...step.samples);
    turn.requests += step.requests; turn.markets += step.markets; turn.skipped += step.skipped;
    if (step.failure && turn.failures.length < 5) turn.failures.push(step.failure);
  }
  turn.done = walkDone(cursor);
  return turn;
}

/**
 * @description Whether a new walk should start: no table built yet, or the newest is older than REBUILD_AFTER_DAYS.
 * @param {string|null} builtAt When the newest rebuilt table was generated (ISO), or null.
 * @param {number} nowMs The time now.
 * @returns {boolean} True when a rebuild is due.
 */
function rebuildDue(builtAt, nowMs) {
  const at = builtAt ? Date.parse(builtAt) : NaN;
  return !Number.isFinite(at) || nowMs - at >= REBUILD_AFTER_DAYS * 86400000;
}

/**
 * @description The table a finished walk gives, from its samples in the order they were found.
 * @param {object[]} samples Every sample of the walk.
 * @param {Date} [now] The table's time.
 * @returns {object} The calibration table.
 */
function tableOf(samples, now) {
  return buildCalibrationTable(samples, now);
}

module.exports = {
  CATEGORIES, PER_SERIES_CAP, PER_CATEGORY_CAP, SETTLED_PER_SERIES, CANDLE_HOURS, REBUILD_AFTER_DAYS,
  freshCursor, walkDone, walkStep, walkTurn, rebuildDue, tableOf, settledMarkets,
};
