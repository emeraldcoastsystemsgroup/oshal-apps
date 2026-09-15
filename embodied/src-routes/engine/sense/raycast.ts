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

import type { CameraIntrinsics, CameraPose } from '../drone/camera-model';
import { applyToDirection, type Mat4 } from '../math/transform';
import { cameraToWorld } from '../drone/camera-model';
import { add, norm, scale, type Vec3 } from '../math/vec';

/** @description A named axis-aligned solid a ray can hit, with a colour class for pictures. */
export interface SensedSolid {
  name: string;
  min: Vec3;
  max: Vec3;
  /** Colour class: what a picture paints it as. */
  paint: string;
}

/** @description One ray hit. */
export interface RayHit {
  t: number;
  point: Vec3;
  name: string;
  paint: string;
  /** Outward unit normal of the box face struck — what point-to-plane registration needs from each return. */
  normal: Vec3;
}

/** @description The outward normal of the face of an axis-aligned box that a surface point lies on (the nearest face). */
export function faceNormal(p: Vec3, min: Vec3, max: Vec3): Vec3 {
  let axis = 0; let sign = -1; let bestD = Number.POSITIVE_INFINITY;
  for (let a = 0; a < 3; a += 1) {
    const d0 = Math.abs(p[a] - min[a]); const d1 = Math.abs(p[a] - max[a]);
    if (d0 < bestD) { bestD = d0; axis = a; sign = -1; }
    if (d1 < bestD) { bestD = d1; axis = a; sign = 1; }
  }
  const n: [number, number, number] = [0, 0, 0]; n[axis] = sign;
  return n;
}

/**
 * @description Slab-method ray/box test. Returns the entry distance along the ray, 0 when the
 * origin is inside the box, or null when the ray misses or the box is behind it.
 */
export function rayBox(origin: Vec3, dir: Vec3, min: Vec3, max: Vec3): number | null {
  let tmin = 0;
  let tmax = Number.POSITIVE_INFINITY;
  for (let a = 0; a < 3; a += 1) {
    if (Math.abs(dir[a]) < 1e-12) {
      if (origin[a] < min[a] || origin[a] > max[a]) return null;
      continue;
    }
    const inv = 1 / dir[a];
    let t1 = (min[a] - origin[a]) * inv;
    let t2 = (max[a] - origin[a]) * inv;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
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
export function castRay(origin: Vec3, dir: Vec3, solids: readonly SensedSolid[], maxRange: number): RayHit | null {
  let best: RayHit | null = null;
  for (const s of solids) {
    const t = rayBox(origin, dir, s.min, s.max);
    if (t === null || t > maxRange) continue;
    if (!best || t < best.t) { const point = add(origin, scale(dir, t)); best = { t, point, name: s.name, paint: s.paint, normal: faceNormal(point, s.min, s.max) }; }
  }
  return best;
}

/** @description LiDAR pattern. */
export interface LidarOptions {
  azimuthCount: number;
  elevationsDeg: readonly number[];
  maxRange: number;
  /** An upward time-of-flight ranger: one ray straight up plus `rays` on a cone `coneDeg` off the zenith. A spinning LiDAR tops out at +60° and cannot see the column it is about to climb through. */
  zenith?: ZenithRanger;
}

/** @description The drone's upward ranger — what lets it take off blind. */
export interface ZenithRanger {
  rays: number;
  coneDeg: number;
  maxRange: number;
}

/** @description Elevation rings from −90° (straight down) to +60° in equal steps. */
const elevationRings = (count: number): number[] => Array.from({ length: count }, (_, n) => -90 + (150 * n) / (count - 1));

/**
 * @description A 3-D LiDAR sweep of about one second: 240 azimuths × 33 elevation rings from
 * straight down to +60°, 8 m — dense enough that a 5 cm map column a few metres away receives a
 * return, which is what a room-scale sensor delivers in that time.
 */
export const DEFAULT_LIDAR: LidarOptions = { azimuthCount: 240, elevationsDeg: elevationRings(64), maxRange: 8 };

/** @description The drone's sensor set: the same spinning LiDAR plus an upward ranger (4 m, nine rays within 10° of the zenith). */
export const DRONE_LIDAR: LidarOptions = { ...DEFAULT_LIDAR, zenith: { rays: 8, coneDeg: 10, maxRange: 4 } };

/** @description Cast the zenith ranger's rays into the sweep's hit and miss lists. */
function castZenith(origin: Vec3, yaw: number, solids: readonly SensedSolid[], z: ZenithRanger, hits: RayHit[], misses: Vec3[]): void {
  const dirs: Vec3[] = [[0, 0, 1]];
  const el = ((90 - z.coneDeg) * Math.PI) / 180;
  for (let a = 0; a < z.rays; a += 1) { const az = yaw + (2 * Math.PI * a) / z.rays; dirs.push([Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)]); }
  for (const dir of dirs) { const hit = castRay(origin, dir, solids, z.maxRange); if (hit) hits.push(hit); else misses.push(add(origin, scale(dir, z.maxRange))); }
}

/** @description A sweep's result: where rays stopped, and where they went out to max range without a hit. */
export interface LidarSweep {
  origin: Vec3;
  hits: RayHit[];
  misses: Vec3[];
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
export function lidarSweep(origin: Vec3, yaw: number, solids: readonly SensedSolid[], opts: LidarOptions = DEFAULT_LIDAR): LidarSweep {
  const hits: RayHit[] = [];
  const misses: Vec3[] = [];
  for (const elDeg of opts.elevationsDeg) {
    const el = (elDeg * Math.PI) / 180;
    for (let a = 0; a < opts.azimuthCount; a += 1) {
      const az = yaw + (2 * Math.PI * a) / opts.azimuthCount;
      const dir: Vec3 = [Math.cos(el) * Math.cos(az), Math.cos(el) * Math.sin(az), Math.sin(el)];
      const hit = castRay(origin, dir, solids, opts.maxRange);
      if (hit) hits.push(hit); else misses.push(add(origin, scale(dir, opts.maxRange)));
    }
  }
  if (opts.zenith) castZenith(origin, yaw, solids, opts.zenith, hits, misses);
  return { origin, hits, misses };
}

/** @description A rendered picture: range, hit name and colour per pixel, row-major. */
export interface DepthPicture {
  width: number;
  height: number;
  /** Range along the ray (m), Infinity when nothing was hit. */
  depth: Float32Array;
  /** Hit name per pixel ('' when none). */
  names: string[];
  /** RGB bytes, 3 per pixel. */
  rgb: Uint8Array;
  /** The rays as world points at the hit (or max range) — what the map integrates. */
  sweep: LidarSweep;
  /** The camera it was taken with. */
  camera: CameraPose;
  simulated: true;
}

/** @description Flat colours by paint class, before range shading. */
export const PAINT: Record<string, [number, number, number]> = {
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
export function renderDepthPicture(intr: CameraIntrinsics, cam: CameraPose, solids: readonly SensedSolid[], maxRange = 6, stride = 4): DepthPicture {
  const T: Mat4 = cameraToWorld(cam);
  const width = Math.floor(intr.width / stride);
  const height = Math.floor(intr.height / stride);
  const depth = new Float32Array(width * height);
  const names: string[] = new Array(width * height).fill('');
  const rgb = new Uint8Array(width * height * 3);
  const hits: RayHit[] = [];
  const misses: Vec3[] = [];
  for (let v = 0; v < height; v += 1) {
    for (let u = 0; u < width; u += 1) {
      const px = (u + 0.5) * stride; const py = (v + 0.5) * stride;
      const dCam: Vec3 = [(px - intr.cx) / intr.fx, (py - intr.cy) / intr.fy, 1];
      const dWorld = applyToDirection(T, dCam);
      const dir = scale(dWorld, 1 / norm(dWorld));
      const hit = castRay(cam.position, dir, solids, maxRange);
      const idx = v * width + u;
      if (hit) {
        depth[idx] = hit.t; names[idx] = hit.name; hits.push(hit);
        const base = PAINT[hit.paint] ?? PAINT.unknown;
        const shade = Math.max(0.35, 1 - hit.t / maxRange);
        rgb[idx * 3] = Math.round(base[0] * shade); rgb[idx * 3 + 1] = Math.round(base[1] * shade); rgb[idx * 3 + 2] = Math.round(base[2] * shade);
      } else {
        depth[idx] = Number.POSITIVE_INFINITY; misses.push(add(cam.position, scale(dir, maxRange)));
        rgb[idx * 3] = 14; rgb[idx * 3 + 1] = 16; rgb[idx * 3 + 2] = 22;
      }
    }
  }
  return { width, height, depth, names, rgb, sweep: { origin: cam.position, hits, misses }, camera: cam, simulated: true };
}
