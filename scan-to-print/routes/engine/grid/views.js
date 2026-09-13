"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.VIEW_FRAMES = exports.VIEW_NAMES = void 0;
exports.isViewName = isViewName;
exports.readAxis = readAxis;
exports.axisVector = axisVector;
exports.projectToView = projectToView;
exports.viewExtent = viewExtent;
exports.crossAxes = crossAxes;
/** @description Every view name, in drawing-sheet order. */
exports.VIEW_NAMES = ['front', 'back', 'left', 'right', 'top', 'bottom'];
const P = (axis) => ({ axis, sign: 1 });
const N = (axis) => ({ axis, sign: -1 });
/**
 * @description The canonical frame table. Front looks along +Y with X to the right and Z up; the
 * others are the third-angle neighbours: top is seen from +Z with the object's front at the
 * bottom of the image, right is seen from +X with the front at the left of the image, and so on.
 */
exports.VIEW_FRAMES = Object.freeze({
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
function isViewName(value) {
    return typeof value === 'string' && exports.VIEW_NAMES.includes(value);
}
/**
 * @description Read a point's coordinate along a signed axis.
 * @param p - World point.
 * @param ref - Signed axis.
 * @returns `sign · p[axis]`.
 */
function readAxis(p, ref) {
    return ref.sign * p[ref.axis];
}
/**
 * @description Unit vector for a signed axis.
 * @param ref - Signed axis.
 * @returns A world direction.
 */
function axisVector(ref) {
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
function projectToView(p, frame) {
    return { u: readAxis(p, frame.u), v: readAxis(p, frame.v) };
}
/**
 * @description Which world extents a view can see: the object size along its `u` and `v` axes
 * (what the silhouette measures) and along `look` (what a silhouette cannot measure).
 * @param frame - The view.
 * @param size - Object size in world units.
 * @returns `{ uMm, vMm, depthMm }`.
 */
function viewExtent(frame, size) {
    return { uMm: size[frame.u.axis], vMm: size[frame.v.axis], depthMm: size[frame.look.axis] };
}
/**
 * @description The cross product of two signed axes, used by the spec to prove each frame is a
 * right-handed camera (image right × image up = −look).
 * @param a - Left operand.
 * @param b - Right operand.
 * @returns The cross product as a world vector.
 */
function crossAxes(a, b) {
    const av = axisVector(a);
    const bv = axisVector(b);
    // `+ 0` folds IEEE −0 into 0 so the result compares equal to a hand-written axis vector.
    return { x: av.y * bv.z - av.z * bv.y + 0, y: av.z * bv.x - av.x * bv.z + 0, z: av.x * bv.y - av.y * bv.x + 0 };
}
//# sourceMappingURL=views.js.map