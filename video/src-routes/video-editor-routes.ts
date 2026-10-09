/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The manual video editor's routes under /api/video/editor (CREATE-EDIT-05b): capabilities and effective permissions, bounded owned media upload and authenticated range playback, private projects with immutable optimistic revisions, and unused-upload cleanup. Every route re-reads current named permissions before decoding a body and again before commit; identity comes only from the framework actor; tenant and owner selectors are refused. A test may name its own ffprobe stand-in through options.prober; production always probes with the runtime's ffprobe.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | CREATE-EDIT-05c: the shared guards move to video-editor-http.ts (unchanged behaviour) so the new export routes use the same admission; the router mounts them with this process's single export runner.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Deleting a project stops any job this process holds for its exports and removes their files, which the cascading rows can no longer reach.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | CREATE-EDIT-05d: serve the editor screen at GET /editor and its modules and stylesheet from a fixed allowlist at GET /editor/assets/:asset, behind editor.view; no path from the request ever reaches the filesystem.
 * 5 | maintainer@emeraldcoastsystemsgroup.com | CREATE-EDIT-05d: DELETE /editor/media/:id removes one owned upload no retained revision uses (editor.delete), so a person can take back a mistaken import and an acceptance run can remove exactly what it created.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Preserve legacy routes while enabling bounded original-owner native media transport.
 */
import { Router, type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import multer from 'multer';
import { AsyncResource } from 'node:async_hooks';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { EditorError, EDITOR_LIMITS, type EditorContext } from './video-editor-types';
import { VideoEditorStore } from './video-editor-store';
import { editorPermissions, registerVideoAuthorization } from './video-authorization';
import { baseRevision, editorId, exactFields, loadTimelineValidator, mediaKind, projectInput, revisionParam } from './video-editor-validation';
import { discardUpload, exportPath, incomingDirectory, mediaRoot, openMedia, probeWithFfprobe, publishMedia, removeMediaFile, type MediaProber } from './video-editor-media';
import { unlink } from 'node:fs/promises';
import { createChildLogger } from '@/shared/logger';
import { admit, bodyParser, confirm, handler, requestLog, sendError, sendFile, type RouteEnvironment } from './video-editor-http';
import { ExportRunner, type ExportRunnerOptions } from './video-edit-export-jobs';
import { registerExportRoutes } from './video-editor-export-routes';
import { VideoExportStore } from './video-editor-export-store';
import { nativeMediaRoutes, nativeMedia, nativeDeletedExports } from './video-editor-native';

const logger = createChildLogger({ module: 'video-editor-routes' });

/** @description Test seams: a private media root, a NAMED ffprobe stand-in and named export encoder/prober stand-ins. Production passes none. */
export interface VideoEditorOptions { dataRoot?: string; prober?: MediaProber; exports?: Omit<ExportRunnerOptions, 'store' | 'workRoot'> }

/** The editor screen's only files: a fixed name-to-type allowlist, never a path taken from the request. */
const EDITOR_ASSETS: Readonly<Record<string, string>> = Object.freeze({
  'editor.css': 'text/css; charset=utf-8', 'editor.mjs': 'text/javascript; charset=utf-8', 'editor-api.mjs': 'text/javascript; charset=utf-8',
  'editor-player.mjs': 'text/javascript; charset=utf-8', 'editor-export.mjs': 'text/javascript; charset=utf-8',
  'timeline-view.mjs': 'text/javascript; charset=utf-8', 'timeline-model.mjs': 'text/javascript; charset=utf-8',
  'timeline-validation.mjs': 'text/javascript; charset=utf-8', 'timeline-history.mjs': 'text/javascript; charset=utf-8',
});

function sendBundled(res: Response, file: string, type: string): void {
  res.type(type);
  res.sendFile(file, error => { if (error) sendError(res, new EditorError(404, 'video_edit_asset_not_found')); });
}

function pageRoutes(router: Router, env: RouteEnvironment): void {
  const directory = join(env.ctx.appPackageDir ?? resolve(__dirname, '..'), 'tools', 'editor');
  router.get('/editor', admit(env, 'view'), handler(env, 'view', async (_req, res) => { sendBundled(res, join(directory, 'editor.html'), 'text/html; charset=utf-8'); }));
  router.get('/editor/assets/:asset', admit(env, 'view'), handler(env, 'view', async (req, res) => {
    const name = String(req.params.asset);
    if (!Object.prototype.hasOwnProperty.call(EDITOR_ASSETS, name)) throw new EditorError(404, 'video_edit_asset_not_found');
    sendBundled(res, join(directory, name), EDITOR_ASSETS[name]);
  }));
}

function mediaRoutes(router: Router, env: RouteEnvironment): void {
  if (nativeMediaRoutes(router, env)) return;
  const storage = multer.diskStorage({
    destination: (_req, _file, done) => { const directory = incomingDirectory(env.dataRoot); mkdirSync(directory, { recursive: true, mode: 0o700 }); done(null, directory); },
    filename: (_req, _file, done) => done(null, `${randomUUID()}.upload`),
  });
  const uploader = (kind: 'video' | 'audio') => multer({ storage, limits: { fileSize: kind === 'video' ? EDITOR_LIMITS.clipBytes : EDITOR_LIMITS.bedBytes,
    files: 1, fields: 0, parts: 1 } }).single('media');
  const uploads = { video: uploader('video'), audio: uploader('audio') };
  const receive: RequestHandler = (req, res, next) => {
    try { uploads[mediaKind(req.query.kind)](req, res, AsyncResource.bind(next)); } catch (error) { sendError(res, error); }
  };
  router.post('/editor/media', admit(env, 'upload'), receive, handler(env, 'upload', async (req, res, owner) => {
    try {
      if (!req.file) throw new EditorError(400, 'video_edit_media_required');
      const media = await publishMedia(env.dataRoot, env.store, owner, req.file.path, mediaKind(req.query.kind), env.prober, confirm(env, 'upload', owner));
      res.status(201).json({ media });
    } finally { await discardUpload(req.file?.path); }
  }));
  router.get('/editor/media/:id', admit(env, 'read'), handler(env, 'read', async (req, res, owner) => {
    const { file, media } = await openMedia(env.dataRoot, env.store, owner, editorId(req.params.id));
    await confirm(env, 'read', owner)();
    sendFile(req, res, file, { bytes: media.bytes, type: media.kind === 'video' ? 'video/mp4' : 'audio/wav' });
  }));
  router.delete('/editor/media/:id', admit(env, 'delete'), bodyParser, handler(env, 'delete', async (req, res, owner) => {
    exactFields(req.body ?? {}, []);
    await env.store.deleteMedia(owner, editorId(req.params.id), row => removeMediaFile(env.dataRoot, owner, row), confirm(env, 'delete', owner));
    res.status(204).end();
  }));
  router.post('/editor/media/cleanup', admit(env, 'delete'), bodyParser, handler(env, 'delete', async (req, res, owner) => {
    exactFields(req.body ?? {}, []);
    const deleted = await env.store.cleanupMedia(owner, row => removeMediaFile(env.dataRoot, owner, row), confirm(env, 'delete', owner));
    res.json({ deleted });
  }));
}

function projectReads(router: Router, env: RouteEnvironment): void {
  router.get('/editor/projects', admit(env, 'read'), handler(env, 'read', async (_req, res, owner) => {
    const projects = await env.store.list(owner); await confirm(env, 'read', owner)(); res.json({ projects });
  }));
  router.get('/editor/projects/:id', admit(env, 'read'), handler(env, 'read', async (req, res, owner) => {
    const project = await env.store.get(owner, editorId(req.params.id)); await confirm(env, 'read', owner)(); res.json({ project });
  }));
  router.get('/editor/projects/:id/revisions', admit(env, 'read'), handler(env, 'read', async (req, res, owner) => {
    const revisions = await env.store.revisions(owner, editorId(req.params.id)); await confirm(env, 'read', owner)(); res.json({ revisions });
  }));
  router.get('/editor/projects/:id/revisions/:revision', admit(env, 'read'), handler(env, 'read', async (req, res, owner) => {
    const project = await env.store.get(owner, editorId(req.params.id), revisionParam(req.params.revision));
    await confirm(env, 'read', owner)(); res.json({ project });
  }));
}

function projectWrites(router: Router, env: RouteEnvironment): void {
  router.post('/editor/projects', admit(env, 'create'), bodyParser, handler(env, 'create', async (req, res, owner) => {
    const project = await env.store.create(owner, projectInput(req.body, await env.validator), confirm(env, 'create', owner));
    res.status(201).json({ project });
  }));
  router.post('/editor/projects/:id/revisions', admit(env, 'change'), bodyParser, handler(env, 'change', async (req, res, owner) => {
    const input = projectInput(req.body, await env.validator, true);
    const project = await env.store.save(owner, editorId(req.params.id), baseRevision(req.body.baseRevision), input, confirm(env, 'change', owner));
    res.status(201).json({ project });
  }));
  router.delete('/editor/projects/:id', admit(env, 'delete'), bodyParser, handler(env, 'delete', async (req, res, owner) => {
    exactFields(req.body, ['baseRevision']);
    const exports = await env.store.delete(owner, editorId(req.params.id), baseRevision(req.body.baseRevision), confirm(env, 'delete', owner));
    if (await nativeDeletedExports(env, exports)) { res.status(204).end(); return; }
    for (const id of exports) {
      env.exports.cancel(id);
      await unlink(exportPath(env.dataRoot, owner, id)).catch(error => {
        if (error?.code !== 'ENOENT') logger.error({ err: error, exportId: id }, 'removing a deleted project export failed');
      });
    }
    res.status(204).end();
  }));
}

/** What this installation actually accepts; the browser reads it instead of assuming. */
function capabilities() {
  return { profile: { id: 'hd720p30', width: 1280, height: 720, fps: 30, video: 'h264', audio: 'aac', sampleRate: 48000 },
    uploads: { video: { container: 'mp4', videoCodecs: ['h264'], audioCodecs: ['aac'], maxBytes: EDITOR_LIMITS.clipBytes, maxSeconds: EDITOR_LIMITS.clipSeconds,
      maxDimension: EDITOR_LIMITS.maxDimension, maxPixels: EDITOR_LIMITS.maxPixels, maxFps: EDITOR_LIMITS.maxFps },
    audio: { container: 'wav', audioCodecs: ['pcm_s16le', 'pcm_s24le', 'pcm_s32le', 'pcm_f32le'], maxBytes: EDITOR_LIMITS.bedBytes, maxSeconds: EDITOR_LIMITS.bedSeconds } },
    limits: { videoSources: 2, audioSources: 1, segments: 20, totalSeconds: 60, titles: 10, retainedRevisions: EDITOR_LIMITS.retainedRevisions,
      ownerMedia: EDITOR_LIMITS.ownerMedia, ownerMediaBytes: EDITOR_LIMITS.ownerMediaBytes, projectMediaBytes: EDITOR_LIMITS.projectMediaBytes } };
}

let processRunner: ExportRunner | null = null;
/** One encode per Video process: the production runner is created once and stops its child if the process exits. */
function processExportRunner(store: VideoExportStore, dataRoot: string): ExportRunner {
  if (!processRunner) {
    const runner = new ExportRunner({ store, workRoot: join(dataRoot, '.work') });
    process.once('exit', () => runner.shutdown());
    processRunner = runner;
  }
  return processRunner;
}

/**
 * @description Mount the manual editor beside the studio at /api/video. Construction registers the package's
 * catalog resources and performs no database or filesystem writes.
 * @param ctx - Per-package context (pool, authorization, appPackageDir). @param options - Test seams only.
 * @returns Express router.
 */
export function createVideoEditorRoutes(ctx: EditorContext, options: VideoEditorOptions = {}): Router {
  registerVideoAuthorization(ctx.authorization);
  const router = Router();
  const store = new VideoEditorStore(ctx.pool), exportStore = new VideoExportStore(store), dataRoot = options.dataRoot ?? mediaRoot();
  const exports = options.exports || options.dataRoot ? new ExportRunner({ ...options.exports, store: exportStore, workRoot: join(dataRoot, '.work') })
    : processExportRunner(exportStore, dataRoot);
  const env: RouteEnvironment = { ctx, store, exportStore, dataRoot, exports,
    validator: loadTimelineValidator(ctx.appPackageDir ?? resolve(__dirname, '..')), prober: options.prober ?? probeWithFfprobe };
  router.use('/editor', requestLog);
  router.get('/editor/capabilities', admit(env, 'view'), handler(env, 'view', async (_req, res) => { res.json(capabilities()); }));
  router.get('/editor/permissions', admit(env, 'view'), handler(env, 'view', async (_req, res) => { res.json({ permissions: await editorPermissions(ctx), nativeMedia: await nativeMedia(env) }); }));
  pageRoutes(router, env); mediaRoutes(router, env); projectReads(router, env); projectWrites(router, env); registerExportRoutes(router, env);
  router.use('/editor', (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof multer.MulterError) return sendError(res, new EditorError(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, error.code === 'LIMIT_FILE_SIZE' ? 'video_edit_media_too_large' : 'invalid_video_edit_upload'));
    if (error && typeof error === 'object' && 'status' in error && (error.status === 400 || error.status === 413)) return sendError(res, new EditorError(error.status, 'invalid_video_edit_body'));
    sendError(res, error);
  });
  return router;
}
