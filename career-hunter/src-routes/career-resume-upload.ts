/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Extract resume ingestion behind an opaque preclaim, atomic writes, acknowledged child adoption, and exact rejection rollback.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Reserve the user store before multipart parsing and move upload transactions to promise-based filesystem operations.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Track each ingest through child completion so a prior profile cannot hide a pending or failed re-upload.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Bound multipart file, field, part, header, and field-name counts before a resume reaches route logic.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Account for Busboy's closing-boundary part counter so one valid resume is accepted while multipart fan-out remains rejected.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Persist pending ingest state before resume mutation and reconcile newer JSON or legacy markers after crash-window recovery.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Pass the durable ingest operation identity to the adopted wrapper for terminal-state recovery after API parent loss.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | Isolate bounded multipart admission from engine capacity and terminate slow request bodies at a finite deadline.
 * 9 | maintainer@emeraldcoastsystemsgroup.com | Enforce the independent cross-process upload-body ceiling before Multer buffers a resume.
 * 10 | maintainer@emeraldcoastsystemsgroup.com | Serialize lifecycle commits and honor observer aborts so a timed-out stale completion cannot replace a newer operation.
 */
/**
 * Transactional Career resume upload and engine hand-off.
 *
 * The user-store lease is acquired before either the canonical resume or `.indexing` marker is
 * replaced. Once the operating system accepts the child, the runner owns that lease until exit;
 * any brokerage/spawn rejection restores the exact previous bytes and the established HTTP status.
 *
 * @module career-resume-upload
 */
import { type Router, type Request, type Response, type NextFunction } from 'express';
import path from 'path';
import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import multer from 'multer';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { callerSub, userPaths } from './career-user-store';
import { runCareerCliAsync } from './career-engine-dispatch';
import { rejectEngineStart, rejectUploadClaim } from './career-engine-response';
import {
  releaseRun, tryAcquireRun, tryAcquireStorageRun, tryAcquireUploadRun,
  type CliCompletion, type CliStartResult, type RunLease,
} from './career-engine-runner';
import { restoreFilesAsync, snapshotFilesAsync, writeFileAtomicAsync } from './career-file-transaction';

const logger = createChildLogger({ module: 'career-resume-upload' });
const resumeUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 8 * 1024 * 1024,
    files: 1,
    fields: 0,
    parts: 2,
    fieldNameSize: 64,
    fieldSize: 4 * 1024,
    headerPairs: 32,
  },
});
const parseResumeFile = resumeUpload.single('resume');
const RESUME_LEASE = Symbol('career-resume-lease');
const RESUME_UPLOAD_TIMER = Symbol('career-resume-upload-timer');
const RESUME_UPLOAD_TIMED_OUT = Symbol('career-resume-upload-timed-out');
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.docx', '.txt', '.md']);
const INGEST_STATUS_FILE = '.resume-ingest.json';
const INGEST_MARKER_FILE = '.indexing';

interface UploadedResume {
  buffer: Buffer;
  originalname?: string;
}

type ResumeUploadRequest = Request & {
  [RESUME_LEASE]?: RunLease;
  [RESUME_UPLOAD_TIMER]?: NodeJS.Timeout;
  [RESUME_UPLOAD_TIMED_OUT]?: boolean;
};

/** @description Durable lifecycle state returned by resume onboarding polling. */
export interface ResumeIngestState {
  state: 'idle' | 'pending' | 'succeeded' | 'failed';
  operationId?: string;
  startedAt?: number;
  finishedAt?: number;
  error?: string;
}

/** Resolve canonical lifecycle paths for one contained user store. */
function ingestPaths(userSub: string): { status: string; marker: string } {
  const userDir = userPaths(userSub).userDir;
  return {
    status: path.join(userDir, INGEST_STATUS_FILE),
    marker: path.join(userDir, INGEST_MARKER_FILE),
  };
}

/** Parse one status file and reject malformed lifecycle data. */
async function readStatusFile(filePath: string): Promise<ResumeIngestState | null> {
  try {
    const value = JSON.parse(await fs.readFile(filePath, 'utf8')) as ResumeIngestState;
    if (!['pending', 'succeeded', 'failed'].includes(value.state)) throw new Error('invalid ingest state');
    return value;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    logger.error({ err: error }, 'career resume ingest status is unreadable');
    return { state: 'failed', error: 'resume ingest status is unreadable' };
  }
}

/** Bound pending state across an API restart where no completion callback can survive. */
function expireInterruptedIngest(status: ResumeIngestState): ResumeIngestState {
  if (status.state !== 'pending' || !status.startedAt) return status;
  const configured = Number(process.env.CAREER_HUNTER_CLI_TIMEOUT_MS) || 2 * 60 * 60 * 1_000;
  const maxAge = Math.min(24 * 60 * 60 * 1_000, Math.max(1_000, configured)) + 5 * 60 * 1_000;
  if (Date.now() - status.startedAt <= maxAge) return status;
  return { ...status, state: 'failed', finishedAt: status.startedAt + maxAge, error: 'resume ingest was interrupted' };
}

/** Read either the current pending marker or a legacy numeric timestamp marker. */
async function readIngestMarker(marker: string): Promise<ResumeIngestState | null> {
  try {
    const raw = await fs.readFile(marker, 'utf8');
    if (raw.trim().startsWith('{')) {
      const state = JSON.parse(raw) as ResumeIngestState;
      if (state.state !== 'pending' || !Number.isFinite(state.startedAt)) throw new Error('invalid ingest marker');
      return expireInterruptedIngest(state);
    }
    const startedAt = Number(raw);
    if (!Number.isFinite(startedAt)) return { state: 'failed', error: 'resume ingest marker is invalid' };
    return expireInterruptedIngest({ state: 'pending', operationId: 'legacy', startedAt });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') logger.error({ err: error }, 'career resume ingest marker is unreadable');
    return (error as NodeJS.ErrnoException).code === 'ENOENT'
      ? null : { state: 'failed', error: 'resume ingest marker is unreadable' };
  }
}

/** Prefer a newer pending marker over stale success/failure left by an interrupted re-upload. */
function reconcileIngestState(
  status: ResumeIngestState | null, marker: ResumeIngestState | null,
): ResumeIngestState {
  if (!status) return marker || { state: 'idle' };
  if (!marker || marker.state !== 'pending' || !marker.startedAt) return expireInterruptedIngest(status);
  const statusAt = Math.max(status.startedAt || 0, status.finishedAt || 0);
  return marker.startedAt > statusAt ? marker : expireInterruptedIngest(status);
}

/**
 * @description Read the current resume-ingest lifecycle without using an old profile as completion.
 * @param userSub authenticated caller subject
 * @returns durable pending/success/failure state, including bounded legacy marker recovery
 */
export async function readResumeIngestState(userSub: string): Promise<ResumeIngestState> {
  const paths = ingestPaths(userSub);
  const [status, marker] = await Promise.all([
    readStatusFile(paths.status), readIngestMarker(paths.marker),
  ]);
  return reconcileIngestState(status, marker);
}

/** Allow a just-spawned child to outlive the short pending-state transaction before completing. */
async function claimResumeLifecycle(userSub: string, signal?: AbortSignal): Promise<RunLease> {
  let lease = tryAcquireStorageRun(userSub, 'resume-lifecycle');
  for (let attempt = 0; lease.status === 'inflight' && attempt < 4; attempt += 1) {
    if (signal?.aborted) return lease;
    await new Promise((resolve) => setTimeout(resolve, 10));
    lease = tryAcquireStorageRun(userSub, 'resume-lifecycle');
  }
  return lease;
}

/** Finish only the operation whose marker is still current, then remove its legacy marker. */
async function finalizeResumeIngest(
  userSub: string, operationId: string, completion: CliCompletion, signal?: AbortSignal,
): Promise<void> {
  const lifecycle = await claimResumeLifecycle(userSub, signal);
  if (lifecycle.status !== 'ok') {
    logger.warn({ userSub, operationId, reason: lifecycle.status }, 'resume completion lifecycle busy');
    return;
  }
  try {
    if (signal?.aborted) return;
    const paths = ingestPaths(userSub);
    const current = await readStatusFile(paths.status);
    if (!current || current.operationId !== operationId || current.state !== 'pending') {
      logger.warn({ userSub, operationId }, 'stale resume ingest completion ignored');
      return;
    }
    const state: ResumeIngestState = {
      ...current,
      state: completion.ok ? 'succeeded' : 'failed',
      finishedAt: Date.now(),
      error: completion.ok ? undefined : (completion.timedOut ? 'resume ingest timed out' : 'resume ingest failed'),
    };
    if (signal?.aborted) return;
    await writeFileAtomicAsync(paths.status, JSON.stringify(state));
    await fs.rm(paths.marker, { force: true });
  } finally {
    releaseRun(lifecycle);
  }
}

/** Convert a rejected lease to the same result shape as an OS-level start rejection. */
function rejectedLease(status: 'inflight' | 'busy'): CliStartResult {
  return { started: false, err: `career engine ${status}`, limitReason: status };
}

/** Store the resume and transfer the already-held lease to the background engine child. */
async function startResumeIngest(
  pool: AppContext['pool'], userSub: string, file: UploadedResume, extension: string, lease: RunLease,
): Promise<CliStartResult> {
  const lifecycle = tryAcquireStorageRun(userSub, 'resume-lifecycle');
  if (lifecycle.status !== 'ok') {
    releaseRun(lease);
    return rejectedLease(lifecycle.status);
  }
  const userDir = userPaths(userSub).userDir;
  const uploadDir = path.join(userDir, 'uploads');
  const destination = path.join(uploadDir, `resume${extension}`);
  const { marker: indexing, status } = ingestPaths(userSub);
  const operationId = randomUUID();
  const pending: ResumeIngestState = { state: 'pending', operationId, startedAt: Date.now() };
  let snapshots = [] as Awaited<ReturnType<typeof snapshotFilesAsync>>;
  let handedOff = false;
  try {
    await fs.mkdir(uploadDir, { recursive: true });
    snapshots = await snapshotFilesAsync([destination, indexing, status]);
    await writeFileAtomicAsync(status, JSON.stringify(pending));
    await writeFileAtomicAsync(destination, file.buffer);
    await writeFileAtomicAsync(indexing, JSON.stringify(pending));
    const result = await runCareerCliAsync(pool, userSub, ['ingest'], {
      CH_RESUME: destination,
      CH_RESUME_OPERATION_ID: operationId,
    }, {
      preclaimed: lease, adoptPreclaim: true,
      onComplete: (completion, signal) => finalizeResumeIngest(
        userSub, operationId, completion, signal,
      ),
    });
    if (result.started) handedOff = true;
    else await restoreFilesAsync(snapshots);
    return result;
  } catch (error) {
    if (snapshots.length) await restoreFilesAsync(snapshots);
    throw error;
  } finally {
    releaseRun(lifecycle);
    if (!handedOff) releaseRun(lease);
  }
}

/** Release a request reservation on parser/validation failure. */
function releaseResumeLease(req: ResumeUploadRequest): void {
  if (req[RESUME_UPLOAD_TIMER]) clearTimeout(req[RESUME_UPLOAD_TIMER]);
  delete req[RESUME_UPLOAD_TIMER];
  const lease = req[RESUME_LEASE];
  if (!lease) return;
  delete req[RESUME_LEASE];
  releaseRun(lease);
}

/** Clamp the multipart body deadline independently from the much longer engine deadline. */
function resumeUploadTimeout(): number {
  const configured = Number(process.env.CAREER_HUNTER_UPLOAD_TIMEOUT_MS) || 60_000;
  return Math.min(10 * 60_000, Math.max(1_000, configured));
}

/** End one slow request and release its upload-only lane without consuming engine capacity. */
function expireResumeUpload(req: ResumeUploadRequest, res: Response): void {
  req[RESUME_UPLOAD_TIMED_OUT] = true;
  releaseResumeLease(req);
  if (!res.headersSent) {
    res.status(408).set('Connection', 'close').json({ error: 'resume upload timed out' });
  }
  setImmediate(() => req.destroy());
}

/** Reserve per-user and global upload lanes before Multer buffers the body, but not an engine slot. */
function admitResumeUpload(req: ResumeUploadRequest, res: Response, next: NextFunction): void {
  const userSub = callerSub(req);
  if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
  const lease = tryAcquireUploadRun(userSub);
  if (rejectUploadClaim(res, lease, 'resume upload')) return;
  req[RESUME_LEASE] = lease;
  req[RESUME_UPLOAD_TIMER] = setTimeout(
    () => expireResumeUpload(req, res), resumeUploadTimeout(),
  );
  req[RESUME_UPLOAD_TIMER]?.unref?.();
  req.once('aborted', () => releaseResumeLease(req));
  next();
}

/** Parse one bounded resume and map body-limit errors without leaking its reservation. */
function parseResumeUpload(req: ResumeUploadRequest, res: Response, next: NextFunction): void {
  parseResumeFile(req, res, (error: unknown) => {
    if (req[RESUME_UPLOAD_TIMER]) clearTimeout(req[RESUME_UPLOAD_TIMER]);
    delete req[RESUME_UPLOAD_TIMER];
    if (req[RESUME_UPLOAD_TIMED_OUT]) return;
    if (!error) { next(); return; }
    releaseResumeLease(req);
    const code = String((error as { code?: string }).code || '');
    if (code.startsWith('LIMIT_')) { res.status(413).json({ error: 'resume exceeds the upload limit' }); return; }
    next(error);
  });
}

/** Validate a parsed upload and execute its durable lease-to-child hand-off. */
async function handleResumeUpload(ctx: AppContext, req: ResumeUploadRequest, res: Response): Promise<void> {
  const userSub = callerSub(req);
  if (!userSub) { releaseResumeLease(req); res.status(401).json({ error: 'unauthorized' }); return; }
  const file = (req as unknown as { file?: UploadedResume }).file;
  if (!file) { releaseResumeLease(req); res.status(400).json({ error: 'no file' }); return; }
  const extension = path.extname(file.originalname || '').toLowerCase() || '.pdf';
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    releaseResumeLease(req);
    res.status(400).json({ error: 'Upload a PDF, DOCX, TXT, or MD resume.' }); return;
  }
  const lease = tryAcquireRun(userSub, 'user-store');
  releaseResumeLease(req);
  if (lease.status !== 'ok') { rejectEngineStart(res, rejectedLease(lease.status), 'resume ingest'); return; }
  try {
    const started = await startResumeIngest(ctx.pool, userSub, file, extension, lease);
    if (rejectEngineStart(res, started, 'resume ingest')) return;
    logger.info({ userSub, extension }, 'career resume ingest started');
    res.status(202).json({ started: true });
  } catch (error) {
    logger.error({ err: error, userSub }, 'resume upload failed');
    res.status(500).json({ error: 'upload failed' });
  }
}

/**
 * @description Register pre-admitted, bounded resume upload on the authenticated Career router.
 * @param router parent package router
 * @param ctx kernel services used for credential brokerage
 * @returns nothing
 */
export function registerCareerResumeUpload(router: Router, ctx: AppContext): void {
  router.post('/resume/upload', admitResumeUpload, parseResumeUpload, (req, res) => handleResumeUpload(ctx, req, res));
}
