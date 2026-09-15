"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Initial creation — the SYNCHRONOUS client to the physics engine container. The simulation steps in a plain synchronous loop (advance → stepDrone → guards) and must stay deterministic, so a request to the plant cannot be a promise: the socket lives in a worker thread (bridge-worker) and this class posts a request line and blocks on Atomics.wait until the response lands in the shared buffer. The hello (protocol, engine version, build hash) is verified before the first request; a bridge that is down, slow or speaking another protocol raises a typed EngineFailure the routes turn into an honest 503 naming the install command.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Two links, one contract (B20): `lines` is the container's JSON-lines bridge we dial by address; `http` is the swarm node rail — a node that joined by heartbeat, commanded at the endpoint it declared under the swarm service secret, its hello the one it heartbeat in (checked exactly as a dialled hello is: protocol, and the build hash for a plant node). The bridge names the node it speaks for (nodeId, link, endpoint) so a world can say which node flies it.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | callAsync: the same request without blocking the event loop, for the ops that take seconds (the arm's physics check). One request at a time per bridge either way.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SyncBridge = exports.EngineFailure = exports.BRIDGE_NODE_ID = exports.ASYNC_POLL_MS = exports.DEFAULT_INSTALL_HINT = exports.DEFAULT_ENGINE_ADDR = exports.BRIDGE_PROTOCOL = void 0;
exports.parseEngineAddr = parseEngineAddr;
const node_path_1 = __importDefault(require("node:path"));
const node_worker_threads_1 = require("node:worker_threads");
/** The bridge wire version this client speaks (PROTOCOL in embodied_worker.py). */
exports.BRIDGE_PROTOCOL = 1;
exports.DEFAULT_ENGINE_ADDR = 'embodied-engine:7413';
exports.DEFAULT_INSTALL_HINT = 'docker exec <api-container> sh /app/workspace-shared/deployed-apps/embodied/engine/install-engine.sh';
/** The node we dial by address, when it has not introduced itself by heartbeat. */
/** How often a non-blocking wait looks for the worker's answer (ms). */
exports.ASYNC_POLL_MS = 5;
exports.BRIDGE_NODE_ID = 'embodied-engine';
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
/** @description Split `host:port`; the default is the stack-network alias the compose file gives the container. */
function parseEngineAddr(addr) {
    const text = (addr && addr.trim()) || exports.DEFAULT_ENGINE_ADDR;
    const i = text.lastIndexOf(':');
    const port = Number(text.slice(i + 1));
    if (i <= 0 || !Number.isInteger(port) || port <= 0)
        throw new EngineFailure('engine_error', `bad engine address ${text}`);
    return { host: text.slice(0, i), port };
}
/** @description One blocking connection to a node: the engine bridge we dial, or a node on the rail. Create per process (bridge) or per world (rail), share across sessions; `close` ends the worker. */
class SyncBridge {
    opts;
    /** Which node this bridge speaks for, over which link, at which address. */
    nodeId;
    link;
    endpoint;
    sab;
    status;
    bytes;
    worker;
    timeoutMs;
    nextId = 1;
    helloSeen = null;
    dead = null;
    busy = null;
    constructor(opts) {
        this.opts = opts;
        this.sab = new SharedArrayBuffer(8 + (opts.maxBytes ?? 8 * 1024 * 1024));
        this.status = new Int32Array(this.sab, 0, 2);
        this.bytes = new Uint8Array(this.sab, 8);
        this.timeoutMs = opts.timeoutMs ?? 15000;
        const workerFile = node_path_1.default.join(__dirname, 'bridge-worker.js');
        if (opts.transport === 'http') {
            if (!opts.endpoint || !opts.hello || !opts.nodeId)
                throw new EngineFailure('engine_error', 'a node-rail bridge needs the node\'s endpoint, hello and id');
            if (!opts.secret)
                throw new EngineFailure('capability_unavailable', 'the swarm service secret is not configured — a node on the rail cannot be commanded', 'SWARM_SERVICE_SECRET is not set');
            this.nodeId = opts.nodeId;
            this.link = 'rail';
            this.endpoint = opts.endpoint.replace(/\/+$/, '');
            this.worker = new node_worker_threads_1.Worker(workerFile, { workerData: { transport: 'http', endpoint: this.endpoint, secret: opts.secret, hello: JSON.stringify(opts.hello), timeoutMs: this.timeoutMs, sab: this.sab } });
        }
        else {
            if (!opts.host || !opts.port)
                throw new EngineFailure('engine_error', 'a dialled bridge needs host and port');
            this.nodeId = opts.nodeId ?? exports.BRIDGE_NODE_ID;
            this.link = 'bridge';
            this.endpoint = `${opts.host}:${opts.port}`;
            this.worker = new node_worker_threads_1.Worker(workerFile, { workerData: { transport: 'lines', host: opts.host, port: opts.port, sab: this.sab } });
        }
        this.worker.unref();
    }
    /** @description Block until the bridge's hello arrives and check it; cached afterwards. */
    hello() {
        if (this.helloSeen)
            return this.helloSeen;
        const text = this.awaitLine();
        let parsed;
        try {
            parsed = JSON.parse(text);
        }
        catch {
            throw this.die(new EngineFailure('engine_error', 'the engine bridge sent an unreadable hello'));
        }
        if (parsed.ok === false)
            throw this.die(new EngineFailure(parsed.error ?? 'capability_unavailable', 'the physics engine is unavailable', parsed.reason));
        if (parsed.protocol !== exports.BRIDGE_PROTOCOL)
            throw this.die(new EngineFailure('protocol_mismatch', `engine bridge protocol ${String(parsed.protocol)} ≠ ${exports.BRIDGE_PROTOCOL}`));
        if (this.opts.expectedBuildHash && parsed.buildHash !== this.opts.expectedBuildHash)
            throw this.die(new EngineFailure('protocol_mismatch', 'the engine container was built from another engine tree — reinstall it', `container ${String(parsed.buildHash).slice(0, 12)} ≠ package ${this.opts.expectedBuildHash.slice(0, 12)}`));
        this.helloSeen = { protocol: parsed.protocol, engine: String(parsed.engine), version: String(parsed.version), buildHash: String(parsed.buildHash) };
        return this.helloSeen;
    }
    /** @description Send one request and block for its result. */
    call(op, payload = {}) {
        if (this.dead)
            throw this.dead;
        this.hello();
        const id = this.send(op, payload);
        return this.parse(op, id, this.awaitLine());
    }
    /**
     * @description Send one request and wait for its result WITHOUT blocking the event loop: for the ops that run for
     * seconds (the arm's physics check). The stepping loop uses `call`; an api route uses this, and one bridge does one
     * request at a time either way.
     * @param op - The op. @param payload - Its arguments. @param timeoutMs - How long to wait.
     * @returns The result.
     */
    async callAsync(op, payload = {}, timeoutMs = this.timeoutMs) {
        if (this.dead)
            throw this.dead;
        if (this.busy)
            throw new EngineFailure('engine_error', `the physics bridge is busy with ${this.busy}`);
        this.busy = op;
        try {
            this.hello();
            const id = this.send(op, payload);
            return this.parse(op, id, await this.awaitLineAsync(timeoutMs));
        }
        finally {
            this.busy = null;
        }
    }
    send(op, payload) {
        const id = this.nextId;
        this.nextId += 1;
        this.worker.postMessage(JSON.stringify({ id, op, ...payload }));
        return id;
    }
    parse(op, id, text) {
        let reply;
        try {
            reply = JSON.parse(text);
        }
        catch {
            throw this.die(new EngineFailure('engine_error', 'the engine bridge sent an unreadable reply'));
        }
        if (!reply.ok) {
            const code = reply.error === 'capability_unavailable' ? 'capability_unavailable' : 'engine_error';
            const failure = new EngineFailure(code, `physics engine ${op} failed`, reply.reason ?? reply.error);
            if (code === 'capability_unavailable')
                this.die(failure);
            throw failure;
        }
        if (reply.id !== undefined && reply.id !== id)
            throw this.die(new EngineFailure('engine_error', `engine bridge answered request ${String(reply.id)} to request ${id}`));
        return reply.result;
    }
    /** @description End the worker; every later call fails closed. */
    close() {
        this.dead = this.dead ?? new EngineFailure('capability_unavailable', 'the physics bridge was closed');
        void this.worker.terminate();
    }
    die(failure) {
        this.dead = failure;
        void this.worker.terminate();
        return failure;
    }
    /** @description Wait for the worker's answer without holding the thread: the api answers other callers meanwhile. */
    async awaitLineAsync(timeoutMs) {
        const deadline = Date.now() + timeoutMs;
        while (Atomics.load(this.status, 0) === 0) {
            if (Date.now() > deadline)
                throw this.die(new EngineFailure('engine_timeout', `the physics engine did not answer within ${timeoutMs} ms`));
            await new Promise((resolve) => { setTimeout(resolve, exports.ASYNC_POLL_MS); });
        }
        return this.readLine();
    }
    awaitLine() {
        const outcome = Atomics.wait(this.status, 0, 0, this.timeoutMs);
        if (outcome === 'timed-out')
            throw this.die(new EngineFailure('engine_timeout', `the physics engine did not answer within ${this.timeoutMs} ms`));
        return this.readLine();
    }
    readLine() {
        const state = Atomics.load(this.status, 0);
        const length = Atomics.load(this.status, 1);
        const text = Buffer.from(this.bytes.subarray(0, length)).toString('utf8');
        Atomics.store(this.status, 0, 0);
        if (state === 2) {
            let reason = text;
            try {
                reason = String(JSON.parse(text).reason ?? text);
            }
            catch { /* the raw text is the reason */ }
            throw this.die(new EngineFailure('capability_unavailable', 'the physics engine is unavailable', reason));
        }
        return text;
    }
}
exports.SyncBridge = SyncBridge;
//# sourceMappingURL=bridge-client.js.map