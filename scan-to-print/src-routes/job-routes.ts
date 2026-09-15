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
 * 2 | maintainer@emeraldcoastsystemsgroup.com | Retire old outputs before input changes or rebuilds, guard same-job operations, and expose only current artifacts.
 * 3 | maintainer@emeraldcoastsystemsgroup.com | Persist validated effective build settings so request overrides and later no-op comparisons describe the same output.
 * 4 | maintainer@emeraldcoastsystemsgroup.com | Bind multipart completion to the verified request context so post-upload freshness lookups retain current database and authorization identity.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | Persist the `contours` artifact on every reconstruction (the
 *                     |                             | front / top / right outlines in world mm — CAD Studio's bridge)
 *                     |                             | and serve it as JSON beside the other artifacts.
 * 6 | maintainer@emeraldcoastsystemsgroup.com | Retain verified upload identity and current-output guards when merging the CAD contour bridge.
 * 7 | maintainer@emeraldcoastsystemsgroup.com   | Expose `sealBase` on the point-cloud lane (BACKLOG B7) so a
 *                     |                             | one-sided phone LiDAR scan can close, and carry `sealedBase`
 *                     |                             | into the response and the report. The flag is parsed strictly —
 *                     |                             | an unrecognised spelling is refused, not read as false — because
 *                     |                             | silently declining to seal would report an assumed base as a
 *                     |                             | measured one.
 * 8 | maintainer@emeraldcoastsystemsgroup.com   | `POST /jobs/:id/depth` (BACKLOG B1/B8): a device range image (a
 *                     |                             | 16-bit PNG or float32 raw, plus the header that places it in the
 *                     |                             | world frame) refines the job's CURRENT photo hull in the same
 *                     |                             | request, so the report's lane reads `depth` and lists the
 *                     |                             | silhouette and the depth views. One range image per build, like
 *                     |                             | the point cloud; `source_kind` stays the hull's own source
 *                     |                             | (photos or video), which the migration's CHECK allows.
 *                     |                             | `GET /jobs/:id/frame-suggestions` (BACKLOG B12) ranks a video's
 *                     |                             | frames per unassigned view from the silhouette statistics already
 *                     |                             | stored at ingest; it only proposes, the person assigns.
 * 9 | maintainer@emeraldcoastsystemsgroup.com   | Orientation cube (BACKLOG B9): a photo upload reads the face
 *                     |                             | marker and assigns the view when exactly one known marker is
 *                     |                             | visible and no other photo already holds that view; anything
 *                     |                             | else stays for the person, and the image row keeps the reason.
 *                     |                             | Video frames are NOT auto-assigned: a turntable clip shows one
 *                     |                             | face marker, slightly turned, in several frames, and the first
 *                     |                             | would win by upload order rather than by being square-on.
 */

import { Router, type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AsyncResource } from 'node:async_hooks';
import { createChildLogger } from '@/shared/logger';
import { type JobRow, type ImageRow, type QueryablePool, assignView, createJob, deleteImage, deleteJob, getJob, listImages, listJobs, updateJob } from './job-store';
import { type ArtifactKey, ARTIFACT_FILES, artifactPath, ensureDir, imagePath, jobDir, requireUuid } from './data-dir';
import { type ExecFileLike, decodePng16, decodeToRaster, extractFrames, maskToPng, pngToMask, resolveFfmpeg } from './image-ingest';
import { extractSilhouette } from './engine/raster/silhouette';
import { type FaceMarkerScan, detectFaceMarkers } from './engine/raster/face-marker';
import { type ViewName, VIEW_NAMES, isViewName } from './engine/grid/views';
import { type KnownDimension, type ViewSilhouette } from './engine/grid/silhouette-carver';
import { fillSolidFromSurface, parsePly, voxelizePointCloud } from './engine/grid/point-cloud';
import { RECONSTRUCTION_LIMITS, type ReconstructionResult, exportArtifacts, finishFromGrid, reconstructFromSilhouettes, reconstructHullWithDepth } from './engine/pipeline';
import { type DepthMap } from './engine/grid/depth-carver';
import { DEPTH_UPLOAD_LIMITS, depthMapFromFloat32, depthMapFromUint16, parseDepthHeader } from './engine/grid/depth-decode';
import { type FrameSample, suggestSquareOnFrames } from './engine/grid/frame-suggest';
import { type JobRequest, artifactPresence, requireCurrentOutput, retireOutput, withCurrentJob } from './job-outputs';
import { exportContours } from './engine/drawing/contour-export';

const logger = createChildLogger({ module: 'scan-to-print-job-routes' });

/** @description Upload and count ceilings the surface pre-validates against. */
export const UPLOAD_LIMITS = Object.freeze({
  imageBytes: 25 * 1024 * 1024, imagesPerRequest: 12, imagesPerJob: 24, videoBytes: 300 * 1024 * 1024, plyBytes: 200 * 1024 * 1024,
  depthBytes: DEPTH_UPLOAD_LIMITS.maxPixels * 4,
});

/** @description The file names the frame extractor writes; only these form a video sequence. */
const VIDEO_FRAME_NAME = /^frame-(\d{3})\.png$/;

/** @description Candidate views for frame suggestion, the three a solid needs first. */
const SUGGESTION_ORDER: readonly ViewName[] = ['front', 'right', 'top', 'back', 'left', 'bottom'];

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

/** @description Compare canonical geometry settings; labels also appear in the drawing and report. */
function changesOutput(job: JobRow, patch: Parameters<typeof updateJob>[3]): boolean {
  const dimensions = (value: KnownDimension[]) => JSON.stringify([...value].sort((a, b) => a.axis.localeCompare(b.axis)));
  const settings = (value: unknown) => JSON.stringify({ resolution: RECONSTRUCTION_LIMITS.resolution.default,
    smoothIterations: RECONSTRUCTION_LIMITS.smoothIterations.default, ...parseSettings(value) });
  return patch.title !== undefined && patch.title !== job.title
    || patch.known_dimensions !== undefined && dimensions(patch.known_dimensions) !== dimensions(job.known_dimensions)
    || patch.settings !== undefined && settings(patch.settings) !== settings(job.settings);
}

/** @description Persist the exact validated settings used by this guarded build, including request overrides. */
async function persistBuildSettings(deps: JobRouteDeps, sub: string, job: JobRow, raw: unknown): Promise<{ resolution?: number; smoothIterations?: number }> {
  const settings = { ...parseSettings(job.settings), ...parseSettings(raw) };
  if (!await updateJob(deps.pool, sub, job.job_id, { settings })) throw new Error('Job disappeared before build settings were saved');
  return settings;
}

/**
 * @description Read an optional boolean flag from a multipart body, where every field arrives as a
 * string. An unrecognised spelling is refused rather than silently read as false: a caller who
 * wrote `sealBase=yes` asked for the seal and must not be told the base was measured.
 * @param raw - The body field.
 * @param label - Field name for the refusal message.
 * @returns The flag; `false` when absent.
 * @throws RangeError when the value is neither a boolean nor `true`/`false`/`1`/`0`.
 */
function readFlag(raw: unknown, label: string): boolean {
  if (raw === undefined || raw === null || raw === '') return false;
  if (typeof raw === 'boolean') return raw;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  throw new RangeError(`${label} must be true or false`);
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
  if (!updated) throw new Error('Job disappeared before reconstruction publication');
  return updated;
}

/** @description What a marker read decided for one photo, as stored on its row. */
interface MarkerDecision {
  /** The view to assign, or null. */
  view: ViewName | null;
  /** The engine scan, summarised for the row. */
  summary: { view: ViewName | null; reason: string; unknown: number; found: Array<{ view: ViewName; rotationDeg: number; bitErrors: number }> };
}

/** @description Decide a photo's view from its face marker; a view another photo already holds is left to the person. */
function decideMarker(scan: FaceMarkerScan, taken: Set<ViewName>): MarkerDecision {
  const view = scan.view && !taken.has(scan.view) ? scan.view : null;
  const reason = scan.view && !view ? `The ${scan.view} face marker is visible, but another photo already holds the ${scan.view} view; assign this photo's view by hand.` : scan.reason;
  return { view, summary: { view, reason, unknown: scan.unknown, found: scan.markers.map((m) => ({ view: m.view, rotationDeg: m.rotationDeg, bitErrors: m.bitErrors })) } };
}

/**
 * @description Ingest one decoded photo: silhouette, files, row. With `markers`, the photo's
 * orientation-cube marker is read too, and a decided view is assigned and added to `taken`.
 */
async function ingestImage(deps: JobRouteDeps, sub: string, jobId: string, dir: string, fileName: string, bytes: Buffer, markers?: { taken: Set<ViewName> }): Promise<ImageRow> {
  const { raster, png } = await decodeToRaster(bytes);
  const silhouette = extractSilhouette(raster);
  const decision = markers ? decideMarker(detectFaceMarkers(raster), markers.taken) : null;
  const imageId = randomUUID();
  ensureDir(path.join(dir, 'images'));
  ensureDir(path.join(dir, 'masks'));
  fs.writeFileSync(imagePath(dir, imageId, 'source'), png);
  fs.writeFileSync(imagePath(dir, imageId, 'mask'), await maskToPng(silhouette.mask));
  const stored = { threshold: silhouette.threshold, background: silhouette.background, stats: silhouette.stats, warnings: silhouette.warnings, ...(decision ? { marker: decision.summary } : {}) };
  const row = await deps.pool.query(
    'INSERT INTO scan_print_image (image_id, owner_sub, job_id, file_name, width, height, silhouette) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb) RETURNING image_id, job_id, file_name, view, width, height, silhouette, created_at',
    [imageId, sub, jobId, fileName, raster.width, raster.height, JSON.stringify(stored)],
  );
  const inserted = row.rows[0] as ImageRow;
  if (!decision?.view || !markers) return inserted;
  const assigned = await assignView(deps.pool, sub, jobId, imageId, decision.view);
  markers.taken.add(decision.view);
  return assigned ?? inserted;
}

/** @description Load the assigned views' masks from disk. */
async function loadSilhouettes(dir: string, images: ImageRow[]): Promise<ViewSilhouette[]> {
  const assigned = images.filter((img) => img.view !== null);
  return Promise.all(assigned.map(async (img) => ({ view: img.view as ViewName, mask: await pngToMask(fs.readFileSync(imagePath(dir, img.image_id, 'mask'))) })));
}

/** @description Preserve the verified async context, including errors, across multipart completion. */
function preserveUploadContext(upload: RequestHandler): RequestHandler {
  return (req, res, next) => upload(req, res, AsyncResource.bind(next));
}

/** @description Bound file uploads before entering the guarded job operation. */
function diskUpload(deps: JobRouteDeps, limit: number) {
  return multer({
    storage: multer.diskStorage({
      destination: (req, _file, cb) => {
        const r = req as JobRequest;
        try { cb(null, ensureDir(path.join(jobDir(deps.dataRoot, r.scanSub as string, String(r.params.jobId)), 'uploads'))); } catch (error) { cb(error as Error, ''); }
      },
      filename: (_req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '').slice(0, 12)}`),
    }),
    limits: { fileSize: limit, files: 1 },
  });
}

/** @description Register guards routes with their existing owner and response contracts. */
function registerGuards(router: Router, deps: JobRouteDeps): void {
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
}

/** @description Register collection routes with their existing owner and response contracts. */
function registerCollection(router: Router, deps: JobRouteDeps): void {
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
}

/** @description Register detail routes with their existing owner and response contracts. */
function registerDetail(router: Router, deps: JobRouteDeps): void {
  router.get('/jobs/:jobId', withCurrentJob(deps, async (req: JobRequest, res: Response) => {
    const job = req.scanJob as JobRow;
    try {
      const dir = jobDir(deps.dataRoot, req.scanSub as string, job.job_id);
      res.json({ job, images: await listImages(deps.pool, req.scanSub as string, job.job_id), artifacts: artifactPresence(dir, job), views: VIEW_NAMES });
    } catch (error) { logger.error({ err: error, jobId: job.job_id }, 'Job detail failed'); res.status(500).json({ error: 'detail_failed' }); }
  }, 'read'));

  router.patch('/jobs/:jobId', withCurrentJob(deps, async (req: JobRequest, res: Response) => {
    const job = req.scanJob as JobRow;
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const patch: Parameters<typeof updateJob>[3] = {};
      if (body.title !== undefined) { const title = String(body.title).trim().slice(0, 120); if (!title) throw new RangeError('title cannot be empty'); patch.title = title; }
      if (body.knownDimensions !== undefined) patch.known_dimensions = parseKnownDimensions(body.knownDimensions);
      if (body.settings !== undefined) patch.settings = parseSettings(body.settings);
      if (changesOutput(job, patch)) await retireOutput(deps, req.scanSub as string, job);
      res.json({ job: await updateJob(deps.pool, req.scanSub as string, job.job_id, patch) });
    } catch (error) {
      if (error instanceof RangeError) { res.status(400).json({ error: 'invalid_patch', message: error.message }); return; }
      logger.error({ err: error, jobId: job.job_id }, 'Patch job failed'); res.status(500).json({ error: 'patch_failed' });
    }
  }));

  router.delete('/jobs/:jobId', withCurrentJob(deps, async (req: JobRequest, res: Response) => {
    const job = req.scanJob as JobRow;
    try {
      await deleteJob(deps.pool, req.scanSub as string, job.job_id);
      fs.rmSync(jobDir(deps.dataRoot, req.scanSub as string, job.job_id), { recursive: true, force: true });
      res.json({ deleted: true });
    } catch (error) { logger.error({ err: error, jobId: job.job_id }, 'Delete job failed'); res.status(500).json({ error: 'delete_failed' }); }
  }));
}

/** @description Register photos routes with their existing owner and response contracts. */
function registerPhotos(router: Router, deps: JobRouteDeps): void {
  const memoryUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: UPLOAD_LIMITS.imageBytes, files: UPLOAD_LIMITS.imagesPerRequest } });

  router.post('/jobs/:jobId/images', preserveUploadContext(memoryUpload.array('images', UPLOAD_LIMITS.imagesPerRequest)), withCurrentJob(deps, async (req: JobRequest, res: Response) => {
    const job = req.scanJob as JobRow;
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) { res.status(400).json({ error: 'no_images' }); return; }
    try {
      const existing = await listImages(deps.pool, req.scanSub as string, job.job_id);
      if (existing.length + files.length > UPLOAD_LIMITS.imagesPerJob) { res.status(409).json({ error: 'too_many_images', limit: UPLOAD_LIMITS.imagesPerJob }); return; }
      await retireOutput(deps, req.scanSub as string, job);
      const dir = jobDir(deps.dataRoot, req.scanSub as string, job.job_id);
      const taken = new Set(existing.map((img) => img.view).filter((v): v is ViewName => v !== null));
      const images: ImageRow[] = [];
      for (const file of files) images.push(await ingestImage(deps, req.scanSub as string, job.job_id, dir, file.originalname.slice(0, 200), file.buffer, { taken }));
      await updateJob(deps.pool, req.scanSub as string, job.job_id, { state: 'capturing' });
      res.status(201).json({ images, viewsFromMarkers: images.filter((img) => img.view !== null).length });
    } catch (error) {
      logger.error({ err: error, jobId: job.job_id }, 'Image ingest failed');
      res.status(422).json({ error: 'image_ingest_failed', message: error instanceof Error ? error.message : String(error) });
    }
  }));
}

/** @description Register video routes with their existing owner and response contracts. */
function registerVideo(router: Router, deps: JobRouteDeps): void {
  router.post('/jobs/:jobId/video', preserveUploadContext(diskUpload(deps, UPLOAD_LIMITS.videoBytes).single('video')), withCurrentJob(deps, async (req: JobRequest, res: Response) => {
    const job = req.scanJob as JobRow;
    const file = req.file;
    if (!file) { res.status(400).json({ error: 'no_video' }); return; }
    const dir = jobDir(deps.dataRoot, req.scanSub as string, job.job_id);
    try {
      const existing = await listImages(deps.pool, req.scanSub as string, job.job_id);
      const config = resolveFfmpeg(deps.env);
      const room = UPLOAD_LIMITS.imagesPerJob - existing.length;
      if (room <= 0) { res.status(409).json({ error: 'too_many_images', limit: UPLOAD_LIMITS.imagesPerJob }); return; }
      await retireOutput(deps, req.scanSub as string, job);
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
  }));
}

/** @description Register imagemutations routes with their existing owner and response contracts. */
function registerImageMutations(router: Router, deps: JobRouteDeps): void {
  router.patch('/jobs/:jobId/images/:imageId', withCurrentJob(deps, async (req: JobRequest, res: Response) => {
    const job = req.scanJob as JobRow;
    const view = (req.body ?? {}).view;
    if (view !== null && !isViewName(view)) { res.status(400).json({ error: 'invalid_view', views: VIEW_NAMES }); return; }
    try {
      const imageId = requireUuid(req.params.imageId);
      const original = (await listImages(deps.pool, req.scanSub as string, job.job_id)).find(image => image.image_id === imageId);
      if (!original) { res.status(404).json({ error: 'image_not_found' }); return; }
      if (original.view !== view) await retireOutput(deps, req.scanSub as string, job);
      const image = await assignView(deps.pool, req.scanSub as string, job.job_id, imageId, view);
      if (!image) { res.status(404).json({ error: 'image_not_found' }); return; }
      res.json({ image });
    } catch (error) {
      if (error instanceof RangeError) { res.status(400).json({ error: 'invalid_image_id' }); return; }
      logger.error({ err: error, jobId: job.job_id }, 'Assign view failed'); res.status(500).json({ error: 'assign_failed' });
    }
  }));

  router.delete('/jobs/:jobId/images/:imageId', withCurrentJob(deps, async (req: JobRequest, res: Response) => {
    const job = req.scanJob as JobRow;
    try {
      const imageId = requireUuid(req.params.imageId);
      const exists = (await listImages(deps.pool, req.scanSub as string, job.job_id)).some(image => image.image_id === imageId);
      if (!exists) { res.status(404).json({ error: 'image_not_found' }); return; }
      await retireOutput(deps, req.scanSub as string, job);
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
  }));
}

/** @description Register imageread routes with their existing owner and response contracts. */
function registerImageRead(router: Router, deps: JobRouteDeps): void {
  router.get('/jobs/:jobId/images/:imageId/file', withCurrentJob(deps, async (req: JobRequest, res: Response) => {
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
  }, 'read'));
}

/** @description Register reconstruction routes with their existing owner and response contracts. */
function registerReconstruction(router: Router, deps: JobRouteDeps): void {
  router.post('/jobs/:jobId/reconstruct', withCurrentJob(deps, async (req: JobRequest, res: Response) => {
    const job = req.scanJob as JobRow;
    const sub = req.scanSub as string;
    const dir = jobDir(deps.dataRoot, sub, job.job_id);
    try {
      await retireOutput(deps, sub, job);
      const settings = await persistBuildSettings(deps, sub, job, req.body);
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
        await updateJob(deps.pool, sub, job.job_id, { state: 'failed', report: null, failure_reason: message }).catch(() => null);
        res.status(422).json({ error: 'reconstruction_refused', message });
        return;
      }
      logger.error({ err: error, jobId: job.job_id }, 'Reconstruction failed');
      await updateJob(deps.pool, sub, job.job_id, { state: 'failed', report: null, failure_reason: 'Reconstruction failed. Reconstruct before using outputs.' }).catch(() => null);
      res.status(500).json({ error: 'reconstruction_failed' });
    }
  }));
}

/** @description Register pointcloud routes with their existing owner and response contracts. */
function registerPointCloud(router: Router, deps: JobRouteDeps): void {
  router.post('/jobs/:jobId/pointcloud', preserveUploadContext(diskUpload(deps, UPLOAD_LIMITS.plyBytes).single('model')), withCurrentJob(deps, async (req: JobRequest, res: Response) => {
    const job = req.scanJob as JobRow;
    const sub = req.scanSub as string;
    const file = req.file;
    if (!file) { res.status(400).json({ error: 'no_model' }); return; }
    const dir = jobDir(deps.dataRoot, sub, job.job_id);
    try {
      await retireOutput(deps, sub, job);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const voxelMm = Number(body.voxelMm ?? 1);
      const unitScale = Number(body.unitScale ?? 1);
      const up = body.up === 'y' ? 'y' : 'z';
      const sealBase = readFlag(body.sealBase, 'sealBase');
      if (!(voxelMm > 0) || !(unitScale > 0)) throw new RangeError('voxelMm and unitScale must be positive numbers');
      const settings = await persistBuildSettings(deps, sub, job, body);
      const cloud = parsePly(new Uint8Array(fs.readFileSync(file.path)));
      const vox = voxelizePointCloud(cloud, { voxelMm, unitScale, up });
      const fill = fillSolidFromSurface(vox.grid, 1, { sealBase });
      const warnings = fill.closed ? [] : ['The scanned surface did not close at this voxel size: the interior was NOT filled. Increase voxelMm or capture the missing side.'];
      const result = finishFromGrid(vox.grid, vox.sizeMm, {
        lane: 'pointcloud', viewsUsed: [], sources: { x: 'known', y: 'known', z: 'known' }, warnings, sealedBase: fill.sealedBase,
        method: `Point cloud (${cloud.count} points, ${vox.pointCount} in grid), voxel ${voxelMm} mm, ${up === 'y' ? 'Y-up' : 'Z-up'} ×${unitScale}${fill.sealedBase ? ', base sealed' : ''}`,
      }, { ...settings, partName: job.title });
      const updated = await saveResult(deps, sub, job, dir, result, 'pointcloud');
      res.json({ job: updated, report: result.report, closed: fill.closed, interiorFilled: fill.interiorFilled, sealedBase: fill.sealedBase });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof RangeError) { await updateJob(deps.pool, sub, job.job_id, { state: 'failed', report: null, failure_reason: message }).catch(() => null); res.status(422).json({ error: 'pointcloud_refused', message }); return; }
      await updateJob(deps.pool, sub, job.job_id, { state: 'failed', report: null, failure_reason: 'Point cloud reconstruction failed. Reconstruct before using outputs.' }).catch(() => null);
      logger.error({ err: error, jobId: job.job_id }, 'Point cloud lane failed'); res.status(500).json({ error: 'pointcloud_failed' });
    } finally {
      fs.rmSync(file.path, { force: true });
    }
  }));
}

/** @description Register artifacts routes with their existing owner and response contracts. */
function registerArtifacts(router: Router, deps: JobRouteDeps): void {
  router.get('/jobs/:jobId/artifacts/:key', withCurrentJob(deps, (req: JobRequest, res: Response) => {
    const job = req.scanJob as JobRow;
    const key = req.params.key as ArtifactKey;
    if (!(key in ARTIFACT_FILES)) { res.status(400).json({ error: 'unknown_artifact', keys: Object.keys(ARTIFACT_FILES) }); return; }
    if (!requireCurrentOutput(job, res, key === 'gcode')) return;
    const file = artifactPath(jobDir(deps.dataRoot, req.scanSub as string, job.job_id), key);
    if (!fs.existsSync(file)) { res.status(404).json({ error: 'artifact_not_found' }); return; }
    const types: Record<ArtifactKey, string> = { stl: 'model/stl', obj: 'text/plain', svg: 'image/svg+xml', report: 'application/json', gcode: 'text/plain', contours: 'application/json' };
    res.setHeader('Cache-Control', 'private, no-store');
    if (req.query.download !== undefined) res.setHeader('Content-Disposition', `attachment; filename="${job.title.replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 60) || 'part'}.${key === 'report' || key === 'contours' ? 'json' : key}"`);
    res.type(types[key]).send(fs.readFileSync(file));
  }, 'read'));
}

/** @description Decode an uploaded range image per its declared format into a map in the world frame. */
async function decodeDepthUpload(bytes: Buffer, body: Record<string, unknown>): Promise<DepthMap> {
  if (body.format === 'png16') {
    const png = await decodePng16(bytes);
    return depthMapFromUint16(png.values, parseDepthHeader(body, { width: png.width, height: png.height }));
  }
  return depthMapFromFloat32(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), parseDepthHeader(body));
}

/** @description Register the depth route: one range image refines the job's current photo hull. */
function registerDepth(router: Router, deps: JobRouteDeps): void {
  router.post('/jobs/:jobId/depth', preserveUploadContext(diskUpload(deps, UPLOAD_LIMITS.depthBytes).single('depth')), withCurrentJob(deps, async (req: JobRequest, res: Response) => {
    const job = req.scanJob as JobRow;
    const sub = req.scanSub as string;
    const file = req.file;
    if (!file) { res.status(400).json({ error: 'no_depth' }); return; }
    const dir = jobDir(deps.dataRoot, sub, job.job_id);
    try {
      await retireOutput(deps, sub, job);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const map = await decodeDepthUpload(fs.readFileSync(file.path), body);
      const settings = await persistBuildSettings(deps, sub, job, body);
      const silhouettes = await loadSilhouettes(dir, await listImages(deps.pool, sub, job.job_id));
      if (silhouettes.length === 0) { res.status(409).json({ error: 'no_views_assigned', message: 'A range image refines the photo hull: assign at least one photo to a view first.' }); return; }
      const started = Date.now();
      const result = reconstructHullWithDepth(silhouettes, parseKnownDimensions(job.known_dimensions), [map], { ...settings, partName: job.title });
      const updated = await saveResult(deps, sub, job, dir, result, job.source_kind === 'video' ? 'video' : 'photos');
      res.json({ job: updated, report: result.report, durationMs: Date.now() - started });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (error instanceof RangeError) { await updateJob(deps.pool, sub, job.job_id, { state: 'failed', report: null, failure_reason: message }).catch(() => null); res.status(422).json({ error: 'depth_refused', message }); return; }
      await updateJob(deps.pool, sub, job.job_id, { state: 'failed', report: null, failure_reason: 'Depth reconstruction failed. Reconstruct before using outputs.' }).catch(() => null);
      logger.error({ err: error, jobId: job.job_id }, 'Depth lane failed'); res.status(500).json({ error: 'depth_failed' });
    } finally {
      fs.rmSync(file.path, { force: true });
    }
  }));
}

/**
 * @description The job's video frames as one sample per frame, in capture order. A new clip starts
 * wherever the extractor's frame number stops increasing, and neighbours never cross a clip.
 */
function videoFrameSamples(images: ImageRow[]): FrameSample[] {
  const frames = images.filter((img) => VIDEO_FRAME_NAME.test(img.file_name));
  let clip = 0;
  let previous = Infinity;
  return frames.map((img) => {
    const number = Number((VIDEO_FRAME_NAME.exec(img.file_name) as RegExpExecArray)[1]);
    if (number <= previous && previous !== Infinity) clip += 1;
    previous = number;
    const stats = ((img.silhouette ?? {}) as { stats?: { pixels?: number; bbox?: FrameSample['bbox'] } }).stats ?? {};
    return { id: img.image_id, pixels: Number.isInteger(stats.pixels) ? stats.pixels as number : 0, bbox: stats.bbox ?? null, sequence: clip };
  });
}

/** @description Register the frame-suggestion route: proposals for each view not yet assigned. */
function registerFrameSuggestions(router: Router, deps: JobRouteDeps): void {
  router.get('/jobs/:jobId/frame-suggestions', withCurrentJob(deps, async (req: JobRequest, res: Response) => {
    const job = req.scanJob as JobRow;
    try {
      const images = await listImages(deps.pool, req.scanSub as string, job.job_id);
      const frames = videoFrameSamples(images);
      if (frames.length === 0) { res.status(409).json({ error: 'no_video_frames', message: 'Upload a video first: suggestions rank its frames.' }); return; }
      const assigned = images.filter((img) => img.view !== null);
      const views = SUGGESTION_ORDER.filter((view) => !assigned.some((img) => img.view === view));
      const known = Array.isArray(job.known_dimensions) && job.known_dimensions.length > 0 ? parseKnownDimensions(job.known_dimensions) : [];
      const names = new Map(images.map((img) => [img.image_id, img.file_name] as const));
      const out = views.length === 0 ? [] : suggestSquareOnFrames(frames, [...views], known, { exclude: assigned.map((img) => img.image_id) });
      res.json({
        frames: frames.length,
        suggestions: out.filter((s) => s.best).map((s) => ({ view: s.view, imageId: s.best?.id, fileName: names.get(s.best?.id as string), score: s.best?.score, skew: s.best?.skew, turn: s.best?.turn })),
        unmatched: out.filter((s) => !s.best).map((s) => s.view),
        proportionsKnown: known.length,
      });
    } catch (error) {
      logger.error({ err: error, jobId: job.job_id }, 'Frame suggestion failed'); res.status(500).json({ error: 'suggestion_failed' });
    }
  }, 'read'));
}

/** @description Compose bounded handlers; all same-job writes and output reads share the single-API guard. */
export function createJobRoutes(deps: JobRouteDeps): Router {
  const router = Router();
  registerGuards(router, deps);
  registerCollection(router, deps);
  registerDetail(router, deps);
  registerPhotos(router, deps);
  registerVideo(router, deps);
  registerImageMutations(router, deps);
  registerImageRead(router, deps);
  registerReconstruction(router, deps);
  registerPointCloud(router, deps);
  registerDepth(router, deps);
  registerFrameSuggestions(router, deps);
  registerArtifacts(router, deps);
  return router;
}
