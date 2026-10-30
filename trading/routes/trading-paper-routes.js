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
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | GET /books also returns the reference book, each book's last tick and when the person's paper schedule last ran a tick, so the concierge can say whether a paper account it started is trading.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | POST /books/:ref/strategy runs a saved portfolio strategy on a paper account (or clears it with no strategyId) and arms it; GET /books names each account's strategy.
 *
 * @module trading-paper-routes
 */
'use strict';

const tick = require('./paper/tick');
const store = require('./paper/store');
const books = require('./paper/books');
const paperStrategy = require('./paper/strategy');
const reports = require('./paper/report');
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
 * @description The newest recorded tick in plain fields, or null when the book has never ticked.
 * @param {Array<object>} ticks - Ticks, newest first.
 * @returns {{at:string, trigger:string, outcome:string, orders:number}|null} The tick.
 */
function lastTick(ticks) {
  const t = ticks && ticks[0];
  return t ? { at: t.created_at, trigger: t.trigger_kind, outcome: t.outcome, orders: t.order_count } : null;
}

/**
 * @description The route handlers as plain functions of (ctx, req) → {status, body}, so the router and the tests share them.
 * @param {object} ctx - Route context (pool, intent).
 * @param {() => Date} [clock] - Instant source.
 * @returns {Object<string, Function>} Handlers.
 */
function paperHandlers(ctx, clock = () => new Date()) {
  const deps = { pool: ctx && ctx.pool, intent: ctx && typeof ctx.intent === 'function' ? (name, input) => ctx.intent(name, input) : undefined, newId: ctx && ctx.newId,readMarket:require('./paper/native-market').nativePaperMarket };
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
      const opts={ now: clock(), trigger, runId: header(req, 'x-oshal-run-id') };
      const out=await tick.runTick(deps,callerOf(req),opts);
      const namedBooks=await books.tickBooks(deps,callerOf(req),opts);
      return namedBooks.length?{status:200,body:{...out.body,namedBooks}}:out;
    },
    async books(req){
      const sub=callerOf(req),rows=await books.listBooks(deps.pool,sub);
      const read=async pool=>{const [account,config,ticks]=await Promise.all([store.loadAccount(pool,sub),store.loadConfig(pool,sub),store.listTicks(pool,sub)]);return {account,config,ticks};};
      const [reference,...named]=await Promise.all([read(deps.pool),...rows.map(b=>read(books.bookPool(deps.pool,b.book_ref)))]);
      const assigned=await Promise.all(rows.map(b=>paperStrategy.assignmentOf(deps,sub,b.book_ref)));
      const accounts=rows.map((b,i)=>({...b,account:named[i].account,config:named[i].config,lastTick:lastTick(named[i].ticks),
        strategy:assigned[i]?{strategyId:assigned[i].strategyId,strategyName:assigned[i].strategyName,symbols:assigned[i].symbols,assignedAt:assigned[i].assignedAt,lastDecisionAsOf:assigned[i].lastDecisionAsOf,lastResult:assigned[i].lastResult}:null}));
      // Only the person's activated paper-autopilot schedule writes 'schedule' ticks, so the newest one says whether it runs.
      const times=[reference,...named].flatMap(r=>r.ticks.filter(t=>t.trigger_kind==='schedule')).map(t=>new Date(t.created_at).getTime()).filter(Number.isFinite);
      const scheduled=times.length?new Date(Math.max(...times)).toISOString():null;
      return {status:200,body:{ok:true,accounts,reference:{account:reference.account,config:reference.config,lastTick:lastTick(reference.ticks)},paperSchedule:{...tick.PAPER_SCHEDULE,lastScheduledTickAt:scheduled},simulated:true}};
    },
    async createBook(req){return {status:200,body:await books.createBook(deps,callerOf(req),req.body,clock())};},
    async reset(req){return {status:200,body:await books.resetPaper(deps,callerOf(req),req.body,clock())};},
    async book(req){
      const sub=callerOf(req),book=await books.getBook(deps.pool,sub,req.params.ref),pool=books.bookPool(deps.pool,book.book_ref);
      const [account,config,positions,orders,decisions,ticks,series]=await Promise.all([store.loadAccount(pool,sub),store.loadConfig(pool,sub),store.loadPositions(pool,sub),store.listOrders(pool,sub),store.listDecisions(pool,sub),store.listTicks(pool,sub),store.equitySeries(pool,sub)]);
      return {status:200,body:{ok:true,book,account,config,positions,orders,decisions,ticks,series,simulated:true}};
    },
    async bookArm(req){const sub=callerOf(req),ref=req.params.ref,book=await books.getBook(deps.pool,sub,ref);if(book.archived===true||book.archived==='t')return {status:409,body:{error:'paper_archived',message:'Restore this archived account before starting it.'}};return {status:200,body:await tick.armPaper({...deps,pool:books.bookPool(deps.pool,ref)},sub,req.body,clock())};},
    async bookStrategy(req){
      const sub=callerOf(req),ref=req.params.ref,book=await books.getBook(deps.pool,sub,ref),id=req.body&&req.body.strategyId;
      if(book.archived===true||book.archived==='t')return {status:409,body:{error:'paper_archived',message:'Restore this archived account before giving it a strategy.'}};
      if(!id)return {status:200,body:{ok:true,cleared:await paperStrategy.clearStrategy(deps,sub,ref)}};
      const assignment=await paperStrategy.assignStrategy(deps,sub,book,String(id),clock());
      // Running a strategy is the decision to trade it: the account is armed with the strategy's symbols.
      const armed=await tick.armPaper({...deps,pool:books.bookPool(deps.pool,ref)},sub,{universe:assignment.symbols},clock());
      return {status:200,body:{ok:true,strategy:{strategyId:assignment.strategyId,strategyName:assignment.strategyName,symbols:assignment.symbols,targets:assignment.preview.targets,decisionAsOf:assignment.preview.decisionAsOf},config:armed.config,schedule:armed.schedule}};
    },
    async bookDisarm(req){const sub=callerOf(req),ref=req.params.ref;await books.getBook(deps.pool,sub,ref);return {status:200,body:await tick.disarmPaper({...deps,pool:books.bookPool(deps.pool,ref)},sub,clock())};},
    async bookArchive(req){return {status:200,body:await books.setArchived(deps,callerOf(req),req.params.ref,true,clock())};},
    async bookRestore(req){return {status:200,body:await books.setArchived(deps,callerOf(req),req.params.ref,false,clock())};},
    async reports(req){return {status:200,body:{ok:true,reports:await reports.listReports(deps.pool,callerOf(req))}};},
    async report(req){return {status:200,body:{ok:true,report:await reports.generateReport(ctx,callerOf(req),clock(),{scheduled:header(req,'x-oshal-trigger')==='schedule'})}};},
    async presenter(req){return {status:200,body:await reports.savePreferences(deps.pool,callerOf(req),req.body,clock())};},
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
  router.get('/books',route('books',h.books));
  router.post('/books',route('create-book',h.createBook));
  router.post('/reset',route('reset',h.reset));
  router.get('/books/:ref',route('book',h.book));
  router.post('/books/:ref/arm',route('book-arm',h.bookArm));
  router.post('/books/:ref/disarm',route('book-disarm',h.bookDisarm));
  router.post('/books/:ref/strategy',route('book-strategy',h.bookStrategy));
  router.post('/books/:ref/archive',route('book-archive',h.bookArchive));
  router.post('/books/:ref/restore',route('book-restore',h.bookRestore));
  router.get('/reports',route('reports',h.reports));
  router.post('/reports',route('report',h.report));
  router.post('/presenter',route('presenter',h.presenter));
  return router;
}

module.exports = { createTradingPaperRoutes, paperHandlers, callerOf };
