/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com   | Interactive 3D mesh editing routes for reconstructed jobs: bounding-box crop (RP-SCN-01), build-plate rotation / lay-flat leveling (RP-SCN-02), and persisted Undo / Reset snapshots.
 */

import { Router, type NextFunction, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { createChildLogger } from '@/shared/logger';
import { type JobRow, updateJob } from './job-store';
import { artifactPath, ensureDir, jobDir } from './data-dir';
import { type JobRequest, requireCurrentOutput, withCurrentJob } from './job-outputs';
import type { JobRouteDeps } from './job-routes';
import { DOWNLOAD_LIMIT_BYTES } from './artifact-budget';
import { fromStl } from './engine/geometry/parse-stl';
import { toStlBinary } from './engine/geometry/export-stl';
import { toObj } from './engine/geometry/export-obj';
import { meshBounds, meshSurfaceArea, meshVolume } from './engine/geometry/mesh-metrics';
import { validateMesh } from './engine/geometry/mesh-validate';
import { type CropBounds, type LayFlatPreset, cropMesh, transformMesh } from './engine/geometry/mesh-ops';
import type { TriMesh } from './engine/geometry/geometry-types';

const logger = createChildLogger({ module: 'scan-to-print-mesh-edit' });

function snapshotPath(dir: string, file: string): string {
  return path.join(dir, 'artifacts', file);
}

function readMeshState(dir: string, job: JobRow): Record<string, unknown> {
  const stlFile = artifactPath(dir, 'stl');
  const mesh = fromStl(new Uint8Array(fs.readFileSync(stlFile)));
  const bounds = meshBounds(mesh);
  return {
    jobId: job.job_id,
    bounds,
    vertexCount: mesh.vertices.length,
    triangleCount: mesh.triangles.length,
    canUndo: fs.existsSync(snapshotPath(dir, 'mesh-undo.stl')),
    canReset: fs.existsSync(snapshotPath(dir, 'mesh-original.stl')),
  };
}

function backupBeforeEdit(dir: string, job: JobRow): void {
  const stlFile = artifactPath(dir, 'stl');
  const origStl = snapshotPath(dir, 'mesh-original.stl');
  const origRep = snapshotPath(dir, 'report-original.json');
  const undoStl = snapshotPath(dir, 'mesh-undo.stl');
  const undoRep = snapshotPath(dir, 'report-undo.json');
  const reportText = JSON.stringify(job.report ?? {}, null, 2);
  if (!fs.existsSync(origStl)) {
    fs.copyFileSync(stlFile, origStl);
    fs.writeFileSync(origRep, reportText);
  }
  fs.copyFileSync(stlFile, undoStl);
  fs.writeFileSync(undoRep, reportText);
}

async function persistEditedMesh(
  deps: JobRouteDeps,
  sub: string,
  job: JobRow,
  dir: string,
  mesh: TriMesh,
  note: string,
): Promise<{ job: JobRow; report: Record<string, unknown> }> {
  const stlBytes = Buffer.from(toStlBinary(mesh));
  if (stlBytes.byteLength > DOWNLOAD_LIMIT_BYTES) {
    throw new RangeError('Edited mesh exceeds the single-download size ceiling.');
  }
  ensureDir(path.join(dir, 'artifacts'));
  fs.writeFileSync(artifactPath(dir, 'stl'), stlBytes);
  const objText = toObj(mesh, job.title || 'oshal_part');
  if (Buffer.byteLength(objText) <= DOWNLOAD_LIMIT_BYTES) {
    fs.writeFileSync(artifactPath(dir, 'obj'), zlib.gzipSync(Buffer.from(objText, 'utf8')));
  } else {
    fs.rmSync(artifactPath(dir, 'obj'), { force: true });
  }
  fs.rmSync(artifactPath(dir, 'gcode'), { force: true });

  const bounds = meshBounds(mesh);
  const validation = validateMesh(mesh);
  const surfaceAreaMm2 = meshSurfaceArea(mesh);
  const volumeMm3 = validation.watertight ? Math.max(0, meshVolume(mesh)) : Math.max(0, Math.abs(meshVolume(mesh)));
  const prev = (job.report ?? {}) as Record<string, unknown>;
  const prevNotes = Array.isArray(prev.editHistory) ? (prev.editHistory as string[]).slice(-9) : [];
  const nextReport: Record<string, unknown> = {
    ...prev,
    sizeMm: bounds.size,
    bounds,
    vertexCount: mesh.vertices.length,
    triangleCount: mesh.triangles.length,
    surfaceAreaMm2,
    volumeMm3,
    meshValidation: validation,
    printable: validation.watertight || Boolean(prev.printable),
    editHistory: [...prevNotes, note],
  };
  fs.writeFileSync(artifactPath(dir, 'report'), JSON.stringify(nextReport, null, 2));
  const updated = await updateJob(deps.pool, sub, job.job_id, {
    state: 'reconstructed',
    report: nextReport,
    failure_reason: null,
  });
  if (!updated) throw new Error('Job disappeared while saving mesh edit');
  return { job: updated, report: nextReport };
}

async function restoreSnapshot(
  deps: JobRouteDeps,
  sub: string,
  job: JobRow,
  dir: string,
  stlSnap: string,
  repSnap: string,
  clearAll: boolean,
): Promise<{ job: JobRow; report: Record<string, unknown> }> {
  const stlBytes = fs.readFileSync(stlSnap);
  const mesh = fromStl(new Uint8Array(stlBytes));
  fs.writeFileSync(artifactPath(dir, 'stl'), stlBytes);
  const objText = toObj(mesh, job.title || 'oshal_part');
  if (Buffer.byteLength(objText) <= DOWNLOAD_LIMIT_BYTES) {
    fs.writeFileSync(artifactPath(dir, 'obj'), zlib.gzipSync(Buffer.from(objText, 'utf8')));
  }
  fs.rmSync(artifactPath(dir, 'gcode'), { force: true });
  const restoredReport = fs.existsSync(repSnap)
    ? (JSON.parse(fs.readFileSync(repSnap, 'utf8')) as Record<string, unknown>)
    : ((job.report ?? {}) as Record<string, unknown>);
  fs.writeFileSync(artifactPath(dir, 'report'), JSON.stringify(restoredReport, null, 2));
  fs.rmSync(snapshotPath(dir, 'mesh-undo.stl'), { force: true });
  fs.rmSync(snapshotPath(dir, 'report-undo.json'), { force: true });
  if (clearAll) {
    fs.rmSync(snapshotPath(dir, 'mesh-original.stl'), { force: true });
    fs.rmSync(snapshotPath(dir, 'report-original.json'), { force: true });
  }
  const updated = await updateJob(deps.pool, sub, job.job_id, {
    state: 'reconstructed',
    report: restoredReport,
    failure_reason: null,
  });
  if (!updated) throw new Error('Job disappeared while restoring mesh snapshot');
  return { job: updated, report: restoredReport };
}

function parseCropBody(raw: unknown): { bounds: CropBounds; snapToBed: boolean } {
  const body = (raw ?? {}) as Record<string, unknown>;
  const src = (body.bounds && typeof body.bounds === 'object' ? body.bounds : body) as Record<string, unknown>;
  return {
    bounds: {
      minX: Number(src.minX),
      maxX: Number(src.maxX),
      minY: Number(src.minY),
      maxY: Number(src.maxY),
      minZ: Number(src.minZ),
      maxZ: Number(src.maxZ),
    },
    snapToBed: body.snapToBed === true,
  };
}

async function handleCropRequest(deps: JobRouteDeps, req: JobRequest, res: Response): Promise<void> {
  const job = req.scanJob as JobRow;
  const sub = req.scanSub as string;
  if (!requireCurrentOutput(job, res, false)) return;
  const dir = jobDir(deps.dataRoot, sub, job.job_id);
  const stlFile = artifactPath(dir, 'stl');
  if (!fs.existsSync(stlFile)) { res.status(404).json({ error: 'artifact_not_found' }); return; }
  try {
    const { bounds, snapToBed } = parseCropBody(req.body);
    const current = fromStl(new Uint8Array(fs.readFileSync(stlFile)));
    const cropped = cropMesh(current, bounds, snapToBed);
    backupBeforeEdit(dir, job);
    const saved = await persistEditedMesh(deps, sub, job, dir, cropped, 'crop');
    res.json({ ...saved, meshState: readMeshState(dir, saved.job) });
  } catch (error) {
    if (error instanceof RangeError) { res.status(422).json({ error: 'crop_refused', message: error.message }); return; }
    logger.error({ err: error, jobId: job.job_id }, 'Mesh crop failed');
    res.status(500).json({ error: 'crop_failed', message: 'Could not crop this model.' });
  }
}

async function handleTransformRequest(deps: JobRouteDeps, req: JobRequest, res: Response): Promise<void> {
  const job = req.scanJob as JobRow;
  const sub = req.scanSub as string;
  if (!requireCurrentOutput(job, res, false)) return;
  const dir = jobDir(deps.dataRoot, sub, job.job_id);
  const stlFile = artifactPath(dir, 'stl');
  if (!fs.existsSync(stlFile)) { res.status(404).json({ error: 'artifact_not_found' }); return; }
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const spec = {
      layFlat: body.layFlat === undefined || body.layFlat === null || body.layFlat === '' ? undefined : String(body.layFlat) as LayFlatPreset,
      rxDeg: body.rxDeg === undefined ? 0 : Number(body.rxDeg),
      ryDeg: body.ryDeg === undefined ? 0 : Number(body.ryDeg),
      rzDeg: body.rzDeg === undefined ? 0 : Number(body.rzDeg),
      snapToBed: body.snapToBed !== false,
    };
    const current = fromStl(new Uint8Array(fs.readFileSync(stlFile)));
    const transformed = transformMesh(current, spec);
    backupBeforeEdit(dir, job);
    const saved = await persistEditedMesh(deps, sub, job, dir, transformed, spec.layFlat ? `layFlat:${spec.layFlat}` : 'rotate');
    res.json({ ...saved, meshState: readMeshState(dir, saved.job) });
  } catch (error) {
    if (error instanceof RangeError) { res.status(422).json({ error: 'transform_refused', message: error.message }); return; }
    logger.error({ err: error, jobId: job.job_id }, 'Mesh transform failed');
    res.status(500).json({ error: 'transform_failed', message: 'Could not rotate or level this model.' });
  }
}

async function handleRestoreRequest(deps: JobRouteDeps, req: JobRequest, res: Response, clearAll: boolean): Promise<void> {
  const job = req.scanJob as JobRow;
  const sub = req.scanSub as string;
  if (!requireCurrentOutput(job, res, false)) return;
  const dir = jobDir(deps.dataRoot, sub, job.job_id);
  if (clearAll) {
    const origStl = snapshotPath(dir, 'mesh-original.stl');
    if (!fs.existsSync(origStl)) { res.json({ job, report: job.report ?? {}, meshState: readMeshState(dir, job) }); return; }
    const saved = await restoreSnapshot(deps, sub, job, dir, origStl, snapshotPath(dir, 'report-original.json'), true);
    res.json({ ...saved, meshState: readMeshState(dir, saved.job) });
    return;
  }
  const undoStl = snapshotPath(dir, 'mesh-undo.stl');
  if (!fs.existsSync(undoStl)) {
    res.status(409).json({ error: 'nothing_to_undo', message: 'There is no previous mesh edit to undo.' });
    return;
  }
  const saved = await restoreSnapshot(deps, sub, job, dir, undoStl, snapshotPath(dir, 'report-undo.json'), false);
  res.json({ ...saved, meshState: readMeshState(dir, saved.job) });
}

/**
 * @description Create the `/jobs/:jobId/mesh*` router for crop, rotate/lay-flat, undo, and reset.
 */
export function createMeshEditRoutes(deps: JobRouteDeps): Router {
  const router = Router();
  router.use((req: JobRequest, res: Response, next: NextFunction) => {
    const sub = deps.callerSub(req);
    if (!sub) { res.status(401).json({ error: 'unauthenticated' }); return; }
    req.scanSub = sub;
    next();
  });
  router.get('/jobs/:jobId/mesh-state', withCurrentJob(deps, (req: JobRequest, res: Response) => {
    const job = req.scanJob as JobRow;
    if (!requireCurrentOutput(job, res, false)) return;
    const dir = jobDir(deps.dataRoot, req.scanSub as string, job.job_id);
    if (!fs.existsSync(artifactPath(dir, 'stl'))) { res.status(404).json({ error: 'artifact_not_found' }); return; }
    res.json(readMeshState(dir, job));
  }, 'read'));
  router.post('/jobs/:jobId/mesh/crop', withCurrentJob(deps, (req: JobRequest, res: Response) => handleCropRequest(deps, req, res), 'write'));
  router.post('/jobs/:jobId/mesh/transform', withCurrentJob(deps, (req: JobRequest, res: Response) => handleTransformRequest(deps, req, res), 'write'));
  router.post('/jobs/:jobId/mesh/undo', withCurrentJob(deps, (req: JobRequest, res: Response) => handleRestoreRequest(deps, req, res, false), 'write'));
  router.post('/jobs/:jobId/mesh/reset', withCurrentJob(deps, (req: JobRequest, res: Response) => handleRestoreRequest(deps, req, res, true), 'write'));
  return router;
}
