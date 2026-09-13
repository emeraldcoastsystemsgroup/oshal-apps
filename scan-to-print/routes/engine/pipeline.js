"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the deterministic pipeline in one place. Every
 *                     |                             | lane (photo silhouettes, depth maps, a point cloud) ends in the
 *                     |                             | same occupancy grid; `finishFromGrid` is the one tail that
 *                     |                             | turns a grid into a mesh, a validation verdict, six
 *                     |                             | re-projections and a report. No file I/O and no framework
 *                     |                             | import live here — the routes own storage, this module owns
 *                     |                             | arithmetic — so the same call is what the specs exercise and
 *                     |                             | what the running app executes. The report states its own
 *                     |                             | limitations so the drawing, the UI and the concierge all read
 *                     |                             | one text instead of three paraphrases.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LANE_LIMITATIONS = exports.RECONSTRUCTION_LIMITS = void 0;
exports.finishFromGrid = finishFromGrid;
exports.reconstructFromSilhouettes = reconstructFromSilhouettes;
exports.refineWithDepth = refineWithDepth;
exports.exportArtifacts = exportArtifacts;
const mesh_metrics_1 = require("./geometry/mesh-metrics");
const mesh_validate_1 = require("./geometry/mesh-validate");
const export_stl_1 = require("./geometry/export-stl");
const export_obj_1 = require("./geometry/export-obj");
const occupancy_grid_1 = require("./grid/occupancy-grid");
const views_1 = require("./grid/views");
const silhouette_carver_1 = require("./grid/silhouette-carver");
const depth_carver_1 = require("./grid/depth-carver");
const surface_nets_1 = require("./mesh/surface-nets");
const engineering_drawing_1 = require("./drawing/engineering-drawing");
/** @description Defaults and bounds the routes echo in `/capabilities`. */
exports.RECONSTRUCTION_LIMITS = Object.freeze({
    resolution: { default: 96, min: 16, max: occupancy_grid_1.MAX_VOXELS_PER_AXIS - 2 },
    smoothIterations: { default: 2, min: 0, max: 10 },
});
/** @description The limitation text per lane — one source of truth for drawing, UI and concierge. */
exports.LANE_LIMITATIONS = Object.freeze({
    silhouettes: [
        'Visual hull: any surface no supplied outline can see — cavities, undercuts, holes not aligned with a view — is filled solid.',
        'Outlines assume the camera was square to the face and far enough away that perspective is negligible.',
    ],
    depth: [
        'Depth carving removes only the free space in front of measured surfaces; pixels with no return leave the solid untouched.',
    ],
    pointcloud: [
        'The interior is inferred by flood-filling the closed surface; a scan gap wider than the closing radius leaks and leaves the interior empty (reported as not closed).',
    ],
});
/** @description Clamp an integer option into its bound, defaulting when undefined. */
function bounded(value, bound, label) {
    if (value === undefined)
        return bound.default;
    if (!Number.isInteger(value) || value < bound.min || value > bound.max) {
        throw new RangeError(`${label} must be an integer between ${bound.min} and ${bound.max}`);
    }
    return value;
}
/**
 * @description The shared tail: mesh the grid, validate, measure, re-project, report.
 * @param grid - A carved or filled grid; its border is cleared here.
 * @param sizeMm - Object extents for the report.
 * @param meta - Lane provenance.
 * @param options - See {@link ReconstructionOptions}.
 * @returns The result.
 * @throws RangeError when the grid has no solid voxel (nothing to mesh) or an option is out of range.
 */
function finishFromGrid(grid, sizeMm, meta, options = {}) {
    const smoothIterations = bounded(options.smoothIterations, exports.RECONSTRUCTION_LIMITS.smoothIterations, 'smoothIterations');
    (0, occupancy_grid_1.clearBorder)(grid);
    const solidVoxels = (0, occupancy_grid_1.countSolid)(grid);
    if (solidVoxels === 0)
        throw new RangeError('Reconstruction produced no solid voxels; check the views and the known dimension');
    const mesh = (0, surface_nets_1.surfaceNets)(grid, { smoothIterations });
    const validation = (0, mesh_validate_1.validateMesh)(mesh);
    const bounds = (0, occupancy_grid_1.solidBounds)(grid) ?? { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
    const projections = Object.fromEntries(views_1.VIEW_NAMES.map((v) => [v, (0, occupancy_grid_1.projectGrid)(grid, views_1.VIEW_FRAMES[v])]));
    const warnings = [...meta.warnings];
    if (!validation.watertight)
        warnings.push(`Mesh is not watertight (${validation.openEdges} open edges); a slicer may refuse it.`);
    if (validation.eulerCharacteristic !== 2 && validation.watertight)
        warnings.push(`Mesh Euler characteristic is ${validation.eulerCharacteristic}: the solid has ${validation.eulerCharacteristic > 2 ? 'several shells' : 'through-holes'}.`);
    const report = {
        lane: meta.lane, partName: options.partName ?? 'part', generatedAt: options.generatedAt ?? new Date().toISOString(),
        sizeMm, dimensionSources: meta.sources, voxelMm: grid.voxelMm, gridDims: { nx: grid.nx, ny: grid.ny, nz: grid.nz },
        solidVoxels, gridVolumeMm3: (0, occupancy_grid_1.solidVolumeMm3)(grid), meshVolumeMm3: (0, mesh_metrics_1.meshVolume)(mesh), surfaceAreaMm2: (0, mesh_metrics_1.meshSurfaceArea)(mesh),
        boundsMm: mesh.vertices.length ? (0, mesh_metrics_1.meshBounds)(mesh) : bounds, triangleCount: mesh.triangles.length, vertexCount: mesh.vertices.length,
        validation, printable: validation.watertight && validation.consistentWinding && validation.outwardFacing && validation.degenerate === 0,
        viewsUsed: meta.viewsUsed, warnings, limitations: [...exports.LANE_LIMITATIONS[meta.lane]], method: meta.method,
    };
    return { grid, mesh, report, projections };
}
/**
 * @description The photo lane: register the silhouettes against the known dimension(s), carve a
 * solid grid, finish.
 * @param silhouettes - One mask per supplied view.
 * @param known - Measured extents (at least one).
 * @param options - See {@link ReconstructionOptions}.
 * @returns The result.
 * @throws RangeError from registration, carving or an out-of-range option.
 */
function reconstructFromSilhouettes(silhouettes, known, options = {}) {
    const resolution = bounded(options.resolution, exports.RECONSTRUCTION_LIMITS.resolution, 'resolution');
    const registration = (0, silhouette_carver_1.registerSilhouettes)(silhouettes, known);
    const voxelMm = (0, silhouette_carver_1.chooseVoxelMm)(registration.sizeMm, resolution);
    const grid = (0, occupancy_grid_1.createOccupancyGrid)(registration.sizeMm, voxelMm, 1, 1);
    (0, silhouette_carver_1.carveSilhouettes)(grid, registration, silhouettes);
    const viewsUsed = silhouettes.map((s) => s.view);
    return finishFromGrid(grid, registration.sizeMm, {
        lane: 'silhouettes', viewsUsed, sources: registration.sources, warnings: registration.warnings,
        method: `Visual hull from ${viewsUsed.length} silhouette${viewsUsed.length === 1 ? '' : 's'} (${viewsUsed.join(', ')})`,
    }, options);
}
/**
 * @description The depth lane: apply one or more range images to an existing solid (usually the
 * visual hull) so measured cavities are carved out, then finish.
 * @param grid - The solid to refine, mutated in place.
 * @param sizeMm - Object extents.
 * @param sources - Provenance carried from the prior lane.
 * @param maps - Range images.
 * @param priorWarnings - Warnings carried from the prior lane.
 * @param options - See {@link ReconstructionOptions}.
 * @returns The result.
 */
function refineWithDepth(grid, sizeMm, sources, maps, priorWarnings, options = {}) {
    const carved = maps.map((m) => ({ view: m.view, carved: (0, depth_carver_1.carveDepth)(grid, m) }));
    const viewsUsed = maps.map((m) => m.view);
    return finishFromGrid(grid, sizeMm, {
        lane: 'depth', viewsUsed, sources, warnings: [...priorWarnings, ...carved.filter((c) => c.carved === 0).map((c) => `${c.view} depth map carved nothing; check its plane and scale.`)],
        method: `Depth-carved from ${maps.length} range image${maps.length === 1 ? '' : 's'} (${viewsUsed.join(', ')})`,
    }, options);
}
/**
 * @description Serialise a result: STL, OBJ, the SVG sheet and the report.
 * @param result - From any lane.
 * @param drawingNumber - Identifier for the title block.
 * @returns The artifacts.
 */
function exportArtifacts(result, drawingNumber) {
    const { report } = result;
    const drawing = {
        partName: report.partName, drawingNumber, sizeMm: report.sizeMm, sources: report.dimensionSources, voxelMm: report.voxelMm,
        views: result.projections, method: report.method, volumeMm3: report.gridVolumeMm3, triangleCount: report.triangleCount,
        printable: report.printable, generatedAt: report.generatedAt, notes: [...report.limitations, ...report.warnings],
    };
    return { stl: (0, export_stl_1.toStlBinary)(result.mesh), obj: (0, export_obj_1.toObj)(result.mesh, report.partName), svg: (0, engineering_drawing_1.renderEngineeringDrawing)(drawing), report };
}
//# sourceMappingURL=pipeline.js.map