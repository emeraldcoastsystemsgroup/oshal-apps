/**
 * CHANGE LOG
 * 11 | maintainer@emeraldcoastsystemsgroup.com | Reuse saved title selectors for bounded native manual passes, refuse unavailable profiles before launch, and preserve existing model-identity refusal statuses.
 * 10 | maintainer@emeraldcoastsystemsgroup.com | Read actual safe native corpus observations for normal Career readers without scanning the corpus or requiring the operator jobs API.
 * 9 | maintainer@emeraldcoastsystemsgroup.com | Project actual native cancelling/stopped receipts and register the framework cancellation control's truthful legacy fallback.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | Keep native manual scoring after HTTP acknowledgement, report actual owner runs and published count-only success receipts, and refuse unavailable cancellation truthfully.
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Extracted manual engine runs, administrator refresh controls, and cron bootstrap from the route composition root.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Return 202 for detached refresh work and map engine failure/timeouts to truthful 502/504 statuses.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Career worker rail: a manual run reports its run id and terminal state, a run that lost the Career worker answers 503 career-worker-unavailable (and the rail's other refusals keep their own status) instead of a generic 502, and a cancelled run answers 409. Add the caller's own run list (GET /runs) and owner-only cancellation (POST /run/:runId/cancel), where another user's run is indistinguishable from a missing one.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | Map every failure code the rail records on a run: career-worker-queue-timeout (504, added to the rail with the slot-wait ceiling), not-entitled (403), career-worker-error (502) and run-cancelled (409) were missing, so a manual run that ended on one of them answered a generic 502 without its reason.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Return the successful chain completion marker separately from progressive corpus freshness.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Native refresh is installation-managed; expose capability and refuse a detached shared writer before acknowledging work.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Keep native refresh health independent of corpus scans and application-local cron memory; report unavailable native progress without falsely claiming the pull is idle.
 * 12 | maintainer@emeraldcoastsystemsgroup.com | POST /run/build runs matching and scoring as one background run. Awaited, a match over the corpus says nothing to the kernel for 10 seconds and the call is refused with 503, so Find & score jobs matched nothing and then scored nothing. CAREER_BUILD_LIMIT bounds one person's scoring on an installation that shares its model with strangers.
 * 13 | maintainer@emeraldcoastsystemsgroup.com | On the native kernel POST /run/build is the bounded title pass with matching first: saved titles, a cap of 50, seven days, 30 minutes, a retained receipt and a refusal with no saved titles. The merge had moved the Job Board's button to the unbounded generic run. An installation that set CAREER_BUILD_LIMIT keeps that run, bounded by its limit.
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
import { runCareerCliAsync, runCareerCliAwait } from './career-engine-dispatch';
import { rejectEngineStart } from './career-engine-response';
import { isCareerAdmin } from './career-company-routes';
import { callerSub, listStoreUsers, openUserDb, userPaths } from './career-user-store';

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
  'invalid-model-identity': 400,
  'model-identity-mismatch': 409,
  'model-identity-unavailable': 503,
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
const manualScore = require('../lib/career-manual-score') as {
  LIMIT: number; FRESH_DAYS: number;
  verdict: (stdout?: string, limit?: number, expectedTerms?: number, matched?: boolean) => { scored: number; skipped: number } | null;
  read: (userDir: string) => (EngineRunView & { completedAt: string; scored: number; skipped: number; limit: number }) | null;
  write: (userDir: string, runId: string, result: { scored: number; skipped: number }, limit?: number) => Promise<void>;
};

/** Resolve lazily so the legacy manual-route contract retains its existing dependencies. */
function nativeRunner(): typeof import('./career-engine-runner') {
  return require('./career-engine-runner') as typeof import('./career-engine-runner');
}

function refreshCallerSub(req: Request): string | null {
  return callerSub(req) ?? getTrustedServiceUserSub(req);
}

function startRefresh(ctx: AppContext, req: Request, res: Response): void {
  const userSub = refreshCallerSub(req);
  if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
  if (process.env.OSHAL_EGRESS === 'kernel') {
    res.status(409).json({ ok: false, manualRefreshAvailable: false, refreshMode: 'installation-managed',
      error: 'The installation refreshes the shared job sources. This screen cannot start a separate shared-corpus writer.' });
    return;
  }
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

/** Project only the kernel's safe operational fields, never operator errors or paths. */
function nativeCorpusObservation(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const data = value as Record<string, unknown>;
  if (data.observationAvailable !== true || data.source !== 'native-scheduler'
    || !['running', 'idle', 'failed', 'disabled', 'unavailable'].includes(String(data.status))
    || ![true, false, null].includes(data.running as boolean | null)
    || ![true, false, null].includes(data.enabled as boolean | null)
    || ![true, false, null].includes(data.lastOk as boolean | null)) return null;
  if (data.status === 'running' && data.running !== true
    || ['idle', 'failed', 'disabled'].includes(String(data.status)) && data.running !== false
    || data.status === 'unavailable' && data.running !== null) return null;
  const instant = (raw: unknown): string | null => typeof raw === 'string' && raw.length <= 40
    && Number.isFinite(Date.parse(raw)) ? raw : null;
  const counts = (raw: unknown, names: string[]): Record<string, number> | null => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const entries = raw as Record<string, unknown>;
    if (!names.every(name => Number.isSafeInteger(entries[name]) && Number(entries[name]) >= 0)) return null;
    return Object.fromEntries(names.map(name => [name, Number(entries[name])]));
  };
  const out: Record<string, unknown> = { observationAvailable: true, source: 'native-scheduler',
    status: data.status, enabled: data.enabled, running: data.running, lastOk: data.lastOk };
  for (const key of ['lastStartedAt', 'lastFinishedAt', 'lastPublishedAt', 'lastCompletedAt', 'nextRunAt']) out[key] = instant(data[key]);
  const raw = data.lastPublication;
  const publication = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : null;
  out.lastPublication = publication && instant(publication.publishedAt) ? {
    publishedAt: instant(publication.publishedAt), completedAt: instant(publication.completedAt),
    counts: counts(publication.counts, ['new', 'refreshed', 'closed']),
    sources: counts(publication.sources, ['confirmed', 'unconfirmed']),
  } : null;
  return out;
}

async function getRefresh(ctx: AppContext, req: Request, res: Response): Promise<void> {
  const userSub = refreshCallerSub(req);
  if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
  if (process.env.OSHAL_EGRESS === 'kernel') {
    const base = { running: null, corpusFreshAt: null, lastCompletedAt: null,
      observationAvailable: false, status: 'unavailable',
      manualRefreshAvailable: false, refreshMode: 'installation-managed' };
    const native = ctx as unknown as { intent?: (name: string, input: object) => Promise<unknown> };
    try {
      const observed = native.intent ? nativeCorpusObservation(await native.intent('career.corpus_status', {})) : null;
      res.json(observed ? { ...base, ...observed } : base);
    } catch {
      logger.warn({ userSub }, 'native corpus observation unavailable');
      res.json(base);
    }
    return;
  }
  const cron = require('./career-hunter-cron') as typeof import('./career-hunter-cron');
  res.json({
    running: cron.isEveningChainRunning(),
    corpusFreshAt: corpusFreshAt(userSub),
    lastCompletedAt: cron.lastEveningCompletedAt(userSub),
    manualRefreshAvailable: process.env.OSHAL_EGRESS !== 'kernel' && isCareerAdmin(userSub),
    refreshMode: process.env.OSHAL_EGRESS === 'kernel' ? 'installation-managed' : 'application-managed',
  });
}

function manualArgs(verb: ManualVerb): string[] {
  if (verb === 'score') return ['score', '--min-keyword', '40'];
  if (verb === 'match') return ['match'];
  return ['pull'];
}

/** Whether an installation set a usable CAREER_BUILD_LIMIT. */
function hasBuildBound(limit: string | undefined): boolean {
  const bound = Number(limit);
  return Number.isInteger(bound) && bound > 0;
}

/**
 * @description The generic Find & score jobs run. A demo installation sets CAREER_BUILD_LIMIT, because its visitors share
 * one model: a bounded list and two workers. Off the native kernel a person without the setting scores all their matches.
 * The native kernel without the setting never reaches this: startBuild runs the bounded title pass instead.
 * @param remoteOnly - The person's standing remote-only preference.
 * @param limit - The installation's limit, when it set one.
 * @returns The engine arguments, verb first.
 */
export function buildBoardArgs(remoteOnly: boolean, limit: string | undefined = process.env.CAREER_BUILD_LIMIT): string[] {
  const args = ['build-board', '--min-keyword', '40'];
  if (hasBuildBound(limit)) args.push('--limit', String(Number(limit)), '--workers', '2');
  if (remoteOnly) args.push('--remote-only');
  return args;
}

/** Start Find & score jobs in the background; the Job Board watches GET /resume/state for its end. */
async function startBuild(ctx: AppContext, res: Response, userSub: string): Promise<void> {
  try {
    if (process.env.OSHAL_EGRESS === 'kernel' && !hasBuildBound(process.env.CAREER_BUILD_LIMIT)) {
      await startNativeScore(ctx, userSub, manualScore.LIMIT, res, true);
      return;
    }
    const started = await runCareerCliAsync(ctx.pool, userSub, buildBoardArgs(await readRemoteOnly(ctx.pool, userSub)));
    if (rejectEngineStart(res, started, 'build')) return;
    logger.info({ userSub }, 'career board build started');
    res.status(202).json({ ok: true, started: true });
  } catch (err) {
    logger.error({ err, userSub }, 'career board build failed to start');
    res.status(500).json({ ok: false, err: 'build failed to start' });
  }
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

async function startNativeScore(
  ctx: AppContext, userSub: string, limit: number, res: Response, matchFirst = false,
): Promise<void> {
  // Reuse the nightly title path without creating an eager dispatcher/title-module cycle.
  const titles = require('./career-title-score') as typeof import('./career-title-score');
  let profile: Awaited<ReturnType<typeof titles.readTitleProfile>>;
  try { profile = await titles.readTitleProfile(ctx.pool, userSub); }
  catch {
    res.status(503).json({ ok: false, error: 'saved-title-profile-unavailable' });
    return;
  }
  const terms = titles.normalizeTitleTerms(profile.titleTerms);
  if (terms.length !== profile.titleTerms.length || terms.some((term, i) => term !== profile.titleTerms[i])) {
    res.status(503).json({ ok: false, error: 'saved-title-profile-unavailable' });
    return;
  }
  if (!terms.length) {
    res.status(409).json({ ok: false, reason: 'no-title-profile',
      error: 'Save target job titles in Career Settings before scoring fresh jobs.' });
    return;
  }
  const { args, env } = titles.buildTitlePassInvocation(terms, limit, profile.remoteOnly);
  const expectedTerms = terms.length;
  let runId: string | undefined;
  const passEnv = matchFirst ? { ...env, CH_BOARD_MATCH: '1' } : env;
  const result = await runCareerCliAsync(ctx.pool, userSub, args, passEnv, {
    slot: 'score', timeoutMs: 30 * 60_000, captureStdout: true,
    onRunStarted: id => { runId = id; },
    onComplete: async completion => {
      const counts = completion.ok ? manualScore.verdict(completion.stdout, limit, expectedTerms, matchFirst) : null;
      if (runId && counts) await manualScore.write(userPaths(userSub).userDir, runId, counts, limit);
    },
  });
  if (rejectEngineStart(res, { ...result, err: 'Score could not be started' }, 'score')) return;
  res.status(202).json({ ok: true, started: true, state: 'running', ...(runId ? { runId } : {}),
    limit, freshDays: manualScore.FRESH_DAYS });
}

async function runManualVerb(ctx: AppContext, req: Request, res: Response): Promise<void> {
  const userSub = callerSub(req);
  if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
  if (req.params.verb === 'build') return startBuild(ctx, res, userSub);
  const verb = req.params.verb as ManualVerb;
  if (!['pull', 'score', 'match'].includes(verb)) {
    res.status(400).json({ error: 'verb' });
    return;
  }
  const nativeScore = verb === 'score' && process.env.OSHAL_EGRESS === 'kernel';
  const limit = req.body?.limit === undefined ? manualScore.LIMIT : req.body.limit;
  if (nativeScore && (!Number.isSafeInteger(limit) || limit < 1 || limit > manualScore.LIMIT)) {
    res.status(400).json({ ok: false, error: 'limit must be an integer from 1 to 50' });
    return;
  }
  try {
    if (nativeScore) {
      await startNativeScore(ctx, userSub, limit, res);
      return;
    }
    // Legacy callers retain their existing generic command and standing preference.
    const remoteOnly = verb === 'score' && await readRemoteOnly(ctx.pool, userSub);
    const args = manualArgs(verb);
    if (remoteOnly) args.push('--remote-only');
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
async function listRuns(req: Request, res: Response): Promise<void> {
  const userSub = callerSub(req);
  if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
  if (process.env.OSHAL_EGRESS === 'kernel') {
    try {
      const status = await nativeRunner().nativeEngineRunStatus();
      if (!status) throw new Error('Native run status is unavailable');
      const active = status.runs.filter(run => RUN_ID.test(run.runId))
        .map(run => ({ runId: run.runId, state: run.state || 'running', reason: null,
          canCancel: status.canCancel && (!run.state || run.state === 'running') }));
      const stopped = (status.cancelled || []).filter(run => RUN_ID.test(run.runId)
        && !active.some(activeRun => activeRun.runId === run.runId))
        .map(run => ({ runId: run.runId, state: 'cancelled', completedAt: run.completedAt, reason: null }));
      const completed = manualScore.read(userPaths(userSub).userDir);
      res.json({ source: 'native', runs: [...active, ...stopped,
        ...(completed && ![...active, ...stopped].some(run => run.runId === completed.runId) ? [completed] : [])] });
    } catch (err) {
      logger.warn({ err, userSub }, 'career native run status unavailable');
      res.status(503).json({ error: 'run-status-unavailable' });
    }
    return;
  }
  res.json({ runs: engineRuns.listEngineRuns(userSub) });
}

/** Cancel one of the caller's running engine runs; another user's run answers 404. */
async function cancelRun(req: Request, res: Response): Promise<void> {
  const userSub = callerSub(req);
  if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
  const runId = String(req.params.runId || '');
  if (!RUN_ID.test(runId)) { res.status(400).json({ error: 'runId' }); return; }
  if (process.env.OSHAL_EGRESS === 'kernel') {
    try {
      const runner = nativeRunner(), status = await runner.nativeEngineRunStatus();
      if (!status) throw new Error('Native run status is unavailable');
      if (!status.runs.some(run => run.runId === runId)) {
        if ((status.cancelled || []).some(run => run.runId === runId)) {
          res.json({ ok: true, runId, state: 'cancelled', cancelled: true }); return;
        }
        const completed = manualScore.read(userPaths(userSub).userDir);
        if (completed?.runId === runId) res.status(409).json({ error: 'run already finished', state: 'succeeded' });
        else res.status(404).json({ error: 'run not found' });
        return;
      }
      const outcome = await runner.cancelNativeEngineRun(runId);
      if (outcome === 'cancelled') res.status(202).json({ ok: true, runId, cancelled: true });
      else if (outcome === 'cancelling') res.status(202).json({ ok: true, runId, state: 'cancelling', cancellationRequested: true });
      else if (outcome === 'finishing') res.status(409).json({ ok: false, runId, state: 'finishing', error: 'The run is finishing; check its saved result.' });
      else res.status(outcome === 'unavailable' ? 503 : 409).json({ ok: false, runId,
        error: outcome === 'unavailable' ? 'native-cancellation-unavailable' : 'cancellation-not-confirmed' });
    } catch (err) {
      logger.warn({ err, userSub, runId }, 'career native cancellation unavailable');
      res.status(503).json({ error: 'run-status-unavailable' });
    }
    return;
  }
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
  router.get('/run/refresh', (req, res) => getRefresh(ctx, req, res));
  router.get('/runs', listRuns);
  router.post('/run/:runId/cancel', cancelRun);
  // Native kernels intercept this reserved control before taking an owner-file lock.
  // Legacy hosts use the existing process-tree cancellation handler.
  router.post('/_runtime/runs/:runId/cancel', cancelRun);
  router.post('/run/:verb', (req, res) => runManualVerb(ctx, req, res));
}
