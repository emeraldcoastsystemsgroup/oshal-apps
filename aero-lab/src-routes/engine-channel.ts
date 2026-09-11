/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial implementation — the byte pipe
 *   |                                           | between the adapter and one engine worker, as
 *   |                                           | an interface both transports implement: the
 *   |                                           | local child process (engine-adapter.ts) and
 *   |                                           | the engine CONTAINER's TCP bridge (here). The
 *   |                                           | container channel verifies the bridge hello
 *   |                                           | (protocol + build hash) before any request
 *   |                                           | leaves, and unpacks inline export files into
 *   |                                           | the api-side workDir the download route reads.
 */

import * as fs from 'fs';
import * as net from 'net';
import * as path from 'path';
import { createChildLogger } from '@/shared/logger';

const logger = createChildLogger({ module: 'aero-engine-channel' });

/** The bridge wire version this adapter speaks (PROTOCOL in aero_engine_bridge.py). */
export const BRIDGE_PROTOCOL = 1;

const HELLO_TIMEOUT_MS = 15_000;
const EXPORT_ID_RE = /^exp-[0-9a-f]{12}$/;
const UNREACHABLE = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT']);

/** Why a channel ended — the adapter turns it into a typed AeroEngineError. */
export interface ChannelFailure {
  code: 'capability_unavailable' | 'engine_error' | 'engine_busy';
  message: string;
  /** Honest explanation for 503 capability_unavailable bodies. */
  reason?: string;
}

/** Callbacks a channel drives. Neither fires after the adapter itself ends the channel. */
export interface ChannelHandlers {
  /** One complete protocol line from the worker. */
  onLine(line: string): void;
  /** The channel ended on its own (crash, refusal, stale build, dropped connection). */
  onGone(failure: ChannelFailure): void;
}

/** The pipe to one engine worker. */
export interface EngineChannel {
  /** Queue one protocol line; false when the channel can no longer take writes. */
  write(line: string): boolean;
  /** Graceful end (idle shutdown) — the worker exits on EOF. */
  end(): void;
  /** Immediate teardown (timeout, dispose) — kills the worker. */
  kill(why: string): void;
  /** True until the channel has ended for any reason. */
  readonly alive: boolean;
}

/**
 * @description Reassemble newline-delimited protocol lines from arbitrary chunks. stdout and
 * the socket are the protocol channel; blank lines carry nothing and are dropped.
 */
export class LineSplitter {
  private buf = '';

  constructor(private readonly emit: (line: string) => void) {}

  /**
   * @description Feed one chunk; emits every line it completes.
   * @param chunk - Decoded text chunk.
   */
  push(chunk: string): void {
    this.buf += chunk;
    let nl = this.buf.indexOf('\n');
    while (nl >= 0) {
      const line = this.buf.slice(0, nl).replace(/\r$/, '').trim();
      this.buf = this.buf.slice(nl + 1);
      if (line) this.emit(line);
      nl = this.buf.indexOf('\n');
    }
  }
}

/** Where the engine container's bridge listens, plus what the adapter needs to trust it. */
export interface ContainerChannelOptions {
  host: string;
  port: number;
  /** Build hash of THIS package's engine tree; null when it could not be read. */
  expectedBuildHash: string | null;
  /** api-side workDir; exports unpack to `<workDir>/exports/<exportId>/`. */
  workDir: string;
  /** The exact command that (re)installs the engine container on this box. */
  installHint: string;
  helloTimeoutMs?: number;
}

/** Parsed first line from the bridge. */
interface BridgeHello { protocol?: unknown; buildHash?: unknown; python?: unknown }

/**
 * @description TCP channel to the aero-lab engine container. Writes are held until the bridge
 * hello proves the container runs this package's engine build, so a stale container never
 * computes anything on this adapter's behalf.
 */
class ContainerChannel implements EngineChannel {
  private readonly socket: net.Socket;
  private readonly splitter = new LineSplitter((line) => this.onLine(line));
  private readonly held: string[] = [];
  private readonly helloTimer: NodeJS.Timeout;
  private ready = false;
  private ended = false;

  constructor(private readonly opts: ContainerChannelOptions, private readonly handlers: ChannelHandlers) {
    this.socket = net.connect({ host: opts.host, port: opts.port });
    this.socket.setEncoding('utf8');
    this.socket.setNoDelay(true);
    this.socket.on('data', (chunk: string) => this.splitter.push(chunk));
    this.socket.on('error', (err: NodeJS.ErrnoException) => this.fail(this.classify(err)));
    this.socket.on('close', () => this.fail({ code: 'engine_error', message: 'engine container closed the connection' }));
    const timeoutMs = opts.helloTimeoutMs ?? HELLO_TIMEOUT_MS;
    this.helloTimer = setTimeout(() => this.fail(this.unavailable(
      `aerosim engine container at ${this.where()} did not identify itself within ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
    this.helloTimer.unref();
  }

  get alive(): boolean {
    return !this.ended;
  }

  write(line: string): boolean {
    if (this.ended) return false;
    if (!this.ready) {
      this.held.push(line);
      return true;
    }
    this.socket.write(line);
    return true;
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    clearTimeout(this.helloTimer);
    this.socket.end();
  }

  kill(why: string): void {
    if (this.ended) return;
    this.ended = true;
    clearTimeout(this.helloTimer);
    logger.info({ where: this.where(), why }, 'closing engine container connection — the bridge kills its worker');
    this.socket.destroy();
  }

  private where(): string {
    return `${this.opts.host}:${this.opts.port}`;
  }

  private unavailable(message: string): ChannelFailure {
    return { code: 'capability_unavailable', message, reason: `${message} — install or rebuild it: ${this.opts.installHint}` };
  }

  private classify(err: NodeJS.ErrnoException): ChannelFailure {
    if (err.code && UNREACHABLE.has(err.code)) {
      return this.unavailable(`aerosim engine container is not running at ${this.where()} (${err.code})`);
    }
    logger.error({ err, stack: err.stack, where: this.where() }, 'engine container connection failed');
    return { code: 'engine_error', message: `engine container connection failed: ${err.message}` };
  }

  /** End on our own and tell the adapter why (no-op once ended). */
  private fail(failure: ChannelFailure): void {
    if (this.ended) return;
    this.ended = true;
    clearTimeout(this.helloTimer);
    this.socket.destroy();
    this.handlers.onGone(failure);
  }

  private onLine(line: string): void {
    if (this.ended) return;
    if (!this.ready) {
      this.onHello(line);
      return;
    }
    this.handlers.onLine(line.includes('"bridgeFiles"') ? unpackExport(line, this.opts.workDir) : line);
  }

  /** Verify the bridge hello, then release the held requests. */
  private onHello(line: string): void {
    let msg: { bridge?: BridgeHello; error?: { code?: string; message?: string } };
    try {
      msg = JSON.parse(line) as typeof msg;
    } catch {
      this.fail(this.unavailable(`${this.where()} did not answer the aero-lab engine bridge protocol`));
      return;
    }
    if (msg.error) {
      const text = String(msg.error.message || 'engine container refused the connection');
      this.fail(msg.error.code === 'engine_busy' ? { code: 'engine_busy', message: text } : this.unavailable(text));
      return;
    }
    const hello = msg.bridge || {};
    const stale = this.staleReason(hello);
    if (stale) {
      this.fail(stale);
      return;
    }
    this.ready = true;
    clearTimeout(this.helloTimer);
    for (const held of this.held.splice(0)) this.socket.write(held);
  }

  private staleReason(hello: BridgeHello): ChannelFailure | null {
    if (hello.protocol !== BRIDGE_PROTOCOL) {
      return this.unavailable(`aerosim engine container speaks bridge protocol ${String(hello.protocol)}, this package needs ${BRIDGE_PROTOCOL}`);
    }
    if (!this.opts.expectedBuildHash) {
      return this.unavailable('this package\'s engine tree could not be read, so the engine container build cannot be verified');
    }
    if (hello.buildHash !== this.opts.expectedBuildHash) {
      return this.unavailable(
        `aerosim engine container is out of date: it was built from engine ${String(hello.buildHash).slice(0, 12)}, ` +
        `this package ships ${this.opts.expectedBuildHash.slice(0, 12)}`);
    }
    return null;
  }
}

/**
 * @description Write a bridged export's inline files into the api-side workDir and strip them
 * from the response, so the route's allow-listed download path works unchanged. Any violation
 * turns the response into a typed engine_error — a partial package is never reported as done.
 * @param line - The bridge's response line carrying result.bridgeFiles.
 * @param workDir - api-side workDir.
 * @returns The protocol line to hand the adapter.
 */
export function unpackExport(line: string, workDir: string): string {
  let msg: { id?: unknown; ok?: boolean; result?: { exportId?: unknown; bridgeFiles?: Array<{ name?: unknown; b64?: unknown }> } };
  try {
    msg = JSON.parse(line) as typeof msg;
  } catch {
    return line;
  }
  const result = msg.result;
  if (!msg.ok || !result || !Array.isArray(result.bridgeFiles)) return line;
  const exportId = String(result.exportId || '');
  try {
    if (!EXPORT_ID_RE.test(exportId)) throw new Error(`unexpected export id "${exportId}"`);
    const dir = path.join(workDir, 'exports', exportId);
    fs.mkdirSync(dir, { recursive: true });
    for (const file of result.bridgeFiles) {
      const name = String(file.name || '');
      if (!name || path.basename(name) !== name || name === '.' || name === '..') throw new Error(`unsafe export file name "${name}"`);
      fs.writeFileSync(path.join(dir, name), Buffer.from(String(file.b64 || ''), 'base64'));
    }
  } catch (err) {
    logger.error({ err, stack: (err as Error).stack, exportId }, 'export transfer from the engine container failed');
    return JSON.stringify({ id: msg.id, ok: false, error: { code: 'engine_error', message: `export transfer failed: ${(err as Error).message}` } });
  }
  delete result.bridgeFiles;
  return JSON.stringify(msg);
}

/**
 * @description Open a channel to the engine container's bridge.
 * @param opts - Address, expected build hash, workDir and install hint.
 * @param handlers - Line + gone callbacks.
 * @returns The channel (connecting; writes are held until the hello verifies).
 */
export function openContainerChannel(opts: ContainerChannelOptions, handlers: ChannelHandlers): EngineChannel {
  return new ContainerChannel(opts, handlers);
}
