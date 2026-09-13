"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the job API: create a job, add photos (or a
 *                     |                             | video that becomes frames), assign each photo one of the six
 *                     |                             | views, set the ruler measurement, reconstruct, download the
 *                     |                             | STL / OBJ / drawing / report, or feed a point cloud instead.
 *                     |                             | Every handler re-derives the caller and pins every read and
 *                     |                             | write to that owner; ids from the wire are UUID-validated
 *                     |                             | before they touch a path or a query. Reconstruction runs
 *                     |                             | synchronously on the request — the grid is bounded (≤ 200³)
 *                     |                             | and a 96³ visual hull takes well under a second — so the
 *                     |                             | person gets the report in the same response and nothing runs
 *                     |                             | detached under a borrowed identity.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Persist the `contours` artifact on every reconstruction (the
 *                     |                             | front / top / right outlines in world mm — CAD Studio's bridge)
 *                     |                             | and serve it as JSON beside the other artifacts.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.UPLOAD_LIMITS = void 0;
exports.createJobRoutes = createJobRoutes;
const express_1 = require("express");
const multer_1 = __importDefault(require("multer"));
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_crypto_1 = require("node:crypto");
const logger_1 = require("@/shared/logger");
const job_store_1 = require("./job-store");
const data_dir_1 = require("./data-dir");
const image_ingest_1 = require("./image-ingest");
const silhouette_1 = require("./engine/raster/silhouette");
const views_1 = require("./engine/grid/views");
const point_cloud_1 = require("./engine/grid/point-cloud");
const pipeline_1 = require("./engine/pipeline");
const contour_export_1 = require("./engine/drawing/contour-export");
const logger = (0, logger_1.createChildLogger)({ module: 'scan-to-print-job-routes' });
/** @description Upload and count ceilings the surface pre-validates against. */
exports.UPLOAD_LIMITS = Object.freeze({
    imageBytes: 25 * 1024 * 1024, imagesPerRequest: 12, imagesPerJob: 24, videoBytes: 300 * 1024 * 1024, plyBytes: 200 * 1024 * 1024,
});
/** @description Known-dimension body validation. */
function parseKnownDimensions(raw) {
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > 3)
        throw new RangeError('knownDimensions must be a list of 1 to 3 {axis, mm} entries');
    const seen = new Set();
    return raw.map((entry) => {
        const axis = String(entry?.axis ?? '');
        const mm = Number(entry?.mm);
        if (!['x', 'y', 'z'].includes(axis) || seen.has(axis))
            throw new RangeError('knownDimensions axes must be distinct and one of x, y, z');
        if (!(mm > 0) || !Number.isFinite(mm) || mm > 100000)
            throw new RangeError('knownDimensions mm must be a positive number');
        seen.add(axis);
        return { axis: axis, mm };
    });
}
/** @description Settings body validation against the engine's published bounds. */
function parseSettings(raw) {
    const out = {};
    const body = (raw ?? {});
    for (const key of ['resolution', 'smoothIterations']) {
        if (body[key] === undefined || body[key] === null)
            continue;
        const bound = pipeline_1.RECONSTRUCTION_LIMITS[key];
        const value = Number(body[key]);
        if (!Number.isInteger(value) || value < bound.min || value > bound.max)
            throw new RangeError(`${key} must be an integer between ${bound.min} and ${bound.max}`);
        out[key] = value;
    }
    return out;
}
/** @description Which artifacts exist on disk for a job. */
function artifactPresence(dir) {
    return Object.fromEntries(Object.keys(data_dir_1.ARTIFACT_FILES).map((k) => [k, node_fs_1.default.existsSync((0, data_dir_1.artifactPath)(dir, k))]));
}
/** @description Persist one result's artifacts and the job report. */
async function saveResult(deps, sub, job, dir, result, sourceKind) {
    const artifacts = (0, pipeline_1.exportArtifacts)(result, `STP-${job.job_id.slice(0, 8).toUpperCase()}`);
    (0, data_dir_1.ensureDir)(node_path_1.default.join(dir, 'artifacts'));
    node_fs_1.default.writeFileSync((0, data_dir_1.artifactPath)(dir, 'stl'), artifacts.stl);
    node_fs_1.default.writeFileSync((0, data_dir_1.artifactPath)(dir, 'obj'), artifacts.obj);
    node_fs_1.default.writeFileSync((0, data_dir_1.artifactPath)(dir, 'svg'), artifacts.svg);
    node_fs_1.default.writeFileSync((0, data_dir_1.artifactPath)(dir, 'report'), JSON.stringify(artifacts.report, null, 2));
    node_fs_1.default.writeFileSync((0, data_dir_1.artifactPath)(dir, 'contours'), JSON.stringify((0, contour_export_1.exportContours)(result.grid, result.projections, result.report.sizeMm)));
    node_fs_1.default.rmSync((0, data_dir_1.artifactPath)(dir, 'gcode'), { force: true });
    const updated = await (0, job_store_1.updateJob)(deps.pool, sub, job.job_id, {
        state: 'reconstructed', report: artifacts.report, failure_reason: null, source_kind: sourceKind,
    });
    logger.info({ jobId: job.job_id, lane: result.report.lane, triangles: result.report.triangleCount, printable: result.report.printable }, 'Reconstruction saved');
    return updated ?? job;
}
/** @description Ingest one decoded photo: silhouette, files, row. */
async function ingestImage(deps, sub, jobId, dir, fileName, bytes) {
    const { raster, png } = await (0, image_ingest_1.decodeToRaster)(bytes);
    const silhouette = (0, silhouette_1.extractSilhouette)(raster);
    const imageId = (0, node_crypto_1.randomUUID)();
    (0, data_dir_1.ensureDir)(node_path_1.default.join(dir, 'images'));
    (0, data_dir_1.ensureDir)(node_path_1.default.join(dir, 'masks'));
    node_fs_1.default.writeFileSync((0, data_dir_1.imagePath)(dir, imageId, 'source'), png);
    node_fs_1.default.writeFileSync((0, data_dir_1.imagePath)(dir, imageId, 'mask'), await (0, image_ingest_1.maskToPng)(silhouette.mask));
    const row = await deps.pool.query('INSERT INTO scan_print_image (image_id, owner_sub, job_id, file_name, width, height, silhouette) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING image_id, job_id, file_name, view, width, height, silhouette, created_at', [imageId, sub, jobId, fileName, raster.width, raster.height, JSON.stringify({ threshold: silhouette.threshold, background: silhouette.background, stats: silhouette.stats, warnings: silhouette.warnings })]);
    return row.rows[0];
}
/** @description Load the assigned views' masks from disk. */
async function loadSilhouettes(dir, images) {
    const assigned = images.filter((img) => img.view !== null);
    return Promise.all(assigned.map(async (img) => ({ view: img.view, mask: await (0, image_ingest_1.pngToMask)(node_fs_1.default.readFileSync((0, data_dir_1.imagePath)(dir, img.image_id, 'mask'))) })));
}
/** @description The router. See the module change log for the contract. */
function createJobRoutes(deps) {
    const router = (0, express_1.Router)();
    const memoryUpload = (0, multer_1.default)({ storage: multer_1.default.memoryStorage(), limits: { fileSize: exports.UPLOAD_LIMITS.imageBytes, files: exports.UPLOAD_LIMITS.imagesPerRequest } });
    const diskUpload = (limit) => (0, multer_1.default)({
        storage: multer_1.default.diskStorage({
            destination: (req, _file, cb) => {
                const r = req;
                try {
                    cb(null, (0, data_dir_1.ensureDir)(node_path_1.default.join((0, data_dir_1.jobDir)(deps.dataRoot, r.scanSub, String(r.params.jobId)), 'uploads')));
                }
                catch (error) {
                    cb(error, '');
                }
            },
            filename: (_req, file, cb) => cb(null, `${(0, node_crypto_1.randomUUID)()}${node_path_1.default.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 12)}`),
        }),
        limits: { fileSize: limit, files: 1 },
    });
    // ── Guards: caller, then job ownership ─────────────────────────────────────
    router.use((req, res, next) => {
        const sub = deps.callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'unauthenticated' });
            return;
        }
        req.scanSub = sub;
        next();
    });
    router.param('jobId', async (req, res, next, value) => {
        try {
            const jobId = (0, data_dir_1.requireUuid)(value);
            const job = await (0, job_store_1.getJob)(deps.pool, req.scanSub, jobId);
            if (!job) {
                res.status(404).json({ error: 'job_not_found' });
                return;
            }
            req.scanJob = job;
            next();
        }
        catch (error) {
            if (error instanceof RangeError) {
                res.status(400).json({ error: 'invalid_job_id' });
                return;
            }
            logger.error({ err: error }, 'Job lookup failed');
            res.status(500).json({ error: 'job_lookup_failed' });
        }
    });
    router.get('/jobs', async (req, res) => {
        try {
            res.json({ jobs: await (0, job_store_1.listJobs)(deps.pool, req.scanSub) });
        }
        catch (error) {
            logger.error({ err: error }, 'List jobs failed');
            res.status(500).json({ error: 'list_failed' });
        }
    });
    router.post('/jobs', async (req, res) => {
        const title = String((req.body ?? {}).title ?? '').trim().slice(0, 120);
        if (!title) {
            res.status(400).json({ error: 'title_required' });
            return;
        }
        try {
            const job = await (0, job_store_1.createJob)(deps.pool, req.scanSub, title, 'photos');
            (0, data_dir_1.ensureDir)((0, data_dir_1.jobDir)(deps.dataRoot, req.scanSub, job.job_id));
            res.status(201).json({ job });
        }
        catch (error) {
            logger.error({ err: error }, 'Create job failed');
            res.status(500).json({ error: 'create_failed' });
        }
    });
    router.get('/jobs/:jobId', async (req, res) => {
        const job = req.scanJob;
        try {
            const dir = (0, data_dir_1.jobDir)(deps.dataRoot, req.scanSub, job.job_id);
            res.json({ job, images: await (0, job_store_1.listImages)(deps.pool, req.scanSub, job.job_id), artifacts: artifactPresence(dir), views: views_1.VIEW_NAMES });
        }
        catch (error) {
            logger.error({ err: error, jobId: job.job_id }, 'Job detail failed');
            res.status(500).json({ error: 'detail_failed' });
        }
    });
    router.patch('/jobs/:jobId', async (req, res) => {
        const job = req.scanJob;
        const body = (req.body ?? {});
        try {
            const patch = {};
            if (body.title !== undefined) {
                const title = String(body.title).trim().slice(0, 120);
                if (!title)
                    throw new RangeError('title cannot be empty');
                patch.title = title;
            }
            if (body.knownDimensions !== undefined)
                patch.known_dimensions = parseKnownDimensions(body.knownDimensions);
            if (body.settings !== undefined)
                patch.settings = parseSettings(body.settings);
            res.json({ job: await (0, job_store_1.updateJob)(deps.pool, req.scanSub, job.job_id, patch) });
        }
        catch (error) {
            if (error instanceof RangeError) {
                res.status(400).json({ error: 'invalid_patch', message: error.message });
                return;
            }
            logger.error({ err: error, jobId: job.job_id }, 'Patch job failed');
            res.status(500).json({ error: 'patch_failed' });
        }
    });
    router.delete('/jobs/:jobId', async (req, res) => {
        const job = req.scanJob;
        try {
            await (0, job_store_1.deleteJob)(deps.pool, req.scanSub, job.job_id);
            node_fs_1.default.rmSync((0, data_dir_1.jobDir)(deps.dataRoot, req.scanSub, job.job_id), { recursive: true, force: true });
            res.json({ deleted: true });
        }
        catch (error) {
            logger.error({ err: error, jobId: job.job_id }, 'Delete job failed');
            res.status(500).json({ error: 'delete_failed' });
        }
    });
    router.post('/jobs/:jobId/images', memoryUpload.array('images', exports.UPLOAD_LIMITS.imagesPerRequest), async (req, res) => {
        const job = req.scanJob;
        const files = req.files ?? [];
        if (files.length === 0) {
            res.status(400).json({ error: 'no_images' });
            return;
        }
        try {
            const existing = await (0, job_store_1.listImages)(deps.pool, req.scanSub, job.job_id);
            if (existing.length + files.length > exports.UPLOAD_LIMITS.imagesPerJob) {
                res.status(409).json({ error: 'too_many_images', limit: exports.UPLOAD_LIMITS.imagesPerJob });
                return;
            }
            const dir = (0, data_dir_1.jobDir)(deps.dataRoot, req.scanSub, job.job_id);
            const images = [];
            for (const file of files)
                images.push(await ingestImage(deps, req.scanSub, job.job_id, dir, file.originalname.slice(0, 200), file.buffer));
            await (0, job_store_1.updateJob)(deps.pool, req.scanSub, job.job_id, { state: 'capturing' });
            res.status(201).json({ images });
        }
        catch (error) {
            logger.error({ err: error, jobId: job.job_id }, 'Image ingest failed');
            res.status(422).json({ error: 'image_ingest_failed', message: error instanceof Error ? error.message : String(error) });
        }
    });
    router.post('/jobs/:jobId/video', diskUpload(exports.UPLOAD_LIMITS.videoBytes).single('video'), async (req, res) => {
        const job = req.scanJob;
        const file = req.file;
        if (!file) {
            res.status(400).json({ error: 'no_video' });
            return;
        }
        const dir = (0, data_dir_1.jobDir)(deps.dataRoot, req.scanSub, job.job_id);
        try {
            const existing = await (0, job_store_1.listImages)(deps.pool, req.scanSub, job.job_id);
            const config = (0, image_ingest_1.resolveFfmpeg)(deps.env);
            const room = exports.UPLOAD_LIMITS.imagesPerJob - existing.length;
            if (room <= 0) {
                res.status(409).json({ error: 'too_many_images', limit: exports.UPLOAD_LIMITS.imagesPerJob });
                return;
            }
            const frames = await (0, image_ingest_1.extractFrames)(file.path, node_path_1.default.join(dir, 'frames', (0, node_crypto_1.randomUUID)()), { ...config, maxFrames: Math.min(config.maxFrames, room) }, deps.execFile);
            const images = [];
            for (const frame of frames)
                images.push(await ingestImage(deps, req.scanSub, job.job_id, dir, node_path_1.default.basename(frame), node_fs_1.default.readFileSync(frame)));
            await (0, job_store_1.updateJob)(deps.pool, req.scanSub, job.job_id, { state: 'capturing', source_kind: 'video' });
            res.status(201).json({ images, frames: frames.length });
        }
        catch (error) {
            logger.error({ err: error, jobId: job.job_id }, 'Video ingest failed');
            res.status(422).json({ error: 'video_ingest_failed', message: error instanceof Error ? error.message : String(error) });
        }
        finally {
            node_fs_1.default.rmSync(file.path, { force: true });
        }
    });
    router.patch('/jobs/:jobId/images/:imageId', async (req, res) => {
        const job = req.scanJob;
        const view = (req.body ?? {}).view;
        if (view !== null && !(0, views_1.isViewName)(view)) {
            res.status(400).json({ error: 'invalid_view', views: views_1.VIEW_NAMES });
            return;
        }
        try {
            const image = await (0, job_store_1.assignView)(deps.pool, req.scanSub, job.job_id, (0, data_dir_1.requireUuid)(req.params.imageId), view);
            if (!image) {
                res.status(404).json({ error: 'image_not_found' });
                return;
            }
            res.json({ image });
        }
        catch (error) {
            if (error instanceof RangeError) {
                res.status(400).json({ error: 'invalid_image_id' });
                return;
            }
            logger.error({ err: error, jobId: job.job_id }, 'Assign view failed');
            res.status(500).json({ error: 'assign_failed' });
        }
    });
    router.delete('/jobs/:jobId/images/:imageId', async (req, res) => {
        const job = req.scanJob;
        try {
            const imageId = (0, data_dir_1.requireUuid)(req.params.imageId);
            const removed = await (0, job_store_1.deleteImage)(deps.pool, req.scanSub, job.job_id, imageId);
            if (!removed) {
                res.status(404).json({ error: 'image_not_found' });
                return;
            }
            const dir = (0, data_dir_1.jobDir)(deps.dataRoot, req.scanSub, job.job_id);
            node_fs_1.default.rmSync((0, data_dir_1.imagePath)(dir, imageId, 'source'), { force: true });
            node_fs_1.default.rmSync((0, data_dir_1.imagePath)(dir, imageId, 'mask'), { force: true });
            res.json({ deleted: true });
        }
        catch (error) {
            if (error instanceof RangeError) {
                res.status(400).json({ error: 'invalid_image_id' });
                return;
            }
            logger.error({ err: error, jobId: job.job_id }, 'Delete image failed');
            res.status(500).json({ error: 'delete_failed' });
        }
    });
    router.get('/jobs/:jobId/images/:imageId/file', async (req, res) => {
        const job = req.scanJob;
        try {
            const imageId = (0, data_dir_1.requireUuid)(req.params.imageId);
            const kind = req.query.kind === 'mask' ? 'mask' : 'source';
            const images = await (0, job_store_1.listImages)(deps.pool, req.scanSub, job.job_id);
            if (!images.some((img) => img.image_id === imageId)) {
                res.status(404).json({ error: 'image_not_found' });
                return;
            }
            const file = (0, data_dir_1.imagePath)((0, data_dir_1.jobDir)(deps.dataRoot, req.scanSub, job.job_id), imageId, kind);
            if (!node_fs_1.default.existsSync(file)) {
                res.status(404).json({ error: 'file_not_found' });
                return;
            }
            res.setHeader('Cache-Control', 'private, no-store');
            res.type('image/png').send(node_fs_1.default.readFileSync(file));
        }
        catch (error) {
            if (error instanceof RangeError) {
                res.status(400).json({ error: 'invalid_image_id' });
                return;
            }
            logger.error({ err: error, jobId: job.job_id }, 'Image file failed');
            res.status(500).json({ error: 'file_failed' });
        }
    });
    router.post('/jobs/:jobId/reconstruct', async (req, res) => {
        const job = req.scanJob;
        const sub = req.scanSub;
        const dir = (0, data_dir_1.jobDir)(deps.dataRoot, sub, job.job_id);
        try {
            const settings = { ...parseSettings(job.settings), ...parseSettings(req.body) };
            const silhouettes = await loadSilhouettes(dir, await (0, job_store_1.listImages)(deps.pool, sub, job.job_id));
            if (silhouettes.length === 0) {
                res.status(409).json({ error: 'no_views_assigned', message: 'Assign at least one photo to a view (front, top, right …) before reconstructing.' });
                return;
            }
            const known = parseKnownDimensions(job.known_dimensions);
            const started = Date.now();
            const result = (0, pipeline_1.reconstructFromSilhouettes)(silhouettes, known, { ...settings, partName: job.title });
            const updated = await saveResult(deps, sub, job, dir, result, job.source_kind === 'video' ? 'video' : 'photos');
            res.json({ job: updated, report: result.report, durationMs: Date.now() - started });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (error instanceof RangeError) {
                await (0, job_store_1.updateJob)(deps.pool, sub, job.job_id, { state: 'failed', failure_reason: message }).catch(() => null);
                res.status(422).json({ error: 'reconstruction_refused', message });
                return;
            }
            logger.error({ err: error, jobId: job.job_id }, 'Reconstruction failed');
            res.status(500).json({ error: 'reconstruction_failed' });
        }
    });
    router.post('/jobs/:jobId/pointcloud', diskUpload(exports.UPLOAD_LIMITS.plyBytes).single('model'), async (req, res) => {
        const job = req.scanJob;
        const sub = req.scanSub;
        const file = req.file;
        if (!file) {
            res.status(400).json({ error: 'no_model' });
            return;
        }
        const dir = (0, data_dir_1.jobDir)(deps.dataRoot, sub, job.job_id);
        try {
            const body = (req.body ?? {});
            const voxelMm = Number(body.voxelMm ?? 1);
            const unitScale = Number(body.unitScale ?? 1);
            const up = body.up === 'y' ? 'y' : 'z';
            if (!(voxelMm > 0) || !(unitScale > 0))
                throw new RangeError('voxelMm and unitScale must be positive numbers');
            const settings = { ...parseSettings(job.settings), ...parseSettings(body) };
            const cloud = (0, point_cloud_1.parsePly)(new Uint8Array(node_fs_1.default.readFileSync(file.path)));
            const vox = (0, point_cloud_1.voxelizePointCloud)(cloud, { voxelMm, unitScale, up });
            const fill = (0, point_cloud_1.fillSolidFromSurface)(vox.grid, 1);
            const warnings = fill.closed ? [] : ['The scanned surface did not close at this voxel size: the interior was NOT filled. Increase voxelMm or capture the missing side.'];
            const result = (0, pipeline_1.finishFromGrid)(vox.grid, vox.sizeMm, {
                lane: 'pointcloud', viewsUsed: [], sources: { x: 'known', y: 'known', z: 'known' }, warnings,
                method: `Point cloud (${cloud.count} points, ${vox.pointCount} in grid), voxel ${voxelMm} mm, ${up === 'y' ? 'Y-up' : 'Z-up'} ×${unitScale}`,
            }, { ...settings, partName: job.title });
            const updated = await saveResult(deps, sub, job, dir, result, 'pointcloud');
            res.json({ job: updated, report: result.report, closed: fill.closed, interiorFilled: fill.interiorFilled });
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (error instanceof RangeError) {
                await (0, job_store_1.updateJob)(deps.pool, sub, job.job_id, { state: 'failed', failure_reason: message }).catch(() => null);
                res.status(422).json({ error: 'pointcloud_refused', message });
                return;
            }
            logger.error({ err: error, jobId: job.job_id }, 'Point cloud lane failed');
            res.status(500).json({ error: 'pointcloud_failed' });
        }
        finally {
            node_fs_1.default.rmSync(file.path, { force: true });
        }
    });
    router.get('/jobs/:jobId/artifacts/:key', (req, res) => {
        const job = req.scanJob;
        const key = req.params.key;
        if (!(key in data_dir_1.ARTIFACT_FILES)) {
            res.status(400).json({ error: 'unknown_artifact', keys: Object.keys(data_dir_1.ARTIFACT_FILES) });
            return;
        }
        const file = (0, data_dir_1.artifactPath)((0, data_dir_1.jobDir)(deps.dataRoot, req.scanSub, job.job_id), key);
        if (!node_fs_1.default.existsSync(file)) {
            res.status(404).json({ error: 'artifact_not_found' });
            return;
        }
        const types = { stl: 'model/stl', obj: 'text/plain', svg: 'image/svg+xml', report: 'application/json', gcode: 'text/plain', contours: 'application/json' };
        res.setHeader('Cache-Control', 'private, no-store');
        if (req.query.download !== undefined)
            res.setHeader('Content-Disposition', `attachment; filename="${job.title.replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 60) || 'part'}.${key === 'report' || key === 'contours' ? 'json' : key}"`);
        res.type(types[key]).send(node_fs_1.default.readFileSync(file));
    });
    return router;
}
//# sourceMappingURL=job-routes.js.map