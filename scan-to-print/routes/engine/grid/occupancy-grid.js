"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the occupancy grid: the sensor-agnostic solid
 *                     |                             | representation every input lane writes into and every output
 *                     |                             | (mesh, drawing, print) reads from. A voxel is 1 (solid) or 0
 *                     |                             | (empty), nothing in between, so a silhouette carve, a depth
 *                     |                             | carve and a point-cloud fill can be composed in any order and
 *                     |                             | the result is the same. The grid always carries a one-voxel
 *                     |                             | empty shell so the mesher meets a closed surface — that shell
 *                     |                             | is the watertightness argument, not a convenience.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_VOXELS_PER_AXIS = void 0;
exports.createOccupancyGrid = createOccupancyGrid;
exports.gridIndex = gridIndex;
exports.voxelCenter = voxelCenter;
exports.axisCount = axisCount;
exports.countSolid = countSolid;
exports.solidVolumeMm3 = solidVolumeMm3;
exports.clearBorder = clearBorder;
exports.solidBounds = solidBounds;
exports.projectGrid = projectGrid;
exports.cloneGrid = cloneGrid;
const raster_types_1 = require("../raster/raster-types");
/** @description Hard ceiling on voxels per axis; 200³ = 8M bytes and a few seconds of carving. */
exports.MAX_VOXELS_PER_AXIS = 200;
/**
 * @description Allocate a grid that encloses a `sizeMm` box centred on X = Y = 0 and resting on
 * Z = 0, plus `padding` empty voxels on every side.
 * @param sizeMm - Object extent along each axis.
 * @param voxelMm - Voxel edge, millimetres.
 * @param padding - Empty shell thickness in voxels. Default 1; must be ≥ 1 for the mesher.
 * @param fill - Initial value for the interior voxels (1 to carve from, 0 to fill into). Default 1.
 * @returns The grid.
 * @throws RangeError when the size or voxel is not positive, or the grid would exceed the ceiling.
 */
function createOccupancyGrid(sizeMm, voxelMm, padding = 1, fill = 1) {
    if (!(voxelMm > 0) || !(sizeMm.x > 0) || !(sizeMm.y > 0) || !(sizeMm.z > 0)) {
        throw new RangeError('Grid size and voxel edge must be positive');
    }
    if (!Number.isInteger(padding) || padding < 1)
        throw new RangeError('Grid padding must be an integer ≥ 1');
    const inner = { x: Math.ceil(sizeMm.x / voxelMm), y: Math.ceil(sizeMm.y / voxelMm), z: Math.ceil(sizeMm.z / voxelMm) };
    const nx = inner.x + 2 * padding;
    const ny = inner.y + 2 * padding;
    const nz = inner.z + 2 * padding;
    if (Math.max(nx, ny, nz) > exports.MAX_VOXELS_PER_AXIS) {
        throw new RangeError(`Grid ${nx}x${ny}x${nz} exceeds ${exports.MAX_VOXELS_PER_AXIS} voxels per axis; use a larger voxel`);
    }
    const originMm = { x: -inner.x * voxelMm / 2 - padding * voxelMm, y: -inner.y * voxelMm / 2 - padding * voxelMm, z: -padding * voxelMm };
    const grid = { nx, ny, nz, voxelMm, originMm, data: new Uint8Array(nx * ny * nz) };
    if (fill === 1) {
        for (let k = padding; k < nz - padding; k += 1) {
            for (let j = padding; j < ny - padding; j += 1) {
                for (let i = padding; i < nx - padding; i += 1)
                    grid.data[gridIndex(grid, i, j, k)] = 1;
            }
        }
    }
    return grid;
}
/**
 * @description Linear index of a voxel.
 * @param grid - The grid.
 * @param i - X index.
 * @param j - Y index.
 * @param k - Z index.
 * @returns `i + nx·(j + ny·k)`.
 */
function gridIndex(grid, i, j, k) {
    return i + grid.nx * (j + grid.ny * k);
}
/**
 * @description World position of a voxel's centre.
 * @param grid - The grid.
 * @param i - X index.
 * @param j - Y index.
 * @param k - Z index.
 * @returns Millimetres.
 */
function voxelCenter(grid, i, j, k) {
    return {
        x: grid.originMm.x + (i + 0.5) * grid.voxelMm,
        y: grid.originMm.y + (j + 0.5) * grid.voxelMm,
        z: grid.originMm.z + (k + 0.5) * grid.voxelMm,
    };
}
/**
 * @description Voxel count along a world axis.
 * @param grid - The grid.
 * @param axis - Axis name.
 * @returns `nx`, `ny` or `nz`.
 */
function axisCount(grid, axis) {
    return axis === 'x' ? grid.nx : axis === 'y' ? grid.ny : grid.nz;
}
/**
 * @description Number of solid voxels.
 * @param grid - The grid.
 * @returns The count.
 */
function countSolid(grid) {
    let n = 0;
    for (let i = 0; i < grid.data.length; i += 1)
        n += grid.data[i];
    return n;
}
/**
 * @description Solid volume, cubic millimetres — the voxel-exact figure the mesh volume is checked
 * against.
 * @param grid - The grid.
 * @returns `countSolid · voxelMm³`.
 */
function solidVolumeMm3(grid) {
    return countSolid(grid) * grid.voxelMm ** 3;
}
/**
 * @description Force the outermost voxel layer to empty. The mesher requires it; every lane calls
 * it before meshing so a point cloud that reached the grid edge cannot leave an open surface.
 * @param grid - The grid, mutated in place.
 * @returns Number of voxels cleared.
 */
function clearBorder(grid) {
    let cleared = 0;
    for (let k = 0; k < grid.nz; k += 1) {
        for (let j = 0; j < grid.ny; j += 1) {
            for (let i = 0; i < grid.nx; i += 1) {
                const onBorder = i === 0 || j === 0 || k === 0 || i === grid.nx - 1 || j === grid.ny - 1 || k === grid.nz - 1;
                if (!onBorder)
                    continue;
                const at = gridIndex(grid, i, j, k);
                if (grid.data[at] === 1) {
                    grid.data[at] = 0;
                    cleared += 1;
                }
            }
        }
    }
    return cleared;
}
/**
 * @description World bounds of the solid voxels.
 * @param grid - The grid.
 * @returns Min/max corners in millimetres, or null when nothing is solid.
 */
function solidBounds(grid) {
    let found = false;
    const lo = { x: Infinity, y: Infinity, z: Infinity };
    const hi = { x: -Infinity, y: -Infinity, z: -Infinity };
    for (let k = 0; k < grid.nz; k += 1) {
        for (let j = 0; j < grid.ny; j += 1) {
            for (let i = 0; i < grid.nx; i += 1) {
                if (grid.data[gridIndex(grid, i, j, k)] === 0)
                    continue;
                found = true;
                lo.x = Math.min(lo.x, i);
                lo.y = Math.min(lo.y, j);
                lo.z = Math.min(lo.z, k);
                hi.x = Math.max(hi.x, i);
                hi.y = Math.max(hi.y, j);
                hi.z = Math.max(hi.z, k);
            }
        }
    }
    if (!found)
        return null;
    const v = grid.voxelMm;
    const o = grid.originMm;
    return {
        min: { x: o.x + lo.x * v, y: o.y + lo.y * v, z: o.z + lo.z * v },
        max: { x: o.x + (hi.x + 1) * v, y: o.y + (hi.y + 1) * v, z: o.z + (hi.z + 1) * v },
    };
}
/** @description Index along a signed axis, flipped when the sign is negative. */
function indexAlong(grid, axis, sign, i, j, k) {
    const raw = axis === 'x' ? i : axis === 'y' ? j : k;
    return sign === 1 ? raw : axisCount(grid, axis) - 1 - raw;
}
/**
 * @description Orthographic projection of the solid along a view's look axis: a mask one pixel
 * per voxel in the view's image frame (column = `u`, row = `v`, both honouring the frame signs).
 * This is what the drawing draws and what a carver would see if it looked at the result — so a
 * carved grid re-projected into the same view reproduces the silhouette that carved it.
 * @param grid - The grid.
 * @param frame - The view.
 * @returns A mask of `axisCount(u) × axisCount(v)` pixels.
 */
function projectGrid(grid, frame) {
    const width = axisCount(grid, frame.u.axis);
    const height = axisCount(grid, frame.v.axis);
    const mask = (0, raster_types_1.createMask)(width, height);
    for (let k = 0; k < grid.nz; k += 1) {
        for (let j = 0; j < grid.ny; j += 1) {
            for (let i = 0; i < grid.nx; i += 1) {
                if (grid.data[gridIndex(grid, i, j, k)] === 0)
                    continue;
                const col = indexAlong(grid, frame.u.axis, frame.u.sign, i, j, k);
                const row = indexAlong(grid, frame.v.axis, frame.v.sign, i, j, k);
                mask.data[row * width + col] = 1;
            }
        }
    }
    return mask;
}
/**
 * @description Deep copy, so a lane can carve a working copy and keep the input for a report.
 * @param grid - The grid.
 * @returns An independent copy.
 */
function cloneGrid(grid) {
    return { ...grid, originMm: { ...grid.originMm }, data: new Uint8Array(grid.data) };
}
//# sourceMappingURL=occupancy-grid.js.map