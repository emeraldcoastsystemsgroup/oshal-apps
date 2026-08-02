/**
 * AI Bake-Off — the conductor: discover the lanes, race the prompt across them, grade every
 * output on the shared judge, persist the evidence.
 *
 * This module makes NO LLM call of its own. Every model call lands on an accountable bot:
 *   - candidate output → the candidate bot itself, via `executeBotOrInline` (ADR-036), which is
 *     also where the cost-governance budget gate and the execute-entitlement check live, and
 *     which is what puts the spend in `chat_tasks` under that bot's agent_id;
 *   - the grade → the quality-judge concierge via `JudgeService` (the same wiring
 *     `POST /api/judge` uses), so grading cost is attributed to the judge, not to the app.
 *
 * Lanes run SEQUENTIALLY on purpose. A parallel fan-out across eight bots would present the
 * budget gate with eight simultaneous first-calls (each seeing pre-spend state) and spike a
 * month's optimisation budget in one click. Sequential also means an aborted run leaves a
 * partial, honest result set rather than eight half-written rows.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial implementation — caller-scoped lane discovery off getActiveRegistry() (ADR-087 isBotAccessibleTo, operator sees wider), sequential lane execution through executeBotOrInline with per-lane failure isolation, grading through JudgeService on the quality-judge concierge, single-flight per job, and a best-effort completion notification through the kernel notification router.
 *
 * @module bake-off-engine
 */

import { randomUUID } from 'crypto';
import type { Pool } from 'pg';
import type { Request } from 'express';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { BotNodeClient, createRegistryEndpointResolver } from '@/features/agent-management';
import { executeBotOrInline } from '@/app/routes/inline-bot-execution';
import { getActiveRegistry, isBotAccessibleTo } from '@/app/extensions/swarm/swarm-bot-registry';
import { JudgeService, QUALITY_JUDGE_AGENT_ID } from '@/features/quality-judge';
import { buildNotificationRouter } from '@/app/routes/notify-routes';
import { isOperator } from '@/shared/middleware/authz';
import { BAKE_OFF_DEFAULTS } from './bake-off-scoring';
import type { BakeOffJob } from './bake-off-store';
import { closeRun, insertResult, openRun } from './bake-off-store';

const log = createChildLogger({ module: 'bake-off-engine' });

/** The framework way to reach a bot node; falls through to inline for concierge bots. */
const botClient = new BotNodeClient(createRegistryEndpointResolver());

/** This package's own analyst — it writes the verdict, so it must never also be a candidate. */
export const BAKE_OFF_ANALYST_AGENT_ID = 'b0be0000-0000-0000-0000-000000000001';

/** Bots that can never be lanes: the grader (circular) and this app's own narrator. */
const EXCLUDED_LANE_AGENTS = new Set<string>([QUALITY_JUDGE_AGENT_ID, BAKE_OFF_ANALYST_AGENT_ID]);

/** One selectable lane: a bot with an explicit harness × provider pairing. */
export interface Lane {
  agentId: string;
  bot: string;
  harness: string;
  provider: string;
  role: string;
}

/**
 * @description The lanes this caller may race, derived from the ACTIVE bot registry.
 *
 * Two filters carry the weight. **Access scoping** (ADR-087): a normal caller sees only what
 * user-facing delegation may reach (`isBotAccessibleTo(id, 'jarvis')`), so operator-scoped
 * internal machinery — the planner, the queue bot, the developer bot — never shows up as
 * somebody's "cheap lane"; an operator sees the operator-scoped set. **Explicit pairing**: a bot
 * that declares no `harnessType`/`apiType` runs on the process default, so it is not a
 * distinguishable lane — racing it would compare a lane against itself under another name.
 *
 * @param req - The authenticated request (decides operator vs user scope).
 * @returns The caller's lanes, de-duplicated by agentId and sorted by bot name.
 */
export function discoverLanes(req: Request): Lane[] {
  const role = isOperator(req) ? 'operator' : 'jarvis';
  const seen = new Set<string>();
  const lanes: Lane[] = [];
  for (const bot of getActiveRegistry()) {
    const agentId = bot.agentId;
    if (!agentId || seen.has(agentId) || EXCLUDED_LANE_AGENTS.has(agentId)) continue;
    if (!bot.harnessType || !bot.apiType) continue;
    if (bot.harnessType === 'noop') continue;
    if (!isBotAccessibleTo(agentId, role)) continue;
    seen.add(agentId);
    lanes.push({ agentId, bot: bot.name, harness: bot.harnessType, provider: bot.apiType, role: bot.role });
  }
  return lanes.sort((a, b) => a.bot.localeCompare(b.bot));
}

/**
 * @description Narrow the discovered lanes to the job's declared subset, capped.
 *
 * An empty subset means "everything I can reach", which is the useful default for a first run.
 * The cap is enforced here rather than at validation because the lane roster changes as bots are
 * installed — a job saved when six lanes existed must not silently start racing twenty.
 *
 * @param available - Lanes the caller may reach.
 * @param wanted - Agent ids from the job spec (empty = all).
 * @returns The lanes to race, at most `BAKE_OFF_DEFAULTS.maxLanes`.
 */
export function selectLanes(available: Lane[], wanted: string[]): Lane[] {
  const chosen = wanted.length ? available.filter((l) => wanted.includes(l.agentId)) : available;
  return chosen.slice(0, BAKE_OFF_DEFAULTS.maxLanes);
}

/** In-flight runs, keyed by job id — a second click must not double-spend. */
const inFlight = new Map<string, string>();

/** @description Whether a job already has a run in flight. @param jobId - Job id. @returns The in-flight run id, or null. */
export function inFlightRun(jobId: string): string | null {
  return inFlight.get(jobId) ?? null;
}

/** Build the judge transport: the quality-judge concierge, exactly as POST /api/judge wires it. */
function judgeFor(ctx: AppContext, ownerSub: string): JudgeService {
  return new JudgeService({
    invoker: async (taskId, prompt) => {
      const result = await ctx.orchestrator.processMessage(taskId, prompt, {
        agenticMode: true, autoApprove: false, source: 'bake-off-judge',
        agentId: QUALITY_JUDGE_AGENT_ID, userSub: ownerSub,
      } as any);
      if (!result.success) throw new Error(result.error || 'judge brain execution failed');
      return String(result.response ?? '');
    },
  });
}

/** Execute one lane and grade it. Never throws — a lane failure is a recorded result. */
async function raceLane(
  ctx: AppContext, judge: JudgeService, job: BakeOffJob, ownerSub: string, lane: Lane,
): Promise<Parameters<typeof insertResult>[3]> {
  const base = { laneBot: lane.bot, laneAgentId: lane.agentId, laneHarness: lane.harness, laneProvider: lane.provider };
  const taskId = `bakeoff-${randomUUID()}`;
  try {
    const res = await executeBotOrInline(ctx, botClient, lane.agentId, {
      text: job.prompt, taskId, workspaceFolderId: 'bake-off', agentId: lane.agentId,
      userSub: ownerSub, direct: true, agenticMode: false,
    } as any);
    const verdict = await judge.grade({
      task: job.prompt, output: String(res.response ?? ''), rubric: job.rubric,
      ...(job.reference ? { reference: job.reference } : {}),
    });
    return {
      ...base, observedModel: res.model ?? null, ok: true, output: String(res.response ?? ''),
      costUsd: res.cost ?? 0, totalTokens: res.usage?.totalTokens ?? 0, durationMs: res.durationMs ?? 0,
      judgeScore: verdict.score, judgeMode: verdict.mode, judgeRationale: verdict.rationale ?? null,
      dimensions: verdict.dimensions ?? null, taskId, error: null,
    };
  } catch (err: any) {
    log.error({ err, stack: err?.stack, lane: lane.bot, jobId: job.id }, 'Bake-off lane failed');
    return { ...base, ok: false, error: String(err?.message ?? err).slice(0, 2000), taskId, costUsd: 0, durationMs: 0 };
  }
}

/**
 * @description Race one job across its lanes out-of-band, persisting each lane as it finishes.
 *
 * Single-flighted per job: a second request while a run is open returns the open run id instead of
 * starting a parallel one, because the failure mode of a "Run" button on a paid multi-lane job is
 * double spend, not a double render.
 *
 * @param ctx - The framework app context (pool + orchestrator).
 * @param ownerSub - The accountable owner; every LLM call is attributed to them.
 * @param job - The job to race.
 * @param lanes - The lanes to race it across (already access-filtered and capped).
 * @returns The run id.
 */
export async function runBakeOff(ctx: AppContext, ownerSub: string, job: BakeOffJob, lanes: Lane[]): Promise<string> {
  const existing = inFlightRun(job.id);
  if (existing) return existing;
  const pool = ctx.pool as Pool;
  const runId = await openRun(pool, ownerSub, job.id, lanes.length);
  inFlight.set(job.id, runId);
  log.info({ ownerSub, jobId: job.id, runId, lanes: lanes.length }, 'Bake-off run started');

  void (async () => {
    const judge = judgeFor(ctx, ownerSub);
    let completed = 0;
    try {
      for (const lane of lanes) {
        const result = await raceLane(ctx, judge, job, ownerSub, lane);
        await insertResult(pool, ownerSub, runId, result);
        if (result.ok) completed += 1;
      }
      await closeRun(pool, runId, 'complete', completed, null);
      log.info({ runId, jobId: job.id, completed, requested: lanes.length }, 'Bake-off run complete');
      await notifyDone(ctx, ownerSub, job, completed, lanes.length);
    } catch (err: any) {
      log.error({ err, stack: err?.stack, runId, jobId: job.id }, 'Bake-off run failed');
      await closeRun(pool, runId, 'failed', completed, String(err?.message ?? err).slice(0, 2000)).catch((e) =>
        log.error({ err: e, stack: e?.stack, runId }, 'Bake-off run close failed'));
    } finally {
      inFlight.delete(job.id);
    }
  })();

  return runId;
}

/**
 * @description Tell the owner their run finished, through the kernel notification router.
 *
 * Best-effort and never fatal: a bake-off whose evidence is safely persisted has succeeded even if
 * the notification transport is down, and swallowing the send silently would be worse than the
 * failed send, so it is logged at ERROR.
 *
 * @param ctx - App context, used to build the framework's wired notification router.
 * @param ownerSub - Who to tell.
 * @param job - The job that finished.
 * @param completed - Lanes that produced a graded result.
 * @param requested - Lanes attempted.
 * @returns Nothing.
 */
async function notifyDone(
  ctx: AppContext, ownerSub: string, job: BakeOffJob, completed: number, requested: number,
): Promise<void> {
  try {
    await buildNotificationRouter(ctx).notify(ownerSub, 'bake-off', {
      subject: `Bake-off finished: ${job.name}`,
      body: `${completed} of ${requested} lane(s) produced a graded result. Open the Bake-Off surface for the cost/quality table and the recommendation.`,
      shortText: `Bake-off "${job.name}": ${completed}/${requested} lanes graded.`,
    });
  } catch (err: any) {
    log.error({ err, stack: err?.stack, ownerSub, jobId: job.id }, 'Bake-off completion notification failed');
  }
}
