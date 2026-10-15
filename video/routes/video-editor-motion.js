"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.motionRenders = motionRenders;
exports.importMotionJob = importMotionJob;
exports.importMotion = importMotion;
exports.motionRoutes = motionRoutes;
const node_crypto_1 = require("node:crypto");
const exchange = __importStar(require("@/shared/artifact-exchange"));
const video_editor_types_1 = require("./video-editor-types");
const video_editor_http_1 = require("./video-editor-http");
const video_editor_validation_1 = require("./video-editor-validation");
const video_editor_native_1 = require("./video-editor-native");
const artifactExchange = exchange;
/** @description Original native intent only; no identity or path reaches the media executor. */
async function native(env, input) {
    if (!(0, video_editor_native_1.nativeEditor)(env) || typeof env.ctx.intent !== 'function')
        throw new video_editor_types_1.EditorError(503, 'video_edit_motion_exchange_unavailable');
    try {
        const result = await env.ctx.intent('video.editor', input);
        if (!(0, video_editor_validation_1.isRecord)(result))
            throw new Error('Invalid response');
        return result;
    }
    catch (error) {
        if (error instanceof video_editor_types_1.EditorError)
            throw error;
        const match = /^(refused|invalid|unavailable): ((?:invalid_)?video_edit_[a-z_]+)$/.exec(error instanceof Error ? error.message : '');
        if (match)
            throw new video_editor_types_1.EditorError(/too_large|limit/.test(match[2]) ? 413 : /conflict|offset/.test(match[2]) ? 409 : match[1] === 'invalid' ? 400 : match[1] === 'refused' ? 403 : 503, match[2]);
        throw new video_editor_types_1.EditorError(503, 'video_edit_motion_exchange_unavailable');
    }
}
async function metadata(ref) {
    try {
        const value = await artifactExchange.metadata(ref);
        if ((0, video_editor_validation_1.isRecord)(value))
            return value;
    }
    catch { /* deny source/owner/grants without disclosing them */ }
    throw new video_editor_types_1.EditorError(403, 'video_edit_motion_source_unavailable');
}
function sourceOf(media, name, motion) {
    return { kind: 'video', asset: media.id, name, frames: media.frames, width: media.width, height: media.height, audio: media.hasAudio, motion };
}
/** @description Derive only from kernel-attested producer metadata then use the same strict shipped document validator. */
async function lineage(env, ref, meta, name) {
    const receipt = meta.receipt;
    if (meta.ref !== ref || meta.sourcePackage !== 'motion-studio' || !(0, video_editor_validation_1.isRecord)(receipt) || receipt.state !== 'ready' || receipt.format !== 'mp4'
        || meta.type !== 'video/mp4' || meta.source !== `/api/motion-studio/render-jobs/${receipt.id}` || meta.size !== receipt.bytes || meta.sha256 !== receipt.sha256
        || !Number.isSafeInteger(meta.size) || meta.size < 1 || meta.size > video_editor_types_1.EDITOR_LIMITS.clipBytes
        || !Number.isSafeInteger(receipt.renderWidth) || !Number.isSafeInteger(receipt.renderHeight) || Number(receipt.renderWidth) < 2 || Number(receipt.renderHeight) < 2
        || receipt.width !== 2 * Math.ceil(Number(receipt.renderWidth) / 2) || receipt.height !== 2 * Math.ceil(Number(receipt.renderHeight) / 2))
        throw new video_editor_types_1.EditorError(400, 'video_edit_motion_render_required');
    const motion = { project: receipt.project, revision: receipt.revision, compId: receipt.compId, documentSha256: receipt.documentSha256,
        renderJob: receipt.id, renderSha256: receipt.sha256, startTick: receipt.startTick, endTick: receipt.endTick, frameRate: receipt.frameRate };
    try {
        const document = (await env.validator)({ version: 1, name: 'Motion source', profile: 'hd720p30', sources: { v1: { kind: 'video', asset: (0, video_editor_validation_1.editorId)(receipt.id), name, frames: 1, width: 2, height: 2, audio: false, motion } }, segments: [], titles: [], audioBed: null });
        const normalized = document.sources.v1.motion;
        if (!Number.isSafeInteger(receipt.frames) || Number(receipt.frames) < 1 || Number(receipt.frames) > normalized.frameRate.num * video_editor_types_1.EDITOR_LIMITS.clipSeconds / normalized.frameRate.den)
            throw new Error('Duration');
        return normalized;
    }
    catch {
        throw new video_editor_types_1.EditorError(400, 'video_edit_motion_render_required');
    }
}
function same(left, right) {
    return ['project', 'revision', 'compId', 'documentSha256', 'renderJob', 'renderSha256', 'startTick', 'endTick'].every(key => left[key] === right[key])
        && left.frameRate.num === right.frameRate.num && left.frameRate.den === right.frameRate.den;
}
/** @description Only native original-Writer calls reach the fixed external Motion catalogue or typed mint. */
async function artifactIntent(env, input) {
    if (!(0, video_editor_native_1.nativeEditor)(env) || artifactExchange.native !== true || typeof env.ctx.intent !== 'function')
        throw new video_editor_types_1.EditorError(503, 'video_edit_motion_exchange_unavailable');
    try {
        const result = await env.ctx.intent('artifact.exchange', input);
        if (!(0, video_editor_validation_1.isRecord)(result))
            throw new Error('Invalid result');
        return result;
    }
    catch {
        throw new video_editor_types_1.EditorError(403, 'video_edit_motion_source_unavailable');
    }
}
/** @description Return every ready owned MP4 receipt; overflow refuses instead of omitting a candidate. */
async function motionRenders(env, owner, body) {
    (0, video_editor_validation_1.exactFields)(body, []);
    await (0, video_editor_http_1.confirm)(env, 'read', owner)();
    await (0, video_editor_http_1.confirm)(env, 'change', owner)();
    const result = await artifactIntent(env, { op: 'motion-renders' });
    if (Object.keys(result).length !== 1 || !Array.isArray(result.jobs) || result.jobs.length > 2)
        throw new video_editor_types_1.EditorError(503, 'video_edit_motion_catalogue_invalid');
    const seen = new Set(), jobs = result.jobs.map(value => {
        if (!(0, video_editor_validation_1.isRecord)(value) || value.state !== 'ready' || value.format !== 'mp4' || Buffer.byteLength(JSON.stringify(value), 'utf8') > 4096)
            throw new video_editor_types_1.EditorError(503, 'video_edit_motion_catalogue_invalid');
        const id = (0, video_editor_validation_1.editorId)(value.id), project = (0, video_editor_validation_1.editorId)(value.project), rate = value.frameRate;
        if (seen.has(id) || typeof value.title !== 'string' || !value.title.trim() || value.title.length > 160
            || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1 || Number(value.revision) > 1000
            || typeof value.documentSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.documentSha256)
            || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256)
            || !Number.isSafeInteger(value.bytes) || Number(value.bytes) < 1 || Number(value.bytes) > 276824064
            || !Number.isSafeInteger(value.frames) || Number(value.frames) < 1
            || !(0, video_editor_validation_1.isRecord)(rate) || Object.keys(rate).length !== 2 || !['num', 'den'].every(key => Number.isSafeInteger(rate[key]) && Number(rate[key]) > 0 && Number(rate[key]) <= 4294967295)
            || typeof value.compId !== 'string' || !/^(0|[1-9][0-9]{0,19})$/.test(value.compId) || BigInt(value.compId) > 18446744073709551615n
            || ![value.startTick, value.endTick].every(tick => typeof tick === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(tick) && BigInt(tick) <= 9223372036854775807n)
            || BigInt(String(value.startTick)) >= BigInt(String(value.endTick))
            || !['width', 'height', 'renderWidth', 'renderHeight'].every(key => Number.isSafeInteger(value[key]) && Number(value[key]) > 0 && Number(value[key]) <= 4096)
            || value.width !== 2 * Math.ceil(Number(value.renderWidth) / 2) || value.height !== 2 * Math.ceil(Number(value.renderHeight) / 2)
            || ![value.createdAt, value.expiresAt].every(date => typeof date === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(date) && Number.isFinite(Date.parse(date))))
            throw new video_editor_types_1.EditorError(503, 'video_edit_motion_catalogue_invalid');
        seen.add(id);
        return Object.fromEntries(['id', 'state', 'title', 'project', 'revision', 'compId', 'documentSha256', 'format', 'frames', 'frameRate', 'startTick', 'endTick', 'bytes', 'sha256', 'width', 'height', 'renderWidth', 'renderHeight', 'createdAt', 'expiresAt'].map(key => [key, key === 'id' ? id : key === 'project' ? project : value[key]]));
    });
    await (0, video_editor_http_1.confirm)(env, 'read', owner)();
    await (0, video_editor_http_1.confirm)(env, 'change', owner)();
    return { jobs };
}
/** @description A job ID selects no caller authority: native mint checks the actual original source before unchanged import. */
async function importMotionJob(env, owner, id, body) {
    (0, video_editor_validation_1.exactFields)(body, ['id', 'name', 'requestKey']);
    const job = (0, video_editor_validation_1.editorId)(id);
    if ((0, video_editor_validation_1.editorId)(body.id) !== job || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 120)
        throw new video_editor_types_1.EditorError(400, 'invalid_video_edit_motion_import');
    const requestKey = (0, video_editor_validation_1.editorId)(body.requestKey);
    await (0, video_editor_http_1.confirm)(env, 'read', owner)();
    await (0, video_editor_http_1.confirm)(env, 'change', owner)();
    const artifact = await artifactIntent(env, { op: 'mint', mode: 'motion-render', source: `/api/motion-studio/render-jobs/${job}`, type: 'video/mp4', name: body.name });
    if (typeof artifact.ref !== 'string' || !/^art_[a-f0-9]{64}$/.test(artifact.ref))
        throw new video_editor_types_1.EditorError(503, 'video_edit_motion_exchange_unavailable');
    const meta = await metadata(artifact.ref);
    if (!(0, video_editor_validation_1.isRecord)(meta.receipt) || meta.receipt.id !== job || meta.source !== `/api/motion-studio/render-jobs/${job}`)
        throw new video_editor_types_1.EditorError(503, 'video_edit_motion_source_changed');
    return importMotion(env, owner, { ref: artifact.ref, name: body.name, requestKey }, job);
}
/** @description Current Video grants and original Motion export authority recheck each bounded disk/native exchange. */
async function importMotion(env, owner, body, expectedJob) {
    (0, video_editor_validation_1.exactFields)(body, ['ref', 'name', 'requestKey']);
    if (typeof body.ref !== 'string' || !/^art_[a-f0-9]{64}$/.test(body.ref) || typeof body.name !== 'string' || !body.name.trim() || body.name.length > 120)
        throw new video_editor_types_1.EditorError(400, 'invalid_video_edit_motion_import');
    const ref = body.ref, name = body.name, requestKey = (0, video_editor_validation_1.editorId)(body.requestKey);
    const recheck = async () => { await (0, video_editor_http_1.confirm)(env, 'read', owner)(); await (0, video_editor_http_1.confirm)(env, 'change', owner)(); };
    await recheck();
    if (!(0, video_editor_native_1.nativeEditor)(env) || artifactExchange.native !== true)
        throw new video_editor_types_1.EditorError(503, 'video_edit_motion_exchange_unavailable');
    const meta = await metadata(ref), motion = await lineage(env, ref, meta, name);
    if (expectedJob !== undefined && motion.renderJob !== expectedJob)
        throw new video_editor_types_1.EditorError(503, 'video_edit_motion_source_changed');
    const retry = await env.store.motionImport(owner, requestKey);
    if (retry) {
        if (!same(retry.source, motion))
            throw new video_editor_types_1.EditorError(409, 'video_edit_motion_import_conflict');
        const media = await env.store.getMedia(owner, retry.asset);
        await recheck();
        return { media, sourceMetadata: sourceOf(media, name, retry.source), sourceUrl: `/api/motion-studio/app?project=${motion.project}&revision=${motion.revision}&compId=${motion.compId}`, replayed: true };
    }
    const requestDigest = (0, node_crypto_1.createHash)('sha256').update(JSON.stringify(['motion-render-to-video/1', motion, meta.size, meta.sha256])).digest('hex');
    const upload = await native(env, { op: 'upload_begin', kind: 'video', bytes: meta.size, requestKey, contentSha256: meta.sha256, requestDigest });
    const chunkBytes = Number(upload.chunkBytes);
    if (!Number.isSafeInteger(chunkBytes) || chunkBytes < 65536 || chunkBytes > 131072 || chunkBytes % 65536 !== 0)
        throw new video_editor_types_1.EditorError(503, 'video_edit_motion_exchange_unavailable');
    const id = (0, video_editor_validation_1.editorId)(upload.id), status = await native(env, { op: 'upload_status', id });
    const acknowledged = Number(status.offset);
    if (status.id !== id || status.kind !== 'video' || status.bytes !== meta.size || status.chunkBytes !== chunkBytes || status.contentSha256 !== meta.sha256 || status.requestDigest !== requestDigest
        || !Number.isSafeInteger(acknowledged) || acknowledged < 0 || acknowledged > meta.size || acknowledged % chunkBytes !== 0 && acknowledged !== meta.size || status.media !== undefined && acknowledged !== meta.size)
        throw new video_editor_types_1.EditorError(503, 'video_edit_motion_upload_receipt_invalid');
    const digest = (0, node_crypto_1.createHash)('sha256');
    let offset = 0, received = 0, pending = Buffer.alloc(0);
    while (received < meta.size) {
        await recheck();
        let result;
        try {
            result = await artifactExchange.chunk(ref, received);
        }
        catch {
            throw new video_editor_types_1.EditorError(403, 'video_edit_motion_source_unavailable');
        }
        if (!(0, video_editor_validation_1.isRecord)(result) || result.ref !== ref || result.offset !== received || result.size !== meta.size || typeof result.dataBase64 !== 'string' || result.dataBase64.length > 87384)
            throw new video_editor_types_1.EditorError(503, 'video_edit_motion_chunk_invalid');
        const bytes = Buffer.from(result.dataBase64, 'base64');
        if (!bytes.length || bytes.length > 65536 || bytes.toString('base64') !== result.dataBase64 || received + bytes.length > meta.size || result.done !== (received + bytes.length === meta.size))
            throw new video_editor_types_1.EditorError(503, 'video_edit_motion_chunk_invalid');
        digest.update(bytes);
        received += bytes.length;
        pending = Buffer.concat([pending, bytes]);
        while (pending.length >= chunkBytes || (received === meta.size && pending.length)) {
            const part = pending.subarray(0, chunkBytes);
            await recheck();
            if (offset >= acknowledged) {
                const appended = await native(env, { op: 'upload_chunk', id, offset, data: part.toString('base64'), sha256: (0, node_crypto_1.createHash)('sha256').update(part).digest('hex') });
                if (appended.offset !== offset + part.length)
                    throw new video_editor_types_1.EditorError(503, 'video_edit_motion_upload_receipt_invalid');
            }
            offset += part.length;
            pending = pending.subarray(part.length);
        }
    }
    if (digest.digest('hex') !== meta.sha256)
        throw new video_editor_types_1.EditorError(503, 'video_edit_motion_digest_mismatch');
    const latest = await metadata(ref), latestMotion = await lineage(env, ref, latest, name);
    if (latest.size !== meta.size || latest.sha256 !== meta.sha256 || !same(motion, latestMotion))
        throw new video_editor_types_1.EditorError(409, 'video_edit_motion_source_changed');
    await recheck();
    const result = status.media ? status : await native(env, { op: 'upload_finish', id }), media = result.media;
    if (!(0, video_editor_validation_1.isRecord)(media) || media.id !== id || media.sha256 !== meta.sha256 || media.bytes !== meta.size || media.kind !== 'video' || media.container !== 'mp4' || media.videoCodec !== 'h264')
        throw new video_editor_types_1.EditorError(503, 'video_edit_motion_media_mismatch');
    const expectedFrames = Number(meta.receipt.frames) * 30 * motion.frameRate.den / motion.frameRate.num;
    if (Math.abs(media.frames - expectedFrames) > 1 || Math.abs(media.durationMs - Number(meta.receipt.frames) * 1000 * motion.frameRate.den / motion.frameRate.num) > 67
        || media.width !== meta.receipt.width || media.height !== meta.receipt.height)
        throw new video_editor_types_1.EditorError(503, 'video_edit_motion_media_mismatch');
    const source = sourceOf(media, name, motion);
    try {
        (await env.validator)({ version: 1, name: 'Motion source', profile: 'hd720p30', sources: { v1: source }, segments: [], titles: [], audioBed: null });
    }
    catch {
        throw new video_editor_types_1.EditorError(400, 'video_edit_motion_media_mismatch');
    }
    const publication = async () => {
        await recheck();
        const current = await metadata(ref), currentMotion = await lineage(env, ref, current, name);
        if (current.size !== meta.size || current.sha256 !== meta.sha256 || !same(motion, currentMotion))
            throw new video_editor_types_1.EditorError(409, 'video_edit_motion_source_changed');
    };
    await env.store.addMedia(owner, media, publication, { source: motion, requestKey });
    return { media, sourceMetadata: source, sourceUrl: `/api/motion-studio/app?project=${motion.project}&revision=${motion.revision}&compId=${motion.compId}`, replayed: false };
}
function motionRoutes(router, env) {
    router.post('/editor/motion-renders', (0, video_editor_http_1.admit)(env, 'read'), (0, video_editor_http_1.admit)(env, 'change'), video_editor_http_1.bodyParser, (0, video_editor_http_1.handler)(env, 'change', async (req, res, owner) => { res.json(await motionRenders(env, owner, req.body)); }));
    router.post('/editor/motion-render-jobs/:id/import', (0, video_editor_http_1.admit)(env, 'read'), (0, video_editor_http_1.admit)(env, 'change'), video_editor_http_1.bodyParser, (0, video_editor_http_1.handler)(env, 'change', async (req, res, owner) => { res.status(201).json(await importMotionJob(env, owner, req.params.id, req.body)); }));
    router.post('/editor/motion-media', (0, video_editor_http_1.admit)(env, 'read'), (0, video_editor_http_1.admit)(env, 'change'), video_editor_http_1.bodyParser, (0, video_editor_http_1.handler)(env, 'change', async (req, res, owner) => { res.status(201).json(await importMotion(env, owner, req.body)); }));
}
