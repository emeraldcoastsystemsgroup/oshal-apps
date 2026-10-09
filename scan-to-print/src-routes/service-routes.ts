/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the swarm PRINT SERVICE (operator decision
 *                     |                             | 2026-10-06: "build it into the app as a service", the way agents
 *                     |                             | already call the RAG service). Mounted `service-or-oidc` at
 *                     |                             | /api/scan-to-print/service: an agent tool, a persona script or
 *                     |                             | another app reaches it with the framework's service secret plus
 *                     |                             | the user it acts for, and every database call is narrowed to that
 *                     |                             | user (requireTrustedServiceUserIdentity) before any route runs.
 *                     |                             | It lists the caller's printers, reads their state, and prints a
 *                     |                             | scan job or a posted model (.stl sliced for the printer, or a
 *                     |                             | sliced .gcode.3mf / .gcode as is). It NEVER decides to start a
 *                     |                             | machine by itself: a job starts only when the printer's owner
 *                     |                             | turned auto-start on for that printer (an OIDC-only setting this
 *                     |                             | mount cannot change); otherwise the file is uploaded and the reply
 *                     |                             | says to start it on the printer. Whether an agent may call the
 *                     |                             | print tool unattended is the operator's per-agent grant
 *                     |                             | (auto / ask / off), not anything this router chooses.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Review fixes, and the trust model stated as it is: the owner's
 *                     |                             | auto-start is the gate this router enforces for EVERY caller,
 *                     |                             | re-read from the database at the moment a start would be sent
 *                     |                             | (after slicing and upload), so switching it off stops a job in
 *                     |                             | flight. The operator's per-agent grant governs only calls made
 *                     |                             | through the manifest's print tool; the router cannot see it.
 *                     |                             | Under core application authorization in enforce mode a bare
 *                     |                             | service-secret call has no verified identity and core refuses it
 *                     |                             | (401) before this router runs. GET /jobs lists the user's scan
 *                     |                             | jobs for the tools; a posted model gets a unique name on the
 *                     |                             | printer and is recorded under the kind actually sent.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Second review: a caller's own machine instructions — raw G-code,
 *                     |                             | like a sliced .gcode.3mf — are uploaded but never auto-started
 *                     |                             | (auto-start covers models this package slices); replies report
 *                     |                             | the printer's auto-start as it stands after the attempt.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | A failed posted-model print carries installHint at the top level
 *                     |                             | too, the same shape the job print routes answer with.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | 0.7.0: choosePrinter, autoStartNow and autoStartForReply are
 *                     |                             | exported for the package tools (print-tools.ts), so an agent's
 *                     |                             | print and a service call choose the printer and read the owner's
 *                     |                             | auto-start the same way.
 */

import { Router, type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import { AsyncResource } from 'node:async_hooks';
import multer from 'multer';
import { createChildLogger } from '@/shared/logger';
import { requireTrustedServiceUserIdentity } from '@/shared/middleware/trusted-service-user-identity';
import { randomBytes } from 'node:crypto';
import { getPrinterAutoStart, listJobs, listPrinters, listRecentSubmissions, type JobRow } from './job-store';
import { requireUuid } from './data-dir';
import { BAMBU_KIND, fileKindOf } from './engine/print/printer-adapters';
import { type JobRequest, requireCurrentOutput, withCurrentJob } from './job-outputs';
import { type PrintRouteDeps, printJob, serviceDepsOf } from './print-routes';
import { type LoadedPrinter, type PrintModel, type PrintOutcome, loadPrinter, printerFileName, printerState, recordAttempt, sendToBambu, sendToHttpPrinter } from './print-service';

const logger = createChildLogger({ module: 'scan-to-print-service-routes' });

/** @description Largest model the service accepts in one request. */
export const SERVICE_MODEL_MAX_BYTES = 64 * 1024 * 1024;

/** @description Request-local state. */
interface ServiceRequest extends Request { scanSub?: string; file?: Express.Multer.File }

/** @description Keep the request identity across multer's callbacks (it leaves the async context). */
function preserveUploadContext(upload: RequestHandler): RequestHandler {
  return (req, res, next) => upload(req, res, AsyncResource.bind(next));
}

/**
 * @description Pick the printer: the one named, else the caller's only printer.
 * @param deps - Print dependencies.
 * @param sub - The owner.
 * @param requested - The printer id the caller named, if any.
 * @returns The printer id, or the refusal to answer.
 */
export async function choosePrinter(deps: PrintRouteDeps, sub: string, requested: unknown): Promise<{ printerId: string } | { status: number; body: Record<string, unknown> }> {
  if (requested !== undefined && requested !== null && requested !== '') return { printerId: requireUuid(requested) };
  const printers = await listPrinters(deps.pool, sub);
  if (printers.length === 1) return { printerId: printers[0].printer_id };
  return { status: 400, body: { error: printers.length ? 'printer_required' : 'no_printers', message: printers.length ? 'This person has more than one printer; name one with printerId.' : 'This person has no printer registered in Scan to Print.', printers: printers.map((p) => ({ printerId: p.printer_id, label: p.label, kind: p.kind })) } };
}

/**
 * @description The printer's auto-start for a reply: as it stands now, or null when it cannot be read (the attempt already happened).
 * @param deps - Print dependencies.
 * @param sub - The owner.
 * @param printerId - The printer.
 * @returns The setting, or null.
 */
export async function autoStartForReply(deps: PrintRouteDeps, sub: string, printerId: string): Promise<boolean | null> {
  try { return await getPrinterAutoStart(deps.pool, sub, printerId); } catch (error) {
    logger.error({ err: error, printerId }, 'Could not read auto-start for the reply');
    return null;
  }
}

/**
 * @description The owner's auto-start, read when the start would be sent — never earlier.
 * @param deps - Print dependencies.
 * @param sub - The owner.
 * @param printerId - The printer.
 * @returns A decision the print path evaluates at start time.
 */
export function autoStartNow(deps: PrintRouteDeps, sub: string, printerId: string): () => Promise<boolean> {
  return () => getPrinterAutoStart(deps.pool, sub, printerId);
}

/** @description The model a posted file represents, with a name unique on the printer's storage. */
function modelOf(file: Express.Multer.File): PrintModel | null {
  const original = String(file.originalname || 'model');
  const name = `${original.replace(/\.(gcode\.3mf|stl|gcode|gco|g|bgcode|3mf)$/i, '').slice(0, 64)}-${randomBytes(6).toString('hex')}`;
  if (/\.gcode\.3mf$/i.test(original)) return { kind: 'gcode.3mf', bytes: new Uint8Array(file.buffer), name };
  const kind = fileKindOf(original);
  if (kind === 'stl') return { kind: 'stl', bytes: new Uint8Array(file.buffer), name };
  if (kind === 'gcode') return { kind: 'gcode', bytes: new Uint8Array(file.buffer), name: printerFileName(name, original.slice(original.lastIndexOf('.')).toLowerCase()) };
  return null;
}

/**
 * @description Send a posted model to a loaded printer. A model this package slices (STL) starts under
 * the owner's auto-start, read at start time; the caller's own machine instructions (a sliced
 * .gcode.3mf, raw G-code) are uploaded and never auto-started.
 */
async function sendModel(deps: PrintRouteDeps, sub: string, printer: LoadedPrinter, model: PrintModel): Promise<PrintOutcome> {
  if (printer.row.kind === BAMBU_KIND) return sendToBambu(serviceDepsOf(deps), printer, model, autoStartNow(deps, sub, printer.row.printer_id), 'service');
  if (model.kind !== 'gcode') return { status: 409, uploaded: false, started: false, fileName: null, message: `${printer.row.kind} hosts take sliced G-code from the print service; slice the model first.` };
  const outcome = await sendToHttpPrinter(serviceDepsOf(deps), printer, { fileName: model.name, bytes: model.bytes }, false);
  return outcome.uploaded ? { ...outcome, message: 'Uploaded. Posted G-code waits on the printer host for someone to start it.' } : outcome;
}

/** @description The reply for one recorded attempt; `autoStart` is the printer's setting as it stands now. */
function answer(outcome: PrintOutcome, printer: LoadedPrinter, submission: unknown, autoStart: boolean | null): Record<string, unknown> {
  return {
    submission,
    printer: { printerId: printer.row.printer_id, label: printer.row.label, kind: printer.row.kind, autoStart },
    outcome: { uploaded: outcome.uploaded, started: outcome.started, fileName: outcome.fileName, message: outcome.message, estimate: outcome.estimate, sliceProfile: outcome.sliceProfile, installHint: outcome.installHint },
  };
}

/** @description Identity: narrow service callers to their user, then require one. */
function registerGuard(router: Router, deps: PrintRouteDeps): void {
  router.use(requireTrustedServiceUserIdentity);
  router.use((req: ServiceRequest, res: Response, next: NextFunction) => {
    const sub = deps.callerSub(req);
    if (!sub) { res.status(401).json({ error: 'unauthenticated' }); return; }
    req.scanSub = sub;
    res.setHeader('Cache-Control', 'private, no-store');
    next();
  });
}

/** @description Read-only: printers, one printer's state, recent submissions. */
function registerReads(router: Router, deps: PrintRouteDeps): void {
  router.get('/printers', async (req: ServiceRequest, res: Response) => {
    try {
      const printers = await listPrinters(deps.pool, req.scanSub as string);
      res.json({ printers: printers.map((p) => ({ printerId: p.printer_id, label: p.label, kind: p.kind, model: p.device_model, autoStart: p.auto_start, sliceProfile: p.slice_profile })) });
    } catch (error) { logger.error({ err: error }, 'Service printer list failed'); res.status(500).json({ error: 'list_failed' }); }
  });

  router.get('/printers/:printerId/status', async (req: ServiceRequest, res: Response) => {
    try {
      const printer = await loadPrinter(deps.pool, req.scanSub as string, requireUuid(req.params.printerId));
      if (!printer) { res.status(404).json({ error: 'printer_not_found' }); return; }
      const status = await printerState(serviceDepsOf(deps), printer);
      res.status(status.ok ? 200 : 502).json({ printer: { printerId: printer.row.printer_id, label: printer.row.label, kind: printer.row.kind, autoStart: printer.row.auto_start }, status });
    } catch (error) {
      if (error instanceof RangeError) { res.status(400).json({ error: 'invalid_printer_id', message: error.message }); return; }
      logger.error({ err: error }, 'Service printer status failed'); res.status(500).json({ error: 'status_failed' });
    }
  });

  router.get('/jobs', async (req: ServiceRequest, res: Response) => {
    try {
      const jobs = await listJobs(deps.pool, req.scanSub as string);
      res.json({ jobs: jobs.map((j) => ({ jobId: j.job_id, title: j.title, state: j.state, source: j.source_kind, printable: j.state === 'reconstructed' && (j.report as { printable?: unknown } | null)?.printable === true, updatedAt: j.updated_at })) });
    } catch (error) { logger.error({ err: error }, 'Service job list failed'); res.status(500).json({ error: 'list_failed' }); }
  });

  router.get('/submissions', async (req: ServiceRequest, res: Response) => {
    try { res.json({ submissions: await listRecentSubmissions(deps.pool, req.scanSub as string) }); } catch (error) { logger.error({ err: error }, 'Service submissions failed'); res.status(500).json({ error: 'list_failed' }); }
  });
}

/** @description Print a scan job's current model. */
function registerJobPrint(router: Router, deps: PrintRouteDeps): void {
  router.post('/jobs/:jobId/print', withCurrentJob(deps, async (req: JobRequest, res: Response) => {
    const sub = req.scanSub as string;
    const job = req.scanJob as JobRow;
    try {
      if (!requireCurrentOutput(job, res, true)) return;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const chosen = await choosePrinter(deps, sub, body.printerId);
      if (!('printerId' in chosen)) { res.status(chosen.status).json(chosen.body); return; }
      const printer = await loadPrinter(deps.pool, sub, chosen.printerId);
      if (!printer) { res.status(404).json({ error: 'printer_not_found' }); return; }
      const result = await printJob(deps, sub, job, { printerId: chosen.printerId, fileKind: 'gcode' }, autoStartNow(deps, sub, chosen.printerId), 'service');
      const autoStart = await autoStartForReply(deps, sub, chosen.printerId);
      res.status(result.status).json({ ...result.body, printer: { printerId: printer.row.printer_id, label: printer.row.label, kind: printer.row.kind, autoStart } });
    } catch (error) {
      if (error instanceof RangeError) { res.status(400).json({ error: 'invalid_request', message: error.message }); return; }
      logger.error({ err: error, jobId: job?.job_id }, 'Service job print failed'); res.status(500).json({ error: 'print_failed' });
    }
  }));
}

/** @description Print a posted model file (multipart field `model`). */
function registerFilePrint(router: Router, deps: PrintRouteDeps): void {
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: SERVICE_MODEL_MAX_BYTES, files: 1 } });
  router.post('/print', preserveUploadContext(upload.single('model')), async (req: ServiceRequest, res: Response) => {
    const sub = req.scanSub as string;
    try {
      if (!req.file) { res.status(400).json({ error: 'model_required', message: 'Post the model as multipart field "model" (.stl, .gcode.3mf or .gcode).' }); return; }
      const model = modelOf(req.file);
      if (!model) { res.status(415).json({ error: 'unsupported_model', message: 'The print service takes .stl, .gcode.3mf or .gcode.' }); return; }
      const chosen = await choosePrinter(deps, sub, (req.body ?? {}).printerId);
      if (!('printerId' in chosen)) { res.status(chosen.status).json(chosen.body); return; }
      const printer = await loadPrinter(deps.pool, sub, chosen.printerId);
      if (!printer) { res.status(404).json({ error: 'printer_not_found' }); return; }
      const outcome = await sendModel(deps, sub, printer, model);
      const fileKind = printer.row.kind === BAMBU_KIND ? 'gcode.3mf' : model.kind;
      const submission = outcome.status === 409 ? null : await recordAttempt(deps.pool, sub, { jobId: null, sourceName: String(req.file.originalname || 'model').slice(0, 200), printer, fileKind, outcome, requestedBy: 'service' });
      const failed = outcome.status >= 400 ? { error: 'print_not_sent', message: outcome.message, ...(outcome.installHint ? { installHint: outcome.installHint } : {}) } : {};
      res.status(outcome.status).json({ ...failed, ...answer(outcome, printer, submission, await autoStartForReply(deps, sub, printer.row.printer_id)) });
    } catch (error) {
      if (error instanceof RangeError) { res.status(400).json({ error: 'invalid_request', message: error.message }); return; }
      logger.error({ err: error }, 'Service file print failed'); res.status(500).json({ error: 'print_failed' });
    }
  });
  router.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (error instanceof multer.MulterError) { res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: 'upload_rejected', message: error.message }); return; }
    next(error);
  });
}

/**
 * @description Compose the print service router.
 * @param deps - The same dependencies the person's print routes use.
 * @returns The router mounted at /api/scan-to-print/service.
 */
export function createPrintServiceRouter(deps: PrintRouteDeps): Router {
  const router = Router();
  registerGuard(router, deps);
  registerReads(router, deps);
  registerJobPrint(router, deps);
  registerFilePrint(router, deps);
  return router;
}
