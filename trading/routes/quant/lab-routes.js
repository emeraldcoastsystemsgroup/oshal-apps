/** CHANGE LOG
 * 5 | maintainer@emeraldcoastsystemsgroup.com | 1.62.1: the handlers no longer carry a process copy of archived prices; it never hit for a caller who can write, whose every non-GET call runs in a fresh process.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | 1.61.3: the lab's handlers keep one process copy of archived day prices (createArchiveCache), so a second question on the same names reads nothing from the World archive.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | 1.61.1: interactive lab routes never reach the network: the bill rate and the factors come from the cached copy (or "unavailable right now" with the reason), so a reference host that never answers cannot hold up Trading. The handlers' default deps carry no fetch.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Real reference data: risk, factors, frontier and Kelly use the latest 3-month Treasury bill rate (FRED, labelled) unless the question gives one; the factors view adds the official Fama-French three factors; a new options route reads the caller's real Schwab option chain (the kernel's trading.chains) and says plainly when there is none.
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The quant lab, at /api/trading/quant/lab on the Quant router (no manifest route, schedule or authority change): explain one of the fifty ideas, calculate on supplied numbers, analyze one real stock, a portfolio, a pair, a Monte Carlo, and the desk's backtest overfitting. Each answer is bounded (six names, 2,520 sessions, 20,000 paths) and labels its prices' source. Research only: nothing here reaches an account, a strategy or an order.
 */
'use strict';
const store = require('./store');
const { parseSymbols, loadPrices, lastSessions, alignCloses, tradingConfig } = require('./lab-data');
const { VIEWS, DEFAULT_SESSIONS, PROXIES, riskView, behaviorView, volatilityView, liquidityView, factorsView, officialFactorsView } = require('./lab-stock');
const { famaFrenchDaily, riskFreeFor } = require('./lab-reference');
const { optionsView } = require('./lab-options');
const M = require('./math');
const { METHODS, portfolioView, pairView, simulateView } = require('./lab-portfolio');
const { calculate, num } = require('./lab-calculate');
const { CONCEPTS, findConcept } = require('./lab-concepts');
const { overfittingReport } = require('./lab-overfitting');
const { RESEARCH_ONLY, rounded } = require('./lab-format');
const { fail, integer } = require('./math/checks');

const MAX_SESSIONS = 2520;
const MIN_SESSIONS = 20;

/**
 * @description The admitted caller's subject; never a header or a body field.
 * @param {object} req - Request.
 * @returns {string|null} The subject.
 */
function callerOf(req) {
  const sub = req && (req.oshalCallerSub || (req.user && req.user.sub) || (req.oidc && req.oidc.user && req.oidc.user.sub));
  return sub ? String(sub) : null;
}

/**
 * @description The JSON body as an object (an absent or non-object body reads as empty).
 * @param {object} req - Request.
 * @returns {object} The body.
 */
function bodyOf(req) {
  return req && req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
}

/**
 * @description Sessions of history to read: the question's `days` within bounds, else the view's default.
 * @param {*} days - Requested trading days.
 * @param {number} fallback - Default.
 * @returns {number} Sessions.
 */
function sessionsFrom(days, fallback) {
  return days == null || days === '' ? fallback : integer(Math.round(num({ days }, 'days')), 'days', MIN_SESSIONS, MAX_SESSIONS);
}

/**
 * @description The fields every lab answer carries.
 * @param {object} prices - loadPrices result.
 * @param {object} extra - The view's own fields.
 * @returns {object} The answer body (rounded).
 */
function answer(prices, extra) {
  return rounded({ ok: true, researchOnly: true, source: prices.source, sourceNote: prices.note, missing: prices.missing, ...extra, disclaimer: RESEARCH_ONLY });
}

/**
 * @description An answer for a question whose prices could not be read, with each name's reason.
 * @param {object} prices - loadPrices result.
 * @returns {{status:number, body:object}} 200 with ok false.
 */
function noPrices(prices) {
  return { status: 200, body: { ok: false, researchOnly: true, source: prices.source, sourceNote: prices.note, missing: prices.missing, message: 'No prices could be read for this question; each name says why.' } };
}

/**
 * @description The extra names a factors question reads: the ETF proxies and up to three APT ETFs.
 * @param {string} symbol - The stock.
 * @param {object} b - Body.
 * @returns {{others:string[], apt:string[]}} Names besides the stock.
 */
function factorNames(symbol, b) {
  const apt = b.apt == null ? [] : parseSymbols(b.apt, { min: 0, max: 3 });
  return { others: [...new Set([...Object.values(PROXIES), ...apt])].filter((n) => n !== symbol).slice(0, 5), apt };
}

/**
 * @description Run one view over a stock's loaded prices.
 * @param {object} deps - Route deps.
 * @param {string} view - View.
 * @param {string} symbol - Stock.
 * @param {object} prices - Loaded prices.
 * @param {object} b - Body options.
 * @param {string} sub - Caller (for the cached reference data).
 * @returns {Promise<object>} The view's figures.
 */
async function runView(deps, view, symbol, prices, b, sub) {
  const s = lastSessions(prices.series.get(symbol), b.sessions + 1);
  if (view === 'risk') return riskView(s, { confidence: num(b, 'confidence', 0.95), horizonDays: num(b, 'horizonDays', 1), riskFree: num(b, 'riskFree', 0) });
  if (view === 'behavior') return behaviorView(s);
  if (view === 'volatility') return volatilityView(s, { horizonDays: integer(Math.round(num(b, 'horizonDays', 21)), 'horizonDays', 1, 252), targetVolatility: num(b, 'targetVolatility', 0.15) });
  if (view === 'liquidity') {
    let quote = null;
    if (prices.source === 'schwab') { try { quote = ((await deps.intent('trading.quotes', { symbols: [symbol] })).quotes || [])[0] || null; } catch { quote = null; } }
    return liquidityView(s, { quote, shares: b.shares == null ? null : num(b, 'shares') });
  }
  const { others, apt } = factorNames(symbol, b), have = others.filter((n) => prices.series.has(n));
  const aligned = alignCloses([s, ...have.map((n) => lastSessions(prices.series.get(n), b.sessions + 1))]);
  if (aligned.dates.length < MIN_SESSIONS) return { unavailable: `The stock and its comparison prices share only ${aligned.dates.length} days.` };
  const ff = await famaFrenchDaily(deps, sub);
  return { sharedSessions: aligned.dates.length, ...factorsView(symbol, aligned, have, { riskFree: num(b, 'riskFree', 0), apt }), official: ff.ok ? officialFactorsView(s, ff) : { unavailable: ff.unavailable } };
}

/**
 * @description Explain one of the fifty ideas from the read-in table.
 * @param {object} deps - Route deps.
 * @param {string} sub - Caller.
 * @param {object} req - Request (params.concept).
 * @returns {Promise<{status:number, body:object}>} The concept, or suggestions.
 */
async function explainHandler(deps, sub, req) {
  const found = findConcept(req.params && req.params.concept);
  if (found.concept) return { status: 200, body: { ok: true, concept: found.concept } };
  return { status: 200, body: { ok: false, message: 'No single concept matches; name one of these.', suggestions: found.suggestions, concepts: CONCEPTS.map((c) => c.name) } };
}

/**
 * @description The calculator on supplied numbers (no price read).
 * @param {object} deps - Route deps.
 * @param {string} sub - Caller.
 * @param {object} req - Request (body {kind, ...}).
 * @returns {Promise<{status:number, body:object}>} The result.
 */
async function calculateHandler(deps, sub, req) {
  return { status: 200, body: rounded({ ok: true, researchOnly: true, ...calculate(bodyOf(req)), disclaimer: RESEARCH_ONLY }) };
}

/**
 * @description One stock, one view, over its real daily prices.
 * @param {object} deps - Route deps.
 * @param {string} sub - Caller.
 * @param {object} req - Request (body {symbol, view, days?, ...}).
 * @returns {Promise<{status:number, body:object}>} The view.
 */
async function stockHandler(deps, sub, req) {
  const b = bodyOf(req), symbol = parseSymbols(b.symbol, { max: 1 })[0], view = String(b.view || 'risk').toLowerCase();
  if (!VIEWS.includes(view)) throw fail(`view must be one of ${VIEWS.join(', ')}.`);
  const sessions = sessionsFrom(b.days, DEFAULT_SESSIONS[view]), names = view === 'factors' ? [symbol, ...factorNames(symbol, b).others] : [symbol];
  const prices = await loadPrices(deps, names, { sessions: sessions + 1 });
  if (!prices.series.has(symbol)) return noPrices(prices);
  const s = lastSessions(prices.series.get(symbol), sessions + 1), rf = ['risk', 'factors'].includes(view) ? await riskFreeFor(deps, sub, b.riskFree, num) : null;
  const result = await runView(deps, view, symbol, prices, { ...b, sessions, ...(rf ? { riskFree: rf.value } : {}) }, sub);
  return { status: 200, body: answer(prices, { symbol, view, sessions: s.dates.length, from: s.dates[0], to: s.dates.at(-1), ...(rf ? { riskFree: rf } : {}), result }) };
}

/**
 * @description Several names as a portfolio, by one method.
 * @param {object} deps - Route deps.
 * @param {string} sub - Caller.
 * @param {object} req - Request (body {symbols, method, ...}).
 * @returns {Promise<{status:number, body:object}>} The portfolio view.
 */
async function portfolioHandler(deps, sub, req) {
  const b = bodyOf(req), names = parseSymbols(b.symbols, { min: 2 }), method = String(b.method || 'diversification').toLowerCase();
  if (!METHODS.includes(method)) throw fail(`method must be one of ${METHODS.join(', ')}.`);
  const sessions = sessionsFrom(b.days, 504), prices = await loadPrices(deps, names, { sessions: sessions + 1 }), have = names.filter((n) => prices.series.has(n));
  if (have.length < 2) return noPrices(prices);
  const aligned = alignCloses(have.map((n) => lastSessions(prices.series.get(n), sessions + 1)));
  if (aligned.dates.length < MIN_SESSIONS) return { status: 200, body: answer(prices, { ok: false, message: `These names share only ${aligned.dates.length} days of prices.` }) };
  const weights = Array.isArray(b.weights) && b.weights.length === have.length ? b.weights.map((_, i) => num(b.weights, i)) : null;
  const rf = ['frontier', 'kelly'].includes(method) ? await riskFreeFor(deps, sub, b.riskFree, num) : null;
  const view = portfolioView(have, aligned.closes, { method, riskFree: rf ? rf.value : num(b, 'riskFree', 0), weights, views: b.views, targetVolatility: num(b, 'targetVolatility', 0.15) });
  return { status: 200, body: answer(prices, { names: have, from: aligned.dates[0], to: aligned.dates.at(-1), ...(rf ? { riskFree: rf } : {}), ...view }) };
}

/**
 * @description Two names as a statistical-arbitrage pair.
 * @param {object} deps - Route deps.
 * @param {string} sub - Caller.
 * @param {object} req - Request (body {a, b, days?}).
 * @returns {Promise<{status:number, body:object}>} The pair view.
 */
async function pairHandler(deps, sub, req) {
  const b = bodyOf(req), names = parseSymbols([b.a, b.b].filter((x) => x != null), { min: 2, max: 2 }), sessions = sessionsFrom(b.days, 504);
  const prices = await loadPrices(deps, names, { sessions: sessions + 1 });
  if (!names.every((n) => prices.series.has(n))) return noPrices(prices);
  const aligned = alignCloses(names.map((n) => lastSessions(prices.series.get(n), sessions + 1)));
  if (aligned.dates.length < MIN_SESSIONS) return { status: 200, body: answer(prices, { ok: false, message: `The pair shares only ${aligned.dates.length} days of prices.` }) };
  return { status: 200, body: answer(prices, { names, sessions: aligned.dates.length, from: aligned.dates[0], to: aligned.dates.at(-1), ...pairView(names, aligned.closes) }) };
}

/**
 * @description A Monte Carlo of where one stock could end, from its own past.
 * @param {object} deps - Route deps.
 * @param {string} sub - Caller.
 * @param {object} req - Request (body {symbol, horizonDays, method?, paths?, days?}).
 * @returns {Promise<{status:number, body:object}>} The simulation.
 */
async function simulateHandler(deps, sub, req) {
  const b = bodyOf(req), symbol = parseSymbols(b.symbol, { max: 1 })[0], sessions = sessionsFrom(b.days, 756);
  const horizonDays = integer(Math.round(num(b, 'horizonDays', 21)), 'horizonDays', 1, 756), method = String(b.method || 'gbm').toLowerCase();
  if (!['gbm', 'bootstrap'].includes(method)) throw fail("method must be 'gbm' or 'bootstrap'.");
  const prices = await loadPrices(deps, [symbol], { sessions: sessions + 1 });
  if (!prices.series.has(symbol)) return noPrices(prices);
  const s = lastSessions(prices.series.get(symbol), sessions + 1), need = method === 'bootstrap' ? 30 : MIN_SESSIONS - 1;
  if (s.closes.length - 1 < need) return { status: 200, body: answer(prices, { ok: false, message: `A ${method} simulation needs at least ${need} daily returns; this history has ${s.closes.length - 1}.` }) };
  const view = simulateView(s.closes, { horizonDays, method, paths: integer(Math.round(num(b, 'paths', 5000)), 'paths', 100, 20000) });
  return { status: 200, body: answer(prices, { symbol, sessions: s.dates.length, from: s.dates[0], to: s.dates.at(-1), ...view }) };
}

/**
 * @description The stock's own annual volatility over its last 63 sessions, from the same price source as the other views.
 * @param {object} deps - Route deps.
 * @param {string} symbol - Ticker.
 * @returns {Promise<number|null>} The volatility, or null without enough prices.
 */
async function historicalVolatility(deps, symbol) {
  const prices = await loadPrices(deps, [symbol], { sessions: 64 }), s = prices.series.get(symbol);
  return s && s.closes.length > 20 ? M.stats.annualizedVolatility(M.stats.simpleReturns(s.closes.slice(-64))) : null;
}

/**
 * @description A real option chain from the caller's Schwab connection, summarized. No connection, a kernel without the
 * read, or a symbol with no listed options each answer in words, with no chain.
 * @param {object} deps - Route deps.
 * @param {string} sub - Caller.
 * @param {object} req - Request (body {symbol, fromDate?, toDate?, strikeCount?, riskFree?}).
 * @returns {Promise<{status:number, body:object}>} The option view.
 */
async function optionsHandler(deps, sub, req) {
  const b = bodyOf(req), symbol = parseSymbols(b.symbol, { max: 1 })[0], config = await tradingConfig(deps);
  const refuse = (message) => ({ status: 200, body: { ok: false, researchOnly: true, symbol, message } });
  if (config.configured !== true) return refuse('Option chains come from your own Schwab connection, and none is connected, so no chain is shown. Black-Scholes on numbers you give still works (trading_quant_calculate).');
  if (config.optionChains !== true) return refuse('This installation cannot read option chains yet; the read arrives with the next kernel release.');
  const input = { symbol, strikeCount: b.strikeCount == null ? 10 : integer(Math.round(num(b, 'strikeCount')), 'strikeCount', 1, 30), ...(b.fromDate ? { fromDate: String(b.fromDate) } : {}), ...(b.toDate ? { toDate: String(b.toDate) } : {}) };
  const chain = await deps.intent('trading.chains', input);
  if (!chain || chain.available !== true) return refuse(`Schwab lists no options for ${symbol}.`);
  const [rf, historical] = await Promise.all([riskFreeFor(deps, sub, b.riskFree, num), historicalVolatility(deps, symbol)]);
  return { status: 200, body: rounded({ researchOnly: true, source: 'schwab', sourceNote: 'Your own Schwab option chain (quotes, implied volatility and Greeks as Schwab reports them).', riskFree: rf, ...optionsView(chain, { rate: rf.value, historicalVolatility: historical }), disclaimer: RESEARCH_ONLY }) };
}

/**
 * @description Backtest overfitting over the caller's own Quant desk history test.
 * @param {object} deps - Route deps (pool).
 * @param {string} sub - Caller.
 * @returns {Promise<{status:number, body:object}>} The report.
 */
async function overfittingHandler(deps, sub) {
  return { status: 200, body: rounded({ researchOnly: true, ...overfittingReport(await store.getRecord(deps.pool, sub, 'history', 'current')), disclaimer: RESEARCH_ONLY }) };
}

/**
 * @description The lab's handlers as plain (sub, req) -> {status, body} functions.
 * @param {object} ctx - Route context (pool, intent).
 * @param {object} [overrides] - Test seams (time).
 * @returns {Object<string, Function>} Handlers.
 */
function labHandlers(ctx, overrides = {}) {
  const deps = { pool: ctx.pool, intent: (name, input) => ctx.intent(name, input), time: () => Date.now(), ...overrides };
  const bind = (fn) => (sub, req) => fn(deps, sub, req);
  return { explain: bind(explainHandler), calculate: bind(calculateHandler), stock: bind(stockHandler), portfolio: bind(portfolioHandler), pair: bind(pairHandler), simulate: bind(simulateHandler), options: bind(optionsHandler), overfitting: bind(overfittingHandler) };
}

/**
 * @description Wrap a handler: 401 without an admitted caller, a refusal's status and words when it throws, and one log line.
 * @param {string} name - Handler name.
 * @param {Function} handler - (sub, req) -> {status, body}.
 * @param {object} logger - Logger with info and error.
 * @returns {Function} Express handler.
 */
function route(name, handler, logger) {
  return async (req, res) => {
    const started = Date.now(), sub = callerOf(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    try {
      const out = await handler(sub, req);
      logger.info({ route: `lab.${name}`, status: out.status, durationMs: Date.now() - started }, 'quant lab answered');
      res.status(out.status).json(out.body);
    } catch (err) {
      const status = Number(err && err.status) >= 400 && Number(err.status) < 600 ? Number(err.status) : 500;
      logger.error({ err: String((err && err.stack) || err).slice(0, 2000), route: `lab.${name}`, durationMs: Date.now() - started }, 'quant lab failed');
      res.status(status).json({ error: (err && err.code) || 'quant_lab_failed', message: err && err.message });
    }
  };
}

/** The lab's routes, under the Quant router's own /lab prefix. */
const LAB_ROUTES = Object.freeze([['get', '/lab/explain/:concept', 'explain'], ['post', '/lab/calculate', 'calculate'], ['post', '/lab/stock', 'stock'], ['post', '/lab/portfolio', 'portfolio'], ['post', '/lab/pair', 'pair'], ['post', '/lab/simulate', 'simulate'], ['post', '/lab/options', 'options'], ['get', '/lab/overfitting', 'overfitting']]);

/**
 * @description Register the lab's routes on the Quant router (mounted at /api/trading/quant), so no manifest route changes.
 * @param {object} router - The Quant router (get and post).
 * @param {object} ctx - Route context.
 * @param {object} logger - Logger.
 * @param {object} [overrides] - Test seams.
 * @returns {object} The same router.
 */
function registerQuantLabRoutes(router, ctx, logger, overrides) {
  const h = labHandlers(ctx, overrides);
  for (const [method, path, name] of LAB_ROUTES) router[method](path, route(name, h[name], logger));
  return router;
}

module.exports = { MAX_SESSIONS, LAB_ROUTES, callerOf, labHandlers, registerQuantLabRoutes };
