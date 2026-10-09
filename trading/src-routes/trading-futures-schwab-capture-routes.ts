/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Give the signed-in operator explicit start, run, status and stop controls for private Schwab Futures bars.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Return active-contract session coverage diagnostics without exposing market bars.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Preview and confirm bounded current-contract catch-up without arbitrary symbols or credentials.
 */
import { Router, type Request, type Response } from 'express';
import type { AppContext } from '@/app/composition-root';
import { getValidAccessToken } from '@/app/routes/connectors-routes';
import { getTradingScheduleService } from '@/app/trading-schedule-dispatch';
import { backfillSchwabCurrentFuturesBars, captureSchwabFuturesBars, listSchwabFuturesCoverage, listSchwabFuturesHealth,
  planSchwabCurrentBackfill, schwabFuturesCaptureTaskType,
  SCHWAB_FUTURES_CAPTURE_CRON } from '@/app/trading-futures-schwab-capture';
import { isOperatorIdentity } from '@/shared/middleware/authz';

/** @description Owner-only control rail. It never accepts a token, arbitrary symbol or order request. */
export function createFuturesSchwabCaptureRoutes(ctx?: AppContext): Router {
  const router = Router();
  router.use((req: Request, res: Response, next) => {
    const sub = req.oidc?.user?.sub;
    if (!sub) { res.status(401).json({ error: 'not_authenticated' }); return; }
    if (!isOperatorIdentity(sub)) { res.status(403).json({ error: 'operator_only' }); return; }
    if (!ctx?.pool) { res.status(503).json({ error: 'schwab_capture_unavailable' }); return; }
    next();
  });
  async function ownedSchedules(sub: string) {
    const svc = getTradingScheduleService();
    if (!svc) return [];
    const schedules = await svc.listSchedules({ ownerSub: sub, scope: 'mine' });
    return schedules.filter(item => item.ownerSub === sub && item.taskType === schwabFuturesCaptureTaskType(sub));
  }
  function settings(raw: unknown): { roots: string[]; cron: string } {
    const body = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const roots = body.roots === undefined ? ['ES','CL'] : body.roots;
    if (!Array.isArray(roots) || !roots.length || roots.length > 2 || roots.some(root => root !== 'ES' && root !== 'CL') || new Set(roots).size !== roots.length) throw new RangeError('Select ES, CL or both');
    const cron = body.cadence === 'half-hour' ? '7,37 * * * *' : body.cadence === undefined || body.cadence === 'hourly' ? SCHWAB_FUTURES_CAPTURE_CRON : '';
    if (!cron) throw new RangeError('Choose hourly or half-hour capture');
    return { roots, cron };
  }
  async function capture(sub: string, roots: string[]) {
    const token = await getValidAccessToken(ctx!.pool, sub, 'schwab');
    if (!token) return null;
    return captureSchwabFuturesBars(ctx!.pool, sub, token, roots);
  }
  function backfillSettings(raw: unknown): { roots: string[]; fromDate: string; throughDate: string; confirmation: string } {
    const body = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    if (!Array.isArray(body.roots) || body.roots.some(root => typeof root !== 'string') ||
      typeof body.fromDate !== 'string' || typeof body.throughDate !== 'string') throw new RangeError('Choose roots and UTC dates');
    return { roots: body.roots as string[], fromDate: body.fromDate, throughDate: body.throughDate,
      confirmation: typeof body.confirmation === 'string' ? body.confirmation : '' };
  }
  router.post('/backfill/preview', (req: Request, res: Response) => {
    try {
      const { roots, fromDate, throughDate } = backfillSettings(req.body);
      const plan = planSchwabCurrentBackfill(roots, fromDate, throughDate);
      res.setHeader('Cache-Control', 'no-store'); res.json({ plan });
    } catch { res.status(400).json({ error: 'invalid_backfill_settings' }); }
  });
  router.post('/backfill', async (req: Request, res: Response) => {
    try {
      const { roots, fromDate, throughDate, confirmation } = backfillSettings(req.body);
      const now = Date.now(), plan = planSchwabCurrentBackfill(roots, fromDate, throughDate, now);
      if (confirmation !== plan.fingerprint) { res.status(409).json({ error: 'backfill_preview_changed' }); return; }
      const sub = req.oidc!.user!.sub!, token = await getValidAccessToken(ctx!.pool, sub, 'schwab');
      if (!token) { res.status(409).json({ error: 'schwab_connection_not_available' }); return; }
      const receipt = await backfillSchwabCurrentFuturesBars(ctx!.pool, sub, token, roots, fromDate, throughDate, confirmation, fetch, now);
      res.setHeader('Cache-Control', 'no-store'); res.json({ receipt });
    } catch (error) { res.status(error instanceof RangeError ? 400 : 503).json({ error: error instanceof RangeError ? 'invalid_backfill_settings' : 'schwab_backfill_failed' }); }
  });
  router.get('/', async (req: Request, res: Response) => {
    try {
      const sub = req.oidc!.user!.sub!;
      const [coverage, health, schedules] = await Promise.all([listSchwabFuturesCoverage(ctx!.pool, sub), listSchwabFuturesHealth(ctx!.pool, sub), ownedSchedules(sub)]);
      const schedule = schedules[0];
      res.setHeader('Cache-Control', 'no-store');
      res.json({ coverage, health, enabled: schedule?.status === 'active', schedule: schedule ? {
        cron: schedule.cron, roots: (schedule.taskData as Record<string, unknown>).roots,
        lastRunAt: schedule.lastRunAt, nextRunAt: schedule.nextRunAt, status: schedule.status } : null });
    } catch { res.status(503).json({ error: 'schwab_capture_unavailable' }); }
  });
  router.post('/run', async (req: Request, res: Response) => {
    try {
      const { roots } = settings(req.body);
      const receipt = await capture(req.oidc!.user!.sub!, roots);
      if (!receipt) { res.status(409).json({ error: 'schwab_connection_not_available' }); return; }
      res.setHeader('Cache-Control', 'no-store'); res.json({ receipt });
    } catch (error) { res.status(error instanceof RangeError ? 400 : 503).json({ error: error instanceof RangeError ? 'invalid_capture_settings' : 'schwab_capture_failed' }); }
  });
  router.post('/enable', async (req: Request, res: Response) => {
    const svc = getTradingScheduleService();
    if (!svc) { res.status(503).json({ error: 'scheduler_unavailable' }); return; }
    const sub = req.oidc!.user!.sub!;
    try {
      const { roots, cron } = settings(req.body);
      if ((await ownedSchedules(sub)).length) { res.status(409).json({ error: 'schwab_capture_already_enabled' }); return; }
      // First prove a complete capture. Never arm an empty or invalid provider source.
      const receipt = await capture(sub, roots);
      if (!receipt) { res.status(409).json({ error: 'schwab_connection_not_available' }); return; }
      const schedule = await svc.createSchedule({ taskType: schwabFuturesCaptureTaskType(sub),
        schedule: cron, timezone: 'Etc/UTC', ownerSub: sub,
        queue: 'intelligent-trades', taskData: { prompt: 'Owner-approved read-only Schwab Futures bar capture', userSub: sub, roots, mode: 'paper' } });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ receipt, schedule: { cron: schedule.cron, nextRunAt: schedule.nextRunAt, status: schedule.status } });
    } catch (error) { res.status(error instanceof RangeError ? 400 : 503).json({ error: error instanceof RangeError ? 'invalid_capture_settings' : 'schwab_capture_failed' }); }
  });
  router.delete('/', async (req: Request, res: Response) => {
    try {
      const schedules = await ownedSchedules(req.oidc!.user!.sub!);
      const svc = getTradingScheduleService();
      let stopped = 0;
      if (svc) for (const schedule of schedules) if (await svc.deleteSchedule(schedule.id)) stopped++;
      res.json({ stopped: stopped > 0, retainedBars: true });
    } catch { res.status(503).json({ error: 'schwab_capture_unavailable' }); }
  });
  return router;
}
