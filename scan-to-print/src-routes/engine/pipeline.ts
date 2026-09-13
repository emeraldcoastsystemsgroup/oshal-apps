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

import type { MeshValidation, TriMesh, Vec3 } from './geometry/geometry-types';
import { meshBounds, meshSurfaceArea, meshVolume } from './geometry/mesh-metrics';
import { validateMesh } from './geometry/mesh-validate';
import { toStlBinary } from './geometry/export-stl';
import { toObj } from './geometry/export-obj';
import type { Mask } from './raster/raster-types';
import { type OccupancyGrid, MAX_VOXELS_PER_AXIS, clearBorder, createOccupancyGrid, projectGrid, solidVolumeMm3, countSolid, solidBounds } from './grid/occupancy-grid';
import { type Axis, type ViewName, VIEW_FRAMES, VIEW_NAMES } from './grid/views';
import { type DimensionSource, type KnownDimension, type ViewSilhouette, carveSilhouettes, chooseVoxelMm, registerSilhouettes } from './grid/silhouette-carver';
import { type DepthMap, carveDepth } from './grid/depth-carver';
import { surfaceNets } from './mesh/surface-nets';
import { type DrawingInput, renderEngineeringDrawing } from './drawing/engineering-drawing';

/** @description Which input produced the solid. */
export type Lane = 'silhouettes' | 'depth' | 'pointcloud';

/** @description Knobs shared by every lane. */
export interface ReconstructionOptions {
  /** Voxels along the largest extent (silhouette lane). Default 96. */
  resolution?: number;
  /** Mesher smoothing passes. Default 2. */
  smoothIterations?: number;
  /** Name for the title block and solid. Default `part`. */
  partName?: string;
  /** Timestamp override for reproducible reports; default `new Date().toISOString()`. */
  generatedAt?: string;
}

/** @description Defaults and bounds the routes echo in `/capabilities`. */
export const RECONSTRUCTION_LIMITS = Object.freeze({
  resolution: { default: 96, min: 16, max: MAX_VOXELS_PER_AXIS - 2 },
  smoothIterations: { default: 2, min: 0, max: 10 },
});

/** @description Per-lane provenance that lands in the report. */
export interface LaneMeta {
  /** Which lane. */
  lane: Lane;
  /** Views that contributed (silhouette/depth lanes). */
  viewsUsed: ViewName[];
  /** Provenance of each extent. */
  sources: Record<Axis, DimensionSource>;
  /** Warnings gathered on the way in. */
  warnings: string[];
  /** One-line method description for the drawing. */
  method: string;
}

/** @description The complete, serialisable result record. */
export interface ReconstructionReport {
  /** Which lane. */
  lane: Lane;
  /** Part name. */
  partName: string;
  /** ISO timestamp. */
  generatedAt: string;
  /** Object extents, millimetres. */
  sizeMm: Vec3;
  /** Provenance per extent. */
  dimensionSources: Record<Axis, DimensionSource>;
  /** Voxel edge. */
  voxelMm: number;
  /** Grid dimensions including the empty shell. */
  gridDims: { nx: number; ny: number; nz: number };
  /** Solid voxels. */
  solidVoxels: number;
  /** Voxel-exact volume. */
  gridVolumeMm3: number;
  /** Divergence-theorem mesh volume. */
  meshVolumeMm3: number;
  /** Mesh surface area. */
  surfaceAreaMm2: number;
  /** Mesh bounds, millimetres. */
  boundsMm: { min: Vec3; max: Vec3 };
  /** Facet count. */
  triangleCount: number;
  /** Vertex count. */
  vertexCount: number;
  /** Topology verdict. */
  validation: MeshValidation;
  /** Watertight, consistently wound, outward, no slivers — what a slicer needs. */
  printable: boolean;
  /** Views that contributed. */
  viewsUsed: ViewName[];
  /** Warnings from capture, registration and meshing. */
  warnings: string[];
  /** What the method structurally cannot recover. */
  limitations: string[];
  /** Method line for the drawing. */
  method: string;
}

/** @description Everything a lane produces. */
export interface ReconstructionResult {
  /** The solid. */
  grid: OccupancyGrid;
  /** Its boundary mesh, millimetres. */
  mesh: TriMesh;
  /** The report. */
  report: ReconstructionReport;
  /** Re-projection per canonical view, one pixel per voxel. */
  projections: Record<ViewName, Mask>;
}

/** @description The limitation text per lane — one source of truth for drawing, UI and concierge. */
export const LANE_LIMITATIONS: Readonly<Record<Lane, readonly string[]>> = Object.freeze({
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
function bounded(value: number | undefined, bound: { default: number; min: number; max: number }, label: string): number {
  if (value === undefined) return bound.default;
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
export function finishFromGrid(grid: OccupancyGrid, sizeMm: Vec3, meta: LaneMeta, options: ReconstructionOptions = {}): ReconstructionResult {
  const smoothIterations = bounded(options.smoothIterations, RECONSTRUCTION_LIMITS.smoothIterations, 'smoothIterations');
  clearBorder(grid);
  const solidVoxels = countSolid(grid);
  if (solidVoxels === 0) throw new RangeError('Reconstruction produced no solid voxels; check the views and the known dimension');
  const mesh = surfaceNets(grid, { smoothIterations });
  const validation = validateMesh(mesh);
  const bounds = solidBounds(grid) ?? { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
  const projections = Object.fromEntries(VIEW_NAMES.map((v) => [v, projectGrid(grid, VIEW_FRAMES[v])])) as Record<ViewName, Mask>;
  const warnings = [...meta.warnings];
  if (!validation.watertight) warnings.push(`Mesh is not watertight (${validation.openEdges} open edges); a slicer may refuse it.`);
  if (validation.eulerCharacteristic !== 2 && validation.watertight) warnings.push(`Mesh Euler characteristic is ${validation.eulerCharacteristic}: the solid has ${validation.eulerCharacteristic > 2 ? 'several shells' : 'through-holes'}.`);
  const report: ReconstructionReport = {
    lane: meta.lane, partName: options.partName ?? 'part', generatedAt: options.generatedAt ?? new Date().toISOString(),
    sizeMm, dimensionSources: meta.sources, voxelMm: grid.voxelMm, gridDims: { nx: grid.nx, ny: grid.ny, nz: grid.nz },
    solidVoxels, gridVolumeMm3: solidVolumeMm3(grid), meshVolumeMm3: meshVolume(mesh), surfaceAreaMm2: meshSurfaceArea(mesh),
    boundsMm: mesh.vertices.length ? meshBounds(mesh) : bounds, triangleCount: mesh.triangles.length, vertexCount: mesh.vertices.length,
    validation, printable: validation.watertight && validation.consistentWinding && validation.outwardFacing && validation.degenerate === 0,
    viewsUsed: meta.viewsUsed, warnings, limitations: [...LANE_LIMITATIONS[meta.lane]], method: meta.method,
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
export function reconstructFromSilhouettes(silhouettes: ViewSilhouette[], known: KnownDimension[], options: ReconstructionOptions = {}): ReconstructionResult {
  const resolution = bounded(options.resolution, RECONSTRUCTION_LIMITS.resolution, 'resolution');
  const registration = registerSilhouettes(silhouettes, known);
  const voxelMm = chooseVoxelMm(registration.sizeMm, resolution);
  const grid = createOccupancyGrid(registration.sizeMm, voxelMm, 1, 1);
  carveSilhouettes(grid, registration, silhouettes);
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
export function refineWithDepth(
  grid: OccupancyGrid, sizeMm: Vec3, sources: Record<Axis, DimensionSource>, maps: DepthMap[], priorWarnings: string[], options: ReconstructionOptions = {},
): ReconstructionResult {
  const carved = maps.map((m) => ({ view: m.view, carved: carveDepth(grid, m) }));
  const viewsUsed = maps.map((m) => m.view);
  return finishFromGrid(grid, sizeMm, {
    lane: 'depth', viewsUsed, sources, warnings: [...priorWarnings, ...carved.filter((c) => c.carved === 0).map((c) => `${c.view} depth map carved nothing; check its plane and scale.`)],
    method: `Depth-carved from ${maps.length} range image${maps.length === 1 ? '' : 's'} (${viewsUsed.join(', ')})`,
  }, options);
}

/** @description The exported artifacts for one result. */
export interface Artifacts {
  /** Binary STL, millimetres. */
  stl: Uint8Array;
  /** Wavefront OBJ. */
  obj: string;
  /** The engineering drawing. */
  svg: string;
  /** The report, as written. */
  report: ReconstructionReport;
}

/**
 * @description Serialise a result: STL, OBJ, the SVG sheet and the report.
 * @param result - From any lane.
 * @param drawingNumber - Identifier for the title block.
 * @returns The artifacts.
 */
export function exportArtifacts(result: ReconstructionResult, drawingNumber: string): Artifacts {
  const { report } = result;
  const drawing: DrawingInput = {
    partName: report.partName, drawingNumber, sizeMm: report.sizeMm, sources: report.dimensionSources, voxelMm: report.voxelMm,
    views: result.projections, method: report.method, volumeMm3: report.gridVolumeMm3, triangleCount: report.triangleCount,
    printable: report.printable, generatedAt: report.generatedAt, notes: [...report.limitations, ...report.warnings],
  };
  return { stl: toStlBinary(result.mesh), obj: toObj(result.mesh, report.partName), svg: renderEngineeringDrawing(drawing), report };
}
