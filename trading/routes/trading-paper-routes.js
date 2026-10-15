/**
 * Native paper autopilot routes (TRADE-01), mounted at /api/trading/paper.
 *
 *   GET  /            the caller's paper book: configuration, account, positions, recent ticks, the schedule to activate
 *   POST /arm         arm (or re-arm) the caller's paper book with its guardrails; the person then activates the schedule
 *   POST /disarm      disarm; positions and history stay
 *   POST /tick        one autopilot tick for the caller (the `paper-autopilot` schedule fires this as the activating person)
 *   GET  /orders      simulated fills, newest first
 *   GET  /decisions   the decision behind each fill, newest first
 *
 * Paper only: the engine prices every fill from the kernel's prices intents and writes it to the
 * caller's own scope. Nothing in this module or routes/paper/ can reach a broker; there is no order
 * placement path to reach. The caller is the admitted principal (req.oshalCallerSub / req.user),
 * never a header or a body field.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial: the native paper autopilot surface over routes/paper/ (arm, disarm, status, tick, fills, decisions).
 *
 * @module trading-paper-routes
 */
'use strict';

const tick = require('./paper/tick');
const store = require('./paper/store');
const { nativeHost } = require('./paper/screen');

/**
 * @description The package logger on the host, or a JSON-lines stderr logger where none resolves (tests).
 * @returns {object} Logger with info/warn/error.
 */
function packageLogger() {
  try { return require('@/shared/logger').createChildLogger({ module: 'trading-paper-routes' }); }
  catch {
    const line = (level) => (fields, message) => process.stderr.write(`${JSON.stringify({ level, module: 'trading-paper-routes', ...(typeof fields === 'object' ? fields : { message: fields }), message })}\n`);
    return { info: line('info'), warn: line('warn'), error: line('error') };
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
 * @description One header value, case-insensitively.
 * @param {object} req - Request.
 * @param {string} name - Lower-case header name.
 * @returns {string|null} The value.
 */
function header(req, name) {
  const headers = (req && req.headers) || {};
  const value = headers[name] ?? headers[Object.keys(headers).find((k) => k.toLowerCase() === name) || ''];
  return value == null ? null : String(value);
}

/**
 * @description The route handlers as plain functions of (ctx, req) → {status, body}, so the router and the tests share them.
 * @param {object} ctx - Route context (pool, intent).
 * @param {() => Date} [clock] - Instant source.
 * @returns {Object<string, Function>} Handlers.
 */
function paperHandlers(ctx, clock = () => new Date()) {
  const deps = { pool: ctx && ctx.pool, intent: ctx && typeof ctx.intent === 'function' ? (name, input) => ctx.intent(name, input) : undefined, newId: ctx && ctx.newId };
  return {
    async status(req) {
      const sub = callerOf(req);
      const [config, account, positions, ticks] = await Promise.all([store.loadConfig(deps.pool, sub), store.loadAccount(deps.pool, sub),
        store.loadPositions(deps.pool, sub), store.listTicks(deps.pool, sub)]);
      return { status: 200, body: { ok: true, native: nativeHost(ctx), armed: Boolean(config && config.armed), config, account, positions,
        ticks, schedule: tick.PAPER_SCHEDULE } };
    },
    async arm(req) { return { status: 200, body: await tick.armPaper(deps, callerOf(req), req.body, clock()) }; },
    async disarm(req) { return { status: 200, body: await tick.disarmPaper(deps, callerOf(req), clock()) }; },
    async tick(req) {
      const trigger = header(req, 'x-oshal-trigger') === 'schedule' ? 'schedule' : 'manual';
      return tick.runTick(deps, callerOf(req), { now: clock(), trigger, runId: header(req, 'x-oshal-run-id') });
    },
    async orders(req) { return { status: 200, body: { ok: true, orders: await store.listOrders(deps.pool, callerOf(req)) } }; },
    async decisions(req) { return { status: 200, body: { ok: true, decisions: await store.listDecisions(deps.pool, callerOf(req)) } }; },
  };
}

/**
 * @description Wrap a handler as an Express route: 401 without an admitted caller, the handler's own answer, and
 * a refusal's status/code (or 500) when it throws.
 * @param {string} name - Handler name (log field).
 * @param {Function} handler - (req) => {status, body}.
 * @returns {Function} Express handler.
 */
function route(name, handler) {
  return async (req, res) => {
    const started = Date.now();
    const sub = callerOf(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    try {
      const out = await handler(req);
      logger.info({ route: name, status: out.status, durationMs: Date.now() - started }, 'paper route answered');
      res.status(out.status).json(out.body);
    } catch (err) {
      const status = Number(err && err.status) >= 400 && Number(err.status) < 500 ? Number(err.status) : 500;
      logger.error({ err, route: name, durationMs: Date.now() - started }, 'paper route failed');
      res.status(status).json({ error: status === 500 ? 'paper_route_failed' : err.code, message: err.message });
    }
  };
}

/**
 * @description Build the /api/trading/paper router.
 * @param {object} ctx - The per-package route context.
 * @param {() => object} [makeRouter] - Router factory (express.Router on the host; a recording router in tests).
 * @returns {object} The router.
 */
function createTradingPaperRoutes(ctx, makeRouter) {
  const router = (makeRouter || (() => require('express').Router()))();
  const h = paperHandlers(ctx);
  router.get('/', route('status', h.status));
  router.post('/arm', route('arm', h.arm));
  router.post('/disarm', route('disarm', h.disarm));
  router.post('/tick', route('tick', h.tick));
  router.get('/orders', route('orders', h.orders));
  router.get('/decisions', route('decisions', h.decisions));
  return router;
}

module.exports = { createTradingPaperRoutes, paperHandlers, callerOf };
