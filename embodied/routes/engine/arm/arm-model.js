"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the simulated six-degree-of-freedom arm as a
 *                     |                             | Denavit–Hartenberg table (the "sim-6": shoulder yaw, shoulder
 *                     |                             | pitch, elbow, spherical wrist, tool offset), its joint limits,
 *                     |                             | speeds and link masses, forward kinematics, and the arm's own
 *                     |                             | centre of mass — which feeds the base's tip budget. The table is
 *                     |                             | this package's own; it is not a vendor's published model.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.shoulderPoint = exports.READY_Q = exports.STOW_Q = exports.SIM_ARM_6 = void 0;
exports.forwardKinematics = forwardKinematics;
exports.tcpPose = tcpPose;
exports.jointOrigins = jointOrigins;
exports.armCenterOfMass = armCenterOfMass;
exports.clampToLimits = clampToLimits;
exports.withinLimits = withinLimits;
exports.maxReach = maxReach;
exports.stepJoints = stepJoints;
const transform_1 = require("../math/transform");
const vec_1 = require("../math/vec");
const HALF_PI = Math.PI / 2;
/**
 * @description The sim-6 arm. At q = 0 the tool centre point sits at (0.35, 0, 0.70) in the arm
 * base frame with the tool axis pointing +z; the wrist is spherical (joints 4–6 intersect).
 * Reach from the shoulder is a2 + d4 + d6 = 0.75 m. Masses total 12.2 kg + 1.4 kg tool, the
 * figures the hardware design budgets for the arm assembly.
 */
exports.SIM_ARM_6 = {
    id: 'sim-6',
    joints: [
        { d: 0.30, a: 0, alpha: HALF_PI, min: -Math.PI, max: Math.PI, maxSpeed: 1.0, linkMass: 2.8 },
        { d: 0, a: 0.35, alpha: 0, min: -2.2, max: 2.2, maxSpeed: 1.0, linkMass: 3.4 },
        { d: 0, a: 0, alpha: -HALF_PI, min: -3.3, max: 3.3, maxSpeed: 1.2, linkMass: 2.2 },
        { d: 0.30, a: 0, alpha: HALF_PI, min: -Math.PI, max: Math.PI, maxSpeed: 1.5, linkMass: 1.6 },
        { d: 0, a: 0, alpha: -HALF_PI, min: -3.05, max: 3.05, maxSpeed: 1.5, linkMass: 1.3 },
        { d: 0.10, a: 0, alpha: 0, min: -Math.PI, max: Math.PI, maxSpeed: 2.0, linkMass: 0.9 },
    ],
    toolMass: 1.4,
};
/** @description The folded travelling configuration: elbow tucked, tool near the column. */
exports.STOW_Q = [0, 1.9, -2.4, 0, -1.2, 0];
/** @description A neutral working configuration the planner seeds inverse kinematics from. */
exports.READY_Q = [0, 0.6, -1.2, 0, -1.0, 0];
/**
 * @description Forward kinematics by composing the DH link transforms.
 * @param spec - The arm.
 * @param q - Joint angles (rad), one per joint.
 * @returns Every intermediate frame and the tool frame.
 */
function forwardKinematics(spec, q) {
    if (q.length !== spec.joints.length)
        throw new RangeError(`expected ${spec.joints.length} joint angles, got ${q.length}`);
    const frames = [];
    let t = (0, transform_1.identity)();
    spec.joints.forEach((j, i) => {
        t = (0, transform_1.multiply)(t, (0, transform_1.dhTransform)(q[i], j.d, j.a, j.alpha));
        frames.push(t);
    });
    return { frames, tcp: frames[frames.length - 1] };
}
/** @description The tool pose for a joint configuration. */
function tcpPose(spec, q) {
    return (0, transform_1.toPose)(forwardKinematics(spec, q).tcp);
}
/**
 * @description The origin of every frame, starting with the arm base, for drawing and collision
 * checks: a polyline through the joints.
 * @param spec - The arm.
 * @param q - Joint angles.
 * @returns Base origin followed by each frame origin (7 points for a 6-joint arm).
 */
function jointOrigins(spec, q) {
    const { frames } = forwardKinematics(spec, q);
    return [[0, 0, 0], ...frames.map(transform_1.position)];
}
/**
 * @description The arm's total mass and centre of mass in the arm base frame. Each link is
 * lumped at the midpoint of its segment; the tool mass sits at the tool centre point.
 * @param spec - The arm.
 * @param q - Joint angles.
 * @returns Total mass (kg) and centre of mass (m).
 */
function armCenterOfMass(spec, q) {
    const origins = jointOrigins(spec, q);
    let mass = 0;
    let weighted = [0, 0, 0];
    spec.joints.forEach((j, i) => {
        const mid = (0, vec_1.scale)((0, vec_1.add)(origins[i], origins[i + 1]), 0.5);
        weighted = (0, vec_1.add)(weighted, (0, vec_1.scale)(mid, j.linkMass));
        mass += j.linkMass;
    });
    weighted = (0, vec_1.add)(weighted, (0, vec_1.scale)(origins[origins.length - 1], spec.toolMass));
    mass += spec.toolMass;
    return { mass, com: (0, vec_1.scale)(weighted, 1 / mass) };
}
/** @description Joint angles clamped into their limits. */
function clampToLimits(spec, q) {
    return spec.joints.map((j, i) => Math.min(j.max, Math.max(j.min, q[i])));
}
/** @description True when every joint angle is inside its limits (inclusive, 1e-9 slack). */
function withinLimits(spec, q) {
    return spec.joints.every((j, i) => q[i] >= j.min - 1e-9 && q[i] <= j.max + 1e-9);
}
/** @description The shoulder point (frame-1 origin at q = 0) the reach envelope is measured from. */
const shoulderPoint = (spec) => [0, 0, spec.joints[0].d];
exports.shoulderPoint = shoulderPoint;
/** @description Maximum distance from the shoulder the tool centre point can ever reach. */
function maxReach(spec) {
    return spec.joints.slice(1).reduce((sum, j) => sum + Math.abs(j.a) + Math.abs(j.d), 0);
}
/**
 * @description Move every joint toward a target by at most its speed × dt. Returns the new angles
 * and whether the target was reached this step.
 * @param spec - The arm.
 * @param q - Current angles.
 * @param target - Target angles.
 * @param dt - Step (s).
 * @returns Next angles and arrival flag.
 */
function stepJoints(spec, q, target, dt) {
    let arrived = true;
    const next = spec.joints.map((j, i) => {
        const delta = target[i] - q[i];
        const step = j.maxSpeed * dt;
        if (Math.abs(delta) <= step)
            return target[i];
        arrived = false;
        return q[i] + Math.sign(delta) * step;
    });
    return { q: next, arrived };
}
//# sourceMappingURL=arm-model.js.map