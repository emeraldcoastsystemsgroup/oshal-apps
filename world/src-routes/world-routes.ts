/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-06-19 00:00:00 | roger.murphy@agenticfederal.us   | ADR-058 Layer B: /api/world — feed the shared world graph + series
 * 2026-07-20 05:10:00 | roger.murphy@emeraldcoastsystemsgroup.com | Carved out of OSHAL core into the world app package (ADR-085 Wave 3, "skill with a surface"). The route body is byte-identical to the kernel original — same WORLD_INGEST_TOKEN fail-closed write guard, same open reads, same ENABLE_WORLD_INTELLIGENCE 503 gating, same WORLD_APP_HTML surface. The Layer-B ENGINE (@/features/world-data: service, schemas, outlet ratings, news fetcher, the surface HTML module) stays framework-resident — it keeps kernel importers (jarvis brief, the trading dispatch family, world-schedule-dispatch) — and is imported back via the preserved @/ aliases (D8 verified NOT orphaned).
 * 2026-07-19 16:20:00 | roger.murphy@emeraldcoastsystemsgroup.com   | Surface HTML bundled INTO the package (./world-app-html): the deep module @/features/world-data/world-app-html lost its only importer at the carve and tsc pruned it from dist independently of the (well-anchored) rest of the slice - the packaged route failed at mount. Deep modules prune per-file; surface content rides with the surface (pumpkin f0e4ed1 doctrine).
 */

/**
 * /api/world — the surface over the World-Intelligence Service (Layer B).
 *
 * World data is SHARED + public (market/news/sentiment), and it's fed by machines (the news-aggregator
 * bot, cron feeders) — not per-user. So this is mounted WITHOUT the OIDC wall: writes are token-guarded
 * (WORLD_INGEST_TOKEN) for machine-to-machine posting; reads are open. Start-param gated inside the
 * factory (ENABLE_WORLD_INTELLIGENCE) → 503 when disabled.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import { createChildLogger } from '@/shared/logger';
import { createWorldIntelligenceService } from '@/features/world-data/world-intelligence-service';
import { WorldContributionSchema } from '@/features/world-data/world-types';
import { buildOutletSeedContribution } from '@/features/world-data/outlet-ratings';
import { ingestFeeds, backtest } from '@/features/world-data/news-fetcher';
import { WORLD_APP_HTML } from './world-app-html';

const logger = createChildLogger({ module: 'world-routes' });

export function createWorldRoutes(): Router {
  const router = Router();
  const svc = createWorldIntelligenceService();
  const token = (process.env.WORLD_INGEST_TOKEN || '').trim();

  if (svc) logger.info('World-Intelligence Service enabled (/api/world)');
  else logger.info('World-Intelligence Service disabled (ENABLE_WORLD_INTELLIGENCE / ARANGO_URL / TSDB_URL)');

  // Shared-secret guard for machine writes. FAIL-CLOSED: with no WORLD_INGEST_TOKEN
  // configured the write endpoints reject everything (this router is mounted WITHOUT
  // the OIDC wall, so an unset token previously left them open to the internet).
  const sendDisabled = (req: Request, res: Response, payload: Record<string, unknown> = {}): boolean => {
    if (req.query.surface === '1') {
      res.json({
        enabled: false,
        message: 'World Intelligence is not configured. Set ENABLE_WORLD_INTELLIGENCE with graph and series backends to activate this surface.',
        ...payload,
      });
      return true;
    }
    res.status(503).json({ error: 'world intelligence disabled' });
    return true;
  };

  const guard = (req: Request, res: Response, next: NextFunction): void => {
    if (!token) {
      logger.warn('World ingest rejected: WORLD_INGEST_TOKEN is not configured');
      res.status(401).json({ error: 'world ingest token not configured' });
      return;
    }
    const auth = req.header('authorization') || '';
    const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (bearer === token || req.query.token === token) { next(); return; }
    res.status(401).json({ error: 'unauthorized' });
  };

  /** POST /api/world/contribute — a WorldContribution → upsert graph + append series. */
  router.post('/contribute', guard, (req: Request, res: Response) => {
    if (!svc) { res.status(503).json({ error: 'world intelligence disabled' }); return; }
    const parsed = WorldContributionSchema.safeParse(req.body || {});
    if (!parsed.success) { res.status(400).json({ error: 'invalid contribution', details: parsed.error.issues }); return; }
    svc.ingest(parsed.data)
      .then((result) => res.json({ ok: true, result }))
      .catch((e) => { logger.error({ err: e }, 'world ingest failed'); res.status(500).json({ error: 'ingest failed' }); });
  });

  /** GET /api/world/metric?entity=&metric=&days= — the historical series avg (the join's world side). */
  router.get('/metric', (req: Request, res: Response) => {
    if (!svc) { sendDisabled(req, res, { value: null, points: 0 }); return; }
    const entity = String(req.query.entity || '');
    const metric = String(req.query.metric || 'sentiment');
    const days = Number(req.query.days) || 90;
    if (!entity) { res.status(400).json({ error: 'entity required' }); return; }
    svc.metricAvg(entity, metric, days)
      .then((r) => res.json(r))
      .catch((e) => { logger.error({ err: e }, 'world metric read failed'); res.status(500).json({ error: 'read failed' }); });
  });

  /** POST /api/world/seed-outlets — load the rated news outlets (bias + reliability) into the graph. */
  router.post('/seed-outlets', guard, (req: Request, res: Response) => {
    if (!svc) { res.status(503).json({ error: 'world intelligence disabled' }); return; }
    svc.ingest(buildOutletSeedContribution(new Date().toISOString()))
      .then((result) => res.json({ ok: true, result }))
      .catch((e) => { logger.error({ err: e }, 'outlet seed failed'); res.status(500).json({ error: 'seed failed' }); });
  });

  /** POST /api/world/ingest-news?q=&entity=&label=&sources= — pull the requested registry feeds for a
   *  query, classify each item, score news/social sentiment (via the swarm's Claude creds), and ingest
   *  per-source contributions. `sources` = comma-sep feed ids (default google-news,bing-news). */
  router.post('/ingest-news', guard, (req: Request, res: Response) => {
    if (!svc) { res.status(503).json({ error: 'world intelligence disabled' }); return; }
    const body = (req.body || {}) as { q?: string; entity?: string; label?: string; limit?: number; sources?: string | string[] };
    const q = String(req.query.q || body.q || '');
    const entity = String(req.query.entity || body.entity || '');
    const label = String(req.query.label || body.label || q);
    const limit = Number(req.query.limit || body.limit) || 15;
    const rawSources = (req.query.sources as string | undefined) ?? body.sources;
    const sources = Array.isArray(rawSources)
      ? rawSources
      : (typeof rawSources === 'string' && rawSources.trim() ? rawSources.split(',').map((s) => s.trim()).filter(Boolean) : undefined);
    if (!q || !entity) { res.status(400).json({ error: 'q and entity required' }); return; }
    ingestFeeds(svc, q, entity, label, sources, { limit })
      .then((result) => res.json({ ok: true, result }))
      .catch((e) => { logger.error({ err: e }, 'feed ingest failed'); res.status(500).json({ error: 'feed ingest failed' }); });
  });

  /** GET /api/world/sentiment?entity=&days= — BIAS-AWARE sentiment: per-lean, balanced, consensus,
   *  reliability-weighted, per-outlet. The signal a naive average destroys. */
  router.get('/sentiment', (req: Request, res: Response) => {
    if (!svc) {
      sendDisabled(req, res, {
        naive: null,
        reliabilityWeighted: null,
        political: { balanced: null, consensus: 'unavailable', byLean: {} },
        econ: { balanced: null, consensus: 'unavailable', byEcon: {} },
        byKind: {},
        bySource: [],
      });
      return;
    }
    const entity = String(req.query.entity || '');
    const days = Number(req.query.days) || 90;
    if (!entity) { res.status(400).json({ error: 'entity required' }); return; }
    svc.sentimentBreakdown(entity, days)
      .then((r) => res.json(r))
      .catch((e) => { logger.error({ err: e }, 'world sentiment read failed'); res.status(500).json({ error: 'read failed' }); });
  });

  /** GET /api/world/pulls?entity=&days= — pull-rate accounting: per source, fetched vs unique vs new. */
  router.get('/pulls', (req: Request, res: Response) => {
    if (!svc) { sendDisabled(req, res, { bySource: [] }); return; }
    const entity = String(req.query.entity || '');
    const days = Number(req.query.days) || 30;
    if (!entity) { res.status(400).json({ error: 'entity required' }); return; }
    svc.pullStats(entity, days)
      .then((r) => res.json(r))
      .catch((e) => { logger.error({ err: e }, 'world pulls read failed'); res.status(500).json({ error: 'read failed' }); });
  });

  /** POST /api/world/backtest?entity=&days= — replay archived items through the current classifier and
   *  report sentiment drift, directional agreement, and entity-extraction stability. (Uses the swarm
   *  Claude creds, so it's a write-class op → token-guarded even though it persists nothing.) */
  router.post('/backtest', guard, (req: Request, res: Response) => {
    if (!svc) { res.status(503).json({ error: 'world intelligence disabled' }); return; }
    const entity = String(req.query.entity || (req.body || {}).entity || '');
    const days = Number(req.query.days || (req.body || {}).days) || 30;
    const limit = Number(req.query.limit || (req.body || {}).limit) || 40;
    if (!entity) { res.status(400).json({ error: 'entity required' }); return; }
    backtest(svc, entity, days, { limit })
      .then((r) => res.json({ ok: true, result: r }))
      .catch((e) => { logger.error({ err: e }, 'world backtest failed'); res.status(500).json({ error: 'backtest failed' }); });
  });

  /** GET /api/world/neighbors?id=&depth= — graph neighbourhood of a world node. */
  router.get('/neighbors', (req: Request, res: Response) => {
    if (!svc) { sendDisabled(req, res, { neighbors: [] }); return; }
    const id = String(req.query.id || '');
    const depth = Number(req.query.depth) || 1;
    if (!id) { res.status(400).json({ error: 'id required' }); return; }
    svc.neighbors(id, depth)
      .then((neighbors) => res.json({ neighbors }))
      .catch((e) => { logger.error({ err: e }, 'world neighbors read failed'); res.status(500).json({ error: 'read failed' }); });
  });

  /** GET /api/world/entities?limit= — the catalog of tracked subjects (for the surface + tool). */
  router.get('/entities', (req: Request, res: Response) => {
    if (!svc) { sendDisabled(req, res, { entities: [] }); return; }
    const limit = Number(req.query.limit) || 50;
    svc.listEntities(limit)
      .then((entities) => res.json({ entities }))
      .catch((e) => { logger.error({ err: e }, 'world entities read failed'); res.status(500).json({ error: 'read failed' }); });
  });

  /** GET /api/world/app — the cockpit World Intelligence surface (read-only dashboard). */
  router.get('/app', (_req: Request, res: Response) => {
    res.type('html').send(WORLD_APP_HTML);
  });

  return router;
}
