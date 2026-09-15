"use strict";
/**
 * CHANGE LOG
 * -----------------------------------------------------------------------------
 * SEQ                 | AUTHOR                      | DESCRIPTION
 * -----------------------------------------------------------------------------
 * 1 | maintainer@emeraldcoastsystemsgroup.com   | Initial creation — the differential-drive base with its lift:
 *                     |                             | unicycle integration, a turn–drive–align controller with
 *                     |                             | acceleration limits, and the speed ceiling that depends on the
 *                     |                             | lift (0.8 m/s stowed, 0.3 m/s raised — the hardware design's
 *                     |                             | dead-stop energy rule, enforced here so the planner cannot
 *                     |                             | bypass it).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.speedLimit = exports.isStowed = exports.DEFAULT_BASE_LIMITS = void 0;
exports.integrateUnicycle = integrateUnicycle;
exports.driveStep = driveStep;
exports.liftStep = liftStep;
const vec_1 = require("../math/vec");
/** @description The hardware design's limits. */
exports.DEFAULT_BASE_LIMITS = {
    vStowed: 0.8,
    vLifted: 0.3,
    wMax: 0.8,
    accel: 0.6,
    decel: 1.5,
    liftMin: 0.30,
    liftMax: 1.00,
    liftSpeed: 0.04,
};
/** @description True when the carriage is at its bottom stop (within 1 cm). */
const isStowed = (s, limits) => s.liftZ <= limits.liftMin + 0.01;
exports.isStowed = isStowed;
/** @description The forward speed ceiling for the current lift height. */
const speedLimit = (s, limits) => ((0, exports.isStowed)(s, limits) ? limits.vStowed : limits.vLifted);
exports.speedLimit = speedLimit;
/**
 * @description Advance the unicycle model one step with the given commanded speeds, which are
 * clamped to the limits first. Heading integrates at the midpoint for a smoother arc.
 * @param s - Current state.
 * @param v - Commanded forward speed.
 * @param w - Commanded turn rate.
 * @param dt - Step (s).
 * @param limits - Motion limits.
 * @returns The next state.
 */
function integrateUnicycle(s, v, w, dt, limits) {
    const vMax = (0, exports.speedLimit)(s, limits);
    const vc = (0, vec_1.clamp)(v, -vMax, vMax);
    const wc = (0, vec_1.clamp)(w, -limits.wMax, limits.wMax);
    const yawMid = s.yaw + wc * dt * 0.5;
    return {
        ...s,
        x: s.x + vc * Math.cos(yawMid) * dt,
        y: s.y + vc * Math.sin(yawMid) * dt,
        yaw: (0, vec_1.wrapAngle)(s.yaw + wc * dt),
        v: vc,
        w: wc,
    };
}
/** @description Ramp a speed toward a target by at most accel·dt (decel·dt when slowing). */
function ramp(current, target, limits, dt) {
    const slowing = Math.abs(target) < Math.abs(current);
    const step = (slowing ? limits.decel : limits.accel) * dt;
    const delta = target - current;
    return Math.abs(delta) <= step ? target : current + Math.sign(delta) * step;
}
/**
 * @description One step of the turn–drive–align controller toward a goal pose.
 *
 * Turn in place until the heading points at the goal, drive with a deceleration profile so the
 * base arrives at rest, then turn to the goal heading. Tolerances: 2 cm position, 1° heading.
 * @param s - Current state.
 * @param goal - Goal pose.
 * @param limits - Motion limits.
 * @param dt - Step (s).
 * @returns The next state, the controller phase, and whether the goal is reached.
 */
function driveStep(s, goal, limits, dt) {
    const dist = (0, vec_1.distance2)(s, goal);
    const headingToGoal = Math.atan2(goal.y - s.y, goal.x - s.x);
    const headingErr = (0, vec_1.wrapAngle)(headingToGoal - s.yaw);
    const yawErr = (0, vec_1.wrapAngle)(goal.yaw - s.yaw);
    const turnRate = (err) => (0, vec_1.clamp)(2.0 * err, -limits.wMax, limits.wMax);
    if (dist > 0.02) {
        if (Math.abs(headingErr) > 0.05) {
            const next = integrateUnicycle(s, ramp(s.v, 0, limits, dt), turnRate(headingErr), dt, limits);
            return { next, phase: 'turn', done: false };
        }
        const vMax = (0, exports.speedLimit)(s, limits);
        const vTarget = Math.min(vMax, Math.sqrt(2 * limits.decel * dist), dist / dt);
        const next = integrateUnicycle(s, ramp(s.v, vTarget, limits, dt), turnRate(headingErr), dt, limits);
        return { next, phase: 'drive', done: false };
    }
    if (Math.abs(yawErr) > 0.0175) {
        const next = integrateUnicycle(s, 0, turnRate(yawErr), dt, limits);
        return { next, phase: 'align', done: false };
    }
    return { next: { ...s, v: 0, w: 0 }, phase: 'done', done: true };
}
/**
 * @description Move the lift toward a target height at its rated speed, clamped to travel.
 * @param s - Current state.
 * @param targetZ - Desired carriage height (m).
 * @param limits - Motion limits.
 * @param dt - Step (s).
 * @returns Next state and arrival flag.
 */
function liftStep(s, targetZ, limits, dt) {
    const target = (0, vec_1.clamp)(targetZ, limits.liftMin, limits.liftMax);
    const delta = target - s.liftZ;
    const step = limits.liftSpeed * dt;
    if (Math.abs(delta) <= step)
        return { next: { ...s, liftZ: target }, done: true };
    return { next: { ...s, liftZ: s.liftZ + Math.sign(delta) * step }, done: false };
}
//# sourceMappingURL=diff-drive.js.map