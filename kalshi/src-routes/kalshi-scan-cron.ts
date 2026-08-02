/**
 * Kalshi background scan CRON — the always-on loop, and the alert that tells Jarvis.
 *
 * The operator's ask, verbatim: "it shoul alayses be running on new ops every x ms based on
 * confugraton .. our confguration is like every hour and jarvix should be nitivided ... of course
 * only if you have the aplication".
 *
 * So: while the kalshi app is ACTIVE, this poller keeps a fresh snapshot warm and announces NEW
 * playable hands. Three deliberate choices:
 *
 *  1. **A one-minute tick, not a one-hour interval.** The tick asks "is the stored snapshot older
 *     than the configured cadence?" So a settings change takes effect within a minute (no restart),
 *     an api recreate mid-cycle recovers on the next tick instead of silently skipping the hour,
 *     and two api processes can never double-scan the same window — the shared snapshot in
 *     Postgres, not a per-process timer, is the clock.
 *  2. **Only if you have the application.** These routes (and therefore this poller) exist only
 *     while the app is installed + active. Alerts narrow it further: only subs with a Kalshi
 *     connection or saved settings (alertAudience).
 *  3. **In-app by default, outward only on opt-in.** notifyJarvis writes to the user's Jarvis feed
 *     (a jarvis_tasks row: Jarvis announces it once, and buildOpenWorkBlock means he can then be
 *     ASKED about it). notifyOutward — email/SMS/Telegram through the preference center — is
 *     default OFF, per the operator's automation opt-in directive: an hourly job may not start
 *     texting someone because they once connected an API key.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-30 03:50:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial — the snapshot-clocked poller (single-flighted scanNow, boot catch-up, cadence from the manifest/settings config), the per-user alert fan-out (first-seen dedup, strength/edge floor, rolling daily budget), the Jarvis feed notification, and the opt-in outward channel via the preference center.
 *
 * @module kalshi-scan-cron
 */
import * as crypto from 'crypto';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { saveTaskPending, finishTask } from '@/app/routes/jarvis-task-store';
import { buildNotificationRouter } from '@/app/routes/notify-routes';
import {
  alertAudience, alertedTickers, alertsSentToday, appIsActive, pruneAlertLedger, readSnapshot,
  recordAlert, resolveConfig, runScan, withScanLease, writeSnapshot, type ScanPayload,
} from './kalshi-scan-engine';
import { formatAlert, scanFreshness, selectAlertHands, type ScanHandLike } from './kalshi-scan-config';

const log = createChildLogger({ module: 'kalshi-scan-cron' });

/** The topic the preference center routes these alerts under (users configure it on /api/notify/prefs). */
export const ALERT_TOPIC = 'kalshi-edge';

/** Poller tick. The CADENCE is config; this is just how often we ask "is the snapshot stale?". */
const TICK_MS = 60_000;

/** Delay before the boot catch-up, so activation/deploy churn settles before a 20s+ feed walk. */
const BOOT_DELAY_MS = 30_000;

/** Backoff after a failed cycle: 2^n minutes, capped. Without it a dead upstream (or a missing
 *  calibration table) meant a fresh 60-page attempt EVERY MINUTE, forever (self-review 2026-07-30). */
const BACKOFF_BASE_MS = 60_000;
const BACKOFF_MAX_MS = 30 * 60_000;

/** Minimum gap between MANUAL scans. `POST /scan/run` is available to any signed-in user and each
 *  call is a 60-page walk on a shared ~3 rps public tier: unthrottled, one person clicking in a
 *  loop could keep the scanner permanently busy and earn the deployment a 429. */
const MANUAL_MIN_GAP_MS = 120_000;

interface ScanRuntime {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  lastMs: number | null;
  lastError: string | null;
  lastSource: 'poller' | 'manual' | 'boot' | null;
  lastAlerted: number;
  cyclesRun: number;
  /** Consecutive failed cycles — drives the backoff. */
  failures: number;
  /** Epoch ms before which the poller will not try again. */
  nextAttemptAfter: number;
  /** Last manual run (epoch ms) — the manual throttle. */
  lastManualAt: number;
  /** Set when the app has been toggled off: the tick stays quiet until it is active again. */
  paused: boolean;
}

const runtime: ScanRuntime = {
  running: false, startedAt: null, finishedAt: null, lastMs: null, lastError: null,
  lastSource: null, lastAlerted: 0, cyclesRun: 0, failures: 0, nextAttemptAfter: 0,
  lastManualAt: 0, paused: false,
};

let inFlight: Promise<ScanPayload> | null = null;

/** The started flag lives on globalThis, not module scope: the manifest route mounter busts the
 *  require cache for the entry module on every package reload, and if it ever purges dependencies
 *  too, a module-local flag would let a SECOND poller start alongside the first. */
const STARTED_KEY = '__oshalKalshiScanCronStarted';

/** @description What the surface/status route reports about the background scan. */
export function scanRuntimeStatus(): Readonly<ScanRuntime> {
  return { ...runtime };
}

/** @description True while a scan is in flight (the surface disables "Scan now" and says so). */
export function scanInFlight(): boolean {
  return runtime.running;
}

/**
 * @description The manual-run throttle. `POST /scan/run` asks here first so a click storm cannot
 * pin the scanner or burn the deployment's share of Kalshi's public rate limit.
 * @param nowMs - Current epoch ms (injected for testability).
 * @returns allowed, plus the seconds to wait when it is not.
 */
export function manualRunAllowed(nowMs: number = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
  const waited = nowMs - runtime.lastManualAt;
  if (runtime.lastManualAt && waited < MANUAL_MIN_GAP_MS) {
    return { allowed: false, retryAfterSeconds: Math.ceil((MANUAL_MIN_GAP_MS - waited) / 1000) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * @description Run one scan cycle and publish it: scan → store the snapshot → alert the audience.
 * Single-flighted process-wide, so the poller tick, the boot catch-up and a manual "Scan now" can
 * never stack three 23-second feed walks on the public-tier rate limit; concurrent callers await
 * the same promise.
 * @param ctx - App context (pool, appPackageDir).
 * @param source - Who asked, for the log + status line.
 * @returns The published snapshot payload.
 */
export function scanNow(ctx: AppContext, source: 'poller' | 'manual' | 'boot'): Promise<ScanPayload> {
  if (inFlight) return inFlight;
  runtime.running = true;
  runtime.startedAt = new Date().toISOString();
  runtime.lastSource = source;
  if (source === 'manual') runtime.lastManualAt = Date.now();
  const startedMs = Date.now();
  inFlight = (async () => {
    // Deployment-wide lease: another api process/instance already scanning means we serve its
    // result rather than walking the same 60 pages again. Lease unavailable is NOT a failure.
    const leased = await withScanLease(ctx.pool, async () => {
      const cfg = await resolveConfig(ctx);
      const payload = await runScan(ctx.pool, cfg);
      await writeSnapshot(ctx.pool, payload);
      runtime.cyclesRun += 1;
      // Alerts must never fail the cycle — the snapshot is already published and correct.
      runtime.lastAlerted = await alertAudienceForPayload(ctx, payload)
        .catch((err) => { log.error({ err }, 'kalshi alert fan-out failed'); return 0; });
      void pruneAlertLedger(ctx.pool);
      return payload;
    });
    if (leased) return leased;
    const snap = await readSnapshot(ctx.pool);
    if (snap) return snap.payload;
    throw new Error('another process holds the scan lease and no snapshot exists yet');
  })()
    .then((payload) => { runtime.lastError = null; runtime.failures = 0; runtime.nextAttemptAfter = 0; return payload; })
    .catch((err: Error) => {
      runtime.lastError = err.message;
      runtime.failures += 1;
      const backoff = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (runtime.failures - 1));
      runtime.nextAttemptAfter = Date.now() + backoff;
      log.error({ err, source, failures: runtime.failures, backoffMs: backoff },
        'kalshi background scan failed — backing off');
      throw err;
    })
    .finally(() => {
      runtime.running = false;
      runtime.finishedAt = new Date().toISOString();
      runtime.lastMs = Date.now() - startedMs;
      inFlight = null;
    });
  return inFlight;
}

/**
 * @description Alert every entitled user about the hands that are NEW to them. Per user: resolve
 * their config, apply the gate (strength floor, net-edge floor, first-seen dedup, daily budget),
 * then deliver in-app and — only on opt-in — outward. Each alerted hand is ledgered whether or not
 * a transport delivered, because the ledger is also the dedup key: an undelivered alert that stays
 * un-ledgered would re-fire every hour forever.
 * @param ctx - App context.
 * @param payload - The freshly published snapshot.
 * @returns How many users were alerted.
 */
async function alertAudienceForPayload(ctx: AppContext, payload: ScanPayload): Promise<number> {
  const audience = await alertAudience(ctx.pool);
  if (!audience.length) {
    log.info({ hands: payload.hands.length }, 'kalshi scan published — no alert audience (nobody has connected Kalshi)');
    return 0;
  }
  let alerted = 0;
  for (const userSub of audience) {
    try {
      if (await alertUser(ctx, userSub, payload)) alerted += 1;
    } catch (err) {
      log.error({ err, userSub }, 'kalshi per-user alert failed');
    }
  }
  return alerted;
}

/** One user's alert decision + delivery. Returns true when something was announced. */
async function alertUser(ctx: AppContext, userSub: string, payload: ScanPayload): Promise<boolean> {
  const cfg = await resolveConfig(ctx, userSub);
  // Both reads answer null when the DB could not tell us; the gate then suppresses (fail closed).
  const decision = selectAlertHands(
    payload.hands as unknown as ScanHandLike[], cfg,
    await alertedTickers(ctx.pool, userSub), await alertsSentToday(ctx.pool, userSub),
  );
  if (!decision.hands.length) {
    log.info({ userSub, suppressed: decision.suppressed, hands: payload.hands.length }, 'kalshi: no alert for user');
    return false;
  }
  const batchId = crypto.randomUUID();
  const msg = formatAlert(decision.hands, {
    generatedAt: payload.generatedAt, evaluable: payload.evaluable, mayStake: payload.mayStake,
  });
  const channels: string[] = [];
  if (cfg.notifyJarvis && await notifyJarvis(ctx, userSub, msg.subject, msg.body)) channels.push('jarvis');
  if (cfg.notifyOutward) {
    const outcome = await buildNotificationRouter(ctx).notify(userSub, ALERT_TOPIC, msg);
    if (outcome.delivered) channels.push(outcome.channel);
    else log.info({ userSub, reason: outcome.reason, channel: outcome.channel }, 'kalshi outward alert skipped');
  }
  const channel = channels.join('+') || 'none';
  for (const h of decision.hands) {
    await recordAlert(ctx.pool, userSub, h, channel, channels.length > 0, batchId, {
      side: h.side, title: h.title, price: h.price, trueProb: h.trueProb, stakeFraction: h.stakeFraction,
      riskFlags: h.riskFlags, closeTime: h.closeTime, scanAt: payload.generatedAt,
    });
  }
  log.info({ userSub, hands: decision.hands.length, channel, batchId }, 'kalshi alert delivered');
  return true;
}

/**
 * @description Put the alert in the user's Jarvis feed. A finished jarvis_tasks row is exactly how
 * background work reaches Jarvis: the surface announces an undelivered result once, and the same
 * row feeds the OPEN WORK block on every later turn — so "what did the Kalshi scan find?" is
 * answerable from what actually happened instead of a fresh 23-second scan.
 * @param ctx - App context.
 * @param userSub - Recipient.
 * @param title - Task title (the announcement headline).
 * @param body - The alert text Jarvis reads back.
 * @returns true when the row landed.
 */
async function notifyJarvis(ctx: AppContext, userSub: string, title: string, body: string): Promise<boolean> {
  const id = `kalshi-scan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await saveTaskPending(ctx.pool, id, userSub, 'kalshi-alerts', title, 'simple');
    await finishTask(ctx.pool, id, true, body);
    return true;
  } catch (err) {
    log.error({ err, userSub }, 'kalshi: jarvis feed notification failed');
    return false;
  }
}

/**
 * @description One poller tick: scan when the stored snapshot is older than the configured cadence
 * (or missing). Cheap when it is not due — two small settings reads and one snapshot read.
 * @param ctx - App context.
 * @param source - 'boot' for the catch-up tick, else 'poller'.
 */
async function tick(ctx: AppContext, source: 'poller' | 'boot' = 'poller'): Promise<void> {
  if (runtime.running) return;
  // TOGGLED-OFF APPS MUST GO QUIET. The routes unmount on deactivate but this timer does not, so
  // without this check a switched-off app kept scanning and alerting (ADR-085 P0's runaway).
  const active = await appIsActive(ctx.pool);
  if (!active) {
    if (!runtime.paused) log.info('kalshi app is not active — background scan paused (it resumes if reactivated)');
    runtime.paused = true;
    return;
  }
  if (runtime.paused) { log.info('kalshi app active again — background scan resumed'); runtime.paused = false; }
  const cfg = await resolveConfig(ctx);
  if (!cfg.scanEnabled) return;
  if (runtime.nextAttemptAfter && Date.now() < runtime.nextAttemptAfter) return; // failure backoff
  const snap = await readSnapshot(ctx.pool);
  const fresh = scanFreshness(snap?.generatedAt ?? null, cfg, Date.now());
  const dueSeconds = cfg.scanIntervalMinutes * 60;
  if (fresh.ageSeconds !== null && fresh.ageSeconds < dueSeconds) return;
  log.info({
    source, ageSeconds: fresh.ageSeconds, intervalMinutes: cfg.scanIntervalMinutes, failures: runtime.failures,
  }, 'kalshi background scan due');
  await scanNow(ctx, source).catch(() => { /* logged + backed off in scanNow; the next tick retries */ });
}

/**
 * @description Start the always-on scan loop. Idempotent per process (a package reload re-invokes
 * the route factory; a second timer would double the load on Kalshi's public tier). The timer is
 * unref'd so it can never hold the process open, and the boot catch-up is delayed so a deploy's
 * activation churn settles first.
 * @param ctx - App context (pool + appPackageDir for the manifest defaults).
 */
export function startKalshiScanCron(ctx: AppContext): void {
  const g = globalThis as Record<string, unknown>;
  if (g[STARTED_KEY]) return;
  g[STARTED_KEY] = true;
  void (async () => {
    const cfg = await resolveConfig(ctx).catch(() => null);
    if (!cfg?.scanEnabled) {
      log.info('kalshi background scan disabled by config (scanEnabled=false) — the surface still serves the last snapshot');
      return;
    }
    log.info({
      intervalMinutes: cfg.scanIntervalMinutes, onActivate: cfg.scanOnActivate,
      maxPaged: cfg.scanMaxMarketsPaged, staleAfterMinutes: cfg.staleAfterMinutes,
    }, 'kalshi background scan started');
    if (cfg.scanOnActivate) {
      setTimeout(() => { void tick(ctx, 'boot'); }, BOOT_DELAY_MS).unref?.();
    }
    const timer = setInterval(() => {
      void tick(ctx).catch((err) => log.error({ err }, 'kalshi scan tick failed'));
    }, TICK_MS);
    timer.unref?.();
  })();
}
