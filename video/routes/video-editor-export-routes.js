/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Export routes for the manual video editor (CREATE-EDIT-05c): request an export or a low-resolution preview of one saved revision, read a job and its live progress, cancel only an owned job, and download a verified success. A job resolves and re-hashes the owner's media only after it has re-checked current authority at start; polling never creates or retries work.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Preserve legacy routes while enabling bounded original-owner native media transport.
 */
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerExportRoutes = registerExportRoutes;
const promises_1 = require("node:fs/promises");
const logger_1 = require("@/shared/logger");
const video_editor_types_1 = require("./video-editor-types");
const video_editor_http_1 = require("./video-editor-http");
const video_editor_validation_1 = require("./video-editor-validation");
const video_editor_media_1 = require("./video-editor-media");
const video_editor_native_1 = require("./video-editor-native");
const logger = (0, logger_1.createChildLogger)({ module: 'video-editor-export-routes' });
function variant(value) {
    if (value === undefined || value === 'export')
        return 'export';
    if (value === 'preview')
        return 'preview';
    throw new video_editor_types_1.EditorError(400, 'invalid_video_edit_export_variant');
}
/** Resolve and verify everything one job reads, as the job, after its start-time authority check. */
async function prepare(env, owner, job, sha256) {
    const snapshot = await env.exportStore.verifiedSnapshot(owner, job.projectId, job.revision, sha256);
    const media = {};
    for (const [key, source] of Object.entries(snapshot.document.sources)) {
        const { file, media: row } = await (0, video_editor_media_1.openMedia)(env.dataRoot, env.store, owner, (0, video_editor_validation_1.editorId)(source.asset));
        await (0, video_editor_media_1.verifyMediaDigest)(file, row);
        media[key] = file;
    }
    return { document: snapshot.document, media, variant: job.variant, outputFile: (0, video_editor_media_1.exportPath)(env.dataRoot, owner, job.id) };
}
async function removePruned(env, owner, pruned) {
    for (const row of pruned) {
        await (0, promises_1.unlink)((0, video_editor_media_1.exportPath)(env.dataRoot, owner, row.id)).catch(error => {
            if (error?.code !== 'ENOENT')
                logger.error({ err: error, exportId: row.id }, 'removing a pruned export file failed');
        });
    }
}
/** Overlay this process's live progress; a finished job reports its own counts. */
function withProgress(env, row) {
    return { ...row, progressFrames: row.status === 'succeeded' ? row.totalFrames : env.exports.progress(row.id) };
}
/**
 * @description Mount the export routes on the editor router with the editor's own admission.
 * @param router - Editor router. @param env - Route environment. @returns void
 */
function registerExportRoutes(router, env) {
    if ((0, video_editor_native_1.nativeExportRoutes)(router, env))
        return;
    router.post('/editor/projects/:id/exports', (0, video_editor_http_1.admit)(env, 'export'), video_editor_http_1.bodyParser, (0, video_editor_http_1.handler)(env, 'export', async (req, res, owner) => {
        (0, video_editor_validation_1.exactFields)(req.body ?? {}, ['revision', 'variant']);
        const projectId = (0, video_editor_validation_1.editorId)(req.params.id), revision = (0, video_editor_validation_1.baseRevision)(req.body.revision), kind = variant(req.body.variant);
        if (env.exports.holds(owner))
            throw new video_editor_types_1.EditorError(409, 'video_edit_export_in_progress');
        const created = await env.exportStore.create(owner, projectId, revision, kind, env.exports.epoch, (0, video_editor_http_1.confirm)(env, 'export', owner));
        await removePruned(env, owner, created.pruned);
        try {
            env.exports.admit({ id: created.record.id, owner, authorize: (0, video_editor_http_1.confirm)(env, 'export', owner),
                prepare: () => prepare(env, owner, created.record, created.snapshot.sha256) });
        }
        catch (error) {
            const code = error instanceof video_editor_types_1.EditorError ? error.code : 'video_edit_export_failed';
            await env.exportStore.finishExport(owner, created.record.id, env.exports.epoch, { status: 'failed', error: code });
            throw error;
        }
        res.status(202).json({ export: withProgress(env, created.record) });
    }));
    router.get('/editor/projects/:id/exports', (0, video_editor_http_1.admit)(env, 'read'), (0, video_editor_http_1.handler)(env, 'read', async (req, res, owner) => {
        const rows = await env.exportStore.list(owner, (0, video_editor_validation_1.editorId)(req.params.id), env.exports.epoch);
        await (0, video_editor_http_1.confirm)(env, 'read', owner)();
        res.json({ exports: rows.map(row => withProgress(env, row)) });
    }));
    router.get('/editor/exports/:id', (0, video_editor_http_1.admit)(env, 'read'), (0, video_editor_http_1.handler)(env, 'read', async (req, res, owner) => {
        const row = await env.exportStore.get(owner, (0, video_editor_validation_1.editorId)(req.params.id), env.exports.epoch);
        await (0, video_editor_http_1.confirm)(env, 'read', owner)();
        res.json({ export: withProgress(env, row) });
    }));
    router.post('/editor/exports/:id/cancel', (0, video_editor_http_1.admit)(env, 'export'), video_editor_http_1.bodyParser, (0, video_editor_http_1.handler)(env, 'export', async (req, res, owner) => {
        (0, video_editor_validation_1.exactFields)(req.body ?? {}, []);
        const row = await env.exportStore.requestCancel(owner, (0, video_editor_validation_1.editorId)(req.params.id), env.exports.epoch, (0, video_editor_http_1.confirm)(env, 'export', owner));
        if (row.status === 'queued' || row.status === 'running' || row.status === 'cancelled')
            env.exports.cancel(row.id);
        res.status(202).json({ export: withProgress(env, row) });
    }));
    router.get('/editor/exports/:id/download', (0, video_editor_http_1.admit)(env, 'export'), (0, video_editor_http_1.handler)(env, 'export', async (req, res, owner) => {
        const row = await env.exportStore.get(owner, (0, video_editor_validation_1.editorId)(req.params.id), env.exports.epoch);
        if (row.status !== 'succeeded' || !row.outputBytes)
            throw new video_editor_types_1.EditorError(409, 'video_edit_export_not_ready');
        const file = (0, video_editor_media_1.exportPath)(env.dataRoot, owner, row.id), stat = await (0, promises_1.lstat)(file).catch(() => null);
        if (!stat || !stat.isFile() || stat.isSymbolicLink() || stat.size !== row.outputBytes)
            throw new video_editor_types_1.EditorError(503, 'video_edit_storage_unavailable');
        await (0, video_editor_http_1.confirm)(env, 'export', owner)();
        res.set('Content-Disposition', `${req.query.inline === '1' ? 'inline' : 'attachment'}; filename="video-${row.variant}-${row.id}.mp4"`);
        (0, video_editor_http_1.sendFile)(req, res, file, { bytes: row.outputBytes, type: 'video/mp4' });
    }));
}
