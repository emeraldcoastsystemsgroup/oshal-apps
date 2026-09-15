/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com     | Initial creation — the worker-thread half of the synchronous bridge to the physics engine container: it owns the TCP socket, keeps the hello the bridge sent on connect, writes every request line the main thread posts, and hands each response line back through the shared buffer with an Atomics notify. The main thread blocks on that buffer, so the simulation's step stays a plain synchronous call and stays deterministic; this thread is the only place network time exists.
 * 2   | maintainer@emeraldcoastsystemsgroup.com     | A second transport, the swarm node rail (ADR-099, B20): a node that joined by heartbeat is commanded by POSTing each request as a {id, command, args} envelope to its declared endpoint under the swarm service secret — the core drone node's command channel — and its hello is the one it heartbeat in. The main thread's blocking contract is unchanged over both.
 */

import net from 'node:net';
import { parentPort, workerData } from 'node:worker_threads';

interface LinesInit { transport?: 'lines'; host: string; port: number; sab: SharedArrayBuffer }
interface HttpInit { transport: 'http'; endpoint: string; secret: string; hello: string; timeoutMs: number; sab: SharedArrayBuffer }
type WorkerInit = LinesInit | HttpInit;

/** Shared buffer layout: Int32[0] state (0 waiting, 1 response ready, 2 failure), Int32[1] byte length; bytes from offset 8. */
const init = workerData as WorkerInit;
const status = new Int32Array(init.sab, 0, 2);
const bytes = new Uint8Array(init.sab, 8);

function deliver(text: string, state: 1 | 2): void {
  const encoded = Buffer.from(text, 'utf8');
  if (encoded.length > bytes.length) {
    const err = Buffer.from(JSON.stringify({ ok: false, error: 'engine_error', reason: `response of ${encoded.length} bytes exceeds the ${bytes.length}-byte bridge buffer` }), 'utf8');
    bytes.set(err, 0); Atomics.store(status, 1, err.length); Atomics.store(status, 0, 2); Atomics.notify(status, 0); return;
  }
  bytes.set(encoded, 0);
  Atomics.store(status, 1, encoded.length);
  Atomics.store(status, 0, state);
  Atomics.notify(status, 0);
}

const unavailable = (reason: string): string => JSON.stringify({ ok: false, error: 'capability_unavailable', reason });

/** The JSON-lines TCP bridge we dial: the hello is the first line the socket sends. */
function runLines(cfg: LinesInit): void {
  let hello: string | null = null;
  let tail = '';
  const socket = net.createConnection({ host: cfg.host, port: cfg.port });
  socket.setNoDelay(true);
  socket.setEncoding('utf8');
  socket.on('data', (chunk: string) => {
    const parts = (tail + chunk).split('\n');
    tail = parts.pop() ?? '';
    for (const line of parts) {
      if (!line.trim()) continue;
      if (hello === null) { hello = line; deliver(line, 1); continue; }
      deliver(line, 1);
    }
  });
  socket.on('error', (err: Error) => deliver(unavailable(`${(err as NodeJS.ErrnoException).code ?? err.name}: ${err.message}`), 2));
  socket.on('close', () => deliver(unavailable('the engine bridge closed the connection'), 2));
  parentPort?.on('message', (line: string) => {
    if (socket.destroyed) { deliver(unavailable('the engine bridge is not connected'), 2); return; }
    socket.write(line + '\n');
  });
}

/** A reason out of a node's error body, or the raw text. */
function reasonOf(text: string): string {
  try {
    const parsed = JSON.parse(text) as { reason?: unknown; error?: unknown };
    return String(parsed.reason ?? parsed.error ?? text.slice(0, 300));
  } catch { return text.slice(0, 300); }
}

/** The node rail: each request is one command envelope to the node's endpoint; the hello is what the node heartbeat in. */
function runHttp(cfg: HttpInit): void {
  const url = `${cfg.endpoint.replace(/\/+$/, '')}/api/drone-node/command`;
  deliver(cfg.hello, 1);
  const post = async (line: string): Promise<void> => {
    let req: { id?: number; op?: string } & Record<string, unknown>;
    try { req = JSON.parse(line) as typeof req; } catch { deliver(JSON.stringify({ ok: false, error: 'engine_error', reason: 'unreadable request' }), 1); return; }
    const { id, op, ...args } = req;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), cfg.timeoutMs);
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-service-secret': cfg.secret }, body: JSON.stringify({ id, command: op, args }), signal: ctl.signal });
      const text = await res.text();
      if (res.status === 401 || res.status === 403) { deliver(unavailable(`the node refused the swarm service secret (HTTP ${res.status})`), 2); return; }
      if (res.status >= 500) { deliver(unavailable(`the node answered HTTP ${res.status}: ${reasonOf(text)}`), 2); return; }
      if (!res.ok) { deliver(JSON.stringify({ id, ok: false, error: 'engine_error', reason: `HTTP ${res.status}: ${reasonOf(text)}` }), 1); return; }
      deliver(text, 1);
    } catch (err) {
      deliver(unavailable(`${(err as Error).name}: ${(err as Error).message}`), 2);
    } finally { clearTimeout(timer); }
  };
  parentPort?.on('message', (line: string) => { void post(line); });
}

if (init.transport === 'http') runHttp(init); else runLines(init);
