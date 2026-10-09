"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createVidsPublishRoutes = createVidsPublishRoutes;
/**
 * CHANGE LOG
 * 1 | maintainer@emeraldcoastsystemsgroup.com | Add exact-owner private export upload/preview and separately confirmed publish, revoke and private removal controls. Multipart completion preserves verified identity.
 */
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const node_crypto_1 = require("node:crypto");
const promises_1 = require("node:fs/promises");
const node_async_hooks_1 = require("node:async_hooks");
const authz_1 = require("@/shared/middleware/authz");
const multipart_identity_1 = require("@/shared/middleware/multipart-identity");
const logger_1 = require("@/shared/logger");
const vids_artifacts_1 = require("./vids-artifacts");
const vids_artifact_files_1 = require("./vids-artifact-files");
const logger = (0, logger_1.createChildLogger)({ module: 'vids-publication' });
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const owner = (req) => req.exportOwner;
const job = (req) => String(req.params.jobId);
function refusal(res, error) {
    if (error instanceof vids_artifacts_1.ArtifactRefusal) {
        res.status(error.status).json({ error: error.code });
        return;
    }
    logger.warn({ type: error instanceof Error ? error.name : 'UnknownError' }, 'Vids artifact operation failed');
    if (!res.headersSent)
        res.status(503).json({ error: 'artifact_storage_unavailable' });
    else
        res.destroy();
}
function uploadParser() {
    return (0, multer_1.default)({ storage: multer_1.default.diskStorage({
            destination: (_req, _file, done) => { void (0, vids_artifact_files_1.ensureArtifactRoot)().then((root) => done(null, root), (error) => done(error, '')); },
            filename: (_req, _file, done) => done(null, `${(0, node_crypto_1.randomUUID)()}.upload`),
        }), limits: { fileSize: vids_artifact_files_1.MAX_VIDEO_BYTES, files: 1, fields: 0, parts: 1 },
        fileFilter: (_req, file, done) => file.mimetype === 'video/mp4' ? done(null, true) : done(new vids_artifacts_1.ArtifactRefusal(415, 'mp4_export_required')),
    }).single('file');
}
async function attachExport(ctx, req, res) {
    const uploaded = req.file?.path;
    if (!uploaded) {
        res.status(400).json({ error: 'one_file_required' });
        return;
    }
    const id = (0, node_crypto_1.randomUUID)();
    let durableFile = false;
    try {
        let checked;
        try {
            checked = await (0, vids_artifact_files_1.inspectVideo)(uploaded);
        }
        catch {
            throw new vids_artifacts_1.ArtifactRefusal(415, 'complete_mp4_video_required');
        }
        await (0, promises_1.link)(uploaded, (0, vids_artifact_files_1.artifactPath)(id));
        // The immutable file exists before the row commits. An uncertain commit leaves private bytes
        // in place rather than deleting an export that may have committed. No row means no serving.
        durableFile = true;
        const row = await (0, vids_artifacts_1.saveArtifact)(ctx, owner(req), job(req), id, checked.sha256, checked.byteLength);
        res.status(201).json({ artifact: (0, vids_artifacts_1.artifactView)(row) });
    }
    catch (error) {
        if (durableFile && error instanceof vids_artifacts_1.ArtifactRefusal)
            await (0, promises_1.unlink)((0, vids_artifact_files_1.artifactPath)(id)).catch(() => undefined);
        refusal(res, error);
    }
    finally {
        await (0, promises_1.unlink)(uploaded).catch(() => undefined);
    }
}
function createVidsPublishRoutes(ctx) {
    const router = (0, express_1.Router)({ mergeParams: true });
    router.use((req, res, next) => {
        const sub = (0, authz_1.getCaller)(req).sub ?? (0, authz_1.getTrustedServiceUserSub)(req);
        if (!sub) {
            res.status(401).json({ error: 'user_identity_required' });
            return;
        }
        if (!uuid.test(job(req))) {
            res.status(404).json({ error: 'job_not_found' });
            return;
        }
        req.exportOwner = sub;
        res.set('Cache-Control', 'private, no-store');
        next();
    });
    router.get('/', async (req, res) => {
        try {
            await (0, vids_artifacts_1.requireFinishedJob)(ctx, owner(req), job(req));
            res.json({ artifact: (0, vids_artifacts_1.artifactView)(await (0, vids_artifacts_1.ownedArtifact)(ctx, owner(req), job(req))) });
        }
        catch (error) {
            refusal(res, error);
        }
    });
    router.get('/video.mp4', async (req, res) => {
        try {
            const row = await (0, vids_artifacts_1.ownedArtifact)(ctx, owner(req), job(req));
            if (!row) {
                res.status(404).end();
                return;
            }
            await (0, vids_artifact_files_1.serveVideo)(req, res, row);
        }
        catch (error) {
            refusal(res, error);
        }
    });
    router.post('/', async (req, res, next) => {
        try {
            await (0, vids_artifacts_1.requireFinishedJob)(ctx, owner(req), job(req));
            next();
        }
        catch (error) {
            refusal(res, error);
        }
    }, (0, multipart_identity_1.preserveRequestIdentity)((req, res, next) => uploadParser()(req, res, node_async_hooks_1.AsyncResource.bind((error) => {
        if (!error) {
            next();
            return;
        }
        if (error instanceof multer_1.default.MulterError) {
            res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({ error: error.code, maxBytes: vids_artifact_files_1.MAX_VIDEO_BYTES });
            return;
        }
        refusal(res, error);
    }))), (req, res) => { void attachExport(ctx, req, res); });
    registerControls(router, ctx);
    return router;
}
function registerControls(router, ctx) {
    const confirm = (req, res, next) => {
        if (req.body?.confirm !== true) {
            res.status(428).json({ error: 'confirmation_required' });
            return;
        }
        next();
    };
    router.post('/publish', confirm, async (req, res) => {
        try {
            if (typeof req.body.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(req.body.sha256))
                throw new vids_artifacts_1.ArtifactRefusal(400, 'reviewed_digest_required');
            await (0, vids_artifacts_1.requireFinishedJob)(ctx, owner(req), job(req));
            const current = await (0, vids_artifacts_1.ownedArtifact)(ctx, owner(req), job(req));
            if (!current)
                throw new vids_artifacts_1.ArtifactRefusal(409, 'finished_export_required');
            const file = await (0, vids_artifact_files_1.inspectVideo)((0, vids_artifact_files_1.artifactPath)(current.artifact_id));
            if (file.sha256 !== current.sha256)
                throw new vids_artifacts_1.ArtifactRefusal(409, 'export_file_changed');
            res.json({ artifact: (0, vids_artifacts_1.artifactView)(await (0, vids_artifacts_1.publishArtifact)(ctx, owner(req), job(req), req.body.sha256)) });
        }
        catch (error) {
            refusal(res, error);
        }
    });
    router.post('/unpublish', confirm, async (req, res) => {
        try {
            res.json({ artifact: (0, vids_artifacts_1.artifactView)(await (0, vids_artifacts_1.unpublishArtifact)(ctx, owner(req), job(req))) });
        }
        catch (error) {
            refusal(res, error);
        }
    });
    router.delete('/', confirm, async (req, res) => {
        try {
            const row = await (0, vids_artifacts_1.removeArtifact)(ctx, owner(req), job(req));
            await (0, promises_1.unlink)((0, vids_artifact_files_1.artifactPath)(row.artifact_id)).catch(() => undefined);
            res.json({ removed: true });
        }
        catch (error) {
            refusal(res, error);
        }
    });
}
//# sourceMappingURL=vids-publish-routes.js.map