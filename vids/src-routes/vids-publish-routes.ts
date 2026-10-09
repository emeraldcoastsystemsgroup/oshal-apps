/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Add exact-owner private export upload/preview and separately confirmed publish, revoke and private removal controls. Multipart completion preserves verified identity.
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

export function createVidsPublishRoutes(ctx: AppContext): Router {
  const router = Router({ mergeParams: true });
  router.use((req: OwnedRequest, res, next) => {
    const sub = getCaller(req).sub ?? getTrustedServiceUserSub(req);
    if (!sub) { res.status(401).json({ error: 'user_identity_required' }); return; }
    if (!uuid.test(job(req))) { res.status(404).json({ error: 'job_not_found' }); return; }
    req.exportOwner = sub; res.set('Cache-Control', 'private, no-store'); next();
  });
  router.get('/', async (req, res) => {
    try { await requireFinishedJob(ctx, owner(req), job(req)); res.json({ artifact: artifactView(await ownedArtifact(ctx, owner(req), job(req))) }); }
    catch (error) { refusal(res, error); }
  });
  router.get('/video.mp4', async (req, res) => {
    try {
      const row = await ownedArtifact(ctx, owner(req), job(req));
      if (!row) { res.status(404).end(); return; }
      await serveVideo(req, res, row);
    } catch (error) { refusal(res, error); }
  });
  router.post('/', async (req, res, next) => {
    try { await requireFinishedJob(ctx, owner(req), job(req)); next(); } catch (error) { refusal(res, error); }
  }, preserveRequestIdentity((req, res, next) => uploadParser()(req, res, AsyncResource.bind((error?: unknown) => {
    if (!error) { next(); return; }
    if (error instanceof multer.MulterError) { res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: error.code, maxBytes: MAX_VIDEO_BYTES }); return; }
    refusal(res, error);
  }))), (req, res) => { void attachExport(ctx, req, res); });
  registerControls(router, ctx);
  return router;
}

function registerControls(router: Router, ctx: AppContext): void {
  const confirm = (req: Request, res: Response, next: NextFunction) => {
    if (req.body?.confirm !== true) { res.status(428).json({ error: 'confirmation_required' }); return; } next();
  };
  router.post('/publish', confirm, async (req, res) => {
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
  router.post('/unpublish', confirm, async (req, res) => {
    try { res.json({ artifact: artifactView(await unpublishArtifact(ctx, owner(req), job(req))) }); } catch (error) { refusal(res, error); }
  });
  router.delete('/', confirm, async (req, res) => {
    try {
      const row = await removeArtifact(ctx, owner(req), job(req));
      await unlink(artifactPath(row.artifact_id)).catch(() => undefined);
      res.json({ removed: true });
    } catch (error) { refusal(res, error); }
  });
}
