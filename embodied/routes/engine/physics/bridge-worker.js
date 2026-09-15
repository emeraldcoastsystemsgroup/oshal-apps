"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Initial creation — the worker-thread half of the synchronous bridge to the physics engine container: it owns the TCP socket, keeps the hello the bridge sent on connect, writes every request line the main thread posts, and hands each response line back through the shared buffer with an Atomics notify. The main thread blocks on that buffer, so the simulation's step stays a plain synchronous call and stays deterministic; this thread is the only place network time exists.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | A second transport, the swarm node rail (ADR-099, B20): a node that joined by heartbeat is commanded by POSTing each request as a {id, command, args} envelope to its declared endpoint under the swarm service secret — the core drone node's command channel — and its hello is the one it heartbeat in. The main thread's blocking contract is unchanged over both.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_net_1 = __importDefault(require("node:net"));
const node_worker_threads_1 = require("node:worker_threads");
/** Shared buffer layout: Int32[0] state (0 waiting, 1 response ready, 2 failure), Int32[1] byte length; bytes from offset 8. */
const init = node_worker_threads_1.workerData;
const status = new Int32Array(init.sab, 0, 2);
const bytes = new Uint8Array(init.sab, 8);
function deliver(text, state) {
    const encoded = Buffer.from(text, 'utf8');
    if (encoded.length > bytes.length) {
        const err = Buffer.from(JSON.stringify({ ok: false, error: 'engine_error', reason: `response of ${encoded.length} bytes exceeds the ${bytes.length}-byte bridge buffer` }), 'utf8');
        bytes.set(err, 0);
        Atomics.store(status, 1, err.length);
        Atomics.store(status, 0, 2);
        Atomics.notify(status, 0);
        return;
    }
    bytes.set(encoded, 0);
    Atomics.store(status, 1, encoded.length);
    Atomics.store(status, 0, state);
    Atomics.notify(status, 0);
}
const unavailable = (reason) => JSON.stringify({ ok: false, error: 'capability_unavailable', reason });
/** The JSON-lines TCP bridge we dial: the hello is the first line the socket sends. */
function runLines(cfg) {
    let hello = null;
    let tail = '';
    const socket = node_net_1.default.createConnection({ host: cfg.host, port: cfg.port });
    socket.setNoDelay(true);
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
        const parts = (tail + chunk).split('\n');
        tail = parts.pop() ?? '';
        for (const line of parts) {
            if (!line.trim())
                continue;
            if (hello === null) {
                hello = line;
                deliver(line, 1);
                continue;
            }
            deliver(line, 1);
        }
    });
    socket.on('error', (err) => deliver(unavailable(`${err.code ?? err.name}: ${err.message}`), 2));
    socket.on('close', () => deliver(unavailable('the engine bridge closed the connection'), 2));
    node_worker_threads_1.parentPort?.on('message', (line) => {
        if (socket.destroyed) {
            deliver(unavailable('the engine bridge is not connected'), 2);
            return;
        }
        socket.write(line + '\n');
    });
}
/** A reason out of a node's error body, or the raw text. */
function reasonOf(text) {
    try {
        const parsed = JSON.parse(text);
        return String(parsed.reason ?? parsed.error ?? text.slice(0, 300));
    }
    catch {
        return text.slice(0, 300);
    }
}
/** The node rail: each request is one command envelope to the node's endpoint; the hello is what the node heartbeat in. */
function runHttp(cfg) {
    const url = `${cfg.endpoint.replace(/\/+$/, '')}/api/drone-node/command`;
    deliver(cfg.hello, 1);
    const post = async (line) => {
        let req;
        try {
            req = JSON.parse(line);
        }
        catch {
            deliver(JSON.stringify({ ok: false, error: 'engine_error', reason: 'unreadable request' }), 1);
            return;
        }
        const { id, op, ...args } = req;
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), cfg.timeoutMs);
        try {
            const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-service-secret': cfg.secret }, body: JSON.stringify({ id, command: op, args }), signal: ctl.signal });
            const text = await res.text();
            if (res.status === 401 || res.status === 403) {
                deliver(unavailable(`the node refused the swarm service secret (HTTP ${res.status})`), 2);
                return;
            }
            if (res.status >= 500) {
                deliver(unavailable(`the node answered HTTP ${res.status}: ${reasonOf(text)}`), 2);
                return;
            }
            if (!res.ok) {
                deliver(JSON.stringify({ id, ok: false, error: 'engine_error', reason: `HTTP ${res.status}: ${reasonOf(text)}` }), 1);
                return;
            }
            deliver(text, 1);
        }
        catch (err) {
            deliver(unavailable(`${err.name}: ${err.message}`), 2);
        }
        finally {
            clearTimeout(timer);
        }
    };
    node_worker_threads_1.parentPort?.on('message', (line) => { void post(line); });
}
if (init.transport === 'http')
    runHttp(init);
else
    runLines(init);
//# sourceMappingURL=bridge-worker.js.map