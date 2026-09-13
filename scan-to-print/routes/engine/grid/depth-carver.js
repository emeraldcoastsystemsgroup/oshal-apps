"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.carveDepth = carveDepth;
exports.renderDepth = renderDepth;
const occupancy_grid_1 = require("./occupancy-grid");
const views_1 = require("./views");
/** @description Depth of a world point measured from the map's sensor plane along the look axis. */
function depthOf(p, frame, planeMm) {
    return (0, views_1.readAxis)(p, frame.look) - planeMm;
}
/** @description Pixel a world point lands on in the map, or null when it falls outside the image. */
function pixelOf(p, map, frame) {
    const { u, v } = (0, views_1.projectToView)(p, frame);
    const col = Math.floor(map.uCenterPx + (u - map.uCenterMm) / map.mmPerPx);
    const row = Math.floor(map.vCenterPx + (v - map.vCenterMm) / map.mmPerPx);
    if (col < 0 || row < 0 || col >= map.width || row >= map.height)
        return null;
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
function carveDepth(grid, map) {
    const frame = views_1.VIEW_FRAMES[map.view];
    const half = grid.voxelMm / 2;
    let carved = 0;
    for (let k = 0; k < grid.nz; k += 1) {
        for (let j = 0; j < grid.ny; j += 1) {
            for (let i = 0; i < grid.nx; i += 1) {
                const at = (0, occupancy_grid_1.gridIndex)(grid, i, j, k);
                if (grid.data[at] === 0)
                    continue;
                const center = (0, occupancy_grid_1.voxelCenter)(grid, i, j, k);
                const px = pixelOf(center, map, frame);
                if (px === null)
                    continue;
                const range = map.data[px];
                if (!Number.isFinite(range))
                    continue;
                if (depthOf(center, frame, map.planeMm) < range - half) {
                    grid.data[at] = 0;
                    carved += 1;
                }
            }
        }
    }
    return carved;
}
/** @description World point at a given (u, v, depth) in a view — the inverse of the projection. */
function worldAt(frame, u, v, lookCoord) {
    const p = { x: 0, y: 0, z: 0 };
    p[frame.u.axis] = frame.u.sign * u;
    p[frame.v.axis] = frame.v.sign * v;
    p[frame.look.axis] = frame.look.sign * lookCoord;
    return p;
}
/** @description Is the voxel containing this world point solid? Outside the grid counts as empty. */
function solidAt(grid, p) {
    const i = Math.floor((p.x - grid.originMm.x) / grid.voxelMm);
    const j = Math.floor((p.y - grid.originMm.y) / grid.voxelMm);
    const k = Math.floor((p.z - grid.originMm.z) / grid.voxelMm);
    if (i < 0 || j < 0 || k < 0 || i >= grid.nx || j >= grid.ny || k >= grid.nz)
        return false;
    return grid.data[(0, occupancy_grid_1.gridIndex)(grid, i, j, k)] === 1;
}
/** @description Signed-look-axis coordinate one voxel outside the grid on the sensor's side. */
function defaultPlane(grid, frame) {
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
function renderDepth(grid, view, options) {
    const frame = views_1.VIEW_FRAMES[view];
    const planeMm = options.planeMm ?? defaultPlane(grid, frame);
    const extentLook = (frame.look.axis === 'x' ? grid.nx : frame.look.axis === 'y' ? grid.ny : grid.nz) * grid.voxelMm;
    const step = grid.voxelMm / 4;
    const center = { x: 0, y: 0, z: grid.originMm.z + (grid.nz * grid.voxelMm) / 2 };
    const map = {
        view, width: options.width, height: options.height, mmPerPx: options.mmPerPx,
        uCenterPx: options.width / 2, vCenterPx: options.height / 2,
        uCenterMm: (0, views_1.readAxis)(center, frame.u), vCenterMm: (0, views_1.readAxis)(center, frame.v),
        planeMm, data: new Float32Array(options.width * options.height).fill(NaN),
    };
    const maxRange = extentLook + 2 * grid.voxelMm;
    for (let row = 0; row < map.height; row += 1) {
        for (let col = 0; col < map.width; col += 1) {
            const u = map.uCenterMm + (col + 0.5 - map.uCenterPx) * map.mmPerPx;
            const v = map.vCenterMm + (row + 0.5 - map.vCenterPx) * map.mmPerPx;
            for (let d = 0; d <= maxRange; d += step) {
                if (solidAt(grid, worldAt(frame, u, v, planeMm + d))) {
                    map.data[row * map.width + col] = d;
                    break;
                }
            }
        }
    }
    return map;
}
//# sourceMappingURL=depth-carver.js.map