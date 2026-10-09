/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Use original native owner ports for bounded media and durable real exports; keep legacy FFmpeg lifecycle unchanged.
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Overlay one complete validated native success receipt instead of mixing fresh success with a stale SQL row.
 */
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.nativeEditor = nativeEditor;
exports.nativeMedia = nativeMedia;
exports.nativeMediaRoutes = nativeMediaRoutes;
exports.nativeDeletedExports = nativeDeletedExports;
exports.nativeExportRoutes = nativeExportRoutes;
const video_editor_types_1 = require("./video-editor-types");
const video_editor_http_1 = require("./video-editor-http");
const video_editor_validation_1 = require("./video-editor-validation");
/** @description Detect only the explicit original native SQL bridge. */
function nativeEditor(env) {
    return env.ctx.pool.storageModel === 'kernel-scoped-documents';
}
/** @description Forward no identity, path, command or permission claims to the protected native executor. */
async function call(env, input) {
    if (!nativeEditor(env) || typeof env.ctx.intent !== 'function')
        throw new video_editor_types_1.EditorError(503, 'video_edit_service_unavailable');
    let value;
    try {
        value = await env.ctx.intent('video.editor', input);
    }
    catch (error) {
        const match = /^(refused|invalid|unavailable): ((?:invalid_)?video_edit_[a-z_]+)$/.exec(error instanceof Error ? error.message : '');
        if (!match)
            throw new video_editor_types_1.EditorError(503, 'video_edit_service_unavailable');
        const status = /limit|too_large/.test(match[2]) ? 413 : match[1] === 'invalid' ? 400 : match[1] === 'unavailable' ? 503
            : /conflict|offset|not_ready/.test(match[2]) ? 409 : 403;
        throw new video_editor_types_1.EditorError(status, match[2]);
    }
    if (!value || typeof value !== 'object' || Array.isArray(value))
        throw new video_editor_types_1.EditorError(503, 'video_edit_service_unavailable');
    return value;
}
/** @description The browser's exact chunk transport; legacy permissions retain their shape. */
async function nativeMedia(env) {
    if (!nativeEditor(env))
        return undefined;
    const result = await call(env, { op: 'epoch' });
    return { chunkBytes: result.chunkBytes };
}
/** @description Read a current owned protected artifact handle; the HTTP boundary alone streams bytes. */
async function artifact(env, res, id, exported, inline = false) {
    const result = await call(env, exported ? { op: 'open_export', id, inline } : { op: 'open_media', id });
    const target = res;
    if (typeof target.nativeArtifact !== 'function')
        throw new video_editor_types_1.EditorError(503, 'video_edit_stream_unavailable');
    if (typeof result.handle !== 'string')
        throw new video_editor_types_1.EditorError(503, 'video_edit_stream_unavailable');
    target.nativeArtifact(result.handle);
}
/** @description Native upload retains the existing named binding and guarded canonical media insert. */
async function upload(env, req, res, owner) {
    const body = req.body ?? {};
    if (body.op === 'begin') {
        (0, video_editor_validation_1.exactFields)(body, ['op', 'bytes']);
        res.status(201).json(await call(env, { op: 'upload_begin', kind: (0, video_editor_validation_1.mediaKind)(req.query.kind), bytes: body.bytes }));
    }
    else if (body.op === 'chunk') {
        (0, video_editor_validation_1.exactFields)(body, ['op', 'id', 'offset', 'data', 'sha256']);
        res.json(await call(env, { op: 'upload_chunk', id: (0, video_editor_validation_1.editorId)(body.id), offset: body.offset, data: body.data, sha256: body.sha256 }));
    }
    else if (body.op === 'finish') {
        (0, video_editor_validation_1.exactFields)(body, ['op', 'id']);
        const result = await call(env, { op: 'upload_finish', id: (0, video_editor_validation_1.editorId)(body.id) });
        await env.store.addMedia(owner, result.media, (0, video_editor_http_1.confirm)(env, 'upload', owner));
        res.status(201).json({ media: result.media });
    }
    else
        throw new video_editor_types_1.EditorError(400, 'invalid_video_edit_upload');
}
/** @description Delete metadata through canonical scoped SQL before pruning unreachable protected bytes. */
async function prune(env, ids) {
    if (ids.length)
        await call(env, { op: 'prune', ids });
}
/** @description Mount only native media paths; the legacy multipart and file routes remain unchanged. */
function nativeMediaRoutes(router, env) {
    if (!nativeEditor(env))
        return false;
    router.post('/editor/media', (0, video_editor_http_1.admit)(env, 'upload'), video_editor_http_1.bodyParser, (0, video_editor_http_1.handler)(env, 'upload', (req, res, owner) => upload(env, req, res, owner)));
    router.get('/editor/media/:id', (0, video_editor_http_1.admit)(env, 'read'), (0, video_editor_http_1.handler)(env, 'read', async (req, res, owner) => {
        const id = (0, video_editor_validation_1.editorId)(req.params.id);
        await env.store.getMedia(owner, id);
        await (0, video_editor_http_1.confirm)(env, 'read', owner)();
        await artifact(env, res, id, false);
    }));
    router.delete('/editor/media/:id', (0, video_editor_http_1.admit)(env, 'delete'), video_editor_http_1.bodyParser, (0, video_editor_http_1.handler)(env, 'delete', async (req, res, owner) => {
        (0, video_editor_validation_1.exactFields)(req.body ?? {}, []);
        const id = (0, video_editor_validation_1.editorId)(req.params.id);
        await env.store.deleteMedia(owner, id, async () => undefined, (0, video_editor_http_1.confirm)(env, 'delete', owner));
        await prune(env, [id]);
        res.status(204).end();
    }));
    router.post('/editor/media/cleanup', (0, video_editor_http_1.admit)(env, 'delete'), video_editor_http_1.bodyParser, (0, video_editor_http_1.handler)(env, 'delete', async (req, res, owner) => {
        (0, video_editor_validation_1.exactFields)(req.body ?? {}, []);
        const deleted = await env.store.cleanupMedia(owner, async () => undefined, (0, video_editor_http_1.confirm)(env, 'delete', owner));
        await prune(env, deleted);
        res.json({ deleted });
    }));
    return true;
}
/** @description Native project deletion cancels/prunes only owned exports after canonical row commit. */
async function nativeDeletedExports(env, ids) {
    if (!nativeEditor(env))
        return false;
    await prune(env, ids);
    return true;
}
/** @description Keep native measurements within the shipped 256 MiB, 1800-frame, 30 fps output profile. */
function successOutput(value) {
    if (!(0, video_editor_validation_1.isRecord)(value))
        throw new video_editor_types_1.EditorError(503, 'video_edit_export_output_invalid');
    const { outputBytes, outputSha256, outputFrames, outputDurationMs } = value;
    if (typeof outputBytes !== 'number' || !Number.isSafeInteger(outputBytes) || outputBytes < 1 || outputBytes > 268435456
        || typeof outputSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(outputSha256)
        || typeof outputFrames !== 'number' || !Number.isSafeInteger(outputFrames) || outputFrames < 1 || outputFrames > 1800
        || typeof outputDurationMs !== 'number' || !Number.isSafeInteger(outputDurationMs) || outputDurationMs < 1
        || Math.abs(outputDurationMs - outputFrames * 1000 / 30) > 2000 / 30) {
        throw new video_editor_types_1.EditorError(503, 'video_edit_export_output_invalid');
    }
    return { outputBytes, outputSha256, outputFrames, outputDurationMs };
}
/** @description Overlay one complete protected receipt; polling never dispatches or retries an encode. */
async function status(env, row) {
    const current = await call(env, { op: 'export_status', id: row.id });
    const state = current.state === 'verified' ? 'running' : typeof current.state === 'string' ? current.state : row.status;
    const output = state === 'succeeded' ? successOutput(current.output) : undefined;
    return { ...row, ...output, status: state,
        error: state === 'succeeded' ? null : typeof current.error === 'string' ? current.error : row.error,
        progressFrames: output?.outputFrames ?? null };
}
/** @description Canonical native export request records actual SQL revision then captures original durable work before202. */
async function start(env, req, res, owner) {
    (0, video_editor_validation_1.exactFields)(req.body ?? {}, ['revision', 'variant']);
    const kind = req.body.variant ?? 'export';
    if (!['export', 'preview'].includes(kind))
        throw new video_editor_types_1.EditorError(400, 'invalid_video_edit_export_variant');
    const { epoch } = await call(env, { op: 'epoch' });
    const created = await env.exportStore.create(owner, (0, video_editor_validation_1.editorId)(req.params.id), (0, video_editor_validation_1.baseRevision)(req.body.revision), kind, String(epoch), (0, video_editor_http_1.confirm)(env, 'export', owner));
    if (created.pruned.length)
        await prune(env, created.pruned.map(row => row.id));
    await call(env, { op: 'export_start', id: created.record.id });
    res.status(202).json({ export: { ...created.record, progressFrames: null } });
}
/** @description Mount native export lifecycle without retaining request callbacks after202. */
function nativeExportRoutes(router, env) {
    if (!nativeEditor(env))
        return false;
    router.post('/editor/projects/:id/exports', (0, video_editor_http_1.admit)(env, 'export'), video_editor_http_1.bodyParser, (0, video_editor_http_1.handler)(env, 'export', (req, res, owner) => start(env, req, res, owner)));
    router.get('/editor/projects/:id/exports', (0, video_editor_http_1.admit)(env, 'read'), (0, video_editor_http_1.handler)(env, 'read', async (req, res, owner) => {
        const { epoch } = await call(env, { op: 'epoch' });
        const rows = await env.exportStore.list(owner, (0, video_editor_validation_1.editorId)(req.params.id), String(epoch));
        res.json({ exports: await Promise.all(rows.map(row => status(env, row))) });
    }));
    router.get('/editor/exports/:id', (0, video_editor_http_1.admit)(env, 'read'), (0, video_editor_http_1.handler)(env, 'read', async (req, res, owner) => {
        const { epoch } = await call(env, { op: 'epoch' });
        res.json({ export: await status(env, await env.exportStore.get(owner, (0, video_editor_validation_1.editorId)(req.params.id), String(epoch))) });
    }));
    router.post('/editor/exports/:id/cancel', (0, video_editor_http_1.admit)(env, 'export'), video_editor_http_1.bodyParser, (0, video_editor_http_1.handler)(env, 'export', async (req, res, owner) => {
        (0, video_editor_validation_1.exactFields)(req.body ?? {}, []);
        const id = (0, video_editor_validation_1.editorId)(req.params.id);
        const { epoch } = await call(env, { op: 'epoch' });
        const row = await env.exportStore.requestCancel(owner, id, String(epoch), (0, video_editor_http_1.confirm)(env, 'export', owner));
        await call(env, { op: 'export_cancel', id });
        res.status(202).json({ export: await status(env, row) });
    }));
    router.get('/editor/exports/:id/download', (0, video_editor_http_1.admit)(env, 'export'), (0, video_editor_http_1.handler)(env, 'export', async (req, res, owner) => {
        const { epoch } = await call(env, { op: 'epoch' });
        const id = (0, video_editor_validation_1.editorId)(req.params.id);
        const row = await env.exportStore.get(owner, id, String(epoch));
        if (row.status !== 'succeeded')
            throw new video_editor_types_1.EditorError(409, 'video_edit_export_not_ready');
        await (0, video_editor_http_1.confirm)(env, 'export', owner)();
        await artifact(env, res, id, true, req.query.inline === '1');
    }));
    return true;
}
