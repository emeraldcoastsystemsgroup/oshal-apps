/**
 * AI Bake-Off — the HTTP surface: lane roster, job CRUD, out-of-band runs, and the report.
 *
 * AUTH POSTURE. The manifest mounts this router with `requiresAuth: true`, and every handler ALSO
 * resolves `callerSub(req)` and refuses without one. Both, deliberately: the mount is the wall,
 * the per-handler check is what makes each read owner-scoped, and every store query is
 * parameterised on that sub (with owner-or-operator RLS underneath as the backstop). Nothing here
 * is anonymously callable, because everything here either exposes the caller's prompts and
 * outputs or spends their money on an LLM.
 *
 * Long work never runs on the request path (the kalshi lesson — a 23-second scan on a GET). A
 * bake-off is N model calls plus N grades, so `POST /jobs/:id/run` answers 202 with a run id and
 * the surface polls the report.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial implementation — GET / (surface), GET /lanes (caller-scoped roster), job CRUD, POST /jobs/:id/run (202, single-flighted), GET /jobs/:id/report (the deterministic cost/quality table + recommendation), GET /jobs/:id/runs, GET /runs/:runId/output/:agentId, and POST /jobs/:id/verdict (explicit opt-in narrative on this app's analyst bot — never automatic, because it spends).
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | GET /lanes returns the registry's availability marker beside the roster (laneAvailability), so the native runtime's empty roster says why it is empty instead of answering 503.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | PATCH /jobs/:id edits the caller's own job in place (same id, runs kept; another person's or an unknown id is 404). The console's Save could only POST, so editing a selected job created a duplicate.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | PATCH /jobs/:id refuses (409, code spec-has-runs) to change the prompt, rubric or reference of a job that already has a run. A run does not record the spec it was graded on, and the report and verdict pair the newest run with the job's current spec, so an in-place edit made the old run's scores and recommendation read as a measurement of the new prompt. Name, quality bar, volume and lane edits still save in place; the console offers Save as new.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | GET /jobs/:id/report answers `stale` when the job's prompt, rubric or reference changed after the run started (the job's updated_at, which now moves only on such a change, is later than the run's start): jobs edited in place before the 409 guard kept showing the old run's scores and recommendation as current. PATCH tells the store whether the measured spec changed.
 *
 * @module bake-off-routes
 */

import { Router, type Request, type RequestHandler, type Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import type { Pool } from 'pg';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { BotNodeClient, createRegistryEndpointResolver } from '@/features/agent-management';
import { executeBotOrInline } from '@/app/routes/inline-bot-execution';
import { callerSub } from '@/app/routes/caller-sub';
import { BAKE_OFF_DEFAULTS, BAKE_OFF_LIMITS, buildReport, validateJobSpec, type BakeOffSpec } from './bake-off-scoring';
import { BAKE_OFF_ANALYST_AGENT_ID, discoverLanes, inFlightRun, laneAvailability, runBakeOff, selectLanes } from './bake-off-engine';
import {
  deleteJob, ensureBakeOffSchema, getJob, getRun, insertJob, listJobs, listResults, listRuns, updateJob,
} from './bake-off-store';

const log = createChildLogger({ module: 'bake-off-routes' });
const botClient = new BotNodeClient(createRegistryEndpointResolver());

/** Load-time-only fallback for frameworks predating ctx.appPackageDir (ADR-085 D10). */
const LOAD_TIME_PACKAGE_DIR = process.env.OSHAL_APP_PACKAGE_DIR || '';

/**
 * @description Resolve the bundled surface directory, captured at FACTORY time.
 *
 * Never read the env var inside a handler: it points at whichever package mounted last, so with
 * two apps installed the wrong surface is served (BUILDING-EXTENSIONS.md §"Bundled assets").
 *
 * @param appPackageDir - This package's directory from the per-package context.
 * @returns The first candidate directory that actually holds bake-off.html.
 */
function surfaceDir(appPackageDir: string | undefined): string {
  const candidates = [
    appPackageDir ? path.join(appPackageDir, 'tools') : '',
    LOAD_TIME_PACKAGE_DIR ? path.join(LOAD_TIME_PACKAGE_DIR, 'tools') : '',
    path.resolve(__dirname, '../tools'),
  ].filter(Boolean) as string[];
  return candidates.find((d) => fs.existsSync(path.join(d, 'bake-off.html'))) || candidates[candidates.length - 1];
}

/** Resolve the caller or answer 401. Returns null when it has already replied. */
function requireSub(req: Request, res: Response): string | null {
  const sub = callerSub(req);
  if (!sub) {
    res.status(401).json({ error: 'authentication required' });
    return null;
  }
  return sub;
}

/** Wrap a handler so every throw is logged at ERROR and answered as a 500, never swallowed. */
function guarded(name: string, fn: (req: Request, res: Response) => Promise<void>): RequestHandler {
  return async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (err: any) {
      log.error({ err, stack: err?.stack, route: name, url: req.originalUrl }, 'bake-off route failed');
      if (!res.headersSent) res.status(500).json({ error: err?.message || 'internal error' });
    }
  };
}

/** GET /lanes — the harness × provider lanes this caller may race. */
function handleLanes(): RequestHandler {
  return guarded('GET /lanes', async (req, res) => {
    const sub = requireSub(req, res);
    if (!sub) return;
    const lanes = discoverLanes(req);
    res.json({ lanes, maxLanes: BAKE_OFF_DEFAULTS.maxLanes, limits: BAKE_OFF_LIMITS, defaults: BAKE_OFF_DEFAULTS, ...laneAvailability() });
  });
}

/** The 409 code PATCH answers when an edit would change what an existing run measured. */
export const SPEC_HAS_RUNS = 'spec-has-runs';

/**
 * @description Whether an edit changes what a run grades: the prompt raced, the rubric and the reference.
 *
 * Name, quality bar, volume and lane choice are not measured by a run (the report applies the bar to
 * the scores it recorded), so changing them leaves a run's evidence true.
 *
 * @param current - The stored job.
 * @param next - The validated replacement spec.
 * @returns True when the replacement grades differently from the stored job.
 */
export function measuredSpecChanged(current: BakeOffSpec, next: BakeOffSpec): boolean {
  return current.prompt !== next.prompt
    || (current.reference ?? '') !== (next.reference ?? '')
    || JSON.stringify(current.rubric) !== JSON.stringify(next.rubric);
}

/**
 * PATCH /jobs/:id — replace the caller's own job spec, keeping its id and run history. A body that
 * names no lanes keeps the job's current lane selection rather than silently resetting it. A job that
 * already has a run keeps its prompt, rubric and reference: its runs were graded on them and do not
 * record them, so the report would present the old scores as a measurement of the new spec.
 */
function handleUpdate(pool: Pool): RequestHandler {
  return guarded('PATCH /jobs/:id', async (req, res) => {
    const sub = requireSub(req, res);
    if (!sub) return;
    const jobId = String(req.params.id);
    const current = await getJob(pool, sub, jobId);
    if (!current) { res.status(404).json({ error: 'not found' }); return; }
    const input = { ...(req.body ?? {}) };
    if (input.laneAgentIds === undefined) input.laneAgentIds = current.laneAgentIds;
    const parsed = validateJobSpec(input);
    if (!parsed.ok) { res.status(400).json({ error: parsed.error }); return; }
    if (measuredSpecChanged(current, parsed.spec) && await getRun(pool, sub, jobId, null)) {
      res.status(409).json({
        code: SPEC_HAS_RUNS,
        error: 'This job already has a run graded on its current prompt, rubric and reference. Save your changes as a new job so that run stays a true measurement.',
      });
      return;
    }
    const job = await updateJob(pool, sub, jobId, parsed.spec, measuredSpecChanged(current, parsed.spec));
    if (!job) { res.status(404).json({ error: 'not found' }); return; }
    res.json({ job });
  });
}

/** GET /jobs + POST /jobs — the caller's own jobs. */
function handleJobs(pool: Pool): { list: RequestHandler; create: RequestHandler; remove: RequestHandler } {
  return {
    list: guarded('GET /jobs', async (req, res) => {
      const sub = requireSub(req, res);
      if (!sub) return;
      res.json({ jobs: await listJobs(pool, sub) });
    }),
    create: guarded('POST /jobs', async (req, res) => {
      const sub = requireSub(req, res);
      if (!sub) return;
      const parsed = validateJobSpec(req.body);
      if (!parsed.ok) { res.status(400).json({ error: parsed.error }); return; }
      res.status(201).json({ job: await insertJob(pool, sub, parsed.spec) });
    }),
    remove: guarded('DELETE /jobs/:id', async (req, res) => {
      const sub = requireSub(req, res);
      if (!sub) return;
      const removed = await deleteJob(pool, sub, String(req.params.id));
      if (!removed) { res.status(404).json({ error: 'not found' }); return; }
      res.json({ ok: true });
    }),
  };
}

/** POST /jobs/:id/run — start an out-of-band race; 202 with the run id. */
function handleRun(ctx: AppContext, pool: Pool): RequestHandler {
  return guarded('POST /jobs/:id/run', async (req, res) => {
    const sub = requireSub(req, res);
    if (!sub) return;
    const job = await getJob(pool, sub, String(req.params.id));
    if (!job) { res.status(404).json({ error: 'not found' }); return; }

    const open = inFlightRun(job.id);
    if (open) { res.status(202).json({ runId: open, alreadyRunning: true }); return; }

    const lanes = selectLanes(discoverLanes(req), job.laneAgentIds);
    if (lanes.length < 2) {
      res.status(409).json({
        error: `a bake-off needs at least two lanes; ${lanes.length} available to you. Install or start a bot on a second harness/provider pairing, then try again.`,
        lanes,
      });
      return;
    }
    const runId = await runBakeOff(ctx, sub, job, lanes);
    res.status(202).json({ runId, lanes: lanes.length });
  });
}

/** The marker a report carries when its run measured an earlier prompt, rubric or reference than the job has now. */
export interface StaleRun { editedAt: string; runStartedAt: string; message: string }

/**
 * @description Whether a run measured an earlier version of its job. The job's updated_at moves only when its
 * prompt, rubric or reference changes, so a job updated after the run started was graded on something else.
 * @param job - The stored job.
 * @param run - The run the report shows.
 * @returns The stale marker, or null when the run measured the job as it is now.
 */
export function staleRun(job: { updatedAt: string }, run: { startedAt: string }): StaleRun | null {
  const edited = Date.parse(job.updatedAt);
  const started = Date.parse(run.startedAt);
  if (!Number.isFinite(edited) || !Number.isFinite(started) || edited <= started) return null;
  return {
    editedAt: job.updatedAt,
    runStartedAt: run.startedAt,
    message: 'This job was edited after this run started, so these results may not measure its current prompt, rubric or reference. Run it again for current results.',
  };
}

/** GET /jobs/:id/report — the deterministic table + recommendation for one run. */
function handleReport(pool: Pool): RequestHandler {
  return guarded('GET /jobs/:id/report', async (req, res) => {
    const sub = requireSub(req, res);
    if (!sub) return;
    const job = await getJob(pool, sub, String(req.params.id));
    if (!job) { res.status(404).json({ error: 'not found' }); return; }
    const run = await getRun(pool, sub, job.id, req.query.runId ? String(req.query.runId) : null);
    if (!run) { res.json({ job, run: null, stale: null, report: null }); return; }
    const rows = await listResults(pool, sub, run.id, false);
    res.json({
      job, run,
      stale: staleRun(job, run),
      report: buildReport(rows, { qualityBar: job.qualityBar, monthlyVolume: job.monthlyVolume }),
      // Per-lane run tracing is the framework's, not this app's — deep-link rather than re-derive.
      traceHint: '/api/trace/',
    });
  });
}

/** GET /jobs/:id/runs and GET /runs/:runId/output/:agentId — history and one lane's raw output. */
function handleHistory(pool: Pool): { runs: RequestHandler; output: RequestHandler } {
  return {
    runs: guarded('GET /jobs/:id/runs', async (req, res) => {
      const sub = requireSub(req, res);
      if (!sub) return;
      const job = await getJob(pool, sub, String(req.params.id));
      if (!job) { res.status(404).json({ error: 'not found' }); return; }
      res.json({ runs: await listRuns(pool, sub, job.id) });
    }),
    output: guarded('GET /runs/:runId/output/:agentId', async (req, res) => {
      const sub = requireSub(req, res);
      if (!sub) return;
      // Owner-scoped read: a run the caller does not own yields no rows, so a foreign runId is
      // indistinguishable from a missing one (no existence leak).
      const rows = await listResults(pool, sub, String(req.params.runId), true);
      const row = rows.find((r) => r.laneAgentId === String(req.params.agentId));
      if (!row) { res.status(404).json({ error: 'not found' }); return; }
      res.json({
        lane: { bot: row.laneBot, harness: row.laneHarness, provider: row.laneProvider, model: row.observedModel },
        ok: row.ok, output: row.output, error: row.error,
        judge: { score: row.judgeScore, mode: row.judgeMode, rationale: row.judgeRationale, dimensions: row.dimensions },
        cost: { usd: row.costUsd, totalTokens: row.totalTokens, durationMs: row.durationMs },
        taskId: row.taskId,
      });
    }),
  };
}

/** The verdict prompt — the analyst reads the SAME computed table the human sees. */
function verdictPrompt(job: { name: string; qualityBar: number; monthlyVolume: number }, report: unknown): string {
  return [
    `Bake-off verdict for the job "${job.name}".`,
    `Quality bar: ${job.qualityBar}/100. Assumed volume: ${job.monthlyVolume} runs/month.`,
    'The table below is already computed and is authoritative — do not recompute it, do not pick a',
    'different winner, and do not soften a `blocked` reason. Write 4-8 sentences for the person who',
    'pays the bill: what to switch to, what it saves, and which caveat would most change the answer.',
    'If `blocked` is set, explain what has to change before a recommendation is possible.',
    '',
    JSON.stringify(report),
  ].join('\n');
}

/** POST /jobs/:id/verdict — the analyst narrates the report. Explicit, because it spends. */
function handleVerdict(ctx: AppContext, pool: Pool): RequestHandler {
  return guarded('POST /jobs/:id/verdict', async (req, res) => {
    const sub = requireSub(req, res);
    if (!sub) return;
    const job = await getJob(pool, sub, String(req.params.id));
    if (!job) { res.status(404).json({ error: 'not found' }); return; }
    const run = await getRun(pool, sub, job.id, req.body?.runId ? String(req.body.runId) : null);
    if (!run) { res.status(409).json({ error: 'no run to narrate — start a run first' }); return; }
    const rows = await listResults(pool, sub, run.id, false);
    const report = buildReport(rows, { qualityBar: job.qualityBar, monthlyVolume: job.monthlyVolume });
    try {
      const result = await executeBotOrInline(ctx, botClient, BAKE_OFF_ANALYST_AGENT_ID, {
        text: verdictPrompt(job, report), taskId: `bakeoff-verdict-${run.id}`,
        workspaceFolderId: 'bake-off', agentId: BAKE_OFF_ANALYST_AGENT_ID,
        userSub: sub, direct: true, agenticMode: false,
      } as any);
      res.json({ verdict: String(result.response ?? ''), costUsd: result.cost ?? 0, model: result.model ?? null });
    } catch (err: any) {
      // A missing narrator must not hide the evidence: the table stands on its own.
      log.error({ err, stack: err?.stack, sub, jobId: job.id }, 'Bake-off verdict narration failed');
      res.status(503).json({
        error: 'the bake-off analyst is unavailable — the table and recommendation above stand on their own',
        detail: err?.message || String(err),
      });
    }
  });
}

/**
 * @description Build the /api/bake-off router.
 *
 * Mounted by the app loader at activation per the manifest (`requiresAuth: true`,
 * `requiresContext: true`). The schema is ensured once here at factory time rather than per
 * request, and a failure is logged loudly — the routes still mount so the surface can report the
 * problem instead of 404ing.
 *
 * @param ctx - The framework app context (pool, orchestrator, appPackageDir).
 * @returns The Express router for this package.
 */
export function createBakeOffRoutes(ctx: AppContext): Router {
  const router = Router();
  const pool = ctx.pool as Pool;
  const dir = surfaceDir(ctx.appPackageDir);

  ensureBakeOffSchema(pool).catch((err: any) =>
    log.error({ err, stack: err?.stack }, 'bake-off schema bootstrap failed — the surface will report empty state'));

  const jobs = handleJobs(pool);
  const history = handleHistory(pool);

  router.get(['/', '/app'], (_req: Request, res: Response) => res.sendFile(path.join(dir, 'bake-off.html')));
  router.get('/lanes', handleLanes());
  router.get('/jobs', jobs.list);
  router.post('/jobs', jobs.create);
  router.patch('/jobs/:id', handleUpdate(pool));
  router.delete('/jobs/:id', jobs.remove);
  router.post('/jobs/:id/run', handleRun(ctx, pool));
  router.get('/jobs/:id/report', handleReport(pool));
  router.get('/jobs/:id/runs', history.runs);
  router.get('/runs/:runId/output/:agentId', history.output);
  router.post('/jobs/:id/verdict', handleVerdict(ctx, pool));

  log.info({ surfaceDir: dir }, 'bake-off routes mounted');
  return router;
}
