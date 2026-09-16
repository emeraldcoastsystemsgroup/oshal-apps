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
 * 5 | maintainer@emeraldcoastsystemsgroup.com | GET /orders and the /journal trades price each close on the engine's own cost (priceOrdersOnEngineCost over core engineRealizedForBook): realized_pnl is the engine figure, venue_realized_pnl the stored venue-basis one, which counts each wash-sale disallowed loss twice. A close the ledger cannot price shows no gain/loss rather than a guessed one.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | GET /ledger answers `governance` beside `positions` (ADR-159): per symbol, whether the engine's protective exit set runs, whether it emits any order at all, and in the operator's words why not. /ledger is THE positions payload the hub paints from, and it carried no trace of a rule the engine has been enforcing since #486/#497 - the operator could see a holding with no stop and no exit and no way to tell that was deliberate. Every part of the answer is the kernel's: subtractPinnedLots + withEngineCostBasis over the same pinned-subtracted positions the dispatch costs, then positionGovernance. A failed read answers `{}` and the surface says NOT KNOWN for those rows - it never says managed about a position nobody could check.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | GET /ledger stops disagreeing with itself, and answers for the position it was silently skipping. (a) `positions` is the RAW venue array while the governance beside it is computed over `subtractPinnedLots(positions, pinned)`, so a partially pinned symbol showed the full quantity next to a sentence about the smaller one - one payload, two numbers, on the same screen. Each answer now carries the two quantities it was measured between (heldQty, the row; governedQty, what the autopilot can act on), both taken from the kernel's OWN subtraction, so the surface can say which is which instead of leaving the operator to reconcile them. (b) `subtractPinnedLots` DROPS a symbol whose every share is pinned, so a fully protected holding reached no governance answer at all and the surface's fallback called it NOT KNOWN - a deliberately protected position shown as unexamined, which is ADR-159's own failure inverted. Such a symbol - present at the venue, absent from the kernel's subtraction - now gets the kernel's `pinnedInFullGovernance`. The words and the reason code are core's; the only thing decided here is which symbols core's subtraction dropped, read off that subtraction's own output.
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
exports.ledgerGovernance = ledgerGovernance;
exports.registerTradingOrderFlowRoutes = registerTradingOrderFlowRoutes;
const crypto = __importStar(require("crypto"));
const logger_1 = require("@/shared/logger");
const trading_1 = require("@/features/trading");
const trading_engine_cost_basis_1 = require("@/app/trading-engine-cost-basis");
const trading_pinned_lots_1 = require("@/app/trading-pinned-lots");
const trading_config_overrides_1 = require("@/app/trading-config-overrides");
const trading_dispatch_core_1 = require("@/app/trading-dispatch-core");
const trading_position_governance_1 = require("@/app/trading-position-governance");
const trading_routes_helpers_1 = require("@/app/routes/trading-routes-helpers");
const trading_books_store_1 = require("@/app/trading-books-store");
const trading_schema_1 = require("@/app/trading-schema");
const trading_engine_1 = require("@/app/trading-engine");
const trading_daily_equity_store_1 = require("@/app/trading-daily-equity-store");
const trading_reconcile_ledger_1 = require("@/app/trading-reconcile-ledger");
const trading_realized_1 = require("./trading-realized");
const authz_1 = require("@/shared/middleware/authz");
// Same module tag as the entry file so structured log output is unchanged by the split.
const logger = (0, logger_1.createChildLogger)({ module: 'trading-routes' });
/**
 * @description The engine's OWN answer, per symbol, for what it will and will not do with this
 * book's positions (ADR-159) — so the positions table can mark a holding the engine withholds for
 * instead of leaving the operator to discover a missing stop by its absence.
 *
 * Every part of the answer comes from the kernel: `subtractPinnedLots` + `withEngineCostBasis`
 * attach the same `unmanaged` / `engineAvgCost` marks the dispatch reads, over the SAME
 * pinned-subtracted positions the dispatch costs, and `positionGovernance` restates them. Nothing
 * here re-derives "is this unmanaged?" — a second answer to that question is exactly what would
 * drift away from the engine's.
 *
 * A failed read answers `{}`, and a symbol with no entry reads NOT KNOWN on the surface. That is
 * deliberate: the protected-lot ledger decides which shares the engine may act on at all, so
 * without it the coverage comparison is not a fact — and the engine skips the fire for the same
 * reason. `withEngineCostBasis` never throws; its own failed read leaves the marks off, which lands
 * in the same "not known" state one position at a time.
 *
 * ONE case is not a failed look and must never read as one. `subtractPinnedLots` drops a symbol
 * whose residual is zero, so a holding entirely inside protected lots reaches nothing that could
 * govern it — and "not known" about a position the operator deliberately protected is this whole
 * readout inverted. The symbols that happens to are exactly the ones the venue reports and that
 * subtraction dropped, which is read off the subtraction's own output rather than recomputed, and
 * the answer for them is the kernel's `pinnedInFullGovernance` — its reason code and its words.
 *
 * @param ctx - App context (pool).
 * @param sub - Caller sub.
 * @param book - The resolved book.
 * @param positions - The venue positions this response carries, as the payload carries them.
 * @returns UPPER-CASE symbol → the engine's posture and the two quantities it was measured
 *   between, or `{}` when it could not be determined. Exported so the guard can drive THIS
 *   function - the ledger read, the cost attachment and the ring-fence parse together - rather
 *   than a restatement of it.
 */
async function ledgerGovernance(ctx, sub, book, positions) {
    if (!positions.length)
        return {};
    try {
        const [pinned, override] = await Promise.all([
            (0, trading_pinned_lots_1.pinnedQtyBySymbol)(ctx.pool, sub, book.bookId),
            (0, trading_config_overrides_1.getActiveOverride)(ctx.pool, sub, book.bookId),
        ]);
        const visible = (0, trading_pinned_lots_1.subtractPinnedLots)(positions, pinned);
        const costed = await (0, trading_engine_cost_basis_1.withEngineCostBasis)(ctx, sub, book, visible);
        const answered = (0, trading_position_governance_1.positionGovernanceBySymbol)(costed, (0, trading_dispatch_core_1.coreConfig)(override));
        const governedQty = new Map();
        for (const p of visible)
            governedQty.set(p.symbol.toUpperCase(), Number(p.qty));
        const out = {};
        for (const p of positions) {
            const symbol = p.symbol.toUpperCase();
            const heldQty = Number(p.qty);
            const governed = governedQty.get(symbol);
            if (governed === undefined) {
                // The kernel's own subtraction dropped it, which it does for one reason: every share is
                // in a protected lot. Long-only, because a pin is a long lot and core answers NOT KNOWN
                // for anything else rather than guessing - leaving the entry off keeps that answer.
                if (heldQty > 0)
                    out[symbol] = { ...(0, trading_position_governance_1.pinnedInFullGovernance)(symbol, heldQty), heldQty, governedQty: 0 };
                continue;
            }
            const g = answered[symbol];
            if (g)
                out[symbol] = { ...g, heldQty, governedQty: governed };
        }
        return out;
    }
    catch (err) {
        logger.error({ err, bookId: book.bookId }, 'ledger governance unavailable — the positions table will say NOT KNOWN rather than managed');
        return {};
    }
}
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
            // ADR-134 honest limit: the venue-transaction reconcile still rides the LEGACY account
            // binding. Refuse non-legacy books rather than reconcile the wrong account's transactions
            // (PR4-hardening lifts this by threading the book through reconcileLedger's venue reads).
            const rbook = await (0, trading_routes_helpers_1.resolveBook)(ctx.pool, sub, req.query.book ?? req.query.mode);
            if (rbook.ref !== 'paper' && rbook.ref !== 'live') {
                res.status(400).json({ error: 'book_not_supported', message: `Ledger reconcile supports the legacy books for now — '${rbook.ref}' would be reconciled against the wrong venue account.` });
                return;
            }
            const mode = rbook.kind;
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
            const book = await (0, trading_routes_helpers_1.resolveBook)(ctx.pool, sub, req.query.book ?? b.book ?? req.query.mode ?? b.mode);
            const mode = book.kind;
            const symbols = Array.isArray(b.symbols) ? b.symbols.map((s) => String(s).toUpperCase()) : [];
            const artifact = JSON.stringify({ source, externalId: b.externalId, author: b.author, title: b.title, body: b.body, url: b.url });
            const contentHash = crypto.createHash('sha256').update(artifact).digest('hex');
            const row = (await ctx.pool.query(`INSERT INTO oshal_trading_signals (user_sub, mode, book_id, source, external_id, author, url, title, body, symbols, indicators, content_hash)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (user_sub, book_id, content_hash) DO UPDATE SET observed_at = oshal_trading_signals.observed_at
         RETURNING signal_id, observed_at`, [sub, mode, book.bookId, source, b.externalId || null, b.author || null, b.url || null, b.title || null, b.body || null,
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
            const book = await (0, trading_routes_helpers_1.resolveBook)(ctx.pool, sub, req.query.book ?? req.query.mode);
            const mode = book.kind;
            const rows = (await ctx.pool.query(`SELECT signal_id, source, author, title, body, url, symbols, indicators, observed_at
           FROM oshal_trading_signals WHERE user_sub=$1 AND book_id=$2 ORDER BY observed_at DESC LIMIT 50`, [sub, book.bookId])).rows;
            res.json({ mode, book: book.ref, signals: rows });
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
            const book = await (0, trading_routes_helpers_1.resolveBook)(ctx.pool, sub, req.query.book ?? b.book ?? req.query.mode ?? b.mode);
            const signals = (await ctx.pool.query(`SELECT signal_id, source, author, title, body, url, symbols, indicators, observed_at
           FROM oshal_trading_signals WHERE user_sub=$1 AND book_id=$2 AND signal_id = ANY($3::uuid[])`, [sub, book.bookId, signalIds])).rows;
            if (!signals.length) {
                res.status(404).json({ error: 'signals_not_found', message: 'No matching signals for this book.' });
                return;
            }
            const { decisionId, createdAt, decision } = await (0, trading_engine_1.analyzeAndRecordDecision)(ctx, sub, book, signals);
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
            const book = await (0, trading_routes_helpers_1.resolveBook)(ctx.pool, sub, req.query.book ?? b.book ?? req.query.mode ?? b.mode);
            const result = await placeDecisionOrder(ctx.pool, sub, book, String(b.decisionId), String(b.requestId), b.confirm === true);
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
            const book = await (0, trading_routes_helpers_1.resolveBook)(ctx.pool, sub, req.query.book ?? req.query.mode);
            const mode = book.kind;
            const rows = (await ctx.pool.query(`SELECT order_id, decision_id, broker, broker_order_id, symbol, side, qty, order_type, limit_price,
                status, filled_qty, filled_avg_price, realized_pnl, reject_reason, created_at, updated_at
           FROM oshal_trading_orders WHERE user_sub=$1 AND book_id=$2 ORDER BY created_at DESC LIMIT 100`, [sub, book.bookId])).rows;
            // Each close's gain/loss on the engine's own cost; the venue's figure rides along as venue_realized_pnl.
            res.json({ mode, book: book.ref, orders: await (0, trading_realized_1.priceOrdersOnEngineCost)(ctx, sub, book.bookId, rows) });
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
            const row = (await ctx.pool.query(`SELECT mode, book_id, decision_id, client_order_id, broker_order_id FROM oshal_trading_orders
           WHERE order_id=$1 AND user_sub=$2`, [String(req.params.orderId), sub])).rows[0];
            if (!row || !row.broker_order_id) {
                res.status(404).json({ error: 'not_found' });
                return;
            }
            // ADR-134: the refresh reads the order's OWN book's venue account — an unbound reader would
            // query the legacy account for a non-legacy book's order (the wrong-balances class).
            const rowBook = row.book_id ? await (0, trading_books_store_1.loadBook)(ctx.pool, sub, String(row.book_id)) : null;
            const broker = (0, trading_1.getBrokerReader)(row.mode, sub, rowBook?.accountNumber ? { accountNumber: rowBook.accountNumber, connectionKey: rowBook.connectionKey } : undefined);
            const result = await broker.getOrder(String(row.broker_order_id));
            await (0, trading_engine_1.recordOrder)(ctx.pool, sub, rowBook ?? row.mode, String(row.decision_id), String(row.client_order_id), result);
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
    /** GET /ledger?book=|mode= — the book header: account + positions + recent orders, one call.
     *  ADR-134: THE hub's data source — an unconverted mode-only read here showed the LEGACY live
     *  account's balances on every live-kind book (the operator's "wrong balances" bug). The reader
     *  binds to the BOOK's account and every DB read/write keys the book. */
    router.get('/ledger', async (req, res) => {
        const sub = (0, trading_routes_helpers_1.callerSub)(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            await (0, trading_schema_1.ensureTradingSchema)(ctx.pool);
            const book = await (0, trading_routes_helpers_1.resolveBook)(ctx.pool, sub, req.query.book ?? req.query.mode);
            const mode = book.kind;
            const broker = (0, trading_1.getBrokerReader)(mode, sub, book.accountNumber ? { accountNumber: book.accountNumber, connectionKey: book.connectionKey } : undefined);
            const configured = broker.configured();
            const [account, positions] = configured
                ? await Promise.all([broker.getAccount().catch(() => null), broker.getPositions().catch(() => [])])
                : [null, []];
            const orders = (await ctx.pool.query(`SELECT order_id, decision_id, symbol, side, qty, order_type, status, filled_qty, filled_avg_price, created_at
           FROM oshal_trading_orders WHERE user_sub=$1 AND book_id=$2 ORDER BY created_at DESC LIMIT 25`, [sub, book.bookId])).rows;
            // ONE honest, consolidated day P&L = current equity − the prior session's close. We trust our OWN
            // daily snapshot (recorded each fire/read) — Alpaca's lastEquity / portfolio-history latest row can be
            // a phantom (observed lastEquity $105,694 vs a real ~$102,315 prior close on a flat day). Record
            // today's equity, then read the prior close from the store; only if there's no prior day yet (first
            // day) fall back to portfolio history, UTC-dated to skip today's in-progress/odd row. Non-fatal.
            let day = null;
            try {
                const eq = account && Number.isFinite(Number(account.equity)) ? Number(account.equity) : null;
                if (eq != null) {
                    await (0, trading_daily_equity_store_1.recordDailyEquity)(ctx.pool, sub, book, eq);
                    let priorClose = await (0, trading_daily_equity_store_1.loadPriorCloseEquity)(ctx.pool, sub, book);
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
            const governance = await ledgerGovernance(ctx, sub, book, positions);
            res.json({ mode, book: book.ref, configured, account, positions, orders, day, governance });
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
            const book = await (0, trading_routes_helpers_1.resolveBook)(ctx.pool, sub, req.query.book ?? req.query.mode);
            const mode = book.kind;
            const orders = (await ctx.pool.query(`SELECT o.order_id, o.symbol, o.side, o.qty, o.order_type, o.limit_price, o.stop_price,
                o.trail_price, o.trail_percent, o.status, o.filled_qty, o.filled_avg_price,
                o.realized_pnl, o.reject_reason, o.created_at,
                d.decision_id, d.action, d.rationale, d.confidence, d.signal_ids
           FROM oshal_trading_orders o
           JOIN oshal_trading_decisions d ON d.decision_id = o.decision_id
          WHERE o.user_sub=$1 AND o.book_id=$2 ORDER BY o.created_at DESC LIMIT 100`, [sub, book.bookId])).rows;
            // Fetch every referenced signal once, then stitch onto each trade.
            const allIds = [...new Set(orders.flatMap((o) => (o.signal_ids || [])))];
            const sigById = new Map();
            if (allIds.length) {
                const sigs = (await ctx.pool.query(`SELECT signal_id, source, author, title, body, url, symbols, observed_at
             FROM oshal_trading_signals WHERE user_sub=$1 AND signal_id = ANY($2::uuid[])`, [sub, allIds])).rows;
                for (const s of sigs)
                    sigById.set(String(s.signal_id), s);
            }
            const priced = await (0, trading_realized_1.priceOrdersOnEngineCost)(ctx, sub, book.bookId, orders);
            const trades = priced.map((o) => ({
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