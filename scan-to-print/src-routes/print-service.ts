/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the one place a model becomes a job on a
 *                     |                             | printer, shared by the person's Print click (print-routes.ts)
 *                     |                             | and the swarm print service (service-routes.ts), so the two
 *                     |                             | cannot drift. A Bambu Lab printer gets a `.gcode.3mf` sliced by
 *                     |                             | the package's slicer engine for THAT printer's model, nozzle,
 *                     |                             | filament and plate, uploaded over FTPS, and started over MQTT
 *                     |                             | only when the caller's start decision says so AND the printer
 *                     |                             | allows it; an HTTP host gets the existing adapter. Every
 *                     |                             | attempt — uploaded, started, refused or failed — becomes a
 *                     |                             | submission row with who asked (person or service).
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Review fixes: the start decision may be a callback evaluated
 *                     |                             | after slicing and upload (the service re-reads the owner's
 *                     |                             | auto-start at that moment, so turning it off stops a job in
 *                     |                             | flight); a sliced archive posted as is is never auto-started
 *                     |                             | (its plate and filaments are the printer screen's to map);
 *                     |                             | failure_reason is recorded only for a failure or a refused
 *                     |                             | requested start; a busy slicer answers "try again", not
 *                     |                             | reinstall; the Bambu profile carries the pinned certificate.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Second review: a callback decision is handed to the Bambu start
 *                     |                             | itself (evaluated inside the per-printer queue, right before the
 *                     |                             | command), and every decision that cannot be read means "do not
 *                     |                             | start" — the upload stands and the attempt is still recorded.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | Third review: a callback decision is read once after the upload
 *                     |                             | and BEFORE any broker session — "no" (auto-start off, the default)
 *                     |                             | answers "auto-start is off" with no failure recorded and no broker
 *                     |                             | session opened — and read again inside the start right before the
 *                     |                             | command.
 */

import { createChildLogger } from '@/shared/logger';
import { decryptField, isEncrypted } from '@/features/personal-data';
import { getPrinterWithKey, insertSubmission, type PrinterRow, type QueryablePool, type SubmissionRow } from './job-store';
import { BAMBU_KIND, type FetchLike, type HttpPrinterKind, adapterFor, bambuHostOf, hostAccepts } from './engine/print/printer-adapters';
import { type BambuIo, type BambuProfile, type BambuState, bambuStart, bambuStatus, bambuUpload } from './printing/bambu-lan';
import { type SliceProfile, type SlicerEngineOptions, SlicerEngineError, sliceToArchive } from './printing/slicer-engine';

const logger = createChildLogger({ module: 'scan-to-print-print-service' });

/** @description Everything the print path needs from its host. */
export interface PrintServiceDeps {
  /** The GUC-stamped pool. */
  pool: QueryablePool;
  /** Network client for HTTP printer hosts. */
  fetchImpl: FetchLike;
  /** How to reach and verify the slicer engine. */
  slicer: SlicerEngineOptions;
  /** Socket seam for Bambu printers (specs). */
  bambuIo?: BambuIo;
}

/** @description A printer with its decrypted key (HTTP API key or Bambu LAN access code). */
export interface LoadedPrinter { row: PrinterRow; secret: string }

/** @description What is being printed. */
export interface PrintModel {
  /** `stl` is sliced first (Bambu); `gcode.3mf` and `gcode` are sent as they are. */
  kind: 'stl' | 'gcode.3mf' | 'gcode';
  /** File bytes. */
  bytes: Uint8Array;
  /** Base name (no extension) the file is stored under on the printer. */
  name: string;
}

/** @description The result of one print attempt, ready to answer and to record. */
export interface PrintOutcome {
  /** HTTP status the route answers with. */
  status: number;
  /** True when the printer stored the file. */
  uploaded: boolean;
  /** True when the printer started it. */
  started: boolean;
  /** Name on the printer. */
  fileName: string | null;
  /** What happened, in words a person can act on. */
  message: string;
  /** Slicer estimate (Bambu). */
  estimate?: { printSeconds: number; firstLayerSeconds: number; filamentGrams: number | null };
  /** The slice profile actually used (Bambu). */
  sliceProfile?: Record<string, string>;
  /** The printer's state when a start was considered (Bambu). */
  printerState?: BambuState | null;
  /** The engine's install command when the slicer is down or stale. */
  installHint?: string;
  /** The host's raw answer (HTTP kinds). */
  remote?: unknown;
  /** Set only when a requested start was refused: why (recorded as the submission's failure_reason). */
  notStartedReason?: string;
}

/** @description A start decision: fixed, or evaluated at the last moment before the start. */
export type StartDecision = boolean | (() => Promise<boolean>);

/**
 * @description Evaluate a start decision now; a decision that cannot be read means do not start.
 * @param start - The decision.
 * @returns Whether to start, and the read error when there was one.
 */
export async function evaluateStart(start: StartDecision): Promise<{ go: boolean; error?: string }> {
  if (typeof start !== 'function') return { go: start };
  try { return { go: (await start()) === true }; } catch (error) {
    logger.error({ err: error }, 'Could not read the start decision; nothing will be started');
    return { go: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * @description Load one of the caller's printers with its key decrypted, failing closed.
 * @param pool - Pool.
 * @param sub - Owner.
 * @param printerId - Printer.
 * @returns The printer, or null when it is not the caller's.
 * @throws Error when the stored key cannot be decrypted.
 */
export async function loadPrinter(pool: QueryablePool, sub: string, printerId: string): Promise<LoadedPrinter | null> {
  const row = await getPrinterWithKey(pool, sub, printerId);
  if (!row) return null;
  const secret = decryptField(sub, row.api_key_ciphertext);
  if (!secret || isEncrypted(secret)) throw new Error('Printer key decryption failed closed');
  const { api_key_ciphertext: _ciphertext, ...printer } = row;
  return { row: printer, secret };
}

/**
 * @description The Bambu session profile of a loaded printer, including its pinned certificate.
 * @param printer - The loaded printer.
 * @returns Host, serial, pinned fingerprint, access code and model code.
 * @throws RangeError when the row lacks its serial or pin (re-adding the printer records both).
 */
export function bambuProfileOf(printer: LoadedPrinter): BambuProfile {
  if (!printer.row.device_serial || !printer.row.device_cert_sha256) throw new RangeError('this Bambu printer has no recorded identity; remove and add it again');
  return { host: bambuHostOf(printer.row.base_url), serial: printer.row.device_serial, certSha256: printer.row.device_cert_sha256, accessCode: printer.secret, modelId: printer.row.device_model };
}

/**
 * @description The slicer settings stored on a printer, with the engine's defaults for anything unset.
 * @param row - The printer row.
 * @returns Model code, nozzle, filament and plate (null = the model's default plate).
 * @throws RangeError when the printer has no model code.
 */
export function sliceProfileOf(row: PrinterRow): SliceProfile {
  const stored = (row.slice_profile ?? {}) as Record<string, unknown>;
  const text = (value: unknown, fallback: string | null) => (typeof value === 'string' && value.trim() ? value.trim() : fallback);
  const modelId = text(row.device_model, null) ?? text(stored.modelId, null);
  if (!modelId) throw new RangeError('this printer has no model code; remove and add it again');
  return { modelId, nozzle: text(stored.nozzle, '0.4') as string, filament: text(stored.filament, 'Bambu PLA Basic') as string, plate: text(stored.plate, null) };
}

/**
 * @description A printer-storage file name: safe characters only, bounded length.
 * @param name - Base name (no extension).
 * @param extension - Extension including the dot.
 * @returns A name the FTPS client accepts.
 */
export function printerFileName(name: string, extension: string): string {
  const stem = String(name).trim().replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^[_.]+|[_.]+$/g, '').slice(0, 80) || 'part';
  return `${stem}${extension}`;
}

/** @description Map a slicer failure to an answer. */
function slicerFailure(error: SlicerEngineError): PrintOutcome {
  const status = error.code === 'unavailable' || error.code === 'busy' ? 503 : error.code === 'refused' ? 422 : 502;
  return { status, uploaded: false, started: false, fileName: null, message: error.reason ?? error.message, ...(error.code === 'unavailable' ? { installHint: error.reason } : {}) };
}

/** @description Produce the archive a Bambu printer runs: slice an STL, or take a sliced one as it is. */
async function bambuArchive(deps: PrintServiceDeps, printer: LoadedPrinter, model: PrintModel): Promise<{ fileName: string; bytes: Uint8Array; estimate?: PrintOutcome['estimate']; sliceProfile?: Record<string, string>; filamentType: string | null } | PrintOutcome> {
  const fileName = printerFileName(model.name, '.gcode.3mf');
  if (model.kind === 'gcode.3mf') return { fileName, bytes: model.bytes, filamentType: null };
  if (model.kind !== 'stl') return { status: 409, uploaded: false, started: false, fileName: null, message: 'a Bambu Lab printer takes a model (.stl) or a sliced .gcode.3mf, not plain G-code' };
  try {
    const sliced = await sliceToArchive(deps.slicer, model.bytes, model.name, sliceProfileOf(printer.row));
    return { fileName, bytes: sliced.bytes, estimate: sliced.estimate, sliceProfile: sliced.profile, filamentType: sliced.profile.filamentType ?? null };
  } catch (error) {
    if (error instanceof SlicerEngineError) {
      logger.error({ err: error, code: error.code, printerId: printer.row.printer_id }, 'Slicer engine could not slice for the printer');
      return slicerFailure(error);
    }
    throw error;
  }
}

/** @description What an upload that is not started says, by who asked. */
function waitingMessage(model: PrintModel, requestedBy: Requester): string {
  if (model.kind === 'gcode.3mf') return 'Uploaded. A sliced file sent as it is waits on the printer: start it from the printer screen, which reads its own plates and filaments.';
  return requestedBy === 'service' ? 'Uploaded. Auto-start is off for this printer, so it waits on the printer for someone to start it.' : 'Uploaded. Start it from the printer screen.';
}

/**
 * @description Send a model to a Bambu Lab printer: slice (STL), upload, and start when the start
 * decision — evaluated only after the upload succeeded — says so and the printer allows it.
 * @param deps - Service dependencies.
 * @param printer - The loaded printer.
 * @param model - What to print.
 * @param start - The person's checkbox, or the service's last-moment re-read of the printer's auto-start.
 * @param requestedBy - Who asked (wording of the not-started message).
 * @returns The outcome.
 */
export async function sendToBambu(deps: PrintServiceDeps, printer: LoadedPrinter, model: PrintModel, start: StartDecision, requestedBy: Requester): Promise<PrintOutcome> {
  const archive = await bambuArchive(deps, printer, model);
  if ('status' in archive) return archive;
  const profile = bambuProfileOf(printer);
  const upload = await bambuUpload(profile, archive.fileName, archive.bytes, deps.bambuIo);
  const base = { fileName: archive.fileName, estimate: archive.estimate, sliceProfile: archive.sliceProfile };
  if (!upload.ok) {
    logger.error({ printerId: printer.row.printer_id, fileName: archive.fileName, reason: upload.message }, 'Bambu printer upload failed');
    return { ...base, status: 502, uploaded: false, started: false, message: upload.message };
  }
  if (model.kind === 'gcode.3mf' || start === false) return { ...base, status: 201, uploaded: true, started: false, message: waitingMessage(model, requestedBy) };
  if (typeof start === 'function') {
    // Read the decision before any broker session (the upload above is the only printer contact so
    // far): with auto-start off (the default) a printer-side refusal must not be reported as a
    // refused start that nobody asked for.
    const first = await evaluateStart(start);
    if (first.error) {
      const reason = `whether to start could not be read (${first.error}); nothing was started`;
      return { ...base, status: 201, uploaded: true, started: false, message: `Uploaded, not started: ${reason}`, notStartedReason: reason };
    }
    if (!first.go) return { ...base, status: 201, uploaded: true, started: false, message: waitingMessage(model, requestedBy) };
  }
  const gate = typeof start === 'function' ? async () => { const read = await evaluateStart(start); if (read.error) throw new Error(read.error); return read.go; } : undefined;
  const started = await bambuStart(profile, archive.fileName, archive.filamentType, deps.bambuIo, gate);
  if (started.declined) return { ...base, status: 201, uploaded: true, started: false, message: waitingMessage(model, requestedBy), printerState: started.state };
  if (!started.started) logger.warn({ printerId: printer.row.printer_id, fileName: archive.fileName, reason: started.message }, 'Bambu printer did not start the uploaded job');
  return { ...base, status: 201, uploaded: true, started: started.started, message: started.started ? 'Uploaded and print started.' : `Uploaded, not started: ${started.message}`,
    printerState: started.state, ...(started.started ? {} : { notStartedReason: started.message }) };
}

/**
 * @description Send a file to an HTTP printer host through its adapter.
 * @param deps - Service dependencies.
 * @param printer - The loaded printer.
 * @param file - Name with extension and bytes.
 * @param start - Ask the host to start it.
 * @returns The outcome.
 */
export async function sendToHttpPrinter(deps: PrintServiceDeps, printer: LoadedPrinter, file: { fileName: string; bytes: Uint8Array }, start: boolean): Promise<PrintOutcome> {
  const kind = printer.row.kind as HttpPrinterKind;
  if (!hostAccepts(kind, file.fileName)) return { status: 409, uploaded: false, started: false, fileName: null, message: `${kind} does not accept ${file.fileName}; send G-code.` };
  const outcome = await adapterFor(kind).upload({ kind, baseUrl: printer.row.base_url, apiKey: printer.secret }, { fileName: file.fileName, bytes: file.bytes, startPrint: start }, deps.fetchImpl);
  return { status: outcome.ok ? 201 : 502, uploaded: outcome.ok, started: outcome.started, fileName: file.fileName, message: outcome.message, remote: outcome.remote };
}

/** @description Who asked for a print, for the submission record. */
export type Requester = 'person' | 'service';

/**
 * @description Record an attempt (success or failure) as a submission row.
 * @param pool - Pool.
 * @param sub - Owner.
 * @param s - Job or source name, printer, outcome, requester.
 * @returns The row.
 */
export async function recordAttempt(pool: QueryablePool, sub: string, s: { jobId: string | null; sourceName: string | null; printer: LoadedPrinter; fileKind: string; outcome: PrintOutcome; requestedBy: Requester }): Promise<SubmissionRow> {
  const { outcome } = s;
  const row = await insertSubmission(pool, sub, {
    jobId: s.jobId, sourceName: s.sourceName, printerId: s.printer.row.printer_id, fileName: outcome.fileName ?? '', fileKind: s.fileKind,
    started: outcome.started, state: outcome.uploaded ? (outcome.started ? 'printing' : 'uploaded') : 'failed',
    failureReason: outcome.uploaded ? (outcome.notStartedReason ?? null) : outcome.message, requestedBy: s.requestedBy,
    remote: s.printer.row.kind === BAMBU_KIND ? { estimate: outcome.estimate ?? null, sliceProfile: outcome.sliceProfile ?? null } : outcome.remote ?? null,
  });
  logger.info({ printerId: s.printer.row.printer_id, jobId: s.jobId, requestedBy: s.requestedBy, uploaded: outcome.uploaded, started: outcome.started, status: outcome.status }, 'Print attempt recorded');
  return row;
}

/**
 * @description A printer's state for any kind: Bambu over MQTT, HTTP hosts through their adapter.
 * @param deps - Service dependencies.
 * @param printer - The loaded printer.
 * @returns `ok`, a normalised `state` word and the kind-specific detail.
 */
export async function printerState(deps: PrintServiceDeps, printer: LoadedPrinter): Promise<{ ok: boolean; state: string; detail: unknown }> {
  if (printer.row.kind === BAMBU_KIND) {
    const result = await bambuStatus(bambuProfileOf(printer), deps.bambuIo);
    return result.ok ? { ok: true, state: result.state.state, detail: result.state } : { ok: false, state: 'offline', detail: { message: result.message } };
  }
  const kind = printer.row.kind as HttpPrinterKind;
  const status = await adapterFor(kind).status({ kind, baseUrl: printer.row.base_url, apiKey: printer.secret }, deps.fetchImpl);
  return { ok: status.ok, state: status.state, detail: status.detail };
}
