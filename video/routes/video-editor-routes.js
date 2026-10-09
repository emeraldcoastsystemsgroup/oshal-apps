"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createVideoEditorRoutes = createVideoEditorRoutes;
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
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const node_async_hooks_1 = require("node:async_hooks");
const node_fs_1 = require("node:fs");
const node_crypto_1 = require("node:crypto");
const node_path_1 = require("node:path");
const video_editor_types_1 = require("./video-editor-types");
const video_editor_store_1 = require("./video-editor-store");
const video_authorization_1 = require("./video-authorization");
const video_editor_validation_1 = require("./video-editor-validation");
const video_editor_media_1 = require("./video-editor-media");
const promises_1 = require("node:fs/promises");
const logger_1 = require("@/shared/logger");
const video_editor_http_1 = require("./video-editor-http");
const video_edit_export_jobs_1 = require("./video-edit-export-jobs");
const video_editor_export_routes_1 = require("./video-editor-export-routes");
const video_editor_export_store_1 = require("./video-editor-export-store");
const video_editor_native_1 = require("./video-editor-native");
const logger = (0, logger_1.createChildLogger)({ module: 'video-editor-routes' });
/** The editor screen's only files: a fixed name-to-type allowlist, never a path taken from the request. */
const EDITOR_ASSETS = Object.freeze({
    'editor.css': 'text/css; charset=utf-8', 'editor.mjs': 'text/javascript; charset=utf-8', 'editor-api.mjs': 'text/javascript; charset=utf-8',
    'editor-player.mjs': 'text/javascript; charset=utf-8', 'editor-export.mjs': 'text/javascript; charset=utf-8',
    'timeline-view.mjs': 'text/javascript; charset=utf-8', 'timeline-model.mjs': 'text/javascript; charset=utf-8',
    'timeline-validation.mjs': 'text/javascript; charset=utf-8', 'timeline-history.mjs': 'text/javascript; charset=utf-8',
});
function sendBundled(res, file, type) {
    res.type(type);
    res.sendFile(file, error => { if (error)
        (0, video_editor_http_1.sendError)(res, new video_editor_types_1.EditorError(404, 'video_edit_asset_not_found')); });
}
function pageRoutes(router, env) {
    const directory = (0, node_path_1.join)(env.ctx.appPackageDir ?? (0, node_path_1.resolve)(__dirname, '..'), 'tools', 'editor');
    router.get('/editor', (0, video_editor_http_1.admit)(env, 'view'), (0, video_editor_http_1.handler)(env, 'view', async (_req, res) => { sendBundled(res, (0, node_path_1.join)(directory, 'editor.html'), 'text/html; charset=utf-8'); }));
    router.get('/editor/assets/:asset', (0, video_editor_http_1.admit)(env, 'view'), (0, video_editor_http_1.handler)(env, 'view', async (req, res) => {
        const name = String(req.params.asset);
        if (!Object.prototype.hasOwnProperty.call(EDITOR_ASSETS, name))
            throw new video_editor_types_1.EditorError(404, 'video_edit_asset_not_found');
        sendBundled(res, (0, node_path_1.join)(directory, name), EDITOR_ASSETS[name]);
    }));
}
function mediaRoutes(router, env) {
    if ((0, video_editor_native_1.nativeMediaRoutes)(router, env))
        return;
    const storage = multer_1.default.diskStorage({
        destination: (_req, _file, done) => { const directory = (0, video_editor_media_1.incomingDirectory)(env.dataRoot); (0, node_fs_1.mkdirSync)(directory, { recursive: true, mode: 0o700 }); done(null, directory); },
        filename: (_req, _file, done) => done(null, `${(0, node_crypto_1.randomUUID)()}.upload`),
    });
    const uploader = (kind) => (0, multer_1.default)({ storage, limits: { fileSize: kind === 'video' ? video_editor_types_1.EDITOR_LIMITS.clipBytes : video_editor_types_1.EDITOR_LIMITS.bedBytes,
            files: 1, fields: 0, parts: 1 } }).single('media');
    const uploads = { video: uploader('video'), audio: uploader('audio') };
    const receive = (req, res, next) => {
        try {
            uploads[(0, video_editor_validation_1.mediaKind)(req.query.kind)](req, res, node_async_hooks_1.AsyncResource.bind(next));
        }
        catch (error) {
            (0, video_editor_http_1.sendError)(res, error);
        }
    };
    router.post('/editor/media', (0, video_editor_http_1.admit)(env, 'upload'), receive, (0, video_editor_http_1.handler)(env, 'upload', async (req, res, owner) => {
        try {
            if (!req.file)
                throw new video_editor_types_1.EditorError(400, 'video_edit_media_required');
            const media = await (0, video_editor_media_1.publishMedia)(env.dataRoot, env.store, owner, req.file.path, (0, video_editor_validation_1.mediaKind)(req.query.kind), env.prober, (0, video_editor_http_1.confirm)(env, 'upload', owner));
            res.status(201).json({ media });
        }
        finally {
            await (0, video_editor_media_1.discardUpload)(req.file?.path);
        }
    }));
    router.get('/editor/media/:id', (0, video_editor_http_1.admit)(env, 'read'), (0, video_editor_http_1.handler)(env, 'read', async (req, res, owner) => {
        const { file, media } = await (0, video_editor_media_1.openMedia)(env.dataRoot, env.store, owner, (0, video_editor_validation_1.editorId)(req.params.id));
        await (0, video_editor_http_1.confirm)(env, 'read', owner)();
        (0, video_editor_http_1.sendFile)(req, res, file, { bytes: media.bytes, type: media.kind === 'video' ? 'video/mp4' : 'audio/wav' });
    }));
    router.delete('/editor/media/:id', (0, video_editor_http_1.admit)(env, 'delete'), video_editor_http_1.bodyParser, (0, video_editor_http_1.handler)(env, 'delete', async (req, res, owner) => {
        (0, video_editor_validation_1.exactFields)(req.body ?? {}, []);
        await env.store.deleteMedia(owner, (0, video_editor_validation_1.editorId)(req.params.id), row => (0, video_editor_media_1.removeMediaFile)(env.dataRoot, owner, row), (0, video_editor_http_1.confirm)(env, 'delete', owner));
        res.status(204).end();
    }));
    router.post('/editor/media/cleanup', (0, video_editor_http_1.admit)(env, 'delete'), video_editor_http_1.bodyParser, (0, video_editor_http_1.handler)(env, 'delete', async (req, res, owner) => {
        (0, video_editor_validation_1.exactFields)(req.body ?? {}, []);
        const deleted = await env.store.cleanupMedia(owner, row => (0, video_editor_media_1.removeMediaFile)(env.dataRoot, owner, row), (0, video_editor_http_1.confirm)(env, 'delete', owner));
        res.json({ deleted });
    }));
}
function projectReads(router, env) {
    router.get('/editor/projects', (0, video_editor_http_1.admit)(env, 'read'), (0, video_editor_http_1.handler)(env, 'read', async (_req, res, owner) => {
        const projects = await env.store.list(owner);
        await (0, video_editor_http_1.confirm)(env, 'read', owner)();
        res.json({ projects });
    }));
    router.get('/editor/projects/:id', (0, video_editor_http_1.admit)(env, 'read'), (0, video_editor_http_1.handler)(env, 'read', async (req, res, owner) => {
        const project = await env.store.get(owner, (0, video_editor_validation_1.editorId)(req.params.id));
        await (0, video_editor_http_1.confirm)(env, 'read', owner)();
        res.json({ project });
    }));
    router.get('/editor/projects/:id/revisions', (0, video_editor_http_1.admit)(env, 'read'), (0, video_editor_http_1.handler)(env, 'read', async (req, res, owner) => {
        const revisions = await env.store.revisions(owner, (0, video_editor_validation_1.editorId)(req.params.id));
        await (0, video_editor_http_1.confirm)(env, 'read', owner)();
        res.json({ revisions });
    }));
    router.get('/editor/projects/:id/revisions/:revision', (0, video_editor_http_1.admit)(env, 'read'), (0, video_editor_http_1.handler)(env, 'read', async (req, res, owner) => {
        const project = await env.store.get(owner, (0, video_editor_validation_1.editorId)(req.params.id), (0, video_editor_validation_1.revisionParam)(req.params.revision));
        await (0, video_editor_http_1.confirm)(env, 'read', owner)();
        res.json({ project });
    }));
}
function projectWrites(router, env) {
    router.post('/editor/projects', (0, video_editor_http_1.admit)(env, 'create'), video_editor_http_1.bodyParser, (0, video_editor_http_1.handler)(env, 'create', async (req, res, owner) => {
        const project = await env.store.create(owner, (0, video_editor_validation_1.projectInput)(req.body, await env.validator), (0, video_editor_http_1.confirm)(env, 'create', owner));
        res.status(201).json({ project });
    }));
    router.post('/editor/projects/:id/revisions', (0, video_editor_http_1.admit)(env, 'change'), video_editor_http_1.bodyParser, (0, video_editor_http_1.handler)(env, 'change', async (req, res, owner) => {
        const input = (0, video_editor_validation_1.projectInput)(req.body, await env.validator, true);
        const project = await env.store.save(owner, (0, video_editor_validation_1.editorId)(req.params.id), (0, video_editor_validation_1.baseRevision)(req.body.baseRevision), input, (0, video_editor_http_1.confirm)(env, 'change', owner));
        res.status(201).json({ project });
    }));
    router.delete('/editor/projects/:id', (0, video_editor_http_1.admit)(env, 'delete'), video_editor_http_1.bodyParser, (0, video_editor_http_1.handler)(env, 'delete', async (req, res, owner) => {
        (0, video_editor_validation_1.exactFields)(req.body, ['baseRevision']);
        const exports = await env.store.delete(owner, (0, video_editor_validation_1.editorId)(req.params.id), (0, video_editor_validation_1.baseRevision)(req.body.baseRevision), (0, video_editor_http_1.confirm)(env, 'delete', owner));
        if (await (0, video_editor_native_1.nativeDeletedExports)(env, exports)) {
            res.status(204).end();
            return;
        }
        for (const id of exports) {
            env.exports.cancel(id);
            await (0, promises_1.unlink)((0, video_editor_media_1.exportPath)(env.dataRoot, owner, id)).catch(error => {
                if (error?.code !== 'ENOENT')
                    logger.error({ err: error, exportId: id }, 'removing a deleted project export failed');
            });
        }
        res.status(204).end();
    }));
}
/** What this installation actually accepts; the browser reads it instead of assuming. */
function capabilities() {
    return { profile: { id: 'hd720p30', width: 1280, height: 720, fps: 30, video: 'h264', audio: 'aac', sampleRate: 48000 },
        uploads: { video: { container: 'mp4', videoCodecs: ['h264'], audioCodecs: ['aac'], maxBytes: video_editor_types_1.EDITOR_LIMITS.clipBytes, maxSeconds: video_editor_types_1.EDITOR_LIMITS.clipSeconds,
                maxDimension: video_editor_types_1.EDITOR_LIMITS.maxDimension, maxPixels: video_editor_types_1.EDITOR_LIMITS.maxPixels, maxFps: video_editor_types_1.EDITOR_LIMITS.maxFps },
            audio: { container: 'wav', audioCodecs: ['pcm_s16le', 'pcm_s24le', 'pcm_s32le', 'pcm_f32le'], maxBytes: video_editor_types_1.EDITOR_LIMITS.bedBytes, maxSeconds: video_editor_types_1.EDITOR_LIMITS.bedSeconds } },
        limits: { videoSources: 2, audioSources: 1, segments: 20, totalSeconds: 60, titles: 10, retainedRevisions: video_editor_types_1.EDITOR_LIMITS.retainedRevisions,
            ownerMedia: video_editor_types_1.EDITOR_LIMITS.ownerMedia, ownerMediaBytes: video_editor_types_1.EDITOR_LIMITS.ownerMediaBytes, projectMediaBytes: video_editor_types_1.EDITOR_LIMITS.projectMediaBytes } };
}
let processRunner = null;
/** One encode per Video process: the production runner is created once and stops its child if the process exits. */
function processExportRunner(store, dataRoot) {
    if (!processRunner) {
        const runner = new video_edit_export_jobs_1.ExportRunner({ store, workRoot: (0, node_path_1.join)(dataRoot, '.work') });
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
function createVideoEditorRoutes(ctx, options = {}) {
    (0, video_authorization_1.registerVideoAuthorization)(ctx.authorization);
    const router = (0, express_1.Router)();
    const store = new video_editor_store_1.VideoEditorStore(ctx.pool), exportStore = new video_editor_export_store_1.VideoExportStore(store), dataRoot = options.dataRoot ?? (0, video_editor_media_1.mediaRoot)();
    const exports = options.exports || options.dataRoot ? new video_edit_export_jobs_1.ExportRunner({ ...options.exports, store: exportStore, workRoot: (0, node_path_1.join)(dataRoot, '.work') })
        : processExportRunner(exportStore, dataRoot);
    const env = { ctx, store, exportStore, dataRoot, exports,
        validator: (0, video_editor_validation_1.loadTimelineValidator)(ctx.appPackageDir ?? (0, node_path_1.resolve)(__dirname, '..')), prober: options.prober ?? video_editor_media_1.probeWithFfprobe };
    router.use('/editor', video_editor_http_1.requestLog);
    router.get('/editor/capabilities', (0, video_editor_http_1.admit)(env, 'view'), (0, video_editor_http_1.handler)(env, 'view', async (_req, res) => { res.json(capabilities()); }));
    router.get('/editor/permissions', (0, video_editor_http_1.admit)(env, 'view'), (0, video_editor_http_1.handler)(env, 'view', async (_req, res) => { res.json({ permissions: await (0, video_authorization_1.editorPermissions)(ctx), nativeMedia: await (0, video_editor_native_1.nativeMedia)(env) }); }));
    pageRoutes(router, env);
    mediaRoutes(router, env);
    projectReads(router, env);
    projectWrites(router, env);
    (0, video_editor_export_routes_1.registerExportRoutes)(router, env);
    router.use('/editor', (error, _req, res, _next) => {
        if (error instanceof multer_1.default.MulterError)
            return (0, video_editor_http_1.sendError)(res, new video_editor_types_1.EditorError(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, error.code === 'LIMIT_FILE_SIZE' ? 'video_edit_media_too_large' : 'invalid_video_edit_upload'));
        if (error && typeof error === 'object' && 'status' in error && (error.status === 400 || error.status === 413))
            return (0, video_editor_http_1.sendError)(res, new video_editor_types_1.EditorError(error.status, 'invalid_video_edit_body'));
        (0, video_editor_http_1.sendError)(res, error);
    });
    return router;
}
