"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.AeroEngineAdapter = exports.DEFAULT_ENGINE_DIR = exports.COMMAND_TIMEOUTS_MS = exports.AeroEngineError = void 0;
exports.buildAeroWorkerEnv = buildAeroWorkerEnv;
const fs = __importStar(require("fs"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const logger_1 = require("@/shared/logger");
const logger = (0, logger_1.createChildLogger)({ module: 'aero-engine-adapter' });
/**
 * @description A typed engine failure — the ONLY error shape the adapter throws, so
 * routes can map status codes without string-matching. `reason` carries the honest
 * engine/worker explanation for capability_unavailable responses.
 */
class AeroEngineError extends Error {
    /** The frozen error code. */
    code;
    /** Honest explanation for 503 capability_unavailable bodies. */
    reason;
    constructor(code, message, reason) {
        super(message);
        this.name = 'AeroEngineError';
        this.code = code;
        this.reason = reason;
    }
}
exports.AeroEngineError = AeroEngineError;
/** Per-command wall-clock timeouts, ms (BUILD_CONTRACT §5a — capabilities pays import cost). */
exports.COMMAND_TIMEOUTS_MS = {
    capabilities: 30_000,
    polar: 120_000,
    screen: 120_000,
    evaluate: 300_000,
    mission: 600_000,
    export: 300_000,
};
/** Documented default engine checkout on this box (BUILD_CONTRACT §5a). */
exports.DEFAULT_ENGINE_DIR = 'C:/Users/you/AppData/Local/Temp/claude/c--Projects-oshal/a6f28b94-bbf2-435a-9f7c-b5755938e4c5/scratchpad/aerosim';
/** Load-time-only fallback for frameworks predating ctx.appPackageDir (D10). */
const LOAD_TIME_PACKAGE_DIR = process.env.OSHAL_APP_PACKAGE_DIR || '';
const IDLE_TIMEOUT_MS = 10 * 60_000;
const QUEUE_CAP = 4;
const CAPS_CACHE_TTL_MS = 60_000;
const WORKER_ENV_ALLOWLIST = [
    'PATH', 'SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT',
    'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'TZ',
];
/** Build the numerical worker's minimal environment without controller/application secrets. */
function buildAeroWorkerEnv(engineDir, parent = process.env) {
    const env = {};
    for (const key of WORKER_ENV_ALLOWLIST) {
        const value = parent[key];
        if (value !== undefined)
            env[key] = value;
    }
    return {
        ...env,
        AERO_LAB_ENGINE_DIR: engineDir,
        PYTHONNOUSERSITE: '1',
        PYTHONDONTWRITEBYTECODE: '1',
        PYTHONUNBUFFERED: '1',
    };
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
function resolvePython(engineDir, override) {
    if (override)
        return { python: override, venvOk: fs.existsSync(override) };
    const winVenv = path.join(engineDir, '.venv', 'Scripts', 'python.exe');
    const posixVenv = path.join(engineDir, '.venv', 'bin', 'python');
    const candidates = [process.env.AERO_LAB_PYTHON || '', winVenv, posixVenv].filter(Boolean);
    for (const p of candidates) {
        if (fs.existsSync(p))
            return { python: p, venvOk: true };
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
function resolveEngineDir(appPackageDir, override) {
    if (override)
        return override;
    if (process.env.AERO_LAB_ENGINE_DIR)
        return process.env.AERO_LAB_ENGINE_DIR;
    if (fs.existsSync(exports.DEFAULT_ENGINE_DIR))
        return exports.DEFAULT_ENGINE_DIR;
    const vendored = [
        appPackageDir ? path.join(appPackageDir, 'engine') : '',
        LOAD_TIME_PACKAGE_DIR ? path.join(LOAD_TIME_PACKAGE_DIR, 'engine') : '',
        path.resolve(__dirname, '../engine'),
    ].filter(Boolean);
    for (const dir of vendored) {
        if (fs.existsSync(path.join(dir, 'aerosim', '__init__.py')))
            return dir;
    }
    return exports.DEFAULT_ENGINE_DIR;
}
/**
 * @description Resolve the worker script: explicit override, else the package's own
 * `engine/aero_lab_worker.py` (ctx.appPackageDir, the load-time env fallback, then the
 * compiled module's sibling). Never a path outside the package.
 * @param appPackageDir - The mounted package directory, when the framework supplies it.
 * @param override - Explicit worker path (opts), used verbatim when given.
 * @returns Resolved path + whether it exists.
 */
function resolveWorker(appPackageDir, override) {
    if (override)
        return { workerPath: override, workerOk: fs.existsSync(override) };
    const candidates = [
        appPackageDir ? path.join(appPackageDir, 'engine', 'aero_lab_worker.py') : '',
        LOAD_TIME_PACKAGE_DIR ? path.join(LOAD_TIME_PACKAGE_DIR, 'engine', 'aero_lab_worker.py') : '',
        path.resolve(__dirname, '../engine', 'aero_lab_worker.py'),
    ].filter(Boolean);
    for (const p of candidates) {
        if (fs.existsSync(p))
            return { workerPath: p, workerOk: true };
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
class AeroEngineAdapter {
    /** Where export artifacts land: `<workDir>/exports/<exportId>/` (§5c). */
    workDir;
    engineDir;
    pythonOverride;
    workerOverride;
    appPackageDir;
    idleTimeoutMs;
    queueCap;
    timeoutsMs;
    proc = null;
    stdoutBuf = '';
    inFlight = null;
    queue = [];
    idleTimer = null;
    nextId = 1;
    disposed = false;
    capsCache = null;
    constructor(opts = {}) {
        this.appPackageDir = opts.appPackageDir;
        this.engineDir = resolveEngineDir(opts.appPackageDir, opts.engineDir);
        this.pythonOverride = opts.pythonPath;
        this.workerOverride = opts.workerPath;
        this.workDir = opts.workDir || path.join(os.tmpdir(), 'aero-lab');
        this.idleTimeoutMs = opts.idleTimeoutMs ?? IDLE_TIMEOUT_MS;
        this.queueCap = opts.queueCap ?? QUEUE_CAP;
        this.timeoutsMs = { ...exports.COMMAND_TIMEOUTS_MS, ...(opts.timeoutsMs || {}) };
    }
    /**
     * @description Report what is actually on the box — no spawning, pure fs checks.
     * @returns Engine dir / venv / worker presence, resolved paths included.
     */
    engineStatus() {
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
    async capabilities() {
        if (this.capsCache && Date.now() - this.capsCache.at < CAPS_CACHE_TTL_MS)
            return this.capsCache.value;
        const value = await this.request('capabilities', {});
        this.capsCache = { at: Date.now(), value };
        return value;
    }
    /**
     * @description The already-fetched capabilities if fresh — sync, never spawns. Routes
     * use it for best-effort bounds validation (the engine re-validates authoritatively).
     * @returns Cached capabilities or null.
     */
    cachedCapabilities() {
        if (this.capsCache && Date.now() - this.capsCache.at < CAPS_CACHE_TTL_MS)
            return this.capsCache.value;
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
    request(cmd, args = {}) {
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
        return new Promise((resolve, reject) => {
            const q = { id: `r-${this.nextId++}`, cmd, args: fullArgs, resolve, reject };
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
    dispose() {
        this.disposed = true;
        this.clearIdleTimer();
        if (this.inFlight) {
            clearTimeout(this.inFlight.timer);
            this.inFlight.reject(new AeroEngineError('engine_error', 'adapter disposed'));
            this.inFlight = null;
        }
        for (const q of this.queue.splice(0))
            q.reject(new AeroEngineError('engine_error', 'adapter disposed'));
        this.killWorker('dispose');
    }
    /** Write one request line; arm its wall-clock timeout. */
    dispatch(q) {
        const proc = this.ensureWorker();
        if (!proc || !proc.stdin?.writable) {
            q.reject(new AeroEngineError('capability_unavailable', 'aerosim engine worker failed to start', 'worker process could not be spawned — see api logs'));
            return;
        }
        this.clearIdleTimer();
        const timeoutMs = this.timeoutsMs[q.cmd];
        const timer = setTimeout(() => this.onTimeout(q.id, timeoutMs), timeoutMs);
        timer.unref();
        this.inFlight = { ...q, timer };
        try {
            proc.stdin.write(`${JSON.stringify({ id: q.id, cmd: q.cmd, args: q.args })}\n`);
        }
        catch (err) {
            clearTimeout(timer);
            this.inFlight = null;
            logger.error({ err, stack: err.stack, cmd: q.cmd }, 'engine stdin write failed');
            q.reject(new AeroEngineError('engine_error', `engine write failed: ${err.message}`));
            this.pump();
        }
    }
    /** Start the next queued command, if any. */
    pump() {
        const next = this.queue.shift();
        if (next) {
            this.dispatch(next);
            return;
        }
        this.scheduleIdleKill();
    }
    /** Spawn the worker if not running (career-digest spawn precedent). */
    ensureWorker() {
        if (this.proc && this.proc.exitCode === null && !this.proc.killed)
            return this.proc;
        const status = this.engineStatus();
        logger.info({ python: status.python, workerPath: status.workerPath, engineDir: this.engineDir }, 'spawning aerosim engine worker');
        let proc;
        try {
            proc = (0, child_process_1.spawn)(status.python, [status.workerPath], {
                cwd: this.engineDir,
                env: buildAeroWorkerEnv(this.engineDir),
                stdio: ['pipe', 'pipe', 'pipe'],
            });
        }
        catch (err) {
            logger.error({ err, stack: err.stack }, 'engine spawn threw');
            return null;
        }
        this.proc = proc;
        this.stdoutBuf = '';
        proc.stdout?.on('data', (d) => this.onStdoutData(String(d)));
        proc.stderr?.on('data', (d) => logger.debug({ worker: String(d).slice(0, 500) }, 'engine stderr'));
        proc.on('error', (e) => this.onWorkerGone(`engine spawn failed: ${e.message}`));
        proc.on('exit', (code) => {
            if (this.proc === proc)
                this.onWorkerGone(`engine worker exited unexpectedly (code ${code})`);
        });
        return proc;
    }
    /** Line-buffer stdout; stdout is the protocol channel — non-JSON lines are worker bugs. */
    onStdoutData(chunk) {
        this.stdoutBuf += chunk;
        let nl = this.stdoutBuf.indexOf('\n');
        while (nl >= 0) {
            const line = this.stdoutBuf.slice(0, nl).replace(/\r$/, '').trim();
            this.stdoutBuf = this.stdoutBuf.slice(nl + 1);
            if (line)
                this.onStdoutLine(line);
            nl = this.stdoutBuf.indexOf('\n');
        }
    }
    /** Parse one protocol line and settle the in-flight request. */
    onStdoutLine(line) {
        let msg;
        try {
            msg = JSON.parse(line);
        }
        catch {
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
        }
        else {
            const code = this.mapWorkerCode(msg.error?.code);
            const message = String(msg.error?.message || 'engine error');
            req.reject(new AeroEngineError(code, message, code === 'capability_unavailable' ? message : undefined));
        }
        this.pump();
    }
    /** Constrain worker-reported codes to the frozen set — anything else is engine_error. */
    mapWorkerCode(code) {
        if (code === 'capability_unavailable' || code === 'invalid_design' || code === 'inadmissible_input')
            return code;
        return 'engine_error';
    }
    /** Wall-clock expiry: kill the worker tree, 504 the request, restart lazily. */
    onTimeout(id, timeoutMs) {
        const req = this.inFlight;
        if (!req || req.id !== id)
            return;
        this.inFlight = null;
        logger.error({ cmd: req.cmd, timeoutMs }, 'engine command timed out — killing worker');
        this.killWorker('timeout');
        req.reject(new AeroEngineError('engine_timeout', `engine ${req.cmd} exceeded ${Math.round(timeoutMs / 1000)} s and was killed`));
        this.pump();
    }
    /** Worker died under us: fail in-flight, keep queue for a lazy respawn. */
    onWorkerGone(message) {
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
    killWorker(why) {
        const proc = this.proc;
        this.proc = null;
        if (!proc || proc.exitCode !== null)
            return;
        logger.info({ pid: proc.pid, why }, 'killing engine worker');
        try {
            if (process.platform === 'win32' && proc.pid) {
                (0, child_process_1.spawn)('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' });
            }
            else {
                proc.kill('SIGKILL');
            }
        }
        catch (err) {
            logger.error({ err, stack: err.stack }, 'engine worker kill failed');
        }
    }
    /** After 10 idle minutes, end stdin — the worker exits cleanly on EOF (§5c). */
    scheduleIdleKill() {
        this.clearIdleTimer();
        if (!this.proc)
            return;
        this.idleTimer = setTimeout(() => {
            const proc = this.proc;
            if (!proc || this.inFlight || this.queue.length)
                return;
            logger.info({ pid: proc.pid }, 'engine worker idle — shutting down');
            this.proc = null;
            try {
                proc.stdin?.end();
            }
            catch { /* already gone */ }
            const hardKill = setTimeout(() => {
                if (proc.exitCode === null) {
                    try {
                        proc.kill('SIGKILL');
                    }
                    catch { /* already gone */ }
                }
            }, 5_000);
            hardKill.unref();
        }, this.idleTimeoutMs);
        this.idleTimer.unref();
    }
    clearIdleTimer() {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
    }
}
exports.AeroEngineAdapter = AeroEngineAdapter;
