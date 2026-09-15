"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the small vector / angle toolkit every engine
 *                     |                             | module shares. Plain tuples, no classes, no allocation tricks:
 *                     |                             | the point is that every number in the simulation is traceable.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.deg = exports.round = exports.clamp = exports.distance2 = exports.distance = exports.norm = exports.cross = exports.dot = exports.scale = exports.sub = exports.add = void 0;
exports.wrapAngle = wrapAngle;
exports.offsetPose2 = offsetPose2;
/** @description Vector sum. */
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
exports.add = add;
/** @description Vector difference a − b. */
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
exports.sub = sub;
/** @description Scalar multiple. */
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
exports.scale = scale;
/** @description Dot product. */
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
exports.dot = dot;
/** @description Cross product a × b. */
const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
];
exports.cross = cross;
/** @description Euclidean length. */
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
exports.norm = norm;
/** @description Distance between two points. */
const distance = (a, b) => (0, exports.norm)((0, exports.sub)(a, b));
exports.distance = distance;
/** @description Planar (XY) distance between two points. */
const distance2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
exports.distance2 = distance2;
/**
 * @description Wrap an angle into (−π, π]. Every heading comparison in the engine goes through
 * this so a 359° turn never reads as a long way round.
 * @param a - Angle in radians.
 * @returns The equivalent angle in (−π, π].
 */
function wrapAngle(a) {
    let r = a % (2 * Math.PI);
    if (r <= -Math.PI)
        r += 2 * Math.PI;
    if (r > Math.PI)
        r -= 2 * Math.PI;
    return r;
}
/** @description Clamp v into [lo, hi]. */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
exports.clamp = clamp;
/** @description Rotate a planar offset (dx, dy) by yaw and add it to a pose's position. */
function offsetPose2(p, dx, dy) {
    const c = Math.cos(p.yaw);
    const s = Math.sin(p.yaw);
    return { x: p.x + c * dx - s * dy, y: p.y + s * dx + c * dy };
}
/** @description Round to a fixed number of decimals — for telemetry and logs, never for physics. */
const round = (v, decimals = 3) => {
    const f = 10 ** decimals;
    return Math.round(v * f) / f;
};
exports.round = round;
/** @description Degrees → radians. */
const deg = (d) => (d * Math.PI) / 180;
exports.deg = deg;
//# sourceMappingURL=vec.js.map