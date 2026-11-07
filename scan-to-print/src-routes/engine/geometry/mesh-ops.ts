/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ | AUTHOR                                    | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1   | maintainer@emeraldcoastsystemsgroup.com   | Interactive 3D mesh operations: 6-plane Sutherland-Hodgman bounding-box crop (RP-SCN-01), build-plate auto-level / rotation / Z=0 snap (RP-SCN-02), and ray-triangle picking + 3D point-to-point distance measurement (RP-SCN-03).
 */

import type { Triangle, TriMesh, Vec3 } from './geometry-types';
import { meshBounds } from './mesh-metrics';
import { crossVec, dotVec, resolveTriangle, triangleArea, triangleNormal } from './vector-math';

export interface CropBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export type LayFlatPreset = 'auto' | 'bottom' | 'top' | 'front' | 'back' | 'left' | 'right';

export interface MeshTransformSpec {
  /** Align a canonical face or dominant planar facet to the build plate (-Z). */
  layFlat?: LayFlatPreset;
  /** Additional rotation around X in degrees. */
  rxDeg?: number;
  /** Additional rotation around Y in degrees. */
  ryDeg?: number;
  /** Additional rotation around Z in degrees. */
  rzDeg?: number;
  /** When true (default), shifts min.z to 0 and centers X/Y on the build plate origin. */
  snapToBed?: boolean;
}

export interface RaycastHit {
  point: Vec3;
  normal: Vec3;
  distance: number;
  triangleIndex: number;
}

export interface PointMeasurement {
  a: Vec3;
  b: Vec3;
  distanceMm: number;
  deltaMm: Vec3;
  absDeltaMm: Vec3;
}

type Mat3 = [number, number, number, number, number, number, number, number, number];

const WELD_SCALE = 1e5;
const PLANE_EPS = 1e-6;

function clipPolygonByPlane(poly: Vec3[], dist: (p: Vec3) => number): Vec3[] {
  if (poly.length < 3) return [];
  const out: Vec3[] = [];
  for (let i = 0; i < poly.length; i += 1) {
    const curr = poly[i];
    const prev = poly[(i + poly.length - 1) % poly.length];
    const dCurr = dist(curr);
    const dPrev = dist(prev);
    const currIn = dCurr >= -PLANE_EPS;
    const prevIn = dPrev >= -PLANE_EPS;
    if (currIn !== prevIn) {
      const denom = dPrev - dCurr;
      const t = Math.abs(denom) > 1e-12 ? Math.max(0, Math.min(1, dPrev / denom)) : 0;
      out.push({
        x: prev.x + (curr.x - prev.x) * t,
        y: prev.y + (curr.y - prev.y) * t,
        z: prev.z + (curr.z - prev.z) * t,
      });
    }
    if (currIn) out.push(curr);
  }
  return out;
}

function validateCropBounds(box: CropBounds): void {
  const vals = [box.minX, box.maxX, box.minY, box.maxY, box.minZ, box.maxZ];
  if (vals.some((v) => typeof v !== 'number' || !Number.isFinite(v))) {
    throw new RangeError('Crop bounds minX..maxZ must all be finite numbers');
  }
  if (!(box.minX < box.maxX) || !(box.minY < box.maxY) || !(box.minZ < box.maxZ)) {
    throw new RangeError('Crop bounds require minX < maxX, minY < maxY and minZ < maxZ');
  }
}

function clipAndCapPlane(mesh: TriMesh, plane: (p: Vec3) => number): TriMesh {
  const vertices: Vec3[] = [];
  const triangles: Triangle[] = [];
  const byKey = new Map<string, number>();
  const intern = (p: Vec3): number => {
    const k = `${Math.round(p.x * WELD_SCALE)},${Math.round(p.y * WELD_SCALE)},${Math.round(p.z * WELD_SCALE)}`;
    const hit = byKey.get(k);
    if (hit !== undefined) return hit;
    const idx = vertices.length;
    vertices.push({ x: p.x, y: p.y, z: p.z });
    byKey.set(k, idx);
    return idx;
  };
  for (let i = 0; i < mesh.triangles.length; i += 1) {
    const poly = clipPolygonByPlane([...resolveTriangle(mesh, mesh.triangles[i], i)], plane);
    for (let k = 1; k + 1 < poly.length; k += 1) {
      if (triangleArea(poly[0], poly[k], poly[k + 1]) <= 1e-9) continue;
      const i0 = intern(poly[0]), i1 = intern(poly[k]), i2 = intern(poly[k + 1]);
      if (i0 !== i1 && i1 !== i2 && i2 !== i0) triangles.push([i0, i1, i2]);
    }
  }
  if (triangles.length === 0) return { vertices: [], triangles: [] };
  const directed = new Map<string, number>();
  for (const [a, b, c] of triangles) {
    for (const [u, v] of [[a, b], [b, c], [c, a]] as Array<[number, number]>) {
      directed.set(`${u}:${v}`, (directed.get(`${u}:${v}`) ?? 0) + 1);
    }
  }
  const openEdges: Array<[number, number]> = [];
  for (const [a, b, c] of triangles) {
    for (const [u, v] of [[a, b], [b, c], [c, a]] as Array<[number, number]>) {
      if ((directed.get(`${u}:${v}`) ?? 0) > (directed.get(`${v}:${u}`) ?? 0)
        && Math.abs(plane(vertices[u])) <= 1e-4 && Math.abs(plane(vertices[v])) <= 1e-4) {
        openEdges.push([u, v]);
      }
    }
  }
  if (openEdges.length >= 3) {
    let sx = 0, sy = 0, sz = 0;
    for (const [u] of openEdges) { sx += vertices[u].x; sy += vertices[u].y; sz += vertices[u].z; }
    const centerIdx = intern({ x: sx / openEdges.length, y: sy / openEdges.length, z: sz / openEdges.length });
    for (const [u, v] of openEdges) {
      if (v !== u && u !== centerIdx && v !== centerIdx) triangles.push([v, u, centerIdx]);
    }
  }
  return { vertices, triangles };
}

/**
 * @description Clip every triangle of {@link mesh} cleanly against an axis-aligned 3D bounding box (RP-SCN-01).
 * @param mesh - Source triangle mesh.
 * @param box - Axis-aligned crop box in millimetres.
 * @param snapToBed - When true, lowers the cropped result so `minZ = 0`.
 * @returns Clipped, planar-capped, welded triangle mesh.
 */
export function cropMesh(mesh: TriMesh, box: CropBounds, snapToBed = false): TriMesh {
  validateCropBounds(box);
  const planes: Array<(p: Vec3) => number> = [
    (p) => p.x - box.minX,
    (p) => box.maxX - p.x,
    (p) => p.y - box.minY,
    (p) => box.maxY - p.y,
    (p) => p.z - box.minZ,
    (p) => box.maxZ - p.z,
  ];
  let current = mesh;
  for (const plane of planes) {
    current = clipAndCapPlane(current, plane);
    if (current.triangles.length === 0) {
      throw new RangeError('Crop box excludes the entire model; widen the crop bounds and try again.');
    }
  }
  if (!snapToBed) return current;
  const minZ = current.vertices.reduce((m, v) => Math.min(m, v.z), Infinity);
  return { vertices: current.vertices.map((v) => ({ x: v.x, y: v.y, z: v.z - minZ })), triangles: current.triangles };
}

function mulMat3(a: Mat3, b: Mat3): Mat3 {
  return [
    a[0] * b[0] + a[1] * b[3] + a[2] * b[6], a[0] * b[1] + a[1] * b[4] + a[2] * b[7], a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
    a[3] * b[0] + a[4] * b[3] + a[5] * b[6], a[3] * b[1] + a[4] * b[4] + a[5] * b[7], a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
    a[6] * b[0] + a[7] * b[3] + a[8] * b[6], a[6] * b[1] + a[7] * b[4] + a[8] * b[7], a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
  ];
}

function rotAxis(axis: 'x' | 'y' | 'z', deg: number): Mat3 {
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  if (axis === 'x') return [1, 0, 0, 0, c, -s, 0, s, c];
  if (axis === 'y') return [c, 0, s, 0, 1, 0, -s, 0, c];
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}

function alignVectorToMinusZ(n: Vec3): Mat3 {
  const len = Math.hypot(n.x, n.y, n.z);
  if (len <= 1e-9) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const u = { x: n.x / len, y: n.y / len, z: n.z / len };
  if (u.z < -0.999999) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  if (u.z > 0.999999) return [1, 0, 0, 0, -1, 0, 0, 0, -1];
  // Cross(u, (0,0,-1)) = (-u.y, u.x, 0); dot(u, (0,0,-1)) = -u.z
  const ax = -u.y;
  const ay = u.x;
  const sinA = Math.hypot(ax, ay);
  const kx = ax / sinA;
  const ky = ay / sinA;
  const cosA = -u.z;
  const k = 1 - cosA;
  return [
    cosA + kx * kx * k, kx * ky * k, ky * sinA,
    kx * ky * k, cosA + ky * ky * k, -kx * sinA,
    -ky * sinA, kx * sinA, cosA,
  ];
}

/**
 * @description Find the largest-area flat facet cluster normal on {@link mesh} for automatic build-plate leveling.
 */
export function dominantSupportNormal(mesh: TriMesh): Vec3 {
  const buckets = new Map<string, { area: number; sum: Vec3 }>();
  for (let i = 0; i < mesh.triangles.length; i += 1) {
    const [a, b, c] = resolveTriangle(mesh, mesh.triangles[i], i);
    const area = triangleArea(a, b, c);
    if (area <= 1e-9) continue;
    const n = triangleNormal(a, b, c);
    const key = `${Math.round(n.x * 20)},${Math.round(n.y * 20)},${Math.round(n.z * 20)}`;
    const prev = buckets.get(key) ?? { area: 0, sum: { x: 0, y: 0, z: 0 } };
    prev.area += area;
    prev.sum.x += n.x * area;
    prev.sum.y += n.y * area;
    prev.sum.z += n.z * area;
    buckets.set(key, prev);
  }
  let best: { area: number; sum: Vec3 } | null = null;
  for (const entry of buckets.values()) {
    if (!best || entry.area > best.area) best = entry;
  }
  if (!best) return { x: 0, y: 0, z: -1 };
  const len = Math.hypot(best.sum.x, best.sum.y, best.sum.z);
  return len > 1e-9 ? { x: best.sum.x / len, y: best.sum.y / len, z: best.sum.z / len } : { x: 0, y: 0, z: -1 };
}

function layFlatMatrix(mesh: TriMesh, preset?: LayFlatPreset): Mat3 {
  if (!preset) return [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const normals: Record<Exclude<LayFlatPreset, 'auto'>, Vec3> = {
    bottom: { x: 0, y: 0, z: -1 },
    top: { x: 0, y: 0, z: 1 },
    front: { x: 0, y: -1, z: 0 },
    back: { x: 0, y: 1, z: 0 },
    left: { x: -1, y: 0, z: 0 },
    right: { x: 1, y: 0, z: 0 },
  };
  const target = preset === 'auto' ? dominantSupportNormal(mesh) : normals[preset];
  return alignVectorToMinusZ(target);
}

/**
 * @description Rotate / level {@link mesh} onto the build plate and optionally snap `minZ = 0` (RP-SCN-02).
 */
export function transformMesh(mesh: TriMesh, spec: MeshTransformSpec): TriMesh {
  const rx = Number(spec.rxDeg ?? 0);
  const ry = Number(spec.ryDeg ?? 0);
  const rz = Number(spec.rzDeg ?? 0);
  if (![rx, ry, rz].every((d) => Number.isFinite(d) && Math.abs(d) <= 360)) {
    throw new RangeError('Rotation angles rxDeg, ryDeg and rzDeg must be finite degrees between -360 and 360');
  }
  if (spec.layFlat !== undefined && !['auto', 'bottom', 'top', 'front', 'back', 'left', 'right'].includes(spec.layFlat)) {
    throw new RangeError('layFlat must be one of auto, bottom, top, front, back, left, right');
  }
  const { center } = meshBounds(mesh);
  let m = layFlatMatrix(mesh, spec.layFlat);
  if (rx !== 0) m = mulMat3(rotAxis('x', rx), m);
  if (ry !== 0) m = mulMat3(rotAxis('y', ry), m);
  if (rz !== 0) m = mulMat3(rotAxis('z', rz), m);
  const rotated = mesh.vertices.map((v) => {
    const dx = v.x - center.x;
    const dy = v.y - center.y;
    const dz = v.z - center.z;
    return {
      x: m[0] * dx + m[1] * dy + m[2] * dz + center.x,
      y: m[3] * dx + m[4] * dy + m[5] * dz + center.y,
      z: m[6] * dx + m[7] * dy + m[8] * dz + center.z,
    };
  });
  const snap = spec.snapToBed !== false;
  if (!snap) return { vertices: rotated, triangles: mesh.triangles.map(([a, b, c]) => [a, b, c]) };
  const nextBounds = meshBounds({ vertices: rotated, triangles: mesh.triangles });
  return {
    vertices: rotated.map((v) => ({
      x: v.x - nextBounds.center.x,
      y: v.y - nextBounds.center.y,
      z: v.z - nextBounds.min.z,
    })),
    triangles: mesh.triangles.map(([a, b, c]) => [a, b, c]),
  };
}

/**
 * @description Möller-Trumbore ray-mesh intersection returning the nearest surface hit (RP-SCN-03).
 */
export function raycastMesh(mesh: TriMesh, origin: Vec3, direction: Vec3): RaycastHit | null {
  const dirLen = Math.hypot(direction.x, direction.y, direction.z);
  if (!(dirLen > 1e-12)) throw new RangeError('Ray direction must be non-zero');
  const dir = { x: direction.x / dirLen, y: direction.y / dirLen, z: direction.z / dirLen };
  let bestT = Infinity;
  let bestIdx = -1;
  for (let i = 0; i < mesh.triangles.length; i += 1) {
    const [a, b, c] = resolveTriangle(mesh, mesh.triangles[i], i);
    const e1 = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z };
    const e2 = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z };
    const pvec = crossVec(dir, e2);
    const det = dotVec(e1, pvec);
    if (Math.abs(det) < 1e-9) continue;
    const invDet = 1 / det;
    const tvec = { x: origin.x - a.x, y: origin.y - a.y, z: origin.z - a.z };
    const u = dotVec(tvec, pvec) * invDet;
    if (u < -1e-6 || u > 1 + 1e-6) continue;
    const qvec = crossVec(tvec, e1);
    const v = dotVec(dir, qvec) * invDet;
    if (v < -1e-6 || u + v > 1 + 1e-6) continue;
    const t = dotVec(e2, qvec) * invDet;
    if (t > 1e-6 && t < bestT) {
      bestT = t;
      bestIdx = i;
    }
  }
  if (bestIdx < 0) return null;
  const [a, b, c] = resolveTriangle(mesh, mesh.triangles[bestIdx], bestIdx);
  return {
    point: { x: origin.x + dir.x * bestT, y: origin.y + dir.y * bestT, z: origin.z + dir.z * bestT },
    normal: triangleNormal(a, b, c),
    distance: bestT,
    triangleIndex: bestIdx,
  };
}

/**
 * @description Compute exact Euclidean distance and X/Y/Z deltas between two 3D surface points (RP-SCN-03).
 */
export function measurePoints(a: Vec3, b: Vec3): PointMeasurement {
  for (const v of [a.x, a.y, a.z, b.x, b.y, b.z]) {
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new RangeError('Measurement points must have finite X, Y, Z coordinates');
  }
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dz = b.z - a.z;
  return {
    a: { x: a.x, y: a.y, z: a.z },
    b: { x: b.x, y: b.y, z: b.z },
    distanceMm: Math.hypot(dx, dy, dz),
    deltaMm: { x: dx, y: dy, z: dz },
    absDeltaMm: { x: Math.abs(dx), y: Math.abs(dy), z: Math.abs(dz) },
  };
}
