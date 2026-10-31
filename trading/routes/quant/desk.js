/** CHANGE LOG
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Pace price reads to 75 a minute: the desk shares Schwab's request limit with the watcher, which also checks stops after hours, and research must never crowd out a stop.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | A release that changes how results are worked out republishes the night's results from the stored prices, without reading them again.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The history test now runs first so the list is led by the signal with the best evidence, and a symbol whose long history holds one bad candle (DVN on the first real run) retries a shorter window instead of leaving the list.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The Quant desk's nightly pipeline, one bounded pass at a time: read ten years of daily closes for the list, publish the ranked list, history test and scoreboard, then add SEC filings and earnings dates and publish again. Read-only market intents only; no module here can reach an order.
 */
'use strict';
const store = require('./store');
const { digestBars } = require('./factors');
const { buildToday, FUNDS } = require('./rank');
const { historyTest, leadingSignal } = require('./history');
const { makeCohort, gradeCohort, forwardBoard } = require('./scoreboard');
const { DEFAULT_UNIVERSE } = require('../paper/universe');
const { lastCompletedSession } = require('../trading-portfolio-calendar');
const { readCongressCandidates } = require('../trading-congress-candidates');
const { readSecFinancialSummary } = require('../trading-sec-financial-reader');
const { cikFromTickerTable, EDGAR_TICKERS_URL, EDGAR_UA } = require('../trading-edgar-filings');

const HISTORY_DAYS = 4000;
/** Raise when results are worked out differently: the night's list is republished from the stored prices. */
const ENGINE = 3;
/** Shorter windows to try when one old candle in the long window is unusable. */
const SHORTER_WINDOWS = Object.freeze([1500, 400]);
const PASS_BUDGET_MS = 40000;
const BUSY_MS = 55000;
const SCORE_RESERVE_MS = 12000;
const MAX_ENRICH_PASSES = 6;
/** A slow SEC read can take 30 seconds; none starts so late that it could outlast the kernel's 60-second call limit. */
const SEC_RESERVE_MS = 15000;
const FUND_TTL_MS = 30 * 86400000;
const EARNINGS_SHORTLIST = 40;
const EARNINGS_BUDGET_MS = 10000;
const MAX_LIST = 300;
const DUST_USD = 100;
const TICKER = /^[A-Z][A-Z0-9.-]{0,9}$/;
/** At most 75 reads a minute, well inside Schwab's limit of about 120, which the watcher shares. */
const READ_SPACING_MS = 800;
const RATE_LIMITED = /\b429\b|rate.?limit|too many requests|throttl/i;

/**
 * @description The person's holdings by symbol, ignoring dust too small to matter.
 * @param {Function} intent - Kernel intent call.
 * @returns {Promise<Array<object>>} Holdings with their total value and accounts.
 */
async function readHoldings(intent) {
  const answer = await intent('trading.accounts', {});
  const out = new Map();
  for (const account of answer.accounts || []) {
    for (const p of account.positions || []) {
      const symbol = String(p.symbol || '').toUpperCase(), value = Number(p.marketValue) || 0;
      if (!symbol || value < DUST_USD) continue;
      const held = out.get(symbol) || { symbol, marketValue: 0, accounts: [] };
      held.marketValue = Math.round((held.marketValue + value) * 100) / 100;
      if (account.accountMasked) held.accounts.push(account.accountMasked);
      out.set(symbol, held);
    }
  }
  return [...out.values()];
}

/**
 * @description Congress purchases of the last 90 days by symbol.
 * @param {object} ctx - Route context.
 * @param {Date} now - Instant.
 * @returns {Promise<Array<object>>} Buyers and latest disclosure per symbol.
 */
async function readCongress(ctx, now) {
  const { candidates } = await readCongressCandidates(ctx, now);
  return candidates.map((c) => ({ symbol: c.symbol, buyers: c.distinctBuyers, latest: c.latestDisclosure }));
}

/**
 * @description Build tonight's list: SPY, holdings, the watchlist, Congress purchases and the broad list. Each outside read may fail on its own.
 * @param {object} deps - {ctx, pool, intent, log}.
 * @param {string} sub - Owner.
 * @param {Date} now - Instant.
 * @returns {Promise<object>} The symbols and the inputs read on the way.
 */
async function buildUniverse(deps, sub, now) {
  const notes = [];
  const attempt = async (label, read, fallback) => { try { return await read(); } catch (err) { notes.push(`${label} unavailable: ${String(err && err.message || err).slice(0, 160)}`); return fallback; } };
  const holdings = await attempt('Holdings', () => readHoldings(deps.intent), []);
  const watchlist = await attempt('Watchlist', async () => (await deps.pool.query('SELECT symbol FROM oshal_trading_watchlist WHERE user_sub=$1', [sub])).rows.map((r) => String(r.symbol).toUpperCase()), []);
  const congress = await attempt('Congress disclosures', () => readCongress(deps.ctx, now), []);
  const wanted = ['SPY', ...holdings.map((h) => h.symbol), ...watchlist, ...congress.map((c) => c.symbol), ...DEFAULT_UNIVERSE];
  const symbols = [...new Set(wanted)].filter((s) => TICKER.test(s) && (s === 'SPY' || !FUNDS.has(s))).slice(0, MAX_LIST);
  return { symbols, holdings, congress, notes };
}

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
  await store.putRecord(deps.pool, sub, 'bars', symbol, digest, now);
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
 * @description Read closes until the list is done or the pass runs out of time.
 * @param {object} deps - Pass dependencies.
 * @param {string} sub - Owner.
 * @param {object} state - Pipeline state; its cursor advances.
 * @param {number} deadline - Epoch milliseconds to stop by.
 * @returns {Promise<boolean>} Whether the whole list has been read.
 */
async function scan(deps, sub, state, deadline) {
  while (state.cursor < state.symbols.length && deps.time() < deadline) {
    const symbol = state.symbols[state.cursor], readStarted = deps.time();
    try {
      if (!(await readSymbol(deps, sub, symbol, state.session, new Date(deps.time())))) state.noData.push(symbol);
    } catch (err) {
      const message = String(err && err.message || err);
      if (RATE_LIMITED.test(message)) { state.note = 'Schwab asked us to slow down; continuing on the next pass.'; return false; }
      // SPY is read first and everything is measured against it: stop here and retry on the next pass.
      if (symbol === 'SPY') throw Object.assign(new Error(`SPY's price history could not be read, so nothing was scored: ${message.slice(0, 200)}`), { status: 502, code: 'quant_prices_unavailable' });
      state.noData.push(symbol);
      state.lastReadError = `${symbol}: ${message.slice(0, 160)}`;
    }
    state.cursor += 1;
    await (deps.pause || pause)(READ_SPACING_MS - (deps.time() - readStarted));
    if (state.cursor % 10 === 0) await store.putRecord(deps.pool, sub, 'state', 'current', state);
  }
  return state.cursor >= state.symbols.length;
}

/**
 * @description Close prices by date for every digest.
 * @param {Array<object>} digests - Stored digests.
 * @returns {Map<string, Map<string, number>>} Close by date by symbol.
 */
function closeMaps(digests) {
  return new Map(digests.map((d) => [d.symbol, new Map(d.recent.d.map((day, i) => [day, d.recent.c[i]]))]));
}

/**
 * @description Publish today's list, the history test and the scoreboard from the stored digests.
 * @param {object} deps - Pass dependencies.
 * @param {string} sub - Owner.
 * @param {object} state - Pipeline state.
 * @returns {Promise<object>} Today's list.
 */
async function publish(deps, sub, state) {
  const at = new Date(deps.time()).toISOString(), wanted = new Set(state.symbols);
  const digests = (await store.listRecords(deps.pool, sub, 'bars')).filter((d) => wanted.has(d.symbol));
  const funds = new Map((await store.listRecords(deps.pool, sub, 'fund')).filter((f) => f.revenueYoYPct != null || f.netMarginPct != null).map((f) => [f.symbol, f]));
  const history = historyTest(digests, at), leader = leadingSignal(history.signals);
  const today = buildToday({
    session: state.session, at, digests, funds, noData: state.noData, rankBy: leader.id,
    congress: new Map(state.congress.map((c) => [c.symbol, c])),
    earnings: new Map(Object.entries(state.earnings || {})),
    holdings: new Map(state.holdings.map((h) => [h.symbol, h])),
  });
  await store.putRecord(deps.pool, sub, 'today', 'current', today);
  await store.putRecord(deps.pool, sub, 'history', 'current', history);
  const cohort = { ...makeCohort(state.session, today.rows), rankBy: leader.id };
  const previous = await store.getRecord(deps.pool, sub, 'cohort', state.session);
  await store.putRecord(deps.pool, sub, 'cohort', state.session, { ...cohort, graded: previous ? previous.graded : {} });
  const cohorts = await store.listRecords(deps.pool, sub, 'cohort'), closes = closeMaps(digests), spy = digests.find((d) => d.symbol === 'SPY');
  for (const stored of cohorts) if (spy && gradeCohort(stored, closes, spy.recent.d)) await store.putRecord(deps.pool, sub, 'cohort', stored.session, stored);
  await store.putRecord(deps.pool, sub, 'forward', 'current', forwardBoard(cohorts, at));
  return today;
}

/**
 * @description The SEC's ticker table for CIK lookups.
 * @returns {Promise<object>} The parsed table.
 */
async function secTickers() {
  const response = await fetch(EDGAR_TICKERS_URL, { headers: { 'User-Agent': EDGAR_UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`SEC ticker table unavailable (HTTP ${response.status}).`);
  return response.json();
}

/**
 * @description Next earnings dates for the top of the list and the person's holdings.
 * @param {object} deps - Pass dependencies.
 * @param {Array<string>} symbols - Names to look up.
 * @param {number} deadline - Epoch milliseconds to stop by.
 * @returns {Promise<Object<string,string>>} Date by symbol.
 */
async function readEarnings(deps, symbols, deadline) {
  const out = {};
  for (const symbol of symbols) {
    if (deps.time() >= deadline) break;
    try {
      const events = await deps.intent('feeds.events', { days: 45, entity: `world:ticker:${symbol.toLowerCase()}` });
      const hit = (Array.isArray(events) ? events : []).find((e) => e.eventType === 'earnings' && e.scheduledAt);
      if (hit) out[symbol] = String(hit.scheduledAt).slice(0, 10);
    } catch { /* A missing calendar row is no caution; nothing is invented. */ }
  }
  return out;
}

/**
 * @description Read stale SEC filings, best-ranked names first, until time runs out. A company with no usable filing is remembered too.
 * @param {object} deps - Pass dependencies.
 * @param {string} sub - Owner.
 * @param {Array<string>} order - Symbols in priority order.
 * @param {number} deadline - Epoch milliseconds to stop by.
 * @returns {Promise<{read:number, remaining:number}>} How many filings were read and how many are still stale.
 */
async function readFundamentals(deps, sub, order, deadline) {
  const known = new Map((await store.listRecords(deps.pool, sub, 'fund')).map((f) => [f.symbol, f]));
  const stale = order.filter((s) => !known.has(s) || deps.time() - Date.parse(known.get(s).at) > FUND_TTL_MS);
  if (!stale.length) return { read: 0, remaining: 0 };
  const table = await deps.secTickers();
  let read = 0;
  for (const symbol of stale) {
    if (deps.time() + SEC_RESERVE_MS >= deadline) break;
    let value = { symbol, at: new Date(deps.time()).toISOString(), revenueYoYPct: null, netMarginPct: null };
    try {
      const cik = cikFromTickerTable(table, symbol);
      if (cik) {
        const s = await deps.readSec(cik, symbol);
        value = { ...value, revenueYoYPct: s.revenueYoYPct, netMarginPct: s.netMarginPct, fiscalYearEnd: s.period && s.period.end };
      }
    } catch (err) { value.error = String(err && err.message || err).slice(0, 120); }
    await store.putRecord(deps.pool, sub, 'fund', symbol, value);
    read += 1;
  }
  return { read, remaining: stale.length - read };
}

/**
 * @description One enrichment pass: earnings dates for the shortlist, then SEC filings in rank order.
 * @param {object} deps - Pass dependencies.
 * @param {string} sub - Owner.
 * @param {object} state - Pipeline state.
 * @param {number} deadline - Epoch milliseconds to stop by.
 * @returns {Promise<void>}
 */
async function enrich(deps, sub, state, deadline) {
  const today = await store.getRecord(deps.pool, sub, 'today', 'current');
  const ranked = today ? today.rows.map((r) => r.symbol) : [];
  const held = state.holdings.map((h) => h.symbol).filter((s) => !FUNDS.has(s));
  if (!state.earnings) state.earnings = await readEarnings(deps, [...new Set([...held, ...ranked.slice(0, EARNINGS_SHORTLIST)])], Math.min(deadline, deps.time() + EARNINGS_BUDGET_MS));
  state.secRemaining = 0;
  try {
    const { read, remaining } = await readFundamentals(deps, sub, [...new Set([...held, ...ranked])], deadline);
    state.secRead = (state.secRead || 0) + read;
    state.secRemaining = remaining;
  } catch (err) { state.note = `SEC filings unavailable: ${String(err && err.message || err).slice(0, 160)}`; }
  state.enrichPasses += 1;
}

/**
 * @description A fresh pipeline state for a new session, or the reason there cannot be one.
 * @param {object} deps - Pass dependencies.
 * @param {string} sub - Owner.
 * @param {string} session - Last completed session.
 * @param {Date} now - Instant.
 * @returns {Promise<object>} The state.
 */
async function startSession(deps, sub, session, now) {
  const { symbols, holdings, congress, notes } = await buildUniverse(deps, sub, now);
  return { session, startedAt: now.toISOString(), phase: 'scan', cursor: 0, symbols, holdings, congress, notes, noData: [], enrichPasses: 0, passes: 0 };
}

/**
 * @description Advance the pipeline until it finishes or the pass runs out of time.
 * @param {object} deps - Pass dependencies.
 * @param {string} sub - Owner.
 * @param {object} state - Pipeline state.
 * @param {number} deadline - Epoch milliseconds to stop by.
 * @returns {Promise<void>}
 */
async function advance(deps, sub, state, deadline) {
  if (state.phase === 'scan' && await scan(deps, sub, state, deadline)) state.phase = 'publish';
  if (state.phase === 'publish' && deps.time() + SCORE_RESERVE_MS < deadline + 15000) {
    await publish(deps, sub, state);
    state.publishedAt = new Date(deps.time()).toISOString();
    state.phase = 'enrich';
    await store.putRecord(deps.pool, sub, 'state', 'current', state);
  }
  if (state.phase === 'enrich' && deps.time() + SCORE_RESERVE_MS < deadline) {
    await enrich(deps, sub, state, deadline);
    if (state.enrichPasses >= MAX_ENRICH_PASSES || state.secRemaining === 0) state.phase = 'final';
  }
  if (state.phase === 'final' && deps.time() + SCORE_RESERVE_MS < deadline + 15000) {
    await publish(deps, sub, state);
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
  return { session: state.session, phase: state.phase, read: state.cursor, total: state.symbols.length, noData: state.noData.length, secRead: state.secRead || 0, publishedAt: state.publishedAt || null, note: state.note || null, notes: state.notes || [] };
}

/**
 * @description Run one bounded pass. Safe to call any time: finished work is not repeated and a pass already running is left alone.
 * @param {object} deps - {ctx, pool, intent, time, secTickers, readSec}.
 * @param {string} sub - Owner.
 * @returns {Promise<object>} {status, progress, message?}.
 */
async function runPass(deps, sub) {
  const now = new Date(deps.time()), session = lastCompletedSession(now);
  let state = await store.getRecord(deps.pool, sub, 'state', 'current');
  if (state && state.session === session && state.phase === 'done') {
    if (state.engine === ENGINE) return { status: 'done', progress: progress(state) };
    state.phase = 'final';
  }
  if (state && state.busyUntil > deps.time()) return { status: 'busy', progress: progress(state) };
  let configured = false;
  try { configured = (await deps.intent('trading.config', {})).configured === true; } catch { configured = false; }
  if (!configured) return { status: 'needs-schwab', message: 'The Quant desk reads ten years of daily prices from a connected Schwab login. Connect Schwab in Settings, Connections.', progress: progress(state) };
  if (!state || state.session !== session) state = await startSession(deps, sub, session, now);
  state.engine = ENGINE;
  state.busyUntil = deps.time() + BUSY_MS;
  state.passes += 1;
  state.note = null;
  await store.putRecord(deps.pool, sub, 'state', 'current', state);
  try {
    await advance(deps, sub, state, deps.time() + PASS_BUDGET_MS);
    return { status: state.phase === 'done' ? 'done' : 'working', progress: progress(state) };
  } finally {
    state.busyUntil = 0;
    await store.putRecord(deps.pool, sub, 'state', 'current', state);
  }
}

module.exports = { HISTORY_DAYS, ENGINE, READ_SPACING_MS, PASS_BUDGET_MS, MAX_ENRICH_PASSES, buildUniverse, publish, progress, runPass, secTickers, readSecFinancialSummary };
