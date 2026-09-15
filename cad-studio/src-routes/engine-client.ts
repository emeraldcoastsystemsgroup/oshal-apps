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
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Cancel (BACKLOG B5): a request may carry a tag; cancel(tag)
 *                     |                             | removes it from the queue, or — when it is the one in flight —
 *                     |                             | closes the connection (the bridge kills its worker, freeing
 *                     |                             | the kernel mid-feature) and re-sends every OTHER queued
 *                     |                             | request on a fresh connection. A typed `cancelled` failure.
 */

import net from 'node:net';
import { createChildLogger } from '@/shared/logger';

const logger = createChildLogger({ module: 'cad-studio-engine-client' });

/** The bridge wire version this client speaks (PROTOCOL in cad_engine_bridge.py and cad_worker.py). */
export const BRIDGE_PROTOCOL = 1;
export const DEFAULT_ENGINE_ADDR = 'cad-studio-engine:7412';
const UNREACHABLE = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT']);

export type EngineFailureCode = 'capability_unavailable' | 'engine_error' | 'engine_busy' | 'engine_timeout' | 'refused' | 'cancelled';

/** @description A typed engine failure; `reason` carries the honest explanation for a 503 body. */
export class EngineFailure extends Error {
  constructor(readonly code: EngineFailureCode, message: string, readonly reason?: string) { super(message); this.name = 'EngineFailure'; }
}

export interface EngineClientOptions {
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

interface Pending { id: number; line: string; timeoutMs: number; tag?: string; resolve: (v: unknown) => void; reject: (e: Error) => void }
interface BridgeHello { protocol?: unknown; buildHash?: unknown }

/** Split a byte stream into complete lines; a partial tail waits for the next chunk. */
export class LineSplitter {
  private tail = '';
  constructor(private readonly onLine: (line: string) => void) {}
  push(chunk: string): void {
    const parts = (this.tail + chunk).split('\n');
    this.tail = parts.pop() ?? '';
    for (const part of parts) if (part.trim()) this.onLine(part);
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

  constructor(private readonly opts: EngineClientOptions) {}

  /** @description What the surface shows about the engine. */
  status(): { connected: boolean; buildHash: string | null; expectedBuildHash: string | null; lastError: string | null; installHint: string; address: string } {
    return { connected: this.ready, buildHash: this.helloHash, expectedBuildHash: this.opts.expectedBuildHash, lastError: this.lastFailure ? this.lastFailure.reason || this.lastFailure.message : null, installHint: this.opts.installHint, address: `${this.opts.host}:${this.opts.port}` };
  }

  /**
   * @description Send one command and await its result.
   * @param cmd - Worker command (hello | rebuild | check).
   * @param args - Command arguments.
   * @param timeoutMs - Wall clock for THIS request; the worker is killed when it elapses.
   * @param tag - Optional owner-scoped handle that {@link cancel} can name (one model's rebuild).
   * @returns The worker's `result`.
   */
  request(cmd: string, args: unknown, timeoutMs?: number, tag?: string): Promise<unknown> {
    const max = this.opts.maxQueue ?? 8;
    if (this.queue.length >= max) return Promise.reject(new EngineFailure('engine_busy', `engine queue is full (${max} waiting)`));
    return new Promise<unknown>((resolve, reject) => {
      const id = this.nextId++;
      this.queue.push({ id, line: JSON.stringify({ id, cmd, args }) + '\n', timeoutMs: timeoutMs ?? this.opts.requestTimeoutMs ?? 120_000, tag, resolve, reject });
      this.pump();
    });
  }

  /**
   * @description Cancel the request carrying `tag`. A queued one is dropped and nothing else is
   * touched. The one in flight cannot be recalled from the worker (a kernel call holds it), so the
   * connection is closed — the bridge kills that worker — and every other queued request is sent
   * again on a fresh connection; other callers never see this caller's cancel.
   * @param tag - The handle given to {@link request}.
   * @param why - Recorded in the `cancelled` failure.
   * @returns Where the request was ('inflight' | 'queued'), or null when nothing carries the tag.
   */
  cancel(tag: string, why = 'cancelled'): 'inflight' | 'queued' | null {
    const failure = new EngineFailure('cancelled', `rebuild cancelled (${why}); the engine worker was stopped`);
    if (this.inflight && this.inflight.tag === tag) {
      const current = this.inflight;
      this.inflight = null;
      if (this.timer) { clearTimeout(this.timer); this.timer = null; }
      this.teardown(`cancel: ${why}`);
      current.reject(failure);
      logger.info({ tag, queued: this.queue.length }, 'in-flight engine request cancelled; connection closed');
      this.pump();
      return 'inflight';
    }
    const index = this.queue.findIndex((p) => p.tag === tag);
    if (index < 0) return null;
    const [queued] = this.queue.splice(index, 1);
    queued.reject(new EngineFailure('cancelled', `rebuild cancelled (${why}) before it reached the engine`));
    return 'queued';
  }

  /** @description Close the connection (the bridge kills its worker); anything in flight or queued is rejected. */
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
        const failure = new EngineFailure('engine_timeout', `engine did not answer within ${Math.round(next.timeoutMs / 1000)} s; the worker was killed`);
        this.failAll(failure, 'request timeout');
      }, next.timeoutMs);
    }, (err: Error) => { this.failAll(err instanceof EngineFailure ? err : new EngineFailure('engine_error', err.message), 'connect failed'); });
  }

  private ensure(): Promise<void> {
    if (this.ready) return Promise.resolve();
    if (this.connecting) return this.connecting;
    this.connecting = new Promise<void>((resolve, reject) => {
      const connect = this.opts.connect ?? ((host: string, port: number) => net.connect({ host, port }));
      const socket = connect(this.opts.host, this.opts.port);
      this.socket = socket;
      socket.setEncoding('utf8');
      socket.setNoDelay(true);
      let helloDone = false;
      const helloTimer = setTimeout(() => { if (!helloDone) { helloDone = true; socket.destroy(); reject(this.unavailable(`engine container at ${this.where()} did not identify itself within ${Math.round((this.opts.helloTimeoutMs ?? 15_000) / 1000)} s`)); } }, this.opts.helloTimeoutMs ?? 15_000);
      helloTimer.unref();
      const splitter = new LineSplitter((line) => {
        if (!helloDone) {
          helloDone = true; clearTimeout(helloTimer);
          const stale = this.verifyHello(line);
          if (stale) { socket.destroy(); reject(stale); return; }
          this.ready = true; this.connecting = null; resolve();
          return;
        }
        this.onLine(line);
      });
      // Events from a socket this client has already replaced (a killed worker's connection
      // closing late) must never touch the live connection.
      const current = () => this.socket === socket;
      socket.on('data', (chunk: string) => { if (current()) splitter.push(chunk); });
      socket.on('error', (err: NodeJS.ErrnoException) => {
        const failure = err.code && UNREACHABLE.has(err.code) ? this.unavailable(`engine container is not running at ${this.where()} (${err.code})`) : new EngineFailure('engine_error', `engine connection failed: ${err.message}`);
        if (!helloDone) { helloDone = true; clearTimeout(helloTimer); reject(failure); }
        if (current()) this.failAll(failure, 'socket error');
      });
      socket.on('close', () => {
        if (!helloDone) { helloDone = true; clearTimeout(helloTimer); reject(this.unavailable(`engine container at ${this.where()} closed the connection before identifying itself`)); }
        if (current()) this.failAll(new EngineFailure('engine_error', 'engine container closed the connection'), 'socket closed');
      });
    });
    return this.connecting;
  }

  private verifyHello(line: string): EngineFailure | null {
    let msg: { bridge?: BridgeHello; error?: { code?: string; message?: string } };
    try { msg = JSON.parse(line) as typeof msg; } catch { return this.unavailable(`${this.where()} did not answer the CAD engine bridge protocol`); }
    if (msg.error) return msg.error.code === 'engine_busy' ? new EngineFailure('engine_busy', String(msg.error.message || 'engine container has no free worker slot')) : this.unavailable(String(msg.error.message || 'engine container refused the connection'));
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
    else current.reject(new EngineFailure(msg.error?.code === 'refused' ? 'refused' : 'engine_error', String(msg.error?.message || 'engine error')));
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

/**
 * @description Parse `host:port` (the CAD_STUDIO_ENGINE_ADDR form).
 * @param value - Address string.
 * @returns Host and port.
 */
export function parseEngineAddr(value: string | undefined): { host: string; port: number } {
  const text = (value || DEFAULT_ENGINE_ADDR).trim();
  const m = /^(.+):(\d{1,5})$/.exec(text);
  if (!m) throw new Error(`invalid engine address "${text}" (expected host:port)`);
  return { host: m[1], port: Number(m[2]) };
}
