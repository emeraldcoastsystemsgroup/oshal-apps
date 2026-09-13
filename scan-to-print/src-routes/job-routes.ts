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

import { Router, type Request, type Response, type NextFunction } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createChildLogger } from '@/shared/logger';
import { type JobRow, type ImageRow, type QueryablePool, assignView, createJob, deleteImage, deleteJob, getJob, listImages, listJobs, updateJob } from './job-store';
import { type ArtifactKey, ARTIFACT_FILES, artifactPath, ensureDir, imagePath, jobDir, requireUuid } from './data-dir';
import { type ExecFileLike, decodeToRaster, extractFrames, maskToPng, pngToMask, resolveFfmpeg } from './image-ingest';
import { extractSilhouette } from './engine/raster/silhouette';
import { type ViewName, VIEW_NAMES, isViewName } from './engine/grid/views';
import { type KnownDimension, type ViewSilhouette } from './engine/grid/silhouette-carver';
import { fillSolidFromSurface, parsePly, voxelizePointCloud } from './engine/grid/point-cloud';
import { RECONSTRUCTION_LIMITS, type ReconstructionResult, exportArtifacts, finishFromGrid, reconstructFromSilhouettes } from './engine/pipeline';
import { exportContours } from './engine/drawing/contour-export';

const logger = createChildLogger({ module: 'scan-to-print-job-routes' });

/** @description Upload and count ceilings the surface pre-validates against. */
export const UPLOAD_LIMITS = Object.freeze({
  imageBytes: 25 * 1024 * 1024, imagesPerRequest: 12, imagesPerJob: 24, videoBytes: 300 * 1024 * 1024, plyBytes: 200 * 1024 * 1024,
});

/** @description What the job router needs from its host. */
export interface JobRouteDeps {
  /** The GUC-stamped pool. */
  pool: QueryablePool;
  /** Root directory for job files. */
  dataRoot: string;
  /** Environment for ffmpeg configuration. */
  env: Record<string, string | undefined>;
  /** Caller resolution. */
  callerSub: (req: Request) => string | null;
  /** Process runner for ffmpeg; injectable for specs. */
  execFile?: ExecFileLike;
}

/** @description Request-local state set by the guards. */
interface JobRequest extends Request {
  scanSub?: string;
  scanJob?: JobRow;
}

/** @description Known-dimension body validation. */
function parseKnownDimensions(raw: unknown): KnownDimension[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 3) throw new RangeError('knownDimensions must be a list of 1 to 3 {axis, mm} entries');
  const seen = new Set<string>();
  return raw.map((entry) => {
    const axis = String((entry as { axis?: unknown })?.axis ?? '');
    const mm = Number((entry as { mm?: unknown })?.mm);
    if (!['x', 'y', 'z'].includes(axis) || seen.has(axis)) throw new RangeError('knownDimensions axes must be distinct and one of x, y, z');
    if (!(mm > 0) || !Number.isFinite(mm) || mm > 100000) throw new RangeError('knownDimensions mm must be a positive number');
    seen.add(axis);
    return { axis: axis as 'x' | 'y' | 'z', mm };
  });
}

/** @description Settings body validation against the engine's published bounds. */
function parseSettings(raw: unknown): { resolution?: number; smoothIterations?: number } {
  const out: { resolution?: number; smoothIterations?: number } = {};
  const body = (raw ?? {}) as Record<string, unknown>;
  for (const key of ['resolution', 'smoothIterations'] as const) {
    if (body[key] === undefined || body[key] === null) continue;
    const bound = RECONSTRUCTION_LIMITS[key];
    const value = Number(body[key]);
    if (!Number.isInteger(value) || value < bound.min || value > bound.max) throw new RangeError(`${key} must be an integer between ${bound.min} and ${bound.max}`);
    out[key] = value;
  }
  return out;
}

/** @description Which artifacts exist on disk for a job. */
function artifactPresence(dir: string): Record<ArtifactKey, boolean> {
  return Object.fromEntries((Object.keys(ARTIFACT_FILES) as ArtifactKey[]).map((k) => [k, fs.existsSync(artifactPath(dir, k))])) as Record<ArtifactKey, boolean>;
}

/** @description Persist one result's artifacts and the job report. */
async function saveResult(deps: JobRouteDeps, sub: string, job: JobRow, dir: string, result: ReconstructionResult, sourceKind: string): Promise<JobRow> {
  const artifacts = exportArtifacts(result, `STP-${job.job_id.slice(0, 8).toUpperCase()}`);
  ensureDir(path.join(dir, 'artifacts'));
  fs.writeFileSync(artifactPath(dir, 'stl'), artifacts.stl);
  fs.writeFileSync(artifactPath(dir, 'obj'), artifacts.obj);
  fs.writeFileSync(artifactPath(dir, 'svg'), artifacts.svg);
  fs.writeFileSync(artifactPath(dir, 'report'), JSON.stringify(artifacts.report, null, 2));
  fs.writeFileSync(artifactPath(dir, 'contours'), JSON.stringify(exportContours(result.grid, result.projections, result.report.sizeMm)));
  fs.rmSync(artifactPath(dir, 'gcode'), { force: true });
  const updated = await updateJob(deps.pool, sub, job.job_id, {
    state: 'reconstructed', report: artifacts.report as unknown as Record<string, unknown>, failure_reason: null, source_kind: sourceKind,
  });
  logger.info({ jobId: job.job_id, lane: result.report.lane, triangles: result.report.triangleCount, printable: result.report.printable }, 'Reconstruction saved');
  return updated ?? job;
}

/** @description Ingest one decoded photo: silhouette, files, row. */
async function ingestImage(deps: JobRouteDeps, sub: string, jobId: string, dir: string, fileName: string, bytes: Buffer): Promise<ImageRow> {
  const { raster, png } = await decodeToRaster(bytes);
  const silhouette = extractSilhouette(raster);
  const imageId = randomUUID();
  ensureDir(path.join(dir, 'images'));
  ensureDir(path.join(dir, 'masks'));
  fs.writeFileSync(imagePath(dir, imageId, 'source'), png);
  fs.writeFileSync(imagePath(dir, imageId, 'mask'), await maskToPng(silhouette.mask));
  const row = await deps.pool.query(
    'INSERT INTO scan_print_image (image_id, owner_sub, job_id, file_name, width, height, silhouette) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING image_id, job_id, file_name, view, width, height, silhouette, created_at',
    [imageId, sub, jobId, fileName, raster.width, raster.height, JSON.stringify({ threshold: silhouette.threshold, background: silhouette.background, stats: silhouette.stats, warnings: silhouette.warnings })],
  );
  return row.rows[0] as ImageRow;
}

/** @description Load the assigned views' masks from disk. */
async function loadSilhouettes(dir: string, images: ImageRow[]): Promise<ViewSilhouette[]> {
  const assigned = images.filter((img) => img.view !== null);
  return Promise.all(assigned.map(async (img) => ({ view: img.view as ViewName, mask: await pngToMask(fs.readFileSync(imagePath(dir, img.image_id, 'mask'))) })));
}

/** @description The router. See the module change log for the contract. */
export function createJobRoutes(deps: JobRouteDeps): Router {
  const router = Router();
  const memoryUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: UPLOAD_LIMITS.imageBytes, files: UPLOAD_LIMITS.imagesPerRequest } });
  const diskUpload = (limit: number) => multer({
    storage: multer.diskStorage({
      destination: (req, _file, cb) => {
        const r = req as JobRequest;
        try { cb(null, ensureDir(path.join(jobDir(deps.dataRoot, r.scanSub as string, String(r.params.jobId)), 'uploads'))); } catch (error) { cb(error as Error, ''); }
      },
      filename: (_req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 12)}`),
    }),
    limits: { fileSize: limit, files: 1 },
  });

  // ── Guards: caller, then job ownership ─────────────────────────────────────
  router.use((req: JobRequest, res: Response, next: NextFunction) => {
    const sub = deps.callerSub(req);
    if (!sub) { res.status(401).json({ error: 'unauthenticated' }); return; }
    req.scanSub = sub;
    next();
  });
  router.param('jobId', async (req: JobRequest, res: Response, next: NextFunction, value: string) => {
    try {
      const jobId = requireUuid(value);
      const job = await getJob(deps.pool, req.scanSub as string, jobId);
      if (!job) { res.status(404).json({ error: 'job_not_found' }); return; }
      req.scanJob = job;
      next();
    } catch (error) {
      if (error instanceof RangeError) { res.status(400).json({ error: 'invalid_job_id' }); return; }
      logger.error({ err: error }, 'Job lookup failed');
      res.status(500).json({ error: 'job_lookup_failed' });
    }
  });

  router.get('/jobs', async (req: JobRequest, res: Response) => {
    try { res.json({ jobs: await listJobs(deps.pool, req.scanSub as string) }); } catch (error) { logger.error({ err: error }, 'List jobs failed'); res.status(500).json({ error: 'list_failed' }); }
  });

  router.post('/jobs', async (req: JobRequest, res: Response) => {
    const title = String((req.body ?? {}).title ?? '').trim().slice(0, 120);
    if (!title) { res.status(400).json({ error: 'title_required' }); return; }
    try {
      const job = await createJob(deps.pool, req.scanSub as string, title, 'photos');
      ensureDir(jobDir(deps.dataRoot, req.scanSub as string, job.job_id));
      res.status(201).json({ job });
    } catch (error) { logger.error({ err: error }, 'Create job failed'); res.status(500).json({ error: 'create_failed' }); }
  });

  router.get('/jobs/:jobId', async (req: JobRequest, res: Response) => {
    const job = req.scanJob as JobRow;
    try {
      const dir = jobDir(deps.dataRoot, req.scanSub as string, job.job_id);
      res.json({ job, images: await listImages(deps.pool, req.scanSub as string, job.job_id), artifacts: artifactPresence(dir), views: VIEW_NAMES });
    } catch (error) { logger.error({ err: error, jobId: job.job_id }, 'Job detail failed'); res.status(500).json({ error: 'detail_failed' }); }
  });

  router.patch('/jobs/:jobId', async (req: JobRequest, res: Response) => {
    const job = req.scanJob as JobRow;
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const patch: Parameters<typeof updateJob>[3] = {};
      if (body.title !== undefined) { const title = String(body.title).trim().slice(0, 120); if (!title) throw new RangeError('title cannot be empty'); patch.title = title; }
      if (body.knownDimensions !== undefined) patch.known_dimensions = parseKnownDimensions(body.knownDimensions);
      if (body.settings !== undefined) patch.settings = parseSettings(body.settings);
      res.json({ job: await updateJob(deps.pool, req.scanSub as string, job.job_id, patch) });
    } catch (error) {
      if (error instanceof RangeError) { res.status(400).json({ error: 'invalid_patch', message: error.message }); return; }
      logger.error({ err: error, jobId: job.job_id }, 'Patch job failed'); res.status(500).json({ error: 'patch_failed' });
    }
  });

  router.delete('/jobs/:jobId', async (req: JobRequest, res: Response) => {
    const job = req.scanJob as JobRow;
    try {
      await deleteJob(deps.pool, req.scanSub as string, job.job_id);
      fs.rmSync(jobDir(deps.dataRoot, req.scanSub as string, job.job_id), { recursive: true, force: true });
      res.json({ deleted: true });
    } catch (error) { logger.error({ err: error, jobId: job.job_id }, 'Delete job failed'); res.status(500).json({ error: 'delete_failed' }); }
  });

  router.post('/jobs/:jobId/images', memoryUpload.array('images', UPLOAD_LIMITS.imagesPerRequest), async (req: JobRequest, res: Response) => {
    const job = req.scanJob as JobRow;
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) { res.status(400).json({ error: 'no_images' }); return; }
    try {
      const existing = await listImages(deps.pool, req.scanSub as string, job.job_id);
      if (existing.length + files.length > UPLOAD_LIMITS.imagesPerJob) { res.status(409).json({ error: 'too_many_images', limit: UPLOAD_LIMITS.imagesPerJob }); return; }
      const dir = jobDir(deps.dataRoot, req.scanSub as string, job.job_id);
      const images: ImageRow[] = [];
      for (const file of files) images.push(await ingestImage(deps, req.scanSub as string, job.job_id, dir, file.originalname.slice(0, 200), file.buffer));
      await updateJob(deps.pool, req.scanSub as string, job.job_id, { state: 'capturing' });
      res.status(201).json({ images });
    } catch (error) {
      logger.error({ err: error, jobId: job.job_id }, 'Image ingest failed');
      res.status(422).json({ error: 'image_ingest_failed', message: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/jobs/:jobId/video', diskUpload(UPLOAD_LIMITS.videoBytes).single('video'), async (req: JobRequest, res: Response) => {
    const job = req.scanJob as JobRow;
    const file = req.file;
    if (!file) { res.status(400).json({ error: 'no_video' }); return; }
    const dir = jobDir(deps.dataRoot, req.scanSub as string, job.job_id);
    try {
      const existing = await listImages(deps.pool, req.scanSub as string, job.job_id);
      const config = resolveFfmpeg(deps.env);
      const room = UPLOAD_LIMITS.imagesPerJob - existing.length;
      if (room <= 0) { res.status(409).json({ error: 'too_many_images', limit: UPLOAD_LIMITS.imagesPerJob }); return; }
      const frames = await extractFrames(file.path, path.join(dir, 'frames', randomUUID()), { ...config, maxFrames: Math.min(config.maxFrames, room) }, deps.execFile);
      const images: ImageRow[] = [];
      for (const frame of frames) images.push(await ingestImage(deps, req.scanSub as string, job.job_id, dir, path.basename(frame), fs.readFileSync(frame)));
      await updateJob(deps.pool, req.scanSub as string, job.job_id, { state: 'capturing', source_kind: 'video' });
      res.status(201).json({ images, frames: frames.length });
    } catch (error) {
      logger.error({ err: error, jobId: job.job_id }, 'Video ingest failed');
      res.status(422).json({ error: 'video_ingest_failed', message: error instanceof Error ? error.message : String(error) });
    } finally {
      fs.rmSync(file.path, { force: true });
    }
  });

  router.patch('/jobs/:jobId/images/:imageId', async (req: JobRequest, res: Response) => {
    const job = req.scanJob as JobRow;
    const view = (req.body ?? {}).view;
    if (view !== null && !isViewName(view)) { res.status(400).json({ error: 'invalid_view', views: VIEW_NAMES }); return; }
    try {
      const image = await assignView(deps.pool, req.scanSub as string, job.job_id, requireUuid(req.params.imageId), view);
      if (!image) { res.status(404).json({ error: 'image_not_found' }); return; }
      res.json({ image });
    } catch (error) {
      if (error instanceof RangeError) { res.status(400).json({ error: 'invalid_image_id' }); return; }
      logger.error({ err: error, jobId: job.job_id }, 'Assign view failed'); res.status(500).json({ error: 'assign_failed' });
    }
  });

  router.delete('/jobs/:jobId/images/:imageId', async (req: JobRequest, res: Response) => {
    const job = req.scanJob as JobRow;
    try {
      const imageId = requireUuid(req.params.imageId);
      const removed = await deleteImage(deps.pool, req.scanSub as string, job.job_id, imageId);
      if (!removed) { res.status(404).json({ error: 'image_not_found' }); return; }
      const dir = jobDir(deps.dataRoot, req.scanSub as string, job.job_id);
      fs.rmSync(imagePath(dir, imageId, 'source'), { force: true });
      fs.rmSync(imagePath(dir, imageId, 'mask'), { force: true });
      res.json({ deleted: true });
    } catch (error) {
      if (error instanceof RangeError) { res.status(400).json({ error: 'invalid_image_id' }); return; }
      logger.error({ err: error, jobId: job.job_id }, 'Delete image failed'); res.status(500).json({ error: 'delete_failed' });
    }
  });

  router.get('/jobs/:jobId/images/:imageId/file', async (req: JobRequest, res: Response) => {
    const job = req.scanJob as JobRow;
    try {
      const imageId = requireUuid(req.params.imageId);
      const kind = req.query.kind === 'mask' ? 'mask' : 'source';
      const images = await listImages(deps.pool, req.scanSub as string, job.job_id);
      if (!images.some((img) => img.image_id === imageId)) { res.status(404).json({ error: 'image_not_found' }); return; }
      const file = imagePath(jobDir(deps.dataRoot, req.scanSub as string, job.job_id), imageId, kind);
      if (!fs.existsSync(file)) { res.status(404).json({ error: 'file_not_found' }); return; }
      res.setHeader('Cache-Control', 'private, no-store');
      res.type('image/png').send(fs.readFileSync(file));
    } catch (error) {
      if (error instanceof RangeError) { res.status(400).json({ error: 'invalid_image_id' }); return; }
      logger.error({ err: error, jobId: job.job_id }, 'Image file failed'); res.status(500).json({ error: 'file_failed' });
    }
  });

  router.post('/jobs/:jobId/reconstruct', async (req: JobRequest, res: Response) => {
    const job = req.scanJob as JobRow;
    const sub = req.scanSub as string;
    const dir = jobDir(deps.dataRoot, sub, job.job_id);
    try {
      const settings = { ...parseSettings(job.settings), ...parseSettings(req.body) };
      const silhouettes = await loadSilhouettes(dir, await listImages(deps.pool, sub, job.job_id));
      if (silhouettes.length === 0) { res.status(409).json({ error: 'no_views_assigned', message: 'Assign at least one photo to a view (front, top, right …) before reconstructing.' }); return; }
      const known = parseKnownDimensions(job.known_dimensions);
      const started = Date.now();
      const result = reconstructFromSilhouettes(silhouettes, known, { ...settings, partName: job.title });
      const updated = await saveResult(deps, sub, job, dir, result, job.source_kind === 'video' ? 'video' : 'photos');
      res.json({ job: updated, report: result.report, durationMs: Date.now() - started });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof RangeError) {
        await updateJob(deps.pool, sub, job.job_id, { state: 'failed', failure_reason: message }).catch(() => null);
        res.status(422).json({ error: 'reconstruction_refused', message });
        return;
      }
      logger.error({ err: error, jobId: job.job_id }, 'Reconstruction failed');
      res.status(500).json({ error: 'reconstruction_failed' });
    }
  });

  router.post('/jobs/:jobId/pointcloud', diskUpload(UPLOAD_LIMITS.plyBytes).single('model'), async (req: JobRequest, res: Response) => {
    const job = req.scanJob as JobRow;
    const sub = req.scanSub as string;
    const file = req.file;
    if (!file) { res.status(400).json({ error: 'no_model' }); return; }
    const dir = jobDir(deps.dataRoot, sub, job.job_id);
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const voxelMm = Number(body.voxelMm ?? 1);
      const unitScale = Number(body.unitScale ?? 1);
      const up = body.up === 'y' ? 'y' : 'z';
      if (!(voxelMm > 0) || !(unitScale > 0)) throw new RangeError('voxelMm and unitScale must be positive numbers');
      const settings = { ...parseSettings(job.settings), ...parseSettings(body) };
      const cloud = parsePly(new Uint8Array(fs.readFileSync(file.path)));
      const vox = voxelizePointCloud(cloud, { voxelMm, unitScale, up });
      const fill = fillSolidFromSurface(vox.grid, 1);
      const warnings = fill.closed ? [] : ['The scanned surface did not close at this voxel size: the interior was NOT filled. Increase voxelMm or capture the missing side.'];
      const result = finishFromGrid(vox.grid, vox.sizeMm, {
        lane: 'pointcloud', viewsUsed: [], sources: { x: 'known', y: 'known', z: 'known' }, warnings,
        method: `Point cloud (${cloud.count} points, ${vox.pointCount} in grid), voxel ${voxelMm} mm, ${up === 'y' ? 'Y-up' : 'Z-up'} ×${unitScale}`,
      }, { ...settings, partName: job.title });
      const updated = await saveResult(deps, sub, job, dir, result, 'pointcloud');
      res.json({ job: updated, report: result.report, closed: fill.closed, interiorFilled: fill.interiorFilled });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof RangeError) { await updateJob(deps.pool, sub, job.job_id, { state: 'failed', failure_reason: message }).catch(() => null); res.status(422).json({ error: 'pointcloud_refused', message }); return; }
      logger.error({ err: error, jobId: job.job_id }, 'Point cloud lane failed'); res.status(500).json({ error: 'pointcloud_failed' });
    } finally {
      fs.rmSync(file.path, { force: true });
    }
  });

  router.get('/jobs/:jobId/artifacts/:key', (req: JobRequest, res: Response) => {
    const job = req.scanJob as JobRow;
    const key = req.params.key as ArtifactKey;
    if (!(key in ARTIFACT_FILES)) { res.status(400).json({ error: 'unknown_artifact', keys: Object.keys(ARTIFACT_FILES) }); return; }
    const file = artifactPath(jobDir(deps.dataRoot, req.scanSub as string, job.job_id), key);
    if (!fs.existsSync(file)) { res.status(404).json({ error: 'artifact_not_found' }); return; }
    const types: Record<ArtifactKey, string> = { stl: 'model/stl', obj: 'text/plain', svg: 'image/svg+xml', report: 'application/json', gcode: 'text/plain', contours: 'application/json' };
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.query.download !== undefined) res.setHeader('Content-Disposition', `attachment; filename="${job.title.replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 60) || 'part'}.${key === 'report' || key === 'contours' ? 'json' : key}"`);
    res.type(types[key]).send(fs.readFileSync(file));
  });

  return router;
}
