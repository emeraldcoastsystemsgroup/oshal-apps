/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Initial creation — the SYNCHRONOUS client to the physics engine container. The simulation steps in a plain synchronous loop (advance → stepDrone → guards) and must stay deterministic, so a request to the plant cannot be a promise: the socket lives in a worker thread (bridge-worker) and this class posts a request line and blocks on Atomics.wait until the response lands in the shared buffer. The hello (protocol, engine version, build hash) is verified before the first request; a bridge that is down, slow or speaking another protocol raises a typed EngineFailure the routes turn into an honest 503 naming the install command.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | Two links, one contract (B20): `lines` is the container's JSON-lines bridge we dial by address; `http` is the swarm node rail — a node that joined by heartbeat, commanded at the endpoint it declared under the swarm service secret, its hello the one it heartbeat in (checked exactly as a dialled hello is: protocol, and the build hash for a plant node). The bridge names the node it speaks for (nodeId, link, endpoint) so a world can say which node flies it.
 * 3   | maintainer@emeraldcoastsystemsgroup.com     | callAsync: the same request without blocking the event loop, for the ops that take seconds (the arm's physics check). One request at a time per bridge either way.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | The node rail authenticates commands with the node's command key (x-node-command-key), not the swarm service secret (ADR-175 hardening).
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | `native`: inside the native kernel's sandbox (no network) the bridge reaches the container through the kernel's engine.exchange intent, which is asynchronous: `callAsync` and `helloAsync` work (reports, status, the arm check), while the synchronous `call` a stepping physics world needs refuses with capability_unavailable naming why.
 * 6 | maintainer@emeraldcoastsystemsgroup.com   | B30 gate: a refused reply's own code rides on EngineFailure.refusal, so the hexapod certify route answers report_not_found as 404 and no_policy as 422 instead of the engine's 503.
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
  /** @param refusal - The engine's own refusal code when the reply was `ok: false` (the exception class name the bridge wrote), so a route can answer a named refusal with its own status instead of the engine's 503. */
  constructor(readonly code: EngineFailureCode, message: string, readonly reason?: string, readonly refusal?: string) { super(message); this.name = 'EngineFailure'; }
}

export interface BridgeHello { protocol: number; engine: string; version: string; buildHash: string }

/** How the bridge reaches the node: the container we dial (`bridge`) or a node that dialled us by heartbeat (`rail`). */
export type NodeLink = 'bridge' | 'rail';

/** What the kernel's `engine.exchange` intent answers: the engine's own hello and its reply to the request. */
export interface NativeExchange { hello: unknown; reply: unknown }

/** The kernel relays one engine request within the 60 s process call; keep a margin. */
export const NATIVE_MAX_MS = 55_000;

export interface SyncBridgeOptions {
  /** `lines` (default): the JSON-lines TCP bridge at host:port. `http`: the node rail — command envelopes POSTed to `endpoint`. `native`: the kernel's engine.exchange intent. */
  transport?: 'lines' | 'http' | 'native';
  /** Native kernel: send one request through the kernel's `engine.exchange` intent. */
  exchange?: (request: Record<string, unknown>, timeoutMs: number) => Promise<NativeExchange>;
  host?: string;
  port?: number;
  /** Node rail: the base URL the node declared in its heartbeat. */
  endpoint?: string;
  /** Node rail: the node's command key (from its fleet record), sent as x-node-command-key on every envelope. */
  commandKey?: string;
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
  private readonly worker: Worker | null;
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
    if (opts.transport === 'native') {
      if (!opts.exchange) throw new EngineFailure('engine_error', 'a native bridge needs the kernel exchange');
      this.nodeId = BRIDGE_NODE_ID; this.link = 'bridge'; this.endpoint = 'native://engine.exchange';
      this.worker = null;
      return;
    }
    if (opts.transport === 'http') {
      if (!opts.endpoint || !opts.hello || !opts.nodeId) throw new EngineFailure('engine_error', 'a node-rail bridge needs the node\'s endpoint, hello and id');
      if (!opts.commandKey) throw new EngineFailure('capability_unavailable', 'the node has no command key yet — wait for its next heartbeat', 'no command key');
      this.nodeId = opts.nodeId; this.link = 'rail'; this.endpoint = opts.endpoint.replace(/\/+$/, '');
      this.worker = new Worker(workerFile, { workerData: { transport: 'http', endpoint: this.endpoint, commandKey: opts.commandKey, hello: JSON.stringify(opts.hello), timeoutMs: this.timeoutMs, sab: this.sab } });
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
    if (this.opts.transport === 'native') throw this.nativeSyncRefusal('hello');
    return this.checkHello(this.awaitLine());
  }

  /** @description The hello without blocking: natively one `status` request through the kernel, otherwise {@link hello}. */
  async helloAsync(): Promise<BridgeHello> {
    if (this.helloSeen || this.opts.transport !== 'native') return this.hello();
    await this.callAsync('status');
    return this.hello();
  }

  /** The synchronous link a stepping world needs does not exist on the native kernel; say so instead of hanging. */
  private nativeSyncRefusal(op: string): EngineFailure {
    return new EngineFailure('capability_unavailable', `physics ${op} needs a synchronous engine link`,
      'the native kernel relays engine requests asynchronously, so a physics world cannot step on it yet; reports, status and the arm check work');
  }

  /** One native request: the engine's hello is checked as on the socket, then its reply is parsed as request 1. */
  private async callNative<T>(op: string, payload: Record<string, unknown>, timeoutMs: number): Promise<T> {
    let answer: NativeExchange;
    try {
      answer = await (this.opts.exchange as NonNullable<SyncBridgeOptions['exchange']>)({ op, ...payload }, Math.min(timeoutMs, NATIVE_MAX_MS));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new EngineFailure(/deadline/.test(message) ? 'engine_timeout' : 'capability_unavailable', 'the physics engine is unavailable', message);
    }
    this.helloSeen = null;
    this.checkHello(JSON.stringify(answer?.hello ?? null));
    return this.parse<T>(op, 1, JSON.stringify(answer.reply ?? null));
  }

  private checkHello(text: string): BridgeHello {
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
    if (this.opts.transport === 'native') throw this.nativeSyncRefusal(op);
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
      if (this.opts.transport === 'native') return await this.callNative<T>(op, payload, timeoutMs);
      this.hello();
      const id = this.send(op, payload);
      return this.parse<T>(op, id, await this.awaitLineAsync(timeoutMs));
    } finally { this.busy = null; }
  }

  private send(op: string, payload: Record<string, unknown>): number {
    const id = this.nextId; this.nextId += 1;
    (this.worker as Worker).postMessage(JSON.stringify({ id, op, ...payload }));
    return id;
  }

  private parse<T>(op: string, id: number, text: string): T {
    let reply: WireReply;
    try { reply = JSON.parse(text) as WireReply; } catch { throw this.die(new EngineFailure('engine_error', 'the engine bridge sent an unreadable reply')); }
    if (!reply.ok) {
      const code = reply.error === 'capability_unavailable' ? 'capability_unavailable' : 'engine_error';
      const failure = new EngineFailure(code, `physics engine ${op} failed`, reply.reason ?? reply.error, typeof reply.error === 'string' ? reply.error : undefined);
      if (code === 'capability_unavailable') this.die(failure);
      throw failure;
    }
    if (reply.id !== undefined && reply.id !== id) throw this.die(new EngineFailure('engine_error', `engine bridge answered request ${String(reply.id)} to request ${id}`));
    return reply.result as T;
  }

  /** @description End the worker; every later call fails closed. */
  close(): void {
    this.dead = this.dead ?? new EngineFailure('capability_unavailable', 'the physics bridge was closed');
    void this.worker?.terminate();
  }

  private die(failure: EngineFailure): EngineFailure {
    if (this.opts.transport === 'native') return failure;
    this.dead = failure;
    void this.worker?.terminate();
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
