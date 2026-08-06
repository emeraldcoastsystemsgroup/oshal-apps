/**
 * Venture Plan - service-authenticated scheduled rebaseline tick.
 *
 * The same deterministic worker is reachable through the service-authenticated route and the
 * manifest's named service-route schedule handler. Neither path is a prompt. HTTP callers must
 * hold service auth; the active manifest registry is the schedule handler's lifecycle authority.
 * Exact execute=true crosses only the outer tick gate and never overrides owner policy.
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Add system-identity policy evaluation, default dry-run tick semantics, sanitized results, and explicit paid execution dispatch.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Export the bounded deterministic manifest schedule handler and share one awaited schema bootstrap with the service route.
 *
 * @module venture-rebaseline-routes
 */

import { Router, type Request, type Response } from 'express';
import type { AppContext } from '@/app/composition/app-context';
import { createChildLogger } from '@/shared/logger';
import { runWithSystemIdentity } from '@/shared/services/database/request-identity';
import {
  defaultRebaselinePolicy, evaluateRebaselinePolicy, RebaselineError,
  type RebaselinePolicy,
} from './venture-rebaseline';
import { startScheduledRebaseline } from './venture-run';
import {
  listEnabledRebaselinePoliciesSystem, type OwnedRebaselinePolicy,
} from './venture-store-rebaseline';
import { ensureVentureSchema } from './venture-schema';

const log = createChildLogger({ module: 'venture-rebaseline-routes' });
let schemaReady: Promise<void> | null = null;

/** Input to one deterministic tick. `execute` must be exactly true to spend. */
export interface RebaselineTickInput {
  atIso: string;
  execute: boolean;
}

/** Sanitized per-venture tick result; an owner subject is never returned. */
export interface RebaselineTickResult {
  ventureId: string;
  outcome: 'disabled' | 'not-due' | 'dry-run' | 'ready' | 'started'
    | 'already-running' | 'already-scheduled' | 'error';
  slot: string | null;
  runId?: string;
  error?: string;
}

/** Kernel-owned input supplied to a named manifest service-route schedule handler. */
interface ManifestScheduleInput {
  scheduleId: string;
  scheduledAtIso: string;
  body: Readonly<Record<string, unknown>>;
}

interface TickDependencies {
  listPolicies: (ctx: AppContext) => Promise<Readonly<OwnedRebaselinePolicy>[]>;
  start: (
    ctx: AppContext, ownerSub: string, ventureId: string, slot: string,
    onDate: string, capMicros: number,
  ) => Promise<{
    runId: string; alreadyRunning: boolean; alreadyScheduled: boolean; phases: string[];
  }>;
  withSystemIdentity: <T>(work: () => Promise<T>) => Promise<T>;
}

const defaultDependencies: TickDependencies = {
  listPolicies: (ctx) => listEnabledRebaselinePoliciesSystem(ctx.pool),
  start: startScheduledRebaseline,
  withSystemIdentity: runWithSystemIdentity,
};

/**
 * Evaluate all enabled policies and optionally start due work. Disabled and
 * dry-run decisions cannot reach the injected start boundary, which is the
 * testable proof that preview mode performs no writes or bot calls.
 */
export async function runDueRebaselineTick(
  ctx: AppContext, input: RebaselineTickInput,
  dependencies: Partial<TickDependencies> = {},
): Promise<RebaselineTickResult[]> {
  const deps = { ...defaultDependencies, ...dependencies };
  // Validate before opening system scope or touching the database.
  evaluateRebaselinePolicy(defaultRebaselinePolicy('timestamp-check'), input.atIso, true);

  return deps.withSystemIdentity(async () => {
    const policies = await deps.listPolicies(ctx);
    const results: RebaselineTickResult[] = [];
    for (const policy of policies) {
      let slot: string | null = null;
      try {
        const decision = evaluateRebaselinePolicy(
          policy as RebaselinePolicy, input.atIso, input.execute !== true,
        );
        slot = decision.slot;
        if (!decision.wouldStart || !decision.slot) {
          results.push({
            ventureId: policy.ventureId, outcome: decision.outcome, slot: decision.slot,
          });
          continue;
        }
        const opened = await deps.start(
          ctx, policy.ownerSub, policy.ventureId, decision.slot,
          decision.onDate, decision.maxCostMicros,
        );
        results.push({
          ventureId: policy.ventureId,
          outcome: opened.alreadyScheduled ? 'already-scheduled'
            : opened.alreadyRunning ? 'already-running' : 'started',
          slot: decision.slot,
          runId: opened.runId,
        });
      } catch (err: any) {
        log.error({
          err, stack: err?.stack, ventureId: policy.ventureId, slot,
        }, 'scheduled rebaseline dispatch failed');
        results.push({
          ventureId: policy.ventureId, outcome: 'error', slot,
          error: err instanceof RebaselineError ? err.code : 'rebaseline_dispatch_failed',
        });
      }
    }
    return results;
  });
}

/**
 * Named deterministic schedule export declared in oshal-app.yaml. The kernel freezes the static
 * body before dispatch and validates this export at activation. The result is deliberately
 * aggregate-only so owner subjects and per-venture details never enter scheduler metadata.
 */
export async function runScheduledRebaselineTick(
  ctx: AppContext,
  input: ManifestScheduleInput,
): Promise<{ summary: string }> {
  await ensureRebaselineSchema(ctx);
  const atIso = typeof input.body.atIso === 'string' ? input.body.atIso : input.scheduledAtIso;
  const execute = input.body.execute === true;
  const results = await runDueRebaselineTick(ctx, { atIso, execute });
  const started = results.filter((result) => result.outcome === 'started').length;
  const errors = results.filter((result) => result.outcome === 'error').length;
  return { summary: `evaluated=${results.length}; started=${started}; errors=${errors}` };
}

/** Build the service-authenticated `/api/venture-rebaseline` router. */
export function createVentureRebaselineRoutes(ctx: AppContext): Router {
  const router = Router();
  void ensureRebaselineSchema(ctx).catch((err: any) => log.error({
    err, stack: err?.stack,
  }, 'venture rebaseline schema bootstrap failed'));

  router.post('/tick', async (req: Request, res: Response) => {
    const startedAt = Date.now();
    const body = (req.body ?? {}) as Record<string, unknown>;
    const atIso = typeof body.atIso === 'string' ? body.atIso : new Date().toISOString();
    const execute = body.execute === true;
    try {
      const results = await runDueRebaselineTick(ctx, { atIso, execute });
      log.info({ execute, evaluated: results.length, durationMs: Date.now() - startedAt },
        'venture rebaseline tick complete');
      res.json({ mode: execute ? 'execute' : 'dry-run', atIso, results });
    } catch (err: any) {
      log.error({ err, stack: err?.stack, durationMs: Date.now() - startedAt },
        'venture rebaseline tick refused');
      if (err instanceof RebaselineError) {
        res.status(400).json({ error: err.code, detail: err.message });
        return;
      }
      res.status(500).json({ error: 'rebaseline_tick_failed' });
    }
  });
  return router;
}

/** Bootstrap the package schema once per loaded module and share failures with every caller. */
function ensureRebaselineSchema(ctx: AppContext): Promise<void> {
  schemaReady ??= ensureVentureSchema(ctx.pool);
  return schemaReady;
}
