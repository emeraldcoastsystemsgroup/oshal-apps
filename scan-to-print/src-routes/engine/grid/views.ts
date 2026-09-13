/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the six canonical orthographic views and the
 *                     |                             | ONE world frame every sensor in this package projects into.
 *                     |                             | World: right-handed, Z up, the object standing on the print
 *                     |                             | bed (Z = 0) with its footprint centred on X = Y = 0; the FRONT
 *                     |                             | of the object faces −Y. Each view is an axis triple (image
 *                     |                             | right, image DOWN, viewing direction) and the table is checked
 *                     |                             | for right-handedness by the spec, so a camera, a depth map and
 *                     |                             | a point cloud cannot disagree about which way is up. Third-angle
 *                     |                             | projection (ASME Y14.3) is what the drawing generator assumes.
 */

import type { Vec3 } from '../geometry/geometry-types';

/** @description A world axis name. */
export type Axis = 'x' | 'y' | 'z';

/** @description The six canonical views of an object. */
export type ViewName = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';

/** @description Every view name, in drawing-sheet order. */
export const VIEW_NAMES: readonly ViewName[] = ['front', 'back', 'left', 'right', 'top', 'bottom'];

/** @description A signed world axis: `+x`, `−z`, … */
export interface AxisRef {
  /** Which world axis. */
  axis: Axis;
  /** Direction along it. */
  sign: 1 | -1;
}

/**
 * @description A view's camera basis expressed as signed world axes. `u` is image RIGHT, `v` is
 * image DOWN (top-left pixel origin, like every decoder), `look` is where the camera is pointing.
 */
export interface ViewFrame {
  /** The view this frame describes. */
  name: ViewName;
  /** Image right. */
  u: AxisRef;
  /** Image down. */
  v: AxisRef;
  /** Viewing direction, from the camera into the scene. */
  look: AxisRef;
}

const P = (axis: Axis): AxisRef => ({ axis, sign: 1 });
const N = (axis: Axis): AxisRef => ({ axis, sign: -1 });

/**
 * @description The canonical frame table. Front looks along +Y with X to the right and Z up; the
 * others are the third-angle neighbours: top is seen from +Z with the object's front at the
 * bottom of the image, right is seen from +X with the front at the left of the image, and so on.
 */
export const VIEW_FRAMES: Readonly<Record<ViewName, ViewFrame>> = Object.freeze({
  front: { name: 'front', u: P('x'), v: N('z'), look: P('y') },
  back: { name: 'back', u: N('x'), v: N('z'), look: N('y') },
  left: { name: 'left', u: N('y'), v: N('z'), look: P('x') },
  right: { name: 'right', u: P('y'), v: N('z'), look: N('x') },
  top: { name: 'top', u: P('x'), v: N('y'), look: N('z') },
  bottom: { name: 'bottom', u: P('x'), v: P('y'), look: P('z') },
});

/**
 * @description Type guard for a view name coming off the wire.
 * @param value - Untrusted value.
 * @returns True when it is one of the six views.
 */
export function isViewName(value: unknown): value is ViewName {
  return typeof value === 'string' && (VIEW_NAMES as readonly string[]).includes(value);
}

/**
 * @description Read a point's coordinate along a signed axis.
 * @param p - World point.
 * @param ref - Signed axis.
 * @returns `sign · p[axis]`.
 */
export function readAxis(p: Vec3, ref: AxisRef): number {
  return ref.sign * p[ref.axis];
}

/**
 * @description Unit vector for a signed axis.
 * @param ref - Signed axis.
 * @returns A world direction.
 */
export function axisVector(ref: AxisRef): Vec3 {
  return { x: ref.axis === 'x' ? ref.sign : 0, y: ref.axis === 'y' ? ref.sign : 0, z: ref.axis === 'z' ? ref.sign : 0 };
}

/**
 * @description Orthographic projection of a world point into a view's image plane, in world units
 * (millimetres). No perspective: the capture contract is "camera square to the face, far enough
 * away", and the registration step turns these into pixels.
 * @param p - World point.
 * @param frame - The view.
 * @returns `{ u, v }` in millimetres along image right / image down.
 */
export function projectToView(p: Vec3, frame: ViewFrame): { u: number; v: number } {
  return { u: readAxis(p, frame.u), v: readAxis(p, frame.v) };
}

/**
 * @description Which world extents a view can see: the object size along its `u` and `v` axes
 * (what the silhouette measures) and along `look` (what a silhouette cannot measure).
 * @param frame - The view.
 * @param size - Object size in world units.
 * @returns `{ uMm, vMm, depthMm }`.
 */
export function viewExtent(frame: ViewFrame, size: Vec3): { uMm: number; vMm: number; depthMm: number } {
  return { uMm: size[frame.u.axis], vMm: size[frame.v.axis], depthMm: size[frame.look.axis] };
}

/**
 * @description The cross product of two signed axes, used by the spec to prove each frame is a
 * right-handed camera (image right × image up = −look).
 * @param a - Left operand.
 * @param b - Right operand.
 * @returns The cross product as a world vector.
 */
export function crossAxes(a: AxisRef, b: AxisRef): Vec3 {
  const av = axisVector(a);
  const bv = axisVector(b);
  // `+ 0` folds IEEE −0 into 0 so the result compares equal to a hand-written axis vector.
  return { x: av.y * bv.z - av.z * bv.y + 0, y: av.z * bv.x - av.x * bv.z + 0, z: av.x * bv.y - av.y * bv.x + 0 };
}
