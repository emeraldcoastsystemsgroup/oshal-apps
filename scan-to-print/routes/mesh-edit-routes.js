"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com   | Interactive 3D mesh editing routes for reconstructed jobs: bounding-box crop (RP-SCN-01), build-plate rotation / lay-flat leveling (RP-SCN-02), and persisted Undo / Reset snapshots.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMeshEditRoutes = createMeshEditRoutes;
const express_1 = require("express");
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
const node_zlib_1 = __importDefault(require("node:zlib"));
const logger_1 = require("@/shared/logger");
const job_store_1 = require("./job-store");
const data_dir_1 = require("./data-dir");
const job_outputs_1 = require("./job-outputs");
const artifact_budget_1 = require("./artifact-budget");
const parse_stl_1 = require("./engine/geometry/parse-stl");
const export_stl_1 = require("./engine/geometry/export-stl");
const export_obj_1 = require("./engine/geometry/export-obj");
const mesh_metrics_1 = require("./engine/geometry/mesh-metrics");
const mesh_validate_1 = require("./engine/geometry/mesh-validate");
const mesh_ops_1 = require("./engine/geometry/mesh-ops");
const logger = (0, logger_1.createChildLogger)({ module: 'scan-to-print-mesh-edit' });
function snapshotPath(dir, file) {
    return node_path_1.default.join(dir, 'artifacts', file);
}
function readMeshState(dir, job) {
    const stlFile = (0, data_dir_1.artifactPath)(dir, 'stl');
    const mesh = (0, parse_stl_1.fromStl)(new Uint8Array(node_fs_1.default.readFileSync(stlFile)));
    const bounds = (0, mesh_metrics_1.meshBounds)(mesh);
    return {
        jobId: job.job_id,
        bounds,
        vertexCount: mesh.vertices.length,
        triangleCount: mesh.triangles.length,
        canUndo: node_fs_1.default.existsSync(snapshotPath(dir, 'mesh-undo.stl')),
        canReset: node_fs_1.default.existsSync(snapshotPath(dir, 'mesh-original.stl')),
    };
}
function backupBeforeEdit(dir, job) {
    const stlFile = (0, data_dir_1.artifactPath)(dir, 'stl');
    const origStl = snapshotPath(dir, 'mesh-original.stl');
    const origRep = snapshotPath(dir, 'report-original.json');
    const undoStl = snapshotPath(dir, 'mesh-undo.stl');
    const undoRep = snapshotPath(dir, 'report-undo.json');
    const reportText = JSON.stringify(job.report ?? {}, null, 2);
    if (!node_fs_1.default.existsSync(origStl)) {
        node_fs_1.default.copyFileSync(stlFile, origStl);
        node_fs_1.default.writeFileSync(origRep, reportText);
    }
    node_fs_1.default.copyFileSync(stlFile, undoStl);
    node_fs_1.default.writeFileSync(undoRep, reportText);
}
async function persistEditedMesh(deps, sub, job, dir, mesh, note) {
    const stlBytes = Buffer.from((0, export_stl_1.toStlBinary)(mesh));
    if (stlBytes.byteLength > artifact_budget_1.DOWNLOAD_LIMIT_BYTES) {
        throw new RangeError('Edited mesh exceeds the single-download size ceiling.');
    }
    (0, data_dir_1.ensureDir)(node_path_1.default.join(dir, 'artifacts'));
    node_fs_1.default.writeFileSync((0, data_dir_1.artifactPath)(dir, 'stl'), stlBytes);
    const objText = (0, export_obj_1.toObj)(mesh, job.title || 'oshal_part');
    if (Buffer.byteLength(objText) <= artifact_budget_1.DOWNLOAD_LIMIT_BYTES) {
        node_fs_1.default.writeFileSync((0, data_dir_1.artifactPath)(dir, 'obj'), node_zlib_1.default.gzipSync(Buffer.from(objText, 'utf8')));
    }
    else {
        node_fs_1.default.rmSync((0, data_dir_1.artifactPath)(dir, 'obj'), { force: true });
    }
    node_fs_1.default.rmSync((0, data_dir_1.artifactPath)(dir, 'gcode'), { force: true });
    const bounds = (0, mesh_metrics_1.meshBounds)(mesh);
    const validation = (0, mesh_validate_1.validateMesh)(mesh);
    const surfaceAreaMm2 = (0, mesh_metrics_1.meshSurfaceArea)(mesh);
    const volumeMm3 = validation.watertight ? Math.max(0, (0, mesh_metrics_1.meshVolume)(mesh)) : Math.max(0, Math.abs((0, mesh_metrics_1.meshVolume)(mesh)));
    const prev = (job.report ?? {});
    const prevNotes = Array.isArray(prev.editHistory) ? prev.editHistory.slice(-9) : [];
    const nextReport = {
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
    node_fs_1.default.writeFileSync((0, data_dir_1.artifactPath)(dir, 'report'), JSON.stringify(nextReport, null, 2));
    const updated = await (0, job_store_1.updateJob)(deps.pool, sub, job.job_id, {
        state: 'reconstructed',
        report: nextReport,
        failure_reason: null,
    });
    if (!updated)
        throw new Error('Job disappeared while saving mesh edit');
    return { job: updated, report: nextReport };
}
async function restoreSnapshot(deps, sub, job, dir, stlSnap, repSnap, clearAll) {
    const stlBytes = node_fs_1.default.readFileSync(stlSnap);
    const mesh = (0, parse_stl_1.fromStl)(new Uint8Array(stlBytes));
    node_fs_1.default.writeFileSync((0, data_dir_1.artifactPath)(dir, 'stl'), stlBytes);
    const objText = (0, export_obj_1.toObj)(mesh, job.title || 'oshal_part');
    if (Buffer.byteLength(objText) <= artifact_budget_1.DOWNLOAD_LIMIT_BYTES) {
        node_fs_1.default.writeFileSync((0, data_dir_1.artifactPath)(dir, 'obj'), node_zlib_1.default.gzipSync(Buffer.from(objText, 'utf8')));
    }
    node_fs_1.default.rmSync((0, data_dir_1.artifactPath)(dir, 'gcode'), { force: true });
    const restoredReport = node_fs_1.default.existsSync(repSnap)
        ? JSON.parse(node_fs_1.default.readFileSync(repSnap, 'utf8'))
        : (job.report ?? {});
    node_fs_1.default.writeFileSync((0, data_dir_1.artifactPath)(dir, 'report'), JSON.stringify(restoredReport, null, 2));
    node_fs_1.default.rmSync(snapshotPath(dir, 'mesh-undo.stl'), { force: true });
    node_fs_1.default.rmSync(snapshotPath(dir, 'report-undo.json'), { force: true });
    if (clearAll) {
        node_fs_1.default.rmSync(snapshotPath(dir, 'mesh-original.stl'), { force: true });
        node_fs_1.default.rmSync(snapshotPath(dir, 'report-original.json'), { force: true });
    }
    const updated = await (0, job_store_1.updateJob)(deps.pool, sub, job.job_id, {
        state: 'reconstructed',
        report: restoredReport,
        failure_reason: null,
    });
    if (!updated)
        throw new Error('Job disappeared while restoring mesh snapshot');
    return { job: updated, report: restoredReport };
}
function parseCropBody(raw) {
    const body = (raw ?? {});
    const src = (body.bounds && typeof body.bounds === 'object' ? body.bounds : body);
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
async function handleCropRequest(deps, req, res) {
    const job = req.scanJob;
    const sub = req.scanSub;
    if (!(0, job_outputs_1.requireCurrentOutput)(job, res, false))
        return;
    const dir = (0, data_dir_1.jobDir)(deps.dataRoot, sub, job.job_id);
    const stlFile = (0, data_dir_1.artifactPath)(dir, 'stl');
    if (!node_fs_1.default.existsSync(stlFile)) {
        res.status(404).json({ error: 'artifact_not_found' });
        return;
    }
    try {
        const { bounds, snapToBed } = parseCropBody(req.body);
        const current = (0, parse_stl_1.fromStl)(new Uint8Array(node_fs_1.default.readFileSync(stlFile)));
        const cropped = (0, mesh_ops_1.cropMesh)(current, bounds, snapToBed);
        backupBeforeEdit(dir, job);
        const saved = await persistEditedMesh(deps, sub, job, dir, cropped, 'crop');
        res.json({ ...saved, meshState: readMeshState(dir, saved.job) });
    }
    catch (error) {
        if (error instanceof RangeError) {
            res.status(422).json({ error: 'crop_refused', message: error.message });
            return;
        }
        logger.error({ err: error, jobId: job.job_id }, 'Mesh crop failed');
        res.status(500).json({ error: 'crop_failed', message: 'Could not crop this model.' });
    }
}
async function handleTransformRequest(deps, req, res) {
    const job = req.scanJob;
    const sub = req.scanSub;
    if (!(0, job_outputs_1.requireCurrentOutput)(job, res, false))
        return;
    const dir = (0, data_dir_1.jobDir)(deps.dataRoot, sub, job.job_id);
    const stlFile = (0, data_dir_1.artifactPath)(dir, 'stl');
    if (!node_fs_1.default.existsSync(stlFile)) {
        res.status(404).json({ error: 'artifact_not_found' });
        return;
    }
    try {
        const body = (req.body ?? {});
        const spec = {
            layFlat: body.layFlat === undefined || body.layFlat === null || body.layFlat === '' ? undefined : String(body.layFlat),
            rxDeg: body.rxDeg === undefined ? 0 : Number(body.rxDeg),
            ryDeg: body.ryDeg === undefined ? 0 : Number(body.ryDeg),
            rzDeg: body.rzDeg === undefined ? 0 : Number(body.rzDeg),
            snapToBed: body.snapToBed !== false,
        };
        const current = (0, parse_stl_1.fromStl)(new Uint8Array(node_fs_1.default.readFileSync(stlFile)));
        const transformed = (0, mesh_ops_1.transformMesh)(current, spec);
        backupBeforeEdit(dir, job);
        const saved = await persistEditedMesh(deps, sub, job, dir, transformed, spec.layFlat ? `layFlat:${spec.layFlat}` : 'rotate');
        res.json({ ...saved, meshState: readMeshState(dir, saved.job) });
    }
    catch (error) {
        if (error instanceof RangeError) {
            res.status(422).json({ error: 'transform_refused', message: error.message });
            return;
        }
        logger.error({ err: error, jobId: job.job_id }, 'Mesh transform failed');
        res.status(500).json({ error: 'transform_failed', message: 'Could not rotate or level this model.' });
    }
}
async function handleRestoreRequest(deps, req, res, clearAll) {
    const job = req.scanJob;
    const sub = req.scanSub;
    if (!(0, job_outputs_1.requireCurrentOutput)(job, res, false))
        return;
    const dir = (0, data_dir_1.jobDir)(deps.dataRoot, sub, job.job_id);
    if (clearAll) {
        const origStl = snapshotPath(dir, 'mesh-original.stl');
        if (!node_fs_1.default.existsSync(origStl)) {
            res.json({ job, report: job.report ?? {}, meshState: readMeshState(dir, job) });
            return;
        }
        const saved = await restoreSnapshot(deps, sub, job, dir, origStl, snapshotPath(dir, 'report-original.json'), true);
        res.json({ ...saved, meshState: readMeshState(dir, saved.job) });
        return;
    }
    const undoStl = snapshotPath(dir, 'mesh-undo.stl');
    if (!node_fs_1.default.existsSync(undoStl)) {
        res.status(409).json({ error: 'nothing_to_undo', message: 'There is no previous mesh edit to undo.' });
        return;
    }
    const saved = await restoreSnapshot(deps, sub, job, dir, undoStl, snapshotPath(dir, 'report-undo.json'), false);
    res.json({ ...saved, meshState: readMeshState(dir, saved.job) });
}
/**
 * @description Create the `/jobs/:jobId/mesh*` router for crop, rotate/lay-flat, undo, and reset.
 */
function createMeshEditRoutes(deps) {
    const router = (0, express_1.Router)();
    router.use((req, res, next) => {
        const sub = deps.callerSub(req);
        if (!sub) {
            res.status(401).json({ error: 'unauthenticated' });
            return;
        }
        req.scanSub = sub;
        next();
    });
    router.get('/jobs/:jobId/mesh-state', (0, job_outputs_1.withCurrentJob)(deps, (req, res) => {
        const job = req.scanJob;
        if (!(0, job_outputs_1.requireCurrentOutput)(job, res, false))
            return;
        const dir = (0, data_dir_1.jobDir)(deps.dataRoot, req.scanSub, job.job_id);
        if (!node_fs_1.default.existsSync((0, data_dir_1.artifactPath)(dir, 'stl'))) {
            res.status(404).json({ error: 'artifact_not_found' });
            return;
        }
        res.json(readMeshState(dir, job));
    }, 'read'));
    router.post('/jobs/:jobId/mesh/crop', (0, job_outputs_1.withCurrentJob)(deps, (req, res) => handleCropRequest(deps, req, res), 'write'));
    router.post('/jobs/:jobId/mesh/transform', (0, job_outputs_1.withCurrentJob)(deps, (req, res) => handleTransformRequest(deps, req, res), 'write'));
    router.post('/jobs/:jobId/mesh/undo', (0, job_outputs_1.withCurrentJob)(deps, (req, res) => handleRestoreRequest(deps, req, res, false), 'write'));
    router.post('/jobs/:jobId/mesh/reset', (0, job_outputs_1.withCurrentJob)(deps, (req, res) => handleRestoreRequest(deps, req, res, true), 'write'));
    return router;
}
//# sourceMappingURL=mesh-edit-routes.js.map