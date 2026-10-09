/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Retire stale geometry before input changes and serialize one job's reads, rebuilds and print preparation in the current single-API process.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | 0.7.0: the admission itself is claimJobOperation and the stale/not-printable answer is currentOutputRefusal, so the print package tool (print-tools.ts), which runs without an HTTP request, takes the same per-job lock and gives the same refusals as the routes: a print never prepares files while a rebuild writes them. withCurrentJob and requireCurrentOutput answer exactly as before.
 */
import type { Request, Response, RequestHandler } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { type JobRow, type QueryablePool, getJob, updateJob } from './job-store';
import { ARTIFACT_FILES, type ArtifactKey, artifactPath, jobDir, requireUuid } from './data-dir';

/** @description Shared owner/job context for guarded handlers. */
export interface JobRequest extends Request { scanSub?: string; scanJob?: JobRow }
/** @description Only storage dependencies are needed to coordinate current outputs. */
export interface OutputDeps { pool: QueryablePool; dataRoot: string }
type JobHandler = (req: JobRequest, res: Response) => Promise<unknown> | unknown;
interface Operation { readers: number; writing: boolean }
const active = new WeakMap<QueryablePool, Map<string, Operation>>();
const MAX_ACTIVE_JOBS = 128;

/** @description Retire only this request's bounded disk upload, including a busy/not-found refusal before its handler runs. */
function cleanupUpload(deps: OutputDeps, req: JobRequest): void {
  if (!req.file?.path || !req.scanSub) return;
  try {
    const expected = path.join(jobDir(deps.dataRoot, req.scanSub, requireUuid(req.params.jobId)), 'uploads');
    if (path.dirname(path.resolve(req.file.path)) === path.resolve(expected)) fs.rmSync(req.file.path, { force: true });
  } catch { /* A failed cleanup cannot release or publish stale geometry. */ }
}

/** @description A refusal to admit one more operation on a job, with the status and body the routes answer. */
export interface JobRefusal { status: number; body: { error: string; message?: string } }

/**
 * @description Admit one operation on one job without a queue: readers share, a writer is alone. This is a
 * single-API guard, not a distributed lock. The caller MUST call `release` once its whole operation settles.
 * @param deps - Pool and data root (the lock is per pool and per data root).
 * @param sub - The owner.
 * @param jobId - The job (already a validated UUID).
 * @param mode - `read` or `write`.
 * @returns A release function, or why the job cannot be admitted now.
 */
export function claimJobOperation(deps: OutputDeps, sub: string, jobId: string, mode: 'read' | 'write'): { release: () => void } | JobRefusal {
  const key = JSON.stringify([deps.dataRoot, sub, jobId]);
  const jobs = active.get(deps.pool) ?? new Map<string, Operation>();
  active.set(deps.pool, jobs);
  const operation = jobs.get(key) ?? { readers: 0, writing: false };
  if (operation.writing || mode === 'write' && operation.readers > 0) return { status: 409, body: { error: 'job_busy', message: 'This object is busy. Wait for the current operation, then try again.' } };
  if (!jobs.has(key) && jobs.size >= MAX_ACTIVE_JOBS) return { status: 503, body: { error: 'jobs_busy', message: 'Scan storage is busy. Try again shortly.' } };
  if (mode === 'read') operation.readers += 1; else operation.writing = true;
  jobs.set(key, operation);
  return { release: () => {
    if (mode === 'read') operation.readers -= 1; else operation.writing = false;
    if (!operation.writing && operation.readers === 0) jobs.delete(key);
  } };
}

/** @description Admit once without a queue; release only after the complete handler settles. This is a single-API guard, not a distributed lock. */
export function withCurrentJob(deps: OutputDeps, handler: JobHandler, mode: 'read' | 'write' = 'write'): RequestHandler {
  return async (req: JobRequest, res: Response) => {
    let release: (() => void) | undefined;
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      const sub = req.scanSub;
      if (!sub) { res.status(401).json({ error: 'unauthenticated' }); return; }
      const id = requireUuid(req.params.jobId);
      const claim = claimJobOperation(deps, sub, id, mode);
      if (!('release' in claim)) { res.status(claim.status).json(claim.body); return; }
      release = claim.release;
      const job = await getJob(deps.pool, sub, id);
      if (!job) { res.status(404).json({ error: 'job_not_found' }); return; }
      req.scanJob = job;
      await handler(req, res);
    } catch (error) {
      if (!res.headersSent) res.status(error instanceof RangeError ? 400 : 500).json({ error: error instanceof RangeError ? 'invalid_job_id' : 'job_operation_failed' });
    } finally { cleanupUpload(deps, req); release?.(); }
  };
}

/** @description Current legacy results remain readable; changed or failed inputs cannot expose retired files. */
export function hasCurrentOutput(job: JobRow): boolean { return job.state === 'reconstructed' && typeof job.report === 'object' && job.report !== null && !Array.isArray(job.report); }

/**
 * @description Why a job's output cannot be downloaded or printed now, or null when it can.
 * @param job - The job.
 * @param printing - True when the output is about to be printed (it must also be printable).
 * @returns The refusal the routes and the print tool answer with, or null.
 */
export function currentOutputRefusal(job: JobRow, printing = false): JobRefusal | null {
  if (!hasCurrentOutput(job)) return { status: 409, body: { error: 'output_stale', message: 'Reconstruct this object after changing its inputs before downloading or printing.' } };
  if (printing && job.report?.printable !== true) return { status: 409, body: { error: 'model_not_printable', message: 'The current model failed its mesh checks. Inspect the report and reconstruct before printing.' } };
  return null;
}

/** @description Explain stale output consistently; nonprintable current geometry remains available for inspection. */
export function requireCurrentOutput(job: JobRow, res: Response, printing = false): boolean {
  const refusal = currentOutputRefusal(job, printing);
  if (refusal) { res.status(refusal.status).json(refusal.body); return false; }
  return true;
}

/** @description Presence never overrides the persisted freshness state. */
export function artifactPresence(dir: string, job: JobRow): Record<ArtifactKey, boolean> {
  return Object.fromEntries((Object.keys(ARTIFACT_FILES) as ArtifactKey[]).map(key =>
    [key, hasCurrentOutput(job) && fs.existsSync(artifactPath(dir, key))])) as Record<ArtifactKey, boolean>;
}

/** @description Persist invalidation before removing fixed known output files; failed deletion leaves downloads and printing denied. */
export async function retireOutput(deps: OutputDeps, sub: string, job: JobRow): Promise<JobRow> {
  const updated = await updateJob(deps.pool, sub, job.job_id, { state: 'capturing', report: null, failure_reason: null });
  if (!updated) throw new Error('Job disappeared before output invalidation');
  const dir = jobDir(deps.dataRoot, sub, job.job_id);
  for (const key of Object.keys(ARTIFACT_FILES) as ArtifactKey[]) fs.rmSync(artifactPath(dir, key), { force: true });
  return updated;
}
