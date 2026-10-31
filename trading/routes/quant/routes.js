/** CHANGE LOG
 * 2 | maintainer@emeraldcoastsystemsgroup.com | The brief list names the signal it is ranked by and that signal's verdict, and the brief scoreboard carries the test without the biggest winners.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The Quant desk surface, mounted at /api/trading/quant inside the existing Trading route so no authority field changes: read the list, a symbol and the scoreboard, turn the nightly job on or off, and run one bounded pass. The caller is the admitted principal, never a header or body field. Research only.
 */
'use strict';
const desk = require('./desk');
const store = require('./store');

/** The package's person schedule the page activates once the person turns the desk on. */
const QUANT_SCHEDULE = Object.freeze({ app: 'intelligent-trades', name: 'quant-desk', route: '/api/trading/quant/tick' });
const BRIEF_TOP = 20;
const BRIEF_BOTTOM = 5;
const TICKER = /^[A-Z][A-Z0-9.-]{0,9}$/;

/**
 * @description The package logger on the host, or a JSON-lines stderr logger where none resolves (tests).
 * @returns {object} Logger with info and error.
 */
function packageLogger() {
  try { return require('@/shared/logger').createChildLogger({ module: 'trading-quant-routes' }); }
  catch {
    const line = (level) => (fields, message) => process.stderr.write(`${JSON.stringify({ level, module: 'trading-quant-routes', ...fields, message })}\n`);
    return { info: line('info'), error: line('error') };
  }
}
const logger = packageLogger();

/**
 * @description The admitted caller's subject. Never read from a header or a body.
 * @param {object} req - Request.
 * @returns {string|null} The subject.
 */
function callerOf(req) {
  const sub = req && (req.oshalCallerSub || (req.user && req.user.sub) || (req.oidc && req.oidc.user && req.oidc.user.sub));
  return sub ? String(sub) : null;
}

/**
 * @description A short row for the concierge: enough to explain a rank without the raw factor table.
 * @param {object} row - A list row.
 * @returns {object} The brief row.
 */
function briefRow(row) {
  return { rank: row.rank, symbol: row.symbol, score: row.score, price: row.price, chg1d: row.chg1d, held: row.held, reasons: row.reasons, cautions: row.cautions };
}

/**
 * @description Each signal's verdict and headline numbers, without its stress detail or value curve.
 * @param {object|null} history - Stored history test.
 * @returns {object|null} The summary.
 */
function briefHistory(history) {
  if (!history) return null;
  const row = (s) => ({ id: s.id, name: s.name, verdict: s.verdict, months: s.months, from: s.from, to: s.to, annual: s.annual, spyAnnual: s.spyAnnual, listAnnual: s.listAnnual, t: s.t, withoutWinners: s.withoutWinners, maxDrawdown: s.maxDrawdown, spyMaxDrawdown: s.spyMaxDrawdown, year2022: s.stress.year2022, fallingMonths: s.stress.fallingMonths, source: s.source });
  return { at: history.at, symbols: history.symbols, topN: history.topN, signals: history.signals.map(row), marketTiming: row(history.marketTiming), limits: history.limits };
}

/**
 * @description The route handlers as plain functions of (req) to {status, body}, so the router and the tests share them.
 * @param {object} ctx - Route context (pool, intent).
 * @param {object} [overrides] - Test seams for time and SEC reads.
 * @returns {Object<string, Function>} Handlers.
 */
function quantHandlers(ctx, overrides = {}) {
  const deps = () => ({ ctx, pool: ctx.pool, intent: (name, input) => ctx.intent(name, input), time: () => Date.now(), secTickers: desk.secTickers, readSec: desk.readSecFinancialSummary, ...overrides });
  const pool = () => ctx.pool;
  const settingsOf = async (sub) => (await store.getRecord(pool(), sub, 'settings', 'current')) || { enabled: false };
  return {
    async status(sub) {
      const [settings, state, today] = await Promise.all([settingsOf(sub), store.getRecord(pool(), sub, 'state', 'current'), store.getRecord(pool(), sub, 'today', 'current')]);
      return { status: 200, body: { ok: true, researchOnly: true, enabled: settings.enabled === true, schedule: QUANT_SCHEDULE, progress: desk.progress(state), published: today ? { session: today.session, at: today.at, scored: today.scored } : null } };
    },
    async today(sub, req) {
      const today = await store.getRecord(pool(), sub, 'today', 'current');
      if (!today) return { status: 200, body: { ok: true, ready: false, researchOnly: true, message: 'The desk has not published a list yet.' } };
      if ((req.query || {}).view !== 'brief') return { status: 200, body: { ok: true, ready: true, researchOnly: true, ...today } };
      const history = await store.getRecord(pool(), sub, 'history', 'current');
      const leader = history && history.signals.find((s) => s.id === today.rankBy);
      return { status: 200, body: { ok: true, ready: true, researchOnly: true, session: today.session, at: today.at, scored: today.scored, market: today.market, rankedBy: leader ? { id: leader.id, name: leader.name, verdict: leader.verdict } : null, top: today.rows.slice(0, BRIEF_TOP).map(briefRow), weakest: today.rows.slice(-BRIEF_BOTTOM).map(briefRow), holdings: today.holdings, coverage: today.coverage } };
    },
    async symbol(sub, req) {
      const symbol = String(req.params.symbol || '').toUpperCase();
      if (!TICKER.test(symbol)) return { status: 400, body: { error: 'invalid_symbol', message: 'That is not a ticker.' } };
      const today = await store.getRecord(pool(), sub, 'today', 'current');
      const row = today && today.rows.find((r) => r.symbol === symbol);
      if (row) return { status: 200, body: { ok: true, session: today.session, of: today.scored, row } };
      return { status: 200, body: { ok: true, session: today ? today.session : null, row: null, message: `${symbol} is not on today's list: it may be a fund, too new to have a year of prices, or outside the list.` } };
    },
    async scoreboard(sub, req) {
      const [history, forward] = await Promise.all([store.getRecord(pool(), sub, 'history', 'current'), store.getRecord(pool(), sub, 'forward', 'current')]);
      return { status: 200, body: { ok: true, researchOnly: true, history: (req.query || {}).view === 'brief' ? briefHistory(history) : history, forward } };
    },
    async settings(sub, req) {
      const enabled = (req.body || {}).enabled;
      if (typeof enabled !== 'boolean') return { status: 400, body: { error: 'invalid_settings', message: 'Say whether the desk is on: enabled true or false.' } };
      await store.putRecord(pool(), sub, 'settings', 'current', { enabled });
      return { status: 200, body: { ok: true, enabled, schedule: QUANT_SCHEDULE } };
    },
    async run(sub) { return { status: 200, body: { ok: true, ...await desk.runPass(deps(), sub) } }; },
    async tick(sub) {
      if ((await settingsOf(sub)).enabled !== true) return { status: 200, body: { ok: true, status: 'off' } };
      return { status: 200, body: { ok: true, ...await desk.runPass(deps(), sub) } };
    },
  };
}

/**
 * @description Wrap a handler as an Express route: 401 without an admitted caller, the handler's own answer, and a refusal's status and code when it throws.
 * @param {string} name - Handler name (log field).
 * @param {Function} handler - (sub, req) to {status, body}.
 * @returns {Function} Express handler.
 */
function route(name, handler) {
  return async (req, res) => {
    const started = Date.now(), sub = callerOf(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    try {
      const out = await handler(sub, req);
      logger.info({ route: name, status: out.status, durationMs: Date.now() - started }, 'quant route answered');
      res.status(out.status).json(out.body);
    } catch (err) {
      const status = Number(err && err.status) >= 400 && Number(err.status) < 600 ? Number(err.status) : 500;
      logger.error({ err: String(err && err.stack || err).slice(0, 2000), route: name, durationMs: Date.now() - started }, 'quant route failed');
      res.status(status).json({ error: (err && err.code) || 'quant_route_failed', message: err && err.message });
    }
  };
}

/**
 * @description Build the /api/trading/quant router.
 * @param {object} ctx - The per-package route context.
 * @param {() => object} [makeRouter] - Router factory (express.Router on the host; a recording router in tests).
 * @param {object} [overrides] - Test seams for time and SEC reads.
 * @returns {object} The router.
 */
function createTradingQuantRoutes(ctx, makeRouter, overrides) {
  const router = (makeRouter || (() => require('express').Router()))();
  const h = quantHandlers(ctx, overrides);
  router.get('/status', route('status', h.status));
  router.get('/today', route('today', h.today));
  router.get('/symbol/:symbol', route('symbol', h.symbol));
  router.get('/scoreboard', route('scoreboard', h.scoreboard));
  router.post('/settings', route('settings', h.settings));
  router.post('/run', route('run', h.run));
  router.post('/tick', route('tick', h.tick));
  return router;
}

module.exports = { QUANT_SCHEDULE, createTradingQuantRoutes, quantHandlers, callerOf };
