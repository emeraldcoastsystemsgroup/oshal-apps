/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the client for the package's slicer engine
 *                     |                             | container (BUILDING-EXTENSIONS §7): one TCP connection per
 *                     |                             | request, JSON lines, the bridge's hello verified first. A
 *                     |                             | container built from a different engine tree is REFUSED with the
 *                     |                             | exact install command (installHint), never asked to slice — the
 *                     |                             | build hash is computed here over the same files, the same way, as
 *                     |                             | slicer_engine_bridge.py does, and a spec keeps the two in step.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Review fixes: a busy engine (no free worker slot) is `busy`, not
 *                     |                             | `unavailable` with reinstall advice; an engine that closes the
 *                     |                             | connection without answering fails the request at once instead
 *                     |                             | of after the timeout; a malformed address is carried as an
 *                     |                             | error the request reports, never thrown while routes mount; and
 *                     |                             | a multi-megabyte answer line is assembled once (linear) rather
 *                     |                             | than rescanned on every chunk on the api's event loop.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Second review: nothing the endpoint sends can throw out of the
 *                     |                             | socket handler — a non-object or oddly-typed line is a typed
 *                     |                             | failure, and the line handler itself is guarded; an out-of-range
 *                     |                             | port is an address error, and a socket that cannot even be
 *                     |                             | created is `unavailable`, not a caller error.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | Third review: an answer line is capped (MAX_ANSWER_CHARS, far above
 *                     |                             | any real archive and far below V8's string limit) and the whole
 *                     |                             | assembler is guarded, so an oversized or hostile line fails the
 *                     |                             | request instead of throwing out of the socket handler; a slice
 *                     |                             | result of the wrong shape is a typed engine error.
 */

import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

/** @description Longest answer line accepted: a 64 MiB STL's archive, base64-encoded, fits many times over. */
export const MAX_ANSWER_CHARS = 256 * 1024 * 1024;
/** @description The bridge wire version (PROTOCOL in the bridge and worker). */
export const SLICER_BRIDGE_PROTOCOL = 1;
/** @description Where the api finds the engine on the stack network. */
export const DEFAULT_SLICER_ENGINE_ADDR = 'scan-to-print-engine:7414';
/** @description Environment override for that address. */
export const SLICER_ENGINE_ADDR_ENV = 'SCAN_TO_PRINT_ENGINE_ADDR';
/** @description The files the image bakes that change its answers (mirror of RUNTIME_FILES in the bridge). */
export const SLICER_RUNTIME_FILES = ['slicer_worker.py', 'container/slicer_engine_bridge.py', 'container/Dockerfile', 'orcaslicer-lock.txt'] as const;

/**
 * @description sha256 over the runtime files, each prefixed by its relative name and NUL-framed,
 * CRLF folded to LF (a Windows checkout and the deployed copy of one commit must agree).
 * @param engineDir - The package's `engine/` directory.
 * @returns Hex digest, or null when the directory is absent.
 */
export function slicerEngineBuildHash(engineDir: string): string | null {
  if (!engineDir || !fs.existsSync(engineDir)) return null;
  const digest = createHash('sha256');
  for (const rel of SLICER_RUNTIME_FILES) {
    digest.update(Buffer.from(rel + '\0', 'utf8'));
    const file = path.join(engineDir, rel);
    if (fs.existsSync(file)) digest.update(Buffer.from(fs.readFileSync(file).toString('latin1').replace(/\r\n/g, '\n'), 'latin1'));
    digest.update(Buffer.from('\0', 'utf8'));
  }
  return digest.digest('hex');
}

/**
 * @description The command that (re)installs the engine on THIS box — built, never hardcoded in a surface.
 * @param engineDir - The package's `engine/` directory.
 * @returns A copy-paste command.
 */
export function slicerInstallHint(engineDir: string): string {
  const script = `${engineDir.replace(/\\/g, '/')}/install-engine.sh`;
  return fs.existsSync('/.dockerenv') ? `docker exec ${os.hostname()} sh ${script}` : `sh ${script}`;
}

/** @description How to reach and verify the engine. */
export interface SlicerEngineOptions {
  /** Engine host on the stack network. */
  host: string;
  /** Engine port. */
  port: number;
  /** Build hash of this package's engine tree. */
  expectedBuildHash: string | null;
  /** The install command for a down or stale engine. */
  installHint: string;
  /** Socket factory (spec seam). */
  connect?: (host: string, port: number) => net.Socket;
  /** Slice timeout (longer than the worker's own slicer timeout, so the worker answers first). */
  timeoutMs?: number;
  /** Set when SCAN_TO_PRINT_ENGINE_ADDR could not be parsed; every request reports it. */
  addrError?: string;
}

/** @description A typed failure: `unavailable` carries the install command in its reason. */
export class SlicerEngineError extends Error {
  constructor(readonly code: 'unavailable' | 'busy' | 'refused' | 'engine_error' | 'timeout', message: string, readonly reason?: string) {
    super(message);
    this.name = 'SlicerEngineError';
  }
}

/**
 * @description Parse `host:port`.
 * @param value - Configured address, or undefined for the default.
 * @returns Host and port.
 */
export function parseSlicerAddr(value: string | undefined): { host: string; port: number } {
  const text = (value || DEFAULT_SLICER_ENGINE_ADDR).trim();
  const m = /^(.+):(\d{1,5})$/.exec(text);
  const port = m ? Number(m[2]) : 0;
  if (!m || port < 1 || port > 65535) throw new RangeError(`invalid slicer engine address "${text}" (expected host:port, port 1-65535)`);
  return { host: m[1], port };
}

/** @description A field as text only when it is a string or number (anything else reads as absent). */
function field(value: unknown): string | null {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : null;
}

/** @description A parsed line as a plain object, or null for anything else (null, arrays, scalars). */
function objectOf(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch { return null; }
}

/** @description Check the hello line; null when the engine is the one this package ships. */
function verifyHello(line: string, opts: SlicerEngineOptions): SlicerEngineError | null {
  const unavailable = (message: string) => new SlicerEngineError('unavailable', message, `${message} — install or rebuild it: ${opts.installHint}`);
  const msg = objectOf(line);
  if (!msg) return unavailable(`${opts.host}:${opts.port} does not speak the slicer bridge protocol`);
  if (msg.error !== undefined) {
    const error = (msg.error && typeof msg.error === 'object' ? msg.error : {}) as Record<string, unknown>;
    if (field(error.code) === 'engine_busy') return new SlicerEngineError('busy', field(error.message) ?? 'the slicer engine has no free worker slot', 'the slicer is busy with other slices; try again in a minute');
    return unavailable(field(error.message) ?? 'the slicer engine refused the connection');
  }
  const hello = (msg.bridge && typeof msg.bridge === 'object' ? msg.bridge : {}) as Record<string, unknown>;
  if (hello.protocol !== SLICER_BRIDGE_PROTOCOL) return unavailable(`the slicer engine speaks bridge protocol ${field(hello.protocol) ?? 'unknown'}, this package needs ${SLICER_BRIDGE_PROTOCOL}`);
  if (!opts.expectedBuildHash) return unavailable("this package's engine tree could not be read, so the slicer engine build cannot be verified");
  if (hello.buildHash !== opts.expectedBuildHash) {
    return unavailable(`the slicer engine container is out of date: it was built from engine ${(field(hello.buildHash) ?? 'unknown').slice(0, 12)}, this package ships ${opts.expectedBuildHash.slice(0, 12)}`);
  }
  return null;
}

/**
 * @description A chunk consumer that calls `onLine` for every complete line. Only the arriving chunk
 * is searched and an unfinished line's pieces are joined once, so a multi-megabyte line costs linear
 * time on the api's event loop (re-scanning one growing string per chunk is quadratic).
 * @param onLine - Called with each non-blank line; return false to stop consuming.
 * @param onFailure - Called once when a line exceeds `maxChars` or consuming throws; nothing is consumed after.
 * @param maxChars - Longest line accepted.
 * @returns The chunk consumer; it never throws.
 */
export function lineAssembler(onLine: (line: string) => boolean, onFailure: (error: Error) => void = () => undefined, maxChars: number = MAX_ANSWER_CHARS): (chunk: string) => void {
  let pending: string[] = [];
  let pendingChars = 0;
  let open = true;
  const fail = (error: Error) => { open = false; pending = []; pendingChars = 0; onFailure(error); };
  return (chunk: string) => {
    if (!open) return;
    try {
      let rest = chunk;
      let newline: number;
      while (open && (newline = rest.indexOf('\n')) >= 0) {
        if (pendingChars + newline > maxChars) { fail(new Error(`an answer line exceeded ${maxChars} characters`)); return; }
        pending.push(rest.slice(0, newline));
        const line = pending.join('');
        pending = []; pendingChars = 0;
        rest = rest.slice(newline + 1);
        if (line.trim()) open = onLine(line);
      }
      if (open && rest) {
        pendingChars += rest.length;
        if (pendingChars > maxChars) { fail(new Error(`an answer line exceeded ${maxChars} characters`)); return; }
        pending.push(rest);
      }
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
    }
  };
}

/** @description Why a connection closed before an answer: unavailable before the hello, an engine error after. */
function closedEarly(helloSeen: boolean, opts: SlicerEngineOptions): SlicerEngineError {
  if (helloSeen) return new SlicerEngineError('engine_error', 'the slicer engine closed the connection before answering');
  const message = `the slicer engine at ${opts.host}:${opts.port} closed the connection before identifying itself`;
  return new SlicerEngineError('unavailable', message, `${message} — install or rebuild it: ${opts.installHint}`);
}

/** @description The engine's answer line as a result or a typed failure. */
function answerOf(line: string): { ok: true; value: unknown } | { ok: false; error: SlicerEngineError } {
  const msg = objectOf(line);
  if (!msg) return { ok: false, error: new SlicerEngineError('engine_error', 'the slicer engine sent an unreadable answer') };
  if (msg.ok === true) return { ok: true, value: msg.result };
  const error = (msg.error && typeof msg.error === 'object' ? msg.error : {}) as Record<string, unknown>;
  return { ok: false, error: new SlicerEngineError(field(error.code) === 'refused' ? 'refused' : 'engine_error', field(error.message) ?? 'slicer engine error') };
}

/**
 * @description Send one command to the engine on a fresh connection and return its result.
 * @param opts - Address, expected build hash, install hint.
 * @param cmd - `profiles` | `slice` | `hello`.
 * @param args - Command arguments.
 * @returns The engine's `result`.
 * @throws SlicerEngineError.
 */
export function slicerRequest(opts: SlicerEngineOptions, cmd: string, args: Record<string, unknown>): Promise<unknown> {
  if (opts.addrError) {
    const message = `${SLICER_ENGINE_ADDR_ENV} is invalid: ${opts.addrError}`;
    return Promise.reject(new SlicerEngineError('unavailable', message, `${message} — set it to host:port, or unset it for ${DEFAULT_SLICER_ENGINE_ADDR}`));
  }
  const connect = opts.connect ?? ((host: string, port: number) => net.connect({ host, port }));
  return new Promise((resolve, reject) => {
    let socket: net.Socket;
    try { socket = connect(opts.host, opts.port); } catch (error) {
      const message = `the slicer engine at ${opts.host}:${opts.port} cannot be dialled (${error instanceof Error ? error.message : String(error)})`;
      reject(new SlicerEngineError('unavailable', message, `${message} — check ${SLICER_ENGINE_ADDR_ENV} or install it: ${opts.installHint}`));
      return;
    }
    let helloSeen = false;
    let settled = false;
    const finish = (error: SlicerEngineError | null, value?: unknown) => {
      if (settled) return;
      settled = true; clearTimeout(timer); socket.destroy();
      if (error) reject(error); else resolve(value);
    };
    const timeoutMs = opts.timeoutMs ?? 600_000;
    const timer = setTimeout(() => finish(new SlicerEngineError('timeout', `the slicer engine did not answer within ${Math.round(timeoutMs / 1000)} s`)), timeoutMs);
    socket.setEncoding('utf8');
    socket.on('error', (error: NodeJS.ErrnoException) => {
      const message = `the slicer engine is not running at ${opts.host}:${opts.port} (${error.code ?? error.message})`;
      finish(new SlicerEngineError('unavailable', message, `${message} — install it: ${opts.installHint}`));
    });
    socket.on('close', () => finish(closedEarly(helloSeen, opts)));
    socket.on('data', lineAssembler((line) => {
      try {
        if (!helloSeen) {
          helloSeen = true;
          const stale = verifyHello(line, opts);
          if (stale) { finish(stale); return false; }
          socket.write(JSON.stringify({ id: 1, cmd, args }) + '\n');
          return true;
        }
        const answer = answerOf(line);
        if (answer.ok) finish(null, answer.value); else finish(answer.error);
      } catch (error) {
        finish(new SlicerEngineError('engine_error', `the slicer engine's answer could not be read (${error instanceof Error ? error.message : String(error)})`));
      }
      return false;
    }, (error) => finish(new SlicerEngineError('engine_error', `the slicer engine's answer could not be read (${error.message})`))));
  });
}

/** @description Build plates the engine slices for (the vendor profiles' curr_bed_type values). */
export const BAMBU_PLATES = ['Cool Plate', 'Engineering Plate', 'High Temp Plate', 'Textured PEI Plate', 'Textured Cool Plate', 'Supertack Plate'] as const;
/** @description Nozzle diameters the engine slices for. */
export const BAMBU_NOZZLES = ['0.2', '0.4', '0.6', '0.8'] as const;

/** @description What the engine needs to slice for one printer. */
export interface SliceProfile {
  /** Vendor model code (P2S = N7). */
  modelId: string;
  /** Nozzle diameter. */
  nozzle: string;
  /** Filament profile name without its `@` suffix (e.g. `Bambu PLA Basic`). */
  filament: string;
  /** Build plate (`Textured PEI Plate`, …); null uses the model's default. */
  plate: string | null;
}

/** @description A sliced archive and what the printer will report about it. */
export interface SlicedArchive {
  fileName: string;
  bytes: Uint8Array;
  estimate: { printSeconds: number; firstLayerSeconds: number; filamentGrams: number | null };
  profile: Record<string, string>;
}

/**
 * @description Slice an STL into a printer-ready `.gcode.3mf`.
 * @param opts - Engine options.
 * @param stl - STL bytes.
 * @param name - Base name for the archive.
 * @param profile - Printer model, nozzle, filament, plate.
 * @returns The archive.
 * @throws SlicerEngineError.
 */
export async function sliceToArchive(opts: SlicerEngineOptions, stl: Uint8Array, name: string, profile: SliceProfile): Promise<SlicedArchive> {
  const result = await slicerRequest(opts, 'slice', {
    stl: Buffer.from(stl).toString('base64'), name, modelId: profile.modelId, nozzle: profile.nozzle, filament: profile.filament,
    ...(profile.plate ? { plate: profile.plate } : {}),
  }) as { fileName?: unknown; archive?: unknown; estimate?: unknown; profile?: unknown } | null;
  const estimate = (result && typeof result.estimate === 'object' && result.estimate !== null ? result.estimate : null) as Record<string, unknown> | null;
  if (!result || typeof result.archive !== 'string' || !result.archive || typeof result.fileName !== 'string' || !result.profile || typeof result.profile !== 'object'
    || !estimate || typeof estimate.printSeconds !== 'number' || typeof estimate.firstLayerSeconds !== 'number') {
    throw new SlicerEngineError('engine_error', 'the slicer engine sent an unreadable slice result');
  }
  const profileOut = Object.fromEntries(Object.entries(result.profile as Record<string, unknown>).filter(([, v]) => typeof v === 'string')) as Record<string, string>;
  return { fileName: result.fileName, bytes: new Uint8Array(Buffer.from(result.archive, 'base64')),
    estimate: { printSeconds: estimate.printSeconds, firstLayerSeconds: estimate.firstLayerSeconds, filamentGrams: typeof estimate.filamentGrams === 'number' ? estimate.filamentGrams : null },
    profile: profileOut };
}
