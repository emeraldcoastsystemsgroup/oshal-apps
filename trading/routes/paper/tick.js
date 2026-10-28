/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: one paper autopilot tick for the calling person, and arming. A tick refuses (409 paper_not_armed) unless the person armed their paper book, does nothing outside the New York regular session, reads prices only through the kernel's prices intents (503 prices_unavailable when the host has none or the read fails, with nothing written), plans deterministically, and commits its fills, decisions, positions, account and daily equity in one transaction claimed per five-minute window, so a repeated fire in the same window writes nothing. Arming normalizes the person's guardrails and never activates a schedule itself: the kernel schedule is activated by the person.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Review fixes. A tick reads the account (its version) before the configuration, so a disarm or re-arm that commits between the two reads is either seen as disarmed or fails the version check at write time. Re-arming an open book with a different startingCash is refused (409 paper_book_open) instead of being stored in the configuration while the account kept its old cash; a re-arm that leaves startingCash out keeps the account's own starting cash.
 *
 * @module paper/tick
 */
'use strict';

const { randomUUID } = require('node:crypto');
const store = require('./store');
const { readMarket, regularSession, tickWindow, etParts } = require('./market');
const { planTick } = require('./plan');
const { RISK_POLICIES } = require('./decide');
const { DEFAULT_UNIVERSE } = require('./universe');

/** The package's own schedule the person activates (oshal-app.yaml `schedules:`). */
const PAPER_SCHEDULE = Object.freeze({ app: 'intelligent-trades', name: 'paper-autopilot', route: '/api/trading/paper/tick' });

/** Arming defaults and bounds. */
const DEFAULTS = Object.freeze({ posture: 'balanced', startingCash: 100000, maxShares: 100, maxNotional: 5000, maxOrdersPerTick: 8, maxQuoteAgeMinutes: 20 });
const BOUNDS = Object.freeze({
  startingCash: [1000, 10000000], maxShares: [1, 100000], maxNotional: [100, 10000000], maxOrdersPerTick: [1, 20], maxQuoteAgeMinutes: [1, 120],
});
const UNIVERSE_MAX = 200;
const TICKER = /^[A-Z][A-Z0-9.-]{0,11}$/;

/**
 * @description An error that carries its HTTP status and code to the route.
 * @param {number} status - HTTP status.
 * @param {string} code - Error code.
 * @param {string} message - One sentence for the person.
 * @returns {Error} The error.
 */
function refusal(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

/**
 * @description Read one bounded number from the arm body (absent = the current or default value; out of range = refused).
 * @param {object} body - Request body.
 * @param {string} key - Field.
 * @param {object} base - Values an absent field keeps.
 * @returns {number} The value.
 */
function bounded(body, key, base) {
  if (body[key] === undefined || body[key] === null || body[key] === '') return base[key];
  const value = Number(body[key]);
  const [lo, hi] = BOUNDS[key];
  if (!Number.isFinite(value) || value < lo || value > hi) throw refusal(400, 'invalid_paper_config', `${key} must be between ${lo} and ${hi}.`);
  return key === 'maxNotional' || key === 'startingCash' ? Math.round(value * 100) / 100 : Math.floor(value);
}

/**
 * @description Validate and normalize the arm request into a paper configuration. A field the request leaves
 * out keeps the person's current value (re-arming changes nothing it does not name), else the default.
 * @param {object} body - Request body ({posture?, startingCash?, maxShares?, maxNotional?, maxOrdersPerTick?, maxQuoteAgeMinutes?, universe?}).
 * @param {object|null} [current] - The stored configuration, if any.
 * @returns {object} The configuration to store.
 */
function normalizeConfig(body, current = null) {
  const b = body && typeof body === 'object' ? body : {};
  const base = { ...DEFAULTS, ...Object.fromEntries(Object.entries(current || {}).filter(([, v]) => v != null)) };
  const posture = b.posture == null || b.posture === '' ? base.posture : String(b.posture).toLowerCase();
  if (!RISK_POLICIES[posture]) throw refusal(400, 'invalid_paper_config', `posture must be one of ${Object.keys(RISK_POLICIES).join(', ')}.`);
  let universe = current && Array.isArray(current.universe) ? current.universe : null;
  if (Array.isArray(b.universe) && b.universe.length) {
    universe = [...new Set(b.universe.map((s) => String(s).trim().toUpperCase()).filter(Boolean))];
    if (universe.length > UNIVERSE_MAX) throw refusal(400, 'universe_too_large', `A pinned universe holds at most ${UNIVERSE_MAX} tickers.`);
    const bad = universe.find((s) => !TICKER.test(s));
    if (bad) throw refusal(400, 'invalid_paper_config', `${bad} is not a ticker.`);
  }
  const out = { posture, universe };
  for (const key of Object.keys(BOUNDS)) out[key] = bounded(b, key, base);
  return out;
}

/**
 * @description Arm the person's paper book (re-arming keeps the existing cash and positions, so a different
 * startingCash on an open book is refused).
 * @param {{pool:object}} deps - Package SQL pool.
 * @param {string} sub - Caller subject.
 * @param {object} body - Arm request body.
 * @param {Date} now - Instant.
 * @returns {Promise<object>} The saved configuration and the schedule the person activates.
 */
async function armPaper(deps, sub, body, now) {
  const [current, account] = await Promise.all([store.loadConfig(deps.pool, sub), store.loadAccount(deps.pool, sub)]);
  // An open book's starting cash is fixed: the account keeps its cash across re-arms, so the config must agree.
  const base = account ? { ...(current || {}), startingCash: account.startingCash } : current;
  const config = normalizeConfig(body, base);
  if (account && config.startingCash !== account.startingCash) {
    throw refusal(409, 'paper_book_open', `This paper book is already open with a starting cash of ${account.startingCash}; re-arming keeps its cash and positions, so startingCash cannot change.`);
  }
  await store.arm(deps.pool, sub, config, now.toISOString());
  return { ok: true, armed: true, config: await store.loadConfig(deps.pool, sub), account: await store.loadAccount(deps.pool, sub), schedule: PAPER_SCHEDULE };
}

/**
 * @description Disarm the person's paper book; history and open positions stay as they are.
 * @param {{pool:object}} deps - Package SQL pool.
 * @param {string} sub - Caller subject.
 * @param {Date} now - Instant.
 * @returns {Promise<object>} Whether a configuration was disarmed.
 */
async function disarmPaper(deps, sub, now) {
  const changed = await store.disarm(deps.pool, sub, now.toISOString());
  return { ok: true, armed: false, changed: changed > 0, schedule: PAPER_SCHEDULE };
}

/**
 * @description Run one paper tick for the calling person.
 * @param {{pool:object, intent?:Function, newId?:Function}} deps - Package SQL pool, the kernel intent call, an id source.
 * @param {string} sub - Caller subject (the schedule fires as the activating person).
 * @param {{now:Date, trigger:string, runId:string|null}} opts - Tick instant and provenance.
 * @returns {Promise<{status:number, body:object}>} The route answer.
 */
async function runTick(deps, sub, opts) {
  const { now } = opts;
  const window = tickWindow(now);
  // Account (and so its version) first: an arm or disarm committing after this read moves the version, so
  // either the configuration read below already sees it or the write's version check refuses the tick.
  const account = await store.loadAccount(deps.pool, sub);
  const config = account ? await store.loadConfig(deps.pool, sub) : null;
  if (!config || !config.armed || !account) {
    return { status: 409, body: { error: 'paper_not_armed', message: 'The paper autopilot is not armed for this person. Arm it before the schedule can trade.' } };
  }
  if (!regularSession(now)) return { status: 200, body: { ok: true, skipped: 'market_closed', window } };
  if (account.lastTickWindow === window) return { status: 200, body: { ok: true, skipped: 'already_ticked', window } };
  if (typeof deps.intent !== 'function') {
    return { status: 503, body: { error: 'prices_unavailable', message: 'This host has no kernel price service; nothing was traded.' } };
  }
  const positions = await store.loadPositions(deps.pool, sub);
  const symbols = [...new Set([...positions.map((p) => p.symbol), ...(config.universe || DEFAULT_UNIVERSE)])];
  let market;
  try { market = await (deps.readMarket || readMarket)(deps.intent, symbols, now); }
  catch (err) {
    return { status: 503, body: { error: 'prices_unavailable', message: `The kernel price read failed; nothing was traded (${String(err && err.message || err).slice(0, 200)}).` } };
  }
  const plan = planTick({ config, account, positions, market, now });
  if(market.source)Object.assign(plan.summary,{priceSource:market.source,marketErrors:market.errors||[],unscanned:market.unscanned||[]});
  const newId = deps.newId || randomUUID;
  const ids = plan.fills.map(() => ({ orderId: newId(), decisionId: newId() }));
  const result = await store.writeTick(deps.pool, sub, { window, trigger: opts.trigger, runId: opts.runId, at: now.toISOString(),
    sessionDate: etParts(now).date, plan, account, ids, previousSymbols: positions.map((p) => p.symbol) });
  if (!result.written) return { status: 200, body: { ok: true, skipped: result.reason, window } };
  return { status: 200, body: { ok: true, window, trigger: opts.trigger, equity: plan.equity, cash: plan.cash, summary: plan.summary,
    orders: plan.fills.map((f, i) => ({ orderId: ids[i].orderId, decisionId: ids[i].decisionId, symbol: f.symbol, side: f.side, qty: f.qty,
      fillPrice: f.price, reason: f.reason, realizedPl: f.realizedPl, status: 'filled' })) } };
}

module.exports = { runTick, armPaper, disarmPaper, normalizeConfig, PAPER_SCHEDULE, DEFAULTS };
