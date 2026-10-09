/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Add the Career worker rail: a trusted-service-only POST /complete (manifest mount /api/career-hunter/engine, auth: service) that the multi-user engine calls for every model completion. The caller must present the exact trusted subject and the runner-minted run token of a running engine child that subject owns. Admitted calls run on the dedicated Career bot through executeBotOrInline (direct, non-agentic, the owner's userSub, taskId career-engine-<runId>) under a package-owned semaphore and a per-call deadline, after a preflight that requires a dedicated node endpoint and a fresh career-bot heartbeat; a missing or stale heartbeat or a transport failure answers 503 career-worker-unavailable and records it on the run. The body uses its own content type and ceiling so the kernel's tight global JSON parser never truncates a generation prompt.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Start the per-call deadline when a call is granted a Career bot slot, not when it starts waiting for one. The wait is bounded separately, by the run's cancellation or exit and by its own ceiling (CAREER_WORKER_RAIL_QUEUE_WAIT_MS; 504 career-worker-queue-timeout, never dispatched), and a call whose run ended while it queued is released without reaching the bot. Before this, a scoring batch queued behind the 2-slot semaphore spent its deadline waiting, so calls granted at the edge of the deadline were still billed on the bot and then abandoned with 504, failing a healthy run.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Put this mount on the kernel's signed-package-callbacks rail (1.25.1). Under ADR-149 enforce the application-authorization layer refused every engine-child request with authorization_identity_required before this handler ran, because a service-secret caller carrying an asserted subject has no verified identity; the 1.24.0 rail passed its own tests and could not complete one call on an enforce box. The manifest's callbackVerifier (createCareerRailCallbackVerifier, career-rail-grants.ts) now runs first and verifies the per-run grant the runner minted; the kernel refreshes the grant owner and requires career.execute before this router runs as that owner. The handler reads the run the verifier admitted and the exact signed body it read, and requires the kernel's request identity to be that run's owner; the service secret, the trusted-subject header and the bearer run token are gone from the contract.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Register the catalog's `career` resource adapter from this factory too: the kernel resolves career.execute for an admitted grant and then asks the adapter, and this mount may be the only one activated (the kernel boundary suite mounts it alone), so the rail must not depend on the studio mount having registered it first.
 */
/**
 * Career worker rail — the engine's only model path in multi-user mode.
 *
 * ADR-036: the bot owns the domain's reasoning. The package engine keeps its deterministic work
 * (corpus, SQLite/Postgres, PDF rendering) on the controller, and every model call it makes is a
 * loopback POST here. This route never calls a provider itself: it hands the text to the
 * accountable Career bot on its own node, where the kernel's budget gate and cost settlement run.
 *
 * @module career-worker-rail
 */
import { Router, type Request, type Response } from 'express';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import {
  BotNodeClient,
  createRegistryEndpointResolver,
  type BotNodeRequest,
  type BotNodeResponse,
} from '@/features/agent-management';
import { executeBotOrInline } from '@/app/routes/inline-bot-execution';
import { getRequestIdentity } from '@/shared/services/database/request-identity';
import { admittedRunOf, createCareerRailCallbackVerifier, type EngineRunRecord } from './career-rail-grants';
import { registerCareerAuthorization } from './career-authorization';

// The manifest's callbackVerifier is looked up on THIS route module, beside the factory.
export { createCareerRailCallbackVerifier };

interface RailLimits {
  concurrency: number;
  deadlineMs: number;
  queueWaitMs: number;
  heartbeatStaleMs: number;
  maxBodyBytes: number;
}

const engineRuns = require('../lib/career-engine-runs') as {
  railLimits: () => RailLimits;
  noteRailCall: (runId: string) => void;
  markRailFailure: (runId: string, reason: string) => void;
};

const logger = createChildLogger({ module: 'career-worker-rail' });
const CAREER_AGENT_ID = 'cb000000-0000-0000-0000-000000000001';
const JSON_ONLY = 'Respond with ONLY a single JSON object, no prose, no code fence.';

interface RailInput { system: string; prompt: string; jsonMode: boolean }
interface RailOutcome { status: number; body: Record<string, unknown> }
type BodyResult = { ok: true; value: unknown } | { ok: false; outcome: RailOutcome };
type WorkerCall = (run: EngineRunRecord, subject: string, input: RailInput) => Promise<BotNodeResponse>;

interface RailDeps {
  ctx: AppContext;
  botClient: BotNodeClient;
  limits: RailLimits;
  semaphore: RailSemaphore;
  execute: WorkerCall;
}

/** Package-owned admission: at most `limit` completions occupy the Career bot at once. */
class RailSemaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  /** Wait for a slot until the signal aborts; resolves false when the wait was abandoned. */
  acquire(signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return Promise.resolve(false);
    if (this.active < this.limit) {
      this.active += 1;
      return Promise.resolve(true);
    }
    return new Promise((resolve) => {
      const grant = (): void => {
        signal.removeEventListener('abort', abandon);
        this.active += 1;
        resolve(true);
      };
      const abandon = (): void => {
        const index = this.waiters.indexOf(grant);
        if (index >= 0) this.waiters.splice(index, 1);
        resolve(false);
      };
      this.waiters.push(grant);
      signal.addEventListener('abort', abandon, { once: true });
    });
  }

  /** Return a slot once the worker call has actually settled, then admit the next waiter. */
  release(): void {
    this.active = Math.max(0, this.active - 1);
    const next = this.waiters.shift();
    if (next) next();
  }
}

/** Build a refused body-read result. */
function refused(status: number, error: string): BodyResult {
  return { ok: false, outcome: { status, body: { ok: false, error } } };
}

/**
 * Parse the signed body the verifier read (the rail's own content type and byte ceiling are
 * enforced there, because the signature covers those exact bytes) as the rail's JSON document.
 */
function parseRailJson(req: Request): BodyResult {
  if (!Buffer.isBuffer(req.body)) return refused(400, 'body-unreadable');
  try {
    return { ok: true, value: JSON.parse(req.body.toString('utf8')) };
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'career rail body is not JSON');
    return refused(400, 'invalid-json');
  }
}

/**
 * The run the kernel's callback rail admitted for this request, which must also be the owner the
 * kernel authorized (its request identity). Both fail closed: a request that reached this router
 * without the verifier, or under another identity, is answered without touching the bot.
 */
function admittedRun(req: Request, res: Response): EngineRunRecord | null {
  const run = admittedRunOf(req);
  if (!run) {
    logger.warn({ path: req.path }, 'career rail route reached without an admitted grant');
    res.status(401).json({ ok: false, error: 'rail-grant-required' });
    return null;
  }
  const identity = getRequestIdentity();
  if (!identity || identity.sub !== run.owner) {
    logger.warn({ runId: run.runId }, 'career rail request identity is not the run owner');
    res.status(403).json({ ok: false, error: 'run-owner-mismatch' });
    return null;
  }
  return run;
}

/** Validate the completion document the engine sends; anything else is refused. */
function railInput(value: unknown): RailInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const doc = value as Record<string, unknown>;
  const system = doc.system === undefined ? '' : doc.system;
  if (typeof system !== 'string' || typeof doc.prompt !== 'string' || !doc.prompt.trim()) return null;
  if (doc.jsonMode !== undefined && typeof doc.jsonMode !== 'boolean') return null;
  return { system, prompt: doc.prompt, jsonMode: doc.jsonMode !== false };
}

/** Compose the one text the Career bot answers, in the order the engine's prompts assume. */
function railPrompt(input: RailInput): string {
  const parts = input.system ? [input.system, input.prompt] : [input.prompt];
  if (input.jsonMode) parts.push(JSON_ONLY);
  return parts.join('\n\n');
}

/** The accountable, owner-scoped bot request: direct, non-agentic, one task per engine run. */
function workerRequest(run: EngineRunRecord, subject: string, input: RailInput): BotNodeRequest {
  return {
    text: railPrompt(input),
    taskId: `career-engine-${run.runId}`,
    workspaceFolderId: `career-engine-${subject}`,
    agentId: CAREER_AGENT_ID,
    direct: true,
    agenticMode: false,
    userSub: subject,
  };
}

/** Require a dedicated Career node and a fresh, online heartbeat before any model-bearing call. */
async function workerPreflight(deps: RailDeps): Promise<{ ok: true } | { ok: false; detail: string }> {
  if (!deps.botClient.hasEndpoint(CAREER_AGENT_ID)) return { ok: false, detail: 'no-dedicated-node' };
  const registry = deps.ctx.swarm?.runtimeRegistryService;
  if (!registry) return { ok: false, detail: 'heartbeat-registry-unavailable' };
  let registration: Awaited<ReturnType<typeof registry.getAgentRegistration>>;
  try {
    registration = await registry.getAgentRegistration(CAREER_AGENT_ID);
  } catch (err) {
    logger.error({ err }, 'career worker heartbeat read failed');
    return { ok: false, detail: 'heartbeat-read-failed' };
  }
  if (!registration || registration.status !== 'online') return { ok: false, detail: 'heartbeat-missing' };
  const age = Date.now() - Date.parse(registration.heartbeatAt);
  if (!Number.isFinite(age) || age > deps.limits.heartbeatStaleMs) return { ok: false, detail: 'heartbeat-stale' };
  return { ok: true };
}

/**
 * One abort signal bounded by `limitMs` and by the run's own cancellation or exit. The rail uses
 * two of these per call: one for the wait for a slot, one for the call once the slot is granted.
 */
function boundedSignal(run: EngineRunRecord, limitMs: number) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, limitMs);
  const onRunAbort = (): void => controller.abort();
  if (run.abort.signal.aborted) controller.abort();
  else run.abort.signal.addEventListener('abort', onRunAbort, { once: true });
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => { clearTimeout(timer); run.abort.signal.removeEventListener('abort', onRunAbort); },
  };
}

/** Resolve with the work's value, or `done: false` when the signal aborts first. */
function raceAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<{ done: true; value: T } | { done: false }> {
  if (signal.aborted) return Promise.resolve({ done: false });
  return new Promise((resolve, reject) => {
    const onAbort = (): void => resolve({ done: false });
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(
      (value) => { signal.removeEventListener('abort', onAbort); resolve({ done: true, value }); },
      (err) => { signal.removeEventListener('abort', onAbort); reject(err); },
    );
  });
}

/** Map a kernel refusal or transport failure onto the rail's stable failure codes. */
function failureOf(err: unknown): RailOutcome {
  const e = err as { code?: unknown; statusCode?: unknown } | null;
  if (e?.code === 'budget_cap_exceeded' || e?.statusCode === 402) {
    return { status: 402, body: { ok: false, error: 'budget-cap-exceeded' } };
  }
  if (e?.code === 'NO_HOSTED_BRAIN') return { status: 424, body: { ok: false, error: 'no-configured-brain' } };
  if (e?.statusCode === 403) return { status: 403, body: { ok: false, error: 'not-entitled' } };
  return { status: 503, body: { ok: false, error: 'career-worker-unavailable' } };
}

/** Distinguish an owner's cancellation from the per-call deadline. */
function abandonedOutcome(run: EngineRunRecord, timedOut: boolean): RailOutcome {
  if (!timedOut && (run.cancelled || run.abort.signal.aborted)) {
    return { status: 409, body: { ok: false, error: 'run-cancelled' } };
  }
  return { status: 504, body: { ok: false, error: 'career-worker-timeout' } };
}

/** A call that never got a slot: the queue ceiling passed, or its run was cancelled or ended. */
function notAdmittedOutcome(run: EngineRunRecord, waitTimedOut: boolean): RailOutcome {
  if (!waitTimedOut) return abandonedOutcome(run, false);
  return { status: 504, body: { ok: false, error: 'career-worker-queue-timeout' } };
}

/** Turn the bot's answer into the rail response the engine parses. */
function answerOf(result: BotNodeResponse): RailOutcome {
  if (!result || result.success === false) {
    return { status: 502, body: { ok: false, error: 'career-worker-error' } };
  }
  return {
    status: 200,
    body: { ok: true, text: String(result.response ?? ''), model: result.model ?? null, provider: result.provider ?? null },
  };
}

/**
 * Wait for a Career bot slot. The wait has its own ceiling and ends early when the run is
 * cancelled or exits; it never spends the per-call deadline. Resolves null once a slot is held.
 */
async function admitCall(deps: RailDeps, run: EngineRunRecord): Promise<RailOutcome | null> {
  const wait = boundedSignal(run, deps.limits.queueWaitMs);
  try {
    if (await deps.semaphore.acquire(wait.signal)) return null;
    return notAdmittedOutcome(run, wait.timedOut());
  } finally {
    wait.dispose();
  }
}

/** Admit one call under the semaphore, then run it on the Career bot under a deadline that starts at the grant. */
async function executeOnWorker(
  deps: RailDeps, run: EngineRunRecord, subject: string, input: RailInput,
): Promise<RailOutcome> {
  const notAdmitted = await admitCall(deps, run);
  if (notAdmitted) return notAdmitted;
  const call = boundedSignal(run, deps.limits.deadlineMs);
  try {
    if (call.signal.aborted) {
      // The run ended between the grant and here: hand the slot back and never dispatch.
      deps.semaphore.release();
      return abandonedOutcome(run, call.timedOut());
    }
    const work = deps.execute(run, subject, input).finally(() => deps.semaphore.release());
    const raced = await raceAbort(work, call.signal);
    if (!raced.done) {
      work.catch((err) => logger.error({ err, runId: run.runId }, 'abandoned career rail call failed'));
      return abandonedOutcome(run, call.timedOut());
    }
    return answerOf(raced.value);
  } catch (err) {
    logger.error({ err, runId: run.runId }, 'career rail worker call failed');
    return failureOf(err);
  } finally {
    call.dispose();
  }
}

/** Preflight the worker, then execute; a failed preflight never reaches the bot. */
async function railOutcome(
  deps: RailDeps, run: EngineRunRecord, subject: string, input: RailInput,
): Promise<RailOutcome> {
  const preflight = await workerPreflight(deps);
  if (!preflight.ok) {
    logger.warn({ runId: run.runId, detail: preflight.detail }, 'career worker unavailable');
    return { status: 503, body: { ok: false, error: 'career-worker-unavailable', detail: preflight.detail } };
  }
  return executeOnWorker(deps, run, subject, input);
}

/** Take the admitted run, validate the signed body, and answer one completion as its owner. */
async function handleComplete(deps: RailDeps, req: Request, res: Response): Promise<void> {
  const startedAt = Date.now();
  const run = admittedRun(req, res);
  if (!run) return;
  const body = parseRailJson(req);
  const input = body.ok ? railInput(body.value) : null;
  if (!body.ok || !input) {
    const outcome = body.ok ? { status: 400, body: { ok: false, error: 'invalid-completion' } } : body.outcome;
    res.status(outcome.status).json(outcome.body);
    return;
  }
  engineRuns.noteRailCall(run.runId);
  const outcome = await railOutcome(deps, run, run.owner, input);
  if (outcome.status !== 200) engineRuns.markRailFailure(run.runId, String(outcome.body.error));
  logger.info({ runId: run.runId, verb: run.verb, status: outcome.status, durationMs: Date.now() - startedAt },
    'career rail completion');
  res.status(outcome.status).json(outcome.body);
}

/**
 * @description Mounts the Career worker rail (manifest `auth: public` + `callbackVerifier` at
 * /api/career-hunter/engine, on the kernel's signed-package-callbacks rail). The kernel admits
 * POST only, runs createCareerRailCallbackVerifier first, refreshes the grant owner and requires
 * career.execute; the handler then requires the admitted run and that same owner as the request
 * identity, so browsers, anonymous callers and any request without a live per-run grant are
 * refused before the bot is reached.
 * @param ctx - Kernel context: the accounted bot rail, budget gate and heartbeat registry.
 * @returns The Express router exposing POST /complete.
 */
export function createCareerWorkerRailRoutes(ctx: AppContext): Router {
  registerCareerAuthorization(ctx);
  const limits = engineRuns.railLimits();
  const botClient = new BotNodeClient(createRegistryEndpointResolver(), limits.deadlineMs);
  const deps: RailDeps = {
    ctx, botClient, limits,
    semaphore: new RailSemaphore(limits.concurrency),
    execute: (run, subject, input) => executeBotOrInline(ctx, botClient, CAREER_AGENT_ID, workerRequest(run, subject, input)),
  };
  const router = Router();
  router.post('/complete', (req: Request, res: Response) => {
    handleComplete(deps, req, res).catch((err) => {
      logger.error({ err }, 'career rail request failed');
      if (!res.headersSent) res.status(500).json({ ok: false, error: 'rail-failed' });
    });
  });
  return router;
}
