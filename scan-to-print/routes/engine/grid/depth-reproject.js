"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation (BACKLOG B2) — phone depth cameras deliver
 *                     |                             | PERSPECTIVE range images; the depth carver's contract is an
 *                     |                             | ORTHOGRAPHIC map in one canonical view. This module is the
 *                     |                             | bridge, and it is pure arithmetic: back-project every pixel
 *                     |                             | through the pinhole intrinsics and the camera pose into the
 *                     |                             | world frame, pick the canonical view whose look axis is nearest
 *                     |                             | the optical axis, and splat each world point into that view
 *                     |                             | keeping the SHALLOWEST return per pixel (a z-buffer). No return
 *                     |                             | stays NaN, so silence still never carves. A re-projected return
 *                     |                             | certifies its whole orthographic column as free, which is exact
 *                     |                             | only when the camera ray runs down that column; every sample's
 *                     |                             | lean is therefore measured, samples past a published limit are
 *                     |                             | dropped, and the counts are returned rather than hidden.
 *                     |                             | `renderPerspectiveDepth` is the sim sibling of `renderDepth`:
 *                     |                             | a pinhole camera ray-marched through a grid, so the lane is
 *                     |                             | exercised end to end with no phone in the loop.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.REPROJECTION_LIMITS = void 0;
exports.nearestCanonicalView = nearestCanonicalView;
exports.reprojectToCanonicalView = reprojectToCanonicalView;
exports.renderPerspectiveDepth = renderPerspectiveDepth;
const occupancy_grid_1 = require("./occupancy-grid");
const views_1 = require("./views");
/** @description Published bounds for re-projection, echoed the same way the reconstruction limits are. */
exports.REPROJECTION_LIMITS = Object.freeze({
    /**
     * Largest angle, degrees, between a sample's camera ray and the view's look axis for the sample to
     * certify its column. Past 45 degrees a ray crosses into the neighbouring column within one voxel
     * of depth, so its return says nothing about its own column.
     */
    maxLeanDeg: { default: 45, min: 0, max: 89 },
    /** Largest perspective image accepted, pixels (a 4K depth frame is well under it). */
    maxPixels: 16_777_216,
});
const ORTHONORMAL_TOLERANCE = 1e-6;
/** @description Refuse a rotation that is not proper (orthonormal columns, determinant +1). */
function requireRotation(r) {
    if (!Array.isArray(r) || r.length !== 9 || !r.every(Number.isFinite))
        throw new RangeError('pose.rotation must be nine finite numbers (row-major 3x3)');
    const col = (c) => ({ x: r[c], y: r[3 + c], z: r[6 + c] });
    const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
    const [a, b, c] = [col(0), col(1), col(2)];
    const det = a.x * (b.y * c.z - c.y * b.z) - b.x * (a.y * c.z - c.y * a.z) + c.x * (a.y * b.z - b.y * a.z);
    const off = [dot(a, a) - 1, dot(b, b) - 1, dot(c, c) - 1, dot(a, b), dot(a, c), dot(b, c), det - 1];
    if (off.some((x) => Math.abs(x) > ORTHONORMAL_TOLERANCE))
        throw new RangeError('pose.rotation must be a proper rotation (orthonormal columns, determinant +1)');
}
/** @description Refuse an image whose shape, intrinsics or depth kind cannot be back-projected. */
function requireImage(image) {
    const { width, height, intrinsics: k, data } = image;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0)
        throw new RangeError('Range image width and height must be positive integers');
    if (width * height > exports.REPROJECTION_LIMITS.maxPixels)
        throw new RangeError(`Range image exceeds ${exports.REPROJECTION_LIMITS.maxPixels} pixels`);
    if (!(data instanceof Float32Array) || data.length !== width * height)
        throw new RangeError('Range image data must be a Float32Array of width x height values');
    if (!k || !(k.fx > 0) || !(k.fy > 0) || !Number.isFinite(k.fx) || !Number.isFinite(k.fy))
        throw new RangeError('intrinsics fx and fy must be positive numbers of pixels');
    if (!Number.isFinite(k.cx) || !Number.isFinite(k.cy))
        throw new RangeError('intrinsics cx and cy must be finite pixel coordinates');
    if (image.depthKind !== 'z' && image.depthKind !== 'range')
        throw new RangeError('depthKind must be "z" or "range"');
    const p = image.pose?.positionMm;
    if (!p || ![p.x, p.y, p.z].every(Number.isFinite))
        throw new RangeError('pose.positionMm must be a finite world point');
    requireRotation(image.pose.rotation);
}
/** @description Refuse a target map the carver could not index. */
function requireTarget(t) {
    if (t.view !== undefined && !(0, views_1.isViewName)(t.view))
        throw new RangeError(`target view must be one of ${views_1.VIEW_NAMES.join(', ')}`);
    if (!(t.mmPerPx > 0) || !Number.isFinite(t.mmPerPx))
        throw new RangeError('target mmPerPx must be a positive number');
    if (!Number.isInteger(t.width) || !Number.isInteger(t.height) || t.width <= 0 || t.height <= 0)
        throw new RangeError('target width and height must be positive integers');
    if (![t.uCenterPx, t.vCenterPx, t.uCenterMm, t.vCenterMm].every(Number.isFinite))
        throw new RangeError('target centre pixel and centre millimetres must be finite');
    if (t.planeMm !== undefined && !Number.isFinite(t.planeMm))
        throw new RangeError('target planeMm must be finite');
    const bound = exports.REPROJECTION_LIMITS.maxLeanDeg;
    const lean = t.maxLeanDeg ?? bound.default;
    if (!Number.isFinite(lean) || lean < bound.min || lean > bound.max)
        throw new RangeError(`maxLeanDeg must be between ${bound.min} and ${bound.max} degrees`);
    return lean;
}
/** @description Camera vector to world: `R v`. */
function toWorld(r, v) {
    return { x: r[0] * v.x + r[1] * v.y + r[2] * v.z, y: r[3] * v.x + r[4] * v.y + r[5] * v.z, z: r[6] * v.x + r[7] * v.y + r[8] * v.z };
}
/**
 * @description The canonical view whose look axis is closest to the camera's optical axis. Ties
 * resolve in `VIEW_NAMES` order, so the answer is deterministic.
 * @param pose - The camera pose.
 * @returns The view and the angle between the two axes, degrees.
 * @throws RangeError when the rotation is not proper.
 */
function nearestCanonicalView(pose) {
    requireRotation(pose.rotation);
    const forward = toWorld(pose.rotation, { x: 0, y: 0, z: 1 });
    let best = views_1.VIEW_NAMES[0];
    let bestDot = -Infinity;
    for (const name of views_1.VIEW_NAMES) {
        const look = (0, views_1.axisVector)(views_1.VIEW_FRAMES[name].look);
        const d = forward.x * look.x + forward.y * look.y + forward.z * look.z;
        if (d > bestDot) {
            bestDot = d;
            best = name;
        }
    }
    return { view: best, angleDeg: (Math.acos(Math.min(1, bestDot)) * 180) / Math.PI };
}
/** @description Unit camera-frame ray through a pixel centre, and its unnormalised z (for `z` depth). */
function pixelRay(k, col, row) {
    const x = (col + 0.5 - k.cx) / k.fx;
    const y = (row + 0.5 - k.cy) / k.fy;
    const invNorm = 1 / Math.sqrt(x * x + y * y + 1);
    return { dir: { x: x * invNorm, y: y * invNorm, z: invNorm }, invNorm };
}
/**
 * @description Re-project a perspective range image into an orthographic {@link DepthMap} in one
 * canonical view. Each finite return is back-projected to a world point, projected along the view's
 * look axis, and the shallowest landing per map pixel is kept. A sample whose camera ray leans more
 * than `maxLeanDeg` from the look axis is dropped: its return proves the RAY free, not the column,
 * and the carver reads a map value as "this column is free down to here".
 * @param image - The perspective range image.
 * @param target - The orthographic map geometry (and optionally the view, plane and lean limit).
 * @returns The map (NaN where nothing landed) and the per-pixel accounting.
 * @throws RangeError on a malformed image, pose or target.
 */
function reprojectToCanonicalView(image, target) {
    requireImage(image);
    const maxLean = requireTarget(target);
    const nearest = nearestCanonicalView(image.pose);
    const view = target.view ?? nearest.view;
    const frame = views_1.VIEW_FRAMES[view];
    const look = (0, views_1.axisVector)(frame.look);
    const planeMm = target.planeMm ?? (0, views_1.readAxis)(image.pose.positionMm, frame.look);
    const map = {
        view, width: target.width, height: target.height, mmPerPx: target.mmPerPx, uCenterPx: target.uCenterPx, vCenterPx: target.vCenterPx,
        uCenterMm: target.uCenterMm, vCenterMm: target.vCenterMm, planeMm, data: new Float32Array(target.width * target.height).fill(NaN),
    };
    const stats = { view, poseAngleDeg: nearest.angleDeg, samples: 0, landed: 0, leanDropped: 0, behindPlane: 0, outsideMap: 0, maxLeanDeg: 0 };
    const cosLimit = Math.cos((maxLean * Math.PI) / 180);
    for (let row = 0; row < image.height; row += 1) {
        for (let col = 0; col < image.width; col += 1) {
            const value = image.data[row * image.width + col];
            if (!Number.isFinite(value))
                continue;
            stats.samples += 1;
            splatSample(image, map, stats, { col, row, value, look, cosLimit });
        }
    }
    return { map, stats };
}
/** @description Back-project one return and keep it in the map if it is the shallowest landing there. */
function splatSample(image, map, stats, s) {
    const { dir, invNorm } = pixelRay(image.intrinsics, s.col, s.row);
    const rayWorld = toWorld(image.pose.rotation, dir);
    const cosLean = rayWorld.x * s.look.x + rayWorld.y * s.look.y + rayWorld.z * s.look.z;
    if (cosLean < s.cosLimit) {
        stats.leanDropped += 1;
        return;
    }
    const along = image.depthKind === 'z' ? s.value / invNorm : s.value;
    const p = image.pose.positionMm;
    const world = { x: p.x + rayWorld.x * along, y: p.y + rayWorld.y * along, z: p.z + rayWorld.z * along };
    const frame = views_1.VIEW_FRAMES[map.view];
    const depth = (0, views_1.readAxis)(world, frame.look) - map.planeMm;
    if (depth < 0) {
        stats.behindPlane += 1;
        return;
    }
    const { u, v } = (0, views_1.projectToView)(world, frame);
    const mc = Math.floor(map.uCenterPx + (u - map.uCenterMm) / map.mmPerPx);
    const mr = Math.floor(map.vCenterPx + (v - map.vCenterMm) / map.mmPerPx);
    if (mc < 0 || mr < 0 || mc >= map.width || mr >= map.height) {
        stats.outsideMap += 1;
        return;
    }
    stats.landed += 1;
    stats.maxLeanDeg = Math.max(stats.maxLeanDeg, (Math.acos(Math.min(1, cosLean)) * 180) / Math.PI);
    const at = mr * map.width + mc;
    if (!(map.data[at] <= depth))
        map.data[at] = depth;
}
/** @description Entry and exit distances of a ray through the grid's world box, or null on a miss. */
function rayBox(grid, origin, dir) {
    let enter = 0;
    let exit = Infinity;
    for (const axis of ['x', 'y', 'z']) {
        const lo = grid.originMm[axis];
        const hi = lo + (axis === 'x' ? grid.nx : axis === 'y' ? grid.ny : grid.nz) * grid.voxelMm;
        if (dir[axis] === 0) {
            if (origin[axis] < lo || origin[axis] > hi)
                return null;
            continue;
        }
        const t1 = (lo - origin[axis]) / dir[axis];
        const t2 = (hi - origin[axis]) / dir[axis];
        enter = Math.max(enter, Math.min(t1, t2));
        exit = Math.min(exit, Math.max(t1, t2));
    }
    return enter <= exit ? { enter, exit } : null;
}
/** @description Is the voxel holding this world point solid? Outside the grid is empty. */
function solidAtWorld(grid, p) {
    const i = Math.floor((p.x - grid.originMm.x) / grid.voxelMm);
    const j = Math.floor((p.y - grid.originMm.y) / grid.voxelMm);
    const k = Math.floor((p.z - grid.originMm.z) / grid.voxelMm);
    if (i < 0 || j < 0 || k < 0 || i >= grid.nx || j >= grid.ny || k >= grid.nz)
        return false;
    return grid.data[(0, occupancy_grid_1.gridIndex)(grid, i, j, k)] === 1;
}
/**
 * @description Simulate a pinhole depth camera looking at a grid: march each pixel's ray from
 * where it enters the grid's box, in quarter-voxel steps, until it enters a solid voxel. Rays that
 * miss record NaN. Deterministic, hardware-free, and the exact struct
 * {@link reprojectToCanonicalView} consumes.
 * @param grid - The solid to image.
 * @param camera - Image size, intrinsics, pose and depth kind.
 * @returns The perspective range image, millimetres.
 * @throws RangeError on malformed intrinsics, pose or size.
 */
function renderPerspectiveDepth(grid, camera) {
    const image = { ...camera, data: new Float32Array(camera.width * camera.height).fill(NaN) };
    requireImage(image);
    const step = grid.voxelMm / 4;
    const origin = camera.pose.positionMm;
    for (let row = 0; row < camera.height; row += 1) {
        for (let col = 0; col < camera.width; col += 1) {
            const { dir, invNorm } = pixelRay(camera.intrinsics, col, row);
            const w = toWorld(camera.pose.rotation, dir);
            const span = rayBox(grid, origin, w);
            if (!span)
                continue;
            for (let s = span.enter; s <= span.exit; s += step) {
                if (!solidAtWorld(grid, { x: origin.x + w.x * s, y: origin.y + w.y * s, z: origin.z + w.z * s }))
                    continue;
                image.data[row * camera.width + col] = camera.depthKind === 'z' ? s * invNorm : s;
                break;
            }
        }
    }
    return image;
}
//# sourceMappingURL=depth-reproject.js.map