/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-08-03 00:20:00 | maintainer@emeraldcoastsystemsgroup.com | Initial creation — aero-lab engine
 *                     |                             | adapter (BUILD_CONTRACT §5a/§5b). One persistent
 *                     |                             | Python worker per api process behind a frozen
 *                     |                             | JSON-lines stdio protocol: lazy spawn, 10 min idle
 *                     |                             | shutdown, kill+restart on crash/timeout, one
 *                     |                             | in-flight command with a FIFO queue (cap 4), per-
 *                     |                             | command wall-clock timeouts. Engine dir from
 *                     |                             | AERO_LAB_ENGINE_DIR (documented scratchpad default);
 *                     |                             | python strictly from the dedicated venv — a missing
 *                     |                             | venv means present:false and honest 503s, NEVER a
 *                     |                             | system-python fallback and NEVER fabricated numbers.
 * 2026-08-03 02:10:00 | maintainer@emeraldcoastsystemsgroup.com | Integration fix: reach the VENDORED
 *                     |                             | engine. The package ships a complete engine/aerosim
 *                     |                             | tree so a fresh box works, and service.py has a
 *                     |                             | vendored fallback — but the adapter pinned engineDir
 *                     |                             | to the documented scratchpad path unconditionally
 *                     |                             | AND exports AERO_LAB_ENGINE_DIR into the worker env,
 *                     |                             | so the python-side fallback could never fire. On any
 *                     |                             | box without that scratchpad the app reported
 *                     |                             | capability_unavailable forever with a working engine
 *                     |                             | inside the package. resolveEngineDir() now falls
 *                     |                             | through to engine/ when the documented default is
 *                     |                             | absent; the documented default still wins when present.
 * 2026-08-06 12:30:00 | maintainer@emeraldcoastsystemsgroup.com | SECURITY: isolate the
 *                     |                             | numerical worker from controller credentials by
 *                     |                             | forwarding only OS/runtime process essentials and
 *                     |                             | disabling Python user-site imports.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import { createChildLogger } from '@/shared/logger';

const logger = createChildLogger({ module: 'aero-engine-adapter' });

/** The engine commands the frozen §5b wire protocol knows. */
export type AeroCmd = 'capabilities' | 'polar' | 'evaluate' | 'screen' | 'mission' | 'export';

/**
 * Adapter/worker error codes (frozen §5b plus the two transport-side codes).
 * Routes map these to HTTP: capability_unavailable→503, invalid_design→400,
 * inadmissible_input→422, engine_timeout→504, engine_busy→503, engine_error→500.
 */
export type AeroEngineErrorCode =
  | 'capability_unavailable'
  | 'invalid_design'
  | 'inadmissible_input'
  | 'engine_error'
  | 'engine_timeout'
  | 'engine_busy';

/**
 * @description A typed engine failure — the ONLY error shape the adapter throws, so
 * routes can map status codes without string-matching. `reason` carries the honest
 * engine/worker explanation for capability_unavailable responses.
 */
export class AeroEngineError extends Error {
  /** The frozen error code. */
  public readonly code: AeroEngineErrorCode;
  /** Honest explanation for 503 capability_unavailable bodies. */
  public readonly reason?: string;

  constructor(code: AeroEngineErrorCode, message: string, reason?: string) {
    super(message);
    this.name = 'AeroEngineError';
    this.code = code;
    this.reason = reason;
  }
}

/** What the box actually has — reported verbatim by GET /capabilities. */
export interface AeroEngineStatus {
  /** Engine dir + interpreter + worker script all exist — engine calls can be attempted. */
  present: boolean;
  engineDir: string;
  /** Resolved interpreter path (the dedicated venv only — never a system python). */
  python: string;
  venvOk: boolean;
  /** Resolved worker script path. */
  workerPath: string;
  workerOk: boolean;
}

/** Per-command wall-clock timeouts, ms (BUILD_CONTRACT §5a — capabilities pays import cost). */
export const COMMAND_TIMEOUTS_MS: Record<AeroCmd, number> = {
  capabilities: 30_000,
  polar: 120_000,
  screen: 120_000,
  evaluate: 300_000,
  mission: 600_000,
  export: 300_000,
};

/** Documented default engine checkout on this box (BUILD_CONTRACT §5a). */
export const DEFAULT_ENGINE_DIR =
  'C:/Users/you/AppData/Local/Temp/claude/c--Projects-oshal/a6f28b94-bbf2-435a-9f7c-b5755938e4c5/scratchpad/aerosim';

/** Load-time-only fallback for frameworks predating ctx.appPackageDir (D10). */
const LOAD_TIME_PACKAGE_DIR = process.env.OSHAL_APP_PACKAGE_DIR || '';

const IDLE_TIMEOUT_MS = 10 * 60_000;
const QUEUE_CAP = 4;
const CAPS_CACHE_TTL_MS = 60_000;
const WORKER_ENV_ALLOWLIST = [
  'PATH', 'SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT',
  'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'TZ',
] as const;

/** Build the numerical worker's minimal environment without controller/application secrets. */
export function buildAeroWorkerEnv(
  engineDir: string,
  parent: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of WORKER_ENV_ALLOWLIST) {
    const value = parent[key];
    if (value !== undefined) env[key] = value;
  }
  return {
    ...env,
    AERO_LAB_ENGINE_DIR: engineDir,
    PYTHONNOUSERSITE: '1',
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONUNBUFFERED: '1',
  };
}

/** Constructor options — everything injectable so specs drive a protocol double. */
export interface AeroEngineAdapterOptions {
  engineDir?: string;
  pythonPath?: string;
  workerPath?: string;
  appPackageDir?: string;
  workDir?: string;
  idleTimeoutMs?: number;
  queueCap?: number;
  timeoutsMs?: Partial<Record<AeroCmd, number>>;
}

interface QueuedRequest {
  id: string;
  cmd: AeroCmd;
  args: Record<string, unknown>;
  resolve: (result: unknown) => void;
  reject: (err: AeroEngineError) => void;
}

interface InFlightRequest extends QueuedRequest {
  timer: NodeJS.Timeout;
}

/**
 * @description Resolve the venv interpreter for an engine dir. STRICT: env override,
 * else the dedicated venv (win32 then posix layout). A missing venv resolves to the
 * win32 candidate path with venvOk=false — never a bare `python` from PATH, because a
 * shared interpreter cannot reproduce the pinned surrogate-model numbers (§5d).
 * @param engineDir - The aerosim checkout root.
 * @param override - Explicit interpreter (opts/env), used verbatim when given.
 * @returns Resolved path + whether it exists.
 */
function resolvePython(engineDir: string, override?: string): { python: string; venvOk: boolean } {
  if (override) return { python: override, venvOk: fs.existsSync(override) };
  const winVenv = path.join(engineDir, '.venv', 'Scripts', 'python.exe');
  const posixVenv = path.join(engineDir, '.venv', 'bin', 'python');
  const candidates = [process.env.AERO_LAB_PYTHON || '', winVenv, posixVenv].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return { python: p, venvOk: true };
  }
  return { python: process.platform === 'win32' ? winVenv : posixVenv, venvOk: false };
}

/**
 * @description Resolve the aerosim checkout the worker runs against. Documented order
 * (§5a): explicit opts → AERO_LAB_ENGINE_DIR → the documented scratchpad checkout →
 * the engine tree VENDORED IN THIS PACKAGE. The last step is what makes a fresh box
 * work: the package ships engine/aerosim, and without this the adapter pinned the
 * scratchpad path on every box and reported capability_unavailable forever even though
 * a complete engine sat inside the package. A vendored candidate only counts when
 * engine/aerosim/__init__.py is actually there — never a bare directory.
 * @param appPackageDir - This package's dir from the per-package context.
 * @param override - Explicit engine dir (opts), used verbatim when given.
 * @returns The engine dir to spawn the worker in.
 */
function resolveEngineDir(appPackageDir?: string, override?: string): string {
  if (override) return override;
  if (process.env.AERO_LAB_ENGINE_DIR) return process.env.AERO_LAB_ENGINE_DIR;
  if (fs.existsSync(DEFAULT_ENGINE_DIR)) return DEFAULT_ENGINE_DIR;
  const vendored = [
    appPackageDir ? path.join(appPackageDir, 'engine') : '',
    LOAD_TIME_PACKAGE_DIR ? path.join(LOAD_TIME_PACKAGE_DIR, 'engine') : '',
    path.resolve(__dirname, '../engine'),
  ].filter(Boolean);
  for (const dir of vendored) {
    if (fs.existsSync(path.join(dir, 'aerosim', '__init__.py'))) return dir;
  }
  return DEFAULT_ENGINE_DIR;
}

/**
 * @description Resolve the worker script: explicit override, else the package's own
 * `engine/aero_lab_worker.py` (ctx.appPackageDir, the load-time env fallback, then the
 * compiled module's sibling). Never a path outside the package.
 * @param appPackageDir - The mounted package directory, when the framework supplies it.
 * @param override - Explicit worker path (opts), used verbatim when given.
 * @returns Resolved path + whether it exists.
 */
function resolveWorker(appPackageDir?: string, override?: string): { workerPath: string; workerOk: boolean } {
  if (override) return { workerPath: override, workerOk: fs.existsSync(override) };
  const candidates = [
    appPackageDir ? path.join(appPackageDir, 'engine', 'aero_lab_worker.py') : '',
    LOAD_TIME_PACKAGE_DIR ? path.join(LOAD_TIME_PACKAGE_DIR, 'engine', 'aero_lab_worker.py') : '',
    path.resolve(__dirname, '../engine', 'aero_lab_worker.py'),
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return { workerPath: p, workerOk: true };
  }
  return { workerPath: candidates[candidates.length - 1], workerOk: false };
}

/**
 * @description The NASA-42-philosophy adapter over the aerosim worker: an external
 * authoritative simulator behind subprocess-stdio JSON lines (BUILD_CONTRACT §5).
 * Spawns lazily on the first engine call, keeps one worker alive (10 min idle kill),
 * restarts on crash/timeout, and serializes commands (the engine is CPU-bound) with a
 * FIFO queue capped at 4. Every failure surfaces as a typed AeroEngineError — the
 * adapter never invents engine output.
 */
export class AeroEngineAdapter {
  /** Where export artifacts land: `<workDir>/exports/<exportId>/` (§5c). */
  public readonly workDir: string;

  private readonly engineDir: string;
  private readonly pythonOverride?: string;
  private readonly workerOverride?: string;
  private readonly appPackageDir?: string;
  private readonly idleTimeoutMs: number;
  private readonly queueCap: number;
  private readonly timeoutsMs: Record<AeroCmd, number>;

  private proc: ChildProcess | null = null;
  private stdoutBuf = '';
  private inFlight: InFlightRequest | null = null;
  private queue: QueuedRequest[] = [];
  private idleTimer: NodeJS.Timeout | null = null;
  private nextId = 1;
  private disposed = false;
  private capsCache: { at: number; value: unknown } | null = null;

  constructor(opts: AeroEngineAdapterOptions = {}) {
    this.appPackageDir = opts.appPackageDir;
    this.engineDir = resolveEngineDir(opts.appPackageDir, opts.engineDir);
    this.pythonOverride = opts.pythonPath;
    this.workerOverride = opts.workerPath;
    this.workDir = opts.workDir || path.join(os.tmpdir(), 'aero-lab');
    this.idleTimeoutMs = opts.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
    this.queueCap = opts.queueCap ?? QUEUE_CAP;
    this.timeoutsMs = { ...COMMAND_TIMEOUTS_MS, ...(opts.timeoutsMs || {}) };
  }

  /**
   * @description Report what is actually on the box — no spawning, pure fs checks.
   * @returns Engine dir / venv / worker presence, resolved paths included.
   */
  engineStatus(): AeroEngineStatus {
    const dirOk = fs.existsSync(this.engineDir);
    const { python, venvOk } = resolvePython(this.engineDir, this.pythonOverride);
    const { workerPath, workerOk } = resolveWorker(this.appPackageDir, this.workerOverride);
    return {
      present: dirOk && venvOk && workerOk,
      engineDir: this.engineDir,
      python,
      venvOk: dirOk && venvOk,
      workerPath,
      workerOk,
    };
  }

  /**
   * @description The worker's own feature-detected capabilities (§5b shape), cached 60 s
   * so route-side validation and the hybrid gate don't pay a worker round-trip each call.
   * @returns The worker capabilities result verbatim.
   */
  async capabilities(): Promise<unknown> {
    if (this.capsCache && Date.now() - this.capsCache.at < CAPS_CACHE_TTL_MS) return this.capsCache.value;
    const value = await this.request('capabilities', {});
    this.capsCache = { at: Date.now(), value };
    return value;
  }

  /**
   * @description The already-fetched capabilities if fresh — sync, never spawns. Routes
   * use it for best-effort bounds validation (the engine re-validates authoritatively).
   * @returns Cached capabilities or null.
   */
  cachedCapabilities(): unknown | null {
    if (this.capsCache && Date.now() - this.capsCache.at < CAPS_CACHE_TTL_MS) return this.capsCache.value;
    return null;
  }

  /**
   * @description Send one command over the frozen §5b protocol. Serialized FIFO; beyond
   * queueCap waiting requests it rejects engine_busy immediately (the engine is CPU-bound
   * — an unbounded queue would just time everything out later).
   * @param cmd - Frozen command name.
   * @param args - Command args; export gets workDir injected here (§5c).
   * @returns The worker's `result` verbatim.
   */
  request(cmd: AeroCmd, args: Record<string, unknown> = {}): Promise<unknown> {
    const status = this.engineStatus();
    if (!status.present) {
      const missing = !fs.existsSync(this.engineDir)
        ? `engine dir not found at ${this.engineDir} (set AERO_LAB_ENGINE_DIR, or restore the package's vendored engine/aerosim tree)`
        : !status.venvOk
          ? `engine venv interpreter not found at ${status.python} (run engine/setup-venv)`
          : `engine worker script not found at ${status.workerPath}`;
      return Promise.reject(new AeroEngineError('capability_unavailable', 'aerosim engine is not available', missing));
    }
    if (this.disposed) {
      return Promise.reject(new AeroEngineError('engine_error', 'adapter disposed'));
    }
    const fullArgs = cmd === 'export' ? { ...args, workDir: this.workDir } : args;
    return new Promise<unknown>((resolve, reject) => {
      const q: QueuedRequest = { id: `r-${this.nextId++}`, cmd, args: fullArgs, resolve, reject };
      if (this.inFlight) {
        if (this.queue.length >= this.queueCap) {
          reject(new AeroEngineError('engine_busy', 'engine busy — try again shortly'));
          return;
        }
        this.queue.push(q);
        return;
      }
      this.dispatch(q);
    });
  }

  /** Kill the worker and reject everything pending — shutdown / test teardown. */
  dispose(): void {
    this.disposed = true;
    this.clearIdleTimer();
    if (this.inFlight) {
      clearTimeout(this.inFlight.timer);
      this.inFlight.reject(new AeroEngineError('engine_error', 'adapter disposed'));
      this.inFlight = null;
    }
    for (const q of this.queue.splice(0)) q.reject(new AeroEngineError('engine_error', 'adapter disposed'));
    this.killWorker('dispose');
  }

  /** Write one request line; arm its wall-clock timeout. */
  private dispatch(q: QueuedRequest): void {
    const proc = this.ensureWorker();
    if (!proc || !proc.stdin?.writable) {
      q.reject(new AeroEngineError('capability_unavailable', 'aerosim engine worker failed to start',
        'worker process could not be spawned — see api logs'));
      return;
    }
    this.clearIdleTimer();
    const timeoutMs = this.timeoutsMs[q.cmd];
    const timer = setTimeout(() => this.onTimeout(q.id, timeoutMs), timeoutMs);
    timer.unref();
    this.inFlight = { ...q, timer };
    try {
      proc.stdin.write(`${JSON.stringify({ id: q.id, cmd: q.cmd, args: q.args })}\n`);
    } catch (err) {
      clearTimeout(timer);
      this.inFlight = null;
      logger.error({ err, stack: (err as Error).stack, cmd: q.cmd }, 'engine stdin write failed');
      q.reject(new AeroEngineError('engine_error', `engine write failed: ${(err as Error).message}`));
      this.pump();
    }
  }

  /** Start the next queued command, if any. */
  private pump(): void {
    const next = this.queue.shift();
    if (next) { this.dispatch(next); return; }
    this.scheduleIdleKill();
  }

  /** Spawn the worker if not running (career-digest spawn precedent). */
  private ensureWorker(): ChildProcess | null {
    if (this.proc && this.proc.exitCode === null && !this.proc.killed) return this.proc;
    const status = this.engineStatus();
    logger.info({ python: status.python, workerPath: status.workerPath, engineDir: this.engineDir }, 'spawning aerosim engine worker');
    let proc: ChildProcess;
    try {
      proc = spawn(status.python, [status.workerPath], {
        cwd: this.engineDir,
        env: buildAeroWorkerEnv(this.engineDir),
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      logger.error({ err, stack: (err as Error).stack }, 'engine spawn threw');
      return null;
    }
    this.proc = proc;
    this.stdoutBuf = '';
    proc.stdout?.on('data', (d: Buffer) => this.onStdoutData(String(d)));
    proc.stderr?.on('data', (d: Buffer) => logger.debug({ worker: String(d).slice(0, 500) }, 'engine stderr'));
    proc.on('error', (e: Error) => this.onWorkerGone(`engine spawn failed: ${e.message}`));
    proc.on('exit', (code: number | null) => {
      if (this.proc === proc) this.onWorkerGone(`engine worker exited unexpectedly (code ${code})`);
    });
    return proc;
  }

  /** Line-buffer stdout; stdout is the protocol channel — non-JSON lines are worker bugs. */
  private onStdoutData(chunk: string): void {
    this.stdoutBuf += chunk;
    let nl = this.stdoutBuf.indexOf('\n');
    while (nl >= 0) {
      const line = this.stdoutBuf.slice(0, nl).replace(/\r$/, '').trim();
      this.stdoutBuf = this.stdoutBuf.slice(nl + 1);
      if (line) this.onStdoutLine(line);
      nl = this.stdoutBuf.indexOf('\n');
    }
  }

  /** Parse one protocol line and settle the in-flight request. */
  private onStdoutLine(line: string): void {
    let msg: { id?: string; ok?: boolean; result?: unknown; error?: { code?: string; message?: string } };
    try {
      msg = JSON.parse(line) as typeof msg;
    } catch {
      logger.warn({ line: line.slice(0, 300) }, 'non-JSON line on engine stdout — dropped (worker bug)');
      return;
    }
    const req = this.inFlight;
    if (!req || msg.id !== req.id) {
      logger.warn({ id: msg.id, expected: req?.id }, 'engine response for unknown/stale request — dropped');
      return;
    }
    clearTimeout(req.timer);
    this.inFlight = null;
    if (msg.ok) {
      req.resolve(msg.result);
    } else {
      const code = this.mapWorkerCode(msg.error?.code);
      const message = String(msg.error?.message || 'engine error');
      req.reject(new AeroEngineError(code, message, code === 'capability_unavailable' ? message : undefined));
    }
    this.pump();
  }

  /** Constrain worker-reported codes to the frozen set — anything else is engine_error. */
  private mapWorkerCode(code: string | undefined): AeroEngineErrorCode {
    if (code === 'capability_unavailable' || code === 'invalid_design' || code === 'inadmissible_input') return code;
    return 'engine_error';
  }

  /** Wall-clock expiry: kill the worker tree, 504 the request, restart lazily. */
  private onTimeout(id: string, timeoutMs: number): void {
    const req = this.inFlight;
    if (!req || req.id !== id) return;
    this.inFlight = null;
    logger.error({ cmd: req.cmd, timeoutMs }, 'engine command timed out — killing worker');
    this.killWorker('timeout');
    req.reject(new AeroEngineError('engine_timeout', `engine ${req.cmd} exceeded ${Math.round(timeoutMs / 1000)} s and was killed`));
    this.pump();
  }

  /** Worker died under us: fail in-flight, keep queue for a lazy respawn. */
  private onWorkerGone(message: string): void {
    this.proc = null;
    const req = this.inFlight;
    if (req) {
      clearTimeout(req.timer);
      this.inFlight = null;
      logger.error({ cmd: req.cmd, message }, 'engine worker gone with a command in flight');
      req.reject(new AeroEngineError('engine_error', message));
      this.pump();
    }
  }

  /** Kill the worker process tree (win32 taskkill /T — python may own children). */
  private killWorker(why: string): void {
    const proc = this.proc;
    this.proc = null;
    if (!proc || proc.exitCode !== null) return;
    logger.info({ pid: proc.pid, why }, 'killing engine worker');
    try {
      if (process.platform === 'win32' && proc.pid) {
        spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
      } else {
        proc.kill('SIGKILL');
      }
    } catch (err) {
      logger.error({ err, stack: (err as Error).stack }, 'engine worker kill failed');
    }
  }

  /** After 10 idle minutes, end stdin — the worker exits cleanly on EOF (§5c). */
  private scheduleIdleKill(): void {
    this.clearIdleTimer();
    if (!this.proc) return;
    this.idleTimer = setTimeout(() => {
      const proc = this.proc;
      if (!proc || this.inFlight || this.queue.length) return;
      logger.info({ pid: proc.pid }, 'engine worker idle — shutting down');
      this.proc = null;
      try { proc.stdin?.end(); } catch { /* already gone */ }
      const hardKill = setTimeout(() => {
        if (proc.exitCode === null) {
          try { proc.kill('SIGKILL'); } catch { /* already gone */ }
        }
      }, 5_000);
      hardKill.unref();
    }, this.idleTimeoutMs);
    this.idleTimer.unref();
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
  }
}
