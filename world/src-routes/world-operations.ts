/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | 1.4.0: the operator's Sources & schedules surface (operator ask 2026-10-02: a World screen that shows the configured cron jobs and the pull locations, with on/off and frequency knobs). GET /ping (the dashboard shows its link only when this answers), GET /app (the page), GET /sources (core describeWorldSources: every pull location with its switch, .env gates, last-24-hour pulls and last collector run) and PATCH /sources/:id {enabled}. The schedules themselves are read and changed through core's operator routes, /api/swarm/apps/world/schedules.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | /ping answers 503 on a core that does not export World source control (describeWorldSources / isWorldSourceId), so the dashboard keeps the link hidden instead of opening a page whose reads would fail.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Run one explicit bounded collector through original native writer admission; preserve actual partial results and refuse legacy executors that ignore the requested universe.
 */

/**
 * /api/world/operations — operator-only. The manifest mounts it with `auth: operator`
 * (requiresAuth + requiresOperator at the mount), so no route here is reachable by a
 * non-operator. Collector runs additionally check the original caller and current native writer.
 * Reads and writes go through the kernel's
 * world-data skill (source control on the series store); this package owns only the surface.
 */
import { Router, type Request, type Response } from 'express';
import { createChildLogger } from '@/shared/logger';
import { getCaller } from '@/shared/middleware/authz';
import { createWorldIntelligenceService, describeWorldSources, isWorldSourceId } from '@/features/world-data';
import { WORLD_OPS_HTML } from './world-ops-html';

const logger = createChildLogger({ module: 'world-operations' });
const COLLECTORS = ['market-events', 'short-interest', 'gov-contracts', 'congress-trades', 'insider-trades'];
type CollectorRequest = { tickers?: Array<{ symbol: string; name?: string }>; days?: number; lookaheadDays?: number };
type NativeCollector = {
  runtimeKind?: string;
  authorizeWrite?: () => Promise<unknown>;
  collector?: (id: string, request: CollectorRequest) => Promise<unknown>;
};

/** @description Validate the explicit collection envelope; the native service validates every source field.
 * @param body The operator request. @returns Whether it is a bounded collector request. */
function validCollectorRequest(body: unknown): body is CollectorRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  if (Object.keys(body).some((key) => !['tickers', 'days', 'lookaheadDays'].includes(key))) return false;
  const request = body as CollectorRequest;
  if (request.tickers !== undefined && (!Array.isArray(request.tickers) || request.tickers.length > 128)) return false;
  return (request.days === undefined || (Number.isInteger(request.days) && request.days >= 1 && request.days <= 365))
    && (request.lookaheadDays === undefined || (Number.isInteger(request.lookaheadDays) && request.lookaheadDays >= 1 && request.lookaheadDays <= 14));
}

/** @description Execute one operator-requested collection without exporting credentials or manufacturing completion.
 * @param req Original operator-mounted request. @param res Express response. */
async function runCollector(req: Request, res: Response): Promise<void> {
  try {
    if (!getCaller(req).sub) throw new Error('caller missing');
  } catch {
    res.status(401).json({ error: 'authentication_required' }); return;
  }
  const id = String(req.params.id);
  if (!COLLECTORS.includes(id)) { res.status(404).json({ error: 'unknown_world_collector' }); return; }
  if (!validCollectorRequest(req.body)) { res.status(400).json({ error: 'invalid_world_collector_request' }); return; }
  const svc = createWorldIntelligenceService() as NativeCollector | null;
  // Legacy collectX functions choose their own universe; do not silently ignore these explicit inputs.
  if (svc?.runtimeKind !== 'native-scoped' || typeof svc.collector !== 'function' || typeof svc.authorizeWrite !== 'function') {
    res.status(503).json({ error: 'native_world_collector_unavailable' }); return;
  }
  try {
    await svc.authorizeWrite();
  } catch {
    logger.warn({ id, status: 403 }, 'World collector current writer admission refused');
    res.status(403).json({ error: 'world_collector_refused' }); return;
  }
  try {
    const result = await svc.collector(id, req.body);
    logger.info({ id }, 'World collector request completed with its native outcome');
    res.json(result);
  } catch (error) {
    const classified = (error as { status?: unknown } | null)?.status;
    const status = typeof classified === 'number' && [400, 403, 404, 503].includes(classified) ? classified : 503;
    logger.warn({ id, status }, 'World collector request refused or unavailable');
    res.status(status).json({ error: status === 403 ? 'world_collector_refused' : status === 400
      ? 'invalid_world_collector_request' : status === 404 ? 'unknown_world_collector' : 'world_collector_unavailable' });
  }
}

/**
 * @description Build the operator Sources & schedules router.
 * @returns The Express router mounted at /api/world/operations.
 */
export function createWorldOperationsRoutes(): Router {
  const router = Router();
  router.post('/collectors/:id/run', runCollector);

  // The dashboard shows its link only on a 200 here, so answer 200 only when this core carries the
  // engine half (core #1026); on an older core the page's reads would fail.
  router.get('/ping', (_req: Request, res: Response) => {
    if (typeof describeWorldSources !== 'function' || typeof isWorldSourceId !== 'function') {
      res.status(503).json({ ok: false, error: 'this core does not carry World source control' });
      return;
    }
    res.json({ ok: true });
  });

  router.get('/app', (_req: Request, res: Response) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader('cache-control', 'no-store');
    res.send(WORLD_OPS_HTML);
  });

  router.get('/sources', async (_req: Request, res: Response) => {
    const svc = createWorldIntelligenceService();
    if (!svc) { res.status(503).json({ error: 'world intelligence disabled' }); return; }
    try {
      res.json(await describeWorldSources(svc.sourceControl()));
    } catch (err) {
      logger.error({ err }, 'Reading the World sources failed');
      res.status(500).json({ error: 'world sources unavailable' });
    }
  });

  router.patch('/sources/:id', async (req: Request, res: Response) => {
    const id = String(req.params.id);
    const enabled = (req.body as { enabled?: unknown } | undefined)?.enabled;
    if (typeof enabled !== 'boolean') { res.status(400).json({ error: 'enabled must be true or false' }); return; }
    if (!isWorldSourceId(id)) { res.status(404).json({ error: 'unknown source' }); return; }
    const svc = createWorldIntelligenceService();
    if (!svc) { res.status(503).json({ error: 'world intelligence disabled' }); return; }
    try {
      const control = svc.sourceControl();
      await control.setSwitch(id, enabled, getCaller(req).sub);
      const { sources } = await describeWorldSources(control);
      res.json({ source: sources.find((s) => s.id === id) ?? null });
    } catch (err) {
      logger.error({ err, id, enabled }, 'Switching a World source failed');
      res.status(500).json({ error: 'world source switch failed' });
    }
  });

  return router;
}
