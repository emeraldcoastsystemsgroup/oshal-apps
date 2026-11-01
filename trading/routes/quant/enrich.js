/** CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | What the desk reads about a company after scoring it: earnings dates for the shortlist, the industry each company reports to the SEC, and its latest annual filing. Moved out of the pipeline and split across passes, because at thousands of names it takes several nights to read them all and a pass must stay short. Best-ranked names are read first.
 */
'use strict';
const store = require('./store');
const { FUNDS } = require('./rank');
const { EDGAR_UA } = require('../trading-edgar-filings');

const FUND_TTL_MS = 30 * 86400000;
/** A company rarely changes industry. */
const COMPANY_TTL_MS = 180 * 86400000;
/** A failed read is tried again sooner than a good one is refreshed. */
const RETRY_TTL_MS = 3 * 86400000;
const EARNINGS_SHORTLIST = 40;
const EARNINGS_BUDGET_MS = 6000;
const SEC_THROTTLED = /\b(429|403)\b|rate.?limit|too many requests/i;

/**
 * @description The industry a company reports to the SEC.
 * @param {string} cik - Ten-digit company number.
 * @returns {Promise<{sic:string|null}>} Its SIC code.
 */
async function readCompany(cik) {
  const response = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers: { 'User-Agent': EDGAR_UA, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`SEC company record unavailable (HTTP ${response.status}).`);
  const body = await response.json();
  return { sic: body.sic ? String(body.sic) : null };
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
 * @description The names whose record of a kind is missing or too old, in the order given.
 * @param {object} deps - Pass dependencies.
 * @param {string} sub - Owner.
 * @param {string} kind - Record kind.
 * @param {Array<string>} order - Names in priority order.
 * @param {number} ttl - How long a good record lasts.
 * @returns {Promise<string[]>} The stale names.
 */
async function staleNames(deps, sub, kind, order, ttl) {
  const known = new Map((await store.listRecords(deps.pool, sub, kind)).map((r) => [r.symbol, r]));
  return order.filter((s) => { const r = known.get(s); return !r || deps.time() - Date.parse(r.at) > (r.error ? RETRY_TTL_MS : ttl); });
}

/**
 * @description One company's latest annual filing, as a record.
 * @param {object} deps - Pass dependencies.
 * @param {string} symbol - Ticker.
 * @param {string} cik - Ten-digit company number.
 * @returns {Promise<object>} What to store.
 */
async function filingRecord(deps, symbol, cik) {
  const s = await deps.readSec(cik, symbol);
  return { revenueYoYPct: s.revenueYoYPct, netMarginPct: s.netMarginPct, fiscalYearEnd: s.period && s.period.end };
}

/**
 * @description Read stale records until the pass runs out of time. A name with no SEC number, such as a fund, is remembered without a read; a refusal for reading too fast ends the pass with nothing stored.
 * @param {object} deps - Pass dependencies.
 * @param {string} sub - Owner.
 * @param {object} job - {kind, names, read:(symbol, cik) => fields}.
 * @param {Object<string,string>} ciks - Company number by ticker.
 * @param {number} deadline - Epoch milliseconds to stop by.
 * @returns {Promise<number>} How many records were written.
 */
async function readStale(deps, sub, job, ciks, deadline) {
  let done = 0;
  for (const symbol of job.names) {
    if (deps.time() >= deadline) break;
    let value = { symbol, at: new Date(deps.time()).toISOString() };
    try {
      if (ciks[symbol]) value = { ...value, ...await job.read(symbol, ciks[symbol]) };
    } catch (err) {
      const message = String(err && err.message || err);
      if (SEC_THROTTLED.test(message)) break;
      value.error = message.slice(0, 120);
    }
    await store.putRecord(deps.pool, sub, job.kind, symbol, value);
    done += 1;
  }
  return done;
}

/**
 * @description One enrichment pass: earnings dates once, then industries and filings taking turns, so neither waits nights for the other.
 * @param {object} deps - Pass dependencies.
 * @param {string} sub - Owner.
 * @param {object} state - Pipeline state.
 * @param {number} deadline - Epoch milliseconds to stop by.
 * @returns {Promise<void>}
 */
async function enrichPass(deps, sub, state, deadline) {
  const rows = (await store.getRecord(deps.pool, sub, 'rows', 'current')) || [];
  const ranked = rows.map((r) => r.symbol), held = state.holdings.map((h) => h.symbol).filter((s) => !FUNDS.has(s));
  if (!state.earnings) state.earnings = await readEarnings(deps, [...new Set([...held, ...ranked.slice(0, EARNINGS_SHORTLIST)])], Math.min(deadline, deps.time() + EARNINGS_BUDGET_MS));
  const order = [...new Set([...held, ...ranked])];
  const { ciks } = (await store.getRecord(deps.pool, sub, 'directory', 'current')) || { ciks: {} };
  const industries = { kind: 'company', names: await staleNames(deps, sub, 'company', order, COMPANY_TTL_MS), read: (_s, cik) => deps.readCompany(cik) };
  const filings = { kind: 'fund', names: await staleNames(deps, sub, 'fund', order, FUND_TTL_MS), read: (symbol, cik) => filingRecord(deps, symbol, cik) };
  const [first, second] = state.enrichPasses % 2 === 0 ? [industries, filings] : [filings, industries];
  const job = first.names.length ? first : second, done = await readStale(deps, sub, job, ciks, deadline);
  if (job === filings) state.secRead = (state.secRead || 0) + done;
  state.secRemaining = filings.names.length - (job === filings ? done : 0);
  state.companiesRemaining = industries.names.length - (job === industries ? done : 0);
  state.enrichPasses += 1;
}

module.exports = { readCompany, readEarnings, staleNames, readStale, enrichPass };
