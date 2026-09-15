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
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Joint registration (BACKLOG B10): the greedy propagation from the
 *                     |                             | known dimension is replaced by ONE least-squares fit in log space
 *                     |                             | over every view's two axis measurements (known dimensions held
 *                     |                             | exact), solved directly through the normal equations — still no
 *                     |                             | iteration. Each view now reports a residual, so a skewed photo is
 *                     |                             | named with a number instead of blamed by the order the views were
 *                     |                             | read in. Consistent views register exactly as before.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Export `SCALE_DISAGREEMENT` so the video lane's frame suggestion
 *                     |                             | (BACKLOG B12) refuses a frame by the same 10 % the registration
 *                     |                             | warns at, rather than a second number that could drift.
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

/** @description One view's misfit against the joint solution, so a skewed photo is named with a number. */
export interface ViewResidual {
  /** Which view. */
  view: ViewName;
  /** Signed fraction by which this view's outline along image-right exceeds the fitted extent of that axis. */
  u: number;
  /** The same along image-down. */
  v: number;
  /** How far the view's own proportions sit from the joint fit, as a fraction; above 10 % it warns. */
  disagreement: number;
}

/** @description The resolved object size and the per-view calibrations. */
export interface Registration {
  /** Object extent along each world axis, millimetres. */
  sizeMm: Vec3;
  /** How each extent was obtained. */
  sources: Record<Axis, DimensionSource>;
  /** One calibration per supplied view. */
  views: ViewCalibration[];
  /** One misfit per supplied view, in the order supplied; all zero when the views agree. */
  residuals: ViewResidual[];
  /** Consistency and coverage problems, human-readable. */
  warnings: string[];
}

/**
 * @description Disagreement between a view's proportions and what it should show, above which a view
 * is called not square to its face: the registration warns past it, and the video lane's frame
 * suggestion will not propose a frame past it.
 */
export const SCALE_DISAGREEMENT = 0.1;

/**
 * @description Significant digits the joint fit is rounded to. Floating-point roundoff in the
 * log-space solve is around 1e-15; a photograph resolves about 1 part in 1e3. Rounding at 12 digits
 * sits between the two, so roundoff can never push an extent across a voxel boundary and move the
 * grid, while no measurement is changed.
 */
const FIT_DIGITS = 12;

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
 * @description Axes whose size can be reached from the known dimensions: a view that shows one
 * reached axis reaches the other it shows. What is left is visible to no view that connects to a
 * measurement, and is assumed.
 */
function reachableAxes(boxes: Map<ViewName, PixelBox>, known: Set<Axis>): Set<Axis> {
  const reached = new Set(known);
  let grew = true;
  while (grew) {
    grew = false;
    for (const view of boxes.keys()) {
      const { u, v } = VIEW_FRAMES[view];
      if (reached.has(u.axis) === reached.has(v.axis)) continue;
      reached.add(u.axis);
      reached.add(v.axis);
      grew = true;
    }
  }
  return reached;
}

/** @description Solve `M x = b` by Gaussian elimination with partial pivoting; `M` is consumed. */
function solveLinear(m: Float64Array[], b: Float64Array): Float64Array {
  const n = b.length;
  for (let c = 0; c < n; c += 1) {
    let pivot = c;
    for (let r = c + 1; r < n; r += 1) if (Math.abs(m[r][c]) > Math.abs(m[pivot][c])) pivot = r;
    if (Math.abs(m[pivot][c]) < 1e-12) throw new RangeError('Registration is under-determined: a view is not connected to any known dimension');
    [m[c], m[pivot]] = [m[pivot], m[c]];
    [b[c], b[pivot]] = [b[pivot], b[c]];
    for (let r = c + 1; r < n; r += 1) {
      const f = m[r][c] / m[c][c];
      for (let k = c; k < n; k += 1) m[r][k] -= f * m[c][k];
      b[r] -= f * b[c];
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r -= 1) {
    let s = b[r];
    for (let k = r + 1; k < n; k += 1) s -= m[r][k] * x[k];
    x[r] = s / m[r][r];
  }
  return x;
}

/**
 * @description The joint fit. Every view says, for each of its two image axes,
 * `log extent(axis) = log mmPerPx(view) + log pixels`: linear in log space. Unknowns are the log
 * extent of each free axis and the log scale of each view; fixed axes move to the right-hand side.
 * Least squares over all equations at once, solved through the normal equations.
 */
function solveLogFit(boxes: Map<ViewName, PixelBox>, fixedLog: Partial<Record<Axis, number>>, free: Axis[]): { logSize: Record<Axis, number>; logScale: Map<ViewName, number> } {
  const views = [...boxes.keys()];
  const n = free.length + views.length;
  const ata = Array.from({ length: n }, () => new Float64Array(n));
  const atb = new Float64Array(n);
  views.forEach((view, vi) => {
    const { uPx, vPx } = pixelExtents(boxes.get(view) as PixelBox);
    const frame = VIEW_FRAMES[view];
    for (const [axis, px] of [[frame.u.axis, uPx], [frame.v.axis, vPx]] as [Axis, number][]) {
      const row = new Float64Array(n);
      const ai = free.indexOf(axis);
      if (ai >= 0) row[ai] = 1;
      row[free.length + vi] = -1;
      const rhs = Math.log(px) - (ai >= 0 ? 0 : (fixedLog[axis] as number));
      for (let r = 0; r < n; r += 1) {
        if (row[r] === 0) continue;
        atb[r] += row[r] * rhs;
        for (let c = 0; c < n; c += 1) ata[r][c] += row[r] * row[c];
      }
    }
  });
  const x = solveLinear(ata, atb);
  const logSize = { ...fixedLog } as Record<Axis, number>;
  free.forEach((axis, i) => { logSize[axis] = x[i]; });
  return { logSize, logScale: new Map(views.map((view, vi) => [view, x[free.length + vi]] as const)) };
}

/** @description Round to the fit's significant digits so solver roundoff never moves a voxel boundary. */
function settle(value: number): number {
  return Number(value.toPrecision(FIT_DIGITS));
}

/** @description A view's misfit: how far its outline along each image axis is from the fitted extent. */
function residualOf(view: ViewName, box: PixelBox, mmPerPx: number, sizeMm: Vec3): ViewResidual {
  const frame = VIEW_FRAMES[view];
  const { uPx, vPx } = pixelExtents(box);
  const u = settle((uPx * mmPerPx) / sizeMm[frame.u.axis] - 1);
  const v = settle((vPx * mmPerPx) / sizeMm[frame.v.axis] - 1);
  return { view, u, v, disagreement: settle(1 - Math.min(1 + u, 1 + v) / Math.max(1 + u, 1 + v)) };
}

/** @description Build one view's calibration from the fitted size and its fitted scale. */
function calibrateView(view: ViewName, box: PixelBox, sizeMm: Vec3, mmPerPx: number): ViewCalibration {
  const frame = VIEW_FRAMES[view];
  const center: Vec3 = { x: 0, y: 0, z: sizeMm.z / 2 };
  return {
    view,
    mmPerPx,
    bbox: box,
    uCenterPx: (box.minX + box.maxX + 1) / 2,
    vCenterPx: (box.minY + box.maxY + 1) / 2,
    uCenterMm: readAxis(center, frame.u),
    vCenterMm: readAxis(center, frame.v),
  };
}

/** @description Pin each axis the fit cannot reach to the first known dimension, and say so. */
function assumeUnreachable(reached: Set<Axis>, known: KnownDimension[], fixedLog: Partial<Record<Axis, number>>, sources: Partial<Record<Axis, DimensionSource>>, warnings: string[]): void {
  for (const axis of ['x', 'y', 'z'] as Axis[]) {
    if (reached.has(axis)) continue;
    fixedLog[axis] = Math.log(known[0].mm);
    sources[axis] = 'assumed';
    warnings.push(`Extent along ${axis.toUpperCase()} is not visible in any supplied view; assumed ${known[0].mm} mm. Add a view that shows it, or enter it as a known dimension.`);
  }
}

/**
 * @description Resolve the object's world size and every view's pixel calibration from the
 * silhouettes and the known dimension(s), JOINTLY: one least-squares fit in log space over every
 * view's two axis measurements, with the known dimensions held exact. Each view then reports its
 * residual, so a photo that is not square to its face is named with a number rather than inferred
 * from the order the views happened to be read in. Three views that close a single loop share
 * that loop's misfit equally, since no fit can tell which of the three is skewed. A fourth view
 * closing a second loop makes the skewed view carry the LARGEST residual, not the only one: least
 * squares averages, so a view measuring the same axis pair carries part of the error. Warnings
 * are ordered worst first. An axis no supplied view connects to a measurement is
 * ASSUMED equal to the first known dimension and flagged; the drawing carries that flag.
 * @param silhouettes - One mask per supplied view.
 * @param known - One to three measured extents.
 * @returns The registration.
 * @throws RangeError when the inputs cannot register (see {@link validateInputs}).
 */
export function registerSilhouettes(silhouettes: ViewSilhouette[], known: KnownDimension[]): Registration {
  const boxes = validateInputs(silhouettes, known);
  const fixedLog: Partial<Record<Axis, number>> = {};
  const sources: Partial<Record<Axis, DimensionSource>> = {};
  for (const dim of known) { fixedLog[dim.axis] = Math.log(dim.mm); sources[dim.axis] = 'known'; }
  const reached = reachableAxes(boxes, new Set(known.map((d) => d.axis)));
  const warnings: string[] = [];
  assumeUnreachable(reached, known, fixedLog, sources, warnings);
  const free = (['x', 'y', 'z'] as Axis[]).filter((axis) => fixedLog[axis] === undefined);
  for (const axis of free) sources[axis] = 'derived';
  const fit = solveLogFit(boxes, fixedLog, free);
  const sizeOf = (axis: Axis) => (sources[axis] === 'derived' ? settle(Math.exp(fit.logSize[axis])) : Math.exp(fixedLog[axis] as number));
  const sizeMm: Vec3 = { x: sizeOf('x'), y: sizeOf('y'), z: sizeOf('z') };
  for (const dim of known) sizeMm[dim.axis] = dim.mm;
  for (const axis of ['x', 'y', 'z'] as Axis[]) if (sources[axis] === 'assumed') sizeMm[axis] = known[0].mm;
  const views: ViewCalibration[] = [];
  const residuals: ViewResidual[] = [];
  for (const [view, box] of boxes) {
    const mmPerPx = settle(Math.exp(fit.logScale.get(view) as number));
    views.push(calibrateView(view, box, sizeMm, mmPerPx));
    residuals.push(residualOf(view, box, mmPerPx, sizeMm));
  }
  return { sizeMm, sources: sources as Record<Axis, DimensionSource>, views, residuals, warnings: [...warnings, ...misfitWarnings(residuals)] };
}

/** @description One warning per view past the threshold, worst first (ties keep the supplied order). */
function misfitWarnings(residuals: ViewResidual[]): string[] {
  return residuals
    .filter((r) => r.disagreement > SCALE_DISAGREEMENT)
    .sort((a, b) => b.disagreement - a.disagreement)
    .map((r) => {
      const { u, v } = VIEW_FRAMES[r.view];
      return `${r.view} view: its ${u.axis}/${v.axis} proportions disagree with the joint fit of all views by ${Math.round(r.disagreement * 100)}% (outline ${signedPercent(r.u)} along ${u.axis.toUpperCase()}, ${signedPercent(r.v)} along ${v.axis.toUpperCase()}); the photo may not be square to the face.`;
    });
}

/** @description `+12%` / `-3%` for a signed fraction. */
function signedPercent(fraction: number): string {
  const pct = Math.round(fraction * 100);
  return `${pct >= 0 ? '+' : ''}${pct}%`;
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
