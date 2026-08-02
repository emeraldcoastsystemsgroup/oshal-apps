"use strict";
/**
 * Kalshi prediction-markets routes — the `?app=kalshi` surface and its data feeds.
 *
 * Serves the surface HTML plus the "poker hand" scan (open markets evaluated against the
 * settled-market calibration table, net of fees), the calibration table, the forward-test
 * scorecard, and the Phase-2 portfolio/confirm-gated orders.
 *
 * NOTHING HERE SCANS ON DEMAND ANY MORE (2026-07-30). `GET /scan` reads the snapshot the
 * background poller (kalshi-scan-cron) keeps warm and returns immediately with its age; the scan
 * itself lives in kalshi-scan-engine. `POST /scan/run` asks for an out-of-band refresh and answers
 * 202 without waiting. See kalshi-scan-cron for why (a 23-second feed walk on the request path).
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-13 00:55:00 | roger.murphy@emeraldcoastsystemsgroup.com | Initial — GET / (surface), /scan (cached ranked hands), /calibration (table + freshness), /status (exchange + table age). Auth: mounted behind serviceSecretOr(requiresAuth) in server.ts; handlers also self-gate via callerSub.
 * 2026-07-13 20:40:00 | roger.murphy@emeraldcoastsystemsgroup.com | Phase 2 (ADR-094): GET /portfolio (balance/positions/resting via the caller's brokered key), POST /orders (validateOrderRequest guards + LIVE-key hard gate off the DETECTED env — never a client flag — unless KALSHI_LIVE_ENABLED; audited to kalshi_orders with the justifying hand snapshot, rejections too), DELETE /orders/:id, GET /orders/history. Signature createKalshiRoutes(pool, apiDir); schema self-heals (migration 074 is the bootstrap copy).
 * 2026-07-19 21:25:00 | roger.murphy@emeraldcoastsystemsgroup.com | Carved out of OSHAL core into the kalshi app package (ADR-085 Wave 3, "skill with a surface"). Standard (ctx) factory; the surface serves from ctx.appPackageDir/tools (load-time env fallback, D10) through the kernel's servePage helper. Relative imports flip to @/ aliases: @/app/routes/trading-routes-helpers (callerSub + servePage — global-search-routes also imports them, they stay kernel) + @/app/routes/connectors-routes (getValidAccessToken). The prediction-markets ENGINE stays kernel (@/features/prediction-markets — connector-account-lookup real-imports probeKalshiAccount, the oshal-kalshi-* CLIs + specs source it; NOT orphaned, D8 verified). The ADR-094 confirm/fail-closed order posture — validateOrderRequest guards, the LIVE-key hard gate off the DETECTED env unless KALSHI_LIVE_ENABLED, blocked/rejected/placed all audited to kalshi_orders — is byte-identical to the kernel original.
 * 2026-07-30 04:05:00 | roger.murphy@emeraldcoastsystemsgroup.com | The scan came OFF the request path (operator: "kalshi task takes too long ... it should always be running on new ops every x ms based on configuration ... every hour, and jarvis should be notified ... only if you have the application"). The live api's own log is the evidence: openPaged=60000 evaluable=6 hands=1 ms=23125 — every cold open paid a 23s feed walk, and an api recreate threw the in-process cache away so the next visitor paid again. Now: runScan/calibration/prediction-recording moved to kalshi-scan-engine; the poller in kalshi-scan-cron (started here, so it exists only while this app is ACTIVE) keeps a durable Postgres snapshot warm on a configured cadence and posts NEW playable hands to each entitled user's Jarvis feed; GET /scan serves that snapshot instantly with freshness metadata; new POST /scan/run (202, single-flighted), GET+PUT /settings (deployment cadence knobs are operator-only, alert knobs are per-user, both clamped by the pure config module), GET /alerts.
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
const authz_1 = require("@/shared/middleware/authz");
const kalshi_scan_engine_1 = require("./kalshi-scan-engine");
const kalshi_scan_config_1 = require("./kalshi-scan-config");
const kalshi_scan_cron_1 = require("./kalshi-scan-cron");
const log = (0, logger_1.createChildLogger)({ module: 'kalshi-routes' });
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
 * @description Build the Kalshi app routes: the surface + the edge-scan snapshot feeds (Phase 1),
 * the settings/alerts surface for the always-on background scan, and the portfolio/orders execution
 * layer (Phase 2 — confirm-gated, demo exchange unless KALSHI_LIVE_ENABLED, every order audited to
 * kalshi_orders with its hand snapshot). Also STARTS the background scan poller, which is what
 * scopes it to deployments that actually have this app installed.
 * @param ctx - The per-package app context (pool for order audit + connector token resolution;
 * appPackageDir for the bundled surface per D10).
 * @returns The configured router.
 */
function createKalshiRoutes(ctx) {
    const pool = ctx.pool;
    const toolsDir = surfaceDir(ctx.appPackageDir);
    const router = (0, express_1.Router)();
    ensureKalshiSchema(pool).catch((err) => log.error({ err }, 'kalshi schema ensure failed'));
    // "Only if you have the application": the always-on scan is started HERE, by the app's own route
    // factory, so it exists exactly while this package is installed + active — never on a deployment
    // that doesn't have kalshi. Idempotent per process (a package reload re-invokes this factory).
    (0, kalshi_scan_cron_1.startKalshiScanCron)(ctx);
    router.get('/', (0, trading_routes_helpers_1.servePage)(toolsDir, 'kalshi.html'));
    router.get('/ui', (0, trading_routes_helpers_1.servePage)(toolsDir, 'kalshi.html'));
    // THE SNAPSHOT READ. Never scans, never blocks: the poller owns the feed walk. Before the first
    // scan lands the answer is an honest 200 with `hands: []` + `awaitingFirstScan` — an EMPTY table
    // on this surface means "the evaluator folded everything", so a not-yet-scanned state must say
    // which of the two it is rather than borrowing the fold's wording.
    router.get('/scan', async (req, res) => {
        if (!(0, trading_routes_helpers_1.callerSub)(req)) {
            res.status(401).json({ error: 'authentication required' });
            return;
        }
        try {
            const cfg = await (0, kalshi_scan_engine_1.resolveConfig)(ctx, (0, trading_routes_helpers_1.callerSub)(req));
            const snap = await (0, kalshi_scan_engine_1.readSnapshot)(pool);
            const runtime = (0, kalshi_scan_cron_1.scanRuntimeStatus)();
            const fresh = (0, kalshi_scan_config_1.scanFreshness)(snap?.generatedAt ?? null, cfg, Date.now());
            if (!snap) {
                res.json({
                    generatedAt: null, hands: [], evaluable: 0, openPaged: 0, scorecard: [], awaitingFirstScan: true,
                    exchangeActive: false, calibrationGeneratedAt: null, calibrationFileMtime: null,
                    strategy: 'calibration', mayStake: false,
                    gateReason: 'the background scan has not produced its first snapshot yet',
                    scan: { ...fresh, running: runtime.running, intervalMinutes: cfg.scanIntervalMinutes, enabled: cfg.scanEnabled, lastError: runtime.lastError },
                });
                return;
            }
            res.json({
                ...snap.payload,
                awaitingFirstScan: false,
                scan: {
                    ...fresh, running: runtime.running, intervalMinutes: cfg.scanIntervalMinutes,
                    enabled: cfg.scanEnabled, lastError: runtime.lastError, lastMs: snap.payload.scanMs ?? runtime.lastMs,
                    lastSource: runtime.lastSource,
                },
            });
        }
        catch (err) {
            log.error({ err }, 'kalshi snapshot serve failed');
            res.status(503).json({ error: err.message });
        }
    });
    // Out-of-band refresh ("Scan now"). Answers 202 immediately — a 23-second wait is exactly what
    // this rework removed — and is single-flighted in the cron, so double-clicking costs nothing.
    router.post('/scan/run', async (req, res) => {
        const sub = (0, trading_routes_helpers_1.callerSub)(req);
        if (!sub) {
            res.status(401).json({ error: 'authentication required' });
            return;
        }
        const runtime = (0, kalshi_scan_cron_1.scanRuntimeStatus)();
        if (runtime.running) {
            res.status(202).json({ started: false, alreadyRunning: true, startedAt: runtime.startedAt });
            return;
        }
        // Throttled: each manual run is a 60-page walk on a shared ~3 rps public tier, and this route
        // is open to any signed-in user. Unthrottled, a click loop pins the scanner and risks a 429
        // for the whole deployment (self-review, 2026-07-30).
        const gate = (0, kalshi_scan_cron_1.manualRunAllowed)();
        if (!gate.allowed) {
            res.status(429).set('Retry-After', String(gate.retryAfterSeconds)).json({
                started: false, error: `a manual scan ran recently — try again in ${gate.retryAfterSeconds}s`,
                retryAfterSeconds: gate.retryAfterSeconds,
            });
            return;
        }
        void (0, kalshi_scan_cron_1.scanNow)(ctx, 'manual').catch(() => { });
        log.info({ sub }, 'kalshi manual scan requested');
        res.status(202).json({ started: true, startedAt: new Date().toISOString() });
    });
    /* ─── Settings (the YAML defaults, overridable per deployment + per user) ────── */
    // GET returns the RESOLVED config the caller actually runs under, plus the raw override rows and
    // which keys the caller may edit — so the surface renders exactly the knobs it is allowed to save.
    router.get('/settings', async (req, res) => {
        const sub = (0, trading_routes_helpers_1.callerSub)(req);
        if (!sub) {
            res.status(401).json({ error: 'authentication required' });
            return;
        }
        try {
            const operator = (0, authz_1.isOperator)(req);
            res.json({
                // `schema` is the manifest's own settings.schema — the surface renders the panel FROM the
                // YAML (labels, bounds, scope), so "config lives in the yaml" is literally true here.
                schema: (0, kalshi_scan_engine_1.manifestSettingsSchema)(ctx.appPackageDir),
                config: await (0, kalshi_scan_engine_1.resolveConfig)(ctx, sub),
                deploymentConfig: await (0, kalshi_scan_engine_1.resolveConfig)(ctx, null),
                overrides: {
                    deployment: await (0, kalshi_scan_engine_1.readSettingsRow)(pool, kalshi_scan_engine_1.DEPLOYMENT_SCOPE),
                    user: await (0, kalshi_scan_engine_1.readSettingsRow)(pool, sub),
                },
                editable: { user: (0, kalshi_scan_config_1.keysForScope)('user'), deployment: operator ? (0, kalshi_scan_config_1.keysForScope)('deployment') : [] },
                isOperator: operator,
                alertTopic: kalshi_scan_cron_1.ALERT_TOPIC,
                scan: (0, kalshi_scan_cron_1.scanRuntimeStatus)(),
            });
        }
        catch (err) {
            log.error({ err }, 'kalshi settings read failed');
            res.status(503).json({ error: err.message });
        }
    });
    // PUT saves one scope. The USER scope is always the caller's own row (never a sub from the body);
    // the DEPLOYMENT scope changes how often this deployment scans for everyone, so it is
    // operator-only — a fail-closed 403 rather than a silently-ignored write.
    router.put('/settings', async (req, res) => {
        const sub = (0, trading_routes_helpers_1.callerSub)(req);
        if (!sub) {
            res.status(401).json({ error: 'authentication required' });
            return;
        }
        const body = (req.body || {});
        const scope = body.scope === 'deployment' ? 'deployment' : 'user';
        if (scope === 'deployment' && !(0, authz_1.isOperator)(req)) {
            res.status(403).json({ error: 'the scan cadence is deployment-wide — operator only' });
            return;
        }
        try {
            const stored = await (0, kalshi_scan_engine_1.writeSettingsRow)(pool, scope === 'deployment' ? kalshi_scan_engine_1.DEPLOYMENT_SCOPE : sub, scope, body.settings);
            res.json({ ok: true, scope, stored, config: await (0, kalshi_scan_engine_1.resolveConfig)(ctx, sub) });
        }
        catch (err) {
            log.error({ err, scope }, 'kalshi settings write failed');
            res.status(503).json({ error: err.message });
        }
    });
    /** The caller's own alert history — what the background scan has already told them about. */
    router.get('/alerts', async (req, res) => {
        const sub = (0, trading_routes_helpers_1.callerSub)(req);
        if (!sub) {
            res.status(401).json({ error: 'authentication required' });
            return;
        }
        try {
            res.json({ alerts: await (0, kalshi_scan_engine_1.listAlerts)(pool, sub, Number(req.query.limit) || 50) });
        }
        catch (err) {
            log.error({ err }, 'kalshi alerts read failed');
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
        const { table, mtime } = (0, kalshi_scan_engine_1.loadCalibration)();
        if (!table) {
            res.status(503).json({ error: 'calibration table missing — run scripts/oshal-kalshi-calibration.ts' });
            return;
        }
        res.json({ mtime, table });
    });
    router.get('/status', async (req, res) => {
        const sub = (0, trading_routes_helpers_1.callerSub)(req);
        if (!sub) {
            res.status(401).json({ error: 'authentication required' });
            return;
        }
        try {
            const { table, mtime } = (0, kalshi_scan_engine_1.loadCalibration)();
            const cfg = await (0, kalshi_scan_engine_1.resolveConfig)(ctx, sub);
            const snap = await (0, kalshi_scan_engine_1.readSnapshot)(pool);
            const runtime = (0, kalshi_scan_cron_1.scanRuntimeStatus)();
            res.json({
                exchangeActive: await (0, prediction_markets_1.exchangeTradingActive)().catch(() => false),
                calibration: table ? { generatedAt: table.generatedAt, fileMtime: mtime, sampleCounts: table.sampleCounts } : null,
                // Kept for compatibility with the surface's older field name; the snapshot IS the cache now.
                scanCachedAt: snap?.generatedAt ?? null,
                scan: {
                    ...(0, kalshi_scan_config_1.scanFreshness)(snap?.generatedAt ?? null, cfg, Date.now()),
                    enabled: cfg.scanEnabled, intervalMinutes: cfg.scanIntervalMinutes,
                    running: runtime.running, lastMs: snap?.payload.scanMs ?? runtime.lastMs,
                    lastError: runtime.lastError, lastSource: runtime.lastSource, cyclesRun: runtime.cyclesRun,
                },
                notify: { jarvis: cfg.notifyJarvis, outward: cfg.notifyOutward, topic: kalshi_scan_cron_1.ALERT_TOPIC },
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