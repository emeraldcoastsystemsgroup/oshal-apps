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
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import fs from 'node:fs';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { createChildLogger } from '@/shared/logger';
import { decryptField, encryptField, isEncrypted } from '@/features/personal-data';
import { confirmationRequiredPayload, hasExplicitWriteConfirmation } from '@/shared/security/explicit-write-confirmation';
import { deletePrinter, getPrinterWithKey, insertPrinter, insertSubmission, listPrinters, listSubmissions, type JobRow, type QueryablePool } from './job-store';
import { artifactPath, jobDir, requireUuid } from './data-dir';
import { type FetchLike, type PrinterKind, PRINTER_KINDS, adapterFor, hostAccepts, validatePrinterBaseUrl } from './engine/print/printer-adapters';
import { type ExecFileLike, resolveSlicerConfig, sliceStl } from './engine/print/slicer';
import { sanitizeSolidName } from './engine/geometry/export-stl';
import { type JobRequest, requireCurrentOutput, withCurrentJob } from './job-outputs';

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
  /** Network client for printer hosts; injectable for specs. */
  fetchImpl?: FetchLike;
  /** Process runner for the slicer; injectable for specs. */
  execFile?: ExecFileLike;
}

/** @description Request-local state. */
interface PrintRequest extends Request { scanSub?: string }

/** @description Printer creation body validation. */
function parsePrinterBody(raw: unknown): { label: string; kind: PrinterKind; baseUrl: string; apiKey: string } {
  const body = (raw ?? {}) as Record<string, unknown>;
  const label = String(body.label ?? '').trim().slice(0, 80);
  const kind = String(body.kind ?? '');
  const apiKey = String(body.apiKey ?? '').trim();
  if (!label) throw new RangeError('label is required');
  if (!(PRINTER_KINDS as readonly string[]).includes(kind)) throw new RangeError(`kind must be one of ${PRINTER_KINDS.join(', ')}`);
  if (!apiKey || apiKey.length > 512) throw new RangeError('apiKey is required');
  const url = validatePrinterBaseUrl(String(body.baseUrl ?? ''));
  if (!url.ok) throw new RangeError(`baseUrl: ${url.reason}`);
  return { label, kind: kind as PrinterKind, baseUrl: url.url, apiKey };
}

/** @description Resolve a printer's profile with its decrypted key, or null. */
async function loadProfile(deps: PrintRouteDeps, sub: string, printerId: string) {
  const row = await getPrinterWithKey(deps.pool, sub, printerId);
  if (!row) return null;
  const apiKey = decryptField(sub, row.api_key_ciphertext);
  if (!apiKey || isEncrypted(apiKey)) throw new Error('Printer key decryption failed closed');
  return { row, profile: { kind: row.kind as PrinterKind, baseUrl: row.base_url, apiKey } };
}

/** @description Ensure the requested file exists, slicing STL → G-code on demand when configured. */
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

/** @description Register printers routes with their existing caller and confirmation contracts. */
function registerPrinters(router: Router, deps: PrintRouteDeps): void {
  router.get('/printers', async (req: PrintRequest, res: Response) => {
    try {
      res.json({ printers: await listPrinters(deps.pool, req.scanSub as string), kinds: PRINTER_KINDS, slicerConfigured: resolveSlicerConfig(deps.env) !== null });
    } catch (error) { logger.error({ err: error }, 'List printers failed'); res.status(500).json({ error: 'list_failed' }); }
  });

  router.post('/printers', async (req: PrintRequest, res: Response) => {
    const sub = req.scanSub as string;
    try {
      const body = parsePrinterBody(req.body);
      const apiKeyCiphertext = encryptField(sub, body.apiKey);
      if (!apiKeyCiphertext || !isEncrypted(apiKeyCiphertext)) throw new Error('Printer key encryption failed closed');
      const printer = await insertPrinter(deps.pool, sub, { label: body.label, kind: body.kind, baseUrl: body.baseUrl, apiKeyCiphertext });
      res.status(201).json({ printer });
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

/** @description Register status routes with their existing caller and confirmation contracts. */
function registerStatus(router: Router, deps: PrintRouteDeps, fetchImpl: FetchLike): void {
  router.post('/printers/:printerId/status', async (req: PrintRequest, res: Response) => {
    try {
      const loaded = await loadProfile(deps, req.scanSub as string, requireUuid(req.params.printerId));
      if (!loaded) { res.status(404).json({ error: 'printer_not_found' }); return; }
      const status = await adapterFor(loaded.profile.kind).status(loaded.profile, fetchImpl);
      res.status(status.ok ? 200 : 502).json({ printer: loaded.row, status });
    } catch (error) {
      if (error instanceof RangeError) { res.status(400).json({ error: 'invalid_printer_id' }); return; }
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

/** @description Register print routes with their existing caller and confirmation contracts. */
function registerPrint(router: Router, deps: PrintRouteDeps, fetchImpl: FetchLike): void {
  router.post('/jobs/:jobId/print', withCurrentJob(deps, async (req: JobRequest, res: Response) => {
    const sub = req.scanSub as string;
    const body = (req.body ?? {}) as Record<string, unknown>;
    if (!hasExplicitWriteConfirmation(body)) { res.status(428).json(confirmationRequiredPayload('scan-to-print.print', 'Sending a job to a printer')); return; }
    let job: JobRow | null = null;
    try {
      job = req.scanJob as JobRow;
      if (!requireCurrentOutput(job, res, true)) return;
      const loaded = await loadProfile(deps, sub, requireUuid(body.printerId));
      if (!loaded) { res.status(404).json({ error: 'printer_not_found' }); return; }
      const fileKind = body.fileKind === 'stl' ? 'stl' : 'gcode';
      const startPrint = body.startPrint === true;
      const resolved = await resolvePrintFile(deps, jobDir(deps.dataRoot, sub, job.job_id), fileKind);
      if (!resolved.ok) { res.status(resolved.status).json(resolved.body); return; }
      const fileName = `${sanitizeSolidName(job.title, 'part')}-${job.job_id.slice(0, 8)}.${fileKind}`;
      if (!hostAccepts(loaded.profile.kind, fileName)) { res.status(409).json({ error: 'unsupported_file', message: `${loaded.profile.kind} does not accept .${fileKind} uploads; send G-code.` }); return; }
      const outcome = await adapterFor(loaded.profile.kind).upload(loaded.profile, { fileName, bytes: new Uint8Array(fs.readFileSync(resolved.path)), startPrint }, fetchImpl);
      const submission = await insertSubmission(deps.pool, sub, {
        jobId: job.job_id, printerId: loaded.row.printer_id, fileName, fileKind, started: outcome.started,
        state: outcome.ok ? (outcome.started ? 'printing' : 'uploaded') : 'failed', failureReason: outcome.ok ? null : outcome.message, remote: outcome.remote ?? null,
      });
      logger.info({ jobId: job.job_id, printerId: loaded.row.printer_id, ok: outcome.ok, started: outcome.started, status: outcome.status }, 'Print submission recorded');
      res.status(outcome.ok ? 201 : 502).json({ submission, outcome: { ok: outcome.ok, status: outcome.status, message: outcome.message } });
    } catch (error) {
      if (error instanceof RangeError) { res.status(400).json({ error: 'invalid_request', message: error.message }); return; }
      logger.error({ err: error, jobId: job?.job_id }, 'Print submission failed'); res.status(500).json({ error: 'print_failed' });
    }
  }));
}

/** @description Compose printer management and guarded current-model submission. */
export function createPrintRoutes(deps: PrintRouteDeps): Router {
  const router = Router();
  const fetchImpl: FetchLike = deps.fetchImpl ?? ((url, init) => fetch(url, init));
  registerGuard(router, deps);
  registerPrinters(router, deps);
  registerStatus(router, deps, fetchImpl);
  registerHistory(router, deps);
  registerPrint(router, deps, fetchImpl);
  return router;
}
