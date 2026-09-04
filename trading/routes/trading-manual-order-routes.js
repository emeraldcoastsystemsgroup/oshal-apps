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
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial — POST /decisions/manual (symbol/side/qty-or-notional/orderType/price params/TIF, book-scoped query-first per the 2026-09-03 surface audit, guardrail + disabled-book pre-checks) and GET /quote.
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
const logger = (0, logger_1.createChildLogger)({ module: 'trading-manual-order-routes' });
const ORDER_TYPES = ['market', 'limit', 'stop', 'stop_limit', 'trailing_stop'];
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
    /** POST /decisions/manual — mint the operator's decision; execute with POST /orders. */
    router.post('/decisions/manual', async (req, res) => {
        const sub = (0, trading_routes_helpers_1.callerSub)(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const b = (req.body || {});
        const symbol = String(b.symbol || '').trim().toUpperCase();
        const side = String(b.side || 'buy').toLowerCase();
        const type = ORDER_TYPES.includes(String(b.orderType || 'market')) ? String(b.orderType || 'market') : null;
        const tif = String(b.timeInForce || 'day').toLowerCase();
        if (!/^[A-Z.\-]{1,10}$/.test(symbol)) {
            res.status(400).json({ error: 'symbol_required', message: 'A ticker symbol is required.' });
            return;
        }
        if (side !== 'buy' && side !== 'sell') {
            res.status(400).json({ error: 'side_invalid', message: 'side must be buy or sell.' });
            return;
        }
        if (!type) {
            res.status(400).json({ error: 'order_type_invalid', message: `orderType must be one of ${ORDER_TYPES.join(', ')}.` });
            return;
        }
        if (tif !== 'day' && tif !== 'gtc') {
            res.status(400).json({ error: 'tif_invalid', message: 'timeInForce must be day or gtc.' });
            return;
        }
        const prices = { limit: num(b.limitPrice), stop: num(b.stopPrice), trailPct: num(b.trailPercent), trailPx: num(b.trailPrice) };
        const shape = priceShapeViolation(type, prices);
        if (shape) {
            res.status(400).json({ error: 'price_shape_invalid', message: shape });
            return;
        }
        try {
            await (0, trading_schema_1.ensureTradingSchema)(ctx.pool);
            const book = await (0, trading_routes_helpers_1.resolveBook)(ctx.pool, sub, req.query.book ?? b.book ?? req.query.mode ?? b.mode);
            if (!book.enabled && side === 'buy') {
                res.status(409).json({ error: 'book_disabled', message: `Account '${book.ref}' is view-only — turn on trading for this account before buying.` });
                return;
            }
            // Reference price for sizing + the notional guardrail: the operator's own price point when
            // there is one, otherwise the latest print from the book's rail.
            let refPrice = prices.limit ?? prices.stop ?? null;
            let latest = null;
            if (refPrice == null || num(b.notional) != null) {
                const md = (0, trading_1.getMarketData)(book.kind, sub);
                if (md.configured())
                    latest = await md.latestPrice(symbol).catch(() => null);
                if (refPrice == null)
                    refPrice = latest;
            }
            let qty = num(b.qty);
            const notional = num(b.notional);
            if (qty != null && notional != null) {
                res.status(400).json({ error: 'size_ambiguous', message: 'Size the order by shares OR by dollars — not both.' });
                return;
            }
            if (qty == null && notional != null) {
                if (!(refPrice && refPrice > 0)) {
                    res.status(503).json({ error: 'no_quote', message: `Cannot size ${symbol} by dollars — no price available. Enter a share count or a limit price.` });
                    return;
                }
                qty = Math.floor(notional / refPrice);
            }
            if (qty == null || !Number.isInteger(qty) || qty < 1) {
                res.status(400).json({ error: 'qty_invalid', message: 'Enter a whole number of shares (≥ 1) or a dollar amount that buys at least one share.' });
                return;
            }
            const g = (0, trading_routes_helpers_1.guardrails)();
            const violation = (0, trading_routes_helpers_1.guardrailViolation)(g, symbol, qty, refPrice ?? 0);
            if (violation) {
                res.status(422).json({ error: 'guardrail_blocked', message: violation, guardrails: g });
                return;
            }
            const rationale = String(b.rationale || '').trim() || `Operator direct ${side}: ${qty} ${symbol} (${type}${tif === 'gtc' ? ', GTC' : ''}).`;
            const params = { orderType: type, limitPrice: prices.limit, stopPrice: prices.stop, trailPercent: prices.trailPct, trailPrice: prices.trailPx, timeInForce: tif, refPrice, latest, notional };
            const artifact = JSON.stringify({ source: 'manual', symbol, side, qty, params, rationale, at: Date.now() });
            const hash = crypto.createHash('sha256').update(artifact).digest('hex');
            const sig = (await ctx.pool.query(`INSERT INTO oshal_trading_signals (user_sub, mode, book_id, source, title, body, symbols, indicators, content_hash)
           VALUES ($1,$2,$3,'manual',$4,$5,$6,$7,$8)
         ON CONFLICT (user_sub, book_id, content_hash) DO UPDATE SET observed_at = oshal_trading_signals.observed_at
         RETURNING signal_id`, [sub, book.kind, book.bookId, `Operator ${side} ${qty} ${symbol}`, rationale, [symbol], JSON.stringify(params), hash])).rows[0];
            const row = (await ctx.pool.query(`INSERT INTO oshal_trading_decisions
           (user_sub, mode, book_id, signal_ids, agent_id, action, symbol, side, qty, order_type, limit_price, stop_price, trail_price, trail_percent, time_in_force, confidence, rationale, indicators, guardrails)
         VALUES ($1,$2,$3,$4::uuid[],'operator',$5,$6,$5,$7,$8,$9,$10,$11,$12,$13,1,$14,$15,$16)
         RETURNING decision_id, created_at`, [sub, book.kind, book.bookId, [sig.signal_id], side, symbol, qty, type, prices.limit, prices.stop, prices.trailPx, prices.trailPct, tif, rationale, JSON.stringify(params), JSON.stringify(g)])).rows[0];
            logger.info({ sub, book: book.ref, symbol, side, qty, type, tif }, 'operator direct-trade decision minted');
            res.json({
                ok: true, decisionId: row.decision_id, createdAt: row.created_at, book: book.ref,
                decision: { action: side, symbol, side, qty, orderType: type, limitPrice: prices.limit, stopPrice: prices.stop, trailPercent: prices.trailPct, trailPrice: prices.trailPx, timeInForce: tif, rationale },
                refPrice, estNotional: refPrice ? qty * refPrice : null, requiresConfirm: book.kind === 'live',
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
}
//# sourceMappingURL=trading-manual-order-routes.js.map