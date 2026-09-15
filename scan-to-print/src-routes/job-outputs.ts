/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Retire stale geometry before input changes and serialize one job's reads, rebuilds and print preparation in the current single-API process.
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

/** @description Admit once without a queue; release only after the complete handler settles. This is a single-API guard, not a distributed lock. */
export function withCurrentJob(deps: OutputDeps, handler: JobHandler, mode: 'read' | 'write' = 'write'): RequestHandler {
  return async (req: JobRequest, res: Response) => {
    let release: (() => void) | undefined;
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      const sub = req.scanSub;
      if (!sub) { res.status(401).json({ error: 'unauthenticated' }); return; }
      const id = requireUuid(req.params.jobId), key = JSON.stringify([deps.dataRoot, sub, id]);
      const jobs = active.get(deps.pool) ?? new Map<string, Operation>();
      active.set(deps.pool, jobs);
      const operation = jobs.get(key) ?? { readers: 0, writing: false };
      if (operation.writing || mode === 'write' && operation.readers > 0) { res.status(409).json({ error: 'job_busy', message: 'This object is busy. Wait for the current operation, then try again.' }); return; }
      if (!jobs.has(key) && jobs.size >= MAX_ACTIVE_JOBS) { res.status(503).json({ error: 'jobs_busy', message: 'Scan storage is busy. Try again shortly.' }); return; }
      if (mode === 'read') operation.readers += 1; else operation.writing = true;
      jobs.set(key, operation);
      release = () => {
        if (mode === 'read') operation.readers -= 1; else operation.writing = false;
        if (!operation.writing && operation.readers === 0) jobs.delete(key);
      };
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

/** @description Explain stale output consistently; nonprintable current geometry remains available for inspection. */
export function requireCurrentOutput(job: JobRow, res: Response, printing = false): boolean {
  if (!hasCurrentOutput(job)) {
    res.status(409).json({ error: 'output_stale', message: 'Reconstruct this object after changing its inputs before downloading or printing.' }); return false;
  }
  if (printing && job.report?.printable !== true) {
    res.status(409).json({ error: 'model_not_printable', message: 'The current model failed its mesh checks. Inspect the report and reconstruct before printing.' }); return false;
  }
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
