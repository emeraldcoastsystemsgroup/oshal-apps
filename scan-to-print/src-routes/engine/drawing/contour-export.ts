/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the CAD bridge: the outer outline of the
 *                     |                             | front, top and right re-projections in WORLD millimetres
 *                     |                             | (the same frame the grid lives in: footprint centred, Z from
 *                     |                             | 0, front −Y), exactly the pairs CAD Studio's `contours` base
 *                     |                             | extrudes and intersects. Pixel corners map through the
 *                     |                             | grid's origin and the view frame's signs, so the outline is
 *                     |                             | the grid's, not a re-estimate; the voxel staircase is then
 *                     |                             | simplified within half a voxel and capped at a point budget.
 */

import type { Point2D } from '../geometry/geometry-types';
import type { OccupancyGrid } from '../grid/occupancy-grid';
import { type ViewFrame, type ViewName, VIEW_FRAMES } from '../grid/views';
import type { Mask } from '../raster/raster-types';
import { traceContours } from './contours';
import { simplifyToBudget } from './simplify';

/** The three views whose outlines define a solid by intersection (CAD Studio's `contours` base). */
export const CONTOUR_VIEWS = ['front', 'top', 'right'] as const;
export type ContourView = typeof CONTOUR_VIEWS[number];

/** @description The exported outlines. Points are `[u, v]` world millimetres in the view's axes: front (X, Z), top (X, Y), right (Y, Z). */
export interface ContourExport {
  views: Partial<Record<ContourView, number[][]>>;
  sizeMm: { x: number; y: number; z: number };
  voxelMm: number;
  /** Simplification tolerance actually used per view, mm. */
  toleranceMm: Partial<Record<ContourView, number>>;
  /** Vertices per view. */
  pointCounts: Partial<Record<ContourView, number>>;
}

function loopArea(loop: Point2D[]): number {
  let twice = 0;
  for (let i = 0; i < loop.length; i += 1) {
    const a = loop[i], b = loop[(i + 1) % loop.length];
    twice += a.x * b.y - b.x * a.y;
  }
  return Math.abs(twice) / 2;
}

function axisCount(grid: OccupancyGrid, axis: 'x' | 'y' | 'z'): number {
  return axis === 'x' ? grid.nx : axis === 'y' ? grid.ny : grid.nz;
}

/** A pixel CORNER coordinate along one image axis → world millimetres along that axis. */
function cornerToWorld(grid: OccupancyGrid, frame: { axis: 'x' | 'y' | 'z'; sign: 1 | -1 }, corner: number): number {
  const origin = grid.originMm[frame.axis];
  const n = axisCount(grid, frame.axis);
  return origin + (frame.sign === 1 ? corner : n - corner) * grid.voxelMm;
}

/**
 * @description The outer outline of one view in world millimetres.
 * @param grid - The solid's grid (for origin, counts and voxel size).
 * @param frame - The view frame.
 * @param mask - The view's re-projection.
 * @param maxPoints - Vertex budget.
 * @returns The outline and the tolerance used, or null when the mask is empty.
 */
export function viewOutlineMm(grid: OccupancyGrid, frame: ViewFrame, mask: Mask, maxPoints: number): { points: number[][]; toleranceMm: number } | null {
  const loops = traceContours(mask);
  if (!loops.length) return null;
  let outer = loops[0];
  for (const loop of loops) if (loopArea(loop) > loopArea(outer)) outer = loop;
  const world = outer.map((p) => ({ x: cornerToWorld(grid, frame.u, p.x), y: cornerToWorld(grid, frame.v, p.y) }));
  const { loop, epsilon } = simplifyToBudget(world, grid.voxelMm * 0.5, maxPoints);
  return { points: loop.map((p) => [Number(p.x.toFixed(3)), Number(p.y.toFixed(3))]), toleranceMm: epsilon };
}

/**
 * @description Export the front / top / right outlines of a reconstruction in world millimetres.
 * @param grid - The reconstructed grid.
 * @param projections - Per-view re-projections (from `projectGrid`).
 * @param sizeMm - The report's extents.
 * @param maxPoints - Vertex budget per view (CAD Studio accepts up to 2000). Default 1500.
 * @returns The export.
 */
export function exportContours(grid: OccupancyGrid, projections: Partial<Record<ViewName, Mask>>, sizeMm: { x: number; y: number; z: number }, maxPoints = 1500): ContourExport {
  const out: ContourExport = { views: {}, sizeMm, voxelMm: grid.voxelMm, toleranceMm: {}, pointCounts: {} };
  for (const view of CONTOUR_VIEWS) {
    const mask = projections[view];
    if (!mask) continue;
    const outline = viewOutlineMm(grid, VIEW_FRAMES[view], mask, maxPoints);
    if (!outline) continue;
    out.views[view] = outline.points;
    out.toleranceMm[view] = Number(outline.toleranceMm.toFixed(4));
    out.pointCounts[view] = outline.points.length;
  }
  return out;
}
