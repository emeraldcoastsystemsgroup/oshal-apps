"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestLog = exports.bodyParser = void 0;
exports.sendError = sendError;
exports.admit = admit;
exports.handler = handler;
exports.confirm = confirm;
exports.sendFile = sendFile;
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com | The editor's shared HTTP guards, moved out of video-editor-routes.ts so the export routes (CREATE-EDIT-05c) use exactly the same admission: personal scope only, named-permission admission before any body or storage, a re-check before commit, stable error codes with every failure logged, one entry/exit log line per request, and single-range file delivery.
 */
const express_1 = require("express");
const node_fs_1 = require("node:fs");
const logger_1 = require("@/shared/logger");
const video_editor_types_1 = require("./video-editor-types");
const video_authorization_1 = require("./video-authorization");
const logger = (0, logger_1.createChildLogger)({ module: 'video-editor-routes' });
/** @description JSON bodies bounded to the 256 KiB document plus its envelope. */
exports.bodyParser = (0, express_1.json)({ limit: video_editor_types_1.EDITOR_LIMITS.documentBytes + 4096, strict: true });
/** Personal projects never accept a caller-selected shared tenant or owner scope. */
function personalOnly(req) {
    if (Object.keys(req.query).some(key => /tenant|owner|issuer|subject|workspace/i.test(key))
        || req.header('x-oshal-tenant-id') || req.header('x-tenant-id'))
        throw new video_editor_types_1.EditorError(400, 'video_edit_personal_scope_only');
}
/**
 * @description Answer a stable code; log every server failure with the error itself, and every refusal by code.
 * @param res - Response. @param error - What was thrown. @returns void
 */
function sendError(res, error) {
    const typed = error instanceof video_editor_types_1.EditorError ? error : null;
    if (!typed || typed.status >= 500)
        logger.error({ err: error }, 'video editor request failed');
    else
        logger.info({ code: typed.code, status: typed.status }, 'video editor request refused');
    if (res.headersSent) {
        res.destroy();
        return;
    }
    res.status(typed?.status ?? 503).json({ error: typed?.code ?? 'video_edit_service_unavailable' });
}
/**
 * @description Authorize before reading any body or touching storage.
 * @param env - Route environment. @param action - Required editor action. @returns Middleware.
 */
function admit(env, action) {
    return (req, res, next) => {
        res.set('Cache-Control', 'private, no-store');
        Promise.resolve().then(() => {
            if (typeof env.ctx.pool?.connect !== 'function')
                throw new video_editor_types_1.EditorError(503, 'video_edit_store_unavailable');
            personalOnly(req);
        }).then(() => (0, video_authorization_1.requireEditorAccess)(env.ctx, action)).then(() => next()).catch(error => sendError(res, error));
    };
}
/**
 * @description Run route work as the re-verified owner; any throw becomes a stable error response.
 * @param env - Environment. @param action - Action. @param work - Handler body. @returns Handler.
 */
function handler(env, action, work) {
    return (req, res) => { (0, video_authorization_1.requireEditorAccess)(env.ctx, action).then(owner => work(req, res, owner)).catch(error => sendError(res, error)); };
}
/**
 * @description The re-check a write runs before commit (and a job runs while it works).
 * @param env - Environment. @param action - Action. @param owner - The owner the work began as. @returns The check.
 */
function confirm(env, action, owner) {
    return async () => { await (0, video_authorization_1.requireEditorAccess)(env.ctx, action, owner); };
}
/** @description One entry/exit line per editor request: method, matched route, status and duration; never bodies or identities. */
const requestLog = (req, res, next) => {
    const started = Date.now();
    res.on('finish', () => logger.info({ method: req.method, route: `${req.baseUrl}${req.route?.path ?? ''}`, status: res.statusCode,
        durationMs: Date.now() - started }, 'video editor request'));
    next();
};
exports.requestLog = requestLog;
/**
 * @description Serve one verified owned file, honoring a single byte range so the browser can seek.
 * @param req - Request. @param res - Response. @param file - Path. @param meta - Size and content type. @returns void
 */
function sendFile(req, res, file, meta) {
    const size = meta.bytes, range = req.header('range');
    let start = 0, end = size - 1;
    res.set({ 'Content-Type': meta.type, 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff' });
    if (range !== undefined) {
        const match = /^bytes=(\d{0,15})-(\d{0,15})$/.exec(range);
        if (match && (match[1] || match[2])) {
            if (match[1]) {
                start = Number(match[1]);
                end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
            }
            else {
                start = Math.max(0, size - Number(match[2]));
            }
        }
        if (!match || (!match[1] && !match[2]) || start > end || start >= size) {
            res.status(416).set('Content-Range', `bytes */${size}`).end();
            return;
        }
        res.status(206).set('Content-Range', `bytes ${start}-${end}/${size}`);
    }
    res.set('Content-Length', String(end - start + 1));
    const stream = (0, node_fs_1.createReadStream)(file, { start, end });
    stream.on('error', error => sendError(res, error));
    stream.pipe(res);
}
