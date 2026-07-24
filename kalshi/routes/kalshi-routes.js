"use strict";
/**
 * Kalshi prediction-markets routes — the `?app=kalshi` surface and its data feeds.
 *
 * Read-only in this phase: serves the surface HTML plus the live "poker hand" scan (open markets
 * evaluated against the settled-market calibration table, net of fees) and the calibration table
 * itself. Order placement lands with the authed connector phase and will be confirm-gated like
 * the trading autopilot's risky-write guards. Scan results are cached in-process so the cockpit
 * can't hammer Kalshi's public API.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-13 00:55:00 | roger.murphy@emeraldcoastsystemsgroup.com | Initial — GET / (surface), /scan (cached ranked hands), /calibration (table + freshness), /status (exchange + table age). Auth: mounted behind serviceSecretOr(requiresAuth) in server.ts; handlers also self-gate via callerSub.
 * 2026-07-13 20:40:00 | roger.murphy@emeraldcoastsystemsgroup.com | Phase 2 (ADR-094): GET /portfolio (balance/positions/resting via the caller's brokered key), POST /orders (validateOrderRequest guards + LIVE-key hard gate off the DETECTED env — never a client flag — unless KALSHI_LIVE_ENABLED; audited to kalshi_orders with the justifying hand snapshot, rejections too), DELETE /orders/:id, GET /orders/history. Signature createKalshiRoutes(pool, apiDir); schema self-heals (migration 074 is the bootstrap copy).
 * 2026-07-19 21:25:00 | roger.murphy@emeraldcoastsystemsgroup.com | Carved out of OSHAL core into the kalshi app package (ADR-085 Wave 3, "skill with a surface"). Standard (ctx) factory; the surface serves from ctx.appPackageDir/tools (load-time env fallback, D10) through the kernel's servePage helper. Relative imports flip to @/ aliases: @/app/routes/trading-routes-helpers (callerSub + servePage — global-search-routes also imports them, they stay kernel) + @/app/routes/connectors-routes (getValidAccessToken). The prediction-markets ENGINE stays kernel (@/features/prediction-markets — connector-account-lookup real-imports probeKalshiAccount, the oshal-kalshi-* CLIs + specs source it; NOT orphaned, D8 verified). The ADR-094 confirm/fail-closed order posture — validateOrderRequest guards, the LIVE-key hard gate off the DETECTED env unless KALSHI_LIVE_ENABLED, blocked/rejected/placed all audited to kalshi_orders — is byte-identical to the kernel original.
 *
 * @module kalshi-routes
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
exports.createKalshiRoutes = createKalshiRoutes;
const express_1 = require("express");
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const logger_1 = require("@/shared/logger");
const prediction_markets_1 = require("@/features/prediction-markets");
const connectors_routes_1 = require("@/app/routes/connectors-routes");
const trading_routes_helpers_1 = require("@/app/routes/trading-routes-helpers");
const log = (0, logger_1.createChildLogger)({ module: 'kalshi-routes' });
/** Evaluable markets RETAINED per scan — the feed walk keeps paging (up to maxPaged batches of
 *  1000) until it holds this many real books; >99% of the flat feed is parlay legs. */
const SCAN_MAX_MARKETS = Number(process.env.KALSHI_SCAN_MAX_MARKETS) || 1500;
/** Scan cache TTL ms — the cockpit refresh interval floors here. */
const SCAN_TTL_MS = Number(process.env.KALSHI_SCAN_TTL_MS) || 120_000;
let scanCache = null;
let scanInFlight = null;
/** Load-time-only fallback for frameworks predating ctx.appPackageDir (D10). */
const LOAD_TIME_PACKAGE_DIR = process.env.OSHAL_APP_PACKAGE_DIR || '';
/**
 * @description Resolve the package tools/ directory holding the bundled surface (kalshi.html):
 * ctx.appPackageDir (captured at factory time per D10), the load-time env fallback, then a
 * relative fallback for running the built routes/ next to src-routes/ (tests, local checks).
 * @param appPackageDir - This package's directory from the per-package context.
 * @returns The first candidate dir containing kalshi.html (or the last candidate for sendFile's 404 path).
 */
function surfaceDir(appPackageDir) {
    const candidates = [
        appPackageDir ? path.join(appPackageDir, 'tools') : '',
        LOAD_TIME_PACKAGE_DIR ? path.join(LOAD_TIME_PACKAGE_DIR, 'tools') : '',
        path.resolve(__dirname, '../tools'),
    ].filter(Boolean);
    return candidates.find((d) => fs.existsSync(path.join(d, 'kalshi.html'))) || candidates[candidates.length - 1];
}
function calibrationPath() {
    return path.resolve(process.cwd(), 'config-seed', 'kalshi-calibration.json');
}
function loadCalibration() {
    try {
        const p = calibrationPath();
        const stat = fs.statSync(p);
        return { table: JSON.parse(fs.readFileSync(p, 'utf8')), mtime: stat.mtime.toISOString() };
    }
    catch {
        return { table: null, mtime: null };
    }
}
/** Evaluable = real single market with a two-sided book and at least one trade printed. */
function evaluableMarket(m) {
    return !m.isMultivariate && m.yesAsk > 0 && m.noAsk > 0 && m.volume > 0;
}
/** The scan's hands come from the calibration engine — score them under that name. */
const SCAN_STRATEGY = 'calibration';
/**
 * Pre-register the scan's hands as PREDICTIONS so the strategy you can actually click "Bet" on is
 * also the strategy reality grades. Until this existed, only the weather model was scored while
 * the calibration hands — the ones with Bet buttons — were never written down and never graded.
 * Immutable: ON CONFLICT DO NOTHING, so a hand's first-seen probability is the one it is judged on.
 */
async function recordScanPredictions(pool, hands) {
    for (const h of hands) {
        await pool.query(`INSERT INTO kalshi_predictions
         (strategy, ticker, event_ticker, series_ticker, predicted_prob, market_prob, edge_net,
          stake_fraction, side, rationale, close_time)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (strategy, ticker) DO NOTHING`, [SCAN_STRATEGY, h.ticker, h.eventTicker, h.ticker.split('-')[0], h.trueProb, h.price, h.edgeNet,
            h.stakeFraction, h.side,
            JSON.stringify({ strength: h.strength, confidence: h.confidence, calibrationN: h.calibrationN, riskFlags: h.riskFlags }),
            h.closeTime]).catch((err) => log.error({ err, ticker: h.ticker }, 'scan prediction record failed'));
    }
}
async function runScan(pool) {
    const started = Date.now();
    const { table, mtime } = loadCalibration();
    if (!table)
        throw new Error('calibration table missing — run scripts/oshal-kalshi-calibration.ts');
    const [active, walk] = await Promise.all([
        (0, prediction_markets_1.exchangeTradingActive)().catch(() => false),
        (0, prediction_markets_1.listMarketsFiltered)({ status: 'open' }, evaluableMarket, { maxKeep: SCAN_MAX_MARKETS }),
    ]);
    const seriesByTicker = new Map();
    for (const m of walk.markets) {
        if (!seriesByTicker.has(m.seriesTicker))
            seriesByTicker.set(m.seriesTicker, await (0, prediction_markets_1.getSeriesMeta)(m.seriesTicker));
    }
    let hands = (0, prediction_markets_1.rankHands)(walk.markets, seriesByTicker, table);
    // Record BEFORE gating, so the prediction is judged on what the model actually believed.
    await recordScanPredictions(pool, hands);
    // THE EVIDENCE GATE: a strategy may only size a stake once it has out-scored the market on
    // settled predictions. Unproven or failing ⇒ stakes forced to zero — the hand is still shown
    // (with its reasoning), it just may not claim a slice of the bankroll it hasn't earned.
    const gate = await (0, prediction_markets_1.mayStrategyStake)(pool, SCAN_STRATEGY);
    if (!gate.mayStake)
        hands = hands.map((h) => ({ ...h, stakeFraction: 0 }));
    const scorecard = await (0, prediction_markets_1.getScorecard)(pool).catch(() => []);
    log.info({ openPaged: walk.paged, evaluable: walk.markets.length, hands: hands.length, mayStake: gate.mayStake, ms: Date.now() - started }, 'kalshi scan complete');
    return {
        generatedAt: new Date().toISOString(), exchangeActive: active, calibrationGeneratedAt: table.generatedAt,
        calibrationFileMtime: mtime, openPaged: walk.paged, evaluable: walk.markets.length, hands,
        strategy: SCAN_STRATEGY, mayStake: gate.mayStake, gateReason: gate.reason, scorecard,
    };
}
/** Self-heal the audit table (mirrors the trading routes' ensureSchema pattern; migration 074 is
 *  the framework-bootstrap copy of the same DDL — this package ships a migrations/ copy too). */
async function ensureKalshiSchema(pool) {
    await pool.query(`
    CREATE TABLE IF NOT EXISTS kalshi_orders (
      id BIGSERIAL PRIMARY KEY, user_sub TEXT NOT NULL, env TEXT NOT NULL, ticker TEXT NOT NULL,
      side TEXT NOT NULL, action TEXT NOT NULL, count INTEGER NOT NULL, limit_price_cents INTEGER NOT NULL,
      client_order_id TEXT NOT NULL UNIQUE, kalshi_order_id TEXT, kalshi_status TEXT,
      hand_snapshot JSONB, error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_kalshi_orders_user ON kalshi_orders (user_sub, created_at DESC);
  `);
}
/** Resolve the caller's decrypted Kalshi creds, or answer the response and return null. */
async function resolveCreds(pool, req, res) {
    const sub = (0, trading_routes_helpers_1.callerSub)(req);
    if (!sub) {
        res.status(401).json({ error: 'authentication required' });
        return null;
    }
    const secret = await (0, connectors_routes_1.getValidAccessToken)(pool, sub, 'kalshi').catch(() => null);
    if (!secret) {
        res.status(404).json({ error: 'no Kalshi connection — paste your API key on /utilities first' });
        return null;
    }
    try {
        return { sub, creds: (0, prediction_markets_1.parseKalshiSecret)(secret) };
    }
    catch (err) {
        res.status(500).json({ error: `stored Kalshi secret unusable: ${err.message}` });
        return null;
    }
}
/**
 * @description Build the Kalshi app routes: the surface + edge scan (Phase 1) and the
 * portfolio/orders execution layer (Phase 2 — confirm-gated, demo exchange unless
 * KALSHI_LIVE_ENABLED, every order audited to kalshi_orders with its hand snapshot).
 * @param ctx - The per-package app context (pool for order audit + connector token resolution;
 * appPackageDir for the bundled surface per D10).
 * @returns The configured router.
 */
function createKalshiRoutes(ctx) {
    const pool = ctx.pool;
    const toolsDir = surfaceDir(ctx.appPackageDir);
    const router = (0, express_1.Router)();
    ensureKalshiSchema(pool).catch((err) => log.error({ err }, 'kalshi schema ensure failed'));
    router.get('/', (0, trading_routes_helpers_1.servePage)(toolsDir, 'kalshi.html'));
    router.get('/ui', (0, trading_routes_helpers_1.servePage)(toolsDir, 'kalshi.html'));
    router.get('/scan', async (req, res) => {
        if (!(0, trading_routes_helpers_1.callerSub)(req)) {
            res.status(401).json({ error: 'authentication required' });
            return;
        }
        try {
            if (scanCache && Date.now() - scanCache.at < SCAN_TTL_MS) {
                res.json(scanCache.payload);
                return;
            }
            if (!scanInFlight) {
                scanInFlight = runScan(pool).then((payload) => { scanCache = { at: Date.now(), payload }; return payload; })
                    .finally(() => { scanInFlight = null; });
            }
            res.json(await scanInFlight);
        }
        catch (err) {
            log.error({ err }, 'kalshi scan failed');
            res.status(503).json({ error: err.message });
        }
    });
    router.get('/scorecard', async (req, res) => {
        if (!(0, trading_routes_helpers_1.callerSub)(req)) {
            res.status(401).json({ error: 'authentication required' });
            return;
        }
        try {
            res.json({ minGraded: Number(process.env.KALSHI_MIN_GRADED) || 30, strategies: await (0, prediction_markets_1.getScorecard)(pool) });
        }
        catch (err) {
            log.error({ err }, 'kalshi scorecard failed');
            res.status(503).json({ error: err.message });
        }
    });
    router.get('/calibration', (req, res) => {
        if (!(0, trading_routes_helpers_1.callerSub)(req)) {
            res.status(401).json({ error: 'authentication required' });
            return;
        }
        const { table, mtime } = loadCalibration();
        if (!table) {
            res.status(503).json({ error: 'calibration table missing — run scripts/oshal-kalshi-calibration.ts' });
            return;
        }
        res.json({ mtime, table });
    });
    router.get('/status', async (req, res) => {
        if (!(0, trading_routes_helpers_1.callerSub)(req)) {
            res.status(401).json({ error: 'authentication required' });
            return;
        }
        try {
            const { table, mtime } = loadCalibration();
            res.json({
                exchangeActive: await (0, prediction_markets_1.exchangeTradingActive)().catch(() => false),
                calibration: table ? { generatedAt: table.generatedAt, fileMtime: mtime, sampleCounts: table.sampleCounts } : null,
                scanCachedAt: scanCache ? new Date(scanCache.at).toISOString() : null,
                liveOrdersEnabled: (0, prediction_markets_1.kalshiLiveOrdersEnabled)(),
            });
        }
        catch (err) {
            log.error({ err }, 'kalshi status failed');
            res.status(503).json({ error: err.message });
        }
    });
    /* ─── Phase 2: portfolio + confirm-gated orders (ADR-094) ───────────────────── */
    router.get('/portfolio', async (req, res) => {
        const r = await resolveCreds(pool, req, res);
        if (!r)
            return;
        try {
            res.json(await (0, prediction_markets_1.getKalshiPortfolio)(r.creds));
        }
        catch (err) {
            log.error({ err }, 'kalshi portfolio fetch failed');
            res.status(502).json({ error: err.message });
        }
    });
    router.post('/orders', async (req, res) => {
        const r = await resolveCreds(pool, req, res);
        if (!r)
            return;
        const body = (req.body || {});
        const refusal = (0, prediction_markets_1.validateOrderRequest)(body);
        if (refusal) {
            res.status(400).json({ error: refusal });
            return;
        }
        const order = body;
        try {
            // The live gate reads the key's DETECTED exchange (a balance read primes the cache) —
            // never a client-supplied flag. Default posture: demo-only.
            const snapshot = await (0, prediction_markets_1.getKalshiPortfolio)(r.creds);
            if (snapshot.env === 'live' && !(0, prediction_markets_1.kalshiLiveOrdersEnabled)()) {
                // A BLOCKED order is a real event: log it AND audit it. Returning 403 silently meant the
                // operator clicked Bet twice, saw nothing in the logs or the ledger, and reasonably
                // concluded the app was broken (2026-07-14). An audit trail that omits refusals lies.
                const reason = 'live-exchange orders are disabled (KALSHI_LIVE_ENABLED is off). Your default Kalshi connection is the LIVE account — save the DEMO key on /utilities and click "make default" to paper-trade.';
                log.warn({ sub: r.sub, ticker: order.ticker, side: order.side, count: order.count, env: snapshot.env }, 'kalshi order BLOCKED by the live-money gate');
                await pool.query(`INSERT INTO kalshi_orders (user_sub, env, ticker, side, action, count, limit_price_cents, client_order_id, kalshi_status, hand_snapshot, error)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'blocked',$9,$10)`, [r.sub, snapshot.env, order.ticker, order.side, order.action, order.count, order.priceCents,
                    crypto.randomUUID(), body.handSnapshot ? JSON.stringify(body.handSnapshot) : null, reason]).catch((e) => log.error({ err: e }, 'kalshi blocked-order audit insert failed'));
                res.status(403).json({ error: reason, env: snapshot.env, blocked: true });
                return;
            }
            const clientOrderId = crypto.randomUUID();
            let placed;
            try {
                placed = await (0, prediction_markets_1.placeKalshiOrder)(r.creds, order, clientOrderId);
            }
            catch (err) {
                await pool.query(`INSERT INTO kalshi_orders (user_sub, env, ticker, side, action, count, limit_price_cents, client_order_id, kalshi_status, hand_snapshot, error)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'rejected',$9,$10)`, [r.sub, snapshot.env, order.ticker, order.side, order.action, order.count, order.priceCents, clientOrderId,
                    body.handSnapshot ? JSON.stringify(body.handSnapshot) : null, err.message.slice(0, 500)]).catch((e) => log.error({ err: e }, 'kalshi order audit insert failed (rejection path)'));
                throw err;
            }
            await pool.query(`INSERT INTO kalshi_orders (user_sub, env, ticker, side, action, count, limit_price_cents, client_order_id, kalshi_order_id, kalshi_status, hand_snapshot)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [r.sub, snapshot.env, order.ticker, order.side, order.action, order.count, order.priceCents, clientOrderId,
                placed.orderId, placed.status, body.handSnapshot ? JSON.stringify(body.handSnapshot) : null]).catch((e) => log.error({ err: e }, 'kalshi order audit insert failed'));
            res.json({ env: snapshot.env, order: placed });
        }
        catch (err) {
            log.error({ err, ticker: order.ticker }, 'kalshi order placement failed');
            res.status(502).json({ error: err.message });
        }
    });
    router.delete('/orders/:orderId', async (req, res) => {
        const r = await resolveCreds(pool, req, res);
        if (!r)
            return;
        try {
            const order = await (0, prediction_markets_1.cancelKalshiOrder)(r.creds, String(req.params.orderId));
            await pool.query(`UPDATE kalshi_orders SET kalshi_status = $1 WHERE kalshi_order_id = $2 AND user_sub = $3`, [order.status || 'canceled', order.orderId, r.sub]).catch((e) => log.error({ err: e }, 'kalshi order audit update failed'));
            res.json({ order });
        }
        catch (err) {
            log.error({ err, orderId: req.params.orderId }, 'kalshi order cancel failed');
            res.status(502).json({ error: err.message });
        }
    });
    router.get('/orders/history', async (req, res) => {
        const sub = (0, trading_routes_helpers_1.callerSub)(req);
        if (!sub) {
            res.status(401).json({ error: 'authentication required' });
            return;
        }
        try {
            const { rows } = await pool.query(`SELECT env, ticker, side, action, count, limit_price_cents, kalshi_order_id, kalshi_status, error, created_at
         FROM kalshi_orders WHERE user_sub = $1 ORDER BY created_at DESC LIMIT 100`, [sub]);
            res.json({ orders: rows });
        }
        catch (err) {
            res.status(503).json({ error: err.message });
        }
    });
    return router;
}
//# sourceMappingURL=kalshi-routes.js.map