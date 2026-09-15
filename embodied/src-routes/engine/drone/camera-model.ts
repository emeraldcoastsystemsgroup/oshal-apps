/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the drone's camera as a pinhole model: the
 *                     |                             | camera-to-world transform from drone pose + gimbal pitch,
 *                     |                             | point projection, box-outline projection (what the surface
 *                     |                             | draws as "the drone's view"), object detection as the
 *                     |                             | projected bounding box of each unenclosed object in view, and
 *                     |                             | monocular localisation by intersecting the pixel ray with the
 *                     |                             | object's support plane. The simulated picture is exactly this
 *                     |                             | geometry — it is labelled a simulation on the surface.
 */

import { applyToDirection, applyToPoint, multiply, rotationRpy, translation, type Mat4 } from '../math/transform';
import { add, scale, sub, type Vec3 } from '../math/vec';
import type { Box3 } from './quad-model';

/** @description Pinhole intrinsics in pixels. */
export interface CameraIntrinsics {
  width: number;
  height: number;
  fx: number;
  fy: number;
  cx: number;
  cy: number;
}

/** @description A 640×480 camera with a ~77° horizontal field of view. */
export const DEFAULT_INTRINSICS: CameraIntrinsics = { width: 640, height: 480, fx: 400, fy: 400, cx: 320, cy: 240 };

/** @description Where the camera is and where it looks. Pitch is negative looking down. */
export interface CameraPose {
  position: Vec3;
  yaw: number;
  pitch: number;
}

/**
 * @description World-from-camera transform. Camera axes follow the OpenCV convention (z forward,
 * x right, y down); the body frame is x forward, y left, z up.
 * @param cam - The camera pose.
 * @returns The 4×4 transform mapping camera coordinates to world coordinates.
 */
export function cameraToWorld(cam: CameraPose): Mat4 {
  const body = multiply(translation(cam.position[0], cam.position[1], cam.position[2]), rotationRpy(0, -cam.pitch, cam.yaw));
  // Camera→body: cam z → body x, cam x → body −y, cam y → body −z.
  const swap: Mat4 = [0, 0, 1, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 0, 1];
  return multiply(body, swap);
}

/** @description Inverse of a rigid transform (rotation transposed, translation rotated back). */
function invertRigid(m: Mat4): Mat4 {
  const r = [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]];
  const t = [m[3], m[7], m[11]];
  return [
    r[0], r[1], r[2], -(r[0] * t[0] + r[1] * t[1] + r[2] * t[2]),
    r[3], r[4], r[5], -(r[3] * t[0] + r[4] * t[1] + r[5] * t[2]),
    r[6], r[7], r[8], -(r[6] * t[0] + r[7] * t[1] + r[8] * t[2]),
    0, 0, 0, 1,
  ];
}

/** @description A pixel with depth along the optical axis. */
export interface Projected {
  u: number;
  v: number;
  depth: number;
}

/**
 * @description Project a world point. Null when it is at or behind the camera plane.
 * @param intr - Intrinsics.
 * @param worldFromCamera - The camera pose transform.
 * @param p - World point.
 * @returns Pixel coordinates (may lie outside the image) and depth, or null.
 */
export function projectPoint(intr: CameraIntrinsics, worldFromCamera: Mat4, p: Vec3): Projected | null {
  const c = applyToPoint(invertRigid(worldFromCamera), p);
  if (c[2] <= 1e-6) return null;
  return { u: intr.cx + (intr.fx * c[0]) / c[2], v: intr.cy + (intr.fy * c[1]) / c[2], depth: c[2] };
}

/** @description The eight corners of a box. */
export function boxCorners(b: Box3): Vec3[] {
  const out: Vec3[] = [];
  for (const x of [b.min[0], b.max[0]]) for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) out.push([x, y, z]);
  return out;
}

/** @description The 12 edges of a box as corner-index pairs, matching {@link boxCorners} order. */
export const BOX_EDGES: readonly [number, number][] = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];

/** @description A box drawn in the image: projected corners (null when behind the camera). */
export interface BoxOutline {
  name: string;
  corners: (Projected | null)[];
}

/** @description Project a box for drawing. */
export function projectBoxOutline(intr: CameraIntrinsics, worldFromCamera: Mat4, b: Box3): BoxOutline {
  return { name: b.name ?? 'box', corners: boxCorners(b).map((c) => projectPoint(intr, worldFromCamera, c)) };
}

/** @description What the detector needs to know about an object. */
export interface ObservableObject {
  id: string;
  cls: string;
  center: Vec3;
  size: { l: number; w: number; h: number };
  /** Inside a closed appliance: never visible. */
  enclosed: boolean;
}

/** @description A detection in the image. `u`,`v` is the bounding-box centre. */
export interface Detection {
  objectId: string;
  cls: string;
  u: number;
  v: number;
  depth: number;
  bbox: { u0: number; v0: number; u1: number; v1: number };
}

/** @description The object's axis-aligned box (objects are modelled upright). */
export function objectBox(o: ObservableObject): Box3 {
  const h = [o.size.l / 2, o.size.w / 2, o.size.h / 2];
  return { name: o.id, min: sub(o.center, [h[0], h[1], h[2]]), max: add(o.center, [h[0], h[1], h[2]]) };
}

/**
 * @description Detect every unenclosed object whose centre projects inside the image. The
 * bounding box is the projected extent of the object's box clipped to the image.
 * @param intr - Intrinsics.
 * @param cam - Camera pose.
 * @param objects - Candidate objects.
 * @returns Detections, in input order.
 */
export function observe(intr: CameraIntrinsics, cam: CameraPose, objects: readonly ObservableObject[]): Detection[] {
  const T = cameraToWorld(cam);
  const out: Detection[] = [];
  for (const o of objects) {
    if (o.enclosed) continue;
    const centre = projectPoint(intr, T, o.center);
    if (!centre || centre.u < 0 || centre.u > intr.width || centre.v < 0 || centre.v > intr.height || centre.depth < 0.1) continue;
    const pts = boxCorners(objectBox(o)).map((c) => projectPoint(intr, T, c)).filter((p): p is Projected => p !== null);
    if (!pts.length) continue;
    const u0 = Math.max(0, Math.min(...pts.map((p) => p.u)));
    const u1 = Math.min(intr.width, Math.max(...pts.map((p) => p.u)));
    const v0 = Math.max(0, Math.min(...pts.map((p) => p.v)));
    const v1 = Math.min(intr.height, Math.max(...pts.map((p) => p.v)));
    out.push({ objectId: o.id, cls: o.cls, u: (u0 + u1) / 2, v: (v0 + v1) / 2, depth: centre.depth, bbox: { u0, v0, u1, v1 } });
  }
  return out;
}

/**
 * @description Monocular localisation: intersect the ray through a pixel with a horizontal plane.
 * Used with the plane through the object's centroid (support surface + half height), which is
 * how a known object class is placed from one camera.
 * @param intr - Intrinsics.
 * @param cam - Camera pose.
 * @param u - Pixel column.
 * @param v - Pixel row.
 * @param planeZ - World height of the plane.
 * @returns The world point, or null when the ray does not reach the plane in front of the camera.
 */
export function localizeOnPlane(intr: CameraIntrinsics, cam: CameraPose, u: number, v: number, planeZ: number): Vec3 | null {
  const T = cameraToWorld(cam);
  const dirCam: Vec3 = [(u - intr.cx) / intr.fx, (v - intr.cy) / intr.fy, 1];
  const dir = applyToDirection(T, dirCam);
  const origin = cam.position;
  if (Math.abs(dir[2]) < 1e-9) return null;
  const t = (planeZ - origin[2]) / dir[2];
  if (t <= 0) return null;
  return add(origin, scale(dir, t));
}
