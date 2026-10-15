/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Add exact-owner private export upload/preview and separately confirmed publish, revoke and private removal controls. Multipart completion preserves verified identity.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Register the export routes directly on the Vids router at their full /jobs/:jobId/artifact paths (registerVidsPublishRoutes) instead of mounting a sub-router with router.use('/jobs/:jobId/artifact'): the native kernel's bridge router matches a use() path as a literal prefix, so every export request answered 404 "No matching application route". In the native sandbox (OSHAL_EGRESS=kernel) attaching refuses 503 export_storage_unavailable with a sentence before any upload is parsed or written: the native host keeps no lasting file store for Vids exports (outside the sandbox temp dir its root is a discarded in-memory filesystem, and Vids has no kernel-backed file store), so a 201 there would name a file that is gone when the request ends. GET reports `attach` (available, maxBytes, detail) so the page can say so instead of offering a file input.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import { randomUUID } from 'node:crypto';
import { link, unlink } from 'node:fs/promises';
import { AsyncResource } from 'node:async_hooks';
import type { AppContext } from '@/app/composition/app-context';
import { getCaller, getTrustedServiceUserSub } from '@/shared/middleware/authz';
import { preserveRequestIdentity } from '@/shared/middleware/multipart-identity';
import { createChildLogger } from '@/shared/logger';
import { ArtifactRefusal, artifactView, ownedArtifact, publishArtifact, removeArtifact, requireFinishedJob, saveArtifact, unpublishArtifact } from './vids-artifacts';
import { artifactPath, ensureArtifactRoot, inspectVideo, MAX_VIDEO_BYTES, serveVideo } from './vids-artifact-files';

const logger = createChildLogger({ module: 'vids-publication' });
type OwnedRequest = Request & { exportOwner?: string };
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const owner = (req: OwnedRequest): string => req.exportOwner as string;
const job = (req: Request): string => String(req.params.jobId);
function refusal(res: Response, error: unknown): void {
  if (error instanceof ArtifactRefusal) { res.status(error.status).json({ error: error.code }); return; }
  logger.warn({ type: error instanceof Error ? error.name : 'UnknownError' }, 'Vids artifact operation failed');
  if (!res.headersSent) res.status(503).json({ error: 'artifact_storage_unavailable' });
  else res.destroy();
}

function uploadParser() {
  return multer({ storage: multer.diskStorage({
    destination: (_req, _file, done) => { void ensureArtifactRoot().then((root) => done(null, root), (error) => done(error, '')); },
    filename: (_req, _file, done) => done(null, `${randomUUID()}.upload`),
  }), limits: { fileSize: MAX_VIDEO_BYTES, files: 1, fields: 0, parts: 1 },
  fileFilter: (_req, file, done) => file.mimetype === 'video/mp4' ? done(null, true) : done(new ArtifactRefusal(415, 'mp4_export_required')),
  }).single('file');
}

async function attachExport(ctx: AppContext, req: OwnedRequest, res: Response): Promise<void> {
  const uploaded = req.file?.path;
  if (!uploaded) { res.status(400).json({ error: 'one_file_required' }); return; }
  const id = randomUUID();
  let durableFile = false;
  try {
    let checked;
    try { checked = await inspectVideo(uploaded); } catch { throw new ArtifactRefusal(415, 'complete_mp4_video_required'); }
    await link(uploaded, artifactPath(id));
    // The immutable file exists before the row commits. An uncertain commit leaves private bytes
    // in place rather than deleting an export that may have committed. No row means no serving.
    durableFile = true;
    const row = await saveArtifact(ctx, owner(req), job(req), id, checked.sha256, checked.byteLength);
    res.status(201).json({ artifact: artifactView(row) });
  } catch (error) {
    if (durableFile && error instanceof ArtifactRefusal) await unlink(artifactPath(id)).catch(() => undefined);
    refusal(res, error);
  } finally { await unlink(uploaded).catch(() => undefined); }
}

/** @description Where the export routes live under the Vids router. */
const BASE = '/jobs/:jobId/artifact';

/** @description Why attaching an export is refused in the native sandbox, in words. */
export const NATIVE_EXPORT_DETAIL = 'Video exports cannot be kept on this installation yet: it has no lasting file store for Vids, so an attached MP4 would be lost when the request ends. Nothing was uploaded or saved.';

/**
 * @description Whether this installation keeps an attached export file. The native kernel's bridge sets
 * OSHAL_EGRESS=kernel; there the package's files outside the sandbox temp dir are discarded with the process.
 * @returns True when an attached MP4 is kept where the preview and public routes read it.
 */
export function exportsKept(): boolean {
  return process.env.OSHAL_EGRESS !== 'kernel';
}

/** @description The exact-owner guard every export route runs first. */
function ownerGuard(req: OwnedRequest, res: Response, next: NextFunction): void {
  const sub = getCaller(req).sub ?? getTrustedServiceUserSub(req);
  if (!sub) { res.status(401).json({ error: 'user_identity_required' }); return; }
  if (!uuid.test(job(req))) { res.status(404).json({ error: 'job_not_found' }); return; }
  req.exportOwner = sub; res.set('Cache-Control', 'private, no-store'); next();
}

/** @description What the page needs to offer (or not offer) an attach control. */
function attachState(): Record<string, unknown> {
  return exportsKept() ? { available: true, maxBytes: MAX_VIDEO_BYTES } : { available: false, detail: NATIVE_EXPORT_DETAIL };
}

/**
 * @description Register the owner's export routes on the Vids router at their full paths. A sub-router mounted at
 * a parameterised use() path is never reached on the native kernel, whose bridge router matches use() paths literally.
 * @param router - The Vids router (after its identity middleware).
 * @param ctx - The package context.
 * @returns Nothing; the routes are added to `router`.
 */
export function registerVidsPublishRoutes(router: Router, ctx: AppContext): void {
  router.get(BASE, ownerGuard, async (req: OwnedRequest, res: Response) => {
    try { await requireFinishedJob(ctx, owner(req), job(req)); res.json({ artifact: artifactView(await ownedArtifact(ctx, owner(req), job(req))), attach: attachState() }); }
    catch (error) { refusal(res, error); }
  });
  router.get(`${BASE}/video.mp4`, ownerGuard, async (req: OwnedRequest, res: Response) => {
    try {
      const row = await ownedArtifact(ctx, owner(req), job(req));
      if (!row) { res.status(404).end(); return; }
      await serveVideo(req, res, row);
    } catch (error) { refusal(res, error); }
  });
  router.post(BASE, ownerGuard, async (req: OwnedRequest, res: Response, next: NextFunction) => {
    try {
      await requireFinishedJob(ctx, owner(req), job(req));
      if (!exportsKept()) { res.status(503).json({ error: 'export_storage_unavailable', detail: NATIVE_EXPORT_DETAIL }); return; }
      next();
    } catch (error) { refusal(res, error); }
  }, preserveRequestIdentity((req, res, next) => uploadParser()(req, res, AsyncResource.bind((error?: unknown) => {
    if (!error) { next(); return; }
    if (error instanceof multer.MulterError) { res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: error.code, maxBytes: MAX_VIDEO_BYTES }); return; }
    refusal(res, error);
  }))), (req: OwnedRequest, res: Response) => { void attachExport(ctx, req, res); });
  registerControls(router, ctx);
}

function registerControls(router: Router, ctx: AppContext): void {
  const confirm = (req: Request, res: Response, next: NextFunction) => {
    if (req.body?.confirm !== true) { res.status(428).json({ error: 'confirmation_required' }); return; } next();
  };
  router.post(`${BASE}/publish`, ownerGuard, confirm, async (req, res) => {
    try {
      if (typeof req.body.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(req.body.sha256)) throw new ArtifactRefusal(400, 'reviewed_digest_required');
      await requireFinishedJob(ctx, owner(req), job(req));
      const current = await ownedArtifact(ctx, owner(req), job(req));
      if (!current) throw new ArtifactRefusal(409, 'finished_export_required');
      const file = await inspectVideo(artifactPath(current.artifact_id));
      if (file.sha256 !== current.sha256) throw new ArtifactRefusal(409, 'export_file_changed');
      res.json({ artifact: artifactView(await publishArtifact(ctx, owner(req), job(req), req.body.sha256)) });
    } catch (error) { refusal(res, error); }
  });
  router.post(`${BASE}/unpublish`, ownerGuard, confirm, async (req, res) => {
    try { res.json({ artifact: artifactView(await unpublishArtifact(ctx, owner(req), job(req))) }); } catch (error) { refusal(res, error); }
  });
  router.delete(BASE, ownerGuard, confirm, async (req, res) => {
    try {
      const row = await removeArtifact(ctx, owner(req), job(req));
      await unlink(artifactPath(row.artifact_id)).catch(() => undefined);
      res.json({ removed: true });
    } catch (error) { refusal(res, error); }
  });
}
