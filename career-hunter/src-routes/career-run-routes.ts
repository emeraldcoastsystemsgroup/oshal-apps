/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Extracted manual engine runs, administrator refresh controls, and cron bootstrap from the route composition root.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Return 202 for detached refresh work and map engine failure/timeouts to truthful 502/504 statuses.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Career worker rail: a manual run reports its run id and terminal state, a run that lost the Career worker answers 503 career-worker-unavailable (and the rail's other refusals keep their own status) instead of a generic 502, and a cancelled run answers 409. Add the caller's own run list (GET /runs) and owner-only cancellation (POST /run/:runId/cancel), where another user's run is indistinguishable from a missing one.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | Map every failure code the rail records on a run: career-worker-queue-timeout (504, added to the rail with the slot-wait ceiling), not-entitled (403), career-worker-error (502) and run-cancelled (409) were missing, so a manual run that ended on one of them answered a generic 502 without its reason.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Return the successful chain completion marker separately from progressive corpus freshness.
 */

/**
 * Career Hunter engine-run and shared refresh routes.
 * @module career-run-routes
 */
import { type Request, type Response, type Router } from 'express';
import { createChildLogger } from '@/shared/logger';
import { readRemoteOnly } from './career-match-prefs';
import type { AppContext } from '@/app/composition/app-context';
import { getTrustedServiceUserSub } from '@/shared/middleware/authz';
import { runCareerCliAwait } from './career-engine-dispatch';
import { rejectEngineStart } from './career-engine-response';
import { isCareerAdmin } from './career-company-routes';
import { callerSub, listStoreUsers, openUserDb } from './career-user-store';

const logger = createChildLogger({ module: 'career-run-routes' });
type ManualVerb = 'pull' | 'score' | 'match';

interface EngineRunView { runId: string; state: string; reason: string | null }

const engineRuns = require('../lib/career-engine-runs') as {
  engineRunSnapshot: (runId: string) => EngineRunView | null;
  listEngineRuns: (owner: string) => EngineRunView[];
  cancelEngineRun: (owner: string, runId: string) => { status: 'cancelled' | 'not-found' | 'already-terminal'; run?: EngineRunView };
};

/** HTTP status for a run the worker rail ended; anything unlisted keeps the generic 502. */
const RAIL_FAILURE_STATUS: Readonly<Record<string, number>> = {
  'career-worker-unavailable': 503,
  'career-worker-timeout': 504,
  'career-worker-queue-timeout': 504,
  'career-worker-error': 502,
  'run-cancelled': 409,
  'not-entitled': 403,
  'no-configured-brain': 424,
  'budget-cap-exceeded': 402,
};
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    lastCompletedAt: cron.lastEveningCompletedAt(userSub),
  });
}

function manualArgs(verb: ManualVerb): string[] {
  if (verb === 'score') return ['score', '--min-keyword', '40'];
  if (verb === 'match') return ['match'];
  return ['pull'];
}

/** Answer a failed manual run with the status its terminal state earned. */
function sendRunFailure(
  res: Response, result: { out: string; err: string; timedOut?: boolean }, run: EngineRunView | null,
): void {
  const tail = { out: result.out.slice(-1500), err: result.err.slice(-400) };
  if (run?.state === 'cancelled') {
    res.status(409).json({ ok: false, error: 'cancelled', runId: run.runId, state: run.state, ...tail });
    return;
  }
  const railStatus = run?.reason ? RAIL_FAILURE_STATUS[run.reason] : undefined;
  if (run && railStatus) {
    res.status(railStatus).json({ ok: false, error: run.reason, runId: run.runId, state: run.state, ...tail });
    return;
  }
  const status = result.timedOut ? 504 : 502;
  res.status(status).json({ ok: false, ...(run ? { runId: run.runId, state: run.state } : {}), ...tail });
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
    // A manual "score now" honours the same standing remote-only preference the cron does, so the
    // button and the nightly pass can never disagree about what counts as a match.
    const args = manualArgs(verb);
    if (verb === 'score' && await readRemoteOnly(ctx.pool, userSub)) args.push('--remote-only');
    let runId: string | undefined;
    const result = await runCareerCliAwait(
      ctx.pool, userSub, args, {}, { slot: verb, onRunStarted: (id) => { runId = id; } },
    );
    if (result.limitReason) {
      rejectEngineStart(res, { started: false, limitReason: result.limitReason }, verb);
      return;
    }
    if (!result.ok) {
      const run = runId ? engineRuns.engineRunSnapshot(runId) : null;
      logger.warn({ userSub, verb, timedOut: result.timedOut, runId, reason: run?.reason }, 'career manual run rejected');
      sendRunFailure(res, result, run);
      return;
    }
    res.json({ ok: true, out: result.out.slice(-1500), ...(runId ? { runId } : {}) });
  } catch (err) {
    logger.error({ err, userSub, verb }, 'career manual run failed');
    res.status(500).json({ ok: false, err: 'run failed' });
  }
}

/** List the caller's own engine runs, newest first, with their terminal states. */
function listRuns(req: Request, res: Response): void {
  const userSub = callerSub(req);
  if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
  res.json({ runs: engineRuns.listEngineRuns(userSub) });
}

/** Cancel one of the caller's running engine runs; another user's run answers 404. */
function cancelRun(req: Request, res: Response): void {
  const userSub = callerSub(req);
  if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
  const runId = String(req.params.runId || '');
  if (!RUN_ID.test(runId)) { res.status(400).json({ error: 'runId' }); return; }
  const outcome = engineRuns.cancelEngineRun(userSub, runId);
  if (outcome.status === 'not-found') { res.status(404).json({ error: 'run not found' }); return; }
  if (outcome.status === 'already-terminal') {
    res.status(409).json({ error: 'run already finished', state: outcome.run?.state });
    return;
  }
  logger.info({ userSub, runId }, 'career engine run cancelled by owner');
  res.status(202).json({ ok: true, runId, cancelled: true });
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
 * @description Registers manual engine-run, owner run-list/cancel, and administrator shared-refresh
 * routes.
 * @param router - Authenticated Career Hunter router.
 * @param ctx - Kernel context used by brokered commands and the refresh pipeline.
 * @returns Nothing.
 */
export function registerCareerRunRoutes(router: Router, ctx: AppContext): void {
  router.post('/run/refresh', (req, res) => startRefresh(ctx, req, res));
  router.get('/run/refresh', getRefresh);
  router.get('/runs', listRuns);
  router.post('/run/:runId/cancel', cancelRun);
  router.post('/run/:verb', (req, res) => runManualVerb(ctx, req, res));
}
