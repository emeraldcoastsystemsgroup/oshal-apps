/** CHANGE LOG
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.61.3: archived day prices are kept in the process for ten minutes per name and window (createArchiveCache), and only the names not kept are read. The kernel's World archive read is the whole cost of a stock answer without Schwab (blue, 2026-11-17: 220 to 430 ms most times, 1.8 to 2.0 s the first time a name is read after a while), and Trading serves one call at a time. The prices are the archive's public market data, the same for every caller; past days never change, and today's last price is at most ten minutes old.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Read the caller's whole Trading configuration once (connected, and whether this kernel reads option chains).
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The quant lab's price reads: the caller's own Schwab daily candles when a Schwab login is connected (read in parallel, at most six names, inside one short budget so Trading is never held up), otherwise the World archive's recorded day prices, always labelled as archived. Never invented: a name with no data says why.
 */
'use strict';
const { lastCompletedSession } = require('../trading-portfolio-calendar');
const { fail } = require('./math/checks');

/** The most names one question may read. */
const MAX_NAMES = 6;
/** Reads still running after this are answered without (Trading serves one call at a time). */
const READ_BUDGET_MS = 2500;
/** The World archive keeps day prices for at most a year. */
const ARCHIVE_MAX_DAYS = 365;
/** How long a name's archived day prices are kept in the process, and how many name-and-window copies at most. */
const ARCHIVE_KEEP_MS = 10 * 60000;
const ARCHIVE_KEEP_ENTRIES = 400;
const TICKER = /^[A-Z][A-Z0-9.-]{0,9}$/;
const SCHWAB_NOTE = 'Daily candles from your own Schwab connection (open, high, low, close and volume).';
const ARCHIVE_NOTE = 'Archived prices from the World archive: the last price it recorded each New York trading day (Yahoo chart, collected on its own schedule), not official exchange closes, no highs or lows, at most a year, and a day the collector missed is absent. Connect Schwab for full daily candles.';

/**
 * @description Tickers from text or a list: upper-case, de-duplicated, checked, and capped.
 * @param {string|string[]} raw - "AAPL, MSFT" or ["AAPL", "MSFT"].
 * @param {{min?:number, max?:number}} [bounds] - How many are allowed.
 * @returns {string[]} The tickers.
 */
function parseSymbols(raw, { min = 1, max = MAX_NAMES } = {}) {
  const list = (Array.isArray(raw) ? raw : String(raw == null ? '' : raw).split(/[\s,;]+/)).map((s) => String(s).trim().toUpperCase()).filter(Boolean);
  const unique = [...new Set(list)];
  const bad = unique.find((s) => !TICKER.test(s));
  if (bad) throw fail(`${bad.slice(0, 12)} is not a ticker.`);
  if (unique.length < min) throw fail(`Name at least ${min} ticker${min > 1 ? 's' : ''}.`);
  if (unique.length > max) throw fail(`At most ${max} tickers per question, so the answer stays quick.`);
  return unique;
}

/**
 * @description Whether the caller has a Schwab login connected (the kernel's trading.config; a failed read counts as none).
 * @param {object} deps - {intent}.
 * @returns {Promise<boolean>} True when connected.
 */
async function schwabConnected(deps) {
  return (await tradingConfig(deps)).configured === true;
}

/**
 * @description The caller's Trading configuration as the kernel reports it; a failed read counts as nothing connected.
 * @param {object} deps - {intent}.
 * @returns {Promise<object>} {configured, optionChains, ...}.
 */
async function tradingConfig(deps) {
  try { return (await deps.intent('trading.config', {})) || {}; } catch { return {}; }
}

/**
 * @description Calendar days of history to ask Schwab for, to cover a number of trading sessions.
 * @param {number} sessions - Trading sessions wanted.
 * @returns {number} Days from 400 to 4000 (the kernel's bound).
 */
function historyDaysFor(sessions) {
  return Math.min(4000, Math.max(400, Math.ceil((sessions * 365) / 252) + 10));
}

/**
 * @description One Schwab bars answer as dated columns, finished sessions only, oldest first.
 * @param {string} symbol - Ticker asked for.
 * @param {object} answer - trading.bars answer.
 * @param {string} latest - Last completed session (YYYY-MM-DD).
 * @returns {object} {dates, opens, highs, lows, closes, volumes}.
 */
function columnsFromBars(symbol, answer, latest) {
  if (!answer || answer.source !== 'schwab' || answer.symbol !== symbol || !Array.isArray(answer.bars)) throw new Error('unverified price source');
  const byDate = new Map();
  for (const bar of answer.bars) {
    const date = new Date(Number(bar.t) * 1000).toISOString().slice(0, 10), c = Number(bar.c);
    if (c > 0 && date <= latest) byDate.set(date, [Number(bar.o) || c, Number(bar.h) || c, Number(bar.l) || c, c, Number(bar.v) || 0]);
  }
  const dates = [...byDate.keys()].sort(), at = (k) => dates.map((d) => byDate.get(d)[k]);
  return { dates, opens: at(0), highs: at(1), lows: at(2), closes: at(3), volumes: at(4) };
}

/**
 * @description A promise that settles with {timedOut: true} after the budget.
 * @param {number} ms - Budget.
 * @returns {Promise<{timedOut:boolean}>} The timer.
 */
function budget(ms) {
  return new Promise((resolve) => { const t = setTimeout(() => resolve({ timedOut: true }), ms); if (t.unref) t.unref(); });
}

/**
 * @description Read each name's Schwab daily candles in parallel inside the read budget.
 * @param {object} deps - {intent, time}.
 * @param {string[]} symbols - Tickers.
 * @param {number} sessions - Sessions wanted.
 * @returns {Promise<{series:Map<string, object>, missing:Array<{symbol:string, reason:string}>}>} The columns per name, and the names without.
 */
async function schwabSeries(deps, symbols, sessions) {
  const latest = lastCompletedSession(new Date(deps.time())), historyDays = historyDaysFor(sessions);
  const reads = symbols.map((symbol) => deps.intent('trading.bars', { symbol, timeframe: '1Day', historyDays })
    .then((answer) => ({ symbol, columns: columnsFromBars(symbol, answer, latest) }))
    .catch((err) => ({ symbol, reason: `Schwab's price read failed: ${String((err && err.message) || err).slice(0, 160)}` })));
  const settled = await Promise.race([Promise.all(reads), budget(deps.readBudgetMs || READ_BUDGET_MS)]);
  const done = Array.isArray(settled) ? settled : [];
  const series = new Map(), missing = [];
  for (const symbol of symbols) {
    const hit = done.find((r) => r.symbol === symbol);
    if (!hit) missing.push({ symbol, reason: 'Schwab had not answered within the time a question may take; ask again or about fewer names.' });
    else if (hit.reason) missing.push({ symbol, reason: hit.reason });
    else if (!hit.columns.dates.length) missing.push({ symbol, reason: 'Schwab returned no daily prices for it.' });
    else series.set(symbol, { ...hit.columns, source: 'schwab' });
  }
  return { series, missing };
}

/**
 * @description One archive ticker's day rows as dated columns (the New York session date of each day bucket).
 * @param {Array<object>} rows - prices.series rows ({bucket, at, price, volume}).
 * @returns {{dates:string[], closes:number[], volumes:number[]}} Columns, oldest first.
 */
function columnsFromArchive(rows) {
  const byDate = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const day = /^\d{4}-\d{2}-\d{2}/.test(String(row && row.bucket || '')) ? String(row.bucket).slice(0, 10) : null, price = Number(row && row.price);
    if (day && price > 0) byDate.set(day, [price, Number(row.volume) || 0]);
  }
  const dates = [...byDate.keys()].sort();
  return { dates, closes: dates.map((d) => byDate.get(d)[0]), volumes: dates.map((d) => byDate.get(d)[1]) };
}

/**
 * @description The process's copy of archived day prices per name and window, kept ten minutes (oldest dropped past
 * the cap). Archive prices are public market data, the same for every caller, so one copy serves everyone.
 * @returns {{get:Function, put:Function, size:Function}} get(symbol, days, now), put(symbol, days, rows, now), size().
 */
function createArchiveCache() {
  const kept = new Map();
  return {
    get(symbol, days, now) {
      const hit = kept.get(`${symbol}:${days}`);
      return hit && now - hit.at < ARCHIVE_KEEP_MS ? hit.rows : null;
    },
    put(symbol, days, rows, now) {
      kept.delete(`${symbol}:${days}`);
      kept.set(`${symbol}:${days}`, { rows, at: now });
      while (kept.size > ARCHIVE_KEEP_ENTRIES) kept.delete(kept.keys().next().value);
    },
    size: () => kept.size,
  };
}

/**
 * @description The archived day rows per name: the process's kept copies, and one kernel read for the names not kept.
 * @param {object} deps - {intent, time, archive?}.
 * @param {string[]} symbols - Tickers.
 * @param {number} days - Window.
 * @returns {Promise<{byName:Map<string, Array>, error:string|null}>} Rows per name, and why the read failed if it did.
 */
async function archiveRows(deps, symbols, days) {
  const cache = deps.archive || null, now = cache ? deps.time() : 0, byName = new Map();
  for (const symbol of symbols) { const rows = cache && cache.get(symbol, days, now); if (rows) byName.set(symbol, rows); }
  const wanted = symbols.filter((symbol) => !byName.has(symbol));
  if (!wanted.length) return { byName, error: null };
  let answer;
  try { answer = await deps.intent('prices.series', { symbols: wanted, interval: 'day', days }); }
  catch (err) { return { byName, error: String((err && err.message) || err).slice(0, 160) }; }
  for (const [key, rows] of Object.entries((answer && answer.series) || {})) {
    const symbol = String(key).toUpperCase();
    byName.set(symbol, rows);
    if (cache && Array.isArray(rows) && rows.length) cache.put(symbol, days, rows, now);
  }
  return { byName, error: null };
}

/**
 * @description Read each name's archived day prices: kept copies first, then one kernel read for the rest.
 * @param {object} deps - {intent, time, archive?}.
 * @param {string[]} symbols - Tickers (at most 50, the kernel's bound; questions ask for six at most).
 * @param {number} sessions - Sessions wanted.
 * @returns {Promise<{series:Map<string, object>, missing:Array<{symbol:string, reason:string}>}>} Columns per name, and the names without.
 */
async function archiveSeries(deps, symbols, sessions) {
  const days = Math.min(ARCHIVE_MAX_DAYS, Math.max(2, Math.ceil((sessions * 365) / 252) + 5));
  const { byName, error } = await archiveRows(deps, symbols, days);
  const series = new Map(), missing = [];
  for (const symbol of symbols) {
    const columns = columnsFromArchive(byName.get(symbol));
    if (columns.dates.length) series.set(symbol, { ...columns, source: 'world-archive' });
    else missing.push({ symbol, reason: error && !byName.has(symbol) ? `The World archive could not be read: ${error}` : 'No Schwab login is connected, and the World archive has no recorded prices for it (it tracks the default trading universe).' });
  }
  return { series, missing };
}

/**
 * @description Daily prices for a question: the caller's Schwab candles when connected, otherwise the World archive's
 * recorded day prices. The answer always says which, so archived prices are never mistaken for official closes.
 * @param {object} deps - {intent, time}.
 * @param {string[]} symbols - Tickers (parsed).
 * @param {{sessions:number}} options - Sessions of history wanted.
 * @returns {Promise<{source:string, note:string, series:Map<string, object>, missing:Array<object>}>} The prices.
 */
async function loadPrices(deps, symbols, { sessions }) {
  if (await schwabConnected(deps)) return { source: 'schwab', note: SCHWAB_NOTE, ...await schwabSeries(deps, symbols, sessions) };
  return { source: 'world-archive', note: ARCHIVE_NOTE, ...await archiveSeries(deps, symbols, sessions) };
}

/**
 * @description The last n sessions of a name's columns.
 * @param {object} s - Columns.
 * @param {number} n - Sessions.
 * @returns {object} The same shape, shortened.
 */
function lastSessions(s, n) {
  const from = Math.max(0, s.dates.length - n), cut = (a) => (Array.isArray(a) ? a.slice(from) : a);
  return { ...s, dates: cut(s.dates), opens: cut(s.opens), highs: cut(s.highs), lows: cut(s.lows), closes: cut(s.closes), volumes: cut(s.volumes) };
}

/**
 * @description Several names' closes on the dates they all share, oldest first.
 * @param {Array<object>} list - Columns per name.
 * @returns {{dates:string[], closes:number[][]}} Shared dates and each name's closes on them.
 */
function alignCloses(list) {
  const shared = list.map((s) => new Set(s.dates)).reduce((a, b) => new Set([...a].filter((d) => b.has(d))));
  const dates = [...shared].sort();
  return { dates, closes: list.map((s) => { const at = new Map(s.dates.map((d, i) => [d, s.closes[i]])); return dates.map((d) => at.get(d)); }) };
}

module.exports = { MAX_NAMES, READ_BUDGET_MS, ARCHIVE_KEEP_MS, SCHWAB_NOTE, ARCHIVE_NOTE, parseSymbols, schwabConnected, tradingConfig, historyDaysFor, columnsFromBars, columnsFromArchive, createArchiveCache, loadPrices, lastSessions, alignCloses };
