/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — shape-from-silhouette (the visual hull) over
 *                     |                             | the occupancy grid. Two halves: REGISTRATION turns each photo's
 *                     |                             | silhouette bounding box plus ONE known dimension into a
 *                     |                             | millimetres-per-pixel scale and an image centre per view (the
 *                     |                             | object's bounding box is the registration key — the capture
 *                     |                             | contract is "camera square to the face"); CARVING then deletes
 *                     |                             | every voxel whose centre lands on background in any view. No
 *                     |                             | solver iterates to convergence and nothing is estimated
 *                     |                             | stochastically: the same photos and the same number always
 *                     |                             | yield the same grid, which is the whole point of the package.
 */

import type { Vec3 } from '../geometry/geometry-types';
import { type Mask, type PixelBox, maskAt, maskStats } from '../raster/raster-types';
import { type OccupancyGrid, gridIndex, voxelCenter } from './occupancy-grid';
import { type Axis, type ViewName, VIEW_FRAMES, projectToView, readAxis } from './views';

/** @description One photo's silhouette, tagged with the view it was taken from. */
export interface ViewSilhouette {
  /** Which canonical view. */
  view: ViewName;
  /** The object mask from {@link extractSilhouette}. */
  mask: Mask;
}

/** @description A dimension the person measured with a ruler: the scale anchor. */
export interface KnownDimension {
  /** World axis: `x` width, `y` depth, `z` height. */
  axis: Axis;
  /** Millimetres. */
  mm: number;
}

/** @description Where each world size came from — shown on the drawing's title block. */
export type DimensionSource = 'known' | 'derived' | 'assumed';

/** @description Everything needed to map a world point into one photo's pixels. */
export interface ViewCalibration {
  /** Which view. */
  view: ViewName;
  /** Millimetres per silhouette pixel. */
  mmPerPx: number;
  /** Silhouette bounds in pixels. */
  bbox: PixelBox;
  /** Pixel column of the object's bounding-box centre. */
  uCenterPx: number;
  /** Pixel row of the object's bounding-box centre. */
  vCenterPx: number;
  /** World `u` coordinate (mm) of that centre. */
  uCenterMm: number;
  /** World `v` coordinate (mm) of that centre. */
  vCenterMm: number;
}

/** @description The resolved object size and the per-view calibrations. */
export interface Registration {
  /** Object extent along each world axis, millimetres. */
  sizeMm: Vec3;
  /** How each extent was obtained. */
  sources: Record<Axis, DimensionSource>;
  /** One calibration per supplied view. */
  views: ViewCalibration[];
  /** Consistency and coverage problems, human-readable. */
  warnings: string[];
}

/** @description Relative disagreement between two scale estimates above which a warning is raised. */
const SCALE_DISAGREEMENT = 0.1;

/** @description Pixel extents of a silhouette along the view's `u` and `v` axes. */
function pixelExtents(box: PixelBox): { uPx: number; vPx: number } {
  return { uPx: box.maxX - box.minX + 1, vPx: box.maxY - box.minY + 1 };
}

/** @description Reject inputs that cannot register: no views, a duplicate view, an empty mask, no anchor. */
function validateInputs(silhouettes: ViewSilhouette[], known: KnownDimension[]): Map<ViewName, PixelBox> {
  if (silhouettes.length === 0) throw new RangeError('At least one view silhouette is required');
  if (known.length === 0) throw new RangeError('At least one known dimension is required to set the scale');
  for (const dim of known) {
    if (!(dim.mm > 0) || !Number.isFinite(dim.mm)) throw new RangeError(`Known ${dim.axis} dimension must be a positive number`);
  }
  const boxes = new Map<ViewName, PixelBox>();
  for (const s of silhouettes) {
    if (boxes.has(s.view)) throw new RangeError(`View "${s.view}" was supplied twice`);
    const { bbox } = maskStats(s.mask);
    if (!bbox) throw new RangeError(`View "${s.view}" has an empty silhouette`);
    boxes.set(s.view, bbox);
  }
  return boxes;
}

/**
 * @description Propagate known extents through the views until nothing new resolves: a view that
 * knows one of its two axes in millimetres yields the other from the pixel ratio.
 * @param boxes - Silhouette bounds per view.
 * @param sizes - Partially known extents, mutated.
 * @param sources - Provenance per axis, mutated.
 * @returns Nothing; the maps are updated in place.
 */
function propagateExtents(
  boxes: Map<ViewName, PixelBox>,
  sizes: Partial<Record<Axis, number>>,
  sources: Partial<Record<Axis, DimensionSource>>,
): void {
  let progress = true;
  while (progress) {
    progress = false;
    for (const [view, box] of boxes) {
      const frame = VIEW_FRAMES[view];
      const { uPx, vPx } = pixelExtents(box);
      const uAxis = frame.u.axis;
      const vAxis = frame.v.axis;
      if (sizes[uAxis] !== undefined && sizes[vAxis] === undefined) {
        sizes[vAxis] = (sizes[uAxis] as number) * (vPx / uPx);
        sources[vAxis] = 'derived';
        progress = true;
      } else if (sizes[vAxis] !== undefined && sizes[uAxis] === undefined) {
        sizes[uAxis] = (sizes[vAxis] as number) * (uPx / vPx);
        sources[uAxis] = 'derived';
        progress = true;
      }
    }
  }
}

/** @description Build one view's calibration from the resolved sizes, warning when its two axes disagree. */
function calibrateView(view: ViewName, box: PixelBox, sizeMm: Vec3, warnings: string[]): ViewCalibration {
  const frame = VIEW_FRAMES[view];
  const { uPx, vPx } = pixelExtents(box);
  const fromU = sizeMm[frame.u.axis] / uPx;
  const fromV = sizeMm[frame.v.axis] / vPx;
  const disagreement = Math.abs(fromU - fromV) / Math.max(fromU, fromV);
  if (disagreement > SCALE_DISAGREEMENT) {
    warnings.push(
      `${view} view: its ${frame.u.axis}/${frame.v.axis} proportions disagree with the other views by ${Math.round(disagreement * 100)}%; the photo may not be square to the face.`,
    );
  }
  const center: Vec3 = { x: 0, y: 0, z: sizeMm.z / 2 };
  return {
    view,
    mmPerPx: (fromU + fromV) / 2,
    bbox: box,
    uCenterPx: (box.minX + box.maxX + 1) / 2,
    vCenterPx: (box.minY + box.maxY + 1) / 2,
    uCenterMm: readAxis(center, frame.u),
    vCenterMm: readAxis(center, frame.v),
  };
}

/**
 * @description Resolve the object's world size and every view's pixel calibration from the
 * silhouettes and the known dimension(s). An axis no supplied view can see is ASSUMED equal to
 * the first known dimension and flagged — the drawing carries that flag.
 * @param silhouettes - One mask per supplied view.
 * @param known - One to three measured extents.
 * @returns The registration.
 * @throws RangeError when the inputs cannot register (see {@link validateInputs}).
 */
export function registerSilhouettes(silhouettes: ViewSilhouette[], known: KnownDimension[]): Registration {
  const boxes = validateInputs(silhouettes, known);
  const sizes: Partial<Record<Axis, number>> = {};
  const sources: Partial<Record<Axis, DimensionSource>> = {};
  for (const dim of known) { sizes[dim.axis] = dim.mm; sources[dim.axis] = 'known'; }
  propagateExtents(boxes, sizes, sources);
  const warnings: string[] = [];
  for (const axis of ['x', 'y', 'z'] as Axis[]) {
    if (sizes[axis] !== undefined) continue;
    sizes[axis] = known[0].mm;
    sources[axis] = 'assumed';
    warnings.push(`Extent along ${axis.toUpperCase()} is not visible in any supplied view; assumed ${known[0].mm} mm. Add a view that shows it, or enter it as a known dimension.`);
  }
  const sizeMm: Vec3 = { x: sizes.x as number, y: sizes.y as number, z: sizes.z as number };
  const views = [...boxes].map(([view, box]) => calibrateView(view, box, sizeMm, warnings));
  return { sizeMm, sources: sources as Record<Axis, DimensionSource>, views, warnings };
}

/** @description Pixel coordinates a world point lands on in one calibrated view. */
function pixelOf(p: Vec3, cal: ViewCalibration): { col: number; row: number } {
  const { u, v } = projectToView(p, VIEW_FRAMES[cal.view]);
  return {
    col: Math.floor(cal.uCenterPx + (u - cal.uCenterMm) / cal.mmPerPx),
    row: Math.floor(cal.vCenterPx + (v - cal.vCenterMm) / cal.mmPerPx),
  };
}

/**
 * @description Carve the grid by every registered silhouette: a voxel survives only if its centre
 * projects onto the object in EVERY supplied view. The result is the visual hull — the largest
 * solid consistent with the outlines, which means cavities no outline can see stay filled. That
 * is a property of the method, reported as such, and exactly the gap a depth or LiDAR carve fills.
 * @param grid - Grid to carve, mutated in place. Start it solid ({@link createOccupancyGrid} fill 1).
 * @param registration - From {@link registerSilhouettes}.
 * @param silhouettes - The same masks the registration was built from.
 * @returns How many voxels were removed and how many remain solid.
 * @throws RangeError when a calibrated view has no matching silhouette.
 */
export function carveSilhouettes(
  grid: OccupancyGrid,
  registration: Registration,
  silhouettes: ViewSilhouette[],
): { carved: number; remaining: number } {
  const masks = new Map(silhouettes.map((s) => [s.view, s.mask] as const));
  const lanes = registration.views.map((cal) => {
    const mask = masks.get(cal.view);
    if (!mask) throw new RangeError(`No silhouette supplied for calibrated view "${cal.view}"`);
    return { cal, mask };
  });
  let carved = 0;
  let remaining = 0;
  for (let k = 0; k < grid.nz; k += 1) {
    for (let j = 0; j < grid.ny; j += 1) {
      for (let i = 0; i < grid.nx; i += 1) {
        const at = gridIndex(grid, i, j, k);
        if (grid.data[at] === 0) continue;
        const center = voxelCenter(grid, i, j, k);
        const outside = lanes.some(({ cal, mask }) => {
          const { col, row } = pixelOf(center, cal);
          return maskAt(mask, col, row) === 0;
        });
        if (outside) { grid.data[at] = 0; carved += 1; } else remaining += 1;
      }
    }
  }
  return { carved, remaining };
}

/**
 * @description Voxel edge that puts `resolution` voxels along the object's largest extent.
 * @param sizeMm - Object size.
 * @param resolution - Voxels along the largest axis.
 * @returns Millimetres per voxel.
 * @throws RangeError when the resolution is not a positive integer.
 */
export function chooseVoxelMm(sizeMm: Vec3, resolution: number): number {
  if (!Number.isInteger(resolution) || resolution <= 0) throw new RangeError('Resolution must be a positive integer');
  return Math.max(sizeMm.x, sizeMm.y, sizeMm.z) / resolution;
}
