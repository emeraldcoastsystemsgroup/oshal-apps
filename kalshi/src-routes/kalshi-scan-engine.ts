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
 * 2026-09-04 23:40:00 | roger.murphy@emeraldcoastsystemsgroup.com   | listAlerts joins each alert to its pre-registered prediction (same ticker, SCAN_STRATEGY) so the Alerts tab carries the settlement OUTCOME — settled, won, one-contract P&L — and alertRecord folds the whole ledger into a W-L line. The grades were always there (recordPredictions + the daily grader); the surface just never showed them per alert (operator, 2026-09-04: "where is the win/loss record").
 * 2026-09-04 23:55:00 | roger.murphy@emeraldcoastsystemsgroup.com   | recordContrarianPredictions — the zero-stake "contrarian-extreme" sibling of every extreme scan hand (rule in kalshi-scan-config.ts), inserted into the same immutable ledger right after the scan's own predictions so the daily grader and the Scorecard tab treat it like any strategy. Operator, 2026-09-04: "bet against ourselves at the extremes - forward test it".
 * 2026-10-10 00:00:00 | maintainer@emeraldcoastsystemsgroup.com     | ensureScanSchema issues no DDL on the native kernel (OSHAL_EGRESS=kernel): the declared migrations 074-076 provision these tables there, and the runtime ALTER and DESC index made every read refuse with "SQL mutation requires original writer admission" (logged as "kalshi scan schema ensure failed" once per read). The runtime CREATE TABLE for kalshi_scan_alerts now declares batch_id itself, as migration 076 does.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | The calibration table is read from this package's own directory (<appPackageDir>/data/kalshi-calibration.json) before the legacy <cwd>/config-seed copy; the native runtime has no config-seed, so every scan failed with "calibration table missing — run scripts/oshal-kalshi-calibration.ts", a script that does not exist there. A missing table now names both places it was looked for. scanUnavailableReason says, before any SQL or feed read, why a scan cannot run on this installation: no Kalshi market-feed reader in the runtime (the native runtime provides none) or no calibration table. Guard: tests/kalshi-scan-schedule.test.js.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | lookupMarketLive reads ONE market from Kalshi's public API (never a feed walk) and prices it against the shipped calibration table for GET /markets/:ticker's Look up; it lives here, not in the routes, so the structural guard that keeps the feed reader out of kalshi-routes still holds. Refusals are typed: no market reader (503), no calibration table (503), unknown ticker (404).
 * 7 | maintainer@emeraldcoastsystemsgroup.com | The snapshot keeps every market the walk kept (payload.markets, one browse row each: book, horizon, the evaluator's better-side hand or why it skipped the market), not only the playable hands, so the Markets tab and the quant can browse Kalshi and explain every verdict (kalshi-market-explainer). Guard: tests/kalshi-markets-routes.test.js.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | The package ships its calibration table (data/kalshi-calibration.json, the platform study's table generated 2026-07-13, with a provenance block), so the scan can run on the native runtime. A missing table's sentence is in words: the page printed it as the gate reason with /package/... file paths in it; the places looked are logged instead. Guard: tests/kalshi-calibration-shipped.test.js.
 * 9 | maintainer@emeraldcoastsystemsgroup.com | appIsActive answers true on the native kernel without a query: there is no swarm_applications registry there, the package's SQL namespace answered the query with zero rows, and every scheduled tick quit with app_inactive (live 2026-10-30, 41 ticks, no scan). The kernel ticks only an installed, active application with a standing activation. Off the kernel the Docker stack's registry check is unchanged. Guard: tests/kalshi-scan-schedule.test.js.
 *
 * @module kalshi-scan-engine
 */
import * as fs from 'fs';
import * as path from 'path';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import {
  exchangeTradingActive,
  listMarketsFiltered,
  getSeriesMeta,
  rankHands,
  evaluateMarket,
  kalshiGet,
  normalizeMarket,
  getScorecard,
  mayStrategyStake,
  type BetHand,
  type CalibrationTable,
  type KalshiMarket,
  type KalshiSeriesMeta,
  type StrategyScore,
} from '@/features/prediction-markets';
import {
  KALSHI_SCAN_DEFAULTS,
  manifestConfigDefaults,
  resolveScanConfig,
  scopedPatch,
  type KalshiScanConfig,
  summarizeAlertRecord, type AlertRecord,
  CONTRARIAN_EXTREME_STRATEGY, contrarianExtremeRow,
} from './kalshi-scan-config';
import { browseMarket, type BrowseMarket } from './kalshi-market-explainer';

const log = createChildLogger({ module: 'kalshi-scan-engine' });

/** The scan's hands come from the calibration engine — score them under that name. */
export const SCAN_STRATEGY = 'calibration';

/** Deployment-scope settings row key (a real user_sub can never collide: subs never start with '__'). */
export const DEPLOYMENT_SCOPE = '__deployment__';

/** What `GET /scan` serves and the poller stores. */
export interface ScanPayload {
  generatedAt: string;
  exchangeActive: boolean;
  calibrationGeneratedAt: string | null;
  calibrationFileMtime: string | null;
  openPaged: number;
  evaluable: number;
  hands: BetHand[];
  /** Every market the walk kept, playable or not, for the Markets tab and the quant (absent in snapshots older than 1.7.0). */
  markets?: BrowseMarket[];
  strategy: string;
  mayStake: boolean;
  gateReason: string | null;
  scorecard: StrategyScore[];
  /** Wall-clock the scan took — the number that started this whole rework. */
  scanMs?: number;
}

/* ── calibration table ──────────────────────────────────────────────────────── */

/**
 * @description Where the calibration table may live, in the order they are read: this package's own copy, then
 * the legacy platform's config-seed directory (which the native runtime does not have).
 * @param appPackageDir - This package's directory (ctx.appPackageDir), when known.
 * @returns Absolute candidate paths.
 */
export function calibrationPaths(appPackageDir?: string): string[] {
  const own = appPackageDir ? [path.join(appPackageDir, 'data', 'kalshi-calibration.json')] : [];
  return [...own, path.resolve(process.cwd(), 'config-seed', 'kalshi-calibration.json')];
}

/**
 * @description Load the settled-tape calibration table + its file mtime (null when absent).
 * @param appPackageDir - This package's directory, searched first.
 * @returns The table, its mtime and the path it came from; all null when no candidate is readable.
 */
export function loadCalibration(appPackageDir?: string): { table: CalibrationTable | null; mtime: string | null; path: string | null } {
  for (const p of calibrationPaths(appPackageDir)) {
    try {
      const stat = fs.statSync(p);
      return { table: JSON.parse(fs.readFileSync(p, 'utf8')) as CalibrationTable, mtime: stat.mtime.toISOString(), path: p };
    } catch {
      // not here (or unreadable): try the next place
    }
  }
  return { table: null, mtime: null, path: null };
}

/**
 * @description The sentence for a missing calibration table, in words a person reads on the page: no file paths
 * (the places looked are logged), and that a scan ranks nothing without it.
 * @param appPackageDir - This package's directory.
 * @returns The sentence.
 */
export function calibrationMissing(appPackageDir?: string): string {
  log.warn({ looked: calibrationPaths(appPackageDir) }, 'kalshi calibration table not found');
  return 'No calibration table is installed with Kalshi on this installation. The scan ranks markets against '
    + 'that table of settled markets, so it cannot run without it.';
}

/**
 * @description Why a scan cannot run on this installation, checked before any SQL or feed read; null when it can.
 * The native runtime provides no Kalshi market-feed reader, and without the calibration table nothing can be ranked.
 * @param appPackageDir - This package's directory.
 * @returns The reason, or null.
 */
export function scanUnavailableReason(appPackageDir?: string): string | null {
  const reader = { listMarketsFiltered, getSeriesMeta, rankHands, mayStrategyStake };
  const missing = Object.entries(reader).filter(([, fn]) => typeof fn !== 'function').map(([name]) => name);
  if (missing.length) {
    return 'No Kalshi market feed is connected on this installation: the runtime provides no prediction-markets '
      + `market reader (${missing.join(', ')}), so the background scan cannot walk Kalshi's open markets.`;
  }
  return loadCalibration(appPackageDir).table ? null : calibrationMissing(appPackageDir);
}

/** Evaluable = real single market with a two-sided book and at least one trade printed. */
export function evaluableMarket(m: KalshiMarket): boolean {
  return !m.isMultivariate && m.yesAsk > 0 && m.noAsk > 0 && m.volume > 0;
}

/* ── owned schema (idempotent; mirrors the shipped migration) ───────────────── */

let schemaReady: Promise<void> | null = null;

/**
 * @description Create this app's scan tables if absent. Runs once per process, awaited by every
 * caller — the package must work whether or not APP_PACKAGE_MIGRATIONS applied migrations/. On the
 * native kernel it issues nothing: the kernel provisions the declared migrations, and a read there
 * may not declare or alter schema.
 * @param pool - Postgres pool.
 * @returns Resolves when the schema is present (or the attempt failed and was logged).
 */
export function ensureScanSchema(pool: AppContext['pool']): Promise<void> {
  // The native kernel provisions the declared migrations (074-076) itself, and a read there may not
  // declare or alter schema: the runtime DDL below would make every read refuse.
  if (process.env.OSHAL_EGRESS === 'kernel') return Promise.resolve();
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
          batch_id UUID,
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

let manifestCache: { manifest: unknown; at: number } | null = null;
const MANIFEST_TTL_MS = 60_000;

/**
 * @description Parse this package's OWN oshal-app.yaml. Cached for a minute so an edited manifest
 * is picked up without a restart. js-yaml resolves from the framework's node_modules (this package
 * sits under the workspace volume, whose parent chain reaches /app/node_modules); if it cannot, the
 * in-code defaults still stand and the scan still runs.
 * @param appPackageDir - This package's directory (ctx.appPackageDir, captured at factory time).
 * @returns The parsed manifest, or null when unreadable.
 */
function readManifest(appPackageDir: string | undefined): unknown {
  if (manifestCache && Date.now() - manifestCache.at < MANIFEST_TTL_MS) return manifestCache.manifest;
  let manifest: unknown = null;
  const candidates = [
    appPackageDir ? path.join(appPackageDir, 'oshal-app.yaml') : '',
    path.resolve(__dirname, '..', 'oshal-app.yaml'),
  ].filter(Boolean);
  for (const file of candidates) {
    try {
      if (!fs.existsSync(file)) continue;
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const yaml = require('js-yaml') as { load(s: string): unknown };
      manifest = yaml.load(fs.readFileSync(file, 'utf8'));
      break;
    } catch (err) {
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
export function manifestScanDefaults(appPackageDir: string | undefined): Partial<KalshiScanConfig> {
  return manifestConfigDefaults(readManifest(appPackageDir));
}

/**
 * @description The manifest's raw `settings.schema` — type/default/label/scope/bounds per key. The
 * Settings tab RENDERS FROM THIS, so the YAML is genuinely the source of truth for the knobs a
 * person sees (labels and bounds included), not just for their starting values.
 * @param appPackageDir - This package's directory.
 * @returns The schema map, or {} when the manifest is unreadable.
 */
export function manifestSettingsSchema(appPackageDir: string | undefined): Record<string, Record<string, unknown>> {
  const schema = (readManifest(appPackageDir) as { settings?: { schema?: Record<string, unknown> } } | null)
    ?.settings?.schema;
  if (!schema || typeof schema !== 'object') return {};
  const out: Record<string, Record<string, unknown>> = {};
  for (const [key, entry] of Object.entries(schema)) {
    if (entry && typeof entry === 'object') out[key] = entry as Record<string, unknown>;
  }
  return out;
}

/** Last successfully-read override row per scope. A read error must not silently revert to the
 *  DEFAULTS: `scanEnabled` defaults to TRUE, so a DB hiccup would restart a scan an operator had
 *  explicitly switched off (self-review, 2026-07-30). Falling back to the last KNOWN row preserves
 *  the operator's intent for as long as this process lives. */
const lastGoodSettings = new Map<string, Record<string, unknown>>();

/** @description Read one settings row's stored patch. Absent row = {}; a failed read reuses the
 *  last successfully-read value for that scope (and only then falls back to {}). */
export async function readSettingsRow(pool: AppContext['pool'], scopeKey: string): Promise<Record<string, unknown>> {
  try {
    await ensureScanSchema(pool);
    const { rows } = await pool.query('SELECT settings FROM kalshi_scan_settings WHERE scope_key = $1', [scopeKey]);
    const raw = rows[0]?.settings;
    const patch = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
    lastGoodSettings.set(scopeKey, patch);
    return patch;
  } catch (err) {
    const cached = lastGoodSettings.get(scopeKey);
    log.error({ err, scopeKey, usedCache: !!cached },
      'kalshi settings read failed — reusing the last known row (never silently re-enabling)');
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
 *
 * On the native kernel there is no `swarm_applications` registry: a package's SQL namespace answers
 * that query with zero rows, which this check read as "not installed", and every scheduled tick
 * quit with `app_inactive` (live 2026-10-30: 41 ticks in a day, each HTTP 200 in 0.2 s, the
 * person's snapshot still from 10/13). There the kernel is the authority: it mounts these routes
 * only while the application is installed and active, fires a person's schedule only while their
 * activation stands, and suspends the schedule when the package's authority changes. So on the
 * kernel this answers true without a query.
 * @param pool - Postgres pool.
 * @returns Whether the scan is allowed to run right now.
 */
export async function appIsActive(pool: AppContext['pool']): Promise<boolean> {
  if (process.env.OSHAL_EGRESS === 'kernel') return true;
  try {
    const { rows } = await pool.query("SELECT status FROM swarm_applications WHERE name = 'kalshi' LIMIT 1");
    if (!rows.length) return false;             // not installed → nothing to scan for
    return String(rows[0].status) === 'active';
  } catch (err) {
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
export async function withScanLease<T>(pool: AppContext['pool'], fn: () => Promise<T>): Promise<T | null> {
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
  } finally {
    if (held) await client.query('SELECT pg_advisory_unlock($1)', [SCAN_LEASE_KEY]).catch(
      (err) => log.error({ err }, 'kalshi scan lease unlock failed (released with the connection)'));
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
export async function writeSettingsRow(
  pool: AppContext['pool'], scopeKey: string, scope: 'deployment' | 'user', patch: unknown,
): Promise<Record<string, unknown>> {
  await ensureScanSchema(pool);
  const clean = scopedPatch(patch, scope);
  const merged = { ...(await readSettingsRow(pool, scopeKey)), ...clean };
  await pool.query(
    `INSERT INTO kalshi_scan_settings (scope_key, settings, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (scope_key) DO UPDATE SET settings = $2::jsonb, updated_at = now()`,
    [scopeKey, JSON.stringify(merged)],
  );
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
export async function resolveConfig(ctx: AppContext, userSub?: string | null): Promise<KalshiScanConfig> {
  const deployment = await readSettingsRow(ctx.pool, DEPLOYMENT_SCOPE);
  const user = userSub ? await readSettingsRow(ctx.pool, userSub) : null;
  return resolveScanConfig([
    { patch: manifestScanDefaults(ctx.appPackageDir), scope: 'any' },
    { patch: deployment, scope: 'deployment' },
    user ? { patch: user, scope: 'user' } : null,
  ]);
}

/* ── durable snapshot ───────────────────────────────────────────────────────── */

/** @description Read the latest stored scan snapshot (null before the first scan lands). */
export async function readSnapshot(
  pool: AppContext['pool'],
): Promise<{ payload: ScanPayload; generatedAt: string } | null> {
  try {
    await ensureScanSchema(pool);
    const { rows } = await pool.query('SELECT payload, generated_at FROM kalshi_scan_snapshots WHERE id = 1');
    if (!rows.length) return null;
    return {
      payload: rows[0].payload as ScanPayload,
      generatedAt: new Date(rows[0].generated_at as string).toISOString(),
    };
  } catch (err) {
    log.error({ err }, 'kalshi snapshot read failed');
    return null;
  }
}

/** @description Store this cycle's snapshot as the one the surface serves. */
export async function writeSnapshot(pool: AppContext['pool'], payload: ScanPayload): Promise<void> {
  try {
    await ensureScanSchema(pool);
    await pool.query(
      `INSERT INTO kalshi_scan_snapshots (id, payload, generated_at, scan_ms) VALUES (1, $1::jsonb, $2, $3)
       ON CONFLICT (id) DO UPDATE SET payload = $1::jsonb, generated_at = $2, scan_ms = $3`,
      [JSON.stringify(payload), payload.generatedAt, payload.scanMs ?? null],
    );
  } catch (err) {
    log.error({ err }, 'kalshi snapshot write failed');
  }
}

/**
 * Pre-register the CONTRARIAN sibling of every extreme hand — the "bet against ourselves" hypothesis,
 * rule fixed in kalshi-scan-config.ts. Same ledger, own strategy name, zero stake, immutable, so the
 * grader scores it against the market exactly as it scores the scan, and the Scorecard can retire it.
 */
async function recordContrarianPredictions(pool: AppContext['pool'], hands: BetHand[]): Promise<void> {
  for (const h of hands) {
    const row = contrarianExtremeRow(h);
    if (!row) continue;
    await pool.query(
      `INSERT INTO kalshi_predictions
         (strategy, ticker, event_ticker, series_ticker, predicted_prob, market_prob, edge_net,
          stake_fraction, side, rationale, close_time)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (strategy, ticker) DO NOTHING`,
      [CONTRARIAN_EXTREME_STRATEGY, row.ticker, row.eventTicker, row.seriesTicker, row.predictedProb, row.marketProb,
        row.edgeNet, row.stakeFraction, row.side, JSON.stringify(row.rationale), row.closeTime],
    ).catch((err) => log.error({ err, ticker: h.ticker }, 'contrarian prediction record failed'));
  }
}

/* ── the scan ───────────────────────────────────────────────────────────────── */

/**
 * Pre-register the scan's hands as PREDICTIONS so the strategy you can actually click "Bet" on is
 * also the strategy reality grades. Immutable: ON CONFLICT DO NOTHING, so a hand's first-seen
 * probability is the one it is judged on.
 */
async function recordScanPredictions(pool: AppContext['pool'], hands: BetHand[]): Promise<void> {
  for (const h of hands) {
    await pool.query(
      `INSERT INTO kalshi_predictions
         (strategy, ticker, event_ticker, series_ticker, predicted_prob, market_prob, edge_net,
          stake_fraction, side, rationale, close_time)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (strategy, ticker) DO NOTHING`,
      [SCAN_STRATEGY, h.ticker, h.eventTicker, h.ticker.split('-')[0], h.trueProb, h.price, h.edgeNet,
        h.stakeFraction, h.side,
        JSON.stringify({ strength: h.strength, confidence: h.confidence, calibrationN: h.calibrationN, riskFlags: h.riskFlags }),
        h.closeTime],
    ).catch((err) => log.error({ err, ticker: h.ticker }, 'scan prediction record failed'));
  }
}

/**
 * @description Run one full scan: walk the open-market feed (bounded by the resolved config),
 * rank the hands against the calibration table, pre-register them as predictions, then apply the
 * evidence gate (an unproven/failing strategy shows its hands with a ZERO stake). Unchanged
 * behaviour from the request-path version — only the bounds are configurable now.
 * @param pool - Postgres pool (prediction ledger + scorecard).
 * @param cfg - The resolved deployment config (feed-walk bounds).
 * @param appPackageDir - This package's directory, where its calibration table is read first.
 * @returns The scan payload, ready to store and serve.
 */
export async function runScan(pool: AppContext['pool'], cfg: KalshiScanConfig, appPackageDir?: string): Promise<ScanPayload> {
  const started = Date.now();
  const { table, mtime } = loadCalibration(appPackageDir);
  if (!table) throw new Error(calibrationMissing(appPackageDir));
  const [active, walk] = await Promise.all([
    exchangeTradingActive().catch(() => false),
    listMarketsFiltered({ status: 'open' }, evaluableMarket, {
      maxKeep: cfg.scanMaxMarketsKept, maxPaged: cfg.scanMaxMarketsPaged,
    }),
  ]);
  const seriesByTicker = new Map<string, KalshiSeriesMeta>();
  for (const m of walk.markets) {
    if (!seriesByTicker.has(m.seriesTicker)) seriesByTicker.set(m.seriesTicker, await getSeriesMeta(m.seriesTicker));
  }
  let hands = rankHands(walk.markets, seriesByTicker, table);
  const nowMs = Date.now();
  const markets = walk.markets.map((m) => browseMarket(m, seriesByTicker.get(m.seriesTicker), table, evaluateMarket, nowMs));
  // Record BEFORE gating, so the prediction is judged on what the model actually believed.
  await recordScanPredictions(pool, hands);
  await recordContrarianPredictions(pool, hands);
  const gate = await mayStrategyStake(pool, SCAN_STRATEGY);
  if (!gate.mayStake) hands = hands.map((h) => ({ ...h, stakeFraction: 0 }));
  const scorecard = await getScorecard(pool).catch(() => [] as StrategyScore[]);
  const scanMs = Date.now() - started;
  log.info({
    openPaged: walk.paged, evaluable: walk.markets.length, hands: hands.length,
    mayStake: gate.mayStake, ms: scanMs,
  }, 'kalshi scan complete');
  return {
    generatedAt: new Date().toISOString(), exchangeActive: active, calibrationGeneratedAt: table.generatedAt,
    calibrationFileMtime: mtime, openPaged: walk.paged, evaluable: walk.markets.length, hands, markets,
    strategy: SCAN_STRATEGY, mayStake: gate.mayStake, gateReason: gate.reason, scorecard, scanMs,
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
export async function alertedTickers(pool: AppContext['pool'], userSub: string): Promise<Set<string> | null> {
  try {
    await ensureScanSchema(pool);
    const { rows } = await pool.query(
      `SELECT ticker FROM kalshi_scan_alerts
        WHERE user_sub = $1 AND created_at > now() - ($2 || ' days')::interval`,
      [userSub, String(DEDUP_WINDOW_DAYS)]);
    return new Set(rows.map((r) => String(r.ticker)));
  } catch (err) {
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
export async function alertsSentToday(pool: AppContext['pool'], userSub: string): Promise<number | null> {
  try {
    await ensureScanSchema(pool);
    const { rows } = await pool.query(
      `SELECT count(DISTINCT COALESCE(batch_id::text, id::text))::int AS n FROM kalshi_scan_alerts
        WHERE user_sub = $1 AND created_at > now() - interval '24 hours'`, [userSub]);
    return Number(rows[0]?.n || 0);
  } catch (err) {
    log.error({ err, userSub }, 'kalshi alert budget read failed — suppressing this user this cycle');
    return null;
  }
}

/** One ledger write: this user was alerted about this ticker (UNIQUE, so it is also the dedup key).
 *  `batchId` groups the hands announced together, which is what the daily budget counts. */
export async function recordAlert(
  pool: AppContext['pool'], userSub: string,
  hand: { ticker: string; strength?: string; edgeNet?: number },
  channel: string, delivered: boolean, batchId: string, detail?: unknown,
): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO kalshi_scan_alerts (user_sub, ticker, strength, edge_net, channel, delivered, batch_id, detail)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb)
       ON CONFLICT (user_sub, ticker) DO NOTHING`,
      [userSub, hand.ticker, hand.strength ?? null, hand.edgeNet ?? null, channel, delivered, batchId,
        detail ? JSON.stringify(detail) : null],
    );
  } catch (err) {
    log.error({ err, userSub, ticker: hand.ticker }, 'kalshi alert ledger write failed');
  }
}

/** @description Drop ledger rows older than twice the dedup window. Cheap, indexed, best-effort. */
export async function pruneAlertLedger(pool: AppContext['pool']): Promise<void> {
  try {
    const res = await pool.query(
      `DELETE FROM kalshi_scan_alerts WHERE created_at < now() - ($1 || ' days')::interval`,
      [String(LEDGER_PRUNE_DAYS)]);
    if (res.rowCount) log.info({ pruned: res.rowCount }, 'kalshi alert ledger pruned');
  } catch (err) {
    log.error({ err }, 'kalshi alert ledger prune failed (non-fatal)');
  }
}

/**
 * @description The caller's recent alerts, newest first, each carrying its graded OUTCOME — the
 * surface's Alerts list. Every announced hand was pre-registered as a prediction (recordPredictions,
 * strategy = SCAN_STRATEGY) and is graded at settlement by the forward-test grader, so the join IS
 * the win/loss record: `settled`, `won` (the announced side matched settlement) and
 * `pnl_per_contract` (one contract bought at the ask, fees included) come from kalshi_predictions;
 * NULLs mean the market has not settled yet.
 * @param pool - Postgres pool.
 * @param userSub - Caller.
 * @param limit - Rows to return (1..200).
 * @returns Alert rows with outcome columns.
 */
export async function listAlerts(
  pool: AppContext['pool'], userSub: string, limit = 50,
): Promise<Array<Record<string, unknown>>> {
  await ensureScanSchema(pool);
  const { rows } = await pool.query(
    `SELECT a.ticker, a.strength, a.edge_net, a.channel, a.delivered, a.detail, a.created_at,
            p.settled, p.settled_yes, p.side AS graded_side, p.pnl_per_contract, p.graded_at,
            CASE WHEN p.settled THEN ((p.side = 'yes') = p.settled_yes) END AS won
       FROM kalshi_scan_alerts a
       LEFT JOIN kalshi_predictions p ON p.ticker = a.ticker AND p.strategy = $3
      WHERE a.user_sub = $1 ORDER BY a.created_at DESC LIMIT $2`,
    [userSub, Math.min(200, Math.max(1, limit)), SCAN_STRATEGY],
  );
  return rows;
}

/**
 * @description The caller's W-L record over every alert still in the ledger (the ledger prunes
 * itself — see pruneAlertLedger — so this is "recent", not all-time). Same join as listAlerts,
 * folded by the pure summarizeAlertRecord so the math is pinned by the plain-node suite.
 * @param pool - Postgres pool.
 * @param userSub - Caller.
 * @returns The record.
 */
export async function alertRecord(pool: AppContext['pool'], userSub: string): Promise<AlertRecord> {
  await ensureScanSchema(pool);
  const { rows } = await pool.query(
    `SELECT p.settled, p.pnl_per_contract,
            CASE WHEN p.settled THEN ((p.side = 'yes') = p.settled_yes) END AS won
       FROM kalshi_scan_alerts a
       LEFT JOIN kalshi_predictions p ON p.ticker = a.ticker AND p.strategy = $2
      WHERE a.user_sub = $1`,
    [userSub, SCAN_STRATEGY],
  );
  return summarizeAlertRecord(rows);
}

/**
 * @description Users the background scan may alert: everyone with a Kalshi connection saved, plus
 * anyone who has explicitly touched the app's settings. "Only if you have the application" is
 * enforced twice over — this package's poller only exists while the app is ACTIVE (its routes are
 * mounted), and within that, only these subs are ever notified.
 * @param pool - Postgres pool.
 * @returns Distinct user subs.
 */
export async function alertAudience(pool: AppContext['pool']): Promise<string[]> {
  try {
    await ensureScanSchema(pool);
    const { rows } = await pool.query(
      `SELECT DISTINCT sub FROM (
         SELECT user_sub AS sub FROM oshal_connections WHERE provider = 'kalshi' AND user_sub IS NOT NULL
         UNION
         SELECT scope_key AS sub FROM kalshi_scan_settings WHERE scope_key <> $1
       ) s WHERE sub IS NOT NULL AND sub <> ''`, [DEPLOYMENT_SCOPE]);
    return rows.map((r) => String(r.sub));
  } catch (err) {
    log.error({ err }, 'kalshi alert audience lookup failed');
    return [];
  }
}

/** Re-exported so the routes and the cron share one config vocabulary. */
export { KALSHI_SCAN_DEFAULTS };
export type { KalshiScanConfig };

/* ── one market, read live ───────────────────────────────────────────────────── */

/** A refusal the route can answer with, or the priced row. */
export type LiveLookup = { ok: true; row: BrowseMarket; calibrationGeneratedAt: string | null } | { ok: false; status: 404 | 503; error: string };

/**
 * @description Read ONE market from Kalshi's public API and price it against the shipped calibration table — the
 * Look up box and the quant's kalshi_market tool for a ticker the last scan did not walk. One GET, one series read;
 * never a feed walk (that belongs to the scheduled tick).
 * @param ticker - The Kalshi market ticker, already validated by the route.
 * @param appPackageDir - This package's directory, where its calibration table is read.
 * @returns The browse row, or a typed refusal.
 */
export async function lookupMarketLive(ticker: string, appPackageDir?: string): Promise<LiveLookup> {
  const reader = { kalshiGet, normalizeMarket, getSeriesMeta, evaluateMarket } as Record<string, unknown>;
  const missing = Object.entries(reader).filter(([, fn]) => typeof fn !== 'function').map(([name]) => name);
  if (missing.length) {
    return { ok: false, status: 503, error: `${ticker} is not in the last scan, and this installation has no Kalshi market reader to look it up live (${missing.join(', ')})` };
  }
  const { table } = loadCalibration(appPackageDir);
  if (!table) return { ok: false, status: 503, error: calibrationMissing(appPackageDir) };
  let raw: { market?: unknown };
  try { raw = await kalshiGet(`/markets/${encodeURIComponent(ticker)}`); }
  catch (err) {
    if (/\b404\b/.test((err as Error).message || '')) return { ok: false, status: 404, error: `Kalshi has no market ${ticker}` };
    throw err;
  }
  if (!raw || typeof raw !== 'object' || !raw.market) return { ok: false, status: 404, error: `Kalshi has no market ${ticker}` };
  const m = normalizeMarket(raw.market as Record<string, unknown>);
  const series = await getSeriesMeta(m.seriesTicker).catch(() => null);
  return { ok: true, row: browseMarket(m, series, table, evaluateMarket, Date.now()), calibrationGeneratedAt: table.generatedAt };
}
