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
 * 2026-09-11 01:40:00 | maintainer@emeraldcoastsystemsgroup.com | CONTAINER TRANSPORT. The oshal
 *                     |                             | api image is Alpine (musl) and casadi 3.7.2 ships
 *                     |                             | glibc-only wheels, so no venv can exist there and
 *                     |                             | every deployed box answered capability_unavailable
 *                     |                             | forever. With no explicit local engine config and
 *                     |                             | no local venv, the adapter now talks to the
 *                     |                             | package's own engine container (engine/container,
 *                     |                             | installed by engine/install-engine.sh) over TCP at
 *                     |                             | AERO_LAB_ENGINE_ADDR (default aero-lab-engine:7411).
 *                     |                             | Both transports sit behind one EngineChannel, so
 *                     |                             | queueing, timeouts and idle shutdown are unchanged;
 *                     |                             | a container built from a different engine tree is
 *                     |                             | refused with the exact reinstall command.
 * 2026-09-16 09:00:00 | maintainer@emeraldcoastsystemsgroup.com | THE VENDORED ENGINE IS THE
 *                     |                             | DEFAULT. resolveEngineDir preferred a hard-coded
 *                     |                             | operator-local scratchpad checkout over the tree
 *                     |                             | shipped inside the package, so a box that happened
 *                     |                             | to carry that path answered from an uncertified
 *                     |                             | upstream tree and 422'd every shipped preset, and a
 *                     |                             | box without it had the operator's path quoted back
 *                     |                             | in capability_unavailable and the install hint. The
 *                     |                             | order is now opts -> AERO_LAB_ENGINE_DIR -> the
 *                     |                             | vendored tree; with no vendored aerosim the
 *                     |                             | package's own engine dir is still what gets named.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import { createChildLogger } from '@/shared/logger';
import { engineBuildHash } from './engine-build-hash';
import { LineSplitter, openContainerChannel, type ChannelFailure, type ChannelHandlers, type EngineChannel } from './engine-channel';

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

/** Where engine commands run: a local child process, or the package's engine container. */
export type AeroTransport = 'local' | 'container';

/** What the box actually has — reported verbatim by GET /capabilities. */
export interface AeroEngineStatus {
  /**
   * Engine calls can be attempted: for `local`, engine dir + interpreter + worker script all
   * exist; for `container`, always true — reachability is only known by connecting.
   */
  present: boolean;
  transport: AeroTransport;
  /** host:port of the engine container's bridge (container transport only). */
  engineAddr?: string;
  /** The exact command that installs/rebuilds the engine container on this box. */
  installHint: string;
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

/**
 * Documented default address of the engine container's bridge: the network alias
 * engine/container/compose.yaml gives it on the stack network. AERO_LAB_ENGINE_ADDR overrides.
 */
export const DEFAULT_ENGINE_ADDR = 'aero-lab-engine:7411';

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
  /** host:port of an engine container bridge — forces the container transport. */
  engineAddr?: string;
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
 * (§5a): explicit opts → AERO_LAB_ENGINE_DIR → the engine tree VENDORED IN THIS PACKAGE.
 * The vendored snapshot is the DEFAULT, not a last resort: it is the tree the package's
 * recorded numbers and its container image were certified against, and it is the only
 * candidate that exists on every box. An operator-local checkout is reachable only by
 * setting AERO_LAB_ENGINE_DIR deliberately — the adapter never guesses a path outside
 * the package, because a box that happened to carry one answered from an uncertified
 * tree and refused every shipped preset. When no candidate carries engine/aerosim the
 * package's own engine dir is still returned, so the capability_unavailable reason names
 * THIS install rather than a stranger's disk.
 * @param appPackageDir - This package's dir from the per-package context.
 * @param override - Explicit engine dir (opts), used verbatim when given.
 * @returns The engine dir to spawn the worker in.
 */
function resolveEngineDir(appPackageDir?: string, override?: string): string {
  if (override) return override;
  if (process.env.AERO_LAB_ENGINE_DIR) return process.env.AERO_LAB_ENGINE_DIR;
  const candidates = packageEngineCandidates(appPackageDir);
  return vendoredEngineDir(appPackageDir) || candidates[0];
}

/**
 * @description Every place this package's own engine/ tree can sit, most specific first:
 * the per-package context dir, the load-time env fallback, then the compiled module's
 * sibling. Never a path outside the package.
 * @param appPackageDir - This package's dir from the per-package context.
 * @returns Candidate engine dirs, always at least one.
 */
function packageEngineCandidates(appPackageDir?: string): string[] {
  return [
    appPackageDir ? path.join(appPackageDir, 'engine') : '',
    LOAD_TIME_PACKAGE_DIR ? path.join(LOAD_TIME_PACKAGE_DIR, 'engine') : '',
    path.resolve(__dirname, '../engine'),
  ].filter(Boolean);
}

/**
 * @description The engine tree VENDORED in this package — what engine/install-engine.sh bakes
 * into the container image, so it is also the tree the container's build hash must match.
 * @param appPackageDir - This package's dir from the per-package context.
 * @returns The package's engine/ dir, or null when no candidate carries engine/aerosim.
 */
function vendoredEngineDir(appPackageDir?: string): string | null {
  const vendored = packageEngineCandidates(appPackageDir);
  return vendored.find((dir) => fs.existsSync(path.join(dir, 'aerosim', '__init__.py'))) || null;
}

/** The resolved transport and, for the container, its bridge address. */
interface TransportChoice { transport: AeroTransport; engineAddr?: string }

/**
 * @description Pick where engine commands run. Explicit local configuration always wins (specs,
 * dev boxes, AERO_LAB_ENGINE_DIR / AERO_LAB_PYTHON); an explicit address selects the container;
 * otherwise a present local venv is used and, failing that, the package's engine container at its
 * documented alias. The api image is Alpine, where no engine venv can exist, so the container is
 * what a deployed box uses.
 * @param opts - Constructor options.
 * @param localPresent - Whether a local interpreter + worker exist (evaluated only when needed).
 * @returns The transport choice.
 */
function resolveTransport(opts: AeroEngineAdapterOptions, localPresent: () => boolean): TransportChoice {
  if (opts.engineAddr) return { transport: 'container', engineAddr: opts.engineAddr };
  const explicitLocal = opts.engineDir || opts.pythonPath || opts.workerPath
    || process.env.AERO_LAB_ENGINE_DIR || process.env.AERO_LAB_PYTHON;
  if (explicitLocal) return { transport: 'local' };
  if (process.env.AERO_LAB_ENGINE_ADDR) return { transport: 'container', engineAddr: process.env.AERO_LAB_ENGINE_ADDR };
  if (localPresent()) return { transport: 'local' };
  return { transport: 'container', engineAddr: DEFAULT_ENGINE_ADDR };
}

/**
 * @description Split a `host:port` bridge address (IPv6 hosts in brackets).
 * @param addr - The configured address.
 * @returns Host and port, or null when the address is malformed.
 */
function parseEngineAddr(addr: string): { host: string; port: number } | null {
  const m = /^\[?([^\]\s]+?)\]?:(\d{1,5})$/.exec(addr.trim());
  if (!m) return null;
  const port = Number(m[2]);
  return port > 0 && port < 65536 ? { host: m[1], port } : null;
}

/**
 * @description The exact command that installs (or rebuilds) the engine container on THIS box.
 * Inside a container (the deployed api) it names this container — its hostname is its id —
 * whose docker CLI and mounted socket run the script; elsewhere the script runs directly.
 * @param engineDir - The package's vendored engine dir (holds install-engine.sh).
 * @returns A copy-paste shell command.
 */
export function engineInstallHint(engineDir: string): string {
  const script = `${engineDir.replace(/\\/g, '/')}/install-engine.sh`;
  return fs.existsSync('/.dockerenv') ? `docker exec ${os.hostname()} sh ${script}` : `sh ${script}`;
}

/** Kill a local worker's process tree (win32 taskkill /T — python may own children). */
function killProcessTree(proc: ChildProcess, why: string): void {
  if (proc.exitCode !== null) return;
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

  /** Where engine commands run — fixed at construction. */
  public readonly transport: AeroTransport;

  private readonly engineDir: string;
  /** The package's own engine tree: what the container image bakes in and must match. */
  private readonly packageEngineDir: string;
  private readonly engineAddr?: string;
  private readonly pythonOverride?: string;
  private readonly workerOverride?: string;
  private readonly appPackageDir?: string;
  private readonly idleTimeoutMs: number;
  private readonly queueCap: number;
  private readonly timeoutsMs: Record<AeroCmd, number>;

  private channel: EngineChannel | null = null;
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
    this.packageEngineDir = vendoredEngineDir(opts.appPackageDir) || this.engineDir;
    const choice = resolveTransport(opts, () => this.localStatus().present);
    this.transport = choice.transport;
    this.engineAddr = choice.engineAddr;
  }

  /**
   * @description Report what is actually on the box — no spawning, no connecting.
   * @returns Transport, install hint, and (local) engine dir / venv / worker presence.
   */
  engineStatus(): AeroEngineStatus {
    const installHint = engineInstallHint(this.packageEngineDir);
    if (this.transport === 'container') {
      return {
        present: true, transport: 'container', engineAddr: this.engineAddr, installHint,
        engineDir: this.packageEngineDir, python: '', venvOk: false, workerPath: '', workerOk: false,
      };
    }
    return { ...this.localStatus(), transport: 'local', installHint };
  }

  /** Local fs facts: engine dir, dedicated venv interpreter, worker script. */
  private localStatus(): Omit<AeroEngineStatus, 'transport' | 'installHint'> {
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
    const channel = this.ensureChannel();
    if (!channel) {
      const reason = this.transport === 'container'
        ? `engine address "${this.engineAddr}" is not host:port — fix AERO_LAB_ENGINE_ADDR`
        : 'worker process could not be spawned — see api logs';
      q.reject(new AeroEngineError('capability_unavailable', 'aerosim engine worker failed to start', reason));
      this.pump();
      return;
    }
    this.clearIdleTimer();
    const timeoutMs = this.timeoutsMs[q.cmd];
    const timer = setTimeout(() => this.onTimeout(q.id, timeoutMs), timeoutMs);
    timer.unref();
    this.inFlight = { ...q, timer };
    let written = false;
    let failure = 'the worker channel is closed';
    try {
      written = channel.write(`${JSON.stringify({ id: q.id, cmd: q.cmd, args: q.args })}\n`);
    } catch (err) {
      failure = (err as Error).message;
      logger.error({ err, stack: (err as Error).stack, cmd: q.cmd }, 'engine write failed');
    }
    if (!written) {
      clearTimeout(timer);
      this.inFlight = null;
      q.reject(new AeroEngineError('engine_error', `engine write failed: ${failure}`));
      this.pump();
    }
  }

  /** Start the next queued command, if any. */
  private pump(): void {
    const next = this.queue.shift();
    if (next) { this.dispatch(next); return; }
    this.scheduleIdleKill();
  }

  /** Open the worker channel if none is live — the local child or the engine container. */
  private ensureChannel(): EngineChannel | null {
    if (this.channel?.alive) return this.channel;
    let channel: EngineChannel | null = null;
    const handlers: ChannelHandlers = {
      onLine: (line) => { if (this.channel === channel) this.onStdoutLine(line); },
      onGone: (failure) => { if (this.channel === channel) this.onChannelGone(failure); },
    };
    channel = this.transport === 'container' ? this.openContainer(handlers) : this.spawnLocal(handlers);
    this.channel = channel;
    return channel;
  }

  /** Connect to the engine container's bridge; the channel verifies its build before any write. */
  private openContainer(handlers: ChannelHandlers): EngineChannel | null {
    const addr = parseEngineAddr(this.engineAddr || DEFAULT_ENGINE_ADDR);
    if (!addr) {
      logger.error({ engineAddr: this.engineAddr }, 'engine container address is not host:port');
      return null;
    }
    logger.info({ engineAddr: this.engineAddr }, 'connecting to the aerosim engine container');
    return openContainerChannel({
      host: addr.host,
      port: addr.port,
      expectedBuildHash: engineBuildHash(this.packageEngineDir),
      workDir: this.workDir,
      installHint: engineInstallHint(this.packageEngineDir),
    }, handlers);
  }

  /** Spawn the local worker (career-digest spawn precedent) and wrap it as a channel. */
  private spawnLocal(handlers: ChannelHandlers): EngineChannel | null {
    const status = this.localStatus();
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
    let ended = false;
    const splitter = new LineSplitter((line) => { if (!ended) handlers.onLine(line); });
    const gone = (message: string): void => {
      if (ended) return;
      ended = true;
      handlers.onGone({ code: 'engine_error', message });
    };
    proc.stdout?.on('data', (d: Buffer) => splitter.push(String(d)));
    proc.stderr?.on('data', (d: Buffer) => logger.debug({ worker: String(d).slice(0, 500) }, 'engine stderr'));
    proc.stdin?.on('error', (err: Error) => logger.error({ err, stack: err.stack }, 'engine stdin error'));
    proc.on('error', (e: Error) => gone(`engine spawn failed: ${e.message}`));
    proc.on('exit', (code: number | null) => gone(`engine worker exited unexpectedly (code ${code})`));
    return {
      get alive(): boolean { return !ended && proc.exitCode === null && !proc.killed; },
      write: (line: string): boolean => {
        if (ended || !proc.stdin?.writable) return false;
        proc.stdin.write(line);
        return true;
      },
      end: (): void => {
        if (ended) return;
        ended = true;
        try { proc.stdin?.end(); } catch { /* already gone */ }
        const hardKill = setTimeout(() => {
          if (proc.exitCode === null) {
            try { proc.kill('SIGKILL'); } catch { /* already gone */ }
          }
        }, 5_000);
        hardKill.unref();
      },
      kill: (why: string): void => {
        if (ended) return;
        ended = true;
        killProcessTree(proc, why);
      },
    };
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

  /**
   * Worker channel ended under us: fail in-flight with the channel's own verdict (an absent or
   * stale engine container is capability_unavailable with the install command; a crash is
   * engine_error), keep the queue for a lazy reconnect/respawn.
   */
  private onChannelGone(failure: ChannelFailure): void {
    this.channel = null;
    const req = this.inFlight;
    if (req) {
      clearTimeout(req.timer);
      this.inFlight = null;
      const log = failure.code === 'capability_unavailable' ? logger.warn : logger.error;
      log.call(logger, { cmd: req.cmd, code: failure.code, message: failure.message }, 'engine channel gone with a command in flight');
      req.reject(new AeroEngineError(failure.code, failure.message, failure.reason));
      this.pump();
    }
  }

  /** Tear the worker channel down now (timeout / dispose). */
  private killWorker(why: string): void {
    const channel = this.channel;
    this.channel = null;
    if (channel?.alive) channel.kill(why);
  }

  /** After 10 idle minutes, end the channel — the worker exits cleanly on EOF (§5c). */
  private scheduleIdleKill(): void {
    this.clearIdleTimer();
    if (!this.channel) return;
    this.idleTimer = setTimeout(() => {
      const channel = this.channel;
      if (!channel || this.inFlight || this.queue.length) return;
      logger.info({ transport: this.transport }, 'engine worker idle — shutting down');
      this.channel = null;
      channel.end();
    }, this.idleTimeoutMs);
    this.idleTimer.unref();
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
  }
}
