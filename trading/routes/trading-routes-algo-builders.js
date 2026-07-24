"use strict";
/**
 * Trading algorithm + tuning route builders (ADR-052) — the deterministic, no-LLM engine surface:
 * watchlist scans, the stored-signal lookup, the algo-ensemble decision, universe recommendations,
 * the per-algo hit-rate scoreboard, and the nightly-optimizer approval gate. Also home of the
 * prediction-recording helper (recordPredictions; its resolver sibling resolveMaturedPredictions
 * lives in the engine, app/trading-engine.ts, shared with the review/assess dispatch loops).
 * Registered after POST /trigger by trading-routes.ts, preserving the original order exactly.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-11 05:05:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Extracted from trading-routes.ts (1000-line cap decomposition): POST /scan + /signal-latest + /decide-algo, GET /recommendations + /algo-stats, the tuning routes (GET /strategy-params, GET /recommendations-tuning, POST approve/reject, POST /optimize-now), and the recordPredictions/resolveMaturedPredictions/algoEnsembleDecision helpers. Code moved verbatim — zero behavior change.
 * 2026-07-19 16:55:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Trading engine extraction (ADR-085 pre-carve): resolveMaturedPredictions moved VERBATIM to app/trading-engine.ts (the review/assess loops import the engine, not this carvable surface); this builder now imports it back from the engine, and ensureTradingSchema from its moved home app/trading-schema.ts. Pure code motion — zero behavior change.
 * 2026-07-19 23:30:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Carved out of OSHAL core into the trading app package (ADR-085 Wave 3). Relative kernel imports flip to @/ aliases (helpers/schema/engine/strategy-params/optimize-dispatch/schedule-dispatch ALL stay kernel with the dispatch loops). Handler bodies byte-identical — zero behavior change.
 *
 * @module trading-routes-algo-builders
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
exports.registerTradingAlgoRoutes = registerTradingAlgoRoutes;
exports.registerTradingTuningRoutes = registerTradingTuningRoutes;
const crypto = __importStar(require("crypto"));
const logger_1 = require("@/shared/logger");
const trading_1 = require("@/features/trading");
const trading_routes_helpers_1 = require("@/app/routes/trading-routes-helpers");
const trading_schema_1 = require("@/app/trading-schema");
const trading_engine_1 = require("@/app/trading-engine");
const trading_strategy_params_1 = require("@/app/trading-strategy-params");
const trading_optimize_dispatch_1 = require("@/app/trading-optimize-dispatch");
const trading_schedule_dispatch_1 = require("@/app/trading-schedule-dispatch");
// Same module tag as the entry file so structured log output is unchanged by the split.
const logger = (0, logger_1.createChildLogger)({ module: 'trading-routes' });
/** Default universe the market-analysis recommendation scan assesses. */
const RECO_UNIVERSE = ['SPY', 'QQQ', 'AAPL', 'MSFT', 'NVDA', 'AMZN', 'META', 'TSLA', 'AMD', 'JPM', 'XOM', 'WMT', 'DIS', 'NFLX', 'HD', 'LOW', 'GNRC', 'BLDR', 'COST', 'GOOGL'];
/* ── deterministic, algorithm-driven path (no LLM): scoreSymbol → ensemble → decision ── */
/** Persist the per-algo + ensemble predictions for a symbol (the queryable track record). */
async function recordPredictions(pool, sub, mode, symbol, price, signals, ens) {
    for (const s of signals) {
        await pool.query(`INSERT INTO oshal_trading_predictions (user_sub,mode,symbol,algo,pred_dir,confidence,price,basis) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [sub, mode, symbol, s.algo, s.dir, s.confidence, price, s.basis]);
    }
    if (ens.action !== 'hold' && ens.side) {
        await pool.query(`INSERT INTO oshal_trading_predictions (user_sub,mode,symbol,algo,pred_dir,confidence,price,basis) VALUES ($1,$2,$3,'ensemble',$4,$5,$6,$7)`, [sub, mode, symbol, ens.side === 'buy' ? 'up' : 'down', ens.confidence, price, `ensemble score ${ens.score}`]);
    }
}
/** Run the algorithms over live market data and fold them into a DETERMINISTIC decision (no LLM).
 *  Captures the scan as a provenance signal so the order still chains signal → decision → order. */
async function algoEnsembleDecision(pool, sub, mode, symbol) {
    // Per-mode data source: paper reads Alpaca (IEX), the live book reads the caller's Schwab feed.
    const md = (0, trading_1.getMarketData)(mode, sub);
    if (!md.configured())
        throw new trading_routes_helpers_1.TradingError(503, 'market_data_not_configured', md.kind === 'schwab' ? 'Connect your Charles Schwab account for live market data.' : 'Set Alpaca data keys (ALPACA_PAPER_KEY_ID/_SECRET).');
    const SYM = symbol.toUpperCase();
    const closes = await md.dailyCloses(SYM);
    if (!closes.length)
        throw new trading_routes_helpers_1.TradingError(502, 'no_data', `No daily bars for ${SYM}.`);
    const price = (await md.latestPrice(SYM)) ?? closes[closes.length - 1];
    const live = price && price !== closes[closes.length - 1] ? [...closes, price] : [...closes];
    const spy = SYM === 'SPY' ? undefined : await md.dailyCloses('SPY').catch(() => []);
    const params = await (0, trading_strategy_params_1.loadStrategyParams)(pool);
    const signals = (0, trading_1.scoreSymbol)(SYM, live, spy && spy.length ? spy : undefined, 'SPY', params);
    const ens = (0, trading_1.ensemble)(signals, {}, params.ensembleThreshold);
    await recordPredictions(pool, sub, mode, SYM, price, signals, ens);
    const artifact = JSON.stringify({ source: 'algo-scan', symbol: SYM, price, signals, ensemble: ens });
    const hash = crypto.createHash('sha256').update(artifact).digest('hex');
    const sig = (await pool.query(`INSERT INTO oshal_trading_signals (user_sub, mode, source, title, body, symbols, indicators, content_hash)
       VALUES ($1,$2,'algo-scan',$3,$4,$5,$6,$7)
     ON CONFLICT (user_sub, mode, content_hash) DO UPDATE SET observed_at = oshal_trading_signals.observed_at
     RETURNING signal_id`, [sub, mode, `Algo scan ${SYM} @ ${price}`, JSON.stringify({ signals, ensemble: ens }), [SYM], JSON.stringify({ price, signals, ensemble: ens }), hash])).rows[0];
    const g = (0, trading_routes_helpers_1.guardrails)();
    const qty = Number(process.env.TRADING_ALGO_QTY || 1);
    const rationale = `Deterministic ensemble of ${signals.length} algos — score ${ens.score}, confidence ${ens.confidence}: `
        + signals.map((s) => `${s.algo}:${s.dir}(${s.confidence.toFixed(2)})`).join(', ') + '.';
    const row = (await pool.query(`INSERT INTO oshal_trading_decisions
       (user_sub, mode, signal_ids, agent_id, action, symbol, side, qty, order_type, confidence, rationale, indicators, guardrails)
     VALUES ($1,$2,$3::uuid[],'algo-ensemble',$4,$5,$6,$7,'market',$8,$9,$10,$11)
     RETURNING decision_id`, [sub, mode, [sig.signal_id], ens.action, ens.action === 'hold' ? null : SYM, ens.side,
        ens.action === 'hold' ? null : qty, ens.confidence, rationale, JSON.stringify(signals), JSON.stringify(g)])).rows[0];
    return { decisionId: row.decision_id, decision: { action: ens.action, symbol: SYM, side: ens.side, qty: ens.action === 'hold' ? null : qty, confidence: ens.confidence, score: ens.score, rationale }, signals, ensemble: ens, price };
}
/**
 * @description Registers the deterministic algorithm routes (scan / signal-latest / decide-algo /
 * recommendations / algo-stats) on the trading router. Auth is enforced at the mount
 * (`/api/trading` sits behind serviceSecretOr(requiresAuth) in server.ts) plus each handler's own
 * callerSub 401 check — unchanged from the pre-split file.
 * @param router - The trading router being composed by createTradingRoutes.
 * @param ctx - App context (Postgres pool for the per-user, per-mode stores).
 * @returns Nothing — routes are registered on the passed router.
 */
function registerTradingAlgoRoutes(router, ctx) {
    /** POST /scan — run every algorithm over a watchlist's live market data, persist the per-algo
     *  predictions, resolve matured ones, and return signals + the deterministic ensemble per symbol.
     *  No orders placed — this is the monitor/predict step. Body: { mode?, symbols?: string[] }. */
    router.post('/scan', async (req, res) => {
        const sub = (0, trading_routes_helpers_1.callerSub)(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            await (0, trading_schema_1.ensureTradingSchema)(ctx.pool);
            if (!(0, trading_1.marketDataConfigured)()) {
                res.status(503).json({ error: 'market_data_not_configured', message: 'Set Alpaca data keys.' });
                return;
            }
            const b = (req.body || {});
            const mode = (0, trading_routes_helpers_1.resolveMode)(b.mode);
            const watch = (Array.isArray(b.symbols) && b.symbols.length ? b.symbols : ['HD', 'LOW', 'GNRC', 'BLDR', 'SPY']).map((s) => String(s).toUpperCase());
            const resolved = await (0, trading_engine_1.resolveMaturedPredictions)(ctx.pool, mode);
            const spy = await (0, trading_1.dailyCloses)('SPY').catch(() => []);
            const params = await (0, trading_strategy_params_1.loadStrategyParams)(ctx.pool); // approved tuned params (defaults until approved)
            const scanned = [];
            for (const sym of watch) {
                try {
                    const closes = await (0, trading_1.dailyCloses)(sym);
                    if (!closes.length) {
                        scanned.push({ symbol: sym, error: 'no_data' });
                        continue;
                    }
                    const price = (await (0, trading_1.latestPrice)(sym)) ?? closes[closes.length - 1];
                    const live = price && price !== closes[closes.length - 1] ? [...closes, price] : [...closes];
                    const signals = (0, trading_1.scoreSymbol)(sym, live, sym === 'SPY' ? undefined : (spy.length ? spy : undefined), 'SPY', params);
                    const ens = (0, trading_1.ensemble)(signals, {}, params.ensembleThreshold);
                    await recordPredictions(ctx.pool, sub, mode, sym, price, signals, ens);
                    scanned.push({ symbol: sym, price, signals, ensemble: ens });
                }
                catch (e) {
                    scanned.push({ symbol: sym, error: e.message });
                }
            }
            res.json({ mode, resolved, scanned });
        }
        catch (err) {
            logger.error({ err }, 'trading scan failed');
            res.status(502).json({ error: err.message });
        }
    });
    /** POST /signal-latest — READ-ONLY: the latest STORED per-algo signals + ensemble for the given
     *  symbols, straight from oshal_trading_predictions (the deterministic engine's recorded track
     *  record). NO market-data calls — this is the cheap DB lookup the surface uses for passive display
     *  (focusing a name, annotating the held book) so ordinary browsing never burns the Alpaca data
     *  rate limit. POST /scan stays the explicit, live recompute. Body: { mode?, symbols: string[] }.
     *  Returns { mode, results: [{ symbol, asOf, price, signals[], ensemble, mtf }] }. */
    router.post('/signal-latest', async (req, res) => {
        const sub = (0, trading_routes_helpers_1.callerSub)(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            await (0, trading_schema_1.ensureTradingSchema)(ctx.pool);
            const b = (req.body || {});
            const mode = (0, trading_routes_helpers_1.resolveMode)(b.mode);
            const symbols = [...new Set((Array.isArray(b.symbols) ? b.symbols : []).map((s) => String(s).toUpperCase()).filter(Boolean))].slice(0, 100);
            if (!symbols.length) {
                res.json({ mode, results: [] });
                return;
            }
            const voteAlgos = (0, trading_1.algoNames)(); // canonical ensemble algos (momentum/gravity/donchian/meanrev)
            const wantAlgos = [...voteAlgos, 'mtf-assess']; // + the autopilot's multi-timeframe conviction (display only)
            // latest row per (symbol, algo) within a freshness window — served by idx_trd_pred_symbol_algo.
            const rows = (await ctx.pool.query(`SELECT DISTINCT ON (symbol, algo) symbol, algo, pred_dir, confidence, price, basis, created_at
           FROM oshal_trading_predictions
          WHERE mode=$1 AND symbol = ANY($2::text[]) AND algo = ANY($3::text[])
            AND created_at > now() - interval '72 hours'
          ORDER BY symbol, algo, created_at DESC`, [mode, symbols, wantAlgos])).rows;
            const bySym = new Map();
            for (const r of rows) {
                const a = bySym.get(r.symbol) || [];
                a.push(r);
                bySym.set(r.symbol, a);
            }
            const results = symbols.map((sym) => {
                const rs = bySym.get(sym) || [];
                const signals = rs.filter((r) => voteAlgos.includes(r.algo))
                    .map((r) => ({ algo: r.algo, dir: r.pred_dir === 'up' ? 'up' : 'down', confidence: Number(r.confidence) || 0, basis: r.basis || '' }));
                const mtfRow = rs.find((r) => r.algo === 'mtf-assess');
                const asOf = rs.length ? rs.reduce((m, r) => (r.created_at > m ? r.created_at : m), rs[0].created_at) : null;
                const priceRow = rs.find((r) => r.price != null);
                return {
                    symbol: sym,
                    asOf,
                    price: priceRow ? Number(priceRow.price) : null,
                    signals,
                    ensemble: (0, trading_1.ensemble)(signals),
                    mtf: mtfRow ? { dir: mtfRow.pred_dir === 'up' ? 'up' : 'down', confidence: Number(mtfRow.confidence) || 0 } : null,
                };
            });
            res.json({ mode, results });
        }
        catch (err) {
            logger.error({ err }, 'trading signal-latest failed');
            res.status(500).json({ error: err.message });
        }
    });
    /** POST /decide-algo — the DETERMINISTIC decision: algorithms over live data → ensemble → a
     *  persisted decision (no LLM), provenance-anchored to an algo-scan signal. Body: { mode?, symbol }.
     *  Returns a decisionId that POST /orders executes exactly like an analyst decision. */
    router.post('/decide-algo', async (req, res) => {
        const sub = (0, trading_routes_helpers_1.callerSub)(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const b = (req.body || {});
        if (!b.symbol) {
            res.status(400).json({ error: 'symbol_required', message: 'A symbol is required.' });
            return;
        }
        try {
            await (0, trading_schema_1.ensureTradingSchema)(ctx.pool);
            const out = await algoEnsembleDecision(ctx.pool, sub, (0, trading_routes_helpers_1.resolveMode)(b.mode), String(b.symbol));
            res.json({ ok: true, ...out });
        }
        catch (err) {
            if (err instanceof trading_routes_helpers_1.TradingError) {
                res.status(err.httpStatus).json({ error: err.code, message: err.message });
                return;
            }
            logger.error({ err }, 'trading decide-algo failed');
            res.status(502).json({ error: err.message });
        }
    });
    /** GET /recommendations?mode=&universe= — the market-analysis view: scan the universe with the
     *  deterministic ensemble, rank into BUY / SELL recommendations by conviction. Read-only (no
     *  orders, no persistence) — it shows WHAT is assessed and WHAT the algos recommend right now. */
    router.get('/recommendations', async (req, res) => {
        const sub = (0, trading_routes_helpers_1.callerSub)(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            const mode = (0, trading_routes_helpers_1.resolveMode)(req.query.mode);
            // Per-mode data source: the live book scans on the Schwab feed, paper on Alpaca IEX.
            const md = (0, trading_1.getMarketData)(mode, sub);
            if (!md.configured()) {
                res.status(503).json({ error: 'market_data_not_configured', message: md.kind === 'schwab' ? 'Connect your Charles Schwab account for live data.' : 'Set Alpaca data keys.' });
                return;
            }
            const universe = (req.query.universe ? String(req.query.universe).split(',') : RECO_UNIVERSE).map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 40);
            const spy = await md.dailyCloses('SPY').catch(() => []);
            const params = await (0, trading_strategy_params_1.loadStrategyParams)(ctx.pool);
            const scored = await Promise.all(universe.map(async (sym) => {
                try {
                    const closes = await md.dailyCloses(sym);
                    if (closes.length < 25)
                        return null;
                    const price = (await md.latestPrice(sym)) ?? closes[closes.length - 1];
                    const live = price !== closes[closes.length - 1] ? [...closes, price] : [...closes];
                    const signals = (0, trading_1.scoreSymbol)(sym, live, sym === 'SPY' ? undefined : (spy.length ? spy : undefined), 'SPY', params);
                    return { symbol: sym, price, signals, ensemble: (0, trading_1.ensemble)(signals, {}, params.ensembleThreshold) };
                }
                catch {
                    return null;
                }
            }));
            const ok = scored.filter((x) => x != null);
            const buys = ok.filter((r) => r.ensemble.action === 'buy').sort((a, b) => b.ensemble.score - a.ensemble.score);
            const sells = ok.filter((r) => r.ensemble.action === 'sell').sort((a, b) => a.ensemble.score - b.ensemble.score);
            res.json({ mode, source: md.kind, asOf: new Date().toISOString(), assessed: { symbols: ok.length, algorithms: (0, trading_1.algoNames)() }, buys, sells, holds: ok.length - buys.length - sells.length });
        }
        catch (err) {
            logger.error({ err }, 'trading recommendations failed');
            res.status(502).json({ error: err.message });
        }
    });
    /** GET /algo-stats?mode= — per-algorithm live hit-rate from the resolved prediction ledger.
     *  This is the scoreboard: which algorithm is actually right. */
    router.get('/algo-stats', async (req, res) => {
        const sub = (0, trading_routes_helpers_1.callerSub)(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            await (0, trading_schema_1.ensureTradingSchema)(ctx.pool);
            const mode = (0, trading_routes_helpers_1.resolveMode)(req.query.mode);
            const rows = (await ctx.pool.query(`SELECT algo,
                COUNT(*) FILTER (WHERE resolved) ::int AS resolved,
                COUNT(*) FILTER (WHERE resolved AND hit) ::int AS hits,
                COUNT(*) FILTER (WHERE NOT resolved) ::int AS open,
                ROUND(100.0 * COUNT(*) FILTER (WHERE resolved AND hit) / NULLIF(COUNT(*) FILTER (WHERE resolved), 0), 1) AS hit_rate_pct
           FROM oshal_trading_predictions WHERE mode=$1 GROUP BY algo ORDER BY hit_rate_pct DESC NULLS LAST`, [mode])).rows;
            res.json({ mode, algos: rows });
        }
        catch (err) {
            logger.error({ err }, 'trading algo-stats failed');
            res.status(500).json({ error: err.message });
        }
    });
}
/**
 * @description Registers the tuning routes (nightly parameter optimizer + approval gate — ADR-052
 * addendum) on the trading router. The optimizer (trading-optimize-dispatch) backtests parameter
 * tweaks and writes RECOMMENDATIONS; nothing changes how the bot trades until the operator
 * APPROVES one here, which writes the value to the param store the live (paper) engine reads.
 * Paper-only; defaults reproduce today's engine. Auth unchanged: mount-level gate + per-handler
 * callerSub 401 check.
 * @param router - The trading router being composed by createTradingRoutes.
 * @param ctx - App context (Postgres pool for the per-user, per-mode stores).
 * @returns Nothing — routes are registered on the passed router.
 */
function registerTradingTuningRoutes(router, ctx) {
    /** GET /strategy-params — the current (approved or default) tunable params + per-param last-changed. */
    router.get('/strategy-params', async (req, res) => {
        if (!(0, trading_routes_helpers_1.callerSub)(req)) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            res.json({ params: await (0, trading_strategy_params_1.loadStrategyParamsDetailed)(ctx.pool) });
        }
        catch (err) {
            logger.error({ err }, 'strategy-params failed');
            res.status(500).json({ error: err.message });
        }
    });
    /** GET /recommendations-tuning?mode= — pending param recommendations + recent applied/rejected. */
    router.get('/recommendations-tuning', async (req, res) => {
        if (!(0, trading_routes_helpers_1.callerSub)(req)) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            res.json(await (0, trading_optimize_dispatch_1.loadRecommendations)(ctx.pool, (0, trading_routes_helpers_1.resolveMode)(req.query.mode)));
        }
        catch (err) {
            logger.error({ err }, 'recommendations-tuning list failed');
            res.status(500).json({ error: err.message });
        }
    });
    /** POST /recommendations-tuning/:id/approve — apply the proposed value to the live (paper) params. */
    router.post('/recommendations-tuning/:id/approve', async (req, res) => {
        if (!(0, trading_routes_helpers_1.callerSub)(req)) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            const out = await (0, trading_optimize_dispatch_1.approveRecommendation)(ctx.pool, String(req.params.id));
            if (!out.applied) {
                res.status(409).json({ error: out.reason || 'not_applied' });
                return;
            }
            res.json({ ok: true, ...out });
        }
        catch (err) {
            logger.error({ err }, 'recommendation approve failed');
            res.status(500).json({ error: err.message });
        }
    });
    /** POST /recommendations-tuning/:id/reject — archive a pending recommendation. */
    router.post('/recommendations-tuning/:id/reject', async (req, res) => {
        if (!(0, trading_routes_helpers_1.callerSub)(req)) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        try {
            const out = await (0, trading_optimize_dispatch_1.rejectRecommendation)(ctx.pool, String(req.params.id));
            if (!out.rejected) {
                res.status(409).json({ error: out.reason || 'not_rejected' });
                return;
            }
            res.json({ ok: true });
        }
        catch (err) {
            logger.error({ err }, 'recommendation reject failed');
            res.status(500).json({ error: err.message });
        }
    });
    /** POST /optimize-now — run the optimizer on demand (and backfill the nightly schedule if missing). */
    router.post('/optimize-now', async (req, res) => {
        const sub = (0, trading_routes_helpers_1.callerSub)(req);
        if (!sub) {
            res.status(401).json({ error: 'not_authenticated' });
            return;
        }
        const mode = (0, trading_routes_helpers_1.resolveMode)(req.query.mode ?? (req.body || {}).mode);
        try {
            const svc = (0, trading_schedule_dispatch_1.getTradingScheduleService)();
            if (svc) {
                try {
                    await svc.createSchedule({ taskType: (0, trading_optimize_dispatch_1.optimizeTaskType)(sub), schedule: trading_optimize_dispatch_1.OPTIMIZE_CRON, ownerSub: sub, queue: 'intelligent-trades', taskData: { prompt: 'Nightly parameter optimization — backtest tweaks, recommend (approval-gated)', userSub: sub, mode } });
                }
                catch (e) {
                    logger.warn({ err: e }, 'optimize schedule backfill failed');
                }
            }
            const out = await (0, trading_optimize_dispatch_1.runOptimize)(ctx, sub, mode);
            res.json({ ok: true, ...out });
        }
        catch (err) {
            logger.error({ err }, 'optimize-now failed');
            res.status(500).json({ error: err.message });
        }
    });
}
//# sourceMappingURL=trading-routes-algo-builders.js.map