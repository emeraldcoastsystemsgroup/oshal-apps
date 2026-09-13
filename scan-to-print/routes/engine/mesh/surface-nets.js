"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — naive surface nets (Gibson 1998) over the
 *                     |                             | binary occupancy grid. Chosen over marching cubes because it
 *                     |                             | needs no 256-entry case table to get wrong: one vertex per
 *                     |                             | mixed cell at the centroid of its crossing-edge midpoints, one
 *                     |                             | quad per crossing grid edge joining the four cells around it,
 *                     |                             | winding fixed by which end of the edge is solid. On a grid
 *                     |                             | with an empty outer shell every crossing edge has four cells,
 *                     |                             | so every quad edge is shared by exactly two quads — that is
 *                     |                             | the watertightness argument, and the spec checks it with an
 *                     |                             | edge census rather than trusting it. Optional Laplacian
 *                     |                             | smoothing keeps each vertex inside its own cell, so it can
 *                     |                             | round a staircase but never fold the surface through itself.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.surfaceNets = surfaceNets;
const occupancy_grid_1 = require("../grid/occupancy-grid");
/** @description The three cyclic axis orders (a, b, c) with unit index strides for cells. */
const AXES = [[0, 1, 2], [1, 2, 0], [2, 0, 1]];
/** @description Corner offsets of a cell, index bit 0 = +x, bit 1 = +y, bit 2 = +z. */
const CORNERS = [
    [0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1],
];
/** @description The 12 cube edges as corner-index pairs. */
const EDGES = [
    [0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7],
];
/** @description Linear cell index for a grid whose cells sit between voxel centres. */
function cellIndex(grid, i, j, k) {
    return i + (grid.nx - 1) * (j + (grid.ny - 1) * k);
}
/** @description Place the dual vertex of one mixed cell; returns null for a uniform cell. */
function cellVertex(grid, i, j, k) {
    const occ = CORNERS.map(([di, dj, dk]) => grid.data[(0, occupancy_grid_1.gridIndex)(grid, i + di, j + dj, k + dk)]);
    let solid = 0;
    for (const v of occ)
        solid += v;
    if (solid === 0 || solid === 8)
        return null;
    const pos = CORNERS.map(([di, dj, dk]) => (0, occupancy_grid_1.voxelCenter)(grid, i + di, j + dj, k + dk));
    const sum = { x: 0, y: 0, z: 0 };
    let crossings = 0;
    for (const [a, b] of EDGES) {
        if (occ[a] === occ[b])
            continue;
        sum.x += (pos[a].x + pos[b].x) / 2;
        sum.y += (pos[a].y + pos[b].y) / 2;
        sum.z += (pos[a].z + pos[b].z) / 2;
        crossings += 1;
    }
    return { p: { x: sum.x / crossings, y: sum.y / crossings, z: sum.z / crossings }, lo: pos[0], hi: pos[7] };
}
/** @description Pass 1: one dual vertex per mixed cell. */
function placeVertices(grid, cells, vertices, boxes) {
    for (let k = 0; k < grid.nz - 1; k += 1) {
        for (let j = 0; j < grid.ny - 1; j += 1) {
            for (let i = 0; i < grid.nx - 1; i += 1) {
                const placed = cellVertex(grid, i, j, k);
                if (!placed)
                    continue;
                cells[cellIndex(grid, i, j, k)] = vertices.length;
                boxes.push({ vertex: vertices.length, lo: placed.lo, hi: placed.hi });
                vertices.push(placed.p);
            }
        }
    }
}
/** @description The four cells around a grid edge starting at corner (i,j,k) along axis `a`, or null. */
function quadCells(grid, cells, ijk, order) {
    const [, b, c] = order;
    const limit = [grid.nx - 1, grid.ny - 1, grid.nz - 1];
    const pick = (db, dc) => {
        const q = [ijk[0], ijk[1], ijk[2]];
        q[b] -= db;
        q[c] -= dc;
        if (q[0] < 0 || q[1] < 0 || q[2] < 0 || q[0] >= limit[0] || q[1] >= limit[1] || q[2] >= limit[2])
            return -1;
        return cells[cellIndex(grid, q[0], q[1], q[2])];
    };
    const v = [pick(0, 0), pick(1, 0), pick(1, 1), pick(0, 1)];
    return v.some((x) => x < 0) ? null : v;
}
/** @description Pass 2: one quad (two triangles) per crossing grid edge, wound solid→empty outward. */
function emitQuads(grid, cells, triangles) {
    const stride = [1, grid.nx, grid.nx * grid.ny];
    for (let k = 0; k < grid.nz; k += 1) {
        for (let j = 0; j < grid.ny; j += 1) {
            for (let i = 0; i < grid.nx; i += 1) {
                const at = (0, occupancy_grid_1.gridIndex)(grid, i, j, k);
                const here = grid.data[at];
                for (const order of AXES) {
                    const a = order[0];
                    const n = [i, j, k][a];
                    if (n + 1 >= [grid.nx, grid.ny, grid.nz][a])
                        continue;
                    const there = grid.data[at + stride[a]];
                    if (here === there)
                        continue;
                    const q = quadCells(grid, cells, [i, j, k], order);
                    if (!q)
                        continue;
                    const [v0, v1, v2, v3] = q;
                    if (here === 1)
                        triangles.push([v0, v1, v2], [v0, v2, v3]);
                    else
                        triangles.push([v0, v3, v2], [v0, v2, v1]);
                }
            }
        }
    }
}
/** @description Laplacian relaxation, each vertex clamped to its own cell so topology cannot change. */
function smooth(vertices, triangles, boxes, iterations, lambda) {
    const neighbours = vertices.map(() => []);
    for (const [a, b, c] of triangles) {
        neighbours[a].push(b, c);
        neighbours[b].push(a, c);
        neighbours[c].push(a, b);
    }
    const clamp = new Map(boxes.map((r) => [r.vertex, r]));
    for (let it = 0; it < iterations; it += 1) {
        const next = vertices.map((v, idx) => {
            const n = neighbours[idx];
            if (n.length === 0)
                return v;
            const mean = { x: 0, y: 0, z: 0 };
            for (const q of n) {
                mean.x += vertices[q].x;
                mean.y += vertices[q].y;
                mean.z += vertices[q].z;
            }
            mean.x /= n.length;
            mean.y /= n.length;
            mean.z /= n.length;
            const box = clamp.get(idx);
            return {
                x: Math.min(box.hi.x, Math.max(box.lo.x, v.x + lambda * (mean.x - v.x))),
                y: Math.min(box.hi.y, Math.max(box.lo.y, v.y + lambda * (mean.y - v.y))),
                z: Math.min(box.hi.z, Math.max(box.lo.z, v.z + lambda * (mean.z - v.z))),
            };
        });
        for (let idx = 0; idx < vertices.length; idx += 1)
            vertices[idx] = next[idx];
    }
}
/**
 * @description Extract the boundary surface of the solid voxels as an indexed triangle mesh in
 * world millimetres. Requires an empty outer voxel layer ({@link clearBorder}) — without it a
 * crossing at the boundary has fewer than four cells and the spec's edge census reports the hole.
 * @param grid - The occupancy grid.
 * @param options - See {@link SurfaceNetsOptions}.
 * @returns The mesh; empty (no vertices) when no voxel is solid.
 * @throws RangeError when smoothing parameters are out of range.
 */
function surfaceNets(grid, options = {}) {
    const iterations = options.smoothIterations ?? 2;
    const lambda = options.smoothLambda ?? 0.5;
    if (!Number.isInteger(iterations) || iterations < 0 || iterations > 20)
        throw new RangeError('smoothIterations must be an integer 0..20');
    if (!(lambda >= 0 && lambda <= 1))
        throw new RangeError('smoothLambda must be within 0..1');
    const cells = new Int32Array((grid.nx - 1) * (grid.ny - 1) * (grid.nz - 1)).fill(-1);
    const vertices = [];
    const boxes = [];
    placeVertices(grid, cells, vertices, boxes);
    const triangles = [];
    emitQuads(grid, cells, triangles);
    if (iterations > 0 && vertices.length > 0)
        smooth(vertices, triangles, boxes, iterations, lambda);
    return { vertices, triangles };
}
//# sourceMappingURL=surface-nets.js.map