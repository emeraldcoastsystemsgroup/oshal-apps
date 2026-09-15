"use strict";
/**
 * Spaces → embodied: turn a ready scan's Gaussian-splat geometry into a hidden scene the embodied
 * simulation can start a world from (ADR-151 D3 / Q3: the world model IS the Spaces scan). Pure
 * geometry, no framework imports, so the store's dependency-free suite can prove it against the
 * compiled module.
 *
 * The output is plain data in the embodied `Scene` shape: a room box (metres, z-up, floor at 0),
 * axis-aligned obstacle boxes carved from the occupied voxels, no surfaces/objects/zones/appliances
 * (the discovery code reads the map it builds, never the scene), and a drone home + base park on
 * the clearest patch of open floor. The gaussian positions ARE the geometry; scale, orientation and
 * the covering resolution are the only decisions, and each is reported back in `stats`.
 *
 * @module embodied-scene
 *
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * DATE/TIME           | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 2026-09-14 00:00:00 | maintainer@emeraldcoastsystemsgroup.com | Initial creation — buildEmbodiedScene(): .splat positions → up-axis mapping (Spaces is +Y up; 3DGS exports are often −Y up, `auto` picks the side the dense floor sits on) → metric or fitted scale → occupancy voxels with a noise gate → adaptive coarsening under the box cap → column runs merged along x into embodied `Obstacle` boxes → room from the covered extent, drone home / base park on the clearest open floor. Guarded by tests/spaces-embodied-scene.test.js.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.SCENE_BASE_RESOLUTION_M = exports.EMBODIED_SCENE_TYPE = exports.DEFAULT_CEILING_M = exports.DEFAULT_MAX_BOXES = void 0;
exports.buildEmbodiedScene = buildEmbodiedScene;
exports.sceneOptionsFromQuery = sceneOptionsFromQuery;
/** Bytes per gaussian record in the .splat format (position float32[3] at offset 0). */
const STRIDE = 32;
/** The embodied voxel map resolution; the scene's finest covering matches it. */
const BASE_RESOLUTION_M = 0.05;
/** Coarsening ladder walked until the box count fits the cap. */
const RESOLUTIONS_M = [0.05, 0.10, 0.15, 0.20, 0.30];
/** The embodied raycaster and physics plant test every solid — keep the scene affordable. */
exports.DEFAULT_MAX_BOXES = 1500;
/** A fitted (non-metric) capture is scaled so its vertical extent equals this ceiling height. */
exports.DEFAULT_CEILING_M = 2.4;
/** Room padding around the covered extent, and the ceiling slack above the tallest solid. */
const ROOM_MARGIN_M = 0.10;
/** Percentiles that bound the scene (floaters live outside), and the slack kept beyond them. */
const ROBUST_LOW = 0.01;
const ROBUST_HIGH = 0.99;
const CLIP_SLACK = 0.05;
/** The per-axis percentile box of a point set: the scene without its floaters. */
function robustBounds(points) {
    const lo = [0, 0, 0];
    const hi = [0, 0, 0];
    for (let a = 0; a < 3; a++) {
        const sorted = points.map((p) => p[a]).sort((x, y) => x - y);
        lo[a] = sorted[Math.min(sorted.length - 1, Math.floor(ROBUST_LOW * (sorted.length - 1)))];
        hi[a] = sorted[Math.max(0, Math.ceil(ROBUST_HIGH * (sorted.length - 1)))];
    }
    return { lo, hi };
}
/** Read every finite gaussian position out of a packed .splat buffer. */
function readPositions(buffer) {
    const count = Math.floor(buffer.length / STRIDE);
    const out = [];
    for (let i = 0; i < count; i++) {
        const o = i * STRIDE;
        const p = [buffer.readFloatLE(o), buffer.readFloatLE(o + 4), buffer.readFloatLE(o + 8)];
        if (Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2]))
            out.push(p);
    }
    return out;
}
/** Pick the up sign along Y: the floor is the dense end, so put the denser 10 % slab at the bottom. */
function detectUp(points) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of points) {
        if (p[1] < lo)
            lo = p[1];
        if (p[1] > hi)
            hi = p[1];
    }
    const span = hi - lo;
    if (!(span > 0))
        return 'y';
    let bottom = 0;
    let top = 0;
    for (const p of points) {
        const t = (p[1] - lo) / span;
        if (t <= 0.1)
            bottom++;
        else if (t >= 0.9)
            top++;
    }
    return top > bottom ? '-y' : 'y';
}
/** Map a source point into embodied's frame (x east, y north, z up) with a PROPER rotation about x,
 *  so the room keeps its handedness: +Y up is R_x(+90°) (x, y, z) → (x, −z, y); −Y up is R_x(−90°)
 *  (x, y, z) → (x, z, −y). Swapping two axes would mirror the room. */
function toZUp(p, up) {
    if (up === 'y')
        return [p[0], -p[2], p[1]];
    if (up === '-y')
        return [p[0], p[2], -p[1]];
    return [p[0], p[1], p[2]];
}
/** Occupied voxel keys → counts at one resolution, over points already in metres and z-up. */
function voxelize(points, res, minPoints) {
    const counts = new Map();
    const cells = new Map();
    for (const p of points) {
        const ix = Math.floor(p[0] / res);
        const iy = Math.floor(p[1] / res);
        const iz = Math.floor(p[2] / res);
        const key = `${ix},${iy},${iz}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
        if (!cells.has(key))
            cells.set(key, [ix, iy, iz]);
    }
    for (const [key, n] of counts)
        if (n < minPoints)
            cells.delete(key);
    return cells;
}
/** Merge occupied voxels into boxes: vertical runs per column, then equal runs merged along x. */
function mergeBoxes(cells, res) {
    const columns = new Map();
    for (const [, c] of cells) {
        const key = `${c[0]},${c[1]}`;
        const zs = columns.get(key);
        if (zs)
            zs.push(c[2]);
        else
            columns.set(key, [c[2]]);
    }
    // Runs per column: [ix, iy, z0, z1] with z1 exclusive.
    const runs = new Map();
    for (const [key, zs] of columns) {
        zs.sort((a, b) => a - b);
        const [ix, iy] = key.split(',').map(Number);
        let start = zs[0];
        let prev = zs[0];
        for (let i = 1; i <= zs.length; i++) {
            if (i < zs.length && zs[i] === prev + 1) {
                prev = zs[i];
                continue;
            }
            const list = runs.get(`${iy}`) ?? [];
            list.push([ix, iy, start, prev + 1]);
            runs.set(`${iy}`, list);
            if (i < zs.length) {
                start = zs[i];
                prev = zs[i];
            }
        }
    }
    const boxes = [];
    for (const [, list] of runs) {
        list.sort((a, b) => (a[2] - b[2]) || (a[3] - b[3]) || (a[0] - b[0]));
        let i = 0;
        while (i < list.length) {
            const [ix0, iy, z0, z1] = list[i];
            let ix1 = ix0;
            let j = i + 1;
            while (j < list.length && list[j][2] === z0 && list[j][3] === z1 && list[j][0] === ix1 + 1) {
                ix1 = list[j][0];
                j++;
            }
            boxes.push({
                name: `scan-${boxes.length + 1}`, kind: 'fixture',
                min: [ix0 * res, iy * res, z0 * res], max: [(ix1 + 1) * res, (iy + 1) * res, z1 * res],
            });
            i = j;
        }
    }
    return boxes;
}
/** Round to the millimetre so the JSON stays readable and stable. */
const mm = (v) => Math.round(v * 1000) / 1000;
/** The clearest open-floor spot: the point farthest from every solid that rises above the floor
 *  slab (top over 0.15 m, base under 1.2 m) and from the walls, scanned on a 10 cm lattice. The
 *  scanned floor itself is a solid too, so it is excluded by height rather than by name. */
function clearestFloorSpot(room, boxes) {
    const step = 0.10;
    const low = boxes.filter((b) => b.min[2] < 1.2 && b.max[2] > 0.15);
    let best = { x: (room.minX + room.maxX) / 2, y: (room.minY + room.maxY) / 2, clearance: 0 };
    for (let x = room.minX + step; x < room.maxX - step; x += step) {
        for (let y = room.minY + step; y < room.maxY - step; y += step) {
            let clearance = Math.min(x - room.minX, room.maxX - x, y - room.minY, room.maxY - y);
            for (const b of low) {
                const dx = Math.max(b.min[0] - x, 0, x - b.max[0]);
                const dy = Math.max(b.min[1] - y, 0, y - b.max[1]);
                const d = Math.hypot(dx, dy);
                if (d < clearance)
                    clearance = d;
                if (clearance <= best.clearance)
                    break;
            }
            if (clearance > best.clearance)
                best = { x: mm(x), y: mm(y), clearance: mm(clearance) };
        }
    }
    return best;
}
/**
 * @description Build an embodied hidden scene from a ready scan's packed .splat bytes.
 * @param buffer - The scan's .splat artifact (N × 32 bytes)
 * @param opts - Name, orientation, scale and covering options
 * @returns The scene as plain data plus the decisions that produced it
 * @throws RangeError when the buffer holds no usable geometry
 */
function buildEmbodiedScene(buffer, opts) {
    const source = readPositions(buffer);
    if (source.length === 0)
        throw new RangeError('the scan has no gaussian positions to build a scene from');
    const requestedUp = opts.up ?? 'auto';
    const up = requestedUp === 'auto' ? detectUp(source) : requestedUp;
    const oriented = source.map((p) => toZUp(p, up));
    // A robust extent: a splat carries floaters far outside the real scene (sky, reflections, mis-fit
    // gaussians), so the 1st–99th percentile box is the scene and what lies beyond it is clipped.
    const { lo, hi } = robustBounds(oriented);
    const height = hi[2] - lo[2];
    const ceilingM = opts.ceilingM ?? exports.DEFAULT_CEILING_M;
    let scale = 1;
    let unit = 'meters';
    if (typeof opts.scaleM === 'number' && opts.scaleM > 0) {
        scale = opts.scaleM;
        unit = 'fitted';
    }
    else if (!opts.metric) {
        if (!(height > 0))
            throw new RangeError('the scan is flat; cannot fit a ceiling height');
        scale = ceilingM / height;
        unit = 'fitted';
    }
    const slack = [hi[0] - lo[0], hi[1] - lo[1], height].map((s) => s * CLIP_SLACK);
    const kept = oriented.filter((p) => p[0] >= lo[0] - slack[0] && p[0] <= hi[0] + slack[0] && p[1] >= lo[1] - slack[1] && p[1] <= hi[1] + slack[1] && p[2] >= lo[2] - slack[2] && p[2] <= hi[2] + slack[2]);
    const clipped = oriented.length - kept.length;
    // Shift so the percentile box starts at the room margin with the floor at z = 0; the slack band
    // (real geometry just outside the box, e.g. wall thickness) is clamped onto the box faces.
    const span = [hi[0] - lo[0], hi[1] - lo[1], height].map((s) => s * scale);
    const clampAxis = (v, a) => Math.min(span[a], Math.max(0, (v - lo[a]) * scale));
    const points = kept.map((p) => [clampAxis(p[0], 0) + ROOM_MARGIN_M, clampAxis(p[1], 1) + ROOM_MARGIN_M, clampAxis(p[2], 2)]);
    const maxBoxes = Math.max(50, Math.floor(opts.maxBoxes ?? exports.DEFAULT_MAX_BOXES));
    const minPoints = Math.max(1, Math.floor(opts.minPointsPerVoxel ?? 2));
    let chosen = null;
    for (const res of RESOLUTIONS_M) {
        const cells = voxelize(points, res, minPoints);
        const boxes = mergeBoxes(cells, res);
        chosen = { res, cells, boxes };
        if (boxes.length <= maxBoxes)
            break;
    }
    if (!chosen || chosen.boxes.length === 0)
        throw new RangeError('no occupied voxels survived the noise gate');
    const boxes = chosen.boxes.length <= maxBoxes ? chosen.boxes : chosen.boxes.slice(0, maxBoxes);
    const extentX = Math.max(...boxes.map((b) => b.max[0]));
    const extentY = Math.max(...boxes.map((b) => b.max[1]));
    const tallest = Math.max(...boxes.map((b) => b.max[2]));
    const room = {
        minX: 0, maxX: mm(extentX + ROOM_MARGIN_M), minY: 0, maxY: mm(extentY + ROOM_MARGIN_M),
        ceiling: mm(Math.max(1.0, tallest + ROOM_MARGIN_M)),
    };
    const rounded = boxes.map((b) => ({ ...b, min: b.min.map(mm), max: b.max.map(mm) }));
    const spot = clearestFloorSpot(room, rounded);
    const scene = {
        name: opts.name, room, obstacles: rounded,
        surfaces: [], objects: [], zones: [], appliances: [],
        basePark: { x: spot.x, y: spot.y, yaw: 0 }, droneHome: [spot.x, spot.y, 0],
    };
    return {
        scene,
        stats: {
            gaussians: source.length, up, upDetected: requestedUp === 'auto', scale: mm(scale), unit,
            resolutionM: chosen.res, occupiedVoxels: chosen.cells.size, boxes: rounded.length, floorClearanceM: spot.clearance,
            clippedGaussians: clipped,
        },
    };
}
/** The MIME type an embodied scene travels under (ADR-139 provides/accepts). */
exports.EMBODIED_SCENE_TYPE = 'application/vnd.oshal.embodied-scene+json';
/** Parse the route's query string into options; unknown values fall back to the defaults. */
function sceneOptionsFromQuery(q, name, metric) {
    const up = typeof q.up === 'string' && ['auto', 'y', '-y', 'z'].includes(q.up) ? q.up : 'auto';
    const num = (v) => { const n = Number(v); return typeof v === 'string' && Number.isFinite(n) && n > 0 ? n : undefined; };
    return { name, up, metric, scaleM: num(q.scaleM), ceilingM: num(q.ceilingM), maxBoxes: num(q.maxBoxes), minPointsPerVoxel: num(q.minPoints) };
}
/** Exposed for tests: the finest resolution the ladder starts from. */
exports.SCENE_BASE_RESOLUTION_M = BASE_RESOLUTION_M;
//# sourceMappingURL=embodied-scene.js.map