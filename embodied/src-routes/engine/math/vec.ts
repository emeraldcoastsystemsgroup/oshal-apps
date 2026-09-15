/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the small vector / angle toolkit every engine
 *                     |                             | module shares. Plain tuples, no classes, no allocation tricks:
 *                     |                             | the point is that every number in the simulation is traceable.
 */

/** @description A point or direction in the world frame (metres). X east, Y north, Z up. */
export type Vec3 = readonly [number, number, number];

/** @description A planar pose: position plus heading (radians, counter-clockwise from +X). */
export interface Pose2 {
  x: number;
  y: number;
  yaw: number;
}

/** @description A full rigid pose: position plus roll/pitch/yaw (radians, ZYX convention). */
export interface Pose6 {
  x: number;
  y: number;
  z: number;
  roll: number;
  pitch: number;
  yaw: number;
}

/** @description Vector sum. */
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
/** @description Vector difference a − b. */
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
/** @description Scalar multiple. */
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
/** @description Dot product. */
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
/** @description Cross product a × b. */
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
/** @description Euclidean length. */
export const norm = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
/** @description Distance between two points. */
export const distance = (a: Vec3, b: Vec3): number => norm(sub(a, b));
/** @description Planar (XY) distance between two points. */
export const distance2 = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * @description Wrap an angle into (−π, π]. Every heading comparison in the engine goes through
 * this so a 359° turn never reads as a long way round.
 * @param a - Angle in radians.
 * @returns The equivalent angle in (−π, π].
 */
export function wrapAngle(a: number): number {
  let r = a % (2 * Math.PI);
  if (r <= -Math.PI) r += 2 * Math.PI;
  if (r > Math.PI) r -= 2 * Math.PI;
  return r;
}

/** @description Clamp v into [lo, hi]. */
export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** @description Rotate a planar offset (dx, dy) by yaw and add it to a pose's position. */
export function offsetPose2(p: Pose2, dx: number, dy: number): { x: number; y: number } {
  const c = Math.cos(p.yaw);
  const s = Math.sin(p.yaw);
  return { x: p.x + c * dx - s * dy, y: p.y + s * dx + c * dy };
}

/** @description Round to a fixed number of decimals — for telemetry and logs, never for physics. */
export const round = (v: number, decimals = 3): number => {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
};

/** @description Degrees → radians. */
export const deg = (d: number): number => (d * Math.PI) / 180;
