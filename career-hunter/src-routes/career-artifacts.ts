/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Add kind-tagged artifact upload, listing, and asynchronous engine absorption.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Batch each request under one acknowledged worker and roll files back when its child cannot start.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Reserve the user store before multipart parsing, enforce a request-wide memory ceiling, and use non-blocking transactional file operations.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Isolate buffered-input validation so the transactional upload handler remains within the route function-size contract.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | Mark rollback complete only after deletion succeeds so a transient cleanup failure receives the catch-path retry.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Enforce lease-protected per-user storage quotas and stat only a bounded newest-name window when listing artifacts.
 * 7 | maintainer@emeraldcoastsystemsgroup.com | Read only a bounded complete-line tail of the enrichment audit instead of materializing the full log.
 * 8 | maintainer@emeraldcoastsystemsgroup.com | Keep slow multipart bodies out of engine capacity with a separate per-user upload lane and finite request deadline.
 * 9 | maintainer@emeraldcoastsystemsgroup.com | Enforce the independent cross-process upload-body ceiling before buffering artifact batches.
 */
/**
 * Career artifacts — upload MORE than a resume into your career profile.
 *
 * The conversational career agent lets a user hand the system work samples, exported emails, a
 * LinkedIn "Download your data" archive, or a status report, and have it learn what they actually
 * do. Each uploaded artifact is stored in the user's own store (uploads/artifacts/) and absorbed
 * by the engine `absorb-batch` verb: extract TRUE career facts → profile.augment() (add-only, backed up,
 * audited to enrichment_log.jsonl). Nothing is ever overwritten; the resume-`ingest` path (whole-
 * profile rebuild) is untouched. The career agent reads the enriched profile on its next turn.
 *
 * Follows ADR-036: this is data-access + a fire-and-forget dispatch to the engine (no reasoning in
 * the controller); the LLM extraction runs in the engine child, same as ingest/tailor/strengthen.
 *
 * @module career-artifacts
 */
import { type Router, type Request, type Response, type NextFunction } from 'express';
import * as path from 'path';
import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import multer from 'multer';
import { createChildLogger } from '@/shared/logger';
import type { AppContext } from '@/app/composition/app-context';
import { callerSub, userPaths } from './career-user-store';
import { runCareerCliAsync } from './career-engine-dispatch';
import { rejectEngineClaim, rejectEngineStart, rejectUploadClaim } from './career-engine-response';
import {
  releaseRun, tryAcquireRun, tryAcquireUploadRun, type RunLease,
} from './career-engine-runner';
import { writeFileAtomicAsync } from './career-file-transaction';

const logger = createChildLogger({ module: 'career-artifacts' });

const ARTIFACT_KINDS = new Set(['resume-extra', 'linkedin-export', 'email', 'status-report', 'work-sample', 'other']);
const ALLOWED_EXT = new Set(['.pdf', '.docx', '.txt', '.md', '.csv', '.tsv', '.html', '.htm', '.eml', '.json', '.zip']);
const MAX_ARTIFACT_FILE_BYTES = 25 * 1024 * 1024;
const MAX_ARTIFACT_REQUEST_BYTES = 40 * 1024 * 1024;
const MAX_STORED_ARTIFACT_BYTES = 250 * 1024 * 1024;
const MAX_STORED_ARTIFACT_FILES = 200;
const MAX_LISTED_ARTIFACTS = 50;
const ENRICHMENT_LOG_READ_BYTES = 256 * 1024;
const ARTIFACT_REQUEST_BYTES = Symbol('career-artifact-request-bytes');
const ARTIFACT_LEASE = Symbol('career-artifact-lease');
const ARTIFACT_UPLOAD_TIMER = Symbol('career-artifact-upload-timer');
const ARTIFACT_UPLOAD_TIMED_OUT = Symbol('career-artifact-upload-timed-out');

interface ArtifactUploadFile {
  buffer: Buffer;
  originalname?: string;
}

interface PendingArtifact {
  name: string;
  kind: string;
  path: string;
}

type ArtifactRequest = Request & {
  [ARTIFACT_REQUEST_BYTES]?: number;
  [ARTIFACT_LEASE]?: RunLease;
  [ARTIFACT_UPLOAD_TIMER]?: NodeJS.Timeout;
  [ARTIFACT_UPLOAD_TIMED_OUT]?: boolean;
};

/** Create an error Multer will propagate when all buffered files cross the aggregate ceiling. */
function aggregateLimitError(): Error & { code: string } {
  return Object.assign(new Error('artifact upload exceeds the combined byte limit'), {
    code: 'LIMIT_TOTAL_FILE_SIZE',
  });
}

/** Buffer one file while atomically accounting bytes across every file in this request. */
function bufferArtifactFile(
  req: ArtifactRequest, file: Express.Multer.File,
  callback: (error?: unknown, info?: Partial<Express.Multer.File>) => void,
): void {
  const chunks: Buffer[] = [];
  let fileBytes = 0;
  let settled = false;
  const finish = (error?: unknown) => {
    if (settled) return;
    settled = true;
    if (error) callback(error);
    else callback(undefined, { buffer: Buffer.concat(chunks, fileBytes), size: fileBytes });
  };
  file.stream.on('data', (raw: Buffer | string) => {
    if (settled) return;
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    const requestBytes = (req[ARTIFACT_REQUEST_BYTES] || 0) + chunk.length;
    req[ARTIFACT_REQUEST_BYTES] = requestBytes;
    if (requestBytes > MAX_ARTIFACT_REQUEST_BYTES) { file.stream.resume(); finish(aggregateLimitError()); return; }
    chunks.push(chunk);
    fileBytes += chunk.length;
  });
  file.stream.once('error', finish);
  file.stream.once('end', () => finish());
}

/** Drop a buffered file if Multer rolls the request back. */
function removeBufferedArtifact(
  _req: Request, file: Express.Multer.File, callback: (error: Error | null) => void,
): void {
  delete (file as Partial<Express.Multer.File>).buffer;
  callback(null);
}

const artifactUpload = multer({
  storage: { _handleFile: bufferArtifactFile, _removeFile: removeBufferedArtifact },
  limits: { fileSize: MAX_ARTIFACT_FILE_BYTES, files: 20, fields: 8, parts: 29 },
});
const parseArtifactFiles = artifactUpload.array('files', 20);

/** Sanitize an uploaded filename to a safe basename (no path segments, bounded length). */
function safeName(name: string): string {
  return (path.basename(String(name || 'artifact')).replace(/[^\w.\- ]/g, '_')).slice(0, 120) || 'artifact';
}

/** The per-user artifacts dir (under the career store's uploads/). */
function artifactsDir(userSub: string): string {
  return path.join(userPaths(userSub).userDir, 'uploads', 'artifacts');
}

/** Count only supported files when reserving durable quota for an incoming request. */
function acceptedArtifactFootprint(files: ArtifactUploadFile[]): { count: number; bytes: number } {
  let count = 0;
  let bytes = 0;
  for (const file of files) {
    const extension = path.extname(safeName(file.originalname || 'artifact')).toLowerCase();
    if (!ALLOWED_EXT.has(extension)) continue;
    count += 1;
    bytes += file.buffer.length;
  }
  return { count, bytes };
}

/** Stream existing entries under the held user lease and stop as soon as either quota is full. */
async function artifactQuotaAvailable(
  dir: string, incoming: { count: number; bytes: number },
): Promise<boolean> {
  let count = incoming.count;
  let bytes = incoming.bytes;
  if (count > MAX_STORED_ARTIFACT_FILES || bytes > MAX_STORED_ARTIFACT_BYTES) return false;
  const directory = await fs.opendir(dir);
  for await (const entry of directory) {
    count += 1;
    if (!entry.isFile() || count > MAX_STORED_ARTIFACT_FILES) return false;
    bytes += (await fs.lstat(path.join(dir, entry.name))).size;
    if (bytes > MAX_STORED_ARTIFACT_BYTES) return false;
  }
  return true;
}

/** Retain only the lexically newest timestamp-prefixed names before opening any file metadata. */
async function recentArtifactNames(dir: string): Promise<string[]> {
  const names: string[] = [];
  const directory = await fs.opendir(dir);
  for await (const entry of directory) {
    if (!entry.isFile()) continue;
    names.push(entry.name);
    names.sort((left, right) => right.localeCompare(left));
    if (names.length > MAX_LISTED_ARTIFACTS) names.pop();
  }
  return names;
}

/** Stat only the bounded newest-name candidate set and return display-safe metadata. */
async function listRecentArtifacts(dir: string): Promise<Array<{ name: string; size: number; at: string }>> {
  const names = await recentArtifactNames(dir);
  const uploaded = await Promise.all(names.map(async (name) => {
    const stat = await fs.lstat(path.join(dir, name));
    return {
      name: name.replace(/^\d+-(?:[0-9a-f-]{36}-)?\d+-/i, ''),
      size: stat.size,
      at: stat.mtime.toISOString(),
    };
  }));
  return uploaded.sort((left, right) => right.at.localeCompare(left.at));
}

/** Read a bounded UTF-8 tail and discard the first partial line when seeking into a large file. */
async function readLogTail(filePath: string): Promise<string> {
  const handle = await fs.open(filePath, 'r');
  try {
    const stat = await handle.stat();
    const length = Math.min(stat.size, ENRICHMENT_LOG_READ_BYTES);
    const offset = stat.size - length;
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, offset);
    const text = buffer.subarray(0, bytesRead).toString('utf8');
    return offset > 0 ? text.slice(Math.max(0, text.indexOf('\n') + 1)) : text;
  } finally {
    await handle.close();
  }
}

/** Validate and atomically store one request's files under a collision-resistant prefix. */
async function storeArtifactBatch(
  files: ArtifactUploadFile[], dir: string, kind: string, pending: PendingArtifact[],
  rejected: Array<{ name: string; reason: string }>,
): Promise<void> {
  const requestId = randomUUID();
  let ordinal = 0;
  for (const file of files) {
    const name = safeName(file.originalname || 'artifact');
    if (!ALLOWED_EXT.has(path.extname(name).toLowerCase())) {
      rejected.push({ name, reason: 'unsupported type' });
      continue;
    }
    const destination = path.join(dir, `${Date.now()}-${requestId}-${ordinal++}-${name}`);
    await writeFileAtomicAsync(destination, file.buffer);
    pending.push({ name, kind, path: destination });
  }
}

/** Remove only the UUID-namespaced files created by this request. */
async function rollbackArtifactBatch(pending: PendingArtifact[]): Promise<void> {
  let firstError: unknown;
  for (const item of pending) {
    try { await fs.rm(item.path, { force: true }); }
    catch (error) { firstError ||= error; }
  }
  if (firstError) throw firstError;
}

/** Release and forget a parser-level lease; opaque lease tokens make repeats harmless. */
function releaseArtifactLease(req: ArtifactRequest): void {
  if (req[ARTIFACT_UPLOAD_TIMER]) clearTimeout(req[ARTIFACT_UPLOAD_TIMER]);
  delete req[ARTIFACT_UPLOAD_TIMER];
  const lease = req[ARTIFACT_LEASE];
  if (!lease) return;
  delete req[ARTIFACT_LEASE];
  releaseRun(lease);
}

/** Clamp multipart time separately from the long-running artifact extraction deadline. */
function artifactUploadTimeout(): number {
  const configured = Number(process.env.CAREER_HUNTER_UPLOAD_TIMEOUT_MS) || 60_000;
  return Math.min(10 * 60_000, Math.max(1_000, configured));
}

/** Terminate a slow artifact body and return its upload-only reservation. */
function expireArtifactUpload(req: ArtifactRequest, res: Response): void {
  req[ARTIFACT_UPLOAD_TIMED_OUT] = true;
  releaseArtifactLease(req);
  if (!res.headersSent) {
    res.status(408).set('Connection', 'close').json({ error: 'artifact upload timed out' });
  }
  setImmediate(() => req.destroy());
}

/** Reject per-user duplicates or global saturation before buffering, without taking engine capacity. */
function admitArtifactUpload(req: ArtifactRequest, res: Response, next: NextFunction): void {
  const userSub = callerSub(req);
  if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
  const lease = tryAcquireUploadRun(userSub);
  if (rejectUploadClaim(res, lease, 'artifact upload')) return;
  req[ARTIFACT_LEASE] = lease;
  req[ARTIFACT_UPLOAD_TIMER] = setTimeout(
    () => expireArtifactUpload(req, res), artifactUploadTimeout(),
  );
  req[ARTIFACT_UPLOAD_TIMER]?.unref?.();
  req.once('aborted', () => releaseArtifactLease(req));
  next();
}

/** Convert multipart ceilings to 413 and always return parser failures' reservation. */
function parseArtifactUpload(req: ArtifactRequest, res: Response, next: NextFunction): void {
  parseArtifactFiles(req, res, (error: unknown) => {
    if (req[ARTIFACT_UPLOAD_TIMER]) clearTimeout(req[ARTIFACT_UPLOAD_TIMER]);
    delete req[ARTIFACT_UPLOAD_TIMER];
    if (req[ARTIFACT_UPLOAD_TIMED_OUT]) return;
    if (!error) { next(); return; }
    releaseArtifactLease(req);
    const code = String((error as { code?: string }).code || '');
    if (code.startsWith('LIMIT_')) {
      res.status(413).json({ error: 'artifact upload exceeds the file or request limit' }); return;
    }
    next(error);
  });
}

/** Sum already-buffered fixture inputs so direct handler tests enforce the production ceiling. */
function bufferedArtifactBytes(files: ArtifactUploadFile[]): number {
  return files.reduce((total, file) => total + file.buffer.length, 0);
}

/** Validate direct-handler and parsed file arrays before any filesystem mutation. */
function validArtifactFiles(req: Request, res: Response): ArtifactUploadFile[] | null {
  const files = (req as unknown as { files?: ArtifactUploadFile[] }).files || [];
  if (!files.length) {
    releaseArtifactLease(req as ArtifactRequest);
    res.status(400).json({ error: 'no files' });
    return null;
  }
  const invalidFile = files.some((file) => !Buffer.isBuffer(file.buffer)
    || file.buffer.length > MAX_ARTIFACT_FILE_BYTES);
  if (!invalidFile && bufferedArtifactBytes(files) <= MAX_ARTIFACT_REQUEST_BYTES) return files;
  releaseArtifactLease(req as ArtifactRequest);
  res.status(413).json({ error: 'artifact upload exceeds the combined byte limit' });
  return null;
}

/** Handle the leased write-to-child transaction for one authenticated artifact upload. */
async function handleArtifactUpload(ctx: AppContext, req: Request, res: Response): Promise<void> {
  const userSub = callerSub(req);
  if (!userSub) {
    releaseArtifactLease(req as ArtifactRequest);
    res.status(401).json({ error: 'unauthorized' }); return;
  }
  const files = validArtifactFiles(req, res);
  if (!files) return;
  const kindRaw = String((req.body?.kind || 'other')).trim();
  const kind = ARTIFACT_KINDS.has(kindRaw) ? kindRaw : 'other';
  const artifactReq = req as ArtifactRequest;
  const lease = tryAcquireRun(userSub, 'user-store');
  releaseArtifactLease(artifactReq);
  if (rejectEngineClaim(res, lease, 'artifact absorb')) return;
  const pending: PendingArtifact[] = [];
  const rejected: Array<{ name: string; reason: string }> = [];
  let handedOff = false;
  let rolledBack = false;
  try {
    const dir = artifactsDir(userSub);
    await fs.mkdir(dir, { recursive: true });
    if (!await artifactQuotaAvailable(dir, acceptedArtifactFootprint(files))) {
      res.status(413).json({ error: 'artifact storage quota exceeded' }); return;
    }
    await storeArtifactBatch(files, dir, kind, pending, rejected);
    if (!pending.length) { res.status(400).json({ started: false, accepted: [], rejected }); return; }
    const items = pending.map((item) => ({ path: item.path, kind: item.kind }));
    const started = await runCareerCliAsync(ctx.pool, userSub, ['absorb-batch'], {
      CH_ARTIFACTS: JSON.stringify(items),
    }, { preclaimed: lease, adoptPreclaim: true });
    if (!started.started) {
      await rollbackArtifactBatch(pending); rolledBack = true;
      rejectEngineStart(res, started, 'artifact absorb'); return;
    }
    handedOff = true;
    delete artifactReq[ARTIFACT_LEASE];
    const accepted = pending.map(({ name, kind: acceptedKind }) => ({ name, kind: acceptedKind }));
    logger.info({ userSub, kind, accepted: accepted.length, rejected: rejected.length }, 'career artifacts uploaded');
    res.status(202).json({ started: true, accepted, rejected });
  } catch (error) {
    let rollbackError: unknown;
    if (!handedOff && !rolledBack) {
      try { await rollbackArtifactBatch(pending); } catch (failure) { rollbackError = failure; }
    }
    logger.error({ err: error, rollbackError, userSub }, 'artifact upload failed');
    if (!res.headersSent) res.status(500).json({ error: 'upload failed' });
  } finally {
    if (!handedOff) {
      if (artifactReq[ARTIFACT_LEASE] === lease) delete artifactReq[ARTIFACT_LEASE];
      releaseRun(lease);
    }
  }
}

/**
 * @description Register the career-artifact routes on the (already auth-gated) career-hunter router.
 * @param router the career-hunter router
 * @param ctx app context used to broker only this caller's Career credentials
 * @returns nothing
 */
export function registerCareerArtifacts(router: Router, ctx: AppContext): void {
  // POST /artifacts/upload — up to 20 files, one `kind` for the batch. Stores each and fires the
  // engine `absorb-batch` verb. Its acknowledged child owns the request's preclaimed lease.
  router.post('/artifacts/upload', admitArtifactUpload, parseArtifactUpload, (req, res) => handleArtifactUpload(ctx, req, res));

  // GET /artifacts — uploaded artifacts + the most recent profile additions (from enrichment_log),
  // so the surface/agent can show "here's what I learned" after an absorb completes.
  router.get('/artifacts', async (req: Request, res: Response) => {
    const userSub = callerSub(req);
    if (!userSub) { res.status(401).json({ error: 'unauthorized' }); return; }
    const dir = artifactsDir(userSub);
    let uploaded: Array<{ name: string; size: number; at: string }> = [];
    try {
      uploaded = await listRecentArtifacts(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') logger.error({ err: error, userSub }, 'career artifact listing failed');
    }

    // Recent enrichment-log changelogs (augment writes {at, facts, changelog} per merge).
    const learned: Array<{ at: string; changelog: string[] }> = [];
    try {
      const logPath = path.join(userPaths(userSub).userDir, 'enrichment_log.jsonl');
      const lines = (await readLogTail(logPath)).trim().split('\n').slice(-15);
      for (const line of lines) {
        try {
          const e = JSON.parse(line) as { at?: string; changelog?: string[] };
          if (Array.isArray(e.changelog) && e.changelog.length) learned.push({ at: String(e.at || ''), changelog: e.changelog });
        } catch (error) { logger.warn({ err: error, userSub }, 'career enrichment log line ignored'); }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') logger.error({ err: error, userSub }, 'career enrichment log read failed');
    }
    res.json({ uploaded, learned: learned.reverse() });
  });
}
