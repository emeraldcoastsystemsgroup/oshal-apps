/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Initial creation — the SYNCHRONOUS client to the physics engine container. The simulation steps in a plain synchronous loop (advance → stepDrone → guards) and must stay deterministic, so a request to the plant cannot be a promise: the socket lives in a worker thread (bridge-worker) and this class posts a request line and blocks on Atomics.wait until the response lands in the shared buffer. The hello (protocol, engine version, build hash) is verified before the first request; a bridge that is down, slow or speaking another protocol raises a typed EngineFailure the routes turn into an honest 503 naming the install command.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Two links, one contract (B20): `lines` is the container's JSON-lines bridge we dial by address; `http` is the swarm node rail — a node that joined by heartbeat, commanded at the endpoint it declared under the swarm service secret, its hello the one it heartbeat in (checked exactly as a dialled hello is: protocol, and the build hash for a plant node). The bridge names the node it speaks for (nodeId, link, endpoint) so a world can say which node flies it.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | callAsync: the same request without blocking the event loop, for the ops that take seconds (the arm's physics check). One request at a time per bridge either way.
 */

import path from 'node:path';
import { Worker } from 'node:worker_threads';

/** The bridge wire version this client speaks (PROTOCOL in embodied_worker.py). */
export const BRIDGE_PROTOCOL = 1;
export const DEFAULT_ENGINE_ADDR = 'embodied-engine:7413';
export const DEFAULT_INSTALL_HINT = 'docker exec <api-container> sh /app/workspace-shared/deployed-apps/embodied/engine/install-engine.sh';
/** The node we dial by address, when it has not introduced itself by heartbeat. */
/** How often a non-blocking wait looks for the worker's answer (ms). */
export const ASYNC_POLL_MS = 5;

export const BRIDGE_NODE_ID = 'embodied-engine';

export type EngineFailureCode = 'capability_unavailable' | 'engine_error' | 'engine_timeout' | 'protocol_mismatch';

/** @description A typed engine failure; `reason` carries the honest explanation for a 503 body. */
export class EngineFailure extends Error {
  constructor(readonly code: EngineFailureCode, message: string, readonly reason?: string) { super(message); this.name = 'EngineFailure'; }
}

export interface BridgeHello { protocol: number; engine: string; version: string; buildHash: string }

/** How the bridge reaches the node: the container we dial (`bridge`) or a node that dialled us by heartbeat (`rail`). */
export type NodeLink = 'bridge' | 'rail';

export interface SyncBridgeOptions {
  /** `lines` (default): the JSON-lines TCP bridge at host:port. `http`: the node rail — command envelopes POSTed to `endpoint`. */
  transport?: 'lines' | 'http';
  host?: string;
  port?: number;
  /** Node rail: the base URL the node declared in its heartbeat. */
  endpoint?: string;
  /** Node rail: the swarm service secret sent as X-Service-Secret on every envelope. */
  secret?: string;
  /** Node rail: the hello the node heartbeat in — protocol, engine, version, build hash. */
  hello?: BridgeHello;
  /** The node's id on the swarm; the dialled bridge defaults to BRIDGE_NODE_ID. */
  nodeId?: string;
  /** Wall-clock budget per request (a physics step is milliseconds; a depth sweep tens of them). */
  timeoutMs?: number;
  /** Shared response buffer; a depth-camera sweep is about 1.5 MB. */
  maxBytes?: number;
  /** Build hash of THIS package's engine tree, when known: a stale container is refused before the first request. */
  expectedBuildHash?: string | null;
}

interface WireReply { id?: number; ok: boolean; result?: unknown; error?: string; reason?: string }

/** @description Split `host:port`; the default is the stack-network alias the compose file gives the container. */
export function parseEngineAddr(addr: string | undefined): { host: string; port: number } {
  const text = (addr && addr.trim()) || DEFAULT_ENGINE_ADDR;
  const i = text.lastIndexOf(':');
  const port = Number(text.slice(i + 1));
  if (i <= 0 || !Number.isInteger(port) || port <= 0) throw new EngineFailure('engine_error', `bad engine address ${text}`);
  return { host: text.slice(0, i), port };
}

/** @description One blocking connection to a node: the engine bridge we dial, or a node on the rail. Create per process (bridge) or per world (rail), share across sessions; `close` ends the worker. */
export class SyncBridge {
  /** Which node this bridge speaks for, over which link, at which address. */
  readonly nodeId: string;
  readonly link: NodeLink;
  readonly endpoint: string;
  private readonly sab: SharedArrayBuffer;
  private readonly status: Int32Array;
  private readonly bytes: Uint8Array;
  private readonly worker: Worker;
  private readonly timeoutMs: number;
  private nextId = 1;
  private helloSeen: BridgeHello | null = null;
  private dead: EngineFailure | null = null;
  private busy: string | null = null;

  constructor(readonly opts: SyncBridgeOptions) {
    this.sab = new SharedArrayBuffer(8 + (opts.maxBytes ?? 8 * 1024 * 1024));
    this.status = new Int32Array(this.sab, 0, 2);
    this.bytes = new Uint8Array(this.sab, 8);
    this.timeoutMs = opts.timeoutMs ?? 15000;
    const workerFile = path.join(__dirname, 'bridge-worker.js');
    if (opts.transport === 'http') {
      if (!opts.endpoint || !opts.hello || !opts.nodeId) throw new EngineFailure('engine_error', 'a node-rail bridge needs the node\'s endpoint, hello and id');
      if (!opts.secret) throw new EngineFailure('capability_unavailable', 'the swarm service secret is not configured — a node on the rail cannot be commanded', 'SWARM_SERVICE_SECRET is not set');
      this.nodeId = opts.nodeId; this.link = 'rail'; this.endpoint = opts.endpoint.replace(/\/+$/, '');
      this.worker = new Worker(workerFile, { workerData: { transport: 'http', endpoint: this.endpoint, secret: opts.secret, hello: JSON.stringify(opts.hello), timeoutMs: this.timeoutMs, sab: this.sab } });
    } else {
      if (!opts.host || !opts.port) throw new EngineFailure('engine_error', 'a dialled bridge needs host and port');
      this.nodeId = opts.nodeId ?? BRIDGE_NODE_ID; this.link = 'bridge'; this.endpoint = `${opts.host}:${opts.port}`;
      this.worker = new Worker(workerFile, { workerData: { transport: 'lines', host: opts.host, port: opts.port, sab: this.sab } });
    }
    this.worker.unref();
  }

  /** @description Block until the bridge's hello arrives and check it; cached afterwards. */
  hello(): BridgeHello {
    if (this.helloSeen) return this.helloSeen;
    const text = this.awaitLine();
    let parsed: Partial<BridgeHello> & WireReply;
    try { parsed = JSON.parse(text) as Partial<BridgeHello> & WireReply; } catch { throw this.die(new EngineFailure('engine_error', 'the engine bridge sent an unreadable hello')); }
    if (parsed.ok === false) throw this.die(new EngineFailure((parsed.error as EngineFailureCode) ?? 'capability_unavailable', 'the physics engine is unavailable', parsed.reason));
    if (parsed.protocol !== BRIDGE_PROTOCOL) throw this.die(new EngineFailure('protocol_mismatch', `engine bridge protocol ${String(parsed.protocol)} ≠ ${BRIDGE_PROTOCOL}`));
    if (this.opts.expectedBuildHash && parsed.buildHash !== this.opts.expectedBuildHash) throw this.die(new EngineFailure('protocol_mismatch', 'the engine container was built from another engine tree — reinstall it', `container ${String(parsed.buildHash).slice(0, 12)} ≠ package ${this.opts.expectedBuildHash.slice(0, 12)}`));
    this.helloSeen = { protocol: parsed.protocol, engine: String(parsed.engine), version: String(parsed.version), buildHash: String(parsed.buildHash) };
    return this.helloSeen;
  }

  /** @description Send one request and block for its result. */
  call<T = unknown>(op: string, payload: Record<string, unknown> = {}): T {
    if (this.dead) throw this.dead;
    this.hello();
    const id = this.send(op, payload);
    return this.parse<T>(op, id, this.awaitLine());
  }

  /**
   * @description Send one request and wait for its result WITHOUT blocking the event loop: for the ops that run for
   * seconds (the arm's physics check). The stepping loop uses `call`; an api route uses this, and one bridge does one
   * request at a time either way.
   * @param op - The op. @param payload - Its arguments. @param timeoutMs - How long to wait.
   * @returns The result.
   */
  async callAsync<T = unknown>(op: string, payload: Record<string, unknown> = {}, timeoutMs = this.timeoutMs): Promise<T> {
    if (this.dead) throw this.dead;
    if (this.busy) throw new EngineFailure('engine_error', `the physics bridge is busy with ${this.busy}`);
    this.busy = op;
    try {
      this.hello();
      const id = this.send(op, payload);
      return this.parse<T>(op, id, await this.awaitLineAsync(timeoutMs));
    } finally { this.busy = null; }
  }

  private send(op: string, payload: Record<string, unknown>): number {
    const id = this.nextId; this.nextId += 1;
    this.worker.postMessage(JSON.stringify({ id, op, ...payload }));
    return id;
  }

  private parse<T>(op: string, id: number, text: string): T {
    let reply: WireReply;
    try { reply = JSON.parse(text) as WireReply; } catch { throw this.die(new EngineFailure('engine_error', 'the engine bridge sent an unreadable reply')); }
    if (!reply.ok) {
      const code = reply.error === 'capability_unavailable' ? 'capability_unavailable' : 'engine_error';
      const failure = new EngineFailure(code, `physics engine ${op} failed`, reply.reason ?? reply.error);
      if (code === 'capability_unavailable') this.die(failure);
      throw failure;
    }
    if (reply.id !== undefined && reply.id !== id) throw this.die(new EngineFailure('engine_error', `engine bridge answered request ${String(reply.id)} to request ${id}`));
    return reply.result as T;
  }

  /** @description End the worker; every later call fails closed. */
  close(): void {
    this.dead = this.dead ?? new EngineFailure('capability_unavailable', 'the physics bridge was closed');
    void this.worker.terminate();
  }

  private die(failure: EngineFailure): EngineFailure {
    this.dead = failure;
    void this.worker.terminate();
    return failure;
  }

  /** @description Wait for the worker's answer without holding the thread: the api answers other callers meanwhile. */
  private async awaitLineAsync(timeoutMs: number): Promise<string> {
    const deadline = Date.now() + timeoutMs;
    while (Atomics.load(this.status, 0) === 0) {
      if (Date.now() > deadline) throw this.die(new EngineFailure('engine_timeout', `the physics engine did not answer within ${timeoutMs} ms`));
      await new Promise((resolve) => { setTimeout(resolve, ASYNC_POLL_MS); });
    }
    return this.readLine();
  }

  private awaitLine(): string {
    const outcome = Atomics.wait(this.status, 0, 0, this.timeoutMs);
    if (outcome === 'timed-out') throw this.die(new EngineFailure('engine_timeout', `the physics engine did not answer within ${this.timeoutMs} ms`));
    return this.readLine();
  }

  private readLine(): string {
    const state = Atomics.load(this.status, 0);
    const length = Atomics.load(this.status, 1);
    const text = Buffer.from(this.bytes.subarray(0, length)).toString('utf8');
    Atomics.store(this.status, 0, 0);
    if (state === 2) {
      let reason = text;
      try { reason = String((JSON.parse(text) as WireReply).reason ?? text); } catch { /* the raw text is the reason */ }
      throw this.die(new EngineFailure('capability_unavailable', 'the physics engine is unavailable', reason));
    }
    return text;
  }
}
