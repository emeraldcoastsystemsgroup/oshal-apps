/** CHANGE LOG
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Raise the engine so the history test's corrected wording republishes from the stored prices.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | On the first full read ADP, CME, ENB and LH were marked as having no data, yet each read fine a minute later; the last error was the kernel refusing a read when the Schwab connection changed under it. A name that fails now gets a second try once the sweep ends, and the reason for each name still left out is kept.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Reads across thousands of names, and passes shrink to 12 seconds because Trading runs as one process serving one call at a time: a longer pass would hold up the stop watcher and every screen. Each heavy step gets its own pass, so a publish starts with the whole 60-second call ahead of it. Filings refresh the list without re-reading prices.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Pace price reads to 75 a minute: the desk shares Schwab's request limit with the watcher, which also checks stops after hours, and research must never crowd out a stop.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | A release that changes how results are worked out republishes the night's results from the stored prices, without reading them again.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The history test now runs first so the list is led by the signal with the best evidence, and a symbol whose long history holds one bad candle (DVN on the first real run) retries a shorter window instead of leaving the list.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The Quant desk's nightly pipeline, one bounded pass at a time: read ten years of daily closes for the list, publish the ranked list, history test and scoreboard, then add SEC filings and earnings dates and publish again. Read-only market intents only; no module here can reach an order.
 */
'use strict';
const store = require('./store');
const { digestBars } = require('./factors');
const { buildToday, refreshToday } = require('./rank');
const { historyTest, leadingSignal } = require('./history');
const { makeCohort, gradeCohort, forwardBoard } = require('./scoreboard');
const { buildUniverse, listedCompanies } = require('./universe');
const { enrichPass, readCompany } = require('./enrich');
const { lastCompletedSession } = require('../trading-portfolio-calendar');
const { readSecFinancialSummary } = require('../trading-sec-financial-reader');

const HISTORY_DAYS = 4000;
/** Raise when results are worked out differently: the night's list is republished from the stored prices. */
const ENGINE = 5;
/** Shorter windows to try when one old candle in the long window is unusable. */
const SHORTER_WINDOWS = Object.freeze([1500, 400]);
/** Everything else in Trading waits while a pass runs, so reading stops this soon. A read already started may finish. */
const PASS_BUDGET_MS = 12000;
const BUSY_MS = 55000;
/** Enough passes to read filings for a large share of the list in a night. */
const MAX_ENRICH_PASSES = 300;
/** Show what the filings have added this often during the night. */
const REFRESH_EVERY = 10;
/** Well inside Schwab's limit of about 120 a minute, which the watcher shares. */
const READ_SPACING_MS = 800;
const RATE_LIMITED = /\b429\b|rate.?limit|too many requests|throttl/i;

/**
 * @description Read one symbol's closes and store its digest.
 * @param {object} deps - {pool, intent}.
 * @param {string} sub - Owner.
 * @param {string} symbol - Ticker.
 * @param {string} session - Last completed session.
 * @param {Date} now - Instant.
 * @returns {Promise<boolean>} Whether a digest was stored.
 */
async function readSymbol(deps, sub, symbol, session, now) {
  let answer;
  for (const historyDays of [HISTORY_DAYS, ...SHORTER_WINDOWS]) {
    try { answer = await deps.intent('trading.bars', { symbol, timeframe: '1Day', historyDays }); break; }
    catch (err) { if (!/invalid candle/i.test(String(err && err.message || err)) || historyDays === SHORTER_WINDOWS.at(-1)) throw err; }
  }
  if (answer.source !== 'schwab' || answer.symbol !== symbol || !Array.isArray(answer.bars)) throw new Error('unverified price source');
  const digest = digestBars(symbol, answer.bars, session);
  if (!digest) return false;
  await store.putPrices(deps.pool, sub, symbol, digest, now);
  return true;
}

/**
 * @description Wait out what is left of a read's slot.
 * @param {number} ms - Milliseconds; nothing to wait for at or below zero.
 * @returns {Promise<void>}
 */
function pause(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

/**
 * @description Read closes until the list is done or the pass runs out of time. Names that gave nothing the first time get one more try after
 * the sweep: a connection refreshed mid-read says nothing about the stock.
 * @param {object} deps - Pass dependencies.
 * @param {string} sub - Owner.
 * @param {object} state - Pipeline state; its cursor advances.
 * @param {number} deadline - Epoch milliseconds to stop by.
 * @returns {Promise<boolean>} Whether the whole list has been read.
 */
async function scan(deps, sub, state, deadline) {
  while (deps.time() < deadline) {
    const swept = state.cursor >= state.symbols.length;
    if (swept && !state.retry) { state.retry = state.noData; state.noData = []; state.readErrors = {}; }
    if (swept && !state.retry.length) return true;
    const symbol = swept ? state.retry[0] : state.symbols[state.cursor], readStarted = deps.time();
    try {
      if (!(await readSymbol(deps, sub, symbol, state.session, new Date(deps.time())))) state.noData.push(symbol);
    } catch (err) {
      const message = String(err && err.message || err);
      if (RATE_LIMITED.test(message)) { state.note = 'Schwab asked us to slow down; continuing on the next pass.'; return false; }
      // SPY is read first and everything is measured against it: stop here and retry on the next pass.
      if (symbol === 'SPY') throw Object.assign(new Error(`SPY's price history could not be read, so nothing was scored: ${message.slice(0, 200)}`), { status: 502, code: 'quant_prices_unavailable' });
      state.noData.push(symbol);
      state.readErrors = { ...state.readErrors, [symbol]: message.slice(0, 160) };
    }
    if (swept) state.retry.shift(); else state.cursor += 1;
    await (deps.pause || pause)(READ_SPACING_MS - (deps.time() - readStarted));
  }
  return Boolean(state.retry) && !state.retry.length;
}

/**
 * @description A symbol's closes by date without building a map of every day of every stock: the dates are sorted, so this searches them.
 * @param {object} digest - Stored digest.
 * @returns {{get:(day:string) => number|undefined}} The lookup.
 */
function closeLookup({ recent: { d, c } }) {
  return {
    get(day) {
      let lo = 0, hi = d.length - 1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (d[mid] === day) return c[mid];
        if (d[mid] < day) lo = mid + 1; else hi = mid - 1;
      }
      return undefined;
    },
  };
}

/**
 * @description What a row knows from outside its prices, read from the desk's records.
 * @param {object} deps - Pass dependencies.
 * @param {string} sub - Owner.
 * @param {object} state - Pipeline state.
 * @returns {Promise<object>} Maps by symbol.
 */
async function readExtras(deps, sub, state) {
  const usable = (f) => f.revenueYoYPct != null || f.netMarginPct != null;
  const [funds, companies, directory, traded] = await Promise.all([store.listRecords(deps.pool, sub, 'fund'), store.listRecords(deps.pool, sub, 'company'), store.getRecord(deps.pool, sub, 'directory', 'current'), store.getRecord(deps.pool, sub, 'congress-names', 'current')]);
  return {
    funds: new Map(funds.filter(usable).map((f) => [f.symbol, f])), companies: new Map(companies.map((c) => [c.symbol, c])),
    names: new Map(Object.entries((directory && directory.names) || {})), congressNames: new Set((traded && traded.symbols) || []),
    congress: new Map(state.congress.map((c) => [c.symbol, c])), earnings: new Map(Object.entries(state.earnings || {})), holdings: new Map(state.holdings.map((h) => [h.symbol, h])),
  };
}

/**
 * @description Record tonight's picks, keeping any grades already made for this session.
 * @param {object} deps - Pass dependencies.
 * @param {string} sub - Owner.
 * @param {string} session - The session.
 * @param {Array<object>} rows - Today's rows.
 * @param {string} rankBy - The signal leading the list.
 * @returns {Promise<void>}
 */
async function recordPicks(deps, sub, session, rows, rankBy) {
  const previous = await store.getRecord(deps.pool, sub, 'cohort', session);
  await store.putRecord(deps.pool, sub, 'cohort', session, { ...makeCohort(session, rows), rankBy, graded: previous ? previous.graded : {} });
}

/**
 * @description Publish today's list, the history test and the scoreboard from the stored digests.
 * @param {object} deps - Pass dependencies.
 * @param {string} sub - Owner.
 * @param {object} state - Pipeline state.
 * @returns {Promise<object>} Today's summary.
 */
async function publish(deps, sub, state) {
  const at = new Date(deps.time()).toISOString(), wanted = new Set(state.symbols);
  const digests = (await store.listPrices(deps.pool, sub)).filter((d) => wanted.has(d.symbol));
  const history = historyTest(digests, at), leader = leadingSignal(history.signals);
  const { rows, ...today } = buildToday({ session: state.session, at, digests, noData: state.noData, rankBy: leader.id, pool: state.pool, ...await readExtras(deps, sub, state) });
  await store.putRecord(deps.pool, sub, 'rows', 'current', rows);
  await store.putRecord(deps.pool, sub, 'today', 'current', today);
  await store.putRecord(deps.pool, sub, 'history', 'current', history);
  await recordPicks(deps, sub, state.session, rows, leader.id);
  const cohorts = await store.listRecords(deps.pool, sub, 'cohort'), closes = new Map(digests.map((d) => [d.symbol, closeLookup(d)])), spy = digests.find((d) => d.symbol === 'SPY');
  for (const stored of cohorts) if (spy && gradeCohort(stored, closes, spy.recent.d)) await store.putRecord(deps.pool, sub, 'cohort', stored.session, stored);
  await store.putRecord(deps.pool, sub, 'forward', 'current', forwardBoard(cohorts, at));
  return today;
}

/**
 * @description Show what the night's filings have added, without touching prices or ranks.
 * @param {object} deps - Pass dependencies.
 * @param {string} sub - Owner.
 * @param {object} state - Pipeline state.
 * @returns {Promise<void>}
 */
async function refresh(deps, sub, state) {
  const [today, rows] = await Promise.all([store.getRecord(deps.pool, sub, 'today', 'current'), store.getRecord(deps.pool, sub, 'rows', 'current')]);
  if (!today || !rows) return;
  const next = refreshToday(today, rows, await readExtras(deps, sub, state));
  await store.putRecord(deps.pool, sub, 'rows', 'current', rows);
  await store.putRecord(deps.pool, sub, 'today', 'current', next);
  await recordPicks(deps, sub, state.session, rows, next.rankBy);
}

/**
 * @description A fresh pipeline state for a new session.
 * @param {object} deps - Pass dependencies.
 * @param {string} sub - Owner.
 * @param {string} session - Last completed session.
 * @param {Date} now - Instant.
 * @returns {Promise<object>} The state.
 */
async function startSession(deps, sub, session, now) {
  const { symbols, holdings, congress, notes, pool } = await buildUniverse(deps, sub, now);
  return { session, startedAt: now.toISOString(), phase: 'scan', cursor: 0, symbols, holdings, congress, notes, pool, noData: [], enrichPasses: 0, passes: 0 };
}

/**
 * @description Do the next step of the pipeline. Reading and enriching stop at the deadline; publishing runs alone in its pass, so it has the whole call to finish in.
 * @param {object} deps - Pass dependencies.
 * @param {string} sub - Owner.
 * @param {object} state - Pipeline state.
 * @param {number} deadline - Epoch milliseconds to stop reading by.
 * @returns {Promise<void>}
 */
async function advance(deps, sub, state, deadline) {
  if (state.phase === 'scan') {
    if (await scan(deps, sub, state, deadline)) state.phase = 'publish';
  } else if (state.phase === 'publish') {
    await publish(deps, sub, state);
    state.publishedAt = new Date(deps.time()).toISOString();
    state.phase = 'enrich';
  } else if (state.phase === 'enrich') {
    await enrichPass(deps, sub, state, deadline);
    if (state.enrichPasses >= MAX_ENRICH_PASSES || (state.secRemaining === 0 && state.companiesRemaining === 0)) state.phase = 'final';
    else if (state.enrichPasses % REFRESH_EVERY === 0) await refresh(deps, sub, state);
  } else if (state.phase === 'final') {
    await refresh(deps, sub, state);
    state.publishedAt = new Date(deps.time()).toISOString();
    state.phase = 'done';
  }
}

/**
 * @description The public view of the pipeline.
 * @param {object|null} state - Pipeline state.
 * @returns {object|null} Progress for a person or the concierge.
 */
function progress(state) {
  if (!state) return null;
  return { session: state.session, phase: state.phase, read: state.cursor, total: state.symbols.length, noData: state.noData.length, secRead: state.secRead || 0, secRemaining: state.secRemaining ?? null, companiesRemaining: state.companiesRemaining ?? null, publishedAt: state.publishedAt || null, note: state.note || null, notes: state.notes || [], pool: state.pool || null };
}

/**
 * @description Run one bounded pass. Safe to call any time: finished work is not repeated and a pass already running is left alone.
 * @param {object} deps - {ctx, pool, intent, time, listedCompanies, readSec, readCompany}.
 * @param {string} sub - Owner.
 * @returns {Promise<object>} {status, progress, message?}.
 */
async function runPass(deps, sub) {
  const now = new Date(deps.time()), session = lastCompletedSession(now);
  let state = await store.getRecord(deps.pool, sub, 'state', 'current');
  // A release that changes results republishes whenever the night already has a list, even partway through its filings.
  if (state && state.session === session && state.publishedAt && state.engine !== ENGINE) state.phase = 'publish';
  if (state && state.session === session && state.phase === 'done') return { status: 'done', progress: progress(state) };
  if (state && state.busyUntil > deps.time()) return { status: 'busy', progress: progress(state) };
  let configured = false;
  try { configured = (await deps.intent('trading.config', {})).configured === true; } catch { configured = false; }
  if (!configured) return { status: 'needs-schwab', message: 'The Quant desk reads ten years of daily prices from a connected Schwab login. Connect Schwab in Settings, Connections.', progress: progress(state) };
  const fresh = !state || state.session !== session;
  if (!state) await store.retireOldRecords(deps.pool, sub);
  if (fresh) state = await startSession(deps, sub, session, now);
  state.engine = ENGINE;
  state.busyUntil = deps.time() + BUSY_MS;
  state.passes += 1;
  state.note = null;
  await store.putRecord(deps.pool, sub, 'state', 'current', state);
  try {
    // Working out tonight's pool takes a pass of its own: its reads are many and small.
    if (!fresh) await advance(deps, sub, state, deps.time() + PASS_BUDGET_MS);
    return { status: state.phase === 'done' ? 'done' : 'working', progress: progress(state) };
  } finally {
    state.busyUntil = 0;
    await store.putRecord(deps.pool, sub, 'state', 'current', state);
  }
}

module.exports = { HISTORY_DAYS, ENGINE, READ_SPACING_MS, PASS_BUDGET_MS, MAX_ENRICH_PASSES, listedCompanies, readCompany, publish, progress, runPass, readSecFinancialSummary };
