"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation (BACKLOG B13) — printability beyond topology. A
 *                     |                             | watertight solid can still be unprintable: a wall thinner than
 *                     |                             | the extrusion, or an underside that leans out further per layer
 *                     |                             | than the next bead can bridge. Both are measured off the same
 *                     |                             | occupancy grid, deterministically: an EXACT squared Euclidean
 *                     |                             | distance transform (Felzenszwalb-Huttenlocher, three separable
 *                     |                             | passes, no iteration to tolerance) gives the largest inscribed
 *                     |                             | sphere at every voxel, and the smallest sphere ON THE MEDIAL
 *                     |                             | RIDGE is the thinnest wall; a locally averaged occupancy
 *                     |                             | gradient gives the underside normal, which is the overhang
 *                     |                             | angle with the voxel staircase averaged out. Both thresholds
 *                     |                             | are DERIVED from the two machine inputs: the wall floor is
 *                     |                             | perimeters x nozzle, the overhang ceiling is
 *                     |                             | atan(nozzle / layerHeight), the angle at which each bead still
 *                     |                             | overlaps the one beneath it. Nothing here is a magic number.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.OVERHANG_READING_BAND_DEG = exports.PRINT_CHECK_LIMITS = void 0;
exports.squaredDistanceToEmpty = squaredDistanceToEmpty;
exports.evaluatePrintChecks = evaluatePrintChecks;
const occupancy_grid_1 = require("./occupancy-grid");
/**
 * @description Published bounds and defaults for the print check, in the same shape as
 * `RECONSTRUCTION_LIMITS`. Defaults describe the commonest FDM machine (a 0.4 mm nozzle laying
 * 0.2 mm layers with two perimeters); they are overridable inputs, never constants baked into the
 * arithmetic.
 */
exports.PRINT_CHECK_LIMITS = Object.freeze({
    nozzleMm: { default: 0.4, min: 0.05, max: 2 },
    layerHeightMm: { default: 0.2, min: 0.01, max: 2 },
    perimeters: { default: 2, min: 1, max: 8 },
    normalRadiusVoxels: { default: 4, min: 1, max: 6 },
});
/**
 * @description How far the overhang reading can stray from the true slope at the default radius,
 * degrees, as MEASURED on synthetic voxelised ramps from 10 to 85 degrees (two lean directions, two
 * voxel sizes; `engine-print-checks` re-asserts it). The staircase makes the steepest local reading
 * err steep far more than shallow, so a slope within this band of the limit is a borderline call.
 */
exports.OVERHANG_READING_BAND_DEG = Object.freeze({ under: 1, over: 6 });
/** @description Reject a machine number that is not a finite value inside its published bound. */
function requireNumber(value, bound, label) {
    if (value === undefined)
        return bound.default;
    if (!Number.isFinite(value) || value < bound.min || value > bound.max) {
        throw new RangeError(`${label} must be a number between ${bound.min} and ${bound.max} mm`);
    }
    return value;
}
/** @description Reject a count that is not an integer inside its published bound. */
function requireCount(value, bound, label) {
    if (value === undefined)
        return bound.default;
    if (!Number.isInteger(value) || value < bound.min || value > bound.max) {
        throw new RangeError(`${label} must be an integer between ${bound.min} and ${bound.max}`);
    }
    return value;
}
/** @description Squared distance transform of one line (Felzenszwalb-Huttenlocher lower envelope). */
function distanceLine(f, n, out, v, z) {
    let k = 0;
    v[0] = 0;
    z[0] = -Infinity;
    z[1] = Infinity;
    for (let q = 1; q < n; q += 1) {
        let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        while (s <= z[k]) {
            k -= 1;
            s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        }
        k += 1;
        v[k] = q;
        z[k] = s;
        z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < n; q += 1) {
        while (z[k + 1] < q)
            k += 1;
        out[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
    }
}
/** @description Run the 1-D transform along every line of one axis of the volume, in place. */
function sweepAxis(field, n, count, indexOf) {
    const f = new Float64Array(n);
    const out = new Float64Array(n);
    const v = new Int32Array(n);
    const z = new Float64Array(n + 1);
    for (let line = 0; line < count; line += 1) {
        for (let q = 0; q < n; q += 1)
            f[q] = field[indexOf(line, q)];
        distanceLine(f, n, out, v, z);
        for (let q = 0; q < n; q += 1)
            field[indexOf(line, q)] = out[q];
    }
}
/**
 * @description Exact squared Euclidean distance, in voxel units, from every solid voxel to the
 * nearest EMPTY voxel centre. Empty voxels read 0. The grid always carries an empty shell, so
 * every solid voxel has a finite answer.
 * @param grid - The solid.
 * @returns One squared distance per voxel, in the grid's own index order.
 */
function squaredDistanceToEmpty(grid) {
    const { nx, ny, nz } = grid;
    const far = (nx + ny + nz) ** 2;
    const field = new Float64Array(nx * ny * nz);
    for (let at = 0; at < field.length; at += 1)
        field[at] = grid.data[at] === 1 ? far : 0;
    sweepAxis(field, nx, ny * nz, (line, q) => line * nx + q);
    sweepAxis(field, ny, nx * nz, (line, q) => (line % nx) + nx * (q + ny * Math.floor(line / nx)));
    sweepAxis(field, nz, nx * ny, (line, q) => line + nx * ny * q);
    return field;
}
/** @description True when no 26-neighbour of an interior voxel sits deeper inside the solid. */
function onMedialRidge(grid, field, i, j, k) {
    const d = field[(0, occupancy_grid_1.gridIndex)(grid, i, j, k)];
    for (let dk = -1; dk <= 1; dk += 1) {
        for (let dj = -1; dj <= 1; dj += 1) {
            for (let di = -1; di <= 1; di += 1) {
                if (field[(0, occupancy_grid_1.gridIndex)(grid, i + di, j + dj, k + dk)] > d)
                    return false;
            }
        }
    }
    return true;
}
/**
 * @description The thinnest wall: twice the smallest maximal inscribed sphere on the medial ridge.
 * A ridge voxel at squared distance `d` from empty space sits `sqrt(d) - 1/2` voxels from the
 * surface, so its wall is `2 sqrt(d) - 1` voxels thick: exact for an odd number of voxels, one
 * voxel conservative for an even number.
 */
function measureMinWall(grid, field) {
    let best = Infinity;
    let at = null;
    for (let k = 1; k < grid.nz - 1; k += 1) {
        for (let j = 1; j < grid.ny - 1; j += 1) {
            for (let i = 1; i < grid.nx - 1; i += 1) {
                const here = (0, occupancy_grid_1.gridIndex)(grid, i, j, k);
                if (grid.data[here] === 0 || field[here] >= best)
                    continue;
                if (!onMedialRidge(grid, field, i, j, k))
                    continue;
                best = field[here];
                at = (0, occupancy_grid_1.voxelCenter)(grid, i, j, k);
            }
        }
    }
    if (at === null)
        return { mm: 0, at: null };
    return { mm: (2 * Math.sqrt(best) - 1) * grid.voxelMm, at };
}
/**
 * @description Is this voxel solid for the purpose of reading a surface normal? Everything below the
 * bed layer is: the build plate is a solid plane, and reading it as air would make every surface
 * one layer above the bed look like a ceiling.
 */
function solidForNormal(grid, i, j, k, base) {
    if (k < base)
        return true;
    if (i < 0 || j < 0 || i >= grid.nx || j >= grid.ny || k >= grid.nz)
        return false;
    return grid.data[(0, occupancy_grid_1.gridIndex)(grid, i, j, k)] === 1;
}
/**
 * @description Outward normal at a voxel: minus the summed direction to the solid voxels inside a
 * SPHERE of the given radius. A sphere, not a cube: a cube is symmetric about a 45-degree plane
 * only, and on every other slope its corners drag the reading toward the nearest axis.
 */
function outwardNormal(grid, at, radius, base) {
    const n = { x: 0, y: 0, z: 0 };
    for (let dk = -radius; dk <= radius; dk += 1) {
        for (let dj = -radius; dj <= radius; dj += 1) {
            for (let di = -radius; di <= radius; di += 1) {
                const len = Math.sqrt(di * di + dj * dj + dk * dk);
                if (len === 0 || len > radius || !solidForNormal(grid, at.i + di, at.j + dj, at.k + dk, base))
                    continue;
                n.x -= di / len;
                n.y -= dj / len;
                n.z -= dk / len;
            }
        }
    }
    return n;
}
/** @description Lowest grid layer that holds any solid voxel: the layer resting on the bed, or -1. */
function lowestSolidLayer(grid) {
    const plane = grid.nx * grid.ny;
    for (let k = 0; k < grid.nz; k += 1) {
        for (let at = k * plane; at < (k + 1) * plane; at += 1)
            if (grid.data[at] === 1)
                return k;
    }
    return -1;
}
/** @description The steepest downward-facing surface above the bed layer, degrees from vertical. */
function measureOverhang(grid, radius) {
    const base = lowestSolidLayer(grid);
    let worst = 0;
    let at = null;
    for (let k = base + 1; k < grid.nz; k += 1) {
        for (let j = 0; j < grid.ny; j += 1) {
            for (let i = 0; i < grid.nx; i += 1) {
                if (grid.data[(0, occupancy_grid_1.gridIndex)(grid, i, j, k)] === 0 || grid.data[(0, occupancy_grid_1.gridIndex)(grid, i, j, k - 1)] === 1)
                    continue;
                const n = outwardNormal(grid, { i, j, k }, radius, base);
                const len = Math.hypot(n.x, n.y, n.z);
                if (len === 0)
                    continue;
                const deg = (Math.asin(Math.min(1, Math.max(0, -n.z / len))) * 180) / Math.PI;
                if (deg <= worst)
                    continue;
                worst = deg;
                at = (0, occupancy_grid_1.voxelCenter)(grid, i, j, k);
            }
        }
    }
    return { deg: worst, at };
}
/** @description The human sentences for whichever checks failed. */
function describeFailures(c, voxelMm) {
    const failures = [];
    if (c.thinWall) {
        failures.push(`Print check: thinnest wall is ${c.minWallMm.toFixed(2)} mm, under the ${c.minWallLimitMm.toFixed(2)} mm a ${c.nozzleMm} mm nozzle needs for ${c.perimeters} perimeter${c.perimeters === 1 ? '' : 's'} (measured to within one voxel, ${voxelMm.toFixed(3)} mm).`);
    }
    if (c.steepOverhang) {
        failures.push(`Print check: steepest overhang is ${c.largestOverhangDeg.toFixed(0)}° from vertical, over the ${c.overhangLimitDeg.toFixed(0)}° at which a ${c.nozzleMm} mm bead on ${c.layerHeightMm} mm layers still overlaps the one below; add support or reorient the part.`);
    }
    return failures;
}
/**
 * @description Measure the two things a topology verdict cannot see, the thinnest wall and the
 * steepest overhang, and compare each with the limit its machine implies.
 * @param grid - A finished solid (border already cleared).
 * @param options - Nozzle, layer height, perimeters; see {@link PRINT_CHECK_LIMITS}.
 * @returns The measurements, the derived limits and one sentence per failing check.
 * @throws RangeError when the grid has no solid voxel, a machine number is outside its published
 * bound, or the layer height exceeds the nozzle (a bead cannot be taller than the orifice).
 */
function evaluatePrintChecks(grid, options = {}) {
    const nozzleMm = requireNumber(options.nozzleMm, exports.PRINT_CHECK_LIMITS.nozzleMm, 'nozzleMm');
    const layerHeightMm = requireNumber(options.layerHeightMm, exports.PRINT_CHECK_LIMITS.layerHeightMm, 'layerHeightMm');
    const perimeters = requireCount(options.perimeters, exports.PRINT_CHECK_LIMITS.perimeters, 'perimeters');
    const radius = requireCount(options.normalRadiusVoxels, exports.PRINT_CHECK_LIMITS.normalRadiusVoxels, 'normalRadiusVoxels');
    if (layerHeightMm > nozzleMm)
        throw new RangeError('layerHeightMm must not exceed nozzleMm; a bead cannot be taller than the orifice that lays it');
    if (lowestSolidLayer(grid) < 0)
        throw new RangeError('Print checks need at least one solid voxel');
    const wall = measureMinWall(grid, squaredDistanceToEmpty(grid));
    const overhang = measureOverhang(grid, radius);
    const minWallLimitMm = perimeters * nozzleMm;
    const overhangLimitDeg = (Math.atan(nozzleMm / layerHeightMm) * 180) / Math.PI;
    const measured = {
        nozzleMm, layerHeightMm, perimeters,
        minWallMm: wall.mm, minWallAtMm: wall.at, minWallLimitMm,
        largestOverhangDeg: overhang.deg, largestOverhangAtMm: overhang.at, overhangLimitDeg,
        thinWall: wall.mm < minWallLimitMm, steepOverhang: overhang.deg > overhangLimitDeg,
    };
    return { ...measured, failures: describeFailures(measured, grid.voxelMm) };
}
//# sourceMappingURL=print-checks.js.map