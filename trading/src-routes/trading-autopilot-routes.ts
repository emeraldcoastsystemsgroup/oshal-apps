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
 *
 * @module trading-autopilot-routes
 */

import { Router, type Request, type Response } from 'express';
import { createChildLogger } from '@/shared/logger';
import { getTrustedServiceUserSub } from '@/shared/middleware/authz';
import { DEFAULT_UNIVERSE } from '@/features/trading';
import type { ScheduleRecord } from '@/features/scheduling';
import {
  getTradingScheduleService, autopilotTaskType, AUTOPILOT_CRON_DEFAULT,
} from '@/app/trading-schedule-dispatch';
import { researchTaskType, fastTaskType } from '@/app/trading-research-dispatch';
import { assessTaskType } from '@/app/trading-assess-dispatch';
import { reviewTaskType } from '@/app/trading-review-dispatch';
import { optimizeTaskType, OPTIMIZE_CRON } from '@/app/trading-optimize-dispatch';
import { labTaskType, LAB_CRON } from '@/app/trading-lab-dispatch';

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
  return mine.filter((s) => /^trading-(autopilot|research|fast|assess|review|optimize|lab)/.test(s.taskType) && s.ownerSub === sub);
}
/** The caller's autopilot schedule, if any. */
async function findAutopilot(sub: string): Promise<ScheduleRecord | null> {
  return (await findTradingSchedules(sub)).find((s) => s.taskType.startsWith('trading-autopilot')) ?? null;
}

/** Shape the status payload for one schedule (or the disabled default). */
function statusOf(schedule: ScheduleRecord | null): Record<string, unknown> {
  if (!schedule) return { enabled: false, cron: AUTOPILOT_CRON_DEFAULT, defaultUniverseCount: DEFAULT_UNIVERSE.length };
  const td = schedule.taskData as Record<string, unknown>;
  const universe = Array.isArray(td.universe) ? (td.universe as unknown[]) : DEFAULT_UNIVERSE;
  return {
    enabled: schedule.status === 'active',
    cron: schedule.cron,
    mode: String(td.mode || 'paper'),
    universeCount: universe.length,
    nextRunAt: schedule.nextRunAt,
    lastRunAt: schedule.lastRunAt,
    executionCount: schedule.executionCount,
  };
}

/**
 * @description Build the autopilot control router (mount at /api/trading/autopilot behind requiresAuth).
 * @returns Express router.
 */
export function createTradingAutopilotRoutes(): Router {
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
    const universe = Array.isArray(b.universe) && b.universe.length
      ? [...new Set(b.universe.map((s) => String(s).toUpperCase()))].slice(0, 150)
      : DEFAULT_UNIVERSE;
    const taskData = { userSub: sub, mode: 'paper', universe };
    try {
      const schedule = await svc.createSchedule({
        taskType: autopilotTaskType(sub), schedule: cron, ownerSub: sub, queue: 'intelligent-trades',
        taskData: { prompt: `Multi-timeframe paper autopilot (${universe.length} symbols)`, ...taskData },
      });
      await svc.createSchedule({
        taskType: researchTaskType(sub), schedule: RESEARCH_CRON, ownerSub: sub, queue: 'intelligent-trades',
        taskData: { prompt: 'News + fundamentals research brain (paper)', ...taskData },
      });
      await svc.createSchedule({
        taskType: fastTaskType(sub), schedule: FAST_CRON, ownerSub: sub, queue: 'intelligent-trades',
        taskData: { prompt: 'Fast breaking-news brain (paper)', ...taskData },
      });
      await svc.createSchedule({
        taskType: assessTaskType(sub), schedule: ASSESS_CRON, ownerSub: sub, queue: 'intelligent-trades',
        taskData: { prompt: 'Next-session assessment / predictions (paper)', ...taskData },
      });
      await svc.createSchedule({
        taskType: reviewTaskType(sub), schedule: REVIEW_CRON, ownerSub: sub, queue: 'intelligent-trades',
        taskData: { prompt: 'Overnight signal review — learn per-signal mass + proximity', ...taskData },
      });
      await svc.createSchedule({
        taskType: optimizeTaskType(sub), schedule: OPTIMIZE_CRON, ownerSub: sub, queue: 'intelligent-trades',
        taskData: { prompt: 'Nightly parameter optimization — backtest tweaks, recommend (approval-gated)', ...taskData },
      });
      await svc.createSchedule({
        taskType: labTaskType(sub), schedule: LAB_CRON, ownerSub: sub, queue: 'intelligent-trades',
        taskData: { prompt: 'Strategy Lab — forward walks + pinned-window regressions (ADR-092)', ...taskData },
      });
      logger.info({ sub, cron, universeCount: universe.length }, 'advisor enabled (technical + research + fast + assess + review + optimize + lab)');
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

  return router;
}
