/**
 * Trading autopilot control routes — start / stop / status for the every-5-minutes paper bot.
 *
 * The autopilot itself is the deterministic multi-timeframe loop in trading-schedule-dispatch.ts,
 * driven by a per-user `trading-autopilot:<sub>` schedule on the shared scheduler. These routes are
 * the operator's switch over that schedule:
 *   POST   /api/trading/autopilot  → enable/replace (cron + universe + book) — upserts the schedule
 *   GET    /api/trading/autopilot  → status (enabled, cron, next/last run, count, universe size)
 *   DELETE /api/trading/autopilot  → stop (delete the schedule)
 *
 * Paper-only by contract (the dispatch refuses live), so no live-confirm surface here. Every route
 * is requiresAuth-gated at mount (auth is opt-in per route, CLAUDE.md) and scoped to the caller's
 * own sub — a user can only see/drive their own autopilot.
 *
 * Mounted at /api/trading/autopilot in server.ts BEFORE /api/trading so the specific path wins.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-06-22 12:55:00 | roger.murphy@emeraldcoastsystemsgroup.com | Initial — enable/status/stop over the per-user trading-autopilot schedule; caller-scoped; paper-only; default ~100-name universe.
 * 2026-07-13 00:45:00 | roger.murphy@emeraldcoastsystemsgroup.com | Seventh leg: trading-lab (ADR-092 Strategy Lab nightly forward walks + regressions) created/listed/stopped with the other advisor legs.
 * 2026-07-19 23:30:00 | roger.murphy@emeraldcoastsystemsgroup.com | Carved out of OSHAL core into the trading app package (ADR-085 Wave 3). Relative kernel imports flip to @/ aliases — the schedule/research/assess/review/optimize/lab dispatch loops themselves STAY kernel (they are the autopilot; these routes are only the operator's switch over their schedules). Route bodies byte-identical; the factory stays zero-arg (the mounter's ctx argument is ignored) — zero behavior change.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | The advisor tracks the ENGINE's universe instead of freezing a copy of it. Arming used to write DEFAULT_UNIVERSE into every leg's taskData, so a swarm armed months ago kept scanning the list as it stood that day, while dispatch/research/assess already fall through to DEFAULT_UNIVERSE when no pin is present; taskData now carries `universe` ONLY when the operator pinned one, and GET reports universeSource (default|pinned) + defaultUniverseCount so the difference is visible rather than inferred. The literal 150-symbol truncation is gone: the ceiling is TRADING_UNIVERSE_MAX_PIN (default = the engine's own universe size) and an over-long list answers 400 instead of silently dropping a tail the operator was never told about. The six fixed-cadence createSchedule calls move into createAdvisorLegs so the POST handler stays inside the 50-line rule.
 *
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Add owner-bound interactive Futures review; proposals remain research-only.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Require the dedicated workflow before saving a nightly Futures review opt-in.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Expose exact-owner forward receipt summaries and frozen input evidence without an order or backdating endpoint.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | Mount separately operator-gated archive preview and explicit import routes.
 * 9 | maintainer@emeraldcoastsystemsgroup.com | Mount a read-only Schwab Futures bar capability check ahead of the generic research routes.
 * 10 | maintainer@emeraldcoastsystemsgroup.com | Mount owner-private Schwab Futures capture controls without crossing the trading order rail.
 * @module trading-autopilot-routes
 */

import { Router, type Request, type Response } from 'express';
import type { AppContext } from '@/app/composition-root';
import { createChildLogger } from '@/shared/logger';
import { getTrustedServiceUserSub, isOperatorIdentity } from '@/shared/middleware/authz';
import { DEFAULT_UNIVERSE } from '@/features/trading';
import { assertFuturesReviewWorkflow } from '@/app/trading-futures-research-queue';
import type { ScheduleRecord, ScheduleService } from '@/features/scheduling';
import {
  getTradingScheduleService, autopilotTaskType, AUTOPILOT_CRON_DEFAULT,
} from '@/app/trading-schedule-dispatch';
import { researchTaskType, fastTaskType } from '@/app/trading-research-dispatch';
import { assessTaskType } from '@/app/trading-assess-dispatch';
import { reviewTaskType } from '@/app/trading-review-dispatch';
import { optimizeTaskType, OPTIMIZE_CRON } from '@/app/trading-optimize-dispatch';
import { labTaskType, LAB_CRON } from '@/app/trading-lab-dispatch';
import { futuresResearchTaskType, FUTURES_RESEARCH_CRON_DEFAULT, normalizeFuturesResearchConfig, listFuturesResearchRuns } from '@/app/trading-futures-research-dispatch';
import { reviewFuturesResearchRun } from '@/app/trading-futures-research-review';
import { listFuturesPredictions, readFuturesPredictionSnapshot } from '@/app/trading-futures-prediction-ledger';
import { createFuturesArchiveRoutes } from './trading-futures-archive-routes';
import { createFuturesSchwabProbeRoutes } from './trading-futures-schwab-probe-routes';
import { createFuturesSchwabCaptureRoutes } from './trading-futures-schwab-capture-routes';

/** The advisor legs and their cadences. */
const RESEARCH_CRON = '*/15 * * * *';
const FAST_CRON = '*/2 * * * *';
const ASSESS_CRON = '0 */2 * * *';
const REVIEW_CRON = '30 6 * * *';

const logger = createChildLogger({ module: 'trading-autopilot-routes' });

/** Signed-in caller's OIDC sub, or the trusted sub from an internal service-secret call
 *  (X-Service-Secret + X-OSHAL-User-Sub) so the trading_* operator tools / Jarvis can drive
 *  the autopilot on the user's behalf. Same precedence as eats/rides/spotify/purchasing. */
function callerSub(req: Request): string | null {
  const trusted = getTrustedServiceUserSub(req);
  if (trusted) return trusted;
  const u = (req as { oidc?: { user?: { sub?: string; oid?: string } } }).oidc?.user;
  const sub = u?.sub || u?.oid;
  return sub ? String(sub) : null;
}

/** All of the caller's trading schedules (autopilot + research + fast). */
async function findTradingSchedules(sub: string): Promise<ScheduleRecord[]> {
  const svc = getTradingScheduleService();
  if (!svc) return [];
  const mine = await svc.listSchedules({ ownerSub: sub, scope: 'mine' });
  return mine.filter((s) => /^trading-(autopilot|research|fast|assess|review|optimize|lab)(?=:)/.test(s.taskType) && s.ownerSub === sub);
}
/** Futures is separate from the stock advisor: stopping that advisor must never delete this loop. */
async function findFuturesResearch(sub: string): Promise<ScheduleRecord | null> {
  const svc = getTradingScheduleService();
  if (!svc) return null;
  const mine = await svc.listSchedules({ ownerSub: sub, scope: 'mine' });
  return mine.find((s) => s.taskType === futuresResearchTaskType(sub) && s.ownerSub === sub) ?? null;
}
/** The caller's autopilot schedule, if any. */
async function findAutopilot(sub: string): Promise<ScheduleRecord | null> {
  return (await findTradingSchedules(sub)).find((s) => s.taskType.startsWith('trading-autopilot')) ?? null;
}

/** How many symbols the operator may PIN into the schedule at once. Env: TRADING_UNIVERSE_MAX_PIN;
 *  the default is the engine's OWN universe size, so the ceiling tracks the engine, not a literal. */
function universePinMax(): number {
  const n = Number(process.env.TRADING_UNIVERSE_MAX_PIN);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_UNIVERSE.length;
}

/**
 * @description Normalize a caller-supplied universe into the list to PIN, or null when the caller
 *   pinned nothing (the legs then track the engine's DEFAULT_UNIVERSE on every fire). Deduplicated
 *   and upper-cased. A list over the ceiling is an ERROR, never a silent truncation: the old
 *   `.slice(0, 150)` dropped the tail of a longer list and told the operator nothing about it.
 * @param raw - The request body's `universe` field, whatever the caller sent.
 * @returns The symbols to pin, or null to track the engine's default.
 * @throws Error with `code = 'universe_too_large'` when the list exceeds universePinMax().
 */
function pinnedUniverse(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || !raw.length) return null;
  const list = [...new Set(raw.map((v) => String(v).trim().toUpperCase()).filter(Boolean))];
  if (!list.length) return null;
  const max = universePinMax();
  if (list.length > max) {
    const err = new Error(`universe carries ${list.length} symbols; the pin ceiling is ${max} (TRADING_UNIVERSE_MAX_PIN)`) as Error & { code?: string };
    err.code = 'universe_too_large';
    throw err;
  }
  return list;
}

/**
 * @description Create the six advisor legs that ride fixed cadences. The technical leg keeps the
 *   caller's own cron and is created separately, because its record is the one the status reports.
 * @param svc - The schedule service.
 * @param sub - Owner sub; every leg is scoped to it.
 * @param taskData - The shared leg payload (userSub + mode, and `universe` ONLY when pinned).
 * @returns Nothing - each leg is upserted by its own task type.
 */
async function createAdvisorLegs(svc: ScheduleService, sub: string, taskData: Record<string, unknown>): Promise<void> {
  const legs: Array<[string, string, string]> = [
    [researchTaskType(sub), RESEARCH_CRON, 'News + fundamentals research brain (paper)'],
    [fastTaskType(sub), FAST_CRON, 'Fast breaking-news brain (paper)'],
    [assessTaskType(sub), ASSESS_CRON, 'Next-session assessment / predictions (paper)'],
    [reviewTaskType(sub), REVIEW_CRON, 'Overnight signal review - learn per-signal mass + proximity'],
    [optimizeTaskType(sub), OPTIMIZE_CRON, 'Nightly parameter optimization - backtest tweaks, recommend (approval-gated)'],
    [labTaskType(sub), LAB_CRON, 'Strategy Lab - forward walks + pinned-window regressions (ADR-092)'],
  ];
  for (const [taskType, schedule, prompt] of legs) {
    await svc.createSchedule({ taskType, schedule, ownerSub: sub, queue: 'intelligent-trades', taskData: { prompt, ...taskData } });
  }
}

/** Shape the status payload for one schedule (or the disabled default). */
function statusOf(schedule: ScheduleRecord | null): Record<string, unknown> {
  if (!schedule) return { enabled: false, cron: AUTOPILOT_CRON_DEFAULT, universeSource: 'default', defaultUniverseCount: DEFAULT_UNIVERSE.length };
  const td = schedule.taskData as Record<string, unknown>;
  // A leg with no `universe` in its taskData is not universe-less: dispatch, research and assess
  // each fall through to DEFAULT_UNIVERSE, so it scans the engine's CURRENT list on every fire.
  const pin = Array.isArray(td.universe) && (td.universe as unknown[]).length ? (td.universe as unknown[]) : null;
  return {
    enabled: schedule.status === 'active',
    cron: schedule.cron,
    mode: String(td.mode || 'paper'),
    universeSource: pin ? 'pinned' : 'default',
    universeCount: pin ? pin.length : DEFAULT_UNIVERSE.length,
    defaultUniverseCount: DEFAULT_UNIVERSE.length,
    nextRunAt: schedule.nextRunAt,
    lastRunAt: schedule.lastRunAt,
    executionCount: schedule.executionCount,
  };
}

/**
 * @description Build the autopilot control router (mount at /api/trading/autopilot behind requiresAuth).
 * @returns Express router.
 */
export function createTradingAutopilotRoutes(ctx?: AppContext): Router {
  const router = Router();

  /** GET /api/trading/autopilot — advisor status (all three legs) for the caller. */
  router.get('/', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    try {
      const legs = await findTradingSchedules(sub);
      const leg = (prefix: string) => legs.find((s) => s.taskType.startsWith(prefix)) ?? null;
      res.json({
        ok: true,
        ...statusOf(leg('trading-autopilot')),
        legs: {
          technical: !!leg('trading-autopilot'),
          research: !!leg('trading-research'),
          fast: !!leg('trading-fast'),
          assess: !!leg('trading-assess'),
          review: !!leg('trading-review'),
          optimize: !!leg('trading-optimize'),
          lab: !!leg('trading-lab'),
        },
      });
    } catch (err) {
      logger.error({ err }, 'autopilot status failed');
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /** POST /api/trading/autopilot — enable/replace the whole advisor (technical + research + fast).
   *  Body: { cron?, universe?: string[] }. Paper-only. */
  router.post('/', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    const svc = getTradingScheduleService();
    if (!svc) { res.status(503).json({ error: 'scheduler_unavailable', message: 'The agent scheduler is not running (ENABLE_AGENT_SCHEDULER).' }); return; }
    const b = (req.body || {}) as { cron?: string; universe?: string[] };
    const cron = (typeof b.cron === 'string' && b.cron.trim()) ? b.cron.trim() : AUTOPILOT_CRON_DEFAULT;
    let pinned: string[] | null;
    try { pinned = pinnedUniverse(b.universe); }
    catch (err) {
      logger.error({ err, sub }, 'advisor enable refused - universe over the pin ceiling');
      res.status(400).json({ error: 'universe_too_large', message: (err as Error).message, max: universePinMax() });
      return;
    }
    // No pin => no `universe` key at all. Dispatch/research/assess fall through to DEFAULT_UNIVERSE
    // when it is absent, so an advisor armed today keeps scanning the engine's list as it GROWS
    // instead of freezing a copy of it into the schedule row the way arming used to.
    const taskData: Record<string, unknown> = pinned
      ? { userSub: sub, mode: 'paper', universe: pinned }
      : { userSub: sub, mode: 'paper' };
    const label = pinned ? `${pinned.length} pinned symbols` : `default universe, ${DEFAULT_UNIVERSE.length} today`;
    try {
      const schedule = await svc.createSchedule({
        taskType: autopilotTaskType(sub), schedule: cron, ownerSub: sub, queue: 'intelligent-trades',
        taskData: { prompt: `Multi-timeframe paper autopilot (${label})`, ...taskData },
      });
      await createAdvisorLegs(svc, sub, taskData);
      logger.info({ sub, cron, universeSource: pinned ? 'pinned' : 'default', universeCount: pinned ? pinned.length : DEFAULT_UNIVERSE.length }, 'advisor enabled (technical + research + fast + assess + review + optimize + lab)');
      res.json({
        ok: true, ...statusOf(schedule),
        legs: { technical: cron, research: RESEARCH_CRON, fast: FAST_CRON, assess: ASSESS_CRON, review: REVIEW_CRON, optimize: OPTIMIZE_CRON, lab: LAB_CRON },
        note: 'Paper-only. Trade legs run only at market open; assessment runs overnight/pre-market (predictions, no orders); optimization runs nightly and only RECOMMENDS (you approve on the Tuning tab).',
      });
    } catch (err) {
      logger.error({ err }, 'advisor enable failed');
      res.status(500).json({ error: (err as Error).message });
    }
  });

  /** DELETE /api/trading/autopilot — stop the whole advisor (all three legs) for the caller. */
  router.delete('/', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    const svc = getTradingScheduleService();
    if (!svc) { res.status(503).json({ error: 'scheduler_unavailable' }); return; }
    try {
      const legs = await findTradingSchedules(sub);
      let deleted = 0;
      for (const s of legs) if (await svc.deleteSchedule(s.id)) deleted += 1;
      logger.info({ sub, deleted }, 'advisor stopped');
      res.json({ ok: true, deleted, enabled: false });
    } catch (err) {
      logger.error({ err }, 'advisor stop failed');
      res.status(500).json({ error: (err as Error).message });
    }
  });

  router.use('/futures/archive', createFuturesArchiveRoutes(ctx));
  router.use('/futures/sources/schwab/probe', createFuturesSchwabProbeRoutes(ctx));
  router.use('/futures/sources/schwab/capture', createFuturesSchwabCaptureRoutes(ctx));

  /** GET /api/trading/autopilot/futures — futures research schedule + durable run ledger. */
  router.get('/futures', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    if (!ctx?.pool) { res.status(503).json({ error: 'futures_research_unavailable' }); return; }
    try {
      const schedule = await findFuturesResearch(sub);
      const td = schedule?.taskData as Record<string, unknown> | undefined;
      res.json({ ok: true, enabled: schedule?.status === 'active', schedule: schedule ? { id: schedule.id, cron: schedule.cron, status: schedule.status, nextRunAt: schedule.nextRunAt, lastRunAt: schedule.lastRunAt, executionCount: schedule.executionCount, config: td?.futures ?? null } : null, runs: await listFuturesResearchRuns(ctx.pool, sub) });
    } catch (err) { logger.error({ err, sub }, 'futures research status failed'); res.status(500).json({ error: (err as Error).message }); }
  });

  /** Interactive review uses only the authenticated caller and the persisted run, never body-supplied evidence. */
  router.post('/futures/runs/:runId/review', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    if (!isOperatorIdentity(sub)) { res.status(403).json({ error: 'operator_only' }); return; }
    if (!ctx?.pool) { res.status(503).json({ error: 'futures_research_unavailable' }); return; }
    try {
      const review = await reviewFuturesResearchRun(ctx, sub, String(req.params.runId));
      res.json({ ok: review.status === 'completed', review });
    } catch (err) {
      logger.error({ err }, 'Futures interactive review refused');
      const code = Number((err as { statusCode?: number }).statusCode);
      res.status([400, 403, 404, 409].includes(code) ? code : 500).json({ error: code ? (err as Error).message : 'futures_review_unavailable' });
    }
  });

  /** Owner-qualified forward receipts are separate from historical performance and order routes. */
  router.get('/futures/predictions', async (req: Request, res: Response) => {
    const sub = req.oidc?.user?.sub;
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    if (!ctx?.pool) { res.status(503).json({ error: 'futures_predictions_unavailable' }); return; }
    try { res.json({ predictions: await listFuturesPredictions(ctx.pool, sub) }); }
    catch (err) { logger.error({ err }, 'Futures prediction list unavailable'); res.status(503).json({ error: 'futures_predictions_unavailable' }); }
  });
  router.get('/futures/predictions/:predictionId', async (req: Request, res: Response) => {
    const sub = req.oidc?.user?.sub;
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    const id = String(req.params.predictionId);
    if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) { res.status(400).json({ error: 'invalid_prediction_id' }); return; }
    if (!ctx?.pool) { res.status(503).json({ error: 'futures_predictions_unavailable' }); return; }
    try {
      const snapshot = await readFuturesPredictionSnapshot(ctx.pool, sub, id);
      if (!snapshot) { res.status(404).json({ error: 'owned_prediction_evidence_not_found' }); return; }
      res.json({ snapshot });
    } catch (err) { logger.error({ err }, 'Futures prediction evidence unavailable'); res.status(503).json({ error: 'futures_predictions_unavailable' }); }
  });

  /** POST /api/trading/autopilot/futures — create/replace the console-owned nightly study. */
  router.post('/futures', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    if (!isOperatorIdentity(sub)) { res.status(403).json({ error: 'operator_only' }); return; }
    const svc = getTradingScheduleService();
    if (!svc) { res.status(503).json({ error: 'scheduler_unavailable' }); return; }
    try {
      const config = normalizeFuturesResearchConfig(req.body || {});
      if (config.nightlyReview) assertFuturesReviewWorkflow();
      const schedule = await svc.createSchedule({ taskType: futuresResearchTaskType(sub), schedule: config.nightlyCron || FUTURES_RESEARCH_CRON_DEFAULT, timezone: 'Etc/UTC', ownerSub: sub, queue: 'intelligent-trades', taskData: { prompt: 'Console-configured Futures permutation study; review required', userSub: sub, mode: 'paper', futures: config } });
      res.status(201).json({ ok: true, enabled: schedule.status === 'active', schedule: { id: schedule.id, cron: schedule.cron, nextRunAt: schedule.nextRunAt, config } });
    } catch (err) { res.status(400).json({ error: (err as Error).message }); }
  });

  /** POST /api/trading/autopilot/futures/run — run the current study once, still paper-only. */
  router.post('/futures/run', async (req: Request, res: Response) => {
    const sub = callerSub(req);
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    if (!isOperatorIdentity(sub)) { res.status(403).json({ error: 'operator_only' }); return; }
    const svc = getTradingScheduleService();
    const schedule = await findFuturesResearch(sub);
    if (!svc || !schedule) { res.status(404).json({ error: 'futures_research_not_configured' }); return; }
    try {
      const result = await svc.triggerSchedule(schedule.id);
      res.status(result.success ? 202 : 409).json({ ok: result.success, result });
    }
    catch (err) { res.status(500).json({ error: (err as Error).message }); }
  });

  /** POST /api/trading/autopilot/futures/pause|resume — explicit console lifecycle controls. */
  for (const [verb, action] of [['pause', 'pauseSchedule'], ['resume', 'resumeSchedule']] as const) {
    router.post(`/futures/${verb}`, async (req: Request, res: Response) => {
      const sub = callerSub(req);
      if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
      if (!isOperatorIdentity(sub)) { res.status(403).json({ error: 'operator_only' }); return; }
      const svc = getTradingScheduleService();
      const schedule = await findFuturesResearch(sub);
      if (!svc || !schedule) { res.status(404).json({ error: 'futures_research_not_configured' }); return; }
      try { res.json({ ok: true, schedule: await svc[action](schedule.id) }); }
      catch (err) { res.status(500).json({ error: (err as Error).message }); }
    });
  }

  router.delete('/futures', async (req: Request, res: Response) => {
    const sub = callerSub(req); if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    if (!isOperatorIdentity(sub)) { res.status(403).json({ error: 'operator_only' }); return; }
    const svc = getTradingScheduleService(); const schedule = await findFuturesResearch(sub);
    if (!svc || !schedule) { res.json({ ok: true, deleted: 0 }); return; }
    res.json({ ok: true, deleted: await svc.deleteSchedule(schedule.id) ? 1 : 0 });
  });

  return router;
}
