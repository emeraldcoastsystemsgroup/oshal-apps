/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Extract the asynchronous engine boundary with bounded output, explicit failures, and shared single-flight admission.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Add finite deadlines, process-tree termination, truthful start acknowledgement, and split UTF-8 reconstruction.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Add atomic multi-resource preclaims and child-lifecycle adoption for durable route transactions.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | Resolve brokered credential sandboxes through canonical contained user-store paths.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | Enforce the same heartbeat-backed filesystem lease across API replicas and direct package CLI children, with token-safe child adoption and optional background completion notification.
 * 6 | maintainer@emeraldcoastsystemsgroup.com   | Expose exact command preclaims and shared process-tree termination, retain leases through asynchronous completion observers, and return structured timeout facts.
 * 7 | maintainer@emeraldcoastsystemsgroup.com   | Document the exported process, admission, environment, timeout, and lifecycle contracts used by sibling route modules.
 * 8 | maintainer@emeraldcoastsystemsgroup.com   | Put the absolute parent deadline in each adopted lease proof so detached wrappers retain bounded execution after an API restart.
 * 9 | maintainer@emeraldcoastsystemsgroup.com   | Fence the complete child process tree if a filesystem heartbeat reports that its lease generation was lost.
 * 10 | maintainer@emeraldcoastsystemsgroup.com  | Move the engine ceiling into shared filesystem capacity slots and expose a non-engine upload-body lane.
 * 11 | maintainer@emeraldcoastsystemsgroup.com  | Clamp API and direct-CLI capacity configuration with the same missing, invalid, and out-of-range semantics.
 * 12 | maintainer@emeraldcoastsystemsgroup.com  | Preserve shared-capacity exhaustion as busy so HTTP callers return 429 instead of duplicate-work 409.
 * 13 | maintainer@emeraldcoastsystemsgroup.com  | Expose a capacity-free storage lease for short cross-process route transactions that must serialize without launching an engine child.
 * 14 | maintainer@emeraldcoastsystemsgroup.com  | Preserve one absolute command deadline from controller admission through brokerage, wrapper adoption, and engine termination.
 * 15 | maintainer@emeraldcoastsystemsgroup.com  | Bound multipart bodies in a separate cross-process capacity namespace with independent default and clamp semantics.
 * 16 | maintainer@emeraldcoastsystemsgroup.com  | Bound asynchronous completion observers and abort them before releasing child ownership after timeout.
 */
/**
 * Career Hunter engine process boundary.
 *
 * Mounted HTTP routes must never synchronously wait for the jobhunter engine: several commands
 * perform network and LLM work, and one request previously froze the entire controller for more
 * than an hour. This module owns CLI resolution, scoped environments, concurrency, bounded output,
 * spawn errors, and finite process-tree termination for every engine invocation.
 *
 * @module career-engine-runner
 */
import fs from 'fs';
import path from 'path';
import { spawn, type ChildProcess, type SpawnOptions } from 'child_process';
import { createChildLogger } from '@/shared/logger';
import { careerTenant, userPaths } from './career-user-store';

const logger = createChildLogger({ module: 'career-engine-runner' });
const TENANT = careerTenant();
const STDOUT_LIMIT = 200_000;
const STDERR_LIMIT = 4_000;
const DEFAULT_COMPLETION_TIMEOUT_MS = 10_000;
interface ActiveClaim {
  resources: string[];
  dispatched: boolean;
  diskLease: FileRunLease;
  lost?: boolean;
  proc?: ChildProcess;
}

interface FileRunLease {
  owned: boolean;
  token: string;
  resources: string[];
}

const runLocks = require('../lib/career-run-lock') as {
  RUN_LOCK_ADOPTION_ENV: string;
  buildRunResources: (
    userSub: string, verb: string, slot?: string, globalSlots?: string[],
  ) => string[];
  tryAcquireRunLocks: (
    root: string, tenant: string, resources: string[], options?: Record<string, unknown>,
  ) => { status: 'ok'; lease: FileRunLease } | { status: 'inflight' | 'busy' };
  serializeRunLockAdoption: (lease: FileRunLease, deadlineAt: number) => string;
  releaseRunLocks: (lease: FileRunLease) => void;
};

const resourcesInFlight = new Map<string, symbol>();
const claimsInFlight = new Map<symbol, ActiveClaim>();

/** Resolve the shared engine ceiling consistently with direct package CLI admission. */
function configuredMaxRuns(): number {
  const raw = process.env.CAREER_HUNTER_MAX_RUNS;
  const parsed = raw?.trim() ? Number(raw) : 3;
  const configured = Number.isFinite(parsed) ? Math.floor(parsed) : 3;
  return Math.max(1, Math.min(64, configured));
}

/** Resolve the independent upload-body ceiling without deriving it from engine concurrency. */
function configuredMaxUploadBodies(): number {
  const raw = process.env.CAREER_HUNTER_MAX_UPLOAD_BODIES;
  const parsed = raw?.trim() ? Number(raw) : 2;
  const configured = Number.isFinite(parsed) ? Math.floor(parsed) : 2;
  return Math.max(1, Math.min(16, configured));
}

const MAX_CONCURRENT_RUNS = configuredMaxRuns();
const MAX_CONCURRENT_UPLOAD_BODIES = configuredMaxUploadBodies();
const DEFAULT_TIMEOUT_MS = Math.min(
  24 * 60 * 60 * 1_000,
  Math.max(1_000, Number(process.env.CAREER_HUNTER_CLI_TIMEOUT_MS) || 2 * 60 * 60 * 1_000),
);
const SAFE_INHERITED_ENV_KEYS = new Set([
  'PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP', 'TMPDIR',
  'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'LANG', 'LC_ALL', 'TZ',
  'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
  'REQUESTS_CA_BUNDLE', 'NODE_EXTRA_CA_CERTS', 'DATABASE_URL',
  'PLAYWRIGHT_CHROMIUM_PATH', 'CHROMIUM_PATH', 'JOBHUNTER_STORE', 'JOBHUNTER_PYTHON',
  'JOBHUNTER_APP_DIR', 'JOBHUNTER_CAREER_DB_DEFAULT', 'JOBHUNTER_UA', 'JOBHUNTER_TIMEOUT',
  'JOBHUNTER_DELAY', 'JOBHUNTER_RETRIES', 'JOBHUNTER_ANTHROPIC_MODEL',
  'JOBHUNTER_SCORE_MODEL', 'JOBHUNTER_OPENAI_MODEL', 'JOBHUNTER_RESUME_PREFIX',
  'CAREER_HUNTER_MAX_RUNS',
]);

/** @description Bounded result returned after an engine child reaches a terminal state. */
export interface CliResult {
  ok: boolean;
  out: string;
  err: string;
  timedOut?: boolean;
  limitReason?: 'inflight' | 'busy';
}

/** @description Acknowledgement returned only after a background engine child spawns. */
export interface CliStartResult {
  started: boolean;
  err?: string;
  limitReason?: 'inflight' | 'busy';
  timedOut?: boolean;
}

/** @description Admission outcome shared by preclaims and immediate engine dispatch. */
export type RunClaim = 'ok' | 'inflight' | 'busy';

/** @description Opaque ownership proof; only the exact successful claimant may release or dispatch it. */
export type RunLease =
  | { status: 'ok'; token: symbol }
  | { status: Exclude<RunClaim, 'ok'> };

/** @description Injectable child-process boundary used by production launches and deterministic tests. */
export type SpawnProcess = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => ChildProcess;

/** @description Terminal lifecycle facts delivered to an acknowledged background caller. */
export interface CliCompletion {
  code: number | null;
  timedOut: boolean;
  ok: boolean;
}

/** @description Optional admission, process, and lifecycle controls for one engine invocation. */
export interface CliRunOptions {
  slot?: string;
  timeoutMs?: number;
  /** Internal absolute epoch deadline used to retain the original admission budget. */
  deadlineAt?: number;
  spawnProcess?: SpawnProcess;
  /** Process-global resource slots acquired atomically with the per-user slot. */
  globalSlots?: string[];
  /** Ownership proof for a caller that reserved resources before changing durable state. */
  preclaimed?: RunLease;
  /** Release a preclaimed lease when the child exits; used by acknowledged background work. */
  adoptPreclaim?: boolean;
  /** Observe the final background child state without holding the HTTP request open. */
  onComplete?: (completion: CliCompletion, signal: AbortSignal) => void | Promise<void>;
  /** Internal observer ceiling; completion work must never retain an engine lease indefinitely. */
  completionTimeoutMs?: number;
}

interface ActiveCli {
  proc: ChildProcess;
  timedOut: () => boolean;
}

interface LaunchClaim {
  lease: RunLease & { status: 'ok' };
  automatic: boolean;
}

type CapacityLane = 'engine' | 'upload-body' | 'none';

/**
 * @description Resolves an operator override, the packaged CLI, then the legacy carve location so
 * upgrades use package-owned code while an explicit deployment override remains testable.
 * @returns Absolute Career engine wrapper path.
 */
export function resolveEngineCli(): string {
  if (process.env.JOBHUNTER_CLI) return process.env.JOBHUNTER_CLI;
  const packaged = path.resolve(__dirname, '..', 'bin', 'oshal-jobhunter.js');
  const legacy = path.resolve(process.cwd(), 'scripts', 'oshal-jobhunter.js');
  return [packaged, legacy].find((candidate) => fs.existsSync(candidate)) || packaged;
}

/** Resolve the configured Career data root once per claim so tests and runtime overrides agree. */
function careerStoreRoot(): string {
  return process.env.JOBHUNTER_STORE_ROOT
    || path.resolve(process.cwd(), 'apps', 'career-hunter', 'data');
}

/** Copy only runtime/config values the packaged engine needs, never controller credentials. */
function inheritedCliEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (SAFE_INHERITED_ENV_KEYS.has(key.toUpperCase()) && value !== undefined) env[key] = value;
  }
  return env;
}

/**
 * @description Builds an identity-locked child environment containing only engine configuration,
 * canonical storage paths, and credentials explicitly brokered for this caller.
 * @param userSub - Authenticated raw OIDC subject retained for engine authorization.
 * @param extra - Per-command inputs and caller-scoped brokered credentials.
 * @returns Least-privilege child process environment.
 */
export function buildCareerEngineProcessEnv(
  userSub: string,
  extra: Record<string, string> = {},
): NodeJS.ProcessEnv {
  const storeRoot = careerStoreRoot();
  const disabledAuthRoot = path.join(userPaths(userSub).userDir, '.brokered-auth-only');
  return {
    ...inheritedCliEnv(),
    ...extra,
    OSHAL_USER_SUB: userSub,
    OSHAL_TENANT: TENANT,
    JOBHUNTER_STORE_ROOT: storeRoot,
    CLAUDE_CONFIG_DIR: path.join(disabledAuthRoot, 'claude'),
    CODEX_HOME: path.join(disabledAuthRoot, 'codex'),
  };
}

/** Retain only the diagnostic tail so a noisy engine cannot grow the API heap without bound. */
function appendTail(current: string, chunk: unknown, limit: number): string {
  const next = current + String(chunk);
  return next.length > limit ? next.slice(-limit) : next;
}

/** Select the independent cross-process capacity namespace required by one admission class. */
function capacityLeaseOptions(lane: CapacityLane): Record<string, unknown> {
  if (lane === 'engine') return { capacitySlots: MAX_CONCURRENT_RUNS, capacityGroup: 'engine' };
  if (lane === 'upload-body') {
    return { capacitySlots: MAX_CONCURRENT_UPLOAD_BODIES, capacityGroup: 'upload-body' };
  }
  return {};
}

/** Acquire every resource and its selected cross-process capacity slot atomically. */
function acquireResources(resources: string[], capacityLane: CapacityLane = 'engine'): RunLease {
  if (resources.some((resource) => resourcesInFlight.has(resource))) return { status: 'inflight' };
  let diskResult: ReturnType<typeof runLocks.tryAcquireRunLocks>;
  let claimId: symbol | undefined;
  try {
    diskResult = runLocks.tryAcquireRunLocks(careerStoreRoot(), TENANT, resources, {
      ...capacityLeaseOptions(capacityLane),
      onError: (err: unknown) => logger.error({ err }, 'career filesystem lease heartbeat failed'),
      onLost: (err: unknown) => {
        const claim = claimId ? claimsInFlight.get(claimId) : undefined;
        if (claim) claim.lost = true;
        if (claim?.proc) terminateProcessTree(claim.proc);
        logger.error({ err }, 'career filesystem lease lost; child fenced');
      },
    });
  } catch (err) {
    logger.error({ err }, 'career filesystem lease admission failed');
    return { status: 'busy' };
  }
  if (diskResult.status !== 'ok') return { status: diskResult.status };
  claimId = Symbol('career-run');
  resources.forEach((resource) => resourcesInFlight.set(resource, claimId));
  claimsInFlight.set(claimId, { resources, dispatched: false, diskLease: diskResult.lease });
  return { status: 'ok', token: claimId };
}

/**
 * @description Releases only the in-memory and filesystem generation owned by an opaque lease;
 * duplicate or stale releases cannot free a newer claimant.
 * @param lease - Opaque lease returned by a successful preclaim or launch.
 * @returns Nothing after owned resources have been released or the stale call is ignored.
 */
export function releaseRun(lease: RunLease): void {
  if (lease.status !== 'ok') return;
  const claim = claimsInFlight.get(lease.token);
  if (!claim) return;
  for (const resource of claim.resources) {
    if (resourcesInFlight.get(resource) === lease.token) resourcesInFlight.delete(resource);
  }
  claimsInFlight.delete(lease.token);
  runLocks.releaseRunLocks(claim.diskLease);
}

/** Resolve the canonical user-store slot plus shared resources inferred from the command verb. */
function runResources(userSub: string, verb: string, slot: string, options: CliRunOptions): string[] {
  return runLocks.buildRunResources(userSub, verb, slot, options.globalSlots || []);
}

/** Consume a preclaim once and prove that it owns this exact resource set. */
function consumePreclaim(lease: RunLease, resources: string[]): boolean {
  if (lease.status !== 'ok') return false;
  const claim = claimsInFlight.get(lease.token);
  if (!claim || claim.lost || claim.dispatched || claim.resources.length !== resources.length) return false;
  if (resources.some((resource) => resourcesInFlight.get(resource) !== lease.token)) return false;
  claim.dispatched = true;
  return true;
}

/**
 * @description Claims one canonical per-user slot before a route mutates durable state.
 * @param userSub - Authenticated raw OIDC subject that owns the store.
 * @param slot - Stable mutation lane shared by every operation that can conflict.
 * @returns Opaque lease proof, or an inflight/busy admission outcome.
 */
export function tryAcquireRun(userSub: string, slot: string): RunLease {
  return acquireResources(runLocks.buildRunResources(userSub, '', slot));
}

/**
 * @description Claims a named per-user storage transaction lane without consuming an engine
 * capacity slot. Callers must release the returned lease in a finally block.
 * @param userSub - Authenticated raw OIDC subject that owns the durable state.
 * @param slot - Stable storage transaction lane shared by every conflicting mutation.
 * @returns Opaque storage lease proof, or an inflight/busy admission outcome.
 */
export function tryAcquireStorageRun(userSub: string, slot: string): RunLease {
  return acquireResources(runLocks.buildRunResources(userSub, '', slot), 'none');
}

/**
 * @description Claims only a per-user multipart body lane, leaving scarce engine capacity free
 * until a complete validated upload is ready to mutate durable state and launch ingestion.
 * @param userSub - Authenticated raw OIDC subject that owns the incoming body.
 * @returns Opaque upload lease proof, an inflight duplicate, or global busy admission outcome.
 */
export function tryAcquireUploadRun(userSub: string): RunLease {
  return acquireResources(runLocks.buildRunResources(userSub, '', 'upload-body'), 'upload-body');
}

/**
 * @description Atomically preclaims the exact canonical resource set launchCli would use for a
 * command, allowing callers to reject duplicate work before database or credential brokerage.
 * @param userSub - Authenticated raw OIDC subject that owns the user store.
 * @param args - Engine verb and arguments whose first item determines shared-corpus ownership.
 * @param options - Slot and global-slot overrides that will also be passed to the eventual launch.
 * @returns Opaque lease proof, or an inflight/busy admission outcome.
 */
export function tryAcquireCliRun(
  userSub: string, args: string[], options: CliRunOptions = {},
): RunLease {
  const slot = options.slot || args.slice(0, 2).join(':') || 'engine';
  return acquireResources(runResources(userSub, args[0] || '', slot, options));
}

/**
 * @description Terminates the wrapper and every Python/browser descendant so timeouts and board
 * reaping cannot leave mutation-capable orphan processes behind.
 * @param proc - Root child process whose complete platform-specific tree must be terminated.
 * @returns Nothing; already-exited or concurrently-exiting processes are harmless no-ops.
 */
export function terminateProcessTree(proc: ChildProcess): void {
  if (!proc.pid || proc.exitCode !== null) return;
  if (process.platform === 'win32') {
    const killer = spawn('taskkill.exe', ['/PID', String(proc.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    const fallback = () => { try { proc.kill('SIGKILL'); } catch { /* already gone */ } };
    killer.once('error', fallback);
    killer.once('close', (code) => { if (code !== 0) fallback(); });
    return;
  }
  try { process.kill(-proc.pid, 'SIGKILL'); }
  catch { try { proc.kill('SIGKILL'); } catch { /* already gone */ } }
}

/** Normalize a configured duration without allowing an accidental unbounded or day-long typo. */
function configuredTimeoutFor(options: CliRunOptions): number {
  if (options.timeoutMs === undefined) return DEFAULT_TIMEOUT_MS;
  return Math.min(24 * 60 * 60 * 1_000, Math.max(1_000, Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS));
}

/**
 * @description Pins a command to one absolute deadline, retaining an earlier caller deadline while
 * clamping newly configured work to the runner's supported maximum.
 * @param options - Relative timeout or previously pinned absolute deadline.
 * @returns A shallow options copy carrying the effective absolute epoch-millisecond deadline.
 */
export function withCliDeadline(options: CliRunOptions): CliRunOptions & { deadlineAt: number } {
  const now = Date.now();
  const configured = now + configuredTimeoutFor(options);
  const supplied = Number(options.deadlineAt);
  const deadlineAt = Number.isFinite(supplied) && supplied > 0
    ? Math.min(Math.floor(supplied), configured) : configured;
  return { ...options, deadlineAt };
}

/** Return remaining milliseconds for a pinned deadline or a fresh relative runner timeout. */
function timeoutFor(options: CliRunOptions): number {
  if (Number.isFinite(options.deadlineAt) && Number(options.deadlineAt) > 0) {
    return Math.max(0, Math.floor(Number(options.deadlineAt) - Date.now()));
  }
  return configuredTimeoutFor(options);
}

/** Reserve or consume the exact resource set required by one child launch. */
function claimForLaunch(userSub: string, args: string[], options: CliRunOptions): LaunchClaim | CliResult {
  const slot = options.slot || args.slice(0, 2).join(':') || 'engine';
  const resources = runResources(userSub, args[0] || '', slot, options);
  if (options.preclaimed && !consumePreclaim(options.preclaimed, resources)) {
    return { ok: false, out: '', err: 'preclaimed career engine slot is not held' };
  }
  const lease = options.preclaimed || acquireResources(resources);
  if (lease.status !== 'ok') {
    return { ok: false, out: '', err: `career engine ${lease.status}`, limitReason: lease.status };
  }
  if (!options.preclaimed) consumePreclaim(lease, resources);
  return { lease, automatic: !options.preclaimed };
}

/** Build the child environment with a proof for only the exact filesystem locks it inherits. */
function adoptedChildEnv(
  userSub: string, extraEnv: Record<string, string>, lease: RunLease & { status: 'ok' },
  options: CliRunOptions,
): NodeJS.ProcessEnv {
  const claim = claimsInFlight.get(lease.token);
  if (!claim) throw new Error('career engine filesystem lease is not held');
  const deadlineAt = options.deadlineAt || (Date.now() + configuredTimeoutFor(options));
  const adoption = runLocks.serializeRunLockAdoption(claim.diskLease, Math.floor(deadlineAt));
  return buildCareerEngineProcessEnv(userSub, {
    ...extraEnv,
    [runLocks.RUN_LOCK_ADOPTION_ENV]: adoption,
  });
}

/** Clamp observer work separately from the much longer engine command deadline. */
function completionTimeoutFor(options: CliRunOptions): number {
  if (options.completionTimeoutMs === undefined) return DEFAULT_COMPLETION_TIMEOUT_MS;
  const supplied = Number(options.completionTimeoutMs);
  if (!Number.isFinite(supplied)) return DEFAULT_COMPLETION_TIMEOUT_MS;
  return Math.max(50, Math.min(60_000, Math.floor(supplied)));
}

/** Notify one background observer under an abortable deadline while its generation is still held. */
async function notifyBackgroundCompletion(
  args: string[], options: CliRunOptions, completion: CliCompletion,
): Promise<void> {
  logger.info({ verb: args.slice(0, 2), ...completion }, 'career CLI finished');
  if (!options.onComplete) return;
  const controller = new AbortController();
  const timeoutMs = completionTimeoutFor(options);
  let timer: NodeJS.Timeout | undefined;
  try {
    const deadline = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => { controller.abort(); resolve('timeout'); }, timeoutMs);
    });
    const observer = Promise.resolve(options.onComplete(completion, controller.signal))
      .then(() => 'complete' as const);
    if (await Promise.race([observer, deadline]) === 'timeout') {
      logger.error({ timeoutMs }, 'career CLI completion observer timed out');
    }
  } catch (err) {
    logger.error({ err }, 'career CLI completion observer failed');
  } finally {
    if (timer) clearTimeout(timer);
    controller.abort();
  }
}

/** Release automatic or adopted ownership, never an unspawned caller-owned preclaim. */
function releaseChildClaim(claim: LaunchClaim, options: CliRunOptions, spawned: boolean): void {
  if (claim.automatic || (options.adoptPreclaim && spawned)) releaseRun(claim.lease);
}

/** Bind deadline, completion notification, and exactly-once lease cleanup to one child. */
function bindChildLease(
  proc: ChildProcess, claim: LaunchClaim, args: string[], options: CliRunOptions,
  notifyCompletion: boolean,
): () => boolean {
  let didTimeout = false;
  let spawned = false;
  let settled = false;
  proc.once('spawn', () => { spawned = true; });
  const timer = setTimeout(() => { didTimeout = true; terminateProcessTree(proc); }, timeoutFor(options));
  const settle = async (code: number | null) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (spawned && notifyCompletion) {
      const completion = { code, timedOut: didTimeout, ok: code === 0 && !didTimeout };
      if (options.onComplete) await notifyBackgroundCompletion(args, options, completion);
      else logger.info({ verb: args.slice(0, 2), ...completion }, 'career CLI finished');
    }
    releaseChildClaim(claim, options, spawned);
  };
  proc.once('error', () => { void settle(null); });
  proc.once('close', (code) => { void settle(code); });
  return () => didTimeout;
}

/** Launch one claimed child and guarantee deadline cleanup plus exactly-once slot release. */
function launchCli(
  userSub: string, args: string[], extraEnv: Record<string, string>,
  options: CliRunOptions, captureOutput: boolean,
): ActiveCli | CliResult {
  const claim = claimForLaunch(userSub, args, options);
  if ('ok' in claim) return claim;
  let proc: ChildProcess;
  try {
    proc = (options.spawnProcess || spawn)('node', [resolveEngineCli(), ...args], {
      env: adoptedChildEnv(userSub, extraEnv, claim.lease, options),
      stdio: captureOutput ? ['ignore', 'pipe', 'pipe'] : 'ignore',
      detached: process.platform !== 'win32',
    });
    const active = claimsInFlight.get(claim.lease.token);
    if (active) active.proc = proc;
  } catch (error) {
    if (claim.automatic) releaseRun(claim.lease);
    return { ok: false, out: '', err: error instanceof Error ? error.message : String(error) };
  }
  return { proc, timedOut: bindChildLease(proc, claim, args, options, !captureOutput) };
}

/**
 * @description Starts a bounded background engine command and acknowledges it only after the OS
 * spawn event; its optional completion observer settles or reaches its bound before ownership releases.
 * @param userSub - Authenticated raw OIDC subject that owns the engine store.
 * @param args - Engine verb and bounded command arguments.
 * @param extraEnv - Per-command inputs and brokered credentials.
 * @param options - Admission, timeout, spawn, adoption, and lifecycle controls.
 * @returns Spawn acknowledgement or a bounded admission/start failure.
 */
export function runCliAsync(
  userSub: string,
  args: string[],
  extraEnv: Record<string, string> = {},
  options: CliRunOptions = {},
): Promise<CliStartResult> {
  const launched = launchCli(userSub, args, extraEnv, options, false);
  if ('ok' in launched) {
    return Promise.resolve({ started: false, err: launched.err, limitReason: launched.limitReason });
  }
  const { proc } = launched;
  return new Promise((resolve) => {
    proc.once('spawn', () => resolve({ started: true }));
    proc.once('error', (error) => resolve({ started: false, err: error.message }));
  });
}

/**
 * @description Awaits an engine command without blocking the event loop and returns tail-bounded
 * diagnostics plus a structured deadline flag.
 * @param userSub - Authenticated raw OIDC subject that owns the engine store.
 * @param args - Engine verb and bounded command arguments.
 * @param extraEnv - Per-command inputs and brokered credentials.
 * @param options - Admission, timeout, spawn, and preclaim controls.
 * @returns Terminal command result with bounded output and timeout state.
 */
export function runCliAwait(
  userSub: string,
  args: string[],
  extraEnv: Record<string, string> = {},
  options: CliRunOptions = {},
): Promise<CliResult> {
  const launched = launchCli(userSub, args, extraEnv, options, true);
  if ('ok' in launched) return Promise.resolve(launched);
  const { proc, timedOut } = launched;
  let out = '';
  let err = '';
  proc.stdout?.setEncoding('utf8');
  proc.stderr?.setEncoding('utf8');
  proc.stdout?.on('data', (chunk) => { out = appendTail(out, chunk, STDOUT_LIMIT); });
  proc.stderr?.on('data', (chunk) => { err = appendTail(err, chunk, STDERR_LIMIT); });
  return new Promise((resolve) => {
    proc.once('close', (code) => {
      const deadlineExpired = timedOut();
      resolve({
        ok: code === 0 && !deadlineExpired,
        out,
        err: deadlineExpired ? appendTail(err, 'career engine timed out', STDERR_LIMIT) : err,
        timedOut: deadlineExpired,
      });
    });
    proc.once('error', (error) => resolve({
      ok: false,
      out,
      err: appendTail(err, error.message, STDERR_LIMIT),
    }));
  });
}
