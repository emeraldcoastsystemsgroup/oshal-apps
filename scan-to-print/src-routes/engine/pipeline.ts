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
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Carry `sealedBase` from the point-cloud lane into the report and
 *                     |                             | state it as a warning (BACKLOG B7). A capped base is an ASSERTION
 *                     |                             | about the capture, not a measured face, and the drawing, the UI
 *                     |                             | and the concierge all read the report — so it is said once, here,
 *                     |                             | rather than paraphrased by each surface or left silent.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Every report gains `printChecks` (BACKLOG B13): thinnest wall and
 *                     |                             | steepest overhang against the limits a nozzle and a layer height
 *                     |                             | imply, both inputs through `options.printCheck`. The machine
 *                     |                             | numbers are validated before meshing so a bad nozzle is refused
 *                     |                             | without spending the mesher, and a failing check is written onto
 *                     |                             | the drawing's notes, where the person reads the verdict.
 * 4 | maintainer@emeraldcoastsystemsgroup.com   | Symmetry completion (BACKLOG B11): the photo lane takes an
 *                     |                             | opt-in `symmetry: 'x' | 'y'`, unions the carved solid with its
 *                     |                             | mirror about the footprint centre, and the report records
 *                     |                             | `mirrored` with how much material was COPIED rather than seen,
 *                     |                             | said again as a warning so it lands on the drawing's notes.
 * 5 | maintainer@emeraldcoastsystemsgroup.com   | Hull + depth in one build (BACKLOG B1/B8): the photo hull is
 *                     |                             | carved by ONE helper both lanes share, and
 *                     |                             | `reconstructHullWithDepth` refines that very grid with range
 *                     |                             | images; the report lists the silhouette AND the depth views and
 *                     |                             | names the depth ones in `depthViews`. A range image whose sensor
 *                     |                             | plane lies inside the part is refused: the carver would read the
 *                     |                             | material behind that plane as free space in front of it.
 */

import type { MeshValidation, TriMesh, Vec3 } from './geometry/geometry-types';
import { meshBounds, meshSurfaceArea, meshVolume } from './geometry/mesh-metrics';
import { validateMesh } from './geometry/mesh-validate';
import { toStlBinary } from './geometry/export-stl';
import { toObj } from './geometry/export-obj';
import type { Mask } from './raster/raster-types';
import { type OccupancyGrid, MAX_VOXELS_PER_AXIS, clearBorder, createOccupancyGrid, projectGrid, solidVolumeMm3, countSolid, solidBounds, mirrorUnion } from './grid/occupancy-grid';
import { type Axis, type ViewName, VIEW_FRAMES, VIEW_NAMES, readAxis } from './grid/views';
import { type DimensionSource, type KnownDimension, type Registration, type ViewSilhouette, carveSilhouettes, chooseVoxelMm, registerSilhouettes } from './grid/silhouette-carver';
import { type DepthMap, carveDepth } from './grid/depth-carver';
import { type PrintCheckOptions, type PrintChecks, evaluatePrintChecks } from './grid/print-checks';
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
  /** The machine the printability pre-check measures against (nozzle, layer height, perimeters). */
  printCheck?: PrintCheckOptions;
}

/** @description A horizontal axis a person can assert the part is mirror-symmetric across. */
export type SymmetryAxis = 'x' | 'y';

/** @description Photo-lane options: the shared knobs plus the opt-in symmetry assertion. */
export interface SilhouetteReconstructionOptions extends ReconstructionOptions {
  /**
   * The part is mirror-symmetric across the plane through its footprint centre normal to this axis
   * (`x`: left/right, `y`: front/back). Off by default: a mirror copies material nobody saw.
   */
  symmetry?: SymmetryAxis;
}

/** @description What a symmetry completion did, so the report can say it was copied, not seen. */
export interface MirrorRecord {
  /** The axis mirrored across (`x` means X was mapped to -X). */
  axis: SymmetryAxis;
  /** Voxels the mirror added. */
  addedVoxels: number;
  /** Their volume, cubic millimetres. */
  addedMm3: number;
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
  /** The lowest occupied layer was capped because the underside was not scanned (point-cloud lane). */
  sealedBase?: boolean;
  /** The solid was completed by a mirror on the person's symmetry assertion (photo lane). */
  mirrored?: MirrorRecord;
  /** Views that contributed a range image (depth lane); `viewsUsed` lists them too. */
  depthViews?: ViewName[];
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
  /**
   * What topology cannot see: the thinnest wall and the steepest overhang, each against the limit
   * the stated nozzle and layer height imply. `printable` stays the topological verdict; a failing
   * check here is advice written onto the drawing, not a refusal.
   */
  printChecks: PrintChecks;
  /** Views that contributed. */
  viewsUsed: ViewName[];
  /** Warnings from capture, registration and meshing. */
  warnings: string[];
  /** What the method structurally cannot recover. */
  limitations: string[];
  /** Method line for the drawing. */
  method: string;
  /**
   * Present on the point-cloud lane only. `true` means the underside was never scanned and the
   * object's lowest layer was capped on the assertion that it rests on a solid plane — the base
   * face of this solid is an assumption, not a measurement.
   */
  sealedBase?: boolean;
  /**
   * Present when the photo lane mirrored the solid on a symmetry assertion. `addedMm3` is material
   * copied from the other half, not observed by any view.
   */
  mirrored?: MirrorRecord;
  /**
   * Present on the depth lane: the views that contributed a range image. `viewsUsed` holds every
   * contributing view, silhouettes first; this names which of them were measured in depth.
   */
  depthViews?: ViewName[];
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
  const printChecks = evaluatePrintChecks(grid, options.printCheck);
  const mesh = surfaceNets(grid, { smoothIterations });
  const validation = validateMesh(mesh);
  const bounds = solidBounds(grid) ?? { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } };
  const projections = Object.fromEntries(VIEW_NAMES.map((v) => [v, projectGrid(grid, VIEW_FRAMES[v])])) as Record<ViewName, Mask>;
  const warnings = [...meta.warnings];
  if (meta.sealedBase) warnings.push('The underside was not scanned: the lowest layer was capped on the assertion that the object rests on a flat plane, so the base face is an assumption and not a measurement.');
  if (meta.mirrored) warnings.push(describeMirror(meta.mirrored));
  if (!validation.watertight) warnings.push(`Mesh is not watertight (${validation.openEdges} open edges); a slicer may refuse it.`);
  if (validation.eulerCharacteristic !== 2 && validation.watertight) warnings.push(`Mesh Euler characteristic is ${validation.eulerCharacteristic}: the solid has ${validation.eulerCharacteristic > 2 ? 'several shells' : 'through-holes'}.`);
  const report: ReconstructionReport = {
    lane: meta.lane, partName: options.partName ?? 'part', generatedAt: options.generatedAt ?? new Date().toISOString(),
    sizeMm, dimensionSources: meta.sources, voxelMm: grid.voxelMm, gridDims: { nx: grid.nx, ny: grid.ny, nz: grid.nz },
    solidVoxels, gridVolumeMm3: solidVolumeMm3(grid), meshVolumeMm3: meshVolume(mesh), surfaceAreaMm2: meshSurfaceArea(mesh),
    boundsMm: mesh.vertices.length ? meshBounds(mesh) : bounds, triangleCount: mesh.triangles.length, vertexCount: mesh.vertices.length,
    validation, printable: validation.watertight && validation.consistentWinding && validation.outwardFacing && validation.degenerate === 0,
    printChecks, viewsUsed: meta.viewsUsed, warnings, limitations: [...LANE_LIMITATIONS[meta.lane]], method: meta.method,
    ...(meta.sealedBase === undefined ? {} : { sealedBase: meta.sealedBase }),
    ...(meta.mirrored === undefined ? {} : { mirrored: meta.mirrored }),
    ...(meta.depthViews === undefined ? {} : { depthViews: meta.depthViews }),
  };
  return { grid, mesh, report, projections };
}

/** @description The drawing-note sentence for a symmetry completion; says what was copied, never hides it. */
function describeMirror(m: MirrorRecord): string {
  const plane = `the ${m.axis.toUpperCase()} = 0 plane through the footprint centre`;
  if (m.addedVoxels === 0) return `Mirrored about ${plane} on the assertion that the part is symmetric; the carved solid was already symmetric, so the mirror added nothing.`;
  return `Mirrored about ${plane} on the assertion that the part is symmetric: ${Math.round(m.addedMm3)} mm³ (${m.addedVoxels} voxels) were copied from the other half, not seen by any view.`;
}

/** @description Validate the opt-in symmetry assertion off the wire; undefined means none. */
function requireSymmetry(value: unknown): SymmetryAxis | undefined {
  if (value === undefined) return undefined;
  if (value === 'x' || value === 'y') return value;
  throw new RangeError('symmetry must be "x" or "y": the part rests on the bed, so a mirror plane runs vertically through the footprint centre');
}

/** @description The photo hull on its grid, before finishing: what both the photo and the depth lanes start from. */
interface PhotoHull {
  /** The carved (and optionally mirrored) grid. */
  grid: OccupancyGrid;
  /** The joint registration it was carved from. */
  registration: Registration;
  /** Present when a symmetry assertion completed it. */
  mirrored?: MirrorRecord;
  /** The silhouette views, in the order supplied. */
  viewsUsed: ViewName[];
  /** Method line for the drawing. */
  method: string;
}

/**
 * @description Register, carve and optionally mirror: the job's current grid. The mirror is a UNION
 * about the plane through the footprint centre (world X = 0 or Y = 0, where registration centres
 * every silhouette): it restores material a view failed to show on one side and never removes any.
 */
function carvePhotoHull(silhouettes: ViewSilhouette[], known: KnownDimension[], options: SilhouetteReconstructionOptions): PhotoHull {
  const resolution = bounded(options.resolution, RECONSTRUCTION_LIMITS.resolution, 'resolution');
  const symmetry = requireSymmetry(options.symmetry);
  const registration = registerSilhouettes(silhouettes, known);
  const voxelMm = chooseVoxelMm(registration.sizeMm, resolution);
  const grid = createOccupancyGrid(registration.sizeMm, voxelMm, 1, 1);
  carveSilhouettes(grid, registration, silhouettes);
  const addedVoxels = symmetry ? mirrorUnion(grid, symmetry) : 0;
  const mirrored = symmetry ? { axis: symmetry, addedVoxels, addedMm3: addedVoxels * voxelMm ** 3 } : undefined;
  const viewsUsed = silhouettes.map((s) => s.view);
  const hull = `Visual hull from ${viewsUsed.length} silhouette${viewsUsed.length === 1 ? '' : 's'} (${viewsUsed.join(', ')})`;
  return { grid, registration, mirrored, viewsUsed, method: symmetry ? `${hull}, mirrored about ${symmetry.toUpperCase()} = 0` : hull };
}

/**
 * @description The photo lane: register the silhouettes against the known dimension(s), carve a
 * solid grid, optionally complete it by symmetry, finish.
 * @param silhouettes - One mask per supplied view.
 * @param known - Measured extents (at least one).
 * @param options - See {@link SilhouetteReconstructionOptions}.
 * @returns The result.
 * @throws RangeError from registration, carving, an out-of-range option or a symmetry axis other than `x`/`y`.
 */
export function reconstructFromSilhouettes(silhouettes: ViewSilhouette[], known: KnownDimension[], options: SilhouetteReconstructionOptions = {}): ReconstructionResult {
  const hull = carvePhotoHull(silhouettes, known, options);
  return finishFromGrid(hull.grid, hull.registration.sizeMm, {
    lane: 'silhouettes', viewsUsed: hull.viewsUsed, sources: hull.registration.sources, warnings: hull.registration.warnings, mirrored: hull.mirrored, method: hull.method,
  }, options);
}

/** @description Refuse a range image whose sensor plane lies inside the part along its look axis. */
function requirePlaneOutside(grid: OccupancyGrid, map: DepthMap): void {
  const bounds = solidBounds(grid);
  if (!bounds) return;
  const look = VIEW_FRAMES[map.view].look;
  const nearFace = Math.min(readAxis(bounds.min, look), readAxis(bounds.max, look));
  if (map.planeMm > nearFace) {
    throw new RangeError(`The ${map.view} range image's sensor plane (${map.planeMm} mm along its view) lies inside the part, whose near face is at ${nearFace} mm; a range is measured from in front of the part`);
  }
}

/**
 * @description Hull and depth in one build: carve the photo hull exactly as the photo lane would
 * (the job's CURRENT grid, not a fresh block), then carve each range image out of that same grid.
 * A silhouette cannot see a cavity; a range image can, and only the free space in front of each
 * return is removed.
 * @param silhouettes - One mask per supplied view.
 * @param known - Measured extents (at least one).
 * @param maps - One or more orthographic range images in the world frame.
 * @param options - See {@link SilhouetteReconstructionOptions}.
 * @returns The result, lane `depth`.
 * @throws RangeError from registration or carving, with no range image, or with a sensor plane inside the part.
 */
export function reconstructHullWithDepth(silhouettes: ViewSilhouette[], known: KnownDimension[], maps: DepthMap[], options: SilhouetteReconstructionOptions = {}): ReconstructionResult {
  if (!Array.isArray(maps) || maps.length === 0) throw new RangeError('At least one range image is required');
  const hull = carvePhotoHull(silhouettes, known, options);
  for (const map of maps) requirePlaneOutside(hull.grid, map);
  const carved = maps.map((m) => ({ view: m.view, carved: carveDepth(hull.grid, m) }));
  const depthViews = maps.map((m) => m.view);
  const viewsUsed = [...new Set([...hull.viewsUsed, ...depthViews])];
  return finishFromGrid(hull.grid, hull.registration.sizeMm, {
    lane: 'depth', viewsUsed, depthViews, sources: hull.registration.sources, mirrored: hull.mirrored,
    warnings: [...hull.registration.warnings, ...carved.filter((c) => c.carved === 0).map((c) => `${c.view} depth map carved nothing; check its plane and scale.`)],
    method: `${hull.method}, depth-carved from ${maps.length} range image${maps.length === 1 ? '' : 's'} (${depthViews.join(', ')})`,
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
    lane: 'depth', viewsUsed, depthViews: viewsUsed, sources, warnings: [...priorWarnings, ...carved.filter((c) => c.carved === 0).map((c) => `${c.view} depth map carved nothing; check its plane and scale.`)],
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
    printable: report.printable, generatedAt: report.generatedAt, notes: [...report.limitations, ...report.warnings, ...report.printChecks.failures],
  };
  return { stl: toStlBinary(result.mesh), obj: toObj(result.mesh, report.partName), svg: renderEngineeringDrawing(drawing), report };
}
