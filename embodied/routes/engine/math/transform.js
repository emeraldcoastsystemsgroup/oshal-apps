"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — 4×4 homogeneous transforms as flat row-major
 *                     |                             | arrays: identity, multiply, the standard Denavit–Hartenberg
 *                     |                             | link transform, roll/pitch/yaw ↔ rotation matrix, and the
 *                     |                             | rotation-vector (log map) used as the orientation error in
 *                     |                             | inverse kinematics. Pure functions; no hidden state.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.position = exports.translation = exports.identity = void 0;
exports.multiply = multiply;
exports.dhTransform = dhTransform;
exports.rotationRpy = rotationRpy;
exports.fromPose = fromPose;
exports.rpyOf = rpyOf;
exports.toPose = toPose;
exports.rotationInverse = rotationInverse;
exports.rotationVector = rotationVector;
exports.applyToPoint = applyToPoint;
exports.applyToDirection = applyToDirection;
/** @description The identity transform. */
const identity = () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
exports.identity = identity;
/**
 * @description Matrix product A·B.
 * @param a - Left operand.
 * @param b - Right operand.
 * @returns A new 16-element array.
 */
function multiply(a, b) {
    const out = new Array(16).fill(0);
    for (let r = 0; r < 4; r += 1) {
        for (let c = 0; c < 4; c += 1) {
            let s = 0;
            for (let k = 0; k < 4; k += 1)
                s += a[r * 4 + k] * b[k * 4 + c];
            out[r * 4 + c] = s;
        }
    }
    return out;
}
/**
 * @description The standard Denavit–Hartenberg link transform
 * RotZ(θ)·TransZ(d)·TransX(a)·RotX(α).
 * @param theta - Joint angle (radians).
 * @param d - Link offset along the previous z.
 * @param a - Link length along the new x.
 * @param alpha - Link twist about the new x.
 * @returns The 4×4 link transform.
 */
function dhTransform(theta, d, a, alpha) {
    const ct = Math.cos(theta);
    const st = Math.sin(theta);
    const ca = Math.cos(alpha);
    const sa = Math.sin(alpha);
    return [
        ct, -st * ca, st * sa, a * ct,
        st, ct * ca, -ct * sa, a * st,
        0, sa, ca, d,
        0, 0, 0, 1,
    ];
}
/** @description Pure translation. */
const translation = (x, y, z) => [1, 0, 0, x, 0, 1, 0, y, 0, 0, 1, z, 0, 0, 0, 1];
exports.translation = translation;
/**
 * @description Rotation matrix (embedded in a Mat4) from roll/pitch/yaw, ZYX convention:
 * R = Rz(yaw)·Ry(pitch)·Rx(roll).
 * @param roll - About x.
 * @param pitch - About y.
 * @param yaw - About z.
 * @returns The 4×4 rotation with zero translation.
 */
function rotationRpy(roll, pitch, yaw) {
    const cr = Math.cos(roll);
    const sr = Math.sin(roll);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    const cy = Math.cos(yaw);
    const sy = Math.sin(yaw);
    return [
        cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr, 0,
        sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr, 0,
        -sp, cp * sr, cp * cr, 0,
        0, 0, 0, 1,
    ];
}
/** @description A full transform from a Pose6 (rotation then translation). */
function fromPose(p) {
    const m = rotationRpy(p.roll, p.pitch, p.yaw);
    m[3] = p.x;
    m[7] = p.y;
    m[11] = p.z;
    return m;
}
/** @description The translation column of a transform. */
const position = (m) => [m[3], m[7], m[11]];
exports.position = position;
/**
 * @description Roll/pitch/yaw (ZYX) from the rotation block. Pitch is clamped to ±90° at the
 * gimbal singularity, where roll is set to zero by convention.
 * @param m - A transform.
 * @returns roll, pitch, yaw in radians.
 */
function rpyOf(m) {
    const sp = -m[8];
    const pitch = Math.asin(Math.max(-1, Math.min(1, sp)));
    if (Math.abs(sp) > 0.999999) {
        return { roll: 0, pitch, yaw: Math.atan2(-m[1], m[5]) };
    }
    return { roll: Math.atan2(m[9], m[10]), pitch, yaw: Math.atan2(m[4], m[0]) };
}
/** @description Pose6 from a transform. */
function toPose(m) {
    const [x, y, z] = (0, exports.position)(m);
    return { x, y, z, ...rpyOf(m) };
}
/** @description Transpose of the rotation block, translation dropped (i.e. R⁻¹). */
function rotationInverse(m) {
    return [m[0], m[4], m[8], 0, m[1], m[5], m[9], 0, m[2], m[6], m[10], 0, 0, 0, 0, 1];
}
/**
 * @description The rotation vector (axis × angle) of a rotation matrix — the log map. Used as the
 * orientation error in inverse kinematics; its length is the angle between two frames.
 * @param r - A transform whose rotation block is read.
 * @returns Axis-angle vector in radians.
 */
function rotationVector(r) {
    const trace = r[0] + r[5] + r[10];
    const cosA = Math.max(-1, Math.min(1, (trace - 1) / 2));
    const angle = Math.acos(cosA);
    if (angle < 1e-9)
        return [0, 0, 0];
    if (Math.PI - angle < 1e-6) {
        // At 180° the skew part vanishes; recover the axis from the diagonal.
        const ax = Math.sqrt(Math.max(0, (r[0] + 1) / 2));
        const ay = Math.sqrt(Math.max(0, (r[5] + 1) / 2)) * (r[1] < 0 ? -1 : 1);
        const az = Math.sqrt(Math.max(0, (r[10] + 1) / 2)) * (r[2] < 0 ? -1 : 1);
        return [ax * Math.PI, ay * Math.PI, az * Math.PI];
    }
    const k = angle / (2 * Math.sin(angle));
    return [(r[9] - r[6]) * k, (r[2] - r[8]) * k, (r[4] - r[1]) * k];
}
/** @description Apply a transform to a point. */
function applyToPoint(m, p) {
    return [
        m[0] * p[0] + m[1] * p[1] + m[2] * p[2] + m[3],
        m[4] * p[0] + m[5] * p[1] + m[6] * p[2] + m[7],
        m[8] * p[0] + m[9] * p[1] + m[10] * p[2] + m[11],
    ];
}
/** @description Apply only the rotation block to a direction. */
function applyToDirection(m, d) {
    return [
        m[0] * d[0] + m[1] * d[1] + m[2] * d[2],
        m[4] * d[0] + m[5] * d[1] + m[6] * d[2],
        m[8] * d[0] + m[9] * d[1] + m[10] * d[2],
    ];
}
//# sourceMappingURL=transform.js.map