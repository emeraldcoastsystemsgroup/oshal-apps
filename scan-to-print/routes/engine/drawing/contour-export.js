"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONTOUR_VIEWS = void 0;
exports.viewOutlineMm = viewOutlineMm;
exports.exportContours = exportContours;
const views_1 = require("../grid/views");
const contours_1 = require("./contours");
const simplify_1 = require("./simplify");
/** The three views whose outlines define a solid by intersection (CAD Studio's `contours` base). */
exports.CONTOUR_VIEWS = ['front', 'top', 'right'];
function loopArea(loop) {
    let twice = 0;
    for (let i = 0; i < loop.length; i += 1) {
        const a = loop[i], b = loop[(i + 1) % loop.length];
        twice += a.x * b.y - b.x * a.y;
    }
    return Math.abs(twice) / 2;
}
function axisCount(grid, axis) {
    return axis === 'x' ? grid.nx : axis === 'y' ? grid.ny : grid.nz;
}
/** A pixel CORNER coordinate along one image axis → world millimetres along that axis. */
function cornerToWorld(grid, frame, corner) {
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
function viewOutlineMm(grid, frame, mask, maxPoints) {
    const loops = (0, contours_1.traceContours)(mask);
    if (!loops.length)
        return null;
    let outer = loops[0];
    for (const loop of loops)
        if (loopArea(loop) > loopArea(outer))
            outer = loop;
    const world = outer.map((p) => ({ x: cornerToWorld(grid, frame.u, p.x), y: cornerToWorld(grid, frame.v, p.y) }));
    const { loop, epsilon } = (0, simplify_1.simplifyToBudget)(world, grid.voxelMm * 0.5, maxPoints);
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
function exportContours(grid, projections, sizeMm, maxPoints = 1500) {
    const out = { views: {}, sizeMm, voxelMm: grid.voxelMm, toleranceMm: {}, pointCounts: {} };
    for (const view of exports.CONTOUR_VIEWS) {
        const mask = projections[view];
        if (!mask)
            continue;
        const outline = viewOutlineMm(grid, views_1.VIEW_FRAMES[view], mask, maxPoints);
        if (!outline)
            continue;
        out.views[view] = outline.points;
        out.toleranceMm[view] = Number(outline.toleranceMm.toFixed(4));
        out.pointCounts[view] = outline.points.length;
    }
    return out;
}
//# sourceMappingURL=contour-export.js.map