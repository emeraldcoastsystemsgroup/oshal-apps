"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com   | Item E: single-flight auto-install/refresh of the aero-lab engine container (engine/install-engine.sh) on first engine call when a Docker socket is reachable, with failure cooldown and exact refusal preservation when Docker is unavailable or build fails.
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
exports.EngineAutoInstaller = void 0;
exports.hasDockerSocket = hasDockerSocket;
exports.isInstallableFailure = isInstallableFailure;
exports.runInstallScript = runInstallScript;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const child_process_1 = require("child_process");
const logger_1 = require("@/shared/logger");
const logger = (0, logger_1.createChildLogger)({ module: 'aero-engine-installer' });
const DEFAULT_INSTALL_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_COOLDOWN_MS = 60_000;
const INSTALLABLE_RE = /not running|out of date|did not identify itself/i;
/**
 * @description Check whether a Docker socket/endpoint is reachable on this host/container.
 * @param env - Environment variables (DOCKER_HOST overrides the default Unix socket).
 * @returns True when a Docker socket exists locally or DOCKER_HOST names a remote daemon.
 */
function hasDockerSocket(env = process.env) {
    const host = (env.DOCKER_HOST || '').trim();
    if (host) {
        if (host.startsWith('unix://'))
            return fs.existsSync(host.slice('unix://'.length));
        return /^(tcp|ssh|https?):\/\//i.test(host);
    }
    return process.platform !== 'win32' && fs.existsSync('/var/run/docker.sock');
}
/**
 * @description Decide whether a container failure is recoverable by running install-engine.sh.
 * @param code - Typed engine error code.
 * @param message - Channel failure message.
 * @returns True only for missing or out-of-date engine containers.
 */
function isInstallableFailure(code, message) {
    return code === 'capability_unavailable' && INSTALLABLE_RE.test(message);
}
/**
 * @description Execute `sh <scriptPath>` with a bounded timeout and captured tail logs.
 * @param scriptPath - Absolute path to engine/install-engine.sh.
 * @param timeoutMs - Wall-clock cap for image build + container start + selftest.
 * @returns Success or concise failure summary.
 */
function runInstallScript(scriptPath, timeoutMs = DEFAULT_INSTALL_TIMEOUT_MS) {
    return new Promise((resolve) => {
        let tail = '';
        const append = (chunk) => { tail = (tail + String(chunk)).slice(-2000); };
        let proc;
        try {
            proc = (0, child_process_1.spawn)('sh', [scriptPath], { cwd: path.dirname(scriptPath), stdio: ['ignore', 'pipe', 'pipe'] });
        }
        catch (err) {
            resolve({ ok: false, error: `failed to spawn install-engine.sh: ${err.message}` });
            return;
        }
        let settled = false;
        const done = (result) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timer);
            resolve(result);
        };
        const timer = setTimeout(() => {
            try {
                proc.kill('SIGKILL');
            }
            catch { /* already exited */ }
            done({ ok: false, error: `install-engine.sh exceeded ${Math.round(timeoutMs / 1000)} s` });
        }, timeoutMs);
        timer.unref();
        proc.stdout?.on('data', append);
        proc.stderr?.on('data', append);
        proc.on('error', (err) => done({ ok: false, error: err.message }));
        proc.on('exit', (code) => {
            if (code === 0) {
                done({ ok: true });
                return;
            }
            const detail = tail.trim().split(/\r?\n/).slice(-3).join(' | ');
            done({ ok: false, error: `install-engine.sh exited ${String(code)}${detail ? `: ${detail}` : ''}` });
        });
    });
}
/**
 * @description Single-flight coordinator that auto-installs or refreshes the aero-lab engine
 * container on the first missing/stale call when a Docker socket is present.
 */
class EngineAutoInstaller {
    scriptPath;
    enabled;
    runner;
    cooldownMs;
    now;
    inFlight = null;
    lastFailureAt = -Infinity;
    lastError = null;
    constructor(opts) {
        const env = opts.env ?? process.env;
        this.scriptPath = path.join(opts.engineDir, 'install-engine.sh');
        this.runner = opts.runInstaller ?? runInstallScript;
        this.cooldownMs = opts.cooldownMs ?? DEFAULT_COOLDOWN_MS;
        this.now = opts.now ?? (() => Date.now());
        const envDisabled = env.AERO_LAB_AUTO_INSTALL === '0' || env.AERO_LAB_AUTO_INSTALL === 'false';
        const scriptExists = fs.existsSync(this.scriptPath);
        const dockerOk = opts.dockerAvailable ?? hasDockerSocket(env);
        const targetEligible = opts.autoInstall === true
            || (opts.autoInstall !== false && (opts.engineAddr === opts.defaultAddr || env.AERO_LAB_AUTO_INSTALL === '1'));
        this.enabled = !envDisabled && scriptExists && dockerOk && targetEligible;
    }
    /** Whether automatic installation is allowed in this environment. */
    canAttempt() {
        return this.enabled;
    }
    /**
     * @description Ensure the engine container is installed/refreshed, coalescing concurrent callers.
     * @param triggerReason - Why the container was unavailable (for logs).
     * @returns Whether the install succeeded and the engine call should be retried.
     */
    ensureInstalled(triggerReason) {
        if (!this.enabled)
            return Promise.resolve({ ok: false, attempted: false });
        if (this.inFlight)
            return this.inFlight;
        if (this.now() - this.lastFailureAt < this.cooldownMs) {
            return Promise.resolve({ ok: false, attempted: false, error: this.lastError ?? 'install cooldown active' });
        }
        logger.info({ scriptPath: this.scriptPath, triggerReason }, 'auto-installing aero-lab engine container');
        const run = this.runner(this.scriptPath)
            .then((res) => {
            if (res.ok) {
                this.lastFailureAt = -Infinity;
                this.lastError = null;
                logger.info({ scriptPath: this.scriptPath }, 'aero-lab engine container auto-install succeeded');
                return { ok: true, attempted: true };
            }
            this.lastFailureAt = this.now();
            this.lastError = res.error || 'install-engine.sh failed';
            logger.warn({ scriptPath: this.scriptPath, error: this.lastError }, 'aero-lab engine container auto-install failed');
            return { ok: false, attempted: true, error: this.lastError };
        })
            .catch((err) => {
            this.lastFailureAt = this.now();
            this.lastError = err.message || String(err);
            logger.warn({ err, scriptPath: this.scriptPath }, 'aero-lab engine container auto-install threw');
            return { ok: false, attempted: true, error: this.lastError };
        })
            .finally(() => {
            this.inFlight = null;
        });
        this.inFlight = run;
        return run;
    }
}
exports.EngineAutoInstaller = EngineAutoInstaller;
