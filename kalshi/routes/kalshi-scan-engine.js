"use strict";
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
exports.KALSHI_SCAN_DEFAULTS = exports.DEPLOYMENT_SCOPE = exports.SCAN_STRATEGY = void 0;
exports.loadCalibration = loadCalibration;
exports.evaluableMarket = evaluableMarket;
exports.ensureScanSchema = ensureScanSchema;
exports.manifestScanDefaults = manifestScanDefaults;
exports.manifestSettingsSchema = manifestSettingsSchema;
exports.readSettingsRow = readSettingsRow;
exports.appIsActive = appIsActive;
exports.withScanLease = withScanLease;
exports.writeSettingsRow = writeSettingsRow;
exports.resolveConfig = resolveConfig;
exports.readSnapshot = readSnapshot;
exports.writeSnapshot = writeSnapshot;
exports.runScan = runScan;
exports.alertedTickers = alertedTickers;
exports.alertsSentToday = alertsSentToday;
exports.recordAlert = recordAlert;
exports.pruneAlertLedger = pruneAlertLedger;
exports.listAlerts = listAlerts;
exports.alertAudience = alertAudience;
/**
 * Kalshi scan ENGINE — the scan itself, its durable snapshot, and its settings/alert stores.
 *
 * WHY THIS MODULE EXISTS (operator report, 2026-07-30): the scan used to run on demand, inside the
 * `GET /scan` request, behind a 2-minute in-process cache. The live api's own log shows what that
 * costs — `openPaged=60000 evaluable=6 hands=1 ms=23125`: opening the app paid a 23-second feed
 * walk (60 pages of 1000 at the public tier's ~3 rps), and every api recreate threw the cache away
 * so the next visitor paid again. The scan is deployment-wide PUBLIC market data — there is no
 * reason for a person to wait on it. So it moved off the request path: the poller in
 * kalshi-scan-cron.ts runs it on a configured cadence and writes a snapshot here; the route serves
 * the snapshot instantly and reports its age.
 *
 * The snapshot is in POSTGRES, not memory, on purpose: an in-process cache dies on every api
 * recreate (the career-hunter cron learned the same lesson the hard way), which is exactly when a
 * cold 23-second scan hurts most.
 *
 * Three small owned tables (created idempotently here AND shipped as a migration, because
 * APP_PACKAGE_MIGRATIONS is a flag and this app must work either way):
 *   kalshi_scan_snapshots — the latest scan payload (one row, id = 1).
 *   kalshi_scan_settings  — config overrides: scope '__deployment__' (cadence) or a user_sub (alerts).
 *   kalshi_scan_alerts    — per-user first-seen alert ledger: dedup + the rolling daily budget.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-30 03:35:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial — runScan (moved verbatim out of the request path in kalshi-routes, now cadence/bound-driven), the durable snapshot store, the manifest+DB config resolution (reads this package's OWN oshal-app.yaml for defaults), the settings store with per-scope allow-lists, and the alert ledger (first-seen dedup + rolling-day budget).
 *
 * @module kalshi-scan-engine
 */
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const logger_1 = require("@/shared/logger");
const prediction_markets_1 = require("@/features/prediction-markets");
const kalshi_scan_config_1 = require("./kalshi-scan-config");
Object.defineProperty(exports, "KALSHI_SCAN_DEFAULTS", { enumerable: true, get: function () { return kalshi_scan_config_1.KALSHI_SCAN_DEFAULTS; } });
const log = (0, logger_1.createChildLogger)({ module: 'kalshi-scan-engine' });
/** The scan's hands come from the calibration engine — score them under that name. */
exports.SCAN_STRATEGY = 'calibration';
/** Deployment-scope settings row key (a real user_sub can never collide: subs never start with '__'). */
exports.DEPLOYMENT_SCOPE = '__deployment__';
/* ── calibration table ──────────────────────────────────────────────────────── */
function calibrationPath() {
    return path.resolve(process.cwd(), 'config-seed', 'kalshi-calibration.json');
}
/** @description Load the settled-tape calibration table + its file mtime (null when absent). */
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
/* ── owned schema (idempotent; mirrors the shipped migration) ───────────────── */
let schemaReady = null;
/**
 * @description Create this app's scan tables if absent. Runs once per process, awaited by every
 * caller — the package must work whether or not APP_PACKAGE_MIGRATIONS applied migrations/.
 * @param pool - Postgres pool.
 * @returns Resolves when the schema is present (or the attempt failed and was logged).
 */
function ensureScanSchema(pool) {
    if (!schemaReady) {
        schemaReady = (async () => {
            await pool.query(`
        CREATE TABLE IF NOT EXISTS kalshi_scan_snapshots (
          id INTEGER PRIMARY KEY, payload JSONB NOT NULL,
          generated_at TIMESTAMPTZ NOT NULL DEFAULT now(), scan_ms INTEGER
        );
        CREATE TABLE IF NOT EXISTS kalshi_scan_settings (
          scope_key TEXT PRIMARY KEY, settings JSONB NOT NULL DEFAULT '{}'::jsonb,
          updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
        );
        CREATE TABLE IF NOT EXISTS kalshi_scan_alerts (
          id BIGSERIAL PRIMARY KEY, user_sub TEXT NOT NULL, ticker TEXT NOT NULL,
          strength TEXT, edge_net NUMERIC, channel TEXT, delivered BOOLEAN NOT NULL DEFAULT FALSE,
          detail JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
          CONSTRAINT kalshi_scan_alerts_user_ticker UNIQUE (user_sub, ticker)
        );
        -- batch_id groups the hands announced TOGETHER; the daily budget counts batches, not rows.
        ALTER TABLE kalshi_scan_alerts ADD COLUMN IF NOT EXISTS batch_id UUID;
        CREATE INDEX IF NOT EXISTS idx_kalshi_scan_alerts_user ON kalshi_scan_alerts (user_sub, created_at DESC);
      `);
        })().catch((err) => { schemaReady = null; log.error({ err }, 'kalshi scan schema ensure failed'); });
    }
    return schemaReady;
}
/* ── config: manifest defaults + DB overrides ───────────────────────────────── */
let manifestCache = null;
const MANIFEST_TTL_MS = 60_000;
/**
 * @description Parse this package's OWN oshal-app.yaml. Cached for a minute so an edited manifest
 * is picked up without a restart. js-yaml resolves from the framework's node_modules (this package
 * sits under the workspace volume, whose parent chain reaches /app/node_modules); if it cannot, the
 * in-code defaults still stand and the scan still runs.
 * @param appPackageDir - This package's directory (ctx.appPackageDir, captured at factory time).
 * @returns The parsed manifest, or null when unreadable.
 */
function readManifest(appPackageDir) {
    if (manifestCache && Date.now() - manifestCache.at < MANIFEST_TTL_MS)
        return manifestCache.manifest;
    let manifest = null;
    const candidates = [
        appPackageDir ? path.join(appPackageDir, 'oshal-app.yaml') : '',
        path.resolve(__dirname, '..', 'oshal-app.yaml'),
    ].filter(Boolean);
    for (const file of candidates) {
        try {
            if (!fs.existsSync(file))
                continue;
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const yaml = require('js-yaml');
            manifest = yaml.load(fs.readFileSync(file, 'utf8'));
            break;
        }
        catch (err) {
            log.warn({ err, file }, 'kalshi: manifest read failed — using in-code defaults');
        }
    }
    manifestCache = { manifest, at: Date.now() };
    return manifest;
}
/**
 * @description Layer 2 of the config: the `settings.schema.*.default` values from the manifest —
 * the YAML the ask called for ("all of this should be in the yaml as config").
 * @param appPackageDir - This package's directory.
 * @returns The manifest's config patch (empty when unreadable).
 */
function manifestScanDefaults(appPackageDir) {
    return (0, kalshi_scan_config_1.manifestConfigDefaults)(readManifest(appPackageDir));
}
/**
 * @description The manifest's raw `settings.schema` — type/default/label/scope/bounds per key. The
 * Settings tab RENDERS FROM THIS, so the YAML is genuinely the source of truth for the knobs a
 * person sees (labels and bounds included), not just for their starting values.
 * @param appPackageDir - This package's directory.
 * @returns The schema map, or {} when the manifest is unreadable.
 */
function manifestSettingsSchema(appPackageDir) {
    const schema = readManifest(appPackageDir)
        ?.settings?.schema;
    if (!schema || typeof schema !== 'object')
        return {};
    const out = {};
    for (const [key, entry] of Object.entries(schema)) {
        if (entry && typeof entry === 'object')
            out[key] = entry;
    }
    return out;
}
/** Last successfully-read override row per scope. A read error must not silently revert to the
 *  DEFAULTS: `scanEnabled` defaults to TRUE, so a DB hiccup would restart a scan an operator had
 *  explicitly switched off (self-review, 2026-07-30). Falling back to the last KNOWN row preserves
 *  the operator's intent for as long as this process lives. */
const lastGoodSettings = new Map();
/** @description Read one settings row's stored patch. Absent row = {}; a failed read reuses the
 *  last successfully-read value for that scope (and only then falls back to {}). */
async function readSettingsRow(pool, scopeKey) {
    try {
        await ensureScanSchema(pool);
        const { rows } = await pool.query('SELECT settings FROM kalshi_scan_settings WHERE scope_key = $1', [scopeKey]);
        const raw = rows[0]?.settings;
        const patch = raw && typeof raw === 'object' ? raw : {};
        lastGoodSettings.set(scopeKey, patch);
        return patch;
    }
    catch (err) {
        const cached = lastGoodSettings.get(scopeKey);
        log.error({ err, scopeKey, usedCache: !!cached }, 'kalshi settings read failed — reusing the last known row (never silently re-enabling)');
        return cached ?? {};
    }
}
/**
 * @description Is this app still installed AND active? The poller lives in the api process, so
 * without this an operator toggling the app OFF (`PATCH /api/swarm/apps/kalshi/toggle`) would
 * unmount the routes while the scan kept running and kept alerting — the exact runaway ADR-085 P0
 * describes, and a direct violation of "only if you have the application" (self-review,
 * 2026-07-30). Unknown/unreadable state answers TRUE (a schema variant must not silently stop a
 * working scan); an explicit non-active status answers false.
 * @param pool - Postgres pool.
 * @returns Whether the scan is allowed to run right now.
 */
async function appIsActive(pool) {
    try {
        const { rows } = await pool.query("SELECT status FROM swarm_applications WHERE name = 'kalshi' LIMIT 1");
        if (!rows.length)
            return false; // not installed → nothing to scan for
        return String(rows[0].status) === 'active';
    }
    catch (err) {
        log.error({ err }, 'kalshi app-active check failed — assuming active');
        return true;
    }
}
/** Advisory-lock key for "one Kalshi scan cycle at a time", deployment-wide. A fixed bigint (not
 *  hashtext) so it needs no server function and can be looked up in pg_locks by value. */
const SCAN_LEASE_KEY = 4218271001;
/**
 * @description Run `fn` while holding a deployment-wide Postgres advisory lease, or return null
 * without running it when another process already holds it. The per-process single-flight can only
 * see its own runtime; this is what actually stops two api replicas (or a reloaded module instance)
 * from walking Kalshi's public tier twice in the same window — a claim the first version made in
 * its docs without implementing it (self-review, 2026-07-30).
 *
 * The lease is session-scoped, so it is taken on a DEDICATED client held for the whole cycle
 * (`pg_advisory_xact_lock` would mean an open transaction across a ~23s multi-query walk).
 * @param pool - Postgres pool.
 * @param fn - The cycle to run under the lease.
 * @returns fn's result, or null when the lease was already held.
 */
async function withScanLease(pool, fn) {
    const client = await pool.connect();
    let held = false;
    try {
        const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [SCAN_LEASE_KEY]);
        held = rows[0]?.ok === true;
        if (!held) {
            log.info('kalshi scan lease is held elsewhere — skipping this cycle');
            return null;
        }
        return await fn();
    }
    finally {
        if (held)
            await client.query('SELECT pg_advisory_unlock($1)', [SCAN_LEASE_KEY]).catch((err) => log.error({ err }, 'kalshi scan lease unlock failed (released with the connection)'));
        client.release();
    }
}
/**
 * @description Persist a settings patch for one scope. Only keys that scope OWNS are stored, and
 * every value passes the same clamp the runtime uses, so a hand-crafted PUT can neither reach
 * another scope's knobs nor park an out-of-range cadence in the row.
 * @param pool - Postgres pool.
 * @param scopeKey - DEPLOYMENT_SCOPE or a user sub.
 * @param scope - Which allow-list applies.
 * @param patch - Candidate values.
 * @returns The stored (merged) patch for that scope.
 */
async function writeSettingsRow(pool, scopeKey, scope, patch) {
    await ensureScanSchema(pool);
    const clean = (0, kalshi_scan_config_1.scopedPatch)(patch, scope);
    const merged = { ...(await readSettingsRow(pool, scopeKey)), ...clean };
    await pool.query(`INSERT INTO kalshi_scan_settings (scope_key, settings, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (scope_key) DO UPDATE SET settings = $2::jsonb, updated_at = now()`, [scopeKey, JSON.stringify(merged)]);
    log.info({ scopeKey, scope, keys: Object.keys(clean) }, 'kalshi scan settings updated');
    return merged;
}
/**
 * @description Resolve the effective config: in-code defaults → manifest YAML → deployment row →
 * (optionally) the user's row. Pass a sub for anything user-facing (alerts); omit it for the
 * poller's own cadence decisions.
 * @param ctx - App context (pool + appPackageDir).
 * @param userSub - The user whose alert knobs apply, when relevant.
 * @returns The fully resolved, clamped config.
 */
async function resolveConfig(ctx, userSub) {
    const deployment = await readSettingsRow(ctx.pool, exports.DEPLOYMENT_SCOPE);
    const user = userSub ? await readSettingsRow(ctx.pool, userSub) : null;
    return (0, kalshi_scan_config_1.resolveScanConfig)([
        { patch: manifestScanDefaults(ctx.appPackageDir), scope: 'any' },
        { patch: deployment, scope: 'deployment' },
        user ? { patch: user, scope: 'user' } : null,
    ]);
}
/* ── durable snapshot ───────────────────────────────────────────────────────── */
/** @description Read the latest stored scan snapshot (null before the first scan lands). */
async function readSnapshot(pool) {
    try {
        await ensureScanSchema(pool);
        const { rows } = await pool.query('SELECT payload, generated_at FROM kalshi_scan_snapshots WHERE id = 1');
        if (!rows.length)
            return null;
        return {
            payload: rows[0].payload,
            generatedAt: new Date(rows[0].generated_at).toISOString(),
        };
    }
    catch (err) {
        log.error({ err }, 'kalshi snapshot read failed');
        return null;
    }
}
/** @description Store this cycle's snapshot as the one the surface serves. */
async function writeSnapshot(pool, payload) {
    try {
        await ensureScanSchema(pool);
        await pool.query(`INSERT INTO kalshi_scan_snapshots (id, payload, generated_at, scan_ms) VALUES (1, $1::jsonb, $2, $3)
       ON CONFLICT (id) DO UPDATE SET payload = $1::jsonb, generated_at = $2, scan_ms = $3`, [JSON.stringify(payload), payload.generatedAt, payload.scanMs ?? null]);
    }
    catch (err) {
        log.error({ err }, 'kalshi snapshot write failed');
    }
}
/* ── the scan ───────────────────────────────────────────────────────────────── */
/**
 * Pre-register the scan's hands as PREDICTIONS so the strategy you can actually click "Bet" on is
 * also the strategy reality grades. Immutable: ON CONFLICT DO NOTHING, so a hand's first-seen
 * probability is the one it is judged on.
 */
async function recordScanPredictions(pool, hands) {
    for (const h of hands) {
        await pool.query(`INSERT INTO kalshi_predictions
         (strategy, ticker, event_ticker, series_ticker, predicted_prob, market_prob, edge_net,
          stake_fraction, side, rationale, close_time)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (strategy, ticker) DO NOTHING`, [exports.SCAN_STRATEGY, h.ticker, h.eventTicker, h.ticker.split('-')[0], h.trueProb, h.price, h.edgeNet,
            h.stakeFraction, h.side,
            JSON.stringify({ strength: h.strength, confidence: h.confidence, calibrationN: h.calibrationN, riskFlags: h.riskFlags }),
            h.closeTime]).catch((err) => log.error({ err, ticker: h.ticker }, 'scan prediction record failed'));
    }
}
/**
 * @description Run one full scan: walk the open-market feed (bounded by the resolved config),
 * rank the hands against the calibration table, pre-register them as predictions, then apply the
 * evidence gate (an unproven/failing strategy shows its hands with a ZERO stake). Unchanged
 * behaviour from the request-path version — only the bounds are configurable now.
 * @param pool - Postgres pool (prediction ledger + scorecard).
 * @param cfg - The resolved deployment config (feed-walk bounds).
 * @returns The scan payload, ready to store and serve.
 */
async function runScan(pool, cfg) {
    const started = Date.now();
    const { table, mtime } = loadCalibration();
    if (!table)
        throw new Error('calibration table missing — run scripts/oshal-kalshi-calibration.ts');
    const [active, walk] = await Promise.all([
        (0, prediction_markets_1.exchangeTradingActive)().catch(() => false),
        (0, prediction_markets_1.listMarketsFiltered)({ status: 'open' }, evaluableMarket, {
            maxKeep: cfg.scanMaxMarketsKept, maxPaged: cfg.scanMaxMarketsPaged,
        }),
    ]);
    const seriesByTicker = new Map();
    for (const m of walk.markets) {
        if (!seriesByTicker.has(m.seriesTicker))
            seriesByTicker.set(m.seriesTicker, await (0, prediction_markets_1.getSeriesMeta)(m.seriesTicker));
    }
    let hands = (0, prediction_markets_1.rankHands)(walk.markets, seriesByTicker, table);
    // Record BEFORE gating, so the prediction is judged on what the model actually believed.
    await recordScanPredictions(pool, hands);
    const gate = await (0, prediction_markets_1.mayStrategyStake)(pool, exports.SCAN_STRATEGY);
    if (!gate.mayStake)
        hands = hands.map((h) => ({ ...h, stakeFraction: 0 }));
    const scorecard = await (0, prediction_markets_1.getScorecard)(pool).catch(() => []);
    const scanMs = Date.now() - started;
    log.info({
        openPaged: walk.paged, evaluable: walk.markets.length, hands: hands.length,
        mayStake: gate.mayStake, ms: scanMs,
    }, 'kalshi scan complete');
    return {
        generatedAt: new Date().toISOString(), exchangeActive: active, calibrationGeneratedAt: table.generatedAt,
        calibrationFileMtime: mtime, openPaged: walk.paged, evaluable: walk.markets.length, hands,
        strategy: exports.SCAN_STRATEGY, mayStake: gate.mayStake, gateReason: gate.reason, scorecard, scanMs,
    };
}
/* ── alert ledger ───────────────────────────────────────────────────────────── */
/** How far back the dedup read looks. A settled market never reappears in an open-market scan, so
 *  a bounded window is safe — and it stops the per-cycle read from growing without limit. Rows are
 *  pruned at twice this age (still UNIQUE-protected in between). */
const DEDUP_WINDOW_DAYS = 120;
const LEDGER_PRUNE_DAYS = DEDUP_WINDOW_DAYS * 2;
/**
 * @description Tickers this user has already been alerted about (the first-seen dedup set), within
 * the dedup window.
 *
 * Returns **null** when the ledger cannot be read — the caller must then skip this user's alerts
 * entirely. The previous version returned a set containing a sentinel string and called itself
 * "fail closed"; no real ticker ever matches a sentinel, so it actually failed OPEN and a single
 * DB blip would have re-announced every hand the user had ever been told about (self-review,
 * 2026-07-30). A guarantee in a comment that the code does not implement is worse than no comment.
 * @param pool - Postgres pool.
 * @param userSub - Whose ledger.
 * @returns The alerted-ticker set, or null when the read failed.
 */
async function alertedTickers(pool, userSub) {
    try {
        await ensureScanSchema(pool);
        const { rows } = await pool.query(`SELECT ticker FROM kalshi_scan_alerts
        WHERE user_sub = $1 AND created_at > now() - ($2 || ' days')::interval`, [userSub, String(DEDUP_WINDOW_DAYS)]);
        return new Set(rows.map((r) => String(r.ticker)));
    }
    catch (err) {
        log.error({ err, userSub }, 'kalshi alert ledger read failed — this user gets NO alerts this cycle');
        return null;
    }
}
/**
 * @description How many ALERTS (announcements, not hands) this user has had in the rolling 24h.
 * Counts DISTINCT batch ids: one announcement names up to `alertTopN` hands and writes one ledger
 * row each, so counting rows made `alertMaxPerDay: 6` behave like "6 hands/day" — roughly ONE
 * announcement — which is not what the knob says (self-review, 2026-07-30).
 * @param pool - Postgres pool.
 * @param userSub - Whose budget.
 * @returns The count, or null when the read failed (the caller then suppresses).
 */
async function alertsSentToday(pool, userSub) {
    try {
        await ensureScanSchema(pool);
        const { rows } = await pool.query(`SELECT count(DISTINCT COALESCE(batch_id::text, id::text))::int AS n FROM kalshi_scan_alerts
        WHERE user_sub = $1 AND created_at > now() - interval '24 hours'`, [userSub]);
        return Number(rows[0]?.n || 0);
    }
    catch (err) {
        log.error({ err, userSub }, 'kalshi alert budget read failed — suppressing this user this cycle');
        return null;
    }
}
/** One ledger write: this user was alerted about this ticker (UNIQUE, so it is also the dedup key).
 *  `batchId` groups the hands announced together, which is what the daily budget counts. */
async function recordAlert(pool, userSub, hand, channel, delivered, batchId, detail) {
    try {
        await pool.query(`INSERT INTO kalshi_scan_alerts (user_sub, ticker, strength, edge_net, channel, delivered, batch_id, detail)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
       ON CONFLICT (user_sub, ticker) DO NOTHING`, [userSub, hand.ticker, hand.strength ?? null, hand.edgeNet ?? null, channel, delivered, batchId,
            detail ? JSON.stringify(detail) : null]);
    }
    catch (err) {
        log.error({ err, userSub, ticker: hand.ticker }, 'kalshi alert ledger write failed');
    }
}
/** @description Drop ledger rows older than twice the dedup window. Cheap, indexed, best-effort. */
async function pruneAlertLedger(pool) {
    try {
        const res = await pool.query(`DELETE FROM kalshi_scan_alerts WHERE created_at < now() - ($1 || ' days')::interval`, [String(LEDGER_PRUNE_DAYS)]);
        if (res.rowCount)
            log.info({ pruned: res.rowCount }, 'kalshi alert ledger pruned');
    }
    catch (err) {
        log.error({ err }, 'kalshi alert ledger prune failed (non-fatal)');
    }
}
/** @description The caller's recent alerts, newest first — the surface's Alerts list. */
async function listAlerts(pool, userSub, limit = 50) {
    await ensureScanSchema(pool);
    const { rows } = await pool.query(`SELECT ticker, strength, edge_net, channel, delivered, detail, created_at
       FROM kalshi_scan_alerts WHERE user_sub = $1 ORDER BY created_at DESC LIMIT $2`, [userSub, Math.min(200, Math.max(1, limit))]);
    return rows;
}
/**
 * @description Users the background scan may alert: everyone with a Kalshi connection saved, plus
 * anyone who has explicitly touched the app's settings. "Only if you have the application" is
 * enforced twice over — this package's poller only exists while the app is ACTIVE (its routes are
 * mounted), and within that, only these subs are ever notified.
 * @param pool - Postgres pool.
 * @returns Distinct user subs.
 */
async function alertAudience(pool) {
    try {
        await ensureScanSchema(pool);
        const { rows } = await pool.query(`SELECT DISTINCT sub FROM (
         SELECT user_sub AS sub FROM oshal_connections WHERE provider = 'kalshi' AND user_sub IS NOT NULL
         UNION
         SELECT scope_key AS sub FROM kalshi_scan_settings WHERE scope_key <> $1
       ) s WHERE sub IS NOT NULL AND sub <> ''`, [exports.DEPLOYMENT_SCOPE]);
        return rows.map((r) => String(r.sub));
    }
    catch (err) {
        log.error({ err }, 'kalshi alert audience lookup failed');
        return [];
    }
}
//# sourceMappingURL=kalshi-scan-engine.js.map