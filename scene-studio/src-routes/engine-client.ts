/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the api's client to the Scene Studio engine
 *                     |                             | container's TCP bridge (the cad-studio client's shape): one
 *                     |                             | persistent connection, requests serialised through a bounded
 *                     |                             | FIFO, the hello verified (protocol + build hash) before the
 *                     |                             | first byte of a request leaves, per-request wall-clock
 *                     |                             | timeouts, idle shutdown, and typed failures the routes turn
 *                     |                             | into honest 503s naming the install command. Replies can carry
 *                     |                             | a whole project, so lines are assembled in linear time and
 *                     |                             | bounded. The socket factory is injectable for the specs.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Reuse the client through admitted native RPC without adding process network access.
 */

import net from 'node:net';
import { createChildLogger } from '@/shared/logger';

const logger = createChildLogger({ module: 'scene-studio-engine-client' });

/** The bridge wire version this client speaks (PROTOCOL in scene_engine_bridge.py). */
export const BRIDGE_PROTOCOL = 1;
export const DEFAULT_ENGINE_ADDR = 'scene-studio-engine:7414';
/** A reply line longer than this is refused (a full project file map, base64, fits well inside). */
export const MAX_LINE_CHARS = 200 * 1024 * 1024;
const UNREACHABLE = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT']);

export type EngineFailureCode = 'capability_unavailable' | 'engine_error' | 'engine_busy' | 'engine_timeout' | 'refused';

/** @description A typed engine failure; `reason` carries the honest explanation for a 503 body. */
export class EngineFailure extends Error {
  constructor(readonly code: EngineFailureCode, message: string, readonly reason?: string) { super(message); this.name = 'EngineFailure'; }
}

function validNativeReply(reply: NativeReply): boolean {
  return reply?.protocol === BRIDGE_PROTOCOL && /^[a-f0-9]{64}$/.test(reply.buildHash)
    && reply.limits?.requestBytes === 12*1024*1024 && reply.limits.replyBytes === 12*1024*1024
    && reply.limits.timeoutMs === 45_000;
}
interface NativeReply { result: unknown; protocol: number; buildHash: string; limits: {requestBytes:number; replyBytes:number; timeoutMs:number} }

export interface EngineClientOptions {
  /** The admitted kernel owns the fixed destination, source hash and caller authority. */
  nativeRequest?: (op: string, fields: Record<string, unknown>, timeoutMs: number) => Promise<NativeReply>;
  host: string;
  port: number;
  /** Build hash of THIS package's engine tree; null when it could not be read. */
  expectedBuildHash: string | null;
  /** The exact command that (re)installs the engine container on this box. */
  installHint: string;
  helloTimeoutMs?: number;
  requestTimeoutMs?: number;
  idleMs?: number;
  maxQueue?: number;
  /** Test seam: a socket factory. */
  connect?: (host: string, port: number) => net.Socket;
}

export interface EngineStatus {
  connected: boolean;
  buildHash: string | null;
  expectedBuildHash: string | null;
  lastError: string | null;
  installHint: string;
  address: string;
  transportLimits?: NativeReply['limits'];
}

interface Pending { id: number; line: string; timeoutMs: number; resolve: (v: unknown) => void; reject: (e: Error) => void }
interface BridgeHello { protocol?: unknown; buildHash?: unknown }

/** Split a byte stream into complete lines in linear time; a partial tail waits for the next chunk. */
export class LineSplitter {
  private parts: string[] = [];
  private size = 0;
  constructor(private readonly onLine: (line: string) => void, private readonly maxChars = MAX_LINE_CHARS, private readonly onOverflow?: () => void) {}
  push(chunk: string): void {
    let start = 0;
    let index = chunk.indexOf('\n');
    while (index !== -1) {
      const piece = chunk.slice(start, index);
      const line = this.parts.length ? this.parts.join('') + piece : piece;
      this.parts = [];
      this.size = 0;
      if (line.trim()) this.onLine(line);
      start = index + 1;
      index = chunk.indexOf('\n', start);
    }
    if (start < chunk.length) {
      const rest = chunk.slice(start);
      this.size += rest.length;
      if (this.size > this.maxChars) { this.parts = []; this.size = 0; this.onOverflow?.(); return; }
      this.parts.push(rest);
    }
  }
}

/**
 * @description The persistent engine connection. Use one per api process.
 */
export class EngineClient {
  private socket: net.Socket | null = null;
  private ready = false;
  private connecting: Promise<void> | null = null;
  private inflight: Pending | null = null;
  private timer: NodeJS.Timeout | null = null;
  private idleTimer: NodeJS.Timeout | null = null;
  private readonly queue: Pending[] = [];
  private nextId = 1;
  private helloHash: string | null = null;
  private lastFailure: EngineFailure | null = null;
  private nativeActive = 0;
  private nativeLimits?: NativeReply['limits'];

  constructor(private readonly opts: EngineClientOptions) {}

  /** @description What the surface shows about the engine. */
  status(): EngineStatus {
    return {
      connected: this.ready, buildHash: this.helloHash, expectedBuildHash: this.opts.nativeRequest ? this.helloHash : this.opts.expectedBuildHash,
      lastError: this.lastFailure ? this.lastFailure.reason || this.lastFailure.message : null,
      installHint: this.opts.installHint, address: this.opts.nativeRequest ? 'native://scene.engine' : `${this.opts.host}:${this.opts.port}`,
      ...(this.nativeLimits ? {transportLimits:this.nativeLimits} : {}),
    };
  }

  /**
   * @description Send one operation and await its result.
   * @param op - Bridge operation (capabilities | new_project | mcp_call | godot_run | preview | export | import_model | ping).
   * @param fields - The operation's fields.
   * @param timeoutMs - Wall clock for THIS request.
   * @returns The bridge's `result`.
   */
  request(op: string, fields: Record<string, unknown> = {}, timeoutMs?: number): Promise<unknown> {
    if (this.opts.nativeRequest) return this.requestNative(op, fields, timeoutMs);
    const max = this.opts.maxQueue ?? 8;
    if (this.queue.length >= max) return Promise.reject(new EngineFailure('engine_busy', `engine queue is full (${max} waiting)`));
    return new Promise<unknown>((resolve, reject) => {
      const id = this.nextId++;
      const line = JSON.stringify({ ...fields, id, op }) + '\n';
      this.queue.push({ id, line, timeoutMs: timeoutMs ?? this.opts.requestTimeoutMs ?? 120_000, resolve, reject });
      this.pump();
    });
  }

  /** The native service verifies protocol/hash and rechecks the original caller before releasing its result. */
  private async requestNative(op: string, fields: Record<string, unknown>, timeoutMs?: number): Promise<unknown> {
    if (this.nativeActive >= (this.opts.maxQueue ?? 8)) throw new EngineFailure('engine_busy', 'native engine queue is full');
    this.nativeActive++;
    const started = Date.now();
    logger.debug({pending:this.nativeActive}, 'Native Scene request entered');
    try {
      const reply = await this.opts.nativeRequest!(op, fields, Math.min(timeoutMs ?? 45_000, 45_000));
      if (!validNativeReply(reply))
        throw new EngineFailure('capability_unavailable', 'native engine proof is invalid');
      this.ready = true; this.helloHash = reply.buildHash; this.nativeLimits = reply.limits; this.lastFailure = null;
      return reply.result;
    } catch (error) {
      this.ready = false;
      this.lastFailure = error instanceof EngineFailure ? error : new EngineFailure('capability_unavailable', 'native Scene engine request refused', (error as Error).message);
      logger.error({err:new Error('Native Scene request refused'), durationMs:Date.now()-started}, 'Native Scene request refused');
      throw this.lastFailure;
    } finally {
      this.nativeActive--;
      logger.debug({durationMs:Date.now()-started, pending:this.nativeActive}, 'Native Scene request exited');
    }
  }

  /** @description Close the connection; anything in flight or queued is rejected. */
  close(why = 'closed'): void {
    if (this.inflight || this.queue.length) { this.failAll(new EngineFailure('engine_error', `engine client closed (${why})`), why); return; }
    this.teardown(why);
  }

  private teardown(why: string): void {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    const socket = this.socket;
    this.socket = null; this.ready = false; this.connecting = null;
    if (socket) { logger.info({ why }, 'closing engine connection'); socket.destroy(); }
  }

  private pump(): void {
    if (this.inflight || !this.queue.length) return;
    this.ensure().then(() => {
      if (this.inflight || !this.queue.length || !this.socket) return;
      const next = this.queue.shift() as Pending;
      this.inflight = next;
      this.socket.write(next.line);
      this.timer = setTimeout(() => {
        this.failAll(new EngineFailure('engine_timeout', `engine did not answer within ${Math.round(next.timeoutMs / 1000)} s`), 'request timeout');
      }, next.timeoutMs);
    }, (err: Error) => { this.failAll(err instanceof EngineFailure ? err : new EngineFailure('engine_error', err.message), 'connect failed'); });
  }

  private ensure(): Promise<void> {
    if (this.ready) return Promise.resolve();
    if (this.connecting) return this.connecting;
    this.connecting = new Promise<void>((resolve, reject) => this.open(resolve, reject));
    return this.connecting;
  }

  private open(resolve: () => void, reject: (e: Error) => void): void {
    const connect = this.opts.connect ?? ((host: string, port: number) => net.connect({ host, port }));
    const socket = connect(this.opts.host, this.opts.port);
    this.socket = socket;
    socket.setEncoding('utf8');
    socket.setNoDelay(true);
    let helloDone = false;
    const settle = (failure: EngineFailure | null): void => {
      if (helloDone) return;
      helloDone = true; clearTimeout(helloTimer);
      if (failure) { socket.destroy(); reject(failure); return; }
      this.ready = true; this.connecting = null; resolve();
    };
    const helloMs = this.opts.helloTimeoutMs ?? 15_000;
    const helloTimer = setTimeout(() => settle(this.unavailable(`engine container at ${this.where()} did not identify itself within ${Math.round(helloMs / 1000)} s`)), helloMs);
    helloTimer.unref();
    // Events from a socket this client has already replaced must never touch the live connection.
    const current = (): boolean => this.socket === socket;
    const splitter = new LineSplitter(
      (line) => { if (!helloDone) settle(this.verifyHello(line)); else this.onLine(line); },
      MAX_LINE_CHARS,
      () => { if (current()) this.failAll(new EngineFailure('engine_error', 'engine reply exceeded the line limit'), 'oversized reply'); },
    );
    socket.on('data', (chunk: string) => { if (current()) splitter.push(chunk); });
    socket.on('error', (err: NodeJS.ErrnoException) => {
      const failure = err.code && UNREACHABLE.has(err.code) ? this.unavailable(`engine container is not running at ${this.where()} (${err.code})`) : new EngineFailure('engine_error', `engine connection failed: ${err.message}`);
      settle(failure);
      if (current()) this.failAll(failure, 'socket error');
    });
    socket.on('close', () => {
      settle(this.unavailable(`engine container at ${this.where()} closed the connection before identifying itself`));
      if (current()) this.failAll(new EngineFailure('engine_error', 'engine container closed the connection'), 'socket closed');
    });
  }

  private verifyHello(line: string): EngineFailure | null {
    let msg: { bridge?: BridgeHello; error?: { code?: string; message?: string } };
    try { msg = JSON.parse(line) as typeof msg; } catch { return this.unavailable(`${this.where()} did not answer the Scene Studio engine protocol`); }
    if (msg.error) return msg.error.code === 'engine_busy' ? new EngineFailure('engine_busy', String(msg.error.message || 'engine container has no free connection slot')) : this.unavailable(String(msg.error.message || 'engine container refused the connection'));
    const hello = msg.bridge || {};
    if (hello.protocol !== BRIDGE_PROTOCOL) return this.unavailable(`engine container speaks bridge protocol ${String(hello.protocol)}, this package needs ${BRIDGE_PROTOCOL}`);
    if (!this.opts.expectedBuildHash) return this.unavailable("this package's engine tree could not be read, so the engine container build cannot be verified");
    this.helloHash = typeof hello.buildHash === 'string' ? hello.buildHash : null;
    if (hello.buildHash !== this.opts.expectedBuildHash) return this.unavailable(`engine container is out of date: it was built from engine ${String(hello.buildHash).slice(0, 12)}, this package ships ${this.opts.expectedBuildHash.slice(0, 12)}`);
    this.lastFailure = null;
    return null;
  }

  private onLine(line: string): void {
    let msg: { id?: unknown; ok?: boolean; result?: unknown; error?: { code?: string; message?: string } };
    try { msg = JSON.parse(line) as typeof msg; } catch { logger.warn({ head: line.slice(0, 120) }, 'engine sent a non-JSON line'); return; }
    const current = this.inflight;
    if (!current || msg.id !== current.id) { logger.warn({ id: msg.id }, 'engine answered an unknown request id'); return; }
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.inflight = null;
    if (msg.ok) current.resolve(msg.result);
    else current.reject(new EngineFailure(errorCode(msg.error?.code), String(msg.error?.message || 'engine error')));
    this.touchIdle();
    this.pump();
  }

  private failAll(failure: EngineFailure, why: string): void {
    this.lastFailure = failure;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const current = this.inflight; this.inflight = null;
    this.teardown(why);
    if (current) current.reject(failure);
    for (const pending of this.queue.splice(0)) pending.reject(failure);
  }

  private touchIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.close('idle'), this.opts.idleMs ?? 600_000);
    this.idleTimer.unref();
  }

  private where(): string { return `${this.opts.host}:${this.opts.port}`; }
  private unavailable(message: string): EngineFailure {
    return new EngineFailure('capability_unavailable', message, `${message} — install or rebuild it: ${this.opts.installHint}`);
  }
}

/** The bridge's error code mapped to the client's failure codes. */
function errorCode(code: string | undefined): EngineFailureCode {
  if (code === 'refused') return 'refused';
  if (code === 'engine_timeout') return 'engine_timeout';
  if (code === 'engine_busy') return 'engine_busy';
  return 'engine_error';
}

/**
 * @description Parse `host:port` (the SCENE_STUDIO_ENGINE_ADDR form).
 * @param value - Address string.
 * @returns Host and port.
 */
export function parseEngineAddr(value: string | undefined): { host: string; port: number } {
  const text = (value || DEFAULT_ENGINE_ADDR).trim();
  const m = /^(.+):(\d{1,5})$/.exec(text);
  if (!m) throw new Error(`invalid engine address "${text}" (expected host:port)`);
  return { host: m[1], port: Number(m[2]) };
}
