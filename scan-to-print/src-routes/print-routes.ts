/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — printers and print submission. A printer is
 *                     |                             | the person's own host (OctoPrint / Moonraker / PrusaLink) with
 *                     |                             | its API key held only as owner-key ciphertext; sending a job
 *                     |                             | is an OUTWARD, physical action, so it sits behind the kernel's
 *                     |                             | explicit `confirm: true` gate (428 without it) and the
 *                     |                             | manifest tool that exposes it to bots requires approval.
 *                     |                             | Slicing (STL → G-code) runs only when the operator configured
 *                     |                             | a slicer command; otherwise the route says so and offers the
 *                     |                             | STL upload for hosts that accept one. Every attempt, success
 *                     |                             | or failure, becomes a submission row with the host's answer.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Hold current output through slicing and upload, refuse stale/nonprintable models, and discard failed slicer output.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Bambu Lab LAN printers and the owner's print-service settings.
 *                     |                             | A Bambu printer is added from its address and access code
 *                     |                             | (identity read from its certificate, code proven before the row
 *                     |                             | exists); its jobs are sliced by the package's slicer engine and
 *                     |                             | go through print-service.ts, which the swarm print service
 *                     |                             | shares. PATCH /printers/:id changes the slice profile and the
 *                     |                             | per-printer AUTO_START opt-in; turning auto-start ON needs
 *                     |                             | `confirm: true`, and this mount is OIDC-only, so no service
 *                     |                             | caller can grant itself auto-start. GET /printers/profiles
 *                     |                             | lists what the engine slices for, or the engine's install hint.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | Review fixes: the start decision may be evaluated at the last
 *                     |                             | moment (after slicing, before the HTTP upload or the Bambu
 *                     |                             | start) so the service honours auto-start being turned off while
 *                     |                             | a job is in flight; a busy slicer engine is reported busy, not
 *                     |                             | missing.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | Second review: a Bambu job is stored under a name unique to the
 *                     |                             | attempt (title prefix + job id + random suffix), so a re-print can
 *                     |                             | never overwrite the file a printer is printing from and long
 *                     |                             | titles cannot collide; an HTTP host's decision that cannot be
 *                     |                             | read starts nothing; the engine profile list is a short request.
 * 6 | maintainer@emeraldcoastsystemsgroup.com   | Third review: the per-attempt suffix carries 48 random bits; an
 *                     |                             | HTTP host's upload that was not started says why (auto-start off,
 *                     |                             | or it could not be read); a failed print answers with its reason
 *                     |                             | at the top level, which is what the page shows.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import fs from 'node:fs';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { createChildLogger } from '@/shared/logger';
import { encryptField, isEncrypted } from '@/features/personal-data';
import { confirmationRequiredPayload, hasExplicitWriteConfirmation } from '@/shared/security/explicit-write-confirmation';
import { deletePrinter, insertPrinter, listPrinters, listSubmissions, updatePrinterSettings, type JobRow, type QueryablePool } from './job-store';
import { artifactPath, jobDir, requireUuid } from './data-dir';
import { BAMBU_KIND, type FetchLike, PRINTER_KINDS } from './engine/print/printer-adapters';
import { type BambuIo } from './printing/bambu-lan';
import { type SlicerEngineOptions, SlicerEngineError, slicerRequest } from './printing/slicer-engine';
import { type ExecFileLike, resolveSlicerConfig, sliceStl } from './engine/print/slicer';
import { sanitizeSolidName } from './engine/geometry/export-stl';
import { type JobRequest, requireCurrentOutput, withCurrentJob } from './job-outputs';
import { randomBytes } from 'node:crypto';
import { type PrintOutcome, type PrintServiceDeps, type StartDecision, evaluateStart, loadPrinter, printerState, recordAttempt, sendToBambu, sendToHttpPrinter } from './print-service';
import { type PrinterDraft, parseHttpPrinter, parseSettingsChange, registerBambuPrinter } from './printer-registration';

const logger = createChildLogger({ module: 'scan-to-print-print-routes' });
const execFile = promisify(execFileCb);

/** @description What the print router needs from its host. */
export interface PrintRouteDeps {
  /** The GUC-stamped pool. */
  pool: QueryablePool;
  /** Root directory for job files. */
  dataRoot: string;
  /** Environment for the slicer configuration. */
  env: Record<string, string | undefined>;
  /** Caller resolution. */
  callerSub: (req: Request) => string | null;
  /** How to reach and verify the slicer engine (Bambu printers). */
  slicer: SlicerEngineOptions;
  /** Network client for printer hosts; injectable for specs. */
  fetchImpl?: FetchLike;
  /** Process runner for the slicer; injectable for specs. */
  execFile?: ExecFileLike;
  /** Socket seam for Bambu printers; injectable for specs. */
  bambuIo?: BambuIo;
}

/** @description Request-local state. */
interface PrintRequest extends Request { scanSub?: string }

/**
 * @description The shared print-service dependencies of this router.
 * @param deps - Router dependencies.
 * @returns What print-service.ts needs (pool, network client, slicer engine, printer sockets).
 */
export function serviceDepsOf(deps: PrintRouteDeps): PrintServiceDeps {
  return { pool: deps.pool, fetchImpl: deps.fetchImpl ?? ((url, init) => fetch(url, init)), slicer: deps.slicer, bambuIo: deps.bambuIo };
}

/** @description Ensure the requested file exists, slicing STL → G-code on demand when configured (HTTP hosts). */
async function resolvePrintFile(deps: PrintRouteDeps, dir: string, fileKind: 'stl' | 'gcode'): Promise<{ ok: true; path: string } | { ok: false; status: number; body: Record<string, unknown> }> {
  const stl = artifactPath(dir, 'stl');
  if (!fs.existsSync(stl)) return { ok: false, status: 409, body: { error: 'not_reconstructed', message: 'Reconstruct the object before printing.' } };
  if (fileKind === 'stl') return { ok: true, path: stl };
  const gcode = artifactPath(dir, 'gcode');
  if (fs.existsSync(gcode)) return { ok: true, path: gcode };
  const config = resolveSlicerConfig(deps.env);
  if (!config) {
    return { ok: false, status: 409, body: { error: 'needs_gcode', message: 'No slicer is configured on this swarm (SCAN_TO_PRINT_SLICER_CMD). Download the STL and slice it, or send the STL to an OctoPrint host that slices.' } };
  }
  let completed = false;
  try {
    const result = await sliceStl(config, stl, gcode, deps.execFile ?? ((f, a, o) => execFile(f, a, o)), (p) => fs.existsSync(p));
    if (!result.ok) return { ok: false, status: 502, body: { error: 'slicer_failed', message: result.error, stderr: result.stderr } };
    completed = true;
  } finally { if (!completed) fs.rmSync(gcode, { force: true }); }
  return { ok: true, path: gcode };
}

/** @description Register guard routes with their existing caller and confirmation contracts. */
function registerGuard(router: Router, deps: PrintRouteDeps): void {
  router.use((req: PrintRequest, res: Response, next: NextFunction) => {
    const sub = deps.callerSub(req);
    if (!sub) { res.status(401).json({ error: 'unauthenticated' }); return; }
    req.scanSub = sub;
    next();
  });
}

/** @description Encrypt a draft's secret and store the printer. */
async function storeDraft(deps: PrintRouteDeps, sub: string, draft: PrinterDraft) {
  const { secret, ...printer } = draft;
  const apiKeyCiphertext = encryptField(sub, secret);
  if (!apiKeyCiphertext || !isEncrypted(apiKeyCiphertext)) throw new Error('Printer key encryption failed closed');
  return insertPrinter(deps.pool, sub, { ...printer, apiKeyCiphertext });
}

/** @description Register printers routes with their existing caller and confirmation contracts. */
function registerPrinters(router: Router, deps: PrintRouteDeps): void {
  router.get('/printers', async (req: PrintRequest, res: Response) => {
    try {
      res.json({ printers: await listPrinters(deps.pool, req.scanSub as string), kinds: PRINTER_KINDS, slicerConfigured: resolveSlicerConfig(deps.env) !== null });
    } catch (error) { logger.error({ err: error }, 'List printers failed'); res.status(500).json({ error: 'list_failed' }); }
  });

  router.post('/printers', async (req: PrintRequest, res: Response) => {
    const sub = req.scanSub as string;
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const draft = body.kind === BAMBU_KIND ? await registerBambuPrinter(body, deps.bambuIo) : parseHttpPrinter(body);
      res.status(201).json({ printer: await storeDraft(deps, sub, draft) });
    } catch (error) {
      if (error instanceof RangeError) { res.status(400).json({ error: 'invalid_printer', message: error.message }); return; }
      logger.error({ err: error }, 'Create printer failed'); res.status(500).json({ error: 'create_failed' });
    }
  });

  router.delete('/printers/:printerId', async (req: PrintRequest, res: Response) => {
    try {
      const removed = await deletePrinter(deps.pool, req.scanSub as string, requireUuid(req.params.printerId));
      if (!removed) { res.status(404).json({ error: 'printer_not_found' }); return; }
      res.json({ deleted: true });
    } catch (error) {
      if (error instanceof RangeError) { res.status(400).json({ error: 'invalid_printer_id' }); return; }
      logger.error({ err: error }, 'Delete printer failed'); res.status(500).json({ error: 'delete_failed' });
    }
  });
}

/** @description Register the owner-only settings route (slice profile, auto-start). */
function registerSettings(router: Router, deps: PrintRouteDeps): void {
  router.patch('/printers/:printerId', async (req: PrintRequest, res: Response) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const printerId = requireUuid(req.params.printerId);
      const change = parseSettingsChange(body);
      if (change.needsConfirm) { res.status(428).json(confirmationRequiredPayload('scan-to-print.auto-start', 'Letting jobs sent by agents and apps start this printer without a click')); return; }
      const printer = await updatePrinterSettings(deps.pool, req.scanSub as string, printerId, { autoStart: change.autoStart, sliceProfile: change.sliceProfile });
      if (!printer) { res.status(404).json({ error: 'printer_not_found' }); return; }
      logger.info({ printerId, autoStart: printer.auto_start }, 'Printer settings changed');
      res.json({ printer });
    } catch (error) {
      if (error instanceof RangeError) { res.status(400).json({ error: 'invalid_settings', message: error.message }); return; }
      logger.error({ err: error }, 'Printer settings failed'); res.status(500).json({ error: 'settings_failed' });
    }
  });

  router.get('/printers/profiles', async (_req: PrintRequest, res: Response) => {
    try {
      res.json({ engine: { address: `${deps.slicer.host}:${deps.slicer.port}`, ready: true }, ...(await slicerRequest({ ...deps.slicer, timeoutMs: 20_000 }, 'profiles', {}) as Record<string, unknown>) });
    } catch (error) {
      if (error instanceof SlicerEngineError && error.code === 'busy') { res.json({ engine: { address: `${deps.slicer.host}:${deps.slicer.port}`, ready: true, busy: true }, printers: [], plates: [], reason: error.reason ?? error.message }); return; }
      if (error instanceof SlicerEngineError) { res.json({ engine: { address: `${deps.slicer.host}:${deps.slicer.port}`, ready: false }, printers: [], plates: [], reason: error.reason ?? error.message, installHint: deps.slicer.installHint }); return; }
      logger.error({ err: error }, 'Slicer profiles failed'); res.status(500).json({ error: 'profiles_failed' });
    }
  });
}

/** @description Register status routes with their existing caller and confirmation contracts. */
function registerStatus(router: Router, deps: PrintRouteDeps): void {
  router.post('/printers/:printerId/status', async (req: PrintRequest, res: Response) => {
    try {
      const loaded = await loadPrinter(deps.pool, req.scanSub as string, requireUuid(req.params.printerId));
      if (!loaded) { res.status(404).json({ error: 'printer_not_found' }); return; }
      const status = await printerState(serviceDepsOf(deps), loaded);
      res.status(status.ok ? 200 : 502).json({ printer: loaded.row, status });
    } catch (error) {
      if (error instanceof RangeError) { res.status(400).json({ error: 'invalid_printer_id', message: error.message }); return; }
      logger.error({ err: error }, 'Printer status failed'); res.status(500).json({ error: 'status_failed' });
    }
  });
}

/** @description Register history routes with their existing caller and confirmation contracts. */
function registerHistory(router: Router, deps: PrintRouteDeps): void {
  router.get('/jobs/:jobId/submissions', async (req: PrintRequest, res: Response) => {
    try {
      const jobId = requireUuid(req.params.jobId);
      res.json({ submissions: await listSubmissions(deps.pool, req.scanSub as string, jobId) });
    } catch (error) {
      if (error instanceof RangeError) { res.status(400).json({ error: 'invalid_job_id' }); return; }
      logger.error({ err: error }, 'List submissions failed'); res.status(500).json({ error: 'list_failed' });
    }
  });
}

/** @description An HTTP host's outcome for a job's STL or (sliced) G-code. */
async function httpJobOutcome(deps: PrintRouteDeps, sub: string, job: JobRow, printer: NonNullable<Awaited<ReturnType<typeof loadPrinter>>>, body: Record<string, unknown>, start: StartDecision): Promise<{ outcome: PrintOutcome; fileKind: string } | { status: number; body: Record<string, unknown> }> {
  const fileKind = body.fileKind === 'stl' ? 'stl' : 'gcode';
  const resolved = await resolvePrintFile(deps, jobDir(deps.dataRoot, sub, job.job_id), fileKind);
  if (!resolved.ok) return { status: resolved.status, body: resolved.body };
  const fileName = `${sanitizeSolidName(job.title, 'part')}-${job.job_id.slice(0, 8)}.${fileKind}`;
  // An HTTP host is told to start in the upload itself, so the decision is taken here, after slicing.
  const decision = await evaluateStart(start);
  const outcome = await sendToHttpPrinter(serviceDepsOf(deps), printer, { fileName, bytes: new Uint8Array(fs.readFileSync(resolved.path)) }, decision.go);
  if (outcome.uploaded && decision.error) {
    outcome.notStartedReason = `whether to start could not be read (${decision.error}); nothing was started`;
    outcome.message = `Uploaded, not started: ${outcome.notStartedReason}`;
  } else if (outcome.uploaded && !decision.go && typeof start === 'function') {
    outcome.message = 'Uploaded. Auto-start is off for this printer, so it waits on the printer for someone to start it.';
  }
  if (outcome.status === 409) return { status: 409, body: { error: 'unsupported_file', message: outcome.message } };
  return { outcome, fileKind };
}

/** @description A Bambu printer's outcome for a job's STL, sliced for that printer. */
async function bambuJobOutcome(deps: PrintRouteDeps, sub: string, job: JobRow, printer: NonNullable<Awaited<ReturnType<typeof loadPrinter>>>, start: StartDecision, requestedBy: 'person' | 'service'): Promise<{ outcome: PrintOutcome; fileKind: string } | { status: number; body: Record<string, unknown> }> {
  const stl = artifactPath(jobDir(deps.dataRoot, sub, job.job_id), 'stl');
  if (!fs.existsSync(stl)) return { status: 409, body: { error: 'not_reconstructed', message: 'Reconstruct the object before printing.' } };
  // Unique per attempt: a re-print must never overwrite the file a printer is printing from.
  const name = `${sanitizeSolidName(job.title, 'part').slice(0, 48)}-${job.job_id.slice(0, 8)}-${randomBytes(6).toString('hex')}`;
  return { outcome: await sendToBambu(serviceDepsOf(deps), printer, { kind: 'stl', bytes: new Uint8Array(fs.readFileSync(stl)), name }, start, requestedBy), fileKind: 'gcode.3mf' };
}

/**
 * @description Print a job's current model on one of the caller's printers and record the attempt.
 * Shared by the person's Print click and the print service.
 * @param deps - Router dependencies.
 * @param sub - Owner.
 * @param job - The current job.
 * @param body - `{ printerId, fileKind? }`.
 * @param start - The person's checkbox, or the service's last-moment re-read of the printer's auto-start.
 * @param requestedBy - Who asked.
 * @returns HTTP status and body.
 */
export async function printJob(deps: PrintRouteDeps, sub: string, job: JobRow, body: Record<string, unknown>, start: StartDecision, requestedBy: 'person' | 'service'): Promise<{ status: number; body: Record<string, unknown> }> {
  const printer = await loadPrinter(deps.pool, sub, requireUuid(body.printerId));
  if (!printer) return { status: 404, body: { error: 'printer_not_found' } };
  const result = printer.row.kind === BAMBU_KIND
    ? await bambuJobOutcome(deps, sub, job, printer, start, requestedBy)
    : await httpJobOutcome(deps, sub, job, printer, body, start);
  if (!('outcome' in result)) return result;
  const { outcome } = result;
  const submission = await recordAttempt(deps.pool, sub, { jobId: job.job_id, sourceName: null, printer, fileKind: result.fileKind, outcome, requestedBy });
  const failed = outcome.status >= 400 ? { error: 'print_not_sent', message: outcome.message, ...(outcome.installHint ? { installHint: outcome.installHint } : {}) } : {};
  return { status: outcome.status, body: { ...failed, submission, outcome: { ok: outcome.uploaded, uploaded: outcome.uploaded, started: outcome.started, fileName: outcome.fileName, message: outcome.message, estimate: outcome.estimate, sliceProfile: outcome.sliceProfile, installHint: outcome.installHint } } };
}

/** @description Register print routes with their existing caller and confirmation contracts. */
function registerPrint(router: Router, deps: PrintRouteDeps): void {
  router.post('/jobs/:jobId/print', withCurrentJob(deps, async (req: JobRequest, res: Response) => {
    const sub = req.scanSub as string;
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (!hasExplicitWriteConfirmation(body)) { res.status(428).json(confirmationRequiredPayload('scan-to-print.print', 'Sending a job to a printer')); return; }
    const job = req.scanJob as JobRow;
    try {
      if (!requireCurrentOutput(job, res, true)) return;
      const result = await printJob(deps, sub, job, body, body.startPrint === true, 'person');
      res.status(result.status).json(result.body);
    } catch (error) {
      if (error instanceof RangeError) { res.status(400).json({ error: 'invalid_request', message: error.message }); return; }
      logger.error({ err: error, jobId: job?.job_id }, 'Print submission failed'); res.status(500).json({ error: 'print_failed' });
    }
  }));
}

/**
 * @description Compose printer management, owner settings and guarded current-model submission.
 * @param deps - Router dependencies.
 * @returns The router mounted under /api/scan-to-print (OIDC only).
 */
export function createPrintRoutes(deps: PrintRouteDeps): Router {
  const router = Router();
  registerGuard(router, deps);
  registerPrinters(router, deps);
  registerSettings(router, deps);
  registerStatus(router, deps);
  registerHistory(router, deps);
  registerPrint(router, deps);
  return router;
}
