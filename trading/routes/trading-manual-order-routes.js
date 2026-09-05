"use strict";
/**
 * Direct trades (ADR-136 D3) — the operator picks a stock and buys/sells it on the SELECTED
 * account without a strategy, while still passing through the engine's single order path.
 *
 *   POST /api/trading/decisions/manual → mints an OPERATOR-authored decision (agent_id 'operator',
 *        backed by a 'manual' signal row carrying the operator's own rationale). The caller then
 *        executes it with the existing POST /orders, which applies the same guardrails, live gate,
 *        submission-reservation arbiter and disabled-book refusal as every engine order.
 *   GET  /api/trading/quote?symbol=  → latest price from the book's market-data rail (sizing).
 *
 * "Price points" are ORDER TYPES the venue already runs — buy-if-it-drops-to-X = limit GTC,
 * buy-on-breakout-above-X = stop GTC, protect = trailing_stop — nothing new is invented here.
 * Guardrails are checked at mint time so the UI can say WHY before the confirm step (the engine
 * re-checks at execution regardless).
 *
 * Protected entries (ADR-138 D3). A BUY may carry `protect` — take-profit / stop / trailing-stop /
 * time-stop rules, normalized by the kernel (400 rules_invalid on a contradictory set). The decision
 * is minted exactly as before, then a PINNED LOT intent is created against it
 * (@/app/trading-pinned-lots); the lot leg watches the entry fill and places the exits. Pinned shares
 * are RING-FENCED from the autopilot: the rotation never sells or resizes them until the lot closes
 * or the operator releases it (POST /lots/:id/release). The leg rides the per-user 'trading-events'
 * schedule — the same leg as the event playbooks — created here when the user has none, and checked
 * BEFORE any row is written so a 503 changes nothing. Sells never create lots. `extendedHours` is
 * persisted on the decision row (extended_hours) so the order path can honour it.
 *
 * Timed (dated) orders (ADR-136 D4). A request may carry `fireAtEt` — an Eastern wall-clock
 * { date: 'YYYY-MM-DD', time: 'HH:MM' } on the 5-minute grid, 09:00–16:55 ET, a trading day, within
 * TRADING_DATED_MAX_DAYS. The decision is minted exactly as before but NOT executed by the caller: a
 * kernel dated-order row (@/app/trading-dated-orders) fires it ONCE through the engine on the
 * trading-events leg at that time (5-minute cadence). The leg is ensured BEFORE anything is written
 * (503 scheduler_unavailable changes nothing) because a timed order with no leg would never fire.
 * Protection may ride along — the lot's unfilled-entry release then counts from the fire time.
 * GET /dated lists this book's timed orders; POST /dated/:id/cancel stops a pending one.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — POST /decisions/manual (symbol/side/qty-or-notional/orderType/price params/TIF, book-scoped query-first per the 2026-09-03 surface audit, guardrail + disabled-book pre-checks) and GET /quote.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | ADR-138 D3: POST /decisions/manual accepts protect (PinnedLotRules → normalizePinnedLotRules, 400 rules_invalid) and extendedHours (persisted as extended_hours on the decision row); a BUY with exit rules mints a pending_fill pinned-lot intent and ensures the per-user trading-events schedule (503 scheduler_unavailable BEFORE any insert); sells never pin; the response carries lot + protection. Handler decomposed into parse / size / mint / protect helpers (50-line rule); the latest-price sizing read logs its failure instead of swallowing it.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | ADR-136 D4 timed orders: fireAtEt (ET wall-clock → kernel etWallToInstant + validateFireAt at PARSE time, 400 fire_at_invalid before anything is written); a timed request ensures the trading-events leg BEFORE the mint (a timed order with no leg would never fire — 503 changes nothing) and records a kernel dated-order row instead of expecting POST /orders; protection rides along with notBefore = the fire time; GET /dated + POST /dated/:id/cancel.
 *
 * @module trading-manual-order-routes
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerTradingManualOrderRoutes = registerTradingManualOrderRoutes;
const crypto = __importStar(require("crypto"));
const logger_1 = require("@/shared/logger");
const trading_1 = require("@/features/trading");
const trading_routes_helpers_1 = require("@/app/routes/trading-routes-helpers");
const trading_schema_1 = require("@/app/trading-schema");
const trading_schedule_dispatch_1 = require("@/app/trading-schedule-dispatch");
const trading_event_plans_1 = require("@/app/trading-event-plans");
const trading_pinned_lots_1 = require("@/app/trading-pinned-lots");
const trading_dated_orders_1 = require("@/app/trading-dated-orders");
const logger = (0, logger_1.createChildLogger)({ module: 'trading-manual-order-routes' });
const ORDER_TYPES = ['market', 'limit', 'stop', 'stop_limit', 'trailing_stop'];
const SCHEDULER_UNAVAILABLE = 'The agent scheduler is not running (ENABLE_AGENT_SCHEDULER) — a protected entry needs it to place the exits, and a timed order needs it to fire.';
/** The dated row as every surface shows it: the kernel row plus the fire time in words (ET). */
const withFireWords = (d) => ({ ...d, fireAtWords: (0, trading_dated_orders_1.formatEt)(new Date(d.fireAt)) });
const num = (v) => { const n = Number(v); return v === undefined || v === null || v === '' || !Number.isFinite(n) ? null : n; };
/**
 * @description Validate the order-type-specific price parameters the venue requires.
 * @param type - Order type.
 * @param p - Parsed prices.
 * @returns A refusal message, or null when the shape is complete.
 */
function priceShapeViolation(type, p) {
    if (type === 'limit' && !(p.limit && p.limit > 0))
        return 'A limit order needs a positive limit price.';
    if (type === 'stop' && !(p.stop && p.stop > 0))
        return 'A stop order needs a positive stop (trigger) price.';
    if (type === 'stop_limit' && !((p.stop && p.stop > 0) && (p.limit && p.limit > 0)))
        return 'A stop-limit order needs both a stop price and a limit price.';
    if (type === 'trailing_stop' && !((p.trailPct && p.trailPct > 0) || (p.trailPx && p.trailPx > 0)))
        return 'A trailing stop needs a trail percent or a trail amount.';
    return null;
}
/**
 * @description Validate the request shape: symbol, side, order type, TIF, price shape, and the
 * protect rules (normalized by the kernel — a contradictory set is a 400, never a silent default).
 * @param b - The posted body.
 * @returns The parsed request, or a refusal.
 */
function parseManualBody(b) {
    const symbol = String(b.symbol || '').trim().toUpperCase();
    const side = String(b.side || 'buy').toLowerCase();
    const type = ORDER_TYPES.includes(String(b.orderType || 'market')) ? String(b.orderType || 'market') : null;
    const tif = String(b.timeInForce || 'day').toLowerCase();
    if (!/^[A-Z.\-]{1,10}$/.test(symbol))
        return { ok: false, status: 400, error: 'symbol_required', message: 'A ticker symbol is required.' };
    if (side !== 'buy' && side !== 'sell')
        return { ok: false, status: 400, error: 'side_invalid', message: 'side must be buy or sell.' };
    if (!type)
        return { ok: false, status: 400, error: 'order_type_invalid', message: `orderType must be one of ${ORDER_TYPES.join(', ')}.` };
    if (tif !== 'day' && tif !== 'gtc')
        return { ok: false, status: 400, error: 'tif_invalid', message: 'timeInForce must be day or gtc.' };
    const prices = { limit: num(b.limitPrice), stop: num(b.stopPrice), trailPct: num(b.trailPercent), trailPx: num(b.trailPrice) };
    const shape = priceShapeViolation(type, prices);
    if (shape)
        return { ok: false, status: 400, error: 'price_shape_invalid', message: shape };
    let rules;
    try {
        rules = (0, trading_pinned_lots_1.normalizePinnedLotRules)(b.protect);
    }
    catch (err) {
        logger.warn({ err, symbol }, 'protect rules rejected');
        return { ok: false, status: err instanceof trading_routes_helpers_1.TradingError ? err.httpStatus : 400, error: err instanceof trading_routes_helpers_1.TradingError ? err.code : 'rules_invalid', message: err.message };
    }
    // ADR-136 D4: the fire time is converted + validated by the KERNEL (same rules the leg enforces) at
    // parse time, so a refused time is a 400 with nothing written.
    let fireAt = null;
    if (b.fireAtEt && (b.fireAtEt.date || b.fireAtEt.time)) {
        try {
            fireAt = (0, trading_dated_orders_1.etWallToInstant)(String(b.fireAtEt.date || ''), String(b.fireAtEt.time || ''));
            (0, trading_dated_orders_1.validateFireAt)(fireAt);
        }
        catch (err) {
            logger.warn({ err, symbol }, 'fire time rejected');
            return { ok: false, status: err instanceof trading_routes_helpers_1.TradingError ? err.httpStatus : 400, error: err instanceof trading_routes_helpers_1.TradingError ? err.code : 'fire_at_invalid', message: err.message };
        }
    }
    return { ok: true, v: { symbol, side, type, tif, prices, extendedHours: b.extendedHours === true, rules, fireAt } };
}
/**
 * @description Size the order in whole shares: by `qty`, or by `notional` at the reference price —
 * the operator's own price point when there is one, otherwise the latest print from the book's rail.
 * Then pre-check the same guardrails the engine enforces so the UI can say WHY before confirm.
 * @param b - The posted body (qty / notional).
 * @param v - The parsed request.
 * @param book - The selected book.
 * @param sub - Caller sub.
 * @returns The sized order, or a refusal.
 */
async function sizeManualOrder(b, v, book, sub) {
    const { symbol, prices } = v;
    let qty = num(b.qty);
    const notional = num(b.notional);
    if (qty != null && notional != null)
        return { ok: false, status: 400, error: 'size_ambiguous', message: 'Size the order by shares OR by dollars — not both.' };
    let refPrice = prices.limit ?? prices.stop ?? null;
    let latest = null;
    if (refPrice == null || notional != null) {
        const md = (0, trading_1.getMarketData)(book.kind, sub);
        if (md.configured()) {
            latest = await md.latestPrice(symbol).catch((err) => { logger.error({ err, symbol, book: book.ref }, 'latest price read failed — sizing without a quote'); return null; });
        }
        if (refPrice == null)
            refPrice = latest;
    }
    if (qty == null && notional != null) {
        if (!(refPrice && refPrice > 0))
            return { ok: false, status: 503, error: 'no_quote', message: `Cannot size ${symbol} by dollars — no price available. Enter a share count or a limit price.` };
        qty = Math.floor(notional / refPrice);
    }
    if (qty == null || !Number.isInteger(qty) || qty < 1)
        return { ok: false, status: 400, error: 'qty_invalid', message: 'Enter a whole number of shares (≥ 1) or a dollar amount that buys at least one share.' };
    const g = (0, trading_routes_helpers_1.guardrails)();
    const violation = (0, trading_routes_helpers_1.guardrailViolation)(g, symbol, qty, refPrice ?? 0);
    if (violation)
        return { ok: false, status: 422, error: 'guardrail_blocked', message: violation, extra: { guardrails: g } };
    return { ok: true, qty, refPrice, latest, notional, g };
}
/**
 * @description Persist the operator's decision: a 'manual' signal row carrying the rationale, then
 * the 'operator' decision FK-bound to it (book_id written explicitly on both; extended_hours on the
 * decision).
 * @param ctx - App context (pool).
 * @param sub - Caller sub.
 * @param book - The selected book.
 * @param v - The parsed request.
 * @param sized - The sized order.
 * @param rationale - The operator's rationale.
 * @returns The minted decision id + timestamp.
 */
async function mintManualDecision(ctx, sub, book, v, sized, rationale) {
    const { symbol, side, type, tif, prices, extendedHours } = v;
    const params = {
        orderType: type, limitPrice: prices.limit, stopPrice: prices.stop, trailPercent: prices.trailPct, trailPrice: prices.trailPx, timeInForce: tif,
        extendedHours, refPrice: sized.refPrice, latest: sized.latest, notional: sized.notional, protect: v.rules,
    };
    const artifact = JSON.stringify({ source: 'manual', symbol, side, qty: sized.qty, params, rationale, at: Date.now() });
    const hash = crypto.createHash('sha256').update(artifact).digest('hex');
    const sig = (await ctx.pool.query('INSERT INTO oshal_trading_signals (user_sub, mode, book_id, source, title, body, symbols, indicators, content_hash) VALUES ($1,$2,$3,\'manual\',$4,$5,$6,$7,$8) ON CONFLICT (user_sub, book_id, content_hash) DO UPDATE SET observed_at = oshal_trading_signals.observed_at RETURNING signal_id', [sub, book.kind, book.bookId, `Operator ${side} ${sized.qty} ${symbol}`, rationale, [symbol], JSON.stringify(params), hash])).rows[0];
    const row = (await ctx.pool.query('INSERT INTO oshal_trading_decisions (user_sub, mode, book_id, signal_ids, agent_id, action, symbol, side, qty, order_type, limit_price, stop_price, trail_price, trail_percent, time_in_force, confidence, rationale, indicators, guardrails, extended_hours) VALUES ($1,$2,$3,$4::uuid[],\'operator\',$5,$6,$5,$7,$8,$9,$10,$11,$12,$13,1,$14,$15,$16,$17) RETURNING decision_id, created_at', [sub, book.kind, book.bookId, [sig.signal_id], side, symbol, sized.qty, type, prices.limit, prices.stop, prices.trailPx, prices.trailPct, tif, rationale, JSON.stringify(params), JSON.stringify(sized.g), extendedHours])).rows[0];
    return { decisionId: String(row.decision_id), createdAt: String(row.created_at) };
}
/**
 * @description Ensure the caller's per-user 'trading-events' schedule exists and is active — the leg
 * the pinned-lot executor rides (the same leg as the event playbooks, created the same way).
 * @param sub - Caller sub.
 */
async function ensureEventSchedule(sub) {
    const svc = (0, trading_schedule_dispatch_1.getTradingScheduleService)();
    if (!svc)
        throw new trading_routes_helpers_1.TradingError(503, 'scheduler_unavailable', SCHEDULER_UNAVAILABLE);
    const taskType = (0, trading_event_plans_1.eventPlanTaskType)(sub);
    const mine = await svc.listSchedules({ ownerSub: sub, scope: 'mine' });
    if (mine.some((r) => r.taskType === taskType && r.ownerSub === sub && r.status === 'active'))
        return;
    await svc.createSchedule({
        taskType: (0, trading_event_plans_1.eventPlanTaskType)(sub), schedule: trading_event_plans_1.EVENT_PLANS_CRON, timezone: trading_event_plans_1.EVENT_PLANS_TIMEZONE, ownerSub: sub, queue: 'intelligent-trades',
        taskData: { prompt: 'Event playbooks — IPO watch/entry/exit state machine', userSub: sub },
    });
    logger.info({ sub, taskType }, 'trading-events schedule created for the pinned-lot leg');
}
/**
 * @description Pin the entry: create the pending_fill lot intent against the minted decision and make
 * sure the leg that will place its exits is scheduled.
 * @param ctx - App context (pool).
 * @param sub - Caller sub.
 * @param book - The selected book.
 * @param decisionId - The minted BUY decision.
 * @param v - The parsed request (symbol + rules).
 * @param qty - Shares.
 * @returns The lot row.
 */
async function protectEntry(ctx, sub, book, decisionId, v, qty) {
    await (0, trading_pinned_lots_1.ensurePinnedLotsSchema)(ctx.pool);
    // A timed entry is placed later: the lot's "entry never placed" release clock starts at the fire time.
    const lot = await (0, trading_pinned_lots_1.createPinnedLotIntent)(ctx.pool, sub, { book, decisionId, symbol: v.symbol, qty, rules: v.rules, notBefore: v.fireAt ?? undefined });
    // The order has already executed and the protection is recorded; arming the executor leg is
    // best-effort. A scheduler failure must NEVER fail an order that already went to the venue — the
    // lot stays pending_fill and the leg picks it up once the schedule exists (a later arm re-ensures it).
    let scheduleWarning = null;
    try {
        await ensureEventSchedule(sub);
    }
    catch (err) {
        scheduleWarning = 'The order and its protection are saved, but the executor schedule could not be armed — the protective orders will be placed once it is.';
        logger.error({ err, sub, lotId: lot.lotId }, 'pinned-lot executor schedule ensure failed (order + lot are recorded)');
    }
    logger.info({ sub, lotId: lot.lotId, decisionId, symbol: v.symbol, qty, book: book.ref, scheduled: !scheduleWarning }, 'pinned lot intent created for a protected entry');
    return { lot, scheduleWarning };
}
/**
 * @description Registers the direct-trade routes on the trading router.
 * @param router - The trading router being composed by createTradingRoutes.
 * @param ctx - App context (Postgres pool).
 * @returns Nothing — routes are registered on the passed router.
 */
function registerTradingManualOrderRoutes(router, ctx) {
    /** GET /quote?symbol= — latest price from THIS book's market-data rail (paper: Alpaca; live: Schwab). */
    router.get('/quote', async (req, res) => {
        const sub = (0, trading_routes_helpers_1.callerSub)(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const symbol = String(req.query.symbol || '').trim().toUpperCase();
        if (!/^[A-Z.\-]{1,10}$/.test(symbol)) {
            res.status(400).json({ error: 'symbol_required', message: 'A ticker symbol is required.' });
            return;
        }
        try {
            const book = await (0, trading_routes_helpers_1.resolveBook)(ctx.pool, sub, req.query.book ?? req.query.mode);
            const md = (0, trading_1.getMarketData)(book.kind, sub);
            if (!md.configured()) {
                res.status(503).json({ error: 'market_data_not_configured', message: 'Market data is not connected for this account.' });
                return;
            }
            const price = await md.latestPrice(symbol);
            if (price == null) {
                res.status(404).json({ error: 'no_quote', message: `No quote for ${symbol}.` });
                return;
            }
            res.json({ symbol, price, book: book.ref, asOf: new Date().toISOString() });
        }
        catch (err) {
            if (err instanceof trading_routes_helpers_1.TradingError) {
                res.status(err.httpStatus).json({ error: err.code, message: err.message });
                return;
            }
            logger.error({ err, symbol }, 'trading quote failed');
            res.status(502).json({ error: err.message });
        }
    });
    /** POST /decisions/manual — mint the operator's decision (+ a pinned-lot intent for a protected BUY); execute with POST /orders. */
    router.post('/decisions/manual', async (req, res) => {
        const sub = (0, trading_routes_helpers_1.callerSub)(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const b = (req.body || {});
        const parsed = parseManualBody(b);
        if (!parsed.ok) {
            res.status(parsed.status).json({ error: parsed.error, message: parsed.message });
            return;
        }
        const { symbol, side, type, tif, prices, extendedHours, rules } = parsed.v;
        const pins = side === 'buy' && (0, trading_pinned_lots_1.hasExitRules)(rules);
        // A pinned buy needs the executor leg, but the leg-arming is best-effort AFTER the order (below):
        // never refuse a protected buy just because the scheduler is momentarily unavailable — record the
        // protection and warn. Only a hard-off scheduler (service entirely absent) is worth flagging early.
        try {
            await (0, trading_schema_1.ensureTradingSchema)(ctx.pool);
            const book = await (0, trading_routes_helpers_1.resolveBook)(ctx.pool, sub, req.query.book ?? b.book ?? req.query.mode ?? b.mode);
            // A TIMED order fires only from the leg — with no leg it would never fire, so the leg is ensured
            // BEFORE anything is written (a 503 here changes nothing). Unlike the protected-entry case below,
            // there is no order already at the venue to protect, so refusing is the honest answer.
            if (parsed.v.fireAt)
                await ensureEventSchedule(sub);
            // A manual buy is the operator's explicit action — allowed whether or not the AUTOPILOT is
            // armed on this account (2026-09-04: "view-only" gated the autopilot, and wrongly blocked the
            // human's own buys). The engine still enforces the live gate (TRADING_LIVE_ENABLED + confirm).
            // Autonomous buys on a disabled book remain refused in the engine (agent_id-scoped).
            const sized = await sizeManualOrder(b, parsed.v, book, sub);
            if (!sized.ok) {
                res.status(sized.status).json({ error: sized.error, message: sized.message, ...(sized.extra ?? {}) });
                return;
            }
            const rationale = String(b.rationale || '').trim() || `Operator direct ${side}: ${sized.qty} ${symbol} (${type}${tif === 'gtc' ? ', GTC' : ''}).`;
            const minted = await mintManualDecision(ctx, sub, book, parsed.v, sized, rationale);
            const dated = parsed.v.fireAt ? await (0, trading_dated_orders_1.createDatedOrder)(ctx.pool, sub, { book, decisionId: minted.decisionId, symbol, side, qty: sized.qty, orderType: type, fireAt: parsed.v.fireAt }) : null;
            const protectedEntry = pins ? await protectEntry(ctx, sub, book, minted.decisionId, parsed.v, sized.qty) : null;
            logger.info({ sub, book: book.ref, symbol, side, qty: sized.qty, type, tif, extendedHours, pinned: !!protectedEntry, dated: dated?.datedId ?? null }, 'operator direct-trade decision minted');
            res.json({
                ok: true, decisionId: minted.decisionId, createdAt: minted.createdAt, book: book.ref,
                decision: { action: side, symbol, side, qty: sized.qty, orderType: type, limitPrice: prices.limit, stopPrice: prices.stop, trailPercent: prices.trailPct, trailPrice: prices.trailPx, timeInForce: tif, extendedHours, rationale },
                refPrice: sized.refPrice, estNotional: sized.refPrice ? sized.qty * sized.refPrice : null, requiresConfirm: book.kind === 'live',
                lot: protectedEntry ? protectedEntry.lot : null, protection: pins ? rules : null,
                dated: dated ? withFireWords(dated) : null,
                ...(protectedEntry?.scheduleWarning ? { warning: protectedEntry.scheduleWarning } : {}),
            });
        }
        catch (err) {
            if (err instanceof trading_routes_helpers_1.TradingError) {
                res.status(err.httpStatus).json({ error: err.code, message: err.message });
                return;
            }
            logger.error({ err, symbol, side }, 'trading manual decision failed');
            res.status(502).json({ error: err.message });
        }
    });
    /** GET /dated — this book's timed orders (ADR-136 D4), soonest first, each with the fire time in words. */
    router.get('/dated', async (req, res) => {
        const sub = (0, trading_routes_helpers_1.callerSub)(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            await (0, trading_dated_orders_1.ensureDatedOrdersSchema)(ctx.pool);
            const book = await (0, trading_routes_helpers_1.resolveBook)(ctx.pool, sub, req.query.book ?? req.query.mode);
            const rows = await (0, trading_dated_orders_1.listDatedOrders)(ctx.pool, sub, { bookId: book.bookId });
            res.json({ dated: rows.map(withFireWords), book: book.ref });
        }
        catch (err) {
            if (err instanceof trading_routes_helpers_1.TradingError) {
                res.status(err.httpStatus).json({ error: err.code, message: err.message });
                return;
            }
            logger.error({ err, sub }, 'dated orders list failed');
            res.status(502).json({ error: err.message });
        }
    });
    /** POST /dated/:id/cancel — a pending timed order never fires (409 not_pending once it has). */
    router.post('/dated/:id/cancel', async (req, res) => {
        const sub = (0, trading_routes_helpers_1.callerSub)(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            await (0, trading_dated_orders_1.ensureDatedOrdersSchema)(ctx.pool);
            const row = await (0, trading_dated_orders_1.cancelDatedOrder)(ctx.pool, sub, String(req.params.id));
            logger.info({ sub, datedId: row.datedId, symbol: row.symbol }, 'dated order cancelled by the operator');
            res.json({ dated: withFireWords(row) });
        }
        catch (err) {
            if (err instanceof trading_routes_helpers_1.TradingError) {
                res.status(err.httpStatus).json({ error: err.code, message: err.message });
                return;
            }
            logger.error({ err, sub, datedId: req.params.id }, 'dated order cancel failed');
            res.status(502).json({ error: err.message });
        }
    });
}
//# sourceMappingURL=trading-manual-order-routes.js.map