/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — depth-map carving: the LiDAR / ToF / stereo
 *                     |                             | lane of the same occupancy grid. A silhouette says "nothing is
 *                     |                             | here" for whole rays; a depth map says "nothing is here UNTIL
 *                     |                             | this range", which is the information a silhouette cannot
 *                     |                             | carry and the reason a cavity the outlines miss becomes
 *                     |                             | recoverable. The contract is deliberately narrow: an
 *                     |                             | orthographic range image in one of the six canonical views,
 *                     |                             | with NaN meaning NO RETURN (unknown, never "empty"), so a
 *                     |                             | sensor's silence cannot erase material. `renderDepth` is the
 *                     |                             | honest sim sibling: it produces such a map FROM a grid, so the
 *                     |                             | lane is exercised end to end with no hardware in the loop.
 */

import type { Vec3 } from '../geometry/geometry-types';
import { type OccupancyGrid, gridIndex, voxelCenter } from './occupancy-grid';
import { type ViewName, VIEW_FRAMES, type ViewFrame, projectToView, readAxis } from './views';

/**
 * @description An orthographic range image in one canonical view. `data[row · width + col]` is the
 * distance, in millimetres, from the sensor plane to the first surface along that pixel's ray;
 * NaN (or ±Infinity) means the sensor got no return there.
 */
export interface DepthMap {
  /** Which canonical view the sensor looked from. */
  view: ViewName;
  /** Pixel columns. */
  width: number;
  /** Pixel rows. */
  height: number;
  /** Millimetres per pixel. */
  mmPerPx: number;
  /** Pixel column of world `u` = `uCenterMm`. */
  uCenterPx: number;
  /** Pixel row of world `v` = `vCenterMm`. */
  vCenterPx: number;
  /** World `u` coordinate (mm) at `uCenterPx`. */
  uCenterMm: number;
  /** World `v` coordinate (mm) at `vCenterPx`. */
  vCenterMm: number;
  /** Signed-look-axis coordinate of the sensor plane (depth 0), millimetres. */
  planeMm: number;
  /** `width · height` ranges. */
  data: Float32Array;
}

/** @description Depth of a world point measured from the map's sensor plane along the look axis. */
function depthOf(p: Vec3, frame: ViewFrame, planeMm: number): number {
  return readAxis(p, frame.look) - planeMm;
}

/** @description Pixel a world point lands on in the map, or null when it falls outside the image. */
function pixelOf(p: Vec3, map: DepthMap, frame: ViewFrame): number | null {
  const { u, v } = projectToView(p, frame);
  const col = Math.floor(map.uCenterPx + (u - map.uCenterMm) / map.mmPerPx);
  const row = Math.floor(map.vCenterPx + (v - map.vCenterMm) / map.mmPerPx);
  if (col < 0 || row < 0 || col >= map.width || row >= map.height) return null;
  return row * map.width + col;
}

/**
 * @description Carve free space: every solid voxel whose centre lies strictly between the sensor
 * plane and the measured surface (by more than half a voxel) is removed. Voxels at or beyond the
 * surface, and voxels under a no-return pixel, are left as they were — behind a surface the
 * sensor knows nothing, and silence is not emptiness.
 * @param grid - Grid to carve, mutated in place.
 * @param map - The range image.
 * @returns Voxels removed.
 */
export function carveDepth(grid: OccupancyGrid, map: DepthMap): number {
  const frame = VIEW_FRAMES[map.view];
  const half = grid.voxelMm / 2;
  let carved = 0;
  for (let k = 0; k < grid.nz; k += 1) {
    for (let j = 0; j < grid.ny; j += 1) {
      for (let i = 0; i < grid.nx; i += 1) {
        const at = gridIndex(grid, i, j, k);
        if (grid.data[at] === 0) continue;
        const center = voxelCenter(grid, i, j, k);
        const px = pixelOf(center, map, frame);
        if (px === null) continue;
        const range = map.data[px];
        if (!Number.isFinite(range)) continue;
        if (depthOf(center, frame, map.planeMm) < range - half) { grid.data[at] = 0; carved += 1; }
      }
    }
  }
  return carved;
}

/** @description Options for {@link renderDepth}. Pixel size and image bounds are the caller's. */
export interface RenderDepthOptions {
  /** Millimetres per pixel. */
  mmPerPx: number;
  /** Pixel columns. */
  width: number;
  /** Pixel rows. */
  height: number;
  /** Where the sensor plane sits along the signed look axis, millimetres. Default: just outside the grid. */
  planeMm?: number;
}

/** @description World point at a given (u, v, depth) in a view — the inverse of the projection. */
function worldAt(frame: ViewFrame, u: number, v: number, lookCoord: number): Vec3 {
  const p: Vec3 = { x: 0, y: 0, z: 0 };
  p[frame.u.axis] = frame.u.sign * u;
  p[frame.v.axis] = frame.v.sign * v;
  p[frame.look.axis] = frame.look.sign * lookCoord;
  return p;
}

/** @description Is the voxel containing this world point solid? Outside the grid counts as empty. */
function solidAt(grid: OccupancyGrid, p: Vec3): boolean {
  const i = Math.floor((p.x - grid.originMm.x) / grid.voxelMm);
  const j = Math.floor((p.y - grid.originMm.y) / grid.voxelMm);
  const k = Math.floor((p.z - grid.originMm.z) / grid.voxelMm);
  if (i < 0 || j < 0 || k < 0 || i >= grid.nx || j >= grid.ny || k >= grid.nz) return false;
  return grid.data[gridIndex(grid, i, j, k)] === 1;
}

/** @description Signed-look-axis coordinate one voxel outside the grid on the sensor's side. */
function defaultPlane(grid: OccupancyGrid, frame: ViewFrame): number {
  const lo = grid.originMm[frame.look.axis];
  const hi = lo + (frame.look.axis === 'x' ? grid.nx : frame.look.axis === 'y' ? grid.ny : grid.nz) * grid.voxelMm;
  return frame.look.sign === 1 ? lo - grid.voxelMm : -(hi + grid.voxelMm);
}

/**
 * @description Simulate an orthographic depth sensor looking at the grid from one canonical view:
 * march each pixel's ray from the sensor plane until it enters a solid voxel and record the range;
 * rays that exit the grid without a hit record NaN. Deterministic, hardware-free, and the exact
 * shape {@link carveDepth} consumes — a real LiDAR/ToF export goes through the same struct.
 * @param grid - The solid to image.
 * @param view - Which canonical view the sensor looks from.
 * @param options - Pixel size and image bounds; see {@link RenderDepthOptions}.
 * @returns A depth map centred on the object's bounding-box centre.
 */
export function renderDepth(grid: OccupancyGrid, view: ViewName, options: RenderDepthOptions): DepthMap {
  const frame = VIEW_FRAMES[view];
  const planeMm = options.planeMm ?? defaultPlane(grid, frame);
  const extentLook = (frame.look.axis === 'x' ? grid.nx : frame.look.axis === 'y' ? grid.ny : grid.nz) * grid.voxelMm;
  const step = grid.voxelMm / 4;
  const center: Vec3 = { x: 0, y: 0, z: grid.originMm.z + (grid.nz * grid.voxelMm) / 2 };
  const map: DepthMap = {
    view, width: options.width, height: options.height, mmPerPx: options.mmPerPx,
    uCenterPx: options.width / 2, vCenterPx: options.height / 2,
    uCenterMm: readAxis(center, frame.u), vCenterMm: readAxis(center, frame.v),
    planeMm, data: new Float32Array(options.width * options.height).fill(NaN),
  };
  const maxRange = extentLook + 2 * grid.voxelMm;
  for (let row = 0; row < map.height; row += 1) {
    for (let col = 0; col < map.width; col += 1) {
      const u = map.uCenterMm + (col + 0.5 - map.uCenterPx) * map.mmPerPx;
      const v = map.vCenterMm + (row + 0.5 - map.vCenterPx) * map.mmPerPx;
      for (let d = 0; d <= maxRange; d += step) {
        if (solidAt(grid, worldAt(frame, u, v, planeMm + d))) { map.data[row * map.width + col] = d; break; }
      }
    }
  }
  return map;
}
