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
exports.KALSHI_SCAN_SCHEDULE = exports.ALERT_TOPIC = void 0;
exports.scanRuntimeStatus = scanRuntimeStatus;
exports.scanInFlight = scanInFlight;
exports.manualRunAllowed = manualRunAllowed;
exports.scanNow = scanNow;
exports.scheduledTick = scheduledTick;
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
 *  1. **A frequent scheduled tick, not a one-hour interval.** The manifest's `background-scan`
 *     schedule fires POST /scan/tick every fifteen minutes, inside an admitted request, and the tick
 *     asks "is the stored snapshot older than the configured cadence?" So a settings change takes
 *     effect on the next fire, a restart mid-cycle recovers on the next tick, and the shared
 *     snapshot in Postgres, not a per-process timer, is the clock.
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
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-07-30 03:50:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Initial — the snapshot-clocked poller (single-flighted scanNow, boot catch-up, cadence from the manifest/settings config), the per-user alert fan-out (first-seen dedup, strength/edge floor, rolling daily budget), the Jarvis feed notification, and the opt-in outward channel via the preference center.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Respect the core briefing enqueue decision before finishing or recording Jarvis delivery.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | No timer. The one-minute setInterval (and the boot setTimeout) ran each tick outside any request, so on the native kernel every cycle failed at its first query with "SQL connection requires an active admitted request", which the surface showed as the scan's last error. A tick now runs only inside an admitted request: scheduledTick is the body of POST /scan/tick, which the manifest's `background-scan` schedule fires as the person who activated it, and it reports why it did nothing (inactive, disabled, backing off, not due) instead of returning silently. scanNow refuses before any SQL with the installation's own reason when a scan cannot run here (no Kalshi market-feed reader, no calibration table). Guard: tests/kalshi-scan-schedule.test.js.
 *
 * @module kalshi-scan-cron
 */
const crypto = __importStar(require("crypto"));
const logger_1 = require("@/shared/logger");
const jarvis_task_store_1 = require("@/app/routes/jarvis-task-store");
const notify_routes_1 = require("@/app/routes/notify-routes");
const kalshi_scan_engine_1 = require("./kalshi-scan-engine");
const kalshi_scan_config_1 = require("./kalshi-scan-config");
const log = (0, logger_1.createChildLogger)({ module: 'kalshi-scan-cron' });
/** The topic the preference center routes these alerts under (users configure it on /api/notify/prefs). */
exports.ALERT_TOPIC = 'kalshi-edge';
/** The manifest's schedule (oshal-app.yaml `schedules:` background-scan) whose fires run scheduledTick. */
exports.KALSHI_SCAN_SCHEDULE = Object.freeze({ app: 'kalshi', name: 'background-scan', route: '/api/kalshi/scan/tick' });
/** Backoff after a failed cycle: 2^n minutes, capped. Without it a dead upstream (or a missing
 *  calibration table) meant a fresh 60-page attempt EVERY MINUTE, forever (self-review 2026-07-30). */
const BACKOFF_BASE_MS = 60_000;
const BACKOFF_MAX_MS = 30 * 60_000;
/** Minimum gap between MANUAL scans. `POST /scan/run` is available to any signed-in user and each
 *  call is a 60-page walk on a shared ~3 rps public tier: unthrottled, one person clicking in a
 *  loop could keep the scanner permanently busy and earn the deployment a 429. */
const MANUAL_MIN_GAP_MS = 120_000;
const runtime = {
    running: false, startedAt: null, finishedAt: null, lastMs: null, lastError: null,
    lastSource: null, lastAlerted: 0, cyclesRun: 0, failures: 0, nextAttemptAfter: 0,
    lastManualAt: 0, paused: false,
};
let inFlight = null;
/** @description What the surface/status route reports about the background scan. */
function scanRuntimeStatus() {
    return { ...runtime };
}
/** @description True while a scan is in flight (the surface disables "Scan now" and says so). */
function scanInFlight() {
    return runtime.running;
}
/**
 * @description The manual-run throttle. `POST /scan/run` asks here first so a click storm cannot
 * pin the scanner or burn the deployment's share of Kalshi's public rate limit.
 * @param nowMs - Current epoch ms (injected for testability).
 * @returns allowed, plus the seconds to wait when it is not.
 */
function manualRunAllowed(nowMs = Date.now()) {
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
function scanNow(ctx, source) {
    if (inFlight)
        return inFlight;
    // A scan that cannot run on this installation says why before touching SQL or the feed.
    const unavailable = (0, kalshi_scan_engine_1.scanUnavailableReason)(ctx.appPackageDir);
    if (unavailable) {
        runtime.lastError = unavailable;
        runtime.lastSource = source;
        return Promise.reject(Object.assign(new Error(unavailable), { code: 'kalshi_scan_unavailable' }));
    }
    runtime.running = true;
    runtime.startedAt = new Date().toISOString();
    runtime.lastSource = source;
    if (source === 'manual')
        runtime.lastManualAt = Date.now();
    const startedMs = Date.now();
    inFlight = (async () => {
        // Deployment-wide lease: another api process/instance already scanning means we serve its
        // result rather than walking the same 60 pages again. Lease unavailable is NOT a failure.
        const leased = await (0, kalshi_scan_engine_1.withScanLease)(ctx.pool, async () => {
            const cfg = await (0, kalshi_scan_engine_1.resolveConfig)(ctx);
            const payload = await (0, kalshi_scan_engine_1.runScan)(ctx.pool, cfg, ctx.appPackageDir);
            await (0, kalshi_scan_engine_1.writeSnapshot)(ctx.pool, payload);
            runtime.cyclesRun += 1;
            // Alerts must never fail the cycle — the snapshot is already published and correct.
            runtime.lastAlerted = await alertAudienceForPayload(ctx, payload)
                .catch((err) => { log.error({ err }, 'kalshi alert fan-out failed'); return 0; });
            void (0, kalshi_scan_engine_1.pruneAlertLedger)(ctx.pool);
            return payload;
        });
        if (leased)
            return leased;
        const snap = await (0, kalshi_scan_engine_1.readSnapshot)(ctx.pool);
        if (snap)
            return snap.payload;
        throw new Error('another process holds the scan lease and no snapshot exists yet');
    })()
        .then((payload) => { runtime.lastError = null; runtime.failures = 0; runtime.nextAttemptAfter = 0; return payload; })
        .catch((err) => {
        runtime.lastError = err.message;
        runtime.failures += 1;
        const backoff = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (runtime.failures - 1));
        runtime.nextAttemptAfter = Date.now() + backoff;
        log.error({ err, source, failures: runtime.failures, backoffMs: backoff }, 'kalshi background scan failed — backing off');
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
async function alertAudienceForPayload(ctx, payload) {
    const audience = await (0, kalshi_scan_engine_1.alertAudience)(ctx.pool);
    if (!audience.length) {
        log.info({ hands: payload.hands.length }, 'kalshi scan published — no alert audience (nobody has connected Kalshi)');
        return 0;
    }
    let alerted = 0;
    for (const userSub of audience) {
        try {
            if (await alertUser(ctx, userSub, payload))
                alerted += 1;
        }
        catch (err) {
            log.error({ err, userSub }, 'kalshi per-user alert failed');
        }
    }
    return alerted;
}
/** One user's alert decision + delivery. Returns true when something was announced. */
async function alertUser(ctx, userSub, payload) {
    const cfg = await (0, kalshi_scan_engine_1.resolveConfig)(ctx, userSub);
    // Both reads answer null when the DB could not tell us; the gate then suppresses (fail closed).
    const decision = (0, kalshi_scan_config_1.selectAlertHands)(payload.hands, cfg, await (0, kalshi_scan_engine_1.alertedTickers)(ctx.pool, userSub), await (0, kalshi_scan_engine_1.alertsSentToday)(ctx.pool, userSub));
    if (!decision.hands.length) {
        log.info({ userSub, suppressed: decision.suppressed, hands: payload.hands.length }, 'kalshi: no alert for user');
        return false;
    }
    const batchId = crypto.randomUUID();
    const msg = (0, kalshi_scan_config_1.formatAlert)(decision.hands, {
        generatedAt: payload.generatedAt, evaluable: payload.evaluable, mayStake: payload.mayStake,
    });
    const channels = [];
    if (cfg.notifyJarvis && await notifyJarvis(ctx, userSub, msg.subject, msg.body))
        channels.push('jarvis');
    if (cfg.notifyOutward) {
        const outcome = await (0, notify_routes_1.buildNotificationRouter)(ctx).notify(userSub, exports.ALERT_TOPIC, msg);
        if (outcome.delivered)
            channels.push(outcome.channel);
        else
            log.info({ userSub, reason: outcome.reason, channel: outcome.channel }, 'kalshi outward alert skipped');
    }
    const channel = channels.join('+') || 'none';
    for (const h of decision.hands) {
        await (0, kalshi_scan_engine_1.recordAlert)(ctx.pool, userSub, h, channel, channels.length > 0, batchId, {
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
async function notifyJarvis(ctx, userSub, title, body) {
    const id = `kalshi-scan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try {
        if (!await (0, jarvis_task_store_1.saveTaskPending)(ctx.pool, id, userSub, 'kalshi-alerts', title, 'simple'))
            return false;
        await (0, jarvis_task_store_1.finishTask)(ctx.pool, id, true, body);
        return true;
    }
    catch (err) {
        log.error({ err, userSub }, 'kalshi: jarvis feed notification failed');
        return false;
    }
}
/**
 * @description One scheduled tick, inside the caller's admitted request (POST /scan/tick, fired by the
 * `background-scan` schedule): scan when the stored snapshot is older than the configured cadence (or
 * missing). Cheap when it is not due: two small settings reads and one snapshot read.
 * @param ctx - App context.
 * @returns What it did, or why it did nothing.
 */
async function scheduledTick(ctx) {
    if (runtime.running)
        return { ran: false, reason: 'already_running' };
    const unavailable = (0, kalshi_scan_engine_1.scanUnavailableReason)(ctx.appPackageDir);
    if (unavailable) {
        runtime.lastError = unavailable;
        runtime.lastSource = 'poller';
        return { ran: false, reason: 'unavailable', detail: unavailable };
    }
    // TOGGLED-OFF APPS MUST GO QUIET (ADR-085 P0's runaway).
    if (!await (0, kalshi_scan_engine_1.appIsActive)(ctx.pool)) {
        runtime.paused = true;
        return { ran: false, reason: 'app_inactive' };
    }
    runtime.paused = false;
    const cfg = await (0, kalshi_scan_engine_1.resolveConfig)(ctx);
    if (!cfg.scanEnabled)
        return { ran: false, reason: 'scan_disabled' };
    if (runtime.nextAttemptAfter && Date.now() < runtime.nextAttemptAfter)
        return { ran: false, reason: 'backing_off', detail: runtime.lastError ?? undefined };
    const snap = await (0, kalshi_scan_engine_1.readSnapshot)(ctx.pool);
    const fresh = (0, kalshi_scan_config_1.scanFreshness)(snap?.generatedAt ?? null, cfg, Date.now());
    if (fresh.ageSeconds !== null && fresh.ageSeconds < cfg.scanIntervalMinutes * 60)
        return { ran: false, reason: 'not_due' };
    log.info({ ageSeconds: fresh.ageSeconds, intervalMinutes: cfg.scanIntervalMinutes, failures: runtime.failures }, 'kalshi scheduled scan due');
    const payload = await scanNow(ctx, 'poller');
    return { ran: true, generatedAt: payload.generatedAt, hands: payload.hands.length };
}
//# sourceMappingURL=kalshi-scan-cron.js.map