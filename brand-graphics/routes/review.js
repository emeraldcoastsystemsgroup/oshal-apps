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
exports.createReviewRoutes = createReviewRoutes;
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                  | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com | 1.4.3: serve review surface plus owner-scoped Brand Graphics render creation, job status, MP4 download, and personal brand kit endpoints (CREATE-TOOL-BRAND-04, -05, -06, -07).
 */
const crypto = __importStar(require("node:crypto"));
const fs = __importStar(require("node:fs"));
const path = __importStar(require("node:path"));
const express_1 = require("express");
const render_auth_1 = require("./render-auth");
const render_ffmpeg_1 = require("./render-ffmpeg");
const render_store_1 = require("./render-store");
const render_types_1 = require("./render-types");
const parseJson = (0, express_1.json)({ limit: '64kb', strict: true });
function sendError(res, error) {
    if (error instanceof render_types_1.RenderError) {
        res.status(error.status).json({ ok: false, error: error.code, message: error.message });
        return;
    }
    const status = error?.status;
    if (status === 413) {
        res.status(413).json({ ok: false, error: 'payload_too_large', message: 'Request body exceeds 64 KB limit.' });
        return;
    }
    if (status === 400) {
        res.status(400).json({ ok: false, error: 'invalid_json', message: 'Malformed JSON body.' });
        return;
    }
    res.status(500).json({ ok: false, error: 'render_route_error', message: 'Brand Graphics request failed.' });
}
function slugifyTitle(title) {
    const clean = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
    return clean || 'brand-clip';
}
function statusSummary(jobs) {
    if (!jobs.length)
        return 'No brand graphic renders recorded yet.';
    const latest = jobs[0];
    return `Latest build "${latest.title}" (${latest.aspect}, ${latest.durationSec}s, ${latest.brandKit.brandName}) is ${latest.status}.`;
}
function dataDirOf(ctx) {
    return typeof ctx?.brandGraphicsDataDir === 'string' ? ctx.brandGraphicsDataDir : undefined;
}
function wrap(fn) {
    return (req, res) => {
        res.setHeader('Cache-Control', 'private, no-store');
        fn(req, res).catch((error) => sendError(res, error));
    };
}
async function handleGetBrandKit(ctx, req, res) {
    const owner = await (0, render_auth_1.requireRenderOwner)(ctx, req, ['app.open', 'legacy.read']);
    const brandKit = await (0, render_store_1.resolveOwnerBrandKit)(ctx, owner, 'my-brand', null, dataDirOf(ctx));
    res.json({ ok: true, brandKit });
}
async function handleSaveBrandKit(ctx, req, res) {
    const owner = await (0, render_auth_1.requireRenderOwner)(ctx, req, ['app.open', 'source.change']);
    const patch = (0, render_types_1.parseBrandKitPatch)(req.body);
    if (!patch)
        throw new render_types_1.RenderError(400, 'invalid_brand_kit', 'Provide brand kit fields to save.');
    const brandKit = (0, render_store_1.saveBrandKit)(owner, patch, dataDirOf(ctx));
    res.json({ ok: true, brandKit });
}
async function handleListRenders(ctx, req, res) {
    const owner = await (0, render_auth_1.requireRenderOwner)(ctx, req, ['app.open', 'legacy.read']);
    const jobs = (0, render_store_1.listRenderJobs)(owner, dataDirOf(ctx));
    const caps = (0, render_ffmpeg_1.detectRendererCapabilities)(ctx);
    res.json({
        ok: true,
        jobs,
        count: jobs.length,
        latest: jobs[0] || null,
        summary: statusSummary(jobs),
        capabilities: {
            available: caps.available,
            localFfmpeg: caps.localFfmpeg,
            workerReady: caps.workerReady,
            aspects: [...render_types_1.ASPECT_CHOICES],
            formats: [...render_types_1.FORMAT_CHOICES],
            musicChoices: [...render_types_1.MUSIC_CHOICES],
            minDurationSec: 5,
            maxDurationSec: 60,
        },
    });
}
async function handleCreateRender(ctx, req, res) {
    const owner = await (0, render_auth_1.requireRenderOwner)(ctx, req, ['app.open', 'legacy.execute']);
    const input = (0, render_types_1.validateRenderInput)(req.body);
    const caps = (0, render_ffmpeg_1.detectRendererCapabilities)(ctx);
    if (!caps.available) {
        throw new render_types_1.RenderError(503, 'worker_unavailable', 'No render worker or local renderer is available on this installation, so nothing was queued.');
    }
    const dir = dataDirOf(ctx);
    const brandKit = await (0, render_store_1.resolveOwnerBrandKit)(ctx, owner, input.brandStyle, input.brandKit, dir);
    const id = crypto.randomUUID();
    const targetMp4 = (0, render_store_1.mp4FilePath)(owner, id, dir);
    const rendered = await (0, render_ffmpeg_1.renderBrandClipToFile)(ctx, input, brandKit, targetMp4);
    const now = new Date().toISOString();
    const downloadPath = `/api/brand-graphics/renders/${id}/download`;
    const job = {
        id,
        status: 'done',
        title: input.title,
        brief: input.brief,
        sourceLink: input.sourceLink,
        brandMode: input.brandMode,
        voiceover: input.voiceover,
        music: input.music,
        brandStyle: input.brandStyle,
        brandKit,
        durationSec: input.durationSec,
        aspect: input.aspect,
        width: rendered.width,
        height: rendered.height,
        format: input.format,
        fileName: `${slugifyTitle(input.title)}-${input.aspect.replace(':', 'x')}.mp4`,
        fileBytes: rendered.fileBytes,
        previewUrl: downloadPath,
        downloadUrl: `${downloadPath}?download=1`,
        renderer: rendered.renderer,
        createdAt: now,
        updatedAt: now,
    };
    (0, render_store_1.saveRenderJob)(owner, job, dir);
    res.status(201).json({ ok: true, job, previewUrl: job.previewUrl, downloadUrl: job.downloadUrl });
}
async function handleGetRender(ctx, req, res) {
    const owner = await (0, render_auth_1.requireRenderOwner)(ctx, req, ['app.open', 'legacy.read']);
    const job = (0, render_store_1.getRenderJob)(owner, (0, render_store_1.assertJobId)(req.params.id), dataDirOf(ctx));
    if (!job)
        throw new render_types_1.RenderError(404, 'render_not_found', 'Render job was not found for this account.');
    res.json({ ok: true, job });
}
async function handleDownloadRender(ctx, req, res) {
    const owner = await (0, render_auth_1.requireRenderOwner)(ctx, req, ['app.open', 'legacy.read']);
    const id = (0, render_store_1.assertJobId)(req.params.id);
    const dir = dataDirOf(ctx);
    const job = (0, render_store_1.getRenderJob)(owner, id, dir);
    if (!job)
        throw new render_types_1.RenderError(404, 'render_not_found', 'Render job was not found for this account.');
    const clip = (0, render_store_1.mp4FilePath)(owner, id, dir);
    if (!fs.existsSync(clip))
        throw new render_types_1.RenderError(404, 'render_file_missing', 'Rendered MP4 file is missing.');
    res.type('video/mp4');
    const disposition = req.query.download === '1' || req.query.download === 'true' ? 'attachment' : 'inline';
    res.setHeader('Content-Disposition', `${disposition}; filename="${job.fileName}"`);
    res.sendFile(clip);
}
async function handleDeleteRender(ctx, req, res) {
    const owner = await (0, render_auth_1.requireRenderOwner)(ctx, req, ['app.open', 'legacy.execute']);
    const deleted = (0, render_store_1.deleteRenderJob)(owner, (0, render_store_1.assertJobId)(req.params.id), dataDirOf(ctx));
    if (!deleted)
        throw new render_types_1.RenderError(404, 'render_not_found', 'Render job was not found for this account.');
    res.json({ ok: true, deleted: true });
}
function createReviewRoutes(ctx) {
    const router = (0, express_1.Router)();
    const packageDir = ctx?.appPackageDir;
    router.get('/review', (_req, res) => {
        res.setHeader('Cache-Control', 'no-store');
        res.sendFile(path.join(packageDir, 'tools/review.html'));
    });
    router.get('/brand-kit', wrap((req, res) => handleGetBrandKit(ctx, req, res)));
    router.put('/brand-kit', parseJson, wrap((req, res) => handleSaveBrandKit(ctx, req, res)));
    router.get('/renders', wrap((req, res) => handleListRenders(ctx, req, res)));
    router.post('/renders', parseJson, wrap((req, res) => handleCreateRender(ctx, req, res)));
    router.get('/renders/:id', wrap((req, res) => handleGetRender(ctx, req, res)));
    router.get('/renders/:id/download', wrap((req, res) => handleDownloadRender(ctx, req, res)));
    router.delete('/renders/:id', wrap((req, res) => handleDeleteRender(ctx, req, res)));
    router.use((error, _req, res, _next) => sendError(res, error));
    return router;
}
