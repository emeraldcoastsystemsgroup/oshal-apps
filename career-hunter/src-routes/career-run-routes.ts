/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Extracted manual engine runs, administrator refresh controls, and cron bootstrap from the route composition root.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Return 202 for detached refresh work and map engine failure/timeouts to truthful 502/504 statuses.
 */

/**
 * Career Hunter engine-run and shared refresh routes.
 * @module career-run-routes
 */
import { type Request, type Response, type Router } from 'express';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { getTrustedServiceUserSub } from '@/shared/middleware/authz';
import { runCareerCliAwait } from './career-engine-dispatch';
import { rejectEngineStart } from './career-engine-response';
import { isCareerAdmin } from './career-company-routes';
import { callerSub, listStoreUsers, openUserDb } from './career-user-store';

const logger = createChildLogger({ module: 'career-run-routes' });
type ManualVerb = 'pull' | 'score' | 'match';

function refreshCallerSub(req: Request): string | null {
  return callerSub(req) ?? getTrustedServiceUserSub(req);
}

function startRefresh(ctx: AppContext, req: Request, res: Response): void {
  const userSub = refreshCallerSub(req);
  if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
  if (!isCareerAdmin(userSub)) { res.status(403).json({ error: 'admin only' }); return; }
  const cron = require('./career-hunter-cron') as typeof import('./career-hunter-cron');
  if (cron.isEveningChainRunning()) {
    res.status(409).json({ ok: false, err: 'refresh already running' });
    return;
  }
  const users = listStoreUsers();
  if (!users.length) { res.status(500).json({ ok: false, err: 'no user stores' }); return; }
  void cron.runEveningScrapeIndex(ctx, users, { manualRefresh: true });
  logger.info({ userSub, users: users.length }, 'career refresh chain started');
  res.status(202).json({
    ok: true,
    started: true,
    users: users.length,
    note: 'scrape+index runs detached; poll GET /run/refresh',
  });
}

function corpusFreshAt(userSub: string): string | null {
  const fallbackSub = listStoreUsers()[0];
  const db = openUserDb(userSub) || (fallbackSub ? openUserDb(fallbackSub) : null);
  if (!db) return null;
  try {
    const row = db.prepare('SELECT MAX(last_seen_at) AS m FROM corpus.postings_corpus')
      .get() as { m?: string };
    return row?.m ?? null;
  } catch (err) {
    logger.error({ err, userSub }, 'career corpus freshness read failed');
    return null;
  } finally { db.close(); }
}

function getRefresh(req: Request, res: Response): void {
  const userSub = refreshCallerSub(req);
  if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
  const cron = require('./career-hunter-cron') as typeof import('./career-hunter-cron');
  res.json({
    running: cron.isEveningChainRunning(),
    corpusFreshAt: corpusFreshAt(userSub),
  });
}

function manualArgs(verb: ManualVerb): string[] {
  if (verb === 'score') return ['score', '--min-keyword', '40'];
  if (verb === 'match') return ['match'];
  return ['pull'];
}

async function runManualVerb(ctx: AppContext, req: Request, res: Response): Promise<void> {
  const userSub = callerSub(req);
  if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
  const verb = req.params.verb as ManualVerb;
  if (!['pull', 'score', 'match'].includes(verb)) {
    res.status(400).json({ error: 'verb' });
    return;
  }
  try {
    const result = await runCareerCliAwait(
      ctx.pool, userSub, manualArgs(verb), {}, { slot: verb },
    );
    if (result.limitReason) {
      rejectEngineStart(res, { started: false, limitReason: result.limitReason }, verb);
      return;
    }
    if (!result.ok) {
      const status = result.timedOut ? 504 : 502;
      logger.warn({ userSub, verb, timedOut: result.timedOut }, 'career manual run rejected');
      res.status(status).json({ ok: false, out: result.out.slice(-1500), err: result.err.slice(-400) });
      return;
    }
    res.json({ ok: true, out: result.out.slice(-1500) });
  } catch (err) {
    logger.error({ err, userSub, verb }, 'career manual run failed');
    res.status(500).json({ ok: false, err: 'run failed' });
  }
}

/**
 * @description Starts the gated Career Hunter daily cron without introducing a module-eval cycle.
 * @param ctx - Kernel context consumed by the scheduled refresh pipeline.
 * @returns Nothing; disabled or failed startup is logged and leaves request routes available.
 */
export function startCareerCron(ctx: AppContext): void {
  try {
    const cron = require('./career-hunter-cron') as typeof import('./career-hunter-cron');
    cron.startCareerHunterCron(ctx);
  } catch (err) {
    logger.warn({ err }, 'career-hunter cron not started');
  }
}

/**
 * @description Registers manual engine-run and administrator shared-refresh routes.
 * @param router - Authenticated Career Hunter router.
 * @param ctx - Kernel context used by brokered commands and the refresh pipeline.
 * @returns Nothing.
 */
export function registerCareerRunRoutes(router: Router, ctx: AppContext): void {
  router.post('/run/refresh', (req, res) => startRefresh(ctx, req, res));
  router.get('/run/refresh', getRefresh);
  router.post('/run/:verb', (req, res) => runManualVerb(ctx, req, res));
}
