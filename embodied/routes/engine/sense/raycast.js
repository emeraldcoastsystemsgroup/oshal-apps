"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the simulated sensors: ray–box intersection
 *                     |                             | (slab method), a LiDAR sweep (fixed azimuth × elevation
 *                     |                             | pattern, max range) returning hits and misses, and a depth
 *                     |                             | picture rendered through the pinhole camera (per-pixel range,
 *                     |                             | hit name, and a flat colour by what was hit, shaded by range).
 *                     |                             | The machine only ever learns about the world through these.
 * 2 | maintainer@emeraldcoastsystemsgroup.com   | Upward ranger: `LidarOptions.zenith` casts one ray straight up plus a cone near the zenith; `DRONE_LIDAR` carries it so the drone can clear the column it is about to climb through without a second node scanning first.
 * 3 | maintainer@emeraldcoastsystemsgroup.com   | Every hit carries the outward normal of the face it struck (`faceNormal`), for point-to-plane registration.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PAINT = exports.DRONE_LIDAR = exports.DEFAULT_LIDAR = void 0;
exports.faceNormal = faceNormal;
exports.rayBox = rayBox;
exports.castRay = castRay;
exports.lidarSweep = lidarSweep;
exports.renderDepthPicture = renderDepthPicture;
const transform_1 = require("../math/transform");
const camera_model_1 = require("../drone/camera-model");
const vec_1 = require("../math/vec");
/** @description The outward normal of the face of an axis-aligned box that a surface point lies on (the nearest face). */
function faceNormal(p, min, max) {
    let axis = 0;
    let sign = -1;
    let bestD = Number.POSITIVE_INFINITY;
    for (let a = 0; a < 3; a += 1) {
        const d0 = Math.abs(p[a] - min[a]);
        const d1 = Math.abs(p[a] - max[a]);
        if (d0 < bestD) {
            bestD = d0;
            axis = a;
            sign = -1;
        }
        if (d1 < bestD) {
            bestD = d1;
            axis = a;
            sign = 1;
        }
    }
    const n = [0, 0, 0];
    n[axis] = sign;
    return n;
}
/**
 * @description Slab-method ray/box test. Returns the entry distance along the ray, 0 when the
 * origin is inside the box, or null when the ray misses or the box is behind it.
 */
function rayBox(origin, dir, min, max) {
    let tmin = 0;
    let tmax = Number.POSITIVE_INFINITY;
    for (let a = 0; a < 3; a += 1) {
        if (Math.abs(dir[a]) < 1e-12) {
            if (origin[a] < min[a] || origin[a] > max[a])
                return null;
            continue;
        }
        const inv = 1 / dir[a];
        let t1 = (min[a] - origin[a]) * inv;
        let t2 = (max[a] - origin[a]) * inv;
        if (t1 > t2)
            [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax)
            return null;
    }
    return tmin;
}
/**
 * @description The nearest solid a ray hits within `maxRange`, or null.
 * @param origin - Ray origin.
 * @param dir - Unit direction.
 * @param solids - Candidates.
 * @param maxRange - Range limit (m).
 * @returns The hit.
 */
function castRay(origin, dir, solids, maxRange) {
    let best = null;
    for (const s of solids) {
        const t = rayBox(origin, dir, s.min, s.max);
        if (t === null || t > maxRange)
            continue;
        if (!best || t < best.t) {
            const point = (0, vec_1.add)(origin, (0, vec_1.scale)(dir, t));
            best = { t, point, name: s.name, paint: s.paint, normal: faceNormal(point, s.min, s.max) };
        }
    }
    return best;
}
/** @description Elevation rings from −90° (straight down) to +60° in equal steps. */
const elevationRings = (count) => Array.from({ length: count }, (_, n) => -90 + (150 * n) / (count - 1));
/**
 * @description A 3-D LiDAR sweep of about one second: 240 azimuths × 33 elevation rings from
 * straight down to +60°, 8 m — dense enough that a 5 cm map column a few metres away receives a
 * return, which is what a room-scale sensor delivers in that time.
 */
exports.DEFAULT_LIDAR = { azimuthCount: 240, elevationsDeg: elevationRings(64), maxRange: 8 };
/** @description The drone's sensor set: the same spinning LiDAR plus an upward ranger (4 m, nine rays within 10° of the zenith). */
exports.DRONE_LIDAR = { ...exports.DEFAULT_LIDAR, zenith: { rays: 8, coneDeg: 10, maxRange: 4 } };
/** @description Cast the zenith ranger's rays into the sweep's hit and miss lists. */
function castZenith(origin, yaw, solids, z, hits, misses) {
    const dirs = [[0, 0, 1]];
    const el = ((90 - z.coneDeg) * Math.PI) / 180;
    for (let a = 0; a < z.rays; a += 1) {
        const az = yaw + (2 * Math.PI * a) / z.rays;
        dirs.push([Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)]);
    }
    for (const dir of dirs) {
        const hit = castRay(origin, dir, solids, z.maxRange);
        if (hit)
            hits.push(hit);
        else
            misses.push((0, vec_1.add)(origin, (0, vec_1.scale)(dir, z.maxRange)));
    }
}
/**
 * @description One sweep from a point. Azimuths are spread evenly starting at `yaw`; the pattern
 * is fixed so two sweeps from the same pose are identical.
 * @param origin - Sensor position.
 * @param yaw - Heading the first azimuth starts from.
 * @param solids - What can be hit.
 * @param opts - Pattern.
 * @returns Hits and misses.
 */
function lidarSweep(origin, yaw, solids, opts = exports.DEFAULT_LIDAR) {
    const hits = [];
    const misses = [];
    for (const elDeg of opts.elevationsDeg) {
        const el = (elDeg * Math.PI) / 180;
        for (let a = 0; a < opts.azimuthCount; a += 1) {
            const az = yaw + (2 * Math.PI * a) / opts.azimuthCount;
            const dir = [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];
            const hit = castRay(origin, dir, solids, opts.maxRange);
            if (hit)
                hits.push(hit);
            else
                misses.push((0, vec_1.add)(origin, (0, vec_1.scale)(dir, opts.maxRange)));
        }
    }
    if (opts.zenith)
        castZenith(origin, yaw, solids, opts.zenith, hits, misses);
    return { origin, hits, misses };
}
/** @description Flat colours by paint class, before range shading. */
exports.PAINT = {
    floor: [60, 64, 72], wall: [90, 96, 108], counter: [150, 140, 120], fixture: [120, 130, 140], appliance: [200, 200, 205], island: [150, 140, 120], table: [140, 120, 100],
    plate: [138, 180, 248], bowl: [246, 193, 119], mug: [199, 146, 234], carton: [240, 220, 120], door: [210, 205, 200], unknown: [255, 0, 255],
};
/**
 * @description Render a depth picture through the pinhole camera by casting one ray per sampled
 * pixel (`stride` pixels apart), and return the rays as a sweep the map can integrate.
 * @param intr - Intrinsics (full resolution).
 * @param cam - Camera pose.
 * @param solids - What can be hit.
 * @param maxRange - Range limit.
 * @param stride - Pixel step (4 → 160×120 from 640×480).
 * @returns The picture.
 */
function renderDepthPicture(intr, cam, solids, maxRange = 6, stride = 4) {
    const T = (0, camera_model_1.cameraToWorld)(cam);
    const width = Math.floor(intr.width / stride);
    const height = Math.floor(intr.height / stride);
    const depth = new Float32Array(width * height);
    const names = new Array(width * height).fill('');
    const rgb = new Uint8Array(width * height * 3);
    const hits = [];
    const misses = [];
    for (let v = 0; v < height; v += 1) {
        for (let u = 0; u < width; u += 1) {
            const px = (u + 0.5) * stride;
            const py = (v + 0.5) * stride;
            const dCam = [(px - intr.cx) / intr.fx, (py - intr.cy) / intr.fy, 1];
            const dWorld = (0, transform_1.applyToDirection)(T, dCam);
            const dir = (0, vec_1.scale)(dWorld, 1 / (0, vec_1.norm)(dWorld));
            const hit = castRay(cam.position, dir, solids, maxRange);
            const idx = v * width + u;
            if (hit) {
                depth[idx] = hit.t;
                names[idx] = hit.name;
                hits.push(hit);
                const base = exports.PAINT[hit.paint] ?? exports.PAINT.unknown;
                const shade = Math.max(0.35, 1 - hit.t / maxRange);
                rgb[idx * 3] = Math.round(base[0] * shade);
                rgb[idx * 3 + 1] = Math.round(base[1] * shade);
                rgb[idx * 3 + 2] = Math.round(base[2] * shade);
            }
            else {
                depth[idx] = Number.POSITIVE_INFINITY;
                misses.push((0, vec_1.add)(cam.position, (0, vec_1.scale)(dir, maxRange)));
                rgb[idx * 3] = 14;
                rgb[idx * 3 + 1] = 16;
                rgb[idx * 3 + 2] = 22;
            }
        }
    }
    return { width, height, depth, names, rgb, sweep: { origin: cam.position, hits, misses }, camera: cam, simulated: true };
}
//# sourceMappingURL=raycast.js.map