"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.BOX_EDGES = exports.DEFAULT_INTRINSICS = void 0;
exports.cameraToWorld = cameraToWorld;
exports.projectPoint = projectPoint;
exports.boxCorners = boxCorners;
exports.projectBoxOutline = projectBoxOutline;
exports.objectBox = objectBox;
exports.observe = observe;
exports.localizeOnPlane = localizeOnPlane;
const transform_1 = require("../math/transform");
const vec_1 = require("../math/vec");
/** @description A 640×480 camera with a ~77° horizontal field of view. */
exports.DEFAULT_INTRINSICS = { width: 640, height: 480, fx: 400, fy: 400, cx: 320, cy: 240 };
/**
 * @description World-from-camera transform. Camera axes follow the OpenCV convention (z forward,
 * x right, y down); the body frame is x forward, y left, z up.
 * @param cam - The camera pose.
 * @returns The 4×4 transform mapping camera coordinates to world coordinates.
 */
function cameraToWorld(cam) {
    const body = (0, transform_1.multiply)((0, transform_1.translation)(cam.position[0], cam.position[1], cam.position[2]), (0, transform_1.rotationRpy)(0, -cam.pitch, cam.yaw));
    // Camera→body: cam z → body x, cam x → body −y, cam y → body −z.
    const swap = [0, 0, 1, 0, -1, 0, 0, 0, 0, -1, 0, 0, 0, 0, 0, 1];
    return (0, transform_1.multiply)(body, swap);
}
/** @description Inverse of a rigid transform (rotation transposed, translation rotated back). */
function invertRigid(m) {
    const r = [m[0], m[4], m[8], m[1], m[5], m[9], m[2], m[6], m[10]];
    const t = [m[3], m[7], m[11]];
    return [
        r[0], r[1], r[2], -(r[0] * t[0] + r[1] * t[1] + r[2] * t[2]),
        r[3], r[4], r[5], -(r[3] * t[0] + r[4] * t[1] + r[5] * t[2]),
        r[6], r[7], r[8], -(r[6] * t[0] + r[7] * t[1] + r[8] * t[2]),
        0, 0, 0, 1,
    ];
}
/**
 * @description Project a world point. Null when it is at or behind the camera plane.
 * @param intr - Intrinsics.
 * @param worldFromCamera - The camera pose transform.
 * @param p - World point.
 * @returns Pixel coordinates (may lie outside the image) and depth, or null.
 */
function projectPoint(intr, worldFromCamera, p) {
    const c = (0, transform_1.applyToPoint)(invertRigid(worldFromCamera), p);
    if (c[2] <= 1e-6)
        return null;
    return { u: intr.cx + (intr.fx * c[0]) / c[2], v: intr.cy + (intr.fy * c[1]) / c[2], depth: c[2] };
}
/** @description The eight corners of a box. */
function boxCorners(b) {
    const out = [];
    for (const x of [b.min[0], b.max[0]])
        for (const y of [b.min[1], b.max[1]])
            for (const z of [b.min[2], b.max[2]])
                out.push([x, y, z]);
    return out;
}
/** @description The 12 edges of a box as corner-index pairs, matching {@link boxCorners} order. */
exports.BOX_EDGES = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
/** @description Project a box for drawing. */
function projectBoxOutline(intr, worldFromCamera, b) {
    return { name: b.name ?? 'box', corners: boxCorners(b).map((c) => projectPoint(intr, worldFromCamera, c)) };
}
/** @description The object's axis-aligned box (objects are modelled upright). */
function objectBox(o) {
    const h = [o.size.l / 2, o.size.w / 2, o.size.h / 2];
    return { name: o.id, min: (0, vec_1.sub)(o.center, [h[0], h[1], h[2]]), max: (0, vec_1.add)(o.center, [h[0], h[1], h[2]]) };
}
/**
 * @description Detect every unenclosed object whose centre projects inside the image. The
 * bounding box is the projected extent of the object's box clipped to the image.
 * @param intr - Intrinsics.
 * @param cam - Camera pose.
 * @param objects - Candidate objects.
 * @returns Detections, in input order.
 */
function observe(intr, cam, objects) {
    const T = cameraToWorld(cam);
    const out = [];
    for (const o of objects) {
        if (o.enclosed)
            continue;
        const centre = projectPoint(intr, T, o.center);
        if (!centre || centre.u < 0 || centre.u > intr.width || centre.v < 0 || centre.v > intr.height || centre.depth < 0.1)
            continue;
        const pts = boxCorners(objectBox(o)).map((c) => projectPoint(intr, T, c)).filter((p) => p !== null);
        if (!pts.length)
            continue;
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
function localizeOnPlane(intr, cam, u, v, planeZ) {
    const T = cameraToWorld(cam);
    const dirCam = [(u - intr.cx) / intr.fx, (v - intr.cy) / intr.fy, 1];
    const dir = (0, transform_1.applyToDirection)(T, dirCam);
    const origin = cam.position;
    if (Math.abs(dir[2]) < 1e-9)
        return null;
    const t = (planeZ - origin[2]) / dir[2];
    if (t <= 0)
        return null;
    return (0, vec_1.add)(origin, (0, vec_1.scale)(dir, t));
}
//# sourceMappingURL=camera-model.js.map