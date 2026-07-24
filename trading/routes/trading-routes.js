"use strict";
/**
 * Trading routes — the stock-trading app (ADR-052).
 *
 * Split, same as finance / kid-lens / the comms swarm:
 *  - **Execution + reads** (deterministic, no LLM) run here in the controller: record a
 *    signal snapshot, place/inspect an order via the provider-agnostic BrokerAdapter
 *    (@/features/trading), and read the account/positions/ledger.
 *  - **Reasoning** (the decision: does this signal warrant a trade, and what trade?) ALWAYS
 *    runs on the accountable trading-analyst bot via BotNodeClient.execute, so per-call cost
 *    lands in chat_tasks under the bot's own agent_id (ADR-036). The bot is reason-only (no
 *    broker, no CLI), so it runs INLINE on the api container — same path as finance-analyst.
 *
 * The invariant (ADR-052): every order is justified. The data layer enforces it —
 * oshal_trading_orders.decision_id is NOT NULL + FK, and a decision records the signal(s) it
 * reasoned over. So the chain signal -> decision -> order is unbreakable: from any fill you
 * can walk back to the exact tweet/headline and the indicators that moved the bot.
 *
 * Dual ledger: `mode` (paper|live) partitions every store and selects a physically separate
 * broker account. v1 ships PAPER-ONLY by default; a live order requires both
 * TRADING_LIVE_ENABLED=true (broker-provider gate) AND an explicit confirm flag.
 *
 * Every route is requiresAuth-gated at mount (auth is opt-in per route, CLAUDE.md).
 *
 * This file is the MOUNT ENTRY of the trading-routes module family (1000-line cap split):
 * shared helpers live in trading-routes-helpers.ts and the route groups in
 * trading-routes-{book-read,order-flow,algo}-builders.ts. The ENGINE — schema bootstrap,
 * analyst/order core, placeDecisionOrder, resolveMaturedPredictions — lives in
 * src/app/trading-{schema,engine}.ts, which this surface (and the background loops) consume.
 * placeDecisionOrder's env-level live gate (live_blocked) is source-guarded at the engine;
 * POST /trigger stays HERE and keeps the surface's route-level approval gate (live tickets
 * park in backlog), source-guarded in this file by tests/unit/risky-write-guards.spec.ts.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-06-18 00:00:00 | roger.murphy@emeraldcoastsystemsgroup.com | Initial — GET /status (per-mode broker config + counts), GET /account + /positions + /ledger (cheap broker reads), POST /signals + GET /signals (data-stream snapshots), POST /decide (trading-analyst reasons over signals -> persisted decision tree), POST /orders (guarded execution: decision required, guardrails enforced, live needs confirm) + GET /orders + GET /orders/:id (status refresh), GET /trace/:id (order -> decision -> signals provenance). Paper-only by default.
 * 2026-06-23 10:35:00 | roger.murphy@emeraldcoastsystemsgroup.com | Export recordOrder so the new autopilot reconciliation loop (trading-reconcile.ts) reuses the same fill upsert — fixes orders frozen at submit-time pending_new while the venue had filled them.
 * 2026-07-06 00:00:00 | roger.murphy@emeraldcoastsystemsgroup.com | Wire the Schwab LIVE rail: register the per-user Schwab token resolver (getValidAccessToken) at router creation, and thread the caller sub through every getBrokerAdapter(mode, sub) call site (account/positions/performance/ledger/status-live/order-refresh + the placeDecisionOrder/analyze helpers) so the Schwab adapter can resolve that user's brokered token. Alpaca (paper/autopilot) ignores the sub — unchanged.
 * 2026-07-06 00:00:00 | roger.murphy@emeraldcoastsystemsgroup.com | Data plane: route the live book's price reads through the per-mode getMarketData(mode, sub) source (Schwab Market Data API for live, Alpaca IEX for paper) — algoEnsembleDecision + the extended-hours order-pricing quote — and add GET /quote (latest price from the active book's source). Broad market-recommendation scans stay on the Alpaca IEX feed by design (market-wide data vendor, not account-specific).
 * 2026-07-06 00:00:00 | roger.murphy@emeraldcoastsystemsgroup.com | Use getBrokerReader (ungated reads) for the account/positions/performance/ledger/order-refresh/status-config reads + the decide-path cash context, so a connected LIVE Schwab account is viewable without arming live trading. Order placement (placeDecisionOrder) alone keeps the gated getBrokerAdapter.
 * 2026-07-08 12:20:00 | roger.murphy@emeraldcoastsystemsgroup.com | Two order-ledger fixes. (1) Extended-hours limits are priced from latestTrade() and REFUSED (409 stale_quote) when the last print is older than TRADING_EXT_QUOTE_MAX_AGE_SEC: latestPrice discarded the trade timestamp, so an off-hours limit pinned to an hours-old print never became marketable and was cancel/re-placed every 5-min fire — 525 dead orders over 30h (MRNA 97× at a frozen 79.54 while it fell to 74.61), with the "protective" exit never filling. Also dropped the silent `?? effLimit ?? refPrice` fallback, which hid a missing quote behind a stale decision price. (2) recordOrder's upsert is book-scoped: ON CONFLICT (user_sub, mode, client_order_id) over a matching unique index, so a paper fill can no longer overwrite a live order's broker id.
 * 2026-07-08 13:30:00 | roger.murphy@emeraldcoastsystemsgroup.com | rebindOrder + POST /orders/:orderId/rebind — re-find an order at its venue (listOrders, matched on symbol+side+qty inside a 15-min window around created_at) and persist the broker's own state over the row. Recovers rows whose broker id was never surfaced or was overwritten by the cross-book collision; refuses to bind when the window does not hold exactly one match, so a wrong trade can never be adopted.
 * 2026-07-11 05:05:00 | roger.murphy@emeraldcoastsystemsgroup.com | 1000-line cap decomposition (1186 code lines → split): moved shared helpers, the schema bootstrap, the analyst/order core, and the book-read / order-flow / algo+tuning route groups into sibling trading-routes-* modules, all handler code verbatim. This file remains the entry: createTradingRoutes keeps its exact signature and registration order, placeDecisionOrder + POST /trigger stay here (live-gate strings are source-guarded in this file), and the entire prior public API is re-exported so no consumer import changes. Zero route/behavior change.
 * 2026-07-19 16:55:00 | roger.murphy@emeraldcoastsystemsgroup.com | Trading engine extraction (ADR-085 pre-carve): placeDecisionOrder moved VERBATIM to app/trading-engine.ts (with trading-routes-core.ts and the schema bootstrap → app/trading-schema.ts), because 8 kernel dispatch/reconcile loops need the engine and must not import the carvable route surface. This file is now pure surface: createTradingRoutes (unchanged signature + registration order) + POST /trigger (its live-approval gate stays here, source-guarded). The pre-split re-export block removed — every consumer now imports the engine modules directly. Pure code motion — zero route/behavior change.
 * 2026-07-19 23:30:00 | roger.murphy@emeraldcoastsystemsgroup.com | Carved out of OSHAL core into the trading app package (ADR-085 Wave 3, "skill with a surface"). Standard (ctx) factory (the ManifestRouteMounter contract); the surface serves trading.html from ctx.appPackageDir/tools (load-time env fallback, D10) through the kernel's servePage helper. Relative imports flip to @/ aliases: @/app/routes/trading-routes-helpers (callerSub/resolveMode/servePage/guardrails — global-search + the engine also import them, they stay kernel), @/app/routes/connectors-routes (getValidAccessToken), @/app/trading-{schema,engine} (the ENGINE — stays kernel, the 8 dispatch/reconcile loops import it; D8 verified NOT orphaned). Route bodies byte-identical: POST /trigger keeps its route-level live-approval gate VERBATIM (live tickets park in backlog — source-guarded by this package's tests/trading-surface-live-gate.spec.ts; the engine's env-level live_blocked gate stays kernel-guarded in risky-write-guards.spec.ts).
 *
 * @module trading-routes
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
exports.surfaceDir = surfaceDir;
exports.createTradingRoutes = createTradingRoutes;
const express_1 = require("express");
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const logger_1 = require("@/shared/logger");
const trading_1 = require("@/features/trading");
const connectors_routes_1 = require("@/app/routes/connectors-routes");
const ticket_1 = require("@/entities/ticket");
const trading_routes_helpers_1 = require("@/app/routes/trading-routes-helpers");
const trading_schema_1 = require("@/app/trading-schema");
const trading_engine_1 = require("@/app/trading-engine");
const trading_routes_book_read_builders_1 = require("./trading-routes-book-read-builders");
const trading_routes_order_flow_builders_1 = require("./trading-routes-order-flow-builders");
const trading_routes_algo_builders_1 = require("./trading-routes-algo-builders");
const logger = (0, logger_1.createChildLogger)({ module: 'trading-routes' });
/** Load-time-only fallback for frameworks predating ctx.appPackageDir (D10). */
const LOAD_TIME_PACKAGE_DIR = process.env.OSHAL_APP_PACKAGE_DIR || '';
/**
 * @description Resolve the package tools/ directory holding the bundled surface (trading.html):
 * ctx.appPackageDir (captured at factory time per D10), the load-time env fallback, then a
 * relative fallback for running the built routes/ next to src-routes/ (tests, local checks).
 * @param appPackageDir - This package's directory from the per-package context.
 * @returns The first candidate dir containing trading.html (or the last candidate for sendFile's 404 path).
 */
function surfaceDir(appPackageDir) {
    const candidates = [
        appPackageDir ? path.join(appPackageDir, 'tools') : '',
        LOAD_TIME_PACKAGE_DIR ? path.join(LOAD_TIME_PACKAGE_DIR, 'tools') : '',
        path.resolve(__dirname, '../tools'),
    ].filter(Boolean);
    return candidates.find((d) => fs.existsSync(path.join(d, 'trading.html'))) || candidates[candidates.length - 1];
}
/**
 * @description Builds the trading router (mounted at /api/trading with auth: service-or-oidc by
 * the ManifestRouteMounter — the EXACT posture core server.ts mounted, ADR-085 D2).
 * @param ctx - The per-package app context (Postgres pool for the per-user, per-mode stores;
 * appPackageDir for the bundled surface per D10).
 * @returns Express router.
 */
function createTradingRoutes(ctx) {
    const router = (0, express_1.Router)();
    const apiDir = surfaceDir(ctx.appPackageDir);
    // Wire the Schwab LIVE rail's per-user token lookup (ADR-036 brokered creds): the trading feature
    // slice can't import the app-layer connector store (FSD), so it calls back through this resolver to
    // decrypt/refresh the caller's Schwab access token. No-op for the Alpaca (paper/autopilot) rail.
    (0, trading_1.registerSchwabTokenResolver)((_mode, sub) => (0, connectors_routes_1.getValidAccessToken)(ctx.pool, sub, 'schwab'));
    // Route groups register in the ORIGINAL pre-split order (surface/reads → signal→decision→order
    // flow → POST /trigger below → algo engine → tuning). Paths are all distinct, but the order is
    // preserved anyway so the mounted surface is exactly what it was before the decomposition.
    (0, trading_routes_book_read_builders_1.registerTradingBookReadRoutes)(router, ctx, apiDir);
    (0, trading_routes_order_flow_builders_1.registerTradingOrderFlowRoutes)(router, ctx, trading_engine_1.placeDecisionOrder);
    /** POST /trigger — turn captured signal(s) into a `trading-decision` ticket.
     *  Body: { mode?, signalIds: string[] }. The ticket carries the signalIds so the decision reasons
     *  over the SAME captured artifacts the provenance chain stores. This is the bridge a cron/
     *  heuristic/sentiment signal generator calls.
     *
     *  AUTONOMY (ADR-052/053): PAPER trades need NO approval — the ticket is created 'approved' and
     *  this route runs the loop inline (analyst decides → if actionable, places the order) and drives
     *  the ticket approved → complete (or escalated on failure). LIVE stays gated: the ticket is left
     *  'backlog' for manual approval and nothing is placed here. */
    router.post('/trigger', async (req, res) => {
        const sub = (0, trading_routes_helpers_1.callerSub)(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const b = (req.body || {});
        const signalIds = Array.isArray(b.signalIds) ? b.signalIds.map(String) : [];
        if (!signalIds.length) {
            res.status(400).json({ error: 'signal_ids_required', message: 'Provide at least one captured signalId to trigger a decision ticket.' });
            return;
        }
        try {
            await (0, trading_schema_1.ensureTradingSchema)(ctx.pool);
            const mode = (0, trading_routes_helpers_1.resolveMode)(b.mode);
            const signals = (await ctx.pool.query(`SELECT signal_id, source, author, title, body, url, symbols, indicators, observed_at
           FROM oshal_trading_signals WHERE user_sub=$1 AND mode=$2 AND signal_id = ANY($3::uuid[])`, [sub, mode, signalIds])).rows;
            if (!signals.length) {
                res.status(404).json({ error: 'signals_not_found', message: 'No matching captured signals for this book.' });
                return;
            }
            const syms = [...new Set(signals.flatMap((s) => (s.symbols || [])))];
            const lead = signals[0];
            // Paper auto-approves; live waits for a human (the ADR-052 autonomy gate).
            const input = ticket_1.CreateInternalTicketSchema.parse({
                title: `Trading signal: ${lead.title || (lead.body || '').slice(0, 80)}${syms.length ? ' [' + syms.join(', ') + ']' : ''}`,
                description: `A ${mode} trading-decision triggered by ${signals.length} captured signal(s) from `
                    + `${[...new Set(signals.map((s) => s.source))].join(', ')}. Reason over the signal(s) and decide whether to trade.`,
                ticketType: 'trading-decision',
                status: mode === 'paper' ? 'approved' : 'backlog',
                ownerSub: sub,
                payload: { mode, signalIds, symbols: syms },
                metadata: { source: 'trading-trigger', book: mode },
            });
            const ticket = await ctx.ticketService.createTicket(input);
            // LIVE: leave the ticket for manual approval; place nothing here.
            if (mode === 'live') {
                res.status(201).json({ ok: true, ticketId: ticket.ticketId, status: ticket.status, mode, signalIds, note: 'Live trades require approval — ticket left in backlog.' });
                return;
            }
            // PAPER: run the loop now, no approval. Decide → (if actionable) place → complete the ticket.
            try {
                const { decisionId, decision } = await (0, trading_engine_1.analyzeAndRecordDecision)(ctx, sub, mode, signals);
                let order = null;
                if (decision.action !== 'hold') {
                    order = await (0, trading_engine_1.placeDecisionOrder)(ctx.pool, sub, mode, decisionId, ticket.ticketId, false);
                }
                await ctx.ticketService.updateStatus(ticket.ticketId, 'complete').catch(() => { });
                res.status(201).json({
                    ok: true, ticketId: ticket.ticketId, status: 'complete', mode, decisionId,
                    action: decision.action,
                    order: order ? { id: order.id, status: order.status, symbol: order.symbol, side: order.side, qty: order.qty, type: order.type } : null,
                    note: decision.action === 'hold' ? 'Analyst held — no trade (justified non-action).' : undefined,
                });
            }
            catch (e) {
                // A guardrail block / not-actionable is a clean "no trade" → complete; anything else escalates.
                const benign = e instanceof trading_routes_helpers_1.TradingError && (e.code === 'guardrail_blocked' || e.code === 'not_actionable');
                await ctx.ticketService.updateStatus(ticket.ticketId, benign ? 'complete' : 'escalated', benign ? {
                    reason: e instanceof trading_routes_helpers_1.TradingError ? e.code : 'trading_decision_not_actionable',
                    source: 'trading-trigger',
                    message: e.message,
                } : {
                    reason: 'trading_trigger_failed',
                    source: 'trading-trigger',
                    message: e.message,
                }).catch(() => { });
                res.status(201).json({ ok: true, ticketId: ticket.ticketId, status: benign ? 'complete' : 'escalated', mode, note: e.message });
            }
        }
        catch (err) {
            logger.error({ err }, 'trading trigger failed');
            res.status(500).json({ error: err.message });
        }
    });
    (0, trading_routes_algo_builders_1.registerTradingAlgoRoutes)(router, ctx);
    (0, trading_routes_algo_builders_1.registerTradingTuningRoutes)(router, ctx);
    return router;
}
//# sourceMappingURL=trading-routes.js.map