"use strict";
/**
 * Trading order-flow route builders (ADR-052) — the signal → decision → order chain: capture and
 * list signals, run the analyst (/decide), place/list/refresh/rebind orders, and the ledger /
 * trace / journal provenance reads. placeDecisionOrder is INJECTED by trading-routes.ts (the
 * injection seam predates the engine split and is kept as-is — this module never imports the
 * entry, so no cycle). Registered second, preserving the original registration order.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-11 05:05:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Extracted from trading-routes.ts (1000-line cap decomposition): POST/GET /signals, POST /decide, POST/GET /orders, GET /orders/:orderId, POST /orders/:orderId/rebind, GET /ledger + /trace/:orderId + /journal. Handler code moved verbatim — zero behavior change.
 * 2026-07-15 19:05:00 | roger.murphy@emeraldcoastsystemsgroup.com   | POST /reconcile — reconcile the ledger to the broker's transaction history (books closes done outside the engine). DRY-RUN by default; ?apply=true commits and is OPERATOR-ONLY (isOperator). Delegates to reconcileLedger; never places an order, only writes historical ledger rows.
 * 2026-07-19 16:55:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Trading engine extraction (ADR-085 pre-carve): import repoints only — analyzeAndRecordDecision/recordOrder/rebindOrder from app/trading-engine.ts (was ./trading-routes-core, moved), ensureTradingSchema from app/trading-schema.ts (was ./trading-routes-schema, moved). placeDecisionOrder stays injected (now defined at the engine). Zero behavior change.
 * 2026-07-19 23:30:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Carved out of OSHAL core into the trading app package (ADR-085 Wave 3). Relative kernel imports flip to @/ aliases (helpers/schema/engine/daily-equity-store/reconcile-ledger ALL stay kernel — the dispatch loops and their specs import them). Handler bodies byte-identical, placeDecisionOrder still injected by the entry — zero behavior change.
 *
 * @module trading-routes-order-flow-builders
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
exports.registerTradingOrderFlowRoutes = registerTradingOrderFlowRoutes;
const crypto = __importStar(require("crypto"));
const logger_1 = require("@/shared/logger");
const trading_1 = require("@/features/trading");
const trading_routes_helpers_1 = require("@/app/routes/trading-routes-helpers");
const trading_schema_1 = require("@/app/trading-schema");
const trading_engine_1 = require("@/app/trading-engine");
const trading_daily_equity_store_1 = require("@/app/trading-daily-equity-store");
const trading_reconcile_ledger_1 = require("@/app/trading-reconcile-ledger");
const authz_1 = require("@/shared/middleware/authz");
// Same module tag as the entry file so structured log output is unchanged by the split.
const logger = (0, logger_1.createChildLogger)({ module: 'trading-routes' });
/**
 * @description Registers the signal → decision → order flow routes on the trading router. Auth is
 * enforced at the mount (`/api/trading` sits behind serviceSecretOr(requiresAuth) in server.ts)
 * plus each handler's own callerSub 401 check — unchanged from the pre-split file.
 * @param router - The trading router being composed by createTradingRoutes.
 * @param ctx - App context (Postgres pool for the per-user, per-mode stores).
 * @param placeDecisionOrder - The guarded order executor (injected from trading-routes.ts).
 * @returns Nothing — routes are registered on the passed router.
 */
function registerTradingOrderFlowRoutes(router, ctx, placeDecisionOrder) {
    /** POST /reconcile — reconcile the ledger to the broker's transaction history (books closes done
     *  outside the engine). DRY-RUN by default; ?apply=true commits and is OPERATOR-ONLY. Body:
     *  { symbols?: string[], manualCloses?: [{symbol,qty,price,costBasis,tradeDate,reason}] }. Never places
     *  an order — only writes historical ledger rows. */
    router.post('/reconcile', async (req, res) => {
        const sub = (0, trading_routes_helpers_1.callerSub)(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const apply = String(req.query.apply || '').toLowerCase() === 'true';
        // Operator-gate the mutating apply. Check the RESOLVED caller sub (via isOperatorIdentity), not
        // isOperator(req) — the latter reads only the OIDC session, so a trusted-service caller (the
        // operator's own service-secret + X-OSHAL-User-Sub) would be wrongly rejected.
        if (apply && !(0, authz_1.isOperatorIdentity)(sub)) {
            res.status(403).json({ error: 'operator_only', message: 'apply=true is operator-only; dry-run is open to the owner.' });
            return;
        }
        try {
            await (0, trading_schema_1.ensureTradingSchema)(ctx.pool);
            const mode = (0, trading_routes_helpers_1.resolveMode)(req.query.mode);
            const b = (req.body || {});
            const report = await (0, trading_reconcile_ledger_1.reconcileLedger)(ctx, sub, mode, { apply, symbols: b.symbols, manualCloses: b.manualCloses });
            res.json(report);
        }
        catch (err) {
            logger.error({ err }, 'trading reconcile failed');
            res.status(500).json({ error: err.message });
        }
    });
    /** POST /signals — capture a data-stream snapshot. Body: { mode?, source, symbols?, title?, body?, url?, author?, externalId?, indicators? }. */
    router.post('/signals', async (req, res) => {
        const sub = (0, trading_routes_helpers_1.callerSub)(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const b = (req.body || {});
        const source = String(b.source || '').trim();
        if (!source) {
            res.status(400).json({ error: 'source_required', message: 'source is required (news|x|inbox|manual).' });
            return;
        }
        try {
            await (0, trading_schema_1.ensureTradingSchema)(ctx.pool);
            const mode = (0, trading_routes_helpers_1.resolveMode)(b.mode);
            const symbols = Array.isArray(b.symbols) ? b.symbols.map((s) => String(s).toUpperCase()) : [];
            const artifact = JSON.stringify({ source, externalId: b.externalId, author: b.author, title: b.title, body: b.body, url: b.url });
            const contentHash = crypto.createHash('sha256').update(artifact).digest('hex');
            const row = (await ctx.pool.query(`INSERT INTO oshal_trading_signals (user_sub, mode, source, external_id, author, url, title, body, symbols, indicators, content_hash)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (user_sub, mode, content_hash) DO UPDATE SET observed_at = oshal_trading_signals.observed_at
         RETURNING signal_id, observed_at`, [sub, mode, source, b.externalId || null, b.author || null, b.url || null, b.title || null, b.body || null,
                symbols, b.indicators ? JSON.stringify(b.indicators) : null, contentHash])).rows[0];
            res.json({ ok: true, signalId: row.signal_id, observedAt: row.observed_at });
        }
        catch (err) {
            logger.error({ err }, 'trading signal capture failed');
            res.status(500).json({ error: err.message });
        }
    });
    /** GET /signals?mode= — recent captured signals for the active book. */
    router.get('/signals', async (req, res) => {
        const sub = (0, trading_routes_helpers_1.callerSub)(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            await (0, trading_schema_1.ensureTradingSchema)(ctx.pool);
            const mode = (0, trading_routes_helpers_1.resolveMode)(req.query.mode);
            const rows = (await ctx.pool.query(`SELECT signal_id, source, author, title, body, url, symbols, indicators, observed_at
           FROM oshal_trading_signals WHERE user_sub=$1 AND mode=$2 ORDER BY observed_at DESC LIMIT 50`, [sub, mode])).rows;
            res.json({ mode, signals: rows });
        }
        catch (err) {
            logger.error({ err }, 'trading signals list failed');
            res.status(500).json({ error: err.message });
        }
    });
    /** POST /decide — the trading-analyst reasons over the given signal(s) → a persisted decision tree.
     *  Body: { mode?, signalIds: string[] }. Does NOT place an order; it produces the justification. */
    router.post('/decide', async (req, res) => {
        const sub = (0, trading_routes_helpers_1.callerSub)(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const b = (req.body || {});
        const signalIds = Array.isArray(b.signalIds) ? b.signalIds.map(String) : [];
        if (!signalIds.length) {
            res.status(400).json({ error: 'signal_ids_required', message: 'Provide at least one signalId to reason over.' });
            return;
        }
        try {
            await (0, trading_schema_1.ensureTradingSchema)(ctx.pool);
            const mode = (0, trading_routes_helpers_1.resolveMode)(b.mode);
            const signals = (await ctx.pool.query(`SELECT signal_id, source, author, title, body, url, symbols, indicators, observed_at
           FROM oshal_trading_signals WHERE user_sub=$1 AND mode=$2 AND signal_id = ANY($3::uuid[])`, [sub, mode, signalIds])).rows;
            if (!signals.length) {
                res.status(404).json({ error: 'signals_not_found', message: 'No matching signals for this book.' });
                return;
            }
            const { decisionId, createdAt, decision } = await (0, trading_engine_1.analyzeAndRecordDecision)(ctx, sub, mode, signals);
            res.json({ ok: true, decisionId, createdAt, decision });
        }
        catch (err) {
            logger.error({ err }, 'trading decide failed');
            res.status(502).json({ error: err.message });
        }
    });
    /** POST /orders — place the order a decision proposes. Body: { mode?, decisionId, requestId, confirm? }.
     *  The order CANNOT exist without a decision (FK). Guardrails enforced; live needs confirm + the gate. */
    router.post('/orders', async (req, res) => {
        const sub = (0, trading_routes_helpers_1.callerSub)(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const b = (req.body || {});
        if (!b.decisionId) {
            res.status(400).json({ error: 'decision_required', message: 'A decisionId is required — every trade must be justified.' });
            return;
        }
        if (!b.requestId) {
            res.status(400).json({ error: 'request_id_required', message: 'A client requestId is required for idempotency.' });
            return;
        }
        try {
            await (0, trading_schema_1.ensureTradingSchema)(ctx.pool);
            const mode = (0, trading_routes_helpers_1.resolveMode)(b.mode);
            const result = await placeDecisionOrder(ctx.pool, sub, mode, String(b.decisionId), String(b.requestId), b.confirm === true);
            res.json({ ok: true, order: result });
        }
        catch (err) {
            if (err instanceof trading_routes_helpers_1.TradingError) {
                res.status(err.httpStatus).json({ error: err.code, message: err.message });
                return;
            }
            logger.error({ err }, 'trading order place failed');
            res.status(502).json({ error: 'order_failed', message: err.message });
        }
    });
    /** GET /orders?mode= — the ledger: order history for the active book (cheap read). */
    router.get('/orders', async (req, res) => {
        const sub = (0, trading_routes_helpers_1.callerSub)(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            await (0, trading_schema_1.ensureTradingSchema)(ctx.pool);
            const mode = (0, trading_routes_helpers_1.resolveMode)(req.query.mode);
            const rows = (await ctx.pool.query(`SELECT order_id, decision_id, broker, broker_order_id, symbol, side, qty, order_type, limit_price,
                status, filled_qty, filled_avg_price, realized_pnl, reject_reason, created_at, updated_at
           FROM oshal_trading_orders WHERE user_sub=$1 AND mode=$2 ORDER BY created_at DESC LIMIT 100`, [sub, mode])).rows;
            res.json({ mode, orders: rows });
        }
        catch (err) {
            logger.error({ err }, 'trading orders list failed');
            res.status(500).json({ error: err.message });
        }
    });
    /** GET /orders/:orderId — refresh one order's status from the broker (owner-scoped) and persist it. */
    router.get('/orders/:orderId', async (req, res) => {
        const sub = (0, trading_routes_helpers_1.callerSub)(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            const row = (await ctx.pool.query(`SELECT mode, decision_id, client_order_id, broker_order_id FROM oshal_trading_orders
           WHERE order_id=$1 AND user_sub=$2`, [String(req.params.orderId), sub])).rows[0];
            if (!row || !row.broker_order_id) {
                res.status(404).json({ error: 'not_found' });
                return;
            }
            const broker = (0, trading_1.getBrokerReader)(row.mode, sub); // read — refresh one order's status
            const result = await broker.getOrder(String(row.broker_order_id));
            await (0, trading_engine_1.recordOrder)(ctx.pool, sub, row.mode, String(row.decision_id), String(row.client_order_id), result);
            res.json({ order: result });
        }
        catch (err) {
            logger.error({ err }, 'trading order refresh failed');
            res.status(502).json({ error: err.message });
        }
    });
    /** POST /orders/:orderId/rebind — re-find this order at its venue and bind the row to the real
     *  broker id (owner-scoped). For rows whose id was never surfaced or was overwritten. */
    router.post('/orders/:orderId/rebind', async (req, res) => {
        const sub = (0, trading_routes_helpers_1.callerSub)(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            res.json(await (0, trading_engine_1.rebindOrder)(ctx.pool, sub, String(req.params.orderId)));
        }
        catch (err) {
            if (err instanceof trading_routes_helpers_1.TradingError) {
                res.status(err.httpStatus).json({ error: err.code, message: err.message });
                return;
            }
            logger.error({ err }, 'trading order rebind failed');
            res.status(502).json({ error: 'rebind_failed', message: err.message });
        }
    });
    /** GET /ledger?mode= — the book header: account + positions + recent orders, one call. */
    router.get('/ledger', async (req, res) => {
        const sub = (0, trading_routes_helpers_1.callerSub)(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            await (0, trading_schema_1.ensureTradingSchema)(ctx.pool);
            const mode = (0, trading_routes_helpers_1.resolveMode)(req.query.mode);
            const broker = (0, trading_1.getBrokerReader)(mode, sub); // read — the ledger header (account + positions)
            const configured = broker.configured();
            const [account, positions] = configured
                ? await Promise.all([broker.getAccount().catch(() => null), broker.getPositions().catch(() => [])])
                : [null, []];
            const orders = (await ctx.pool.query(`SELECT order_id, decision_id, symbol, side, qty, order_type, status, filled_qty, filled_avg_price, created_at
           FROM oshal_trading_orders WHERE user_sub=$1 AND mode=$2 ORDER BY created_at DESC LIMIT 25`, [sub, mode])).rows;
            // ONE honest, consolidated day P&L = current equity − the prior session's close. We trust our OWN
            // daily snapshot (recorded each fire/read) — Alpaca's lastEquity / portfolio-history latest row can be
            // a phantom (observed lastEquity $105,694 vs a real ~$102,315 prior close on a flat day). Record
            // today's equity, then read the prior close from the store; only if there's no prior day yet (first
            // day) fall back to portfolio history, UTC-dated to skip today's in-progress/odd row. Non-fatal.
            let day = null;
            try {
                const eq = account && Number.isFinite(Number(account.equity)) ? Number(account.equity) : null;
                if (eq != null) {
                    await (0, trading_daily_equity_store_1.recordDailyEquity)(ctx.pool, sub, mode, eq);
                    let priorClose = await (0, trading_daily_equity_store_1.loadPriorCloseEquity)(ctx.pool, sub, mode);
                    if (priorClose == null && configured && broker.portfolioHistory) {
                        const ph = await broker.portfolioHistory('1M', '1D').catch(() => null);
                        if (ph) {
                            const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);
                            const today = utcDay(Date.now());
                            for (let i = 0; i < ph.t.length; i++) {
                                const e = Number(ph.equity[i]);
                                if (Number.isFinite(e) && e > 0 && utcDay(ph.t[i] * 1000) < today)
                                    priorClose = e;
                            }
                        }
                    }
                    if (priorClose != null) {
                        const dpl = eq - priorClose;
                        day = { priorCloseEquity: priorClose, dayPL: dpl, dayPLPct: priorClose > 0 ? (dpl / priorClose) * 100 : 0 };
                    }
                }
            }
            catch { /* leave day null — the cockpit falls back to the intraday sum */ }
            res.json({ mode, configured, account, positions, orders, day });
        }
        catch (err) {
            logger.error({ err }, 'trading ledger failed');
            res.status(502).json({ error: err.message });
        }
    });
    /** GET /trace/:orderId — the full provenance: order → decision → the signal(s) that triggered it.
     *  This is the "why" behind a trade — the auditable decision tree back to the exact tweet/headline. */
    router.get('/trace/:orderId', async (req, res) => {
        const sub = (0, trading_routes_helpers_1.callerSub)(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            await (0, trading_schema_1.ensureTradingSchema)(ctx.pool);
            const order = (await ctx.pool.query(`SELECT * FROM oshal_trading_orders WHERE order_id=$1 AND user_sub=$2`, [String(req.params.orderId), sub])).rows[0];
            if (!order) {
                res.status(404).json({ error: 'not_found' });
                return;
            }
            const decision = (await ctx.pool.query(`SELECT * FROM oshal_trading_decisions WHERE decision_id=$1 AND user_sub=$2`, [order.decision_id, sub])).rows[0];
            const signalIds = decision?.signal_ids || [];
            const signals = signalIds.length
                ? (await ctx.pool.query(`SELECT signal_id, source, author, title, body, url, symbols, indicators, observed_at
               FROM oshal_trading_signals WHERE user_sub=$1 AND signal_id = ANY($2::uuid[])`, [sub, signalIds])).rows
                : [];
            res.json({ order, decision, signals });
        }
        catch (err) {
            logger.error({ err }, 'trading trace failed');
            res.status(500).json({ error: err.message });
        }
    });
    /** GET /journal?mode= — the dashboard's centerpiece: recent trades, each already joined to its
     *  decision (action + rationale + confidence) AND the signal(s) that triggered it, in ONE call.
     *  This is the "what did the bot do, and why" feed — no per-row trace round-trips. */
    router.get('/journal', async (req, res) => {
        const sub = (0, trading_routes_helpers_1.callerSub)(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            await (0, trading_schema_1.ensureTradingSchema)(ctx.pool);
            const mode = (0, trading_routes_helpers_1.resolveMode)(req.query.mode);
            const orders = (await ctx.pool.query(`SELECT o.order_id, o.symbol, o.side, o.qty, o.order_type, o.limit_price, o.stop_price,
                o.trail_price, o.trail_percent, o.status, o.filled_qty, o.filled_avg_price,
                o.realized_pnl, o.reject_reason, o.created_at,
                d.decision_id, d.action, d.rationale, d.confidence, d.signal_ids
           FROM oshal_trading_orders o
           JOIN oshal_trading_decisions d ON d.decision_id = o.decision_id
          WHERE o.user_sub=$1 AND o.mode=$2 ORDER BY o.created_at DESC LIMIT 100`, [sub, mode])).rows;
            // Fetch every referenced signal once, then stitch onto each trade.
            const allIds = [...new Set(orders.flatMap((o) => (o.signal_ids || [])))];
            const sigById = new Map();
            if (allIds.length) {
                const sigs = (await ctx.pool.query(`SELECT signal_id, source, author, title, body, url, symbols, observed_at
             FROM oshal_trading_signals WHERE user_sub=$1 AND signal_id = ANY($2::uuid[])`, [sub, allIds])).rows;
                for (const s of sigs)
                    sigById.set(String(s.signal_id), s);
            }
            const trades = orders.map((o) => ({
                ...o,
                signals: (o.signal_ids || []).map((id) => sigById.get(id)).filter(Boolean),
            }));
            res.json({ mode, trades });
        }
        catch (err) {
            logger.error({ err }, 'trading journal failed');
            res.status(500).json({ error: err.message });
        }
    });
}
//# sourceMappingURL=trading-routes-order-flow-builders.js.map