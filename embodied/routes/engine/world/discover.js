"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — discovery from the map alone. A SUPPORT
 *                     |                             | SURFACE is a 4-connected patch of columns whose height-map top
 *                     |                             | agrees within 3 cm and has clearance above it (the voxel above
 *                     |                             | is not occupied and free space was seen there); its height is
 *                     |                             | the median top over the patch, so things standing on it do not
 *                     |                             | raise it. An OBJECT is an 8-connected patch of columns inside a
 *                     |                             | surface whose top stands more than 1.2 cm above that plane —
 *                     |                             | how a 2 cm plate is seen on 5 cm voxels — bounded by size. A
 *                     |                             | class is guessed from extent and height only. Nothing here
 *                     |                             | knows what the room "really" holds; it reads the map.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Split discoverSurfaces into floodPatches / attachToSurfaces / neighbours4 to stay under the 50-line rule (identical traversal order, identical output).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_DISCOVER = void 0;
exports.heightField = heightField;
exports.discoverSurfaces = discoverSurfaces;
exports.guessClass = guessClass;
exports.discoverObjects = discoverObjects;
const voxel_map_1 = require("./voxel-map");
/** @description Defaults sized for a kitchen. */
exports.DEFAULT_DISCOVER = { planeTolerance: 0.03, bumpThreshold: 0.012, minAreaM2: 0.06, maxObjectExtent: 0.45, maxObjectHeight: 0.4, minObjectColumns: 3 };
/** @description A column's top with clearance above it, or NaN. */
function columnTop(map, col) {
    const z = map.topZ[col];
    if (!Number.isFinite(z))
        return Number.NaN;
    const i = col % map.nx;
    const j = Math.floor(col / map.nx);
    const k = Math.floor((z - map.bounds.minZ) / map.res);
    if (k + 1 < map.nz && map.cells[map.index(i, j, k + 1)] === voxel_map_1.OCCUPIED)
        return Number.NaN;
    for (let a = 1; a <= 3; a += 1) {
        const kk = k + a;
        if (kk < map.nz && map.cells[map.index(i, j, kk)] === voxel_map_1.FREE)
            return z;
    }
    return Number.NaN;
}
/** @description Median of a numeric list. */
function median(values) {
    const s = [...values].sort((a, b) => a - b);
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}
/**
 * @description The plane height of a patch: the LOWEST 1 cm level holding at least 15 % of its
 * columns. Things standing on a surface raise columns, never lower them, so the lowest populated
 * level is the surface even when dishes cover most of a small basin.
 */
function planeHeight(values) {
    const bins = new Map();
    for (const v of values) {
        const b = Math.round(v * 100);
        const list = bins.get(b) ?? [];
        list.push(v);
        bins.set(b, list);
    }
    const threshold = Math.max(2, Math.ceil(values.length * 0.15));
    const levels = [...bins.entries()].filter(([, list]) => list.length >= threshold).sort((a, b) => a[0] - b[0]);
    const chosen = levels.length ? levels[0][1] : values;
    return median(chosen);
}
/**
 * @description Find every support surface, then attach small non-surface patches (things standing
 * on a surface) to the adjacent surface so the object pass can see them.
 * @param map - The map.
 * @param opts - Tunables.
 * @returns Surfaces, largest first, with `columns` including attached patches.
 */
/**
 * @description The height field both passes read: each column's top with clearance, with holes
 * filled from the 8 neighbours' median (two passes) — a return that missed a column is not a gap
 * in the surface. NaN where nothing is known.
 * @param map - The map.
 * @returns One height per column.
 */
function heightField(map) {
    let tops = new Float32Array(map.nx * map.ny);
    for (let c = 0; c < tops.length; c += 1)
        tops[c] = columnTop(map, c);
    for (let pass = 0; pass < 2; pass += 1) {
        const filled = new Float32Array(tops);
        for (let c = 0; c < tops.length; c += 1) {
            if (!Number.isNaN(tops[c]))
                continue;
            const i = c % map.nx;
            const j = Math.floor(c / map.nx);
            const around = [];
            for (let dj = -1; dj <= 1; dj += 1)
                for (let di = -1; di <= 1; di += 1) {
                    if (!di && !dj)
                        continue;
                    const ii = i + di;
                    const jj = j + dj;
                    if (ii < 0 || jj < 0 || ii >= map.nx || jj >= map.ny)
                        continue;
                    const v = tops[jj * map.nx + ii];
                    if (!Number.isNaN(v))
                        around.push(v);
                }
            // Fill only when the neighbours agree: a gap between a plate and the basin is a real edge.
            if (around.length >= 3 && Math.max(...around) - Math.min(...around) <= 0.015)
                filled[c] = median(around);
        }
        tops = filled;
    }
    return tops;
}
/** @description The in-bounds 4-neighbours of a column index, in a fixed order (determinism). */
function neighbours4(map, c) {
    const i = c % map.nx;
    const j = Math.floor(c / map.nx);
    const out = [];
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ii = i + di;
        const jj = j + dj;
        if (ii >= 0 && jj >= 0 && ii < map.nx && jj < map.ny)
            out.push(jj * map.nx + ii);
    }
    return out;
}
/** @description 4-connected patches of columns whose tops agree within the plane tolerance. */
function floodPatches(map, tops, tolerance) {
    const label = new Int32Array(map.nx * map.ny).fill(-1);
    const patches = [];
    for (let start = 0; start < tops.length; start += 1) {
        if (Number.isNaN(tops[start]) || label[start] >= 0)
            continue;
        const id = patches.length;
        const columns = [];
        const stack = [start];
        label[start] = id;
        while (stack.length) {
            const c = stack.pop();
            columns.push(c);
            for (const n of neighbours4(map, c)) {
                if (label[n] >= 0 || Number.isNaN(tops[n]) || Math.abs(tops[n] - tops[c]) > tolerance)
                    continue;
                label[n] = id;
                stack.push(n);
            }
        }
        patches.push(columns);
    }
    return patches;
}
/**
 * @description Attach small non-surface columns to a neighbouring surface — the one whose plane
 * is nearest BELOW the column's top (something standing on a surface is above it, never below) —
 * two passes for two-wide bumps. Mutates `surfaceOf`.
 */
function attachToSurfaces(map, tops, surfaceOf, planeZ, tolerance) {
    for (let pass = 0; pass < 2; pass += 1) {
        const next = new Int32Array(surfaceOf);
        for (let c = 0; c < tops.length; c += 1) {
            if (Number.isNaN(tops[c]) || surfaceOf[c] >= 0)
                continue;
            let best = -1;
            let bestGap = Number.POSITIVE_INFINITY;
            for (const n of neighbours4(map, c)) {
                const s = surfaceOf[n];
                if (s < 0)
                    continue;
                const gap = tops[c] - planeZ[s];
                if (gap >= -tolerance && gap < bestGap) {
                    best = s;
                    bestGap = gap;
                }
            }
            if (best >= 0)
                next[c] = best;
        }
        surfaceOf.set(next);
    }
}
function discoverSurfaces(map, opts = exports.DEFAULT_DISCOVER, tops = heightField(map)) {
    const patches = floodPatches(map, tops, opts.planeTolerance);
    const big = patches.map((cols, id) => ({ id, cols })).filter((p) => p.cols.length * map.res * map.res >= opts.minAreaM2);
    const surfaceOf = new Int32Array(map.nx * map.ny).fill(-1);
    big.forEach((p, si) => { for (const c of p.cols)
        surfaceOf[c] = si; });
    const planeZ = big.map((p) => planeHeight(p.cols.map((c) => tops[c])));
    attachToSurfaces(map, tops, surfaceOf, planeZ, opts.planeTolerance);
    const out = big.map((p, si) => {
        const columns = [];
        for (let c = 0; c < surfaceOf.length; c += 1)
            if (surfaceOf[c] === si)
                columns.push(c);
        const z = planeZ[si];
        const xs = columns.map((c) => map.bounds.minX + ((c % map.nx) + 0.5) * map.res);
        const ys = columns.map((c) => map.bounds.minY + (Math.floor(c / map.nx) + 0.5) * map.res);
        return { z, columns, bbox: { minX: Math.min(...xs) - map.res / 2, maxX: Math.max(...xs) + map.res / 2, minY: Math.min(...ys) - map.res / 2, maxY: Math.max(...ys) + map.res / 2 }, centroid: [xs.reduce((a, b) => a + b, 0) / xs.length, ys.reduce((a, b) => a + b, 0) / ys.length], areaM2: p.cols.length * map.res * map.res };
    });
    return out.sort((a, b) => b.areaM2 - a.areaM2);
}
/** @description Guess a class from extents (m) and height (m). */
function guessClass(extent, height) {
    if (height <= 0.045 && extent >= 0.14)
        return 'plate';
    if (height >= 0.14 && extent <= 0.16)
        return 'carton';
    if (height >= 0.05 && height < 0.14 && extent <= 0.16)
        return 'mug';
    if (height >= 0.045 && height <= 0.12 && extent > 0.12 && extent <= 0.28)
        return 'bowl';
    return 'unknown';
}
/**
 * @description Find objects on the surfaces: 8-connected patches of columns whose top stands above
 * the surface plane by more than the bump threshold, bounded by size.
 * @param map - The map.
 * @param surfaces - From {@link discoverSurfaces}.
 * @param opts - Tunables.
 * @returns Objects in a deterministic order (by x, then y).
 */
function discoverObjects(map, surfaces, opts = exports.DEFAULT_DISCOVER, tops = heightField(map)) {
    const out = [];
    const seen = new Uint8Array(map.nx * map.ny);
    surfaces.forEach((s, si) => {
        const member = new Set(s.columns);
        const isBump = (c) => member.has(c) && Number.isFinite(tops[c]) && tops[c] - s.z > opts.bumpThreshold;
        for (const start of s.columns) {
            if (seen[start] || !isBump(start))
                continue;
            const cols = [];
            const stack = [start];
            seen[start] = 1;
            while (stack.length) {
                const c = stack.pop();
                cols.push(c);
                const i = c % map.nx;
                const j = Math.floor(c / map.nx);
                for (let dj = -1; dj <= 1; dj += 1)
                    for (let di = -1; di <= 1; di += 1) {
                        if (!di && !dj)
                            continue;
                        const ii = i + di;
                        const jj = j + dj;
                        if (ii < 0 || jj < 0 || ii >= map.nx || jj >= map.ny)
                            continue;
                        const n = jj * map.nx + ii;
                        if (seen[n] || !isBump(n))
                            continue;
                        seen[n] = 1;
                        stack.push(n);
                    }
            }
            const o = summarise(map, cols, si, s.z, opts, tops);
            if (o)
                out.push(o);
        }
    });
    return out.sort((a, b) => a.centroid[0] - b.centroid[0] || a.centroid[1] - b.centroid[1]);
}
/** @description Bounding box, centroid and class guess for a bump patch; null when it is not object-sized. */
function summarise(map, cols, si, supportZ, opts, tops) {
    const xs = cols.map((c) => map.bounds.minX + ((c % map.nx) + 0.5) * map.res);
    const ys = cols.map((c) => map.bounds.minY + (Math.floor(c / map.nx) + 0.5) * map.res);
    const top = Math.max(...cols.map((c) => tops[c]));
    const min = [Math.min(...xs) - map.res / 2, Math.min(...ys) - map.res / 2, supportZ];
    const max = [Math.max(...xs) + map.res / 2, Math.max(...ys) + map.res / 2, top];
    const extent = Math.max(max[0] - min[0], max[1] - min[1]);
    const narrow = Math.min(max[0] - min[0], max[1] - min[1]);
    const height = top - supportZ;
    // A one-column-wide strip is a cliff edge between two planes, never a thing to pick up
    // (compared with a tolerance: two columns wide is exactly 2·res in floating point ± noise).
    if (extent > opts.maxObjectExtent || height > opts.maxObjectHeight || cols.length < opts.minObjectColumns || narrow < 2 * map.res - 1e-6)
        return null;
    const centroid = [xs.reduce((a, b) => a + b, 0) / xs.length, ys.reduce((a, b) => a + b, 0) / ys.length, (supportZ + top) / 2];
    return { centroid, min, max, voxels: cols.length, surface: si, supportZ, guess: guessClass(extent, height) };
}
//# sourceMappingURL=discover.js.map