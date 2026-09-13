"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the api's client to the CAD engine
 *                     |                             | container's TCP bridge: one persistent connection (so the
 *                     |                             | kernel stays warm between iterations), requests serialised
 *                     |                             | through a bounded FIFO, the hello verified (protocol + build
 *                     |                             | hash) before the first byte of a request leaves, per-request
 *                     |                             | wall-clock timeouts that kill the worker by closing the
 *                     |                             | socket, idle shutdown, and typed failures the routes turn
 *                     |                             | into honest 503s naming the install command. The socket
 *                     |                             | factory is injectable so the spec drives it with a fake
 *                     |                             | bridge on loopback.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EngineClient = exports.LineSplitter = exports.EngineFailure = exports.DEFAULT_ENGINE_ADDR = exports.BRIDGE_PROTOCOL = void 0;
exports.parseEngineAddr = parseEngineAddr;
const node_net_1 = __importDefault(require("node:net"));
const logger_1 = require("@/shared/logger");
const logger = (0, logger_1.createChildLogger)({ module: 'cad-studio-engine-client' });
/** The bridge wire version this client speaks (PROTOCOL in cad_engine_bridge.py and cad_worker.py). */
exports.BRIDGE_PROTOCOL = 1;
exports.DEFAULT_ENGINE_ADDR = 'cad-studio-engine:7412';
const UNREACHABLE = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT']);
/** @description A typed engine failure; `reason` carries the honest explanation for a 503 body. */
class EngineFailure extends Error {
    code;
    reason;
    constructor(code, message, reason) {
        super(message);
        this.code = code;
        this.reason = reason;
        this.name = 'EngineFailure';
    }
}
exports.EngineFailure = EngineFailure;
/** Split a byte stream into complete lines; a partial tail waits for the next chunk. */
class LineSplitter {
    onLine;
    tail = '';
    constructor(onLine) {
        this.onLine = onLine;
    }
    push(chunk) {
        const parts = (this.tail + chunk).split('\n');
        this.tail = parts.pop() ?? '';
        for (const part of parts)
            if (part.trim())
                this.onLine(part);
    }
}
exports.LineSplitter = LineSplitter;
/**
 * @description The persistent engine connection. Use one per api process.
 */
class EngineClient {
    opts;
    socket = null;
    ready = false;
    connecting = null;
    inflight = null;
    timer = null;
    idleTimer = null;
    queue = [];
    nextId = 1;
    helloHash = null;
    lastFailure = null;
    constructor(opts) {
        this.opts = opts;
    }
    /** @description What the surface shows about the engine. */
    status() {
        return { connected: this.ready, buildHash: this.helloHash, expectedBuildHash: this.opts.expectedBuildHash, lastError: this.lastFailure ? this.lastFailure.reason || this.lastFailure.message : null, installHint: this.opts.installHint, address: `${this.opts.host}:${this.opts.port}` };
    }
    /**
     * @description Send one command and await its result.
     * @param cmd - Worker command (hello | rebuild | check).
     * @param args - Command arguments.
     * @param timeoutMs - Wall clock for THIS request; the worker is killed when it elapses.
     * @returns The worker's `result`.
     */
    request(cmd, args, timeoutMs) {
        const max = this.opts.maxQueue ?? 8;
        if (this.queue.length >= max)
            return Promise.reject(new EngineFailure('engine_busy', `engine queue is full (${max} waiting)`));
        return new Promise((resolve, reject) => {
            const id = this.nextId++;
            this.queue.push({ id, line: JSON.stringify({ id, cmd, args }) + '\n', timeoutMs: timeoutMs ?? this.opts.requestTimeoutMs ?? 120_000, resolve, reject });
            this.pump();
        });
    }
    /** @description Close the connection (the bridge kills its worker); anything in flight or queued is rejected. */
    close(why = 'closed') {
        if (this.inflight || this.queue.length) {
            this.failAll(new EngineFailure('engine_error', `engine client closed (${why})`), why);
            return;
        }
        this.teardown(why);
    }
    teardown(why) {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
        const socket = this.socket;
        this.socket = null;
        this.ready = false;
        this.connecting = null;
        if (socket) {
            logger.info({ why }, 'closing engine connection');
            socket.destroy();
        }
    }
    pump() {
        if (this.inflight || !this.queue.length)
            return;
        this.ensure().then(() => {
            if (this.inflight || !this.queue.length || !this.socket)
                return;
            const next = this.queue.shift();
            this.inflight = next;
            this.socket.write(next.line);
            this.timer = setTimeout(() => {
                const failure = new EngineFailure('engine_timeout', `engine did not answer within ${Math.round(next.timeoutMs / 1000)} s; the worker was killed`);
                this.failAll(failure, 'request timeout');
            }, next.timeoutMs);
        }, (err) => { this.failAll(err instanceof EngineFailure ? err : new EngineFailure('engine_error', err.message), 'connect failed'); });
    }
    ensure() {
        if (this.ready)
            return Promise.resolve();
        if (this.connecting)
            return this.connecting;
        this.connecting = new Promise((resolve, reject) => {
            const connect = this.opts.connect ?? ((host, port) => node_net_1.default.connect({ host, port }));
            const socket = connect(this.opts.host, this.opts.port);
            this.socket = socket;
            socket.setEncoding('utf8');
            socket.setNoDelay(true);
            let helloDone = false;
            const helloTimer = setTimeout(() => { if (!helloDone) {
                helloDone = true;
                socket.destroy();
                reject(this.unavailable(`engine container at ${this.where()} did not identify itself within ${Math.round((this.opts.helloTimeoutMs ?? 15_000) / 1000)} s`));
            } }, this.opts.helloTimeoutMs ?? 15_000);
            helloTimer.unref();
            const splitter = new LineSplitter((line) => {
                if (!helloDone) {
                    helloDone = true;
                    clearTimeout(helloTimer);
                    const stale = this.verifyHello(line);
                    if (stale) {
                        socket.destroy();
                        reject(stale);
                        return;
                    }
                    this.ready = true;
                    this.connecting = null;
                    resolve();
                    return;
                }
                this.onLine(line);
            });
            // Events from a socket this client has already replaced (a killed worker's connection
            // closing late) must never touch the live connection.
            const current = () => this.socket === socket;
            socket.on('data', (chunk) => { if (current())
                splitter.push(chunk); });
            socket.on('error', (err) => {
                const failure = err.code && UNREACHABLE.has(err.code) ? this.unavailable(`engine container is not running at ${this.where()} (${err.code})`) : new EngineFailure('engine_error', `engine connection failed: ${err.message}`);
                if (!helloDone) {
                    helloDone = true;
                    clearTimeout(helloTimer);
                    reject(failure);
                }
                if (current())
                    this.failAll(failure, 'socket error');
            });
            socket.on('close', () => {
                if (!helloDone) {
                    helloDone = true;
                    clearTimeout(helloTimer);
                    reject(this.unavailable(`engine container at ${this.where()} closed the connection before identifying itself`));
                }
                if (current())
                    this.failAll(new EngineFailure('engine_error', 'engine container closed the connection'), 'socket closed');
            });
        });
        return this.connecting;
    }
    verifyHello(line) {
        let msg;
        try {
            msg = JSON.parse(line);
        }
        catch {
            return this.unavailable(`${this.where()} did not answer the CAD engine bridge protocol`);
        }
        if (msg.error)
            return msg.error.code === 'engine_busy' ? new EngineFailure('engine_busy', String(msg.error.message || 'engine container has no free worker slot')) : this.unavailable(String(msg.error.message || 'engine container refused the connection'));
        const hello = msg.bridge || {};
        if (hello.protocol !== exports.BRIDGE_PROTOCOL)
            return this.unavailable(`engine container speaks bridge protocol ${String(hello.protocol)}, this package needs ${exports.BRIDGE_PROTOCOL}`);
        if (!this.opts.expectedBuildHash)
            return this.unavailable("this package's engine tree could not be read, so the engine container build cannot be verified");
        this.helloHash = typeof hello.buildHash === 'string' ? hello.buildHash : null;
        if (hello.buildHash !== this.opts.expectedBuildHash)
            return this.unavailable(`engine container is out of date: it was built from engine ${String(hello.buildHash).slice(0, 12)}, this package ships ${this.opts.expectedBuildHash.slice(0, 12)}`);
        this.lastFailure = null;
        return null;
    }
    onLine(line) {
        let msg;
        try {
            msg = JSON.parse(line);
        }
        catch {
            logger.warn({ head: line.slice(0, 120) }, 'engine sent a non-JSON line');
            return;
        }
        const current = this.inflight;
        if (!current || msg.id !== current.id) {
            logger.warn({ id: msg.id }, 'engine answered an unknown request id');
            return;
        }
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.inflight = null;
        if (msg.ok)
            current.resolve(msg.result);
        else
            current.reject(new EngineFailure(msg.error?.code === 'refused' ? 'refused' : 'engine_error', String(msg.error?.message || 'engine error')));
        this.touchIdle();
        this.pump();
    }
    failAll(failure, why) {
        this.lastFailure = failure;
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        const current = this.inflight;
        this.inflight = null;
        this.teardown(why);
        if (current)
            current.reject(failure);
        for (const pending of this.queue.splice(0))
            pending.reject(failure);
    }
    touchIdle() {
        if (this.idleTimer)
            clearTimeout(this.idleTimer);
        this.idleTimer = setTimeout(() => this.close('idle'), this.opts.idleMs ?? 600_000);
        this.idleTimer.unref();
    }
    where() { return `${this.opts.host}:${this.opts.port}`; }
    unavailable(message) {
        return new EngineFailure('capability_unavailable', message, `${message} — install or rebuild it: ${this.opts.installHint}`);
    }
}
exports.EngineClient = EngineClient;
/**
 * @description Parse `host:port` (the CAD_STUDIO_ENGINE_ADDR form).
 * @param value - Address string.
 * @returns Host and port.
 */
function parseEngineAddr(value) {
    const text = (value || exports.DEFAULT_ENGINE_ADDR).trim();
    const m = /^(.+):(\d{1,5})$/.exec(text);
    if (!m)
        throw new Error(`invalid engine address "${text}" (expected host:port)`);
    return { host: m[1], port: Number(m[2]) };
}
//# sourceMappingURL=engine-client.js.map